/**
 * /api/curriculum-sheet/autofill
 *
 * 핵심아이디어-first 자동 채우기
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. 주제/전단계 산출물/채팅으로 교과별 핵심아이디어 후보를 추천
 * 2. 교사가 확인한 핵심아이디어를 기준으로 같은 영역·학년군 성취기준 추천
 * 3. 지식·이해/과정·기능/가치·태도는 DB 원문에서만 채움
 * 4. GPT는 수업내용 설명만 생성
 */

import { NextRequest, NextResponse } from 'next/server'
import { generationParams, logLlmUsage, resolveOpenAIModel } from '@/lib/llm/openai'
import OpenAI from 'openai'
import { loadGraph, type CurriculumStandard, type KnowledgeGraph } from '@/lib/curriculum/graphReader'
import { isElementaryGradeGroup, loadContentSystemsForGradeGroup, type ContentSystemRecord } from '@/lib/curriculum/contentSystemReader'
import { gradeBandNeedle, isUsableCoreIdea, toCanonicalGradeBand } from '@/lib/curriculum/curriculumFilters'
import { chooseBandCenters, includeTeamSubjects, resolveAutofillGradeBands } from '@/lib/curriculum/collaborativeBands'
import { normalizeTeamGradeBands, subjectAvailableInGradeBand } from '@/lib/curriculum/teamGradeBands'
import {
  canonicalSubjectName,
  graphSubjectIdsForSubject,
  resolveBridgeSubjects,
} from '@/lib/curriculum/subjectAliases'
import {
  bridgeLevelFor,
  chunkItems,
  clampBridgeLimit,
  dedupeByStandardCode,
  selectBridgeCandidates,
  type BridgeLevel,
} from '@/lib/curriculum/bridgeStandards'
import {
  judgeCoreIdeas,
  judgeElements,
  judgeStandards,
  pickTopByScore,
  jevJudgeEnabled,
  verifyDescriptions,
  type JudgeContext,
  type JudgeMode,
} from '@/lib/curriculum/jevJudge'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 90

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 통합교과(바른 생활·슬기로운 생활·즐거운 생활)는 1-2학년군 전용 교과다.
// 지식 그래프의 이름('바른 생활·슬기로운 생활·즐거운 생활')과 시트 표기('통합교과')가
// 달라 예전 includes 매칭으로는 한 건도 잡히지 않았다 → subjectAliases 표로 해결.
const SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과', '통합교과'] as const
const SEP = ' | '

interface AreaMapping {
  subject: string
  subArea?: string
  entryArea?: string
  coreIdeas: string[]
  knowledge: string[]
  functions: string[]
}

interface ExistingRow {
  subject: string
  isCenter?: boolean
  /** 행별 학년군('3-4학년군'·'초3-4' 모두 허용). 없으면 프로젝트 학년군을 쓴다. */
  gradeBand?: string
  coreIdea?: string
  standard?: string
  knowledge?: string
  processFunction?: string
  valueAttitude?: string
  description?: string
}

interface GraphSavedStandard {
  id: string
  label: string
  subjectId: string
  text: string
}

interface GraphSavedData {
  centerNode: GraphSavedStandard | null
  selectedStandards: GraphSavedStandard[]
}

interface LinkedSubject {
  subject: string
  focus: string
}

interface SelectedCoreIdea {
  subject: string
  coreIdea: string
  /** 이 핵심아이디어로 채울 학년군들. 없으면 프로젝트 학년군 1개. */
  gradeBands?: string[]
}

interface CoreIdeaOption {
  subject: string
  coreIdeaId: string
  /** 같은 문장이 그래프의 여러 노드(영역)에 중복 수록된 경우 전부. coreIdeaId 는 첫 번째. */
  coreIdeaIds: string[]
  area: string
  areas: string[]
  idea: string
  score: number
  standardsCount: number
  sampleStandards: string[]
  /** 이 후보에 성취기준이 실제로 있는 학년군들. 사회·실과처럼 학년군별로 쪼개진 교과가 있다. */
  gradeBands: string[]
}

type JudgeKind = 'jev' | 'embedding'

interface CoreIdeaProposal {
  subject: string
  focus: string
  isCenter: boolean
  selectedCoreIdea: string
  /** 이 교과가 채울 학년군들(행 1개/학년군). 시트 행의 gradeBand 에서 나온다. */
  gradeBands: string[]
  options: CoreIdeaOption[]
  /** 어떤 판정기로 순위를 매겼는지. 시트 UI가 확신도 배지를 보여주는 데 쓴다. */
  judge?: JudgeKind
  confidence?: number
  mode?: JudgeMode
}

interface StepTiming {
  id: string
  label: string
  ms: number
  judge?: JudgeKind
}

interface BuiltRow {
  subject: string
  isCenter: boolean
  /** 이 행의 학년군('1-2학년군' 형태). 모든 학년군 필터·판정이 이 값을 기준으로 돈다. */
  gradeBand: string
  coreIdea: string
  area: string
  standard: string
  knowledge: string
  processFunction: string
  valueAttitude: string
}

let mappingCache: AreaMapping[] | null = null

function loadAreaMappings(): AreaMapping[] {
  if (mappingCache) return mappingCache
  // prod bundles only public/ (Next 16 + Firebase frameworks drop data/ globs),
  // so the prebuild sync mirrors this file there; data/ stays first for dev.
  const candidates = [
    path.join(process.cwd(), 'data/core-idea-area-mapping.json'),
    path.join(process.cwd(), 'public/core-idea-area-mapping.json'),
  ]
  try {
    const mappingPath = candidates.find(p => fs.existsSync(p))
    mappingCache = mappingPath
      ? (JSON.parse(fs.readFileSync(mappingPath, 'utf-8')) as AreaMapping[])
      : []
  } catch {
    mappingCache = []
  }
  return mappingCache
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY || texts.length === 0) return []
  const resp = await openai.embeddings.create({ input: texts, model: 'text-embedding-3-small' })
  return resp.data.map(d => d.embedding)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[·⋅]/g, '⋅').trim()
}

function matchesNormalized(a: string, b: string): boolean {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function isSelectionCurriculum(curriculum: string): boolean {
  return curriculum.trim().startsWith('선택 중심 교육과정')
}

function canonicalSubject(value: string): string {
  const compact = (value ?? '').trim()
  // 빈 문자열은 어떤 교과로도 매핑하지 않는다.
  // (subject.includes('')가 항상 true라서 빈 값이 '국어'로 잘못 매핑되는 것을 방지)
  if (!compact) return ''
  // 1순위: 명시적 별칭 표. '바른 생활'·'사회과'·'실과(기술·가정)/정보' 같은
  // 원천 데이터 표기를 시트 교과명으로 확정한다.
  const aliased = canonicalSubjectName(compact)
  if (aliased) return aliased
  return SUBJECTS.find(subject => compact.includes(subject) || subject.includes(compact)) ?? compact
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function gradeNeedle(grade: string): string {
  // 방어적 파싱: '초5-6'·'5~6'·'초등학교 5-6학년'·'5-6학년군' 모두 '5-6'로 정규화.
  // 파싱 실패 시 ''를 반환해 학년 필터가 데이터를 통째로 비우지 않도록 한다.
  return gradeBandNeedle(grade)
}

function formatGradeGroupLabel(grade: string): string {
  const normalized = gradeNeedle(grade).trim()
  if (!normalized) return ''
  if (/^\d-\d$/.test(normalized)) return `${normalized}학년군`
  if (/^\d-\d학년군$/.test(normalized)) return normalized
  return normalized
}

function withGradePrefix(item: string, grade: string): string {
  const trimmed = item.trim()
  if (!trimmed || /^\d-\d학년군:/.test(trimmed)) return trimmed
  const label = formatGradeGroupLabel(grade)
  return label ? `${label}: ${trimmed}` : trimmed
}

function gradeMatches(std: CurriculumStandard, grade: string): boolean {
  if (!grade) return true
  const needle = gradeNeedle(grade)
  return (std.grade_band ?? '').includes(needle)
}

function filterByGrade(items: string[], grade: string): string[] {
  if (!grade) return items
  const needle = gradeNeedle(grade)
  const withPrefix = items.filter(it => /^\d+-\d+학년군:/.test(it))
  if (withPrefix.length === 0) return items.map(item => withGradePrefix(item, grade))
  if (!needle) return withPrefix
  const filtered = withPrefix.filter(it => it.includes(needle))
  // 미스매치로 비면 학년군별 원문 전체로 복구 — 공란보다 원문이 낫다.
  return filtered.length > 0 ? filtered : withPrefix
}

function formatCode(code: string): string {
  const trimmed = code.trim()
  return trimmed.startsWith('[') ? trimmed : `[${trimmed}]`
}

function formatStandard(std: CurriculumStandard): string {
  return `${formatCode(std.code)} ${std.text}`
}

function extractStandardCodes(value: string): Set<string> {
  const codes = new Set<string>()
  for (const match of value.matchAll(/\[?([0-9][가-힣A-Za-z]+[0-9]{2}-[0-9]{2})\]?/g)) {
    codes.add(match[1])
  }
  return codes
}

function codeWithoutBrackets(code: string): string {
  return code.replace(/^\[/, '').replace(/\]$/, '')
}

function tokenSet(text: string): Set<string> {
  const stopwords = new Set(['수업', '학생', '교과', '활동', '학습', '주제', '관련', '이해', '탐구', '표현', '내용', '과정'])
  return new Set((text.match(/[가-힣A-Za-z0-9]+/g) ?? [])
    .map(token => token.toLowerCase())
    .filter(token => token.length >= 2 && !stopwords.has(token)))
}

function heuristicScore(query: string, candidate: string): number {
  const q = tokenSet(query)
  const c = tokenSet(candidate)
  if (q.size === 0 || c.size === 0) return 0
  let score = 0
  for (const qt of q) {
    if (c.has(qt)) score += 1
    else {
      for (const ct of c) {
        if (qt.includes(ct) || ct.includes(qt)) {
          score += 0.35
          break
        }
      }
    }
  }
  return score / q.size
}

/**
 * 여러 질의 × 여러 후보의 유사도 행렬. 임베딩 호출 1회로 처리하고, 실패 시 휴리스틱으로 폴백.
 * 반환값 [i][j] = sources[i] 와 targets[j] 의 유사도.
 */
async function rankMatrix(sources: string[], targets: string[]): Promise<number[][]> {
  if (sources.length === 0 || targets.length === 0) return sources.map(() => [])
  try {
    const embeddings = await embedTexts([...sources, ...targets])
    if (embeddings.length === sources.length + targets.length) {
      return sources.map((_, i) => targets.map((__, j) => cosineSim(embeddings[i], embeddings[sources.length + j])))
    }
  } catch (error) {
    console.error('[autofill embedding matrix]', error)
  }
  return sources.map(source => targets.map(target => heuristicScore(source, target)))
}

function standardEmbeddingText(std: CurriculumStandard): string {
  return `${std.area} ${std.text} ${(std.keywords ?? []).join(' ')}`
}

async function rankTexts(query: string, texts: string[]): Promise<number[]> {
  if (texts.length === 0) return []
  try {
    const embeddings = await embedTexts([query, ...texts])
    if (embeddings.length === texts.length + 1) {
      return texts.map((_, index) => cosineSim(embeddings[0], embeddings[index + 1]))
    }
  } catch (error) {
    console.error('[autofill embedding]', error)
  }
  return texts.map(text => heuristicScore(query, text))
}

function getSubjectIds(graph: KnowledgeGraph, subject: string): string[] {
  const canonical = canonicalSubject(subject)
  if (!canonical) return []
  // 1순위: 별칭 표의 그래프 id. 이름 포함 검사로는 통합교과(name_ko가
  // '바른 생활·슬기로운 생활·즐거운 생활')가 한 건도 잡히지 않았다.
  const aliased = graphSubjectIdsForSubject(canonical)
  if (aliased.length > 0) {
    const known = new Set(graph.subjects.map(s => s.id))
    const hits = aliased.filter(id => known.has(id))
    if (hits.length > 0) return hits
  }
  return graph.subjects
    .filter(s => s.name_ko.includes(canonical) || canonical.includes(s.name_ko))
    // 창의적 체험활동은 별칭 표에서 명시적으로 지목했을 때만 쓴다(우연 매칭 금지).
    .filter(s => s.id !== 'sub_extra')
    .map(s => s.id)
}

function subjectNameForId(graph: KnowledgeGraph, subjectId: string): string {
  return graph.subjects.find(s => s.id === subjectId)?.name_ko ?? subjectId
}

function parseLinkedSubjects(a12Artifact?: Record<string, unknown>): LinkedSubject[] {
  const raw = a12Artifact?.['linkedSubjects'] || a12Artifact?.['교과 연계'] || a12Artifact?.['연계 교과']
  if (!Array.isArray(raw)) return []
  return raw.map((item: unknown) => {
    const o = (typeof item === 'object' && item) ? item as Record<string, unknown> : {}
    return {
      subject: canonicalSubject(String(o['subject'] || o['교과'] || item || '')),
      focus: String(o['focus'] || o['역할'] || ''),
    }
  }).filter(item => item.subject)
}

function deriveSubjects(
  a12Artifact: Record<string, unknown> | undefined,
  linkedSubjects: LinkedSubject[],
  graphSavedData: GraphSavedData | undefined,
  graph: KnowledgeGraph | null,
  chatContext: string | undefined,
  existingRows: ExistingRow[] = [],
  selectedCoreIdeas: SelectedCoreIdea[] = [],
): string[] {
  const subjects: string[] = []
  // 교사가 확인 창에서 고른 교과가 최우선. 한 행만 채우는 호출(mode:'rows' +
  // selectedCoreIdeas 1건)은 시트 행·주제·그래프 없이도 동작해야 한다.
  subjects.push(...selectedCoreIdeas.map(item => canonicalSubject(item.subject)).filter(Boolean))
  // 사용자가 분석시트에 직접 입력한 과목을 그다음으로 사용한다.
  // (주제/그래프 데이터가 없어도 표의 과목만으로 자동 채우기가 동작해야 함)
  subjects.push(...existingRows.map(row => canonicalSubject(row.subject)).filter(Boolean))
  subjects.push(...linkedSubjects.map(item => item.subject))

  const rawTargets = a12Artifact?.['targetSubjects'] || a12Artifact?.['대상 교과']
  if (Array.isArray(rawTargets)) subjects.push(...rawTargets.map(item => canonicalSubject(String(item))))

  if (graph && graphSavedData) {
    const graphSubjectIds = [
      graphSavedData.centerNode?.subjectId,
      ...graphSavedData.selectedStandards.map(item => item.subjectId),
    ].filter((id): id is string => Boolean(id))
    subjects.push(...graphSubjectIds.map(id => canonicalSubject(subjectNameForId(graph, id))))
  }

  if (subjects.length === 0 && chatContext) {
    subjects.push(...SUBJECTS.filter(subject => chatContext.includes(subject)))
  }

  return unique(subjects.map(canonicalSubject).filter(Boolean))
}

function queryForSubject(subject: string, focus: string, topic: string, chatContext?: string): string {
  return `${subject} ${focus} ${topic} ${chatContext?.slice(0, 500) ?? ''}`.trim()
}

function standardsForSubject(graph: KnowledgeGraph, subject: string, gradeBand: string): CurriculumStandard[] {
  const subjectIds = getSubjectIds(graph, subject)
  return graph.achievementStandards.filter(std =>
    subjectIds.includes(std.subject_id) &&
    gradeMatches(std, gradeBand) &&
    Boolean(std.core_idea_id)
  )
}

/**
 * 여러 학년군의 성취기준 합집합. 한 교과가 1-2·5-6 두 행으로 들어오면
 * 핵심아이디어 후보는 두 학년군을 합쳐 뽑고(판정 호출 1회), 행을 만들 때
 * 다시 학년군별로 갈라 쓴다.
 */
function standardsForSubjectBands(graph: KnowledgeGraph, subject: string, gradeBands: string[]): CurriculumStandard[] {
  const bands = gradeBands.length > 0 ? gradeBands : ['']
  const subjectIds = getSubjectIds(graph, subject)
  return graph.achievementStandards.filter(std =>
    subjectIds.includes(std.subject_id) &&
    bands.some(band => gradeMatches(std, band)) &&
    Boolean(std.core_idea_id)
  )
}

/** 성취기준의 학년군을 정식 라벨('3-4학년군')로. 매칭 불가면 ''. */
function standardBandLabel(std: CurriculumStandard): string {
  return toCanonicalGradeBand(std.grade_band)
}

function alignElementsToStandard(params: {
  graph: KnowledgeGraph
  subject: string
  area: string
  gradeBand: string
  selectedStandard?: CurriculumStandard
  knowledge: string[]
  functions: string[]
}): { knowledge: string[]; functions: string[] } | null {
  const { graph, subject, area, gradeBand, selectedStandard, knowledge, functions } = params
  if (!selectedStandard) return null

  const peerStandards = standardsForSubject(graph, subject, gradeBand)
    .filter(std => matchesNormalized(std.area, selectedStandard.area || area))
    .sort((a, b) => codeWithoutBrackets(a.code).localeCompare(codeWithoutBrackets(b.code)))
  const standardIndex = peerStandards.findIndex(std =>
    std.id === selectedStandard.id ||
    codeWithoutBrackets(std.code) === codeWithoutBrackets(selectedStandard.code)
  )
  if (standardIndex < 0) return null

  const alignedKnowledge = knowledge.length === peerStandards.length
    ? [knowledge[standardIndex]].filter(Boolean)
    : knowledge
  const alignedFunctions = functions.length === peerStandards.length
    ? [functions[standardIndex]].filter(Boolean)
    : functions

  if (alignedKnowledge.length === knowledge.length && alignedFunctions.length === functions.length) return null
  return { knowledge: alignedKnowledge, functions: alignedFunctions }
}

function savedStandardsForSubject(graphSavedData: GraphSavedData | undefined, graph: KnowledgeGraph, subject: string): Set<string> {
  if (!graphSavedData) return new Set()
  const subjectIds = new Set(getSubjectIds(graph, subject))
  return new Set([
    ...(graphSavedData.centerNode ? [graphSavedData.centerNode] : []),
    ...graphSavedData.selectedStandards,
  ].filter(std => subjectIds.has(std.subjectId)).map(std => std.id))
}

function optionResolvesToOfficial(
  subject: string,
  area: string,
  idea: string,
  contentSystems: ContentSystemRecord[],
  areaMappings: AreaMapping[],
): boolean {
  const record = findOfficialContentRecord(contentSystems, subject, area, idea)
  if (record && (record.knowledge.length > 0 || record.functions.length > 0)) return true
  const mapping = findOfficialAreaMapping(areaMappings, subject, area, idea)
  return Boolean(mapping && (mapping.knowledge.length > 0 || mapping.functions.length > 0))
}

async function buildCoreIdeaProposal(params: {
  graph: KnowledgeGraph
  subject: string
  focus: string
  topic: string
  gradeBands: string[]
  chatContext?: string
  graphSavedData?: GraphSavedData
  existingCoreIdea?: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): Promise<CoreIdeaProposal | null> {
  const { graph, subject, focus, topic, gradeBands, chatContext, graphSavedData, existingCoreIdea, contentSystems, areaMappings } = params
  const standards = standardsForSubjectBands(graph, subject, gradeBands)
  const savedIds = savedStandardsForSubject(graphSavedData, graph, subject)
  const byCoreIdeaId = new Map<string, CurriculumStandard[]>()

  for (const std of standards) {
    if (!std.core_idea_id) continue
    if (!byCoreIdeaId.has(std.core_idea_id)) byCoreIdeaId.set(std.core_idea_id, [])
    byCoreIdeaId.get(std.core_idea_id)!.push(std)
  }

  const allOptions: CoreIdeaOption[] = []
  const optionByText = new Map<string, CoreIdeaOption>()
  for (const [coreIdeaId, groupStandards] of byCoreIdeaId) {
    const coreIdea = graph.coreIdeas.find(item => item.id === coreIdeaId)
    if (!coreIdea) continue
    for (const idea of coreIdea.ideas) {
      // 완전한 핵심아이디어 문장만 후보로. '[별표 …]'·어휘 목록 같은 그래프 잡음은 제외.
      if (!isUsableCoreIdea(idea)) continue
      // [2026-09-20] 같은 문장이 두 노드에 중복 수록된 경우(사회 5-6 인문환경 4문장) 하나로 합친다.
      // 따로 두면 후보 목록에 같은 문장이 두 번 보이고 Jev Choice 확률이 반으로 갈린다.
      const text = idea.replace(/\s+/g, ' ').trim()
      const existing = optionByText.get(text)
      const groupBands = unique(groupStandards.map(standardBandLabel).filter(Boolean))
      if (existing) {
        if (!existing.coreIdeaIds.includes(coreIdeaId)) {
          existing.coreIdeaIds.push(coreIdeaId)
          existing.standardsCount += groupStandards.length
          existing.gradeBands = unique([...existing.gradeBands, ...groupBands])
        }
        if (!existing.areas.includes(coreIdea.area)) existing.areas.push(coreIdea.area)
        continue
      }
      const option: CoreIdeaOption = {
        subject,
        coreIdeaId,
        coreIdeaIds: [coreIdeaId],
        area: coreIdea.area,
        areas: [coreIdea.area],
        idea: text,
        score: 0,
        standardsCount: groupStandards.length,
        sampleStandards: [],
        gradeBands: groupBands,
      }
      optionByText.set(text, option)
      allOptions.push(option)
    }
  }

  // [2026-09-19] 그래프는 성취기준을 핵심아이디어 '그룹'(영역)에만 연결하므로 문장별 짝이 없다.
  // 문장 ↔ 그룹 성취기준 유사도로 문장마다 관련 성취기준 상위 3개를 고른다
  // (예전에는 그룹의 앞 3개를 모든 문장에 동일하게 붙여 후보 간 구분이 되지 않았음).
  const standardIndex = new Map(standards.map((std, index) => [std.id, index]))
  const ideaToStandard = await rankMatrix(
    allOptions.map(option => `${option.area} ${option.idea}`),
    standards.map(standardEmbeddingText),
  )
  const relatedStandards = new Map<CoreIdeaOption, CurriculumStandard[]>()
  allOptions.forEach((option, optionIndex) => {
    const related = option.coreIdeaIds.flatMap(id => byCoreIdeaId.get(id) ?? [])
      .map(std => ({ std, sim: ideaToStandard[optionIndex]?.[standardIndex.get(std.id) ?? -1] ?? 0 }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map(item => item.std)
    relatedStandards.set(option, related)
    option.sampleStandards = related.map(formatStandard)
  })

  // 내용체계 원문(지식·이해/과정·기능)으로 해소되는 후보만 남긴다. 하나도 없으면
  // 기능을 막지 않도록 전체 후보로 폴백한다.
  const resolvable = allOptions.filter(option =>
    option.areas.some(area => optionResolvesToOfficial(option.subject, area, option.idea, contentSystems, areaMappings)),
  )
  const options = resolvable.length > 0 ? resolvable : allOptions

  if (options.length === 0) return null

  // 후보 점수 — [2026-09-20] Jev 판정 우선. 임베딩은 후보 점수가 0.31~0.35 로 몰려 변별이 안 됐다
  // (실측 20건 중 14건에서 Jev 가 더 타당, 기존 우세 0건). Jev 미설정·오류 시 임베딩으로 폴백.
  const isCenter = graphSavedData?.centerNode
    ? getSubjectIds(graph, subject).includes(graphSavedData.centerNode.subjectId)
    : false
  const query = queryForSubject(subject, focus, topic, chatContext)
  let scores: number[] | null = null
  let judge: JudgeKind = 'embedding'
  let confidence: number | undefined
  let mode: JudgeMode | undefined
  if (jevJudgeEnabled()) {
    const judgement = await judgeCoreIdeas(
      { subject, isCenter, gradeGroup: gradeBandsLabel(gradeBands), topic, chatContext, focus },
      options.map((option, index) => ({ key: `c${index}`, area: option.areas.join(' / '), idea: option.idea })),
    )
    if (judgement) {
      scores = options.map((_, index) => judgement.probabilities[`c${index}`] ?? 0)
      judge = 'jev'
      confidence = judgement.confidence
      mode = judgement.mode
    }
  }
  if (!scores) {
    // 영역 + 문장 + 그 문장과 관련된 성취기준(그룹 전체가 아님)으로 주제와 비교.
    // 그룹 전체를 넣으면 같은 영역 문장끼리 점수가 거의 같아진다.
    scores = await rankTexts(query, options.map(option => {
      const related = relatedStandards.get(option) ?? []
      return `${option.area} ${option.idea} ${related.map(standardEmbeddingText).join(' ')}`
    }))
  }

  const existingNormalized = normalizeText(existingCoreIdea ?? '')
  const scored = options.map((option, index) => {
    const savedBoost = option.coreIdeaIds.some(id => (byCoreIdeaId.get(id) ?? []).some(std => savedIds.has(std.id))) ? 0.2 : 0
    const existingBoost = existingNormalized && normalizeText(option.idea) === existingNormalized ? 1 : 0
    return {
      ...option,
      score: Math.round(((scores?.[index] ?? 0) + savedBoost + existingBoost) * 100) / 100,
    }
  }).sort((a, b) => b.score - a.score || b.standardsCount - a.standardsCount)

  return {
    subject,
    focus,
    isCenter,
    selectedCoreIdea: scored[0]?.idea ?? '',
    gradeBands,
    options: takeOptionsPerBand(scored, gradeBands),
    judge,
    confidence,
    mode,
  }
}

/**
 * 후보를 학년군별로 남긴다. 전체 상위 6개만 자르면 1-2·5-6 혼합 행에서
 * 한쪽 학년군 후보가 전부 밀려 그 학년군 행을 만들 성취기준이 사라진다
 * (사회·실과처럼 핵심아이디어 자체가 학년군별로 쪼개진 교과에서 실제로 발생).
 */
function takeOptionsPerBand(
  scored: CoreIdeaOption[],
  gradeBands: string[],
  overall = 6,
  perBand = 3,
): CoreIdeaOption[] {
  const out = scored.slice(0, overall)
  for (const band of gradeBands) {
    if (!band) continue
    for (const option of scored.filter(item => item.gradeBands.includes(band)).slice(0, perBand)) {
      if (!out.includes(option)) out.push(option)
    }
  }
  return out.sort((a, b) => b.score - a.score || b.standardsCount - a.standardsCount)
}

/** 판정 컨텍스트·프롬프트에 쓰는 학년군 표기. 혼합이면 '1-2학년군 · 5-6학년군'. */
function gradeBandsLabel(gradeBands: string[]): string {
  const labels = unique(gradeBands.map(band => formatGradeGroupLabel(band) || band).filter(Boolean))
  return labels.join(' · ')
}

function findSelectedOption(proposal: CoreIdeaProposal, selected?: string, requireMatch = false): CoreIdeaOption | undefined {
  const normalized = normalizeText(selected ?? '')
  if (normalized) {
    const exact = proposal.options.find(option => normalizeText(option.idea) === normalized)
    if (exact) return exact
    const fuzzy = proposal.options.find(option => {
      const idea = normalizeText(option.idea)
      return idea.includes(normalized) || normalized.includes(idea)
    })
    if (fuzzy) return fuzzy
    if (requireMatch) return undefined
  }
  return proposal.options[0]
}

/** 후보에 이 학년군 성취기준이 있는가. 학년군 라벨이 없는 후보는 제한하지 않는다. */
function optionHasBand(option: CoreIdeaOption, band: string): boolean {
  if (!band) return true
  if (option.gradeBands.length === 0) return true
  return option.gradeBands.includes(band)
}

/**
 * 한 학년군 행에 쓸 핵심아이디어 후보.
 * 교사가 고른 후보에 그 학년군 성취기준이 없으면(사회 '지리 인식'은 3-4·5-6이
 * 서로 다른 노드) 그 학년군 상위 후보로 대체하고 substituted 로 알린다.
 */
function pickOptionForBand(
  proposal: CoreIdeaProposal,
  selectedOption: CoreIdeaOption | undefined,
  band: string,
): { option?: CoreIdeaOption; substituted: boolean } {
  if (selectedOption && optionHasBand(selectedOption, band)) return { option: selectedOption, substituted: false }
  const inBand = proposal.options.find(option => optionHasBand(option, band))
  if (!inBand) return { option: undefined, substituted: false }
  return { option: inBand, substituted: Boolean(selectedOption) }
}

function contentMatchesIdea(mappingIdeas: string[], selectedIdea: string): boolean {
  const selected = normalizeText(selectedIdea)
  return mappingIdeas.some(idea => {
    const normalized = normalizeText(idea)
    return normalized === selected ||
      normalized.startsWith(selected.slice(0, 15)) ||
      selected.startsWith(normalized.slice(0, 15))
  })
}

// [절대 규칙 2026-05-14] 핵심아이디어가 속한 내용체계의 성취기준·지식이해/과정기능만 매핑.
// Why: 사용자 명시 — fallback에서 area만 매칭하면 같은 area의 다른 핵심아이디어 record가 잡혀
//      엉뚱한 지식이해/과정기능이 들어옴. coreIdea 매칭은 항상 필수.
function findOfficialContentRecord(
  contentSystems: ContentSystemRecord[],
  subject: string,
  area: string,
  selectedIdea: string,
): ContentSystemRecord | undefined {
  const sameSubjectContent = contentSystems.filter(record =>
    canonicalSubject(record.subject) === canonicalSubject(subject) &&
    !isSelectionCurriculum(record.curriculum)
  )
  // 1순위: area+coreIdea 둘 다 매칭 (가장 정밀)
  // 2순위: coreIdea만 매칭 (같은 핵심아이디어가 다른 area 라벨일 수 있음)
  // **금지: area만 매칭 fallback** — 다른 핵심아이디어의 데이터 유입
  return sameSubjectContent.find(record =>
    matchesNormalized(record.area, area) &&
    contentMatchesIdea(record.coreIdeas, selectedIdea)
  ) ?? sameSubjectContent.find(record =>
    contentMatchesIdea(record.coreIdeas, selectedIdea)
  )
}

function findOfficialAreaMapping(
  areaMappings: AreaMapping[],
  subject: string,
  area: string,
  selectedIdea: string,
): AreaMapping | undefined {
  const mappingAreaMatches = (item: AreaMapping) =>
    !area || [item.entryArea, item.subArea].some(candidate => candidate && matchesNormalized(candidate, area))
  // [절대 규칙] coreIdea 매칭은 항상 필수. area는 보조.
  return areaMappings.find(item =>
    canonicalSubject(item.subject) === canonicalSubject(subject) &&
    contentMatchesIdea(item.coreIdeas, selectedIdea) &&
    mappingAreaMatches(item)
  ) ?? areaMappings.find(item =>
    canonicalSubject(item.subject) === canonicalSubject(subject) &&
    contentMatchesIdea(item.coreIdeas, selectedIdea)
  )
}

async function selectItems(query: string, items: string[], count: number): Promise<string[]> {
  const uniqueItems = unique(items.filter(Boolean))
  if (uniqueItems.length <= count) return uniqueItems
  const scores = await rankTexts(query, uniqueItems)
  return uniqueItems
    .map((text, index) => ({ text, score: scores[index] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(item => item.text)
}

async function resolveKnowledgeAndFunctions(params: {
  subject: string
  area: string
  areas?: string[]
  selectedIdea: string
  coreIdeaId: string
  selectedStandard?: CurriculumStandard
  graph: KnowledgeGraph
  gradeBand: string
  query: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
  judgeCtx?: JudgeContext
}): Promise<{ knowledge: string[]; functions: string[]; attitudes: string[]; judge?: JudgeKind; judgeMs: number }> {
  const { subject, selectedIdea, selectedStandard, graph, gradeBand, query, contentSystems, areaMappings, judgeCtx } = params
  // 중복 병합된 문장은 소속 영역이 둘일 수 있다 — 내용체계 원문이 있는 영역을 먼저 쓴다.
  const candidateAreas = params.areas?.length ? params.areas : [params.area]
  const area = candidateAreas.find(a => findOfficialContentRecord(contentSystems, subject, a, selectedIdea)) ?? candidateAreas[0]
  const elementQuery = [
    query,
    selectedStandard?.area,
    selectedStandard?.text,
    ...(selectedStandard?.keywords ?? []),
    ...(selectedStandard?.concepts ?? []),
  ].filter(Boolean).join(' ')

  let knowledge: string[] = []
  let functions: string[] = []
  let attitudes: string[] = []

  if (knowledge.length === 0 && functions.length === 0) {
    const contentRecord = findOfficialContentRecord(contentSystems, subject, area, selectedIdea)
    if (contentRecord) {
      const baseKnowledge = filterByGrade(contentRecord.knowledge, gradeBand)
      const baseFunctions = filterByGrade(contentRecord.functions, gradeBand)
      const baseAttitudes = filterByGrade(contentRecord.attitudes, gradeBand)
      knowledge = baseKnowledge
      functions = baseFunctions
      attitudes = baseAttitudes
      const aligned = alignElementsToStandard({ graph, subject, area, gradeBand, selectedStandard, knowledge, functions })
      if (aligned) {
        // 성취기준 인덱스 정렬 결과가 비면(정렬 불일치 등) 원문 전체로 복구한다.
        knowledge = aligned.knowledge.length > 0 ? aligned.knowledge : baseKnowledge
        functions = aligned.functions.length > 0 ? aligned.functions : baseFunctions
      }
    }
  }

  if (knowledge.length === 0 && functions.length === 0) {
    const mapping = findOfficialAreaMapping(areaMappings, subject, area, selectedIdea)
    if (mapping) {
      knowledge = filterByGrade(mapping.knowledge, gradeBand)
      functions = filterByGrade(mapping.functions, gradeBand)
    }
  }

  // [2026-09-20] 요소 선별도 Jev Score(불필요~필수)로. 세 목록을 한 번에 fan-out 하고 상위 n개.
  // 목록이 n개 이하면 판정 없이 전부 쓴다(기존 selectItems 와 동일 규칙).
  const uniqueKnowledge = unique(knowledge.filter(Boolean))
  const uniqueFunctions = unique(functions.filter(Boolean))
  const uniqueAttitudes = unique(attitudes.filter(Boolean))
  const needsJudge = uniqueKnowledge.length > 3 || uniqueFunctions.length > 2 || uniqueAttitudes.length > 2
  if (judgeCtx && needsJudge && jevJudgeEnabled()) {
    const judgement = await judgeElements(
      judgeCtx,
      { area, idea: selectedIdea, standard: selectedStandard ? formatStandard(selectedStandard) : '' },
      {
        knowledge: uniqueKnowledge.length > 3 ? uniqueKnowledge : [],
        functions: uniqueFunctions.length > 2 ? uniqueFunctions : [],
        attitudes: uniqueAttitudes.length > 2 ? uniqueAttitudes : [],
      },
    )
    if (judgement) {
      return {
        knowledge: uniqueKnowledge.length > 3 ? pickTopByScore(uniqueKnowledge, judgement.knowledge, 3) : uniqueKnowledge,
        functions: uniqueFunctions.length > 2 ? pickTopByScore(uniqueFunctions, judgement.functions, 2) : uniqueFunctions,
        attitudes: uniqueAttitudes.length > 2 ? pickTopByScore(uniqueAttitudes, judgement.attitudes, 2) : uniqueAttitudes,
        judge: 'jev',
        judgeMs: judgement.elapsedMs,
      }
    }
  }
  return {
    knowledge: await selectItems(elementQuery || query, knowledge, 3),
    functions: await selectItems(elementQuery || query, functions, 2),
    attitudes: await selectItems(elementQuery || query, attitudes, 2),
    // 목록이 n개 이하면 판정 없이 전부 쓴다 — 판정기 표시 없음.
    judge: needsJudge ? 'embedding' : undefined,
    judgeMs: 0,
  }
}

/**
 * 같은 교과의 시트 행. 학년군이 주어지면 그 학년군 행을 먼저 찾고,
 * 없으면 학년군 표기가 없는 같은 교과 행으로 폴백한다.
 */
function existingRowForSubject(existingRows: ExistingRow[], subject: string, gradeBand?: string): ExistingRow | undefined {
  const sameSubject = existingRows.filter(row => canonicalSubject(row.subject) === canonicalSubject(subject))
  if (gradeBand) {
    const sameBand = sameSubject.find(row => toCanonicalGradeBand(row.gradeBand) === gradeBand)
    if (sameBand) return sameBand
  }
  return sameSubject.find(row => !toCanonicalGradeBand(row.gradeBand)) ?? sameSubject[0]
}

function existingStandardForSubject(existingRows: ExistingRow[], subject: string, gradeBand?: string): string {
  return existingRowForSubject(existingRows, subject, gradeBand)?.standard ?? ''
}

function existingCoreIdeaForSubject(existingRows: ExistingRow[], subject: string, gradeBand?: string): string {
  return existingRowForSubject(existingRows, subject, gradeBand)?.coreIdea ?? ''
}

function selectedCoreIdeaEntry(selectedCoreIdeas: SelectedCoreIdea[], subject: string): SelectedCoreIdea | undefined {
  return selectedCoreIdeas.find(item => canonicalSubject(item.subject) === canonicalSubject(subject))
}

function explicitSelectedCoreIdea(selectedCoreIdeas: SelectedCoreIdea[], subject: string): string {
  return selectedCoreIdeaEntry(selectedCoreIdeas, subject)?.coreIdea ?? ''
}

function splitMappedValues(value: string): string[] {
  return value.split(SEP).map(item => item.trim()).filter(Boolean)
}

function normalizedSet(items: string[]): Set<string> {
  return new Set(items.map(normalizeText).filter(Boolean))
}

function validateMappedRowsFromDb(params: {
  rows: BuiltRow[]
  graph: KnowledgeGraph
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): void {
  const { rows, graph, contentSystems, areaMappings } = params
  const errors: string[] = []

  for (const row of rows) {
    // 검증도 행별 학년군으로. 프로젝트 학년군으로 검증하면 1-2학년군 행의
    // 성취기준·내용 요소가 "DB 원문과 불일치"로 오판된다.
    const gradeBand = row.gradeBand
    // 오류 메시지에도 학년군을 붙인다(같은 교과가 학년군별로 여러 행일 수 있음).
    const rowLabel = gradeBand ? `${row.subject}(${gradeBand})` : row.subject
    const subjectIds = getSubjectIds(graph, row.subject)
    const subjectStandards = standardsForSubject(graph, row.subject, gradeBand)
    const rowCodes = extractStandardCodes(row.standard)
    const selectedStandard = subjectStandards.find(std =>
      rowCodes.has(codeWithoutBrackets(std.code)) &&
      normalizeText(formatStandard(std)) === normalizeText(row.standard)
    ) ?? subjectStandards.find(std => rowCodes.has(codeWithoutBrackets(std.code)))

    if (!selectedStandard) {
      errors.push(`${rowLabel}: 성취기준이 교육과정 DB 원문과 일치하지 않습니다.`)
      continue
    }

    const coreIdeaCandidates = graph.coreIdeas
      .filter(item => subjectIds.includes(item.subject_id))
      .flatMap(item => item.ideas)
    if (!normalizedSet(coreIdeaCandidates).has(normalizeText(row.coreIdea))) {
      errors.push(`${rowLabel}: 핵심아이디어가 교육과정 DB 후보에 없습니다.`)
    }

    const lookupArea = row.area || selectedStandard.area
    const contentRecord =
      findOfficialContentRecord(contentSystems, row.subject, lookupArea, row.coreIdea) ??
      findOfficialContentRecord(contentSystems, row.subject, selectedStandard.area, row.coreIdea)
    const mapping = contentRecord
      ? undefined
      : findOfficialAreaMapping(areaMappings, row.subject, lookupArea, row.coreIdea) ??
        findOfficialAreaMapping(areaMappings, row.subject, selectedStandard.area, row.coreIdea)
    const allowedKnowledge = filterByGrade(contentRecord?.knowledge ?? mapping?.knowledge ?? [], gradeBand)
    const allowedFunctions = filterByGrade(contentRecord?.functions ?? mapping?.functions ?? [], gradeBand)
    const allowedAttitudes = filterByGrade(contentRecord?.attitudes ?? [], gradeBand)

    const checkValues = (label: string, value: string, allowed: string[]) => {
      const values = splitMappedValues(value)
      if (values.length === 0) {
        // 원문 후보가 있는데 셀이 비었다면 조용한 매핑 누락 — 명시적으로 실패시킨다.
        // (resolveKnowledgeAndFunctions의 원문 복구로 정상 흐름에서는 도달하지 않는다.)
        if (allowed.length > 0) {
          errors.push(`${rowLabel}: ${label}이(가) 비었지만 DB 원문 후보(${allowed.length}건)가 있습니다. 매핑 누락.`)
        }
        return
      }
      if (allowed.length === 0) {
        errors.push(`${rowLabel}: ${label}에 대한 DB 원문 후보를 찾지 못했습니다. (영역=${lookupArea})`)
        return
      }
      const allowedSet = normalizedSet(allowed)
      const invalid = values.filter(item => !allowedSet.has(normalizeText(item)))
      if (invalid.length > 0) {
        errors.push(`${rowLabel}: ${label} 값이 DB 원문 후보와 일치하지 않습니다. (${invalid.join(', ')})`)
      }
    }

    checkValues('지식·이해', row.knowledge, allowedKnowledge)
    checkValues('과정·기능', row.processFunction, allowedFunctions)
    checkValues('가치·태도', row.valueAttitude, allowedAttitudes)
  }

  if (errors.length > 0) {
    throw new Error(`교육과정 DB 원문 검증 실패: ${errors.join(' / ')}`)
  }
}

/** 한 행(교과 × 학년군)을 만들기 위해 확정된 재료. */
interface RowTarget {
  proposal: CoreIdeaProposal
  gradeBand: string
  option: CoreIdeaOption
  isCenter: boolean
}

async function buildRowsFromSelections(params: {
  graph: KnowledgeGraph
  proposals: CoreIdeaProposal[]
  selectedCoreIdeas: SelectedCoreIdea[]
  existingRows: ExistingRow[]
  graphSavedData?: GraphSavedData
  topic: string
  chatContext?: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): Promise<{ rows: BuiltRow[]; steps: StepTiming[]; notes: string[] }> {
  const { graph, proposals, selectedCoreIdeas, existingRows, graphSavedData, topic, chatContext, contentSystems, areaMappings } = params
  const notes: string[] = []

  // 학년군 1개당 행 1개. 학년군은 시트 행(existingRows.gradeBand) 또는
  // selectedCoreIdeas[].gradeBands 에서 이미 확정되어 proposal 에 실려 있다.
  const targets: RowTarget[] = []
  for (const proposal of proposals) {
    const subject = proposal.subject
    const userSelectedIdea = explicitSelectedCoreIdea(selectedCoreIdeas, subject)
    for (const gradeBand of proposal.gradeBands.length > 0 ? proposal.gradeBands : ['']) {
      const selectedIdea =
        userSelectedIdea ||
        existingCoreIdeaForSubject(existingRows, subject, gradeBand) ||
        proposal.selectedCoreIdea
      const selectedOption = findSelectedOption(proposal, selectedIdea, Boolean(userSelectedIdea))
      if (!selectedOption) {
        throw new Error(`${subject} 핵심아이디어가 교육과정 DB 후보와 일치하지 않습니다.`)
      }
      const picked = pickOptionForBand(proposal, selectedOption, gradeBand)
      if (!picked.option) {
        notes.push(`${subject}: ${gradeBand || '해당 학년군'} 성취기준이 교육과정 DB에 없어 행을 만들지 못했습니다.`)
        continue
      }
      if (picked.substituted) {
        notes.push(`${subject} ${gradeBand}: 선택한 핵심아이디어에는 이 학년군 성취기준이 없어 "${picked.option.idea}"로 대체했습니다.`)
      }
      targets.push({
        proposal,
        gradeBand,
        option: picked.option,
        isCenter: proposal.isCenter,
      })
    }
  }

  // 학년군별로 중심 교과를 유지한다. 저학년 통합교과와 고학년 사회가 각각 중심일 수 있다.
  const centeredTargets = chooseBandCenters(targets.map(target => ({
    ...target, subject: target.proposal.subject, coreIdea: target.option.idea,
  })), existingRows)
  const built = await Promise.all(centeredTargets.map(async (target): Promise<{ row: BuiltRow; steps: StepTiming[] }> => {
    const { proposal, gradeBand, option } = target
    const subject = proposal.subject
    const focus = proposal.focus
    // 같은 교과가 학년군별로 여러 행일 수 있어 단계 라벨·id 에 학년군을 붙인다.
    const rowLabel = gradeBand ? `${subject} ${gradeBand}` : subject

    const query = queryForSubject(subject, focus, topic, chatContext)
    const optionIds = option.coreIdeaIds?.length ? option.coreIdeaIds : [option.coreIdeaId]
    const standards = standardsForSubject(graph, subject, gradeBand)
      .filter(std => optionIds.includes(std.core_idea_id ?? ''))
    const existingCodes = extractStandardCodes(existingStandardForSubject(existingRows, subject, gradeBand))
    const savedIds = savedStandardsForSubject(graphSavedData, graph, subject)
    const judgeCtx: JudgeContext = {
      subject,
      isCenter: target.isCenter,
      gradeGroup: formatGradeGroupLabel(gradeBand) || gradeBand,
      topic,
      chatContext,
      focus,
    }
    const steps: StepTiming[] = []

    let rankedStandards = standards
    if (standards.length > 1) {
      // [2026-09-20] 성취기준 관련도는 Jev Score(0~3)로 판정, 실패 시 임베딩(주제·문장 50:50)으로 폴백.
      let relevance: number[] | null = null
      let judge: JudgeKind = 'embedding'
      let judgeMs = 0
      if (jevJudgeEnabled()) {
        const judgement = await judgeStandards(
          judgeCtx,
          { area: option.areas?.join(' / ') ?? option.area, idea: option.idea },
          standards.map(std => ({ id: std.id, code: formatCode(std.code), text: std.text })),
        )
        if (judgement) {
          relevance = standards.map(std => (judgement.scores[std.id] ?? 0) / 3)
          judge = 'jev'
          judgeMs = judgement.elapsedMs
        }
      }
      if (!relevance) {
        const [topicScores, ideaScores] = await rankMatrix(
          [query, `${option.area} ${option.idea}`],
          standards.map(standardEmbeddingText),
        )
        relevance = standards.map((_, index) => 0.5 * (topicScores[index] ?? 0) + 0.5 * (ideaScores[index] ?? 0))
      }
      steps.push({ id: `standards:${subject}:${gradeBand}`, label: `${rowLabel} 성취기준 판정`, ms: judgeMs, judge })
      const scoresForStandards = relevance
      rankedStandards = standards
        .map((std, index) => {
          const code = codeWithoutBrackets(std.code)
          const existingBoost = existingCodes.has(code) ? 1 : 0
          const savedBoost = savedIds.has(std.id) ? 0.25 : 0
          return { std, score: (scoresForStandards[index] ?? 0) + existingBoost + savedBoost }
        })
        .sort((a, b) => b.score - a.score)
        .map(item => item.std)
    }

    const selectedStandard = rankedStandards[0]
    const elements = await resolveKnowledgeAndFunctions({
      subject,
      area: option.area,
      areas: option.areas,
      selectedIdea: option.idea,
      coreIdeaId: option.coreIdeaId,
      selectedStandard,
      graph,
      gradeBand,
      query,
      contentSystems,
      areaMappings,
      judgeCtx,
    })
    steps.push({ id: `elements:${subject}:${gradeBand}`, label: `${rowLabel} 지식·이해/과정·기능/가치·태도 판정`, ms: elements.judgeMs, judge: elements.judge })

    return {
      row: {
        subject,
        isCenter: target.isCenter,
        gradeBand,
        coreIdea: option.idea,
        area: option.area,
        standard: selectedStandard ? formatStandard(selectedStandard) : '',
        knowledge: elements.knowledge.join(SEP),
        processFunction: elements.functions.join(SEP),
        valueAttitude: elements.attitudes.join(SEP),
      },
      steps,
    }
  }))

  const rows = built.map(item => item.row)
  // 중심 학년군 행이 만들어지지 않았으면 첫 행을 중심으로 — 중심 행이 0개인 표는 만들지 않는다.
  if (rows.length > 0 && !rows.some(row => row.isCenter)) rows[0].isCenter = true
  return { rows, steps: built.flatMap(item => item.steps), notes }
}

/**
 * 설명·검증 결과의 정식 키. 같은 교과가 학년군별로 여러 행일 수 있어
 * '교과::학년군'을 쓰고, 그 교과의 첫 행에는 교과명 키도 함께 넣어
 * 기존 클라이언트(descriptions[row.subject])와 호환을 유지한다.
 */
function rowKey(row: { subject: string; gradeBand?: string }): string {
  return row.gradeBand ? `${row.subject}::${row.gradeBand}` : row.subject
}

/** rowKey 로 만든 맵에 교과명 키(교과의 첫 행 값)를 덧붙인다. */
function withSubjectFallbackKeys<T>(rows: BuiltRow[], byRowKey: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...byRowKey }
  for (const row of rows) {
    const value = byRowKey[rowKey(row)]
    if (value === undefined) continue
    if (out[row.subject] === undefined) out[row.subject] = value
  }
  return out
}

/** 행들이 걸친 학년군. 여러 개면 혼합 학년군 수업이다. */
function rowBands(rows: BuiltRow[]): string[] {
  return unique(rows.map(row => row.gradeBand).filter(Boolean))
}

function lessonScopeLabel(rows: BuiltRow[]): string {
  const bands = rowBands(rows)
  if (bands.length > 1) return `초등학교 ${bands.join(' · ')}이 함께하는 융합 수업(학년군 혼합)`
  if (bands.length === 1) return `초등학교 ${bands[0]} 융합 수업`
  return '초등학교 융합 수업'
}

async function buildDescriptions(params: {
  rows: BuiltRow[]
  topic: string
  chatContext?: string
  /** Jev 검증에서 범위 밖으로 판정된 행을 다시 쓸 때 붙이는 추가 지시. */
  retryNote?: string
}): Promise<Record<string, string>> {
  const { rows, topic, chatContext, retryNote } = params
  if (!process.env.OPENAI_API_KEY || rows.length === 0) return {}

  const bands = rowBands(rows)
  try {
    const prompt = `${lessonScopeLabel(rows)}의 행별 "수업내용 설명"만 작성하세요.

중요:
- 핵심아이디어, 성취기준, 지식이해, 과정기능, 가치태도 값은 이미 DB에서 확정되었습니다.
- 아래 값들을 바꾸거나 새로 만들지 말고, 각 행이 수업에서 맡을 역할만 1~2문장으로 설명하세요.
- 각 행에는 학년군이 정해져 있습니다. 그 학년군 학생 수준에 맞게 쓰고, 다른 학년군 내용을 끌어오지 마세요.
${bands.length > 1 ? `- 이 수업은 ${bands.join(' · ')} 여러 학년군이 함께하는 수업입니다. 학년군마다 맡는 역할이 다름을 전제로 쓰세요.\n` : ''}- 확정된 성취기준·내용 요소 밖의 다른 성취기준이나 내용을 끌어오지 마세요.
- 응답 키는 아래 행 번호(R1, R2 …)를 그대로 쓰세요.
${retryNote ? `- ${retryNote}\n` : ''}
주제: ${topic || '(아래 맥락에서 추론)'}
대화 맥락: ${chatContext?.substring(0, 500) || '(없음)'}

${rows.map((r, index) => `[R${index + 1} / ${r.subject} / ${r.gradeBand || '학년군 미지정'}${r.isCenter ? ' / ★중심' : ''}]
핵심아이디어: ${r.coreIdea}
성취기준: ${r.standard}
지식이해: ${r.knowledge}
과정기능: ${r.processFunction}
가치태도: ${r.valueAttitude}`).join('\n\n')}

JSON: { "descriptions": { "R1": "설명" } }`

    const model = resolveOpenAIModel('utility')
    const startedAt = performance.now()
    const completion = await openai.chat.completions.create({
      ...generationParams(model, { maxTokens: 1500, temperature: 0.3, effort: 'light', json: true }),
      messages: [{ role: 'user', content: prompt }],
    } as never)
    logLlmUsage('curriculum-sheet/autofill:describe', model, completion.usage, performance.now() - startedAt, { rows: rows.length })
    const raw = (JSON.parse(completion.choices[0]?.message?.content ?? '{}')).descriptions ?? {}
    const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    // 모델이 행 번호 대신 교과명·'교과::학년군'을 키로 쓰는 경우까지 받아준다.
    const out: Record<string, string> = {}
    rows.forEach((row, index) => {
      const value = parsed[`R${index + 1}`] ?? parsed[rowKey(row)] ?? parsed[row.subject]
      if (typeof value === 'string' && value.trim()) out[rowKey(row)] = value.trim()
    })
    return out
  } catch (error) {
    console.error('[autofill GPT desc]', error)
    return {}
  }
}

/**
 * [3]+[4] LLM 설명 작성 → Jev 범위 검증 → 범위 밖(noul < 0.5) 행만 1회 재작성.
 * 검증 결과는 행에 넣지 않고 응답 메타(verification)로만 돌려준다(Firestore 행 스키마 불변).
 */
async function describeAndVerify(params: {
  rows: BuiltRow[]
  topic: string
  chatContext?: string
}): Promise<{ descriptions: Record<string, string>; verification: Record<string, number>; steps: StepTiming[] }> {
  const { rows, topic, chatContext } = params
  const steps: StepTiming[] = []
  const llmStart = performance.now()
  let descriptions = await buildDescriptions({ rows, topic, chatContext })
  steps.push({ id: 'describe', label: 'LLM 수업내용 설명 작성', ms: Math.round(performance.now() - llmStart) })

  let verification: Record<string, number> = {}
  if (!jevJudgeEnabled() || Object.keys(descriptions).length === 0) return { descriptions, verification, steps }

  const bandsLabel = rowBands(rows).join(' · ')
  // verifyDescriptions 는 행을 교과명으로 구분한다. 학년군 혼합이면 교과명이
  // 겹치므로 '교과 (학년군)' 라벨로 넘기고 결과를 rowKey 로 되돌린다.
  const mixed = rowBands(rows).length > 1
  const labelFor = (row: BuiltRow) => (mixed && row.gradeBand ? `${row.subject} (${row.gradeBand})` : row.subject)
  const verify = async (targetRows: BuiltRow[], targetDescriptions: Record<string, string>) => {
    const labelled = targetRows.map(row => ({ ...row, subject: labelFor(row) }))
    const byLabel: Record<string, string> = {}
    for (const row of targetRows) {
      const description = targetDescriptions[rowKey(row)]
      if (description) byLabel[labelFor(row)] = description
    }
    const verdict = await verifyDescriptions(topic, bandsLabel, labelled, byLabel)
    if (!verdict) return null
    const byRowKey: Record<string, number> = {}
    for (const row of targetRows) {
      const score = verdict.inScope[labelFor(row)]
      if (typeof score === 'number') byRowKey[rowKey(row)] = score
    }
    return { byRowKey, elapsedMs: verdict.elapsedMs }
  }

  const verdict = await verify(rows, descriptions)
  if (!verdict) return { descriptions, verification, steps }
  verification = verdict.byRowKey
  steps.push({ id: 'verify', label: 'Jev 설명 범위 검증', ms: verdict.elapsedMs, judge: 'jev' })

  const outOfScope = rows.filter(row => (verification[rowKey(row)] ?? 1) < 0.5)
  if (outOfScope.length > 0) {
    const retryStart = performance.now()
    const rewritten = await buildDescriptions({
      rows: outOfScope,
      topic,
      chatContext,
      retryNote: '직전 설명이 확정된 성취기준 범위를 벗어났습니다. 확정된 성취기준 문장과 지식이해·과정기능 요소만 근거로 다시 쓰세요.',
    })
    descriptions = { ...descriptions, ...rewritten }
    const recheck = await verify(outOfScope, rewritten)
    if (recheck) verification = { ...verification, ...recheck.byRowKey }
    steps.push({
      id: 'rewrite',
      label: `범위 밖 설명 재작성 (${outOfScope.map(row => labelFor(row)).join('·')})`,
      ms: Math.round(performance.now() - retryStart),
      judge: 'jev',
    })
  }
  return { descriptions, verification, steps }
}

/** 한 번의 Jev fan-out 에 담는 성취기준 수. 1-2학년군 전체는 ~100개라 나눠 부른다. */
const BRIDGE_JUDGE_CHUNK = 30

interface BridgeCandidate {
  subject: string
  standard: CurriculumStandard
  code: string
  area: string
  coreIdea: string
}

/** 그래프 핵심아이디어 노드에서 쓸 만한 문장 하나. 없으면 ''. */
function primaryCoreIdeaText(graph: KnowledgeGraph, coreIdeaId?: string | null): string {
  if (!coreIdeaId) return ''
  const node = graph.coreIdeas.find(item => item.id === coreIdeaId)
  const idea = (node?.ideas ?? []).map(text => text.replace(/\s+/g, ' ').trim()).find(isUsableCoreIdea)
  return idea ?? ''
}

/**
 * bridgeStandards 모드: 원 학년군의 핵심아이디어를 대상 학년군 성취기준으로 잇는다.
 *
 * Why: 3~6학년이 고른 사회 핵심아이디어에는 1-2학년군 성취기준이 없다. 1~2학년
 * 교사는 같은 핵심아이디어를 저학년 수준에서 구현할 다른 교과(국어·수학·통합교과)
 * 성취기준이 필요하다. 이 모드는 행을 만들지 않고 후보 순위만 돌려준다.
 */
async function handleBridgeStandards(params: {
  sourceSubject: string
  sourceCoreIdea: string
  targetBand: string
  subjects?: string[]
  topic?: string
  chatContext?: string
  limit?: number
}): Promise<NextResponse> {
  const sourceCoreIdea = (params.sourceCoreIdea ?? '').replace(/\s+/g, ' ').trim()
  const targetBand = toCanonicalGradeBand(params.targetBand)
  const sourceSubject = canonicalSubject(params.sourceSubject ?? '') || (params.sourceSubject ?? '').trim()
  const notes: string[] = []

  if (!sourceCoreIdea) {
    return NextResponse.json({ error: '원 학년군의 핵심아이디어(sourceCoreIdea)가 필요합니다.' }, { status: 400 })
  }
  if (!targetBand || !isElementaryGradeGroup(targetBand)) {
    return NextResponse.json({
      error: '대상 학년군(targetBand)을 1-2학년군·3-4학년군·5-6학년군 중에서 지정하세요.',
    }, { status: 400 })
  }

  const graph = loadGraph()
  if (!graph) return NextResponse.json({ error: '교육과정 지식 그래프를 불러오지 못했습니다.' }, { status: 500 })

  const requested = params.subjects ?? []
  const unknownRequested = requested.filter(subject => subject.trim() && !canonicalSubjectName(subject))
  if (unknownRequested.length > 0) {
    notes.push(`교육과정 DB에 없는 교과는 제외했습니다: ${unique(unknownRequested).join(', ')}`)
  }

  // 대상 학년군에 성취기준이 있는 교과만 후보로. (1-2학년군이면 사회·과학 등은 자동 제외)
  const subjectsSearched: string[] = []
  const rawCandidates: BridgeCandidate[] = []
  for (const subject of resolveBridgeSubjects(requested)) {
    const standards = standardsForSubject(graph, subject, targetBand)
    if (standards.length === 0) continue
    subjectsSearched.push(subject)
    for (const standard of standards) {
      rawCandidates.push({
        subject,
        standard,
        code: formatCode(standard.code),
        area: standard.area,
        coreIdea: primaryCoreIdeaText(graph, standard.core_idea_id),
      })
    }
  }
  const candidates = dedupeByStandardCode(rawCandidates)

  if (candidates.length === 0) {
    notes.push(`${targetBand} 성취기준이 있는 교과를 찾지 못했습니다. 다른 학년군을 고르거나 교과를 지정해 주세요.`)
    return NextResponse.json({
      error: notes[notes.length - 1],
      candidates: [],
      subjectsSearched,
      notes,
    }, { status: 404 })
  }

  const judgeCtx: JudgeContext = {
    subject: subjectsSearched.join('·'),
    isCenter: false,
    gradeGroup: targetBand,
    topic: params.topic?.trim()
      || `${sourceSubject} 핵심아이디어를 ${targetBand} 수준에서 함께 다룰 성취기준 찾기`,
    chatContext: params.chatContext,
    focus: `이 ${targetBand} 성취기준이 ${sourceSubject || '다른 학년군'} 핵심아이디어 "${sourceCoreIdea}"를 저학년 수준에서 구현하는가`,
  }

  let judge: JudgeKind = 'embedding'
  const scores = new Map<string, number>()
  if (jevJudgeEnabled()) {
    const chunks = chunkItems(candidates, BRIDGE_JUDGE_CHUNK)
    const judged = await Promise.all(chunks.map(chunk => judgeStandards(
      judgeCtx,
      { area: `${sourceSubject || '원 교과'} 원 학년군 핵심아이디어`, idea: sourceCoreIdea },
      chunk.map(item => ({ id: item.standard.id, code: item.code, text: item.standard.text })),
    )))
    if (judged.every(Boolean)) {
      judge = 'jev'
      chunks.forEach((chunk, index) => {
        const result = judged[index]
        for (const item of chunk) scores.set(item.standard.id, (result?.scores[item.standard.id] ?? 0) / 3)
      })
    } else {
      // 일부만 성공하면 Jev 점수와 임베딩 점수가 섞여 순위를 비교할 수 없다 → 전부 임베딩으로.
      notes.push('판정기 응답이 일부 실패해 임베딩 유사도로 순위를 매겼습니다.')
    }
  }
  if (scores.size === 0) {
    const relevance = await rankTexts(
      `${sourceSubject} ${sourceCoreIdea} ${params.topic ?? ''}`.trim(),
      candidates.map(item => standardEmbeddingText(item.standard)),
    )
    candidates.forEach((item, index) => scores.set(item.standard.id, relevance[index] ?? 0))
  }

  const preferIntegrated = targetBand === '1-2학년군' && !subjectAvailableInGradeBand(sourceSubject, targetBand)
  if (preferIntegrated) notes.push(`${targetBand}에는 ${sourceSubject} 교과가 따로 없어 ${subjectsSearched.includes('통합교과') ? '통합교과 등' : subjectsSearched.join('·')} 이 학년군의 실제 성취기준을 찾았습니다.`)
  const ranked = selectBridgeCandidates(candidates.map(item => ({
    ...item,
    score: Math.round((scores.get(item.standard.id) ?? 0) * 100) / 100,
  })), clampBridgeLimit(params.limit), preferIntegrated ? '통합교과' : undefined)

  // 내용체계 원문은 화면에 보이는 후보에 대해서만 찾는다(교과×영역 스캔 비용 절감).
  const contentSystems = loadContentSystemsForGradeGroup(targetBand)
  const contentCoreIdeaFor = (subject: string, area: string, idea: string): string => {
    if (!idea) return ''
    const record = findOfficialContentRecord(contentSystems, subject, area, idea)
    if (!record) return ''
    return record.coreIdeas.find(candidate => contentMatchesIdea([candidate], idea)) ?? record.coreIdeas[0] ?? ''
  }

  return NextResponse.json({
    candidates: ranked.map(item => ({
      subject: item.subject,
      code: item.code,
      text: item.standard.text,
      standard: formatStandard(item.standard),
      area: item.area,
      coreIdea: item.coreIdea,
      contentCoreIdea: contentCoreIdeaFor(item.subject, item.area, item.coreIdea),
      score: item.score,
      level: bridgeLevelFor(item.score) satisfies BridgeLevel,
    })),
    judge,
    subjectsSearched,
    notes,
  })
}

export async function POST(request: NextRequest) {
  try {
    const {
      mode = 'complete',
      a12Artifact,
      graphSavedData,
      targetGradeGroup,
      teamGradeBands,
      chatContext,
      existingRows = [],
      selectedCoreIdeas = [],
      rows: rowsToDescribe = [],
      sourceSubject,
      sourceCoreIdea,
      targetBand,
      subjects: bridgeSubjects,
      topic: requestTopic,
      limit: bridgeLimit,
    } = await request.json() as {
      /**
       * coreIdeas: 핵심아이디어 후보(판정) · rows: 성취기준·내용 요소까지 판정(설명 없음)
       * describe: 확정된 행으로 LLM 설명 작성 + Jev 검증 · complete: rows + describe 한 번에
       * bridgeStandards: 다른 학년군 핵심아이디어를 대상 학년군 성취기준으로 잇는 후보 순위
       */
      mode?: 'coreIdeas' | 'rows' | 'describe' | 'complete' | 'bridgeStandards'
      a12Artifact?: Record<string, unknown>
      graphSavedData?: GraphSavedData
      targetGradeGroup?: string
      teamGradeBands?: string[]
      chatContext?: string
      existingRows?: ExistingRow[]
      selectedCoreIdeas?: SelectedCoreIdea[]
      rows?: Array<Partial<BuiltRow> & { subject: string; id?: string }>
      /** bridgeStandards 전용 */
      sourceSubject?: string
      sourceCoreIdea?: string
      targetBand?: string
      subjects?: string[]
      topic?: string
      limit?: number
    }
    const startedAt = performance.now()

    // bridgeStandards 모드는 프로젝트 학년군이 아니라 targetBand 로 판단하므로
    // targetGradeGroup 게이트보다 앞에서 처리한다(행도 만들지 않는다).
    if (mode === 'bridgeStandards') {
      return await handleBridgeStandards({
        sourceSubject: sourceSubject ?? '',
        sourceCoreIdea: sourceCoreIdea ?? '',
        targetBand: targetBand ?? '',
        subjects: bridgeSubjects,
        topic: requestTopic,
        chatContext,
        limit: bridgeLimit,
      })
    }

    const gradeGroup = targetGradeGroup ?? ''
    if (!isElementaryGradeGroup(gradeGroup)) {
      return NextResponse.json({
        error: '현재 자동 채우기 데이터는 초등 교육과정만 검증되어 있습니다. 중·고등 프로젝트에서는 해당 학교급 교육과정 원문을 교사가 직접 입력해 주세요.',
        code: 'CURRICULUM_DATA_UNAVAILABLE',
      }, { status: 409 })
    }
    // 프로젝트 학년군은 행별 학년군의 기본값이다(행이 학년군을 주지 않을 때).
    const projectBand = toCanonicalGradeBand(gradeGroup)

    const graph = loadGraph()
    if (!graph) return NextResponse.json({ error: '교육과정 지식 그래프를 불러오지 못했습니다.' }, { status: 500 })

    const topic = String(a12Artifact?.['selectedTopic'] || a12Artifact?.['선택 주제'] || a12Artifact?.['주제'] || '')

    // describe 모드: 판정이 끝난 행만 받아 LLM 설명을 쓰고 Jev 로 범위를 검증한다.
    if (mode === 'describe') {
      // 행 id 를 유지해 결과를 행 단위로 되돌려준다(같은 교과가 여러 행일 수 있음).
      const withIds = rowsToDescribe
        .filter(row => row.subject)
        .map(row => ({
          id: row.id,
          row: {
            subject: canonicalSubject(row.subject) || row.subject,
            isCenter: Boolean(row.isCenter),
            gradeBand: toCanonicalGradeBand(row.gradeBand) || projectBand,
            coreIdea: row.coreIdea ?? '',
            area: row.area ?? '',
            standard: row.standard ?? '',
            knowledge: row.knowledge ?? '',
            processFunction: row.processFunction ?? '',
            valueAttitude: row.valueAttitude ?? '',
          } satisfies BuiltRow,
        }))
      const describable = withIds.map(item => item.row)
      const keyedForClient = <T,>(byRowKey: Record<string, T>): Record<string, T> => {
        const out = withSubjectFallbackKeys(describable, byRowKey)
        for (const { id, row } of withIds) {
          if (!id) continue
          const value = byRowKey[rowKey(row)]
          if (value !== undefined) out[id] = value
        }
        return out
      }
      const { descriptions, verification, steps } = await describeAndVerify({ rows: describable, topic, chatContext })
      return NextResponse.json({
        descriptions: keyedForClient(descriptions),
        verification: keyedForClient(verification),
        steps,
        judge: jevJudgeEnabled() ? 'jev' : 'embedding',
        message: `${Object.keys(descriptions).length}개 행 설명 작성`,
      })
    }

    const contentSystems = loadContentSystemsForGradeGroup(gradeGroup)
    const areaMappings = loadAreaMappings()
    const linkedSubjects = parseLinkedSubjects(a12Artifact)
    const derivedSubjects = deriveSubjects(a12Artifact, linkedSubjects, graphSavedData, graph, chatContext, existingRows, selectedCoreIdeas)
    // rows·complete 모드에서는 교사가 고른 교과만 판정한다.
    // 예전에는 시트의 모든 교과로 buildCoreIdeaProposal(교과당 Jev 호출 1회)을 돌린 뒤
    // scopedProposals 에서 버려, 한 행만 채우는 호출이 교과 수만큼 호출을 낭비했다.
    const selectedSubjects = unique(selectedCoreIdeas.map(item => canonicalSubject(item.subject)).filter(Boolean))
    const teamBands = normalizeTeamGradeBands(teamGradeBands)
    const subjects = mode !== 'coreIdeas' && selectedSubjects.length > 0
      ? selectedSubjects
      : includeTeamSubjects(derivedSubjects, teamBands)

    if (subjects.length === 0) {
      return NextResponse.json({ error: '교과 정보를 찾을 수 없습니다. 분석표에 과목을 입력하거나 주제(A-1-2)를 먼저 선정한 뒤 다시 시도하세요.' }, { status: 400 })
    }

    // 명시 선택 > 팀 학년군 전체 + 기존 행 > 대표값. 대화 문자열을 다시 추측하지 않는다.
    const notes: string[] = []
    const bandsForSubject = (subject: string): string[] => {
      const requested = resolveAutofillGradeBands({
        subject,
        teamGradeBands: teamBands,
        selectedBands: selectedCoreIdeaEntry(selectedCoreIdeas, subject)?.gradeBands,
        rowBands: existingRows
          .filter(row => canonicalSubject(row.subject) === canonicalSubject(subject))
          .map(row => row.gradeBand),
        defaultBand: projectBand,
      })
      return requested
    }
    const gradeBandsBySubject = new Map(subjects.map(subject => [subject, bandsForSubject(subject)]))

    if (subjects.includes('통합교과') && !derivedSubjects.includes('통합교과')) {
      notes.push('1-2학년군에는 사회·과학 등 대신 통합교과의 실제 성취기준을 연결했습니다. 학년군별 중심 교과는 시트에서 각각 지정할 수 있습니다.')
    }
    const proposals = (await Promise.all(subjects.filter(subject => (gradeBandsBySubject.get(subject)?.length ?? 0) > 0).map(subject => buildCoreIdeaProposal({
      graph,
      subject,
      focus: linkedSubjects.find(item => canonicalSubject(item.subject) === canonicalSubject(subject))?.focus ?? '',
      topic,
      gradeBands: gradeBandsBySubject.get(subject) ?? [projectBand],
      chatContext,
      graphSavedData,
      existingCoreIdea: explicitSelectedCoreIdea(selectedCoreIdeas, subject) || existingCoreIdeaForSubject(existingRows, subject),
      contentSystems,
      areaMappings,
    })))).filter((proposal): proposal is CoreIdeaProposal => Boolean(proposal))

    // 후보가 아예 없는 교과는 그 학년군에 성취기준이 없다는 뜻이므로 조용히 빠뜨리지 않는다
    // (예: 1-2학년군 사회·과학 — 1~2학년은 통합교과로 배운다).
    for (const subject of subjects) {
      if (proposals.some(proposal => proposal.subject === subject)) continue
      const bands = gradeBandsBySubject.get(subject) ?? []
      notes.push(`${subject}: ${bands.join(' · ') || '해당 학년군'} 성취기준이 교육과정 DB에 없어 제외했습니다.`)
    }

    if (proposals.length === 0) {
      // 한 행만 채우는 호출에서 그 학년군 성취기준이 없을 때, 왜 비었는지가
      // 오류 메시지로 바로 보이게 한다(빈 행을 조용히 돌려주지 않는다).
      return NextResponse.json({
        error: notes.length > 0
          ? notes.join(' / ')
          : '학년군과 교과에 맞는 핵심아이디어 후보를 찾지 못했습니다.',
        notes,
      }, { status: 404 })
    }

    // 중심 교과 결정: 사용자가 분석시트에서 지정한 중심 교과 > 그래프 중심 노드 > 첫 번째
    const existingCenterSubject = existingRows.find(row => row.isCenter && row.subject)?.subject
    const centeredProposals = existingCenterSubject
      ? proposals.map(proposal => ({
          ...proposal,
          isCenter: canonicalSubject(proposal.subject) === canonicalSubject(existingCenterSubject),
        }))
      : proposals.some(proposal => proposal.isCenter)
        ? proposals
        : proposals.map((proposal, index) => ({ ...proposal, isCenter: index === 0 }))

    const judge: JudgeKind = centeredProposals.every(proposal => proposal.judge === 'jev') ? 'jev' : 'embedding'
    if (mode === 'coreIdeas') {
      return NextResponse.json({
        proposals: centeredProposals,
        judge,
        notes,
        steps: [{ id: 'coreIdeas', label: '핵심아이디어 판정', ms: Math.round(performance.now() - startedAt), judge }],
        message: `${centeredProposals.length}개 교과의 핵심아이디어 후보를 찾았습니다.`,
      })
    }

    // complete 모드: 교사가 핵심아이디어 확인 창에서 제외한 교과는 행으로 만들지 않는다.
    // selectedCoreIdeas에 포함된 교과로만 제한 (창에서 삭제한 교과는 selectedCoreIdeas에서 빠짐).
    const selectedSubjectSet = new Set(selectedCoreIdeas.map(item => canonicalSubject(item.subject)))
    const scopedProposals = selectedSubjectSet.size > 0
      ? centeredProposals.filter(proposal => selectedSubjectSet.has(canonicalSubject(proposal.subject)))
      : centeredProposals
    const finalProposals = scopedProposals.length > 0
      ? (scopedProposals.some(proposal => proposal.isCenter)
          ? scopedProposals
          : scopedProposals.map((proposal, index) => ({ ...proposal, isCenter: index === 0 })))
      : centeredProposals

    const { rows: builtRows, steps: rowSteps, notes: rowNotes } = await buildRowsFromSelections({
      graph,
      proposals: finalProposals,
      selectedCoreIdeas,
      existingRows,
      graphSavedData,
      topic,
      chatContext,
      contentSystems,
      areaMappings,
    })
    notes.push(...rowNotes)
    validateMappedRowsFromDb({ rows: builtRows, graph, contentSystems, areaMappings })

    const stamp = (row: BuiltRow, description: string) => ({
      id: `af_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...row,
      description,
      updatedBy: 'AI 자동 채우기',
      updatedAt: Date.now(),
    })

    if (mode === 'rows') {
      return NextResponse.json({
        rows: builtRows.map(row => stamp(row, '')),
        judge,
        notes,
        steps: [{ id: 'rows', label: '성취기준·내용 요소 판정', ms: Math.round(performance.now() - startedAt), judge }, ...rowSteps],
        message: `${builtRows.length}개 행 — 성취기준·내용 요소 판정 완료`,
      })
    }

    const { descriptions, verification, steps: describeSteps } = await describeAndVerify({ rows: builtRows, topic, chatContext })
    const rows = builtRows.map(row => stamp(row, descriptions[rowKey(row)] ?? descriptions[row.subject] ?? ''))

    return NextResponse.json({
      rows,
      judge,
      notes,
      verification: withSubjectFallbackKeys(builtRows, verification),
      steps: [{ id: 'rows', label: '성취기준·내용 요소 판정', ms: Math.round(performance.now() - startedAt), judge }, ...rowSteps, ...describeSteps],
      message: `${rows.length}개 행 — 핵심아이디어 확인 기반 DB 매핑 완료`,
    })
  } catch (err) {
    console.error('[autofill]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

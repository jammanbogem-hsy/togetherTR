/**
 * /api/curriculum-sheet/autofill
 *
 * 핵심아이디어-first 자동 채우기
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. 주제/전단계 산출물/채팅으로 교과별 핵심아이디어 후보를 추천
 * 2. 교사가 확인한 핵심아이디어를 기준으로 같은 영역·학년군 성취기준 추천
 * 3. 지식·이해/과정·기능은 DB 원문에서만 채움
 * 4. GPT는 수업내용 설명만 생성
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { loadGraph, type CurriculumStandard, type KnowledgeGraph } from '@/lib/curriculum/graphReader'
import { isElementaryGradeGroup, loadContentSystems, loadElementaryContentSystems, type ContentSystemRecord } from '@/lib/curriculum/contentSystemReader'
import { gradeBandNeedle, isUsableCoreIdea } from '@/lib/curriculum/curriculumFilters'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 90

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과'] as const
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
  coreIdea?: string
  standard?: string
  knowledge?: string
  processFunction?: string
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
}

interface CoreIdeaOption {
  subject: string
  coreIdeaId: string
  area: string
  idea: string
  score: number
  standardsCount: number
  sampleStandards: string[]
}

interface CoreIdeaProposal {
  subject: string
  focus: string
  isCenter: boolean
  selectedCoreIdea: string
  options: CoreIdeaOption[]
}

interface BuiltRow {
  subject: string
  isCenter: boolean
  coreIdea: string
  area: string
  standard: string
  knowledge: string
  processFunction: string
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
  return graph.subjects
    .filter(s => s.name_ko.includes(canonical) || canonical.includes(s.name_ko))
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
): string[] {
  const subjects: string[] = []
  // 사용자가 분석시트에 직접 입력한 과목을 최우선으로 사용한다.
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

function standardsForSubject(graph: KnowledgeGraph, subject: string, gradeGroup: string): CurriculumStandard[] {
  const subjectIds = getSubjectIds(graph, subject)
  return graph.achievementStandards.filter(std =>
    subjectIds.includes(std.subject_id) &&
    gradeMatches(std, gradeGroup) &&
    Boolean(std.core_idea_id)
  )
}

function alignElementsToStandard(params: {
  graph: KnowledgeGraph
  subject: string
  area: string
  gradeGroup: string
  selectedStandard?: CurriculumStandard
  knowledge: string[]
  functions: string[]
}): { knowledge: string[]; functions: string[] } | null {
  const { graph, subject, area, gradeGroup, selectedStandard, knowledge, functions } = params
  if (!selectedStandard) return null

  const peerStandards = standardsForSubject(graph, subject, gradeGroup)
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
  gradeGroup: string
  chatContext?: string
  graphSavedData?: GraphSavedData
  existingCoreIdea?: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): Promise<CoreIdeaProposal | null> {
  const { graph, subject, focus, topic, gradeGroup, chatContext, graphSavedData, existingCoreIdea, contentSystems, areaMappings } = params
  const standards = standardsForSubject(graph, subject, gradeGroup)
  const savedIds = savedStandardsForSubject(graphSavedData, graph, subject)
  const byCoreIdeaId = new Map<string, CurriculumStandard[]>()

  for (const std of standards) {
    if (!std.core_idea_id) continue
    if (!byCoreIdeaId.has(std.core_idea_id)) byCoreIdeaId.set(std.core_idea_id, [])
    byCoreIdeaId.get(std.core_idea_id)!.push(std)
  }

  const allOptions: CoreIdeaOption[] = []
  for (const [coreIdeaId, groupStandards] of byCoreIdeaId) {
    const coreIdea = graph.coreIdeas.find(item => item.id === coreIdeaId)
    if (!coreIdea) continue
    for (const idea of coreIdea.ideas) {
      // 완전한 핵심아이디어 문장만 후보로. '[별표 …]'·어휘 목록 같은 그래프 잡음은 제외.
      if (!isUsableCoreIdea(idea)) continue
      allOptions.push({
        subject,
        coreIdeaId,
        area: coreIdea.area,
        idea,
        score: 0,
        standardsCount: groupStandards.length,
        sampleStandards: groupStandards.slice(0, 3).map(formatStandard),
      })
    }
  }

  // 내용체계 원문(지식·이해/과정·기능)으로 해소되는 후보만 남긴다. 하나도 없으면
  // 기능을 막지 않도록 전체 후보로 폴백한다.
  const resolvable = allOptions.filter(option =>
    optionResolvesToOfficial(option.subject, option.area, option.idea, contentSystems, areaMappings),
  )
  const options = resolvable.length > 0 ? resolvable : allOptions

  if (options.length === 0) return null

  const query = queryForSubject(subject, focus, topic, chatContext)
  const scores = await rankTexts(query, options.map(option => {
    const groupStandards = byCoreIdeaId.get(option.coreIdeaId) ?? []
    return `${option.area} ${option.idea} ${groupStandards.map(s => `${s.text} ${(s.keywords ?? []).join(' ')}`).join(' ')}`
  }))

  const existingNormalized = normalizeText(existingCoreIdea ?? '')
  const scored = options.map((option, index) => {
    const savedBoost = (byCoreIdeaId.get(option.coreIdeaId) ?? []).some(std => savedIds.has(std.id)) ? 0.2 : 0
    const existingBoost = existingNormalized && normalizeText(option.idea) === existingNormalized ? 1 : 0
    return {
      ...option,
      score: Math.round((scores[index] + savedBoost + existingBoost) * 100) / 100,
    }
  }).sort((a, b) => b.score - a.score || b.standardsCount - a.standardsCount)

  return {
    subject,
    focus,
    isCenter: graphSavedData?.centerNode
      ? getSubjectIds(graph, subject).includes(graphSavedData.centerNode.subjectId)
      : false,
    selectedCoreIdea: scored[0]?.idea ?? '',
    options: scored.slice(0, 6),
  }
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
  selectedIdea: string
  coreIdeaId: string
  selectedStandard?: CurriculumStandard
  graph: KnowledgeGraph
  gradeGroup: string
  query: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): Promise<{ knowledge: string[]; functions: string[] }> {
  const { subject, area, selectedIdea, selectedStandard, graph, gradeGroup, query, contentSystems, areaMappings } = params
  const elementQuery = [
    query,
    selectedStandard?.area,
    selectedStandard?.text,
    ...(selectedStandard?.keywords ?? []),
    ...(selectedStandard?.concepts ?? []),
  ].filter(Boolean).join(' ')

  let knowledge: string[] = []
  let functions: string[] = []

  if (knowledge.length === 0 && functions.length === 0) {
    const contentRecord = findOfficialContentRecord(contentSystems, subject, area, selectedIdea)
    if (contentRecord) {
      const baseKnowledge = filterByGrade(contentRecord.knowledge, gradeGroup)
      const baseFunctions = filterByGrade(contentRecord.functions, gradeGroup)
      knowledge = baseKnowledge
      functions = baseFunctions
      const aligned = alignElementsToStandard({ graph, subject, area, gradeGroup, selectedStandard, knowledge, functions })
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
      knowledge = filterByGrade(mapping.knowledge, gradeGroup)
      functions = filterByGrade(mapping.functions, gradeGroup)
    }
  }

  return {
    knowledge: await selectItems(elementQuery || query, knowledge, 3),
    functions: await selectItems(elementQuery || query, functions, 2),
  }
}

function existingStandardForSubject(existingRows: ExistingRow[], subject: string): string {
  return existingRows.find(row => canonicalSubject(row.subject) === canonicalSubject(subject))?.standard ?? ''
}

function existingCoreIdeaForSubject(existingRows: ExistingRow[], subject: string): string {
  return existingRows.find(row => canonicalSubject(row.subject) === canonicalSubject(subject))?.coreIdea ?? ''
}

function explicitSelectedCoreIdea(selectedCoreIdeas: SelectedCoreIdea[], subject: string): string {
  return selectedCoreIdeas.find(item => canonicalSubject(item.subject) === canonicalSubject(subject))?.coreIdea ?? ''
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
  gradeGroup: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): void {
  const { rows, graph, gradeGroup, contentSystems, areaMappings } = params
  const errors: string[] = []

  for (const row of rows) {
    const subjectIds = getSubjectIds(graph, row.subject)
    const subjectStandards = standardsForSubject(graph, row.subject, gradeGroup)
    const rowCodes = extractStandardCodes(row.standard)
    const selectedStandard = subjectStandards.find(std =>
      rowCodes.has(codeWithoutBrackets(std.code)) &&
      normalizeText(formatStandard(std)) === normalizeText(row.standard)
    ) ?? subjectStandards.find(std => rowCodes.has(codeWithoutBrackets(std.code)))

    if (!selectedStandard) {
      errors.push(`${row.subject}: 성취기준이 교육과정 DB 원문과 일치하지 않습니다.`)
      continue
    }

    const coreIdeaCandidates = graph.coreIdeas
      .filter(item => subjectIds.includes(item.subject_id))
      .flatMap(item => item.ideas)
    if (!normalizedSet(coreIdeaCandidates).has(normalizeText(row.coreIdea))) {
      errors.push(`${row.subject}: 핵심아이디어가 교육과정 DB 후보에 없습니다.`)
    }

    const lookupArea = row.area || selectedStandard.area
    const contentRecord =
      findOfficialContentRecord(contentSystems, row.subject, lookupArea, row.coreIdea) ??
      findOfficialContentRecord(contentSystems, row.subject, selectedStandard.area, row.coreIdea)
    const mapping = contentRecord
      ? undefined
      : findOfficialAreaMapping(areaMappings, row.subject, lookupArea, row.coreIdea) ??
        findOfficialAreaMapping(areaMappings, row.subject, selectedStandard.area, row.coreIdea)
    const allowedKnowledge = filterByGrade(contentRecord?.knowledge ?? mapping?.knowledge ?? [], gradeGroup)
    const allowedFunctions = filterByGrade(contentRecord?.functions ?? mapping?.functions ?? [], gradeGroup)

    const checkValues = (label: string, value: string, allowed: string[]) => {
      const values = splitMappedValues(value)
      if (values.length === 0) {
        // 원문 후보가 있는데 셀이 비었다면 조용한 매핑 누락 — 명시적으로 실패시킨다.
        // (resolveKnowledgeAndFunctions의 원문 복구로 정상 흐름에서는 도달하지 않는다.)
        if (allowed.length > 0) {
          errors.push(`${row.subject}: ${label}이(가) 비었지만 DB 원문 후보(${allowed.length}건)가 있습니다. 매핑 누락.`)
        }
        return
      }
      if (allowed.length === 0) {
        errors.push(`${row.subject}: ${label}에 대한 DB 원문 후보를 찾지 못했습니다. (영역=${lookupArea})`)
        return
      }
      const allowedSet = normalizedSet(allowed)
      const invalid = values.filter(item => !allowedSet.has(normalizeText(item)))
      if (invalid.length > 0) {
        errors.push(`${row.subject}: ${label} 값이 DB 원문 후보와 일치하지 않습니다. (${invalid.join(', ')})`)
      }
    }

    checkValues('지식·이해', row.knowledge, allowedKnowledge)
    checkValues('과정·기능', row.processFunction, allowedFunctions)
  }

  if (errors.length > 0) {
    throw new Error(`교육과정 DB 원문 검증 실패: ${errors.join(' / ')}`)
  }
}

async function buildRowsFromSelections(params: {
  graph: KnowledgeGraph
  proposals: CoreIdeaProposal[]
  selectedCoreIdeas: SelectedCoreIdea[]
  existingRows: ExistingRow[]
  graphSavedData?: GraphSavedData
  topic: string
  gradeGroup: string
  chatContext?: string
  contentSystems: ContentSystemRecord[]
  areaMappings: AreaMapping[]
}): Promise<BuiltRow[]> {
  const { graph, proposals, selectedCoreIdeas, existingRows, graphSavedData, topic, gradeGroup, chatContext, contentSystems, areaMappings } = params
  const rows: BuiltRow[] = []

  for (const proposal of proposals) {
    const subject = proposal.subject
    const focus = proposal.focus
    const userSelectedIdea = explicitSelectedCoreIdea(selectedCoreIdeas, subject)
    const selectedIdea =
      userSelectedIdea ||
      existingCoreIdeaForSubject(existingRows, subject) ||
      proposal.selectedCoreIdea
    const option = findSelectedOption(proposal, selectedIdea, Boolean(userSelectedIdea))
    if (!option) {
      throw new Error(`${subject} 핵심아이디어가 교육과정 DB 후보와 일치하지 않습니다.`)
    }

    const query = queryForSubject(subject, focus, topic, chatContext)
    const standards = standardsForSubject(graph, subject, gradeGroup)
      .filter(std => std.core_idea_id === option.coreIdeaId)
    const existingCodes = extractStandardCodes(existingStandardForSubject(existingRows, subject))
    const savedIds = savedStandardsForSubject(graphSavedData, graph, subject)

    let rankedStandards = standards
    if (standards.length > 1) {
      const scores = await rankTexts(query, standards.map(std => `${std.area} ${std.text} ${(std.keywords ?? []).join(' ')}`))
      rankedStandards = standards
        .map((std, index) => {
          const code = codeWithoutBrackets(std.code)
          const existingBoost = existingCodes.has(code) ? 1 : 0
          const savedBoost = savedIds.has(std.id) ? 0.25 : 0
          return { std, score: scores[index] + existingBoost + savedBoost }
        })
        .sort((a, b) => b.score - a.score)
        .map(item => item.std)
    }

    const selectedStandard = rankedStandards[0]
    const elements = await resolveKnowledgeAndFunctions({
      subject,
      area: option.area,
      selectedIdea: option.idea,
      coreIdeaId: option.coreIdeaId,
      selectedStandard,
      graph,
      gradeGroup,
      query,
      contentSystems,
      areaMappings,
    })

    rows.push({
      subject,
      isCenter: proposal.isCenter,
      coreIdea: option.idea,
      area: option.area,
      standard: selectedStandard ? formatStandard(selectedStandard) : '',
      knowledge: elements.knowledge.join(SEP),
      processFunction: elements.functions.join(SEP),
    })
  }

  return rows
}

async function buildDescriptions(params: {
  rows: BuiltRow[]
  topic: string
  gradeGroup: string
  chatContext?: string
}): Promise<Record<string, string>> {
  const { rows, topic, gradeGroup, chatContext } = params
  if (!process.env.OPENAI_API_KEY || rows.length === 0) return {}

  try {
    const prompt = `초등학교 ${gradeGroup} 융합 수업의 교과별 "수업내용 설명"만 작성하세요.

중요:
- 핵심아이디어, 성취기준, 지식이해, 과정기능 값은 이미 DB에서 확정되었습니다.
- 아래 값들을 바꾸거나 새로 만들지 말고, 각 교과가 수업에서 맡을 역할만 1~2문장으로 설명하세요.

주제: ${topic || '(아래 맥락에서 추론)'}
대화 맥락: ${chatContext?.substring(0, 500) || '(없음)'}

${rows.map(r => `[${r.subject}${r.isCenter ? ' ★중심' : ''}]
핵심아이디어: ${r.coreIdea}
성취기준: ${r.standard}
지식이해: ${r.knowledge}
과정기능: ${r.processFunction}`).join('\n\n')}

JSON: { "descriptions": { "교과명": "설명" } }`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    return (JSON.parse(completion.choices[0]?.message?.content ?? '{}')).descriptions ?? {}
  } catch (error) {
    console.error('[autofill GPT desc]', error)
    return {}
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      mode = 'complete',
      a12Artifact,
      graphSavedData,
      targetGradeGroup,
      chatContext,
      existingRows = [],
      selectedCoreIdeas = [],
    } = await request.json() as {
      mode?: 'coreIdeas' | 'complete'
      a12Artifact?: Record<string, unknown>
      graphSavedData?: GraphSavedData
      targetGradeGroup?: string
      chatContext?: string
      existingRows?: ExistingRow[]
      selectedCoreIdeas?: SelectedCoreIdea[]
    }

    const graph = loadGraph()
    if (!graph) return NextResponse.json({ error: '교육과정 지식 그래프를 불러오지 못했습니다.' }, { status: 500 })

    const gradeGroup = targetGradeGroup ?? ''
    // [strict-elementary 2026-05-14] 초등 전용 웹앱 — 비초등 gradeGroup이 와도 강제로 초등 데이터만.
    const contentSystems = loadElementaryContentSystems()
    const areaMappings = loadAreaMappings()
    const linkedSubjects = parseLinkedSubjects(a12Artifact)
    const subjects = deriveSubjects(a12Artifact, linkedSubjects, graphSavedData, graph, chatContext, existingRows)
    const topic = String(a12Artifact?.['selectedTopic'] || a12Artifact?.['선택 주제'] || a12Artifact?.['주제'] || '')

    if (subjects.length === 0) {
      return NextResponse.json({ error: '교과 정보를 찾을 수 없습니다. 분석표에 과목을 입력하거나 주제(A-1-2)를 먼저 선정한 뒤 다시 시도하세요.' }, { status: 400 })
    }

    const proposals = (await Promise.all(subjects.map(subject => buildCoreIdeaProposal({
      graph,
      subject,
      focus: linkedSubjects.find(item => canonicalSubject(item.subject) === canonicalSubject(subject))?.focus ?? '',
      topic,
      gradeGroup,
      chatContext,
      graphSavedData,
      existingCoreIdea: explicitSelectedCoreIdea(selectedCoreIdeas, subject) || existingCoreIdeaForSubject(existingRows, subject),
      contentSystems,
      areaMappings,
    })))).filter((proposal): proposal is CoreIdeaProposal => Boolean(proposal))

    if (proposals.length === 0) {
      return NextResponse.json({ error: '학년군과 교과에 맞는 핵심아이디어 후보를 찾지 못했습니다.' }, { status: 404 })
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

    if (mode === 'coreIdeas') {
      return NextResponse.json({
        proposals: centeredProposals,
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

    const builtRows = await buildRowsFromSelections({
      graph,
      proposals: finalProposals,
      selectedCoreIdeas,
      existingRows,
      graphSavedData,
      topic,
      gradeGroup,
      chatContext,
      contentSystems,
      areaMappings,
    })
    validateMappedRowsFromDb({ rows: builtRows, graph, gradeGroup, contentSystems, areaMappings })

    const descriptions = await buildDescriptions({ rows: builtRows, topic, gradeGroup, chatContext })
    const rows = builtRows.map(row => ({
      id: `af_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...row,
      description: descriptions[row.subject] ?? '',
      updatedBy: 'AI 자동 채우기',
      updatedAt: Date.now(),
    }))

    return NextResponse.json({
      rows,
      message: `${rows.length}개 교과 — 핵심아이디어 확인 기반 DB 매핑 완료`,
    })
  } catch (err) {
    console.error('[autofill]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

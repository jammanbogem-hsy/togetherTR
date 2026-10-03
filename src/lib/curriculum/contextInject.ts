/**
 * 교육과정 온톨로지 컨텍스트 주입기
 * =====================================
 * A단계 / Ds단계 채팅 시 대화 내용에서 주제 키워드를 추출하고
 * 관련 성취기준을 system prompt에 주입합니다.
 *
 * 주입 대상 활동:
 *   A-1-2  주제 선정          → 주제 키워드로 관련 성취기준 검색 + 3기준 평가 근거
 *   A-2-1  내용·기능요소 분석 → 확정 주제 기반 성취기준 전체 목록 제공
 *   A-2-2  통합 수업목표 진술 → 검색된 성취기준의 핵심 기능/개념 요약
 *   A-2-3  학습자·맥락 분석   → 성취기준의 예상 난이도 정보 활용
 *   Ds-*   설계 단계          → 확정된 성취기준 목록 가드레일로 주입
 */

import type { ActivityCode } from '@/types'
import type { GraphRelationType, GraphSavedData } from '@/lib/knowledge-graph/domain'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType } from '@/lib/knowledge-graph/domain'
import {
  searchStandards,
  getCrossLinks,
  getSubjectName,
  loadGraph,
  type CurriculumStandard,
} from './graphReader'
import { searchJsonStandards } from './curriculumJsonReader'
import { isUsableCoreIdea } from './curriculumFilters'
import { filterItemsByGradeBandStrict } from './sheetGradeBands'
import { filterGraphToGradeBand } from './graphGradeBands'
import { includeTeamSubjects } from './collaborativeBands'
import {
  normalizeTeamGradeBands,
  formatGradeBandList,
  dedupeCoreIdeaLines,
  capContextLength,
  subjectsForGradeBand,
  subjectsMissingInGradeBand,
  toGradeGroupCode,
} from './teamGradeBands'
import {
  buildContentSystemContext,
  isElementaryGradeGroup,
  isContentSystemContextEnabled,
  loadContentSystemsForGradeGroup,
} from './contentSystemReader'

function normalizeCurriculumText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[·⋅]/g, '⋅').trim()
}

function curriculumTextMatches(a: string, b: string): boolean {
  const na = normalizeCurriculumText(a)
  const nb = normalizeCurriculumText(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function filterContentByGrade(items: string[], gradeGroup?: string): string[] {
  return filterItemsByGradeBandStrict(items, gradeGroup)
}

function isSelectionCurriculum(curriculum: string): boolean {
  return curriculum.trim().startsWith('선택 중심 교육과정')
}

function dbChoiceTokens(text: string): Set<string> {
  return new Set(
    (text.match(/[가-힣A-Za-z0-9]+/g) ?? [])
      .map(token => token.toLowerCase())
      .filter(token => token.length >= 2)
  )
}

function selectDbCoreIdea(ideas: string[], query: string): string {
  const candidates = [...new Set(ideas.filter(Boolean))]
  if (candidates.length <= 1) return candidates[0] ?? ''
  const queryTokens = dbChoiceTokens(query)
  let best = candidates[0]
  let bestScore = -1
  for (const candidate of candidates) {
    const candidateTokens = dbChoiceTokens(candidate)
    let score = 0
    for (const token of candidateTokens) {
      if (queryTokens.has(token)) score += 3
      else {
        for (const queryToken of queryTokens) {
          if (queryToken.includes(token) || token.includes(queryToken)) {
            score += 1
            break
          }
        }
      }
    }
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

// 활동 코드 → 온톨로지 주입 활성화 여부
const ONTOLOGY_ENABLED_ACTIVITIES: ActivityCode[] = [
  'A-1-2', 'A-2-1', 'A-2-2', 'A-2-3',
  'Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2',
]

// ─── 키워드 추출 ─────────────────────────────────────────────────────────────

/**
 * 대화 메시지 + 확정 산출물에서 주제 키워드를 추출합니다.
 * 순수 휴리스틱 기반 (추가 LLM 호출 없음).
 */
export function extractKeywords(
  messages: Array<{ role: string; content: string }>,
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>,
): string[] {
  const keywords = new Set<string>()

  // 1. 확정 산출물에서 주제 키워드 추출 (가장 신뢰도 높음)
  if (confirmedArtifacts) {
    for (const artifact of Object.values(confirmedArtifacts)) {
      const content = artifact.content
      // "선택 주제", "수업 목표" 등의 산출물 내용에서 핵심어 추출
      const topicText =
        (content['선택 주제'] as string) ||
        (content['주제'] as string) ||
        (content['수업 목표'] as string) ||
        ''
      if (topicText) {
        extractNounChunks(topicText).forEach(k => keywords.add(k))
      }
    }
  }

  // 2. 최근 8개 메시지에서 키워드 추출 (주제 관련 명사구 위주)
  const recentMessages = messages.slice(-8)
  for (const msg of recentMessages) {
    extractNounChunks(msg.content).forEach(k => keywords.add(k))
  }

  return Array.from(keywords).filter(k => k.length >= 2)
}

// 한국어 조사·어미 목록 (경량 형태소 처리)
const KO_PARTICLES = [
  '에서', '에게', '으로', '한테', '보다', '까지', '마다', '부터', '라고',
  '이라', '이고', '이며', '이나', '이라도', '이든', '이면',
  '이서', '이야', '이랑', '이랑', '이란',
  '에서', '에게', '에도', '에만', '에는', '에서는', '에서도',
  '을', '를', '이', '가', '은', '는', '도', '와', '과', '의', '로', '으로',
  '에', '야', '아', '랑', '이랑', '한', '할', '하는', '하여', '하며',
]

// 한국어 불용 어미 (단어 끝에서 제거)
const KO_ENDINGS = ['하다', '하기', '하여', '하고', '하는', '한다', '합니다', '됩니다', '있다', '없다',
  '이다', '이며', '이고', '이나', '으로', '에서', '에게', '에는', '에도']

/**
 * 텍스트에서 의미 있는 명사를 추출합니다.
 * 조사·어미를 제거하는 경량 형태소 처리 포함.
 */
function extractNounChunks(text: string): string[] {
  const stopwords = new Set([
    '수업', '학생', '선생님', '교사', '활동', '학습', '교육', '과정',
    '내용', '방법', '목표', '단계', '관련', '기준', '이번', '오늘',
    '우리', '하나', '여러', '같은', '것이', '되는', '하는', '있는',
    '이런', '저런', '그런', '어떤', '이상', '정도', '부분', '정리',
    '통해', '위해', '대해', '따라', '때문', '통한', '위한', '대한',
  ])

  // 1) 2~8자 한글 어절 추출
  const rawTokens = text.match(/[\uAC00-\uD7A3]{2,10}/g) || []

  const cleaned = rawTokens.map(token => {
    let w = token
    // 조사 제거 (끝에서부터 긴 것 우선)
    for (const p of KO_PARTICLES.sort((a, b) => b.length - a.length)) {
      if (w.endsWith(p) && w.length - p.length >= 2) {
        w = w.slice(0, w.length - p.length)
        break
      }
    }
    // 어미 제거
    for (const e of KO_ENDINGS) {
      if (w.endsWith(e) && w.length - e.length >= 2) {
        w = w.slice(0, w.length - e.length)
        break
      }
    }
    return w
  })

  // 1글자 한국어 의미어("법", "물", "빛" 등) 허용 — 조사 1글자만 제외
  const SINGLE_CHAR_PARTICLES = new Set(['이','가','은','는','을','를','의','에','로','와','과','도','만','서','게','며','고','나','라','야','아'])

  return [...new Set(cleaned)]
    .filter(w => {
      if (w.length === 0) return false
      if (w.length === 1) return !SINGLE_CHAR_PARTICLES.has(w)
      return !stopwords.has(w)
    })
}

// ─── 성취기준 → 텍스트 포매터 ────────────────────────────────────────────────

function formatStandards(
  standards: CurriculumStandard[],
  showCrossLinks = false,
): string {
  if (standards.length === 0) return '(관련 성취기준을 찾지 못했습니다)'

  // 교과별 그룹핑
  const bySubject = new Map<string, CurriculumStandard[]>()
  for (const std of standards) {
    const subj = std.subject_id
    if (!bySubject.has(subj)) bySubject.set(subj, [])
    bySubject.get(subj)!.push(std)
  }

  const lines: string[] = []

  for (const [subjectId, stds] of bySubject) {
    const subjectName = getSubjectName(subjectId)
    lines.push(`[${subjectName}]`)

    for (const std of stds) {
      const kws = (std.keywords  ?? []).length > 0 ? ` (키워드: ${std.keywords.join(', ')})` : ''
      const kn  = (std.knowledge ?? []).length > 0 ? `\n    → 지식·이해: ${std.knowledge.join(', ')}` : ''
      const fn  = (std.functions ?? []).length > 0 ? `\n    → 과정·기능: ${std.functions.join(', ')}` : ''
      const cp  = (std.competencies ?? []).length > 0 ? `\n    → 가치·태도: ${std.competencies.join(', ')}` : ''
      lines.push(`  ${std.code} [${std.grade_band}학년군] ${std.text}${kws}${kn}${fn}${cp}`)
    }
  }

  // 교과 간 연결 링크 표시 (교육적 관계 유형 포함)
  if (showCrossLinks) {
    const stdIds = standards.map(s => s.id)
    const crossLinks = getCrossLinks(stdIds)
    if (crossLinks.length > 0) {
      lines.push('')
      lines.push('[교과 간 연결 관계]')
      // 관계 유형별 정렬 (도구-활용 → 현상-가치 → 내용-표현 → 의미-연결)
      const relOrder: GraphRelationType[] = ['도구-활용', '현상-가치', '내용-표현', DEFAULT_GRAPH_RELATION_TYPE]
      const sorted = [...crossLinks].sort((a, b) => {
        const ra = normalizeGraphRelationType(a.relation_edu) ?? DEFAULT_GRAPH_RELATION_TYPE
        const rb = normalizeGraphRelationType(b.relation_edu) ?? DEFAULT_GRAPH_RELATION_TYPE
        return (relOrder.indexOf(ra) - relOrder.indexOf(rb)) || b.weight - a.weight
      })
      for (const lk of sorted.slice(0, 6)) {
        const src = standards.find(s => s.id === lk.source_id)
        const tgt = standards.find(s => s.id === lk.target_id)
        if (!src || !tgt) continue
        const srcName = getSubjectName(lk.source_subject)
        const tgtName = getSubjectName(lk.target_subject)
        const relEdu = normalizeGraphRelationType(lk.relation_edu) ?? DEFAULT_GRAPH_RELATION_TYPE
        const strength = lk.weight >= 0.45 ? '강' : lk.weight >= 0.35 ? '중' : '약'
        lines.push(
          `  [${relEdu}·${strength}] ${srcName} ${src.code} ↔ ${tgtName} ${tgt.code} (유사도 ${(lk.weight * 100).toFixed(0)}%)`
        )
      }
    }
  }

  return lines.join('\n')
}

// ─── 활동별 컨텍스트 블록 생성 ───────────────────────────────────────────────

function buildActivityContext(
  activityCode: ActivityCode,
  standards: CurriculumStandard[],
  keywords: string[],
): string {
  if (standards.length === 0) return ''

  switch (activityCode) {
    case 'A-1-2': {
      // 주제 선정: 3기준 평가에 실제 성취기준 근거 제공
      const subjectCount = new Set(standards.map(s => s.subject_id)).size
      return `## 🎯 온톨로지 기반 교육과정 분석 결과 (A-1-2 주제 선정)
키워드 "${keywords.join(', ')}"와 관련된 실제 성취기준 ${standards.length}개 (${subjectCount}개 교과):

${formatStandards(standards, true)}

▶ 위 성취기준을 근거로 "학생 삶과의 연결성 / 교과 연계성 / 실현 가능성" 3기준 평가를 수행하세요.
▶ 교과 간 연결이 확인된 성취기준 쌍은 융합 설계의 근거가 됩니다.`
    }

    case 'A-2-1': {
      // 성취기준 분석: 내용·기능요소 추출 근거
      const allFunctions  = [...new Set(standards.flatMap(s => s.functions  ?? []))].filter(Boolean)
      const allConcepts   = [...new Set(standards.flatMap(s => s.concepts   ?? []))].filter(Boolean)
      const allKeywords   = [...new Set(standards.flatMap(s => s.keywords   ?? []))].filter(Boolean)
      const allCompetencies = [...new Set(standards.flatMap(s => s.competencies ?? []))].filter(Boolean)

      return `## 📚 온톨로지 기반 성취기준 분석 (A-2-1 내용·기능요소)

${formatStandards(standards, true)}

추출된 공통 요소:
• 핵심 기능: ${allFunctions.length > 0 ? allFunctions.join(', ') : '(직접 분석 필요)'}
• 핵심 개념: ${allConcepts.length > 0 ? allConcepts.join(', ') : '(직접 분석 필요)'}
• 핵심 키워드: ${allKeywords.slice(0, 10).join(', ')}
• 공통 역량: ${allCompetencies.join(', ')}

▶ 위 기능·개념 목록을 내용요소(지식)와 기능요소(과정)로 분류하여 분석하세요.
▶ 중복 요소는 통합 설계의 핵심 연결 고리가 됩니다.`
    }

    case 'A-2-2': {
      // 통합 목표 진술: 성취기준의 핵심 기능·개념 통합
      const allFunctions = [...new Set(standards.flatMap(s => s.functions ?? []))].filter(Boolean)
      const allConcepts  = [...new Set(standards.flatMap(s => s.concepts  ?? []))].filter(Boolean)

      return `## 🎯 온톨로지 기반 통합 목표 보조 참고 (A-2-2)

⚠️ **최우선 근거는 "이전 활동 산출물" 섹션의 A-2-1 산출물**. 아래는 채팅 키워드 기반 ontology 검색 결과(보조 참고용)이며, A-2-1에서 팀이 선택한 성취기준과 다를 수 있다.
⚠️ 이전 활동 산출물(A-2-1) 브리핑·인용 요청에는 절대 아래 키워드 기반 후보를 사용하지 말 것. A-2-1 산출물의 실제 성취기준 코드와 핵심아이디어를 그대로 인용하라.

키워드 매칭 성취기준 후보(채팅 키워드 기반, 보조):
${formatStandards(standards)}

통합 목표 작성에 활용할 후보 요소(보조):
• 통합 가능 기능 후보: ${allFunctions.join(', ') || '(성취기준 원문에서 동사구 추출 필요)'}
• 통합 가능 개념 후보: ${allConcepts.join(', ') || '(성취기준 원문에서 명사구 추출 필요)'}

▶ "~을 이해하고 ~할 수 있다" ABCD 목표 형식으로 통합하세요.
▶ A-2-1에서 합의된 모든 교과의 성취기준이 포함되어야 융합 수업으로 인정됩니다.`
    }

    case 'A-2-3': {
      // 학습자 분석: 성취기준 기반 예상 난이도 정보
      const complexStandards = standards.filter(
        s => s.text.length > 40 || (s.keywords ?? []).length >= 3
      )
      return `## 👥 온톨로지 기반 학습자 분석 참고 (A-2-3)

확정된 성취기준 (난이도 분석 기준):
${formatStandards(standards)}

주의 깊게 볼 성취기준 (복잡도 높음):
${complexStandards.slice(0, 3).map(s => `• ${s.code} ${s.text}`).join('\n') || '(없음)'}

▶ 위 성취기준들을 학생들이 달성하는 데 필요한 선수지식을 교사들이 공유하도록 안내하세요.
▶ 기능요소(${[...new Set(standards.flatMap(s => s.functions ?? []))].join(', ') || '원문 확인'})의 학생 수행 가능 여부를 점검하세요.`
    }

    default: {
      // Ds 단계: 확정된 성취기준 가드레일
      return `## 🛡️ 온톨로지 가드레일 (설계 단계)

수업 설계 기반 성취기준:
${formatStandards(standards)}

▶ 모든 학습 활동과 평가는 위 성취기준의 기능·개념·역량과 연결되어야 합니다.
▶ 성취기준에 없는 내용을 핵심 활동으로 삼을 경우 근거를 명시하세요.`
    }
  }
}

// ─── 메인 함수 ───────────────────────────────────────────────────────────────

/**
 * 지식 그래프 저장 데이터로 A-2-1 컨텍스트를 생성합니다.
 * 그래프에서 선택한 성취기준을 그대로 내용·기능요소 분석의 기초 자료로 사용합니다.
 */
function buildGraphBasedA21Context(graphData: GraphSavedData, gradeGroup = ''): string {
  if (gradeGroup && !isElementaryGradeGroup(gradeGroup)) {
    return `## 학교급 교육과정 데이터 안내

현재 저장된 지식 그래프는 초등학교 전용이므로 ${gradeGroup} 프로젝트에 주입하지 않습니다.
초등 자료로 대체하거나 성취기준을 추정하지 말고, 교사가 제공한 해당 학교급 성취기준·내용 요소만 사용하세요.`
  }

  const graph = loadGraph()
  const scoped = gradeGroup
    ? filterGraphToGradeBand(graphData, gradeGroup, graph?.achievementStandards ?? [])
    : graphData
  const { centerNode, selectedStandards, agentNotes } = scoped
  if (!centerNode && selectedStandards.length === 0) return ''

  const noteMap = new Map(agentNotes.map(n => [n.standardId, n]))

  // 서버에서 그래프 로드하여 핵심아이디어 데이터 주입
  const subjectNameMap = new Map(graph?.subjects.map(s => [s.id, s.name_ko]) ?? [])

  // ─── 성취기준 → 핵심아이디어 → 내용체계(지식이해/과정기능) 확정 매핑 ───
  // AI가 선택하는 것이 아니라 코드에서 미리 매핑한 확정 데이터를 전달.
  const allStdIds = [centerNode?.id, ...selectedStandards.map(s => s.id)].filter(Boolean) as string[]
  const subjectIdSet = new Set([centerNode?.subjectId, ...selectedStandards.map(s => s.subjectId)].filter(Boolean) as string[])

  const csRecords = loadContentSystemsForGradeGroup(gradeGroup)

  function getContentSystemForArea(subjectId: string, area: string) {
    const subjName = subjectNameMap.get(subjectId) ?? ''
    // 퍼지 매칭: 교과명 + 영역명
    const match = csRecords.find(r =>
      !isSelectionCurriculum(r.curriculum) &&
      (r.subject.includes(subjName) || subjName.includes(r.subject)) &&
      curriculumTextMatches(r.area, area)
    )
    if (match) return {
      knowledgeUnderstanding: filterContentByGrade(match.knowledge, gradeGroup),
      processFunction: filterContentByGrade(match.functions, gradeGroup),
      valueAttitude: filterContentByGrade(match.attitudes, gradeGroup),
    }
    // 특수 매핑
    const specialMap: Record<string, string> = { '역사 일반': '역사', '사회·문화': '사회와 문화', '법': '법과 사회', '한국사': '한국사1' }
    const mappedArea = specialMap[area]
    if (mappedArea) {
      const m2 = csRecords.find(r =>
        !isSelectionCurriculum(r.curriculum) &&
        (r.subject.includes(subjName) || subjName.includes(r.subject)) &&
        r.area === mappedArea
      )
      if (m2) return {
        knowledgeUnderstanding: filterContentByGrade(m2.knowledge, gradeGroup),
        processFunction: filterContentByGrade(m2.functions, gradeGroup),
        valueAttitude: filterContentByGrade(m2.attitudes, gradeGroup),
      }
    }
    return { knowledgeUnderstanding: [] as string[], processFunction: [] as string[], valueAttitude: [] as string[] }
  }

  // 교과별 확정 매핑 표 생성
  const confirmedMappings: string[] = []
  for (const subjectId of subjectIdSet) {
    if (!graph) break
    const subjName = subjectNameMap.get(subjectId) ?? subjectId
    const isCenterSubj = subjectId === centerNode?.subjectId

    // 이 교과의 성취기준들
    const subjectStds = allStdIds
      .map(id => graph.achievementStandards.find(s => s.id === id))
      .filter(s => s && s.subject_id === subjectId) as Array<{ id: string; code: string; text: string; core_idea_id?: string; area: string; knowledge?: string[]; functions?: string[]; competencies?: string[] }>

    if (subjectStds.length === 0) continue

    // 핵심아이디어: core_idea_id로 그래프에서 조회
    const coreIdeaId = subjectStds[0].core_idea_id
    const coreIdeaObj = coreIdeaId ? graph.coreIdeas.find(ci => ci.id === coreIdeaId) : null
    // 그래프 ideas[]에는 '[별표 …]'·어휘 목록 같은 PDF 추출 잡음이 섞여 있어,
    // 완전한 핵심아이디어 문장만 후보로 삼는다(잡음이 선택되면 내용체계 매칭 실패 → 공란).
    const rawCoreIdeas = coreIdeaObj?.ideas ?? []
    const usableCoreIdeas = rawCoreIdeas.filter(isUsableCoreIdea)
    const coreIdeaTexts = usableCoreIdeas.length > 0 ? usableCoreIdeas : rawCoreIdeas
    const coreIdeaText = coreIdeaTexts[0] || '(핵심아이디어 미매핑 — 교사가 직접 선택 필요)'

    // 내용체계에서 지식이해/과정기능 원문 조회
    const area = subjectStds[0].area
    const cs = getContentSystemForArea(subjectId, area)
    const sameAreaStandards = (graph.achievementStandards ?? [])
      .filter(s =>
        s.subject_id === subjectId &&
        curriculumTextMatches(s.area, area) &&
        (!gradeGroup || (s.grade_band ?? '').includes(gradeGroup.replace(/^초/, '').replace(/~/g, '-')))
      )
      .sort((a, b) => a.code.localeCompare(b.code))
    const currentIndex = sameAreaStandards.findIndex(s => subjectStds.some(std => std.id === s.id || std.code === s.code))
    const alignedKnowledge = currentIndex >= 0 && cs.knowledgeUnderstanding.length === sameAreaStandards.length
      ? [cs.knowledgeUnderstanding[currentIndex]].filter(Boolean)
      : cs.knowledgeUnderstanding
    const alignedFunctions = currentIndex >= 0 && cs.processFunction.length === sameAreaStandards.length
      ? [cs.processFunction[currentIndex]].filter(Boolean)
      : cs.processFunction
    const alignedAttitudes = currentIndex >= 0 && cs.valueAttitude.length === sameAreaStandards.length
      ? [cs.valueAttitude[currentIndex]].filter(Boolean)
      : cs.valueAttitude

    const knowledgeItems = alignedKnowledge.slice(0, 8)
    const functionItems = alignedFunctions.slice(0, 6)
    const attitudeItems = alignedAttitudes.slice(0, 5)
    const coreIdeaForStandard = selectDbCoreIdea(coreIdeaTexts, [
      subjectStds.map(std => std.text).join(' '),
      knowledgeItems.join(' '),
      functionItems.join(' '),
      area,
    ].join(' '))

    confirmedMappings.push(
      `${isCenterSubj ? '★ ' : ''}[${subjName} · ${area}] 성취기준: ${subjectStds.map(s => s.code).join(', ')}
  ✅ 핵심 아이디어: ${coreIdeaForStandard || coreIdeaText}${coreIdeaTexts.length > 1 ? `\n     (DB 후보: ${coreIdeaTexts.join(' / ')})` : ''}
  ✅ 지식·이해: ${knowledgeItems.join(', ') || '(데이터 없음)'}
  ✅ 과정·기능: ${functionItems.join(', ') || '(데이터 없음)'}
  ✅ 가치·태도: ${attitudeItems.join(', ') || '(데이터 없음)'}`
    )
  }

  // 최신 A-3 분석표의 교육과정 원문 열을 미리 완성 (AI가 만드는 것이 아님)
  const prebuiltTableRows: string[] = []
  for (const mapping of confirmedMappings) {
    // 매핑 텍스트에서 교과명, 성취기준, 핵심아이디어와 세 차원 추출
    const subjMatch = mapping.match(/\[(.+?)\s*·/)
    const standardMatch = mapping.match(/성취기준:\s*(.+?)(?:\n|$)/)
    const coreMatch = mapping.match(/✅ 핵심 아이디어: (.+?)(?:\n|$)/)
    const knMatch = mapping.match(/✅ 지식·이해: (.+?)(?:\n|$)/)
    const fnMatch = mapping.match(/✅ 과정·기능: (.+?)(?:\n|$)/)
    const attitudeMatch = mapping.match(/✅ 가치·태도: (.+?)(?:\n|$)/)
    if (subjMatch && coreMatch) {
      prebuiltTableRows.push(`| ${subjMatch[1].replace('★ ', '')} | ${standardMatch?.[1]?.trim() || '-'} | ${coreMatch[1].trim()} | ${knMatch?.[1]?.trim() || '-'} | ${fnMatch?.[1]?.trim() || '-'} | ${attitudeMatch?.[1]?.trim() || '-'} | (팀 협의) |`)
    }
  }
  const prebuiltTable = prebuiltTableRows.length > 0
    ? `| 교과 | 성취기준 | 핵심 아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 공통·고유 기여 |\n| --- | --- | --- | --- | --- | --- | --- |\n${prebuiltTableRows.join('\n')}`
    : ''

  const coreIdeasSection = confirmedMappings.length > 0
    ? `\n## 📌 교과별 핵심아이디어 확정 매핑 (교육과정 데이터에서 성취기준 코드로 직접 조회한 확정 결과)

⛔⛔⛔ **아래 데이터는 교육과정에서 코드 레벨로 자동 추출한 확정 문구입니다. AI가 생성한 것이 아닙니다.**
- "핵심아이디어" = 2022 개정 교육과정의 고유 항목. "수업의 핵심적인 아이디어"가 아님.
- AI는 핵심아이디어를 **절대 자체 생성·요약·의역하지 마세요**. 아래 원문을 **한 글자도 바꾸지 않고** 사용.
- 지식이해·과정기능도 아래 원문 그대로 사용.

${confirmedMappings.join('\n\n')}

### 📋 사전 구축된 분석표 (아래 표를 Step 1에서 그대로 출력하세요 — 셀 값 변경 금지)
${prebuiltTable}

⛔ 검증 규칙: AI가 출력한 표의 "핵심아이디어" 열 값이 위 표와 한 글자라도 다르면 오답입니다.`
    : ''

  const centerSection = centerNode
    ? `★ 중심 성취기준: ${centerNode.label} — ${centerNode.text}`
    : ''

  const connectedLines = selectedStandards
    .filter(s => s.id !== centerNode?.id)
    .map(s => {
      const note = noteMap.get(s.id)
      const normalizedRelation = normalizeGraphRelationType(s.relationType)
      const rel = normalizedRelation ? ` (${normalizedRelation})` : ''
      const score = s.score ? ` ${s.score}%` : ''
      let line = `• ${s.label}${rel}${score} — ${s.text}`
      if (note?.explanation) line += `\n  ↳ Agent 분석: ${note.explanation}`
      if (note?.teachingNote) line += `\n  ↳ 수업 제안: ${note.teachingNote}`
      return line
    })
    .join('\n')

  return `## 🗺️ 지식 그래프 기반 성취기준 (A-2-1 핵심아이디어 및 성취기준 분석 기초 자료)

${centerSection}

교과 간 연결 성취기준:
${connectedLines || '(선택된 연결 성취기준 없음)'}
${coreIdeasSection}

▶ 분석표 출력 지시 (반드시 준수):
1. 주제의 상세 내용 분석표: **7열** (교과 | 성취기준 | 핵심 아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 공통·고유 기여)
   - 핵심 아이디어: 위 [교과별 핵심아이디어 후보] 또는 [내용체계]에서 **원문 그대로** 인용
   - 지식·이해: 위 성취기준별 "→ 지식·이해" 또는 [내용체계]의 '지식⋅이해'에서 **원문 그대로** 인용
   - 과정·기능: 위 성취기준별 "→ 과정·기능" 또는 [내용체계]의 '과정⋅기능'에서 **원문 그대로** 인용
   - 가치·태도: 위 성취기준별 "→ 가치·태도" 또는 [내용체계]의 '가치⋅태도'에서 **원문 그대로** 인용
   ⚠️ AI가 자체적으로 만들어내는 것 금지. 반드시 위 데이터 인용.
2. 교과별 요소를 **공통 요소와 교과 고유 요소**로 묶어 별도 정리하고, 이를 바탕으로 **재구성 성취기준** 후보를 제시
▶ 중심 성취기준 [${centerNode?.label ?? '미설정'}]이 이 통합 수업의 핵심축입니다. 이 성취기준의 요소를 가장 풍부하게 작성하세요.`
}

/**
 * 성취기준 검색: KG + JSON 교육과정 병합 (KG에 없는 성취기준을 JSON에서 보완).
 * KG 결과 우선 + JSON에서 신규 코드만 추가(중복 제거) — 학년군 하나 기준.
 */
function searchMergedStandards(keywords: string[], gradeGroup: string, topK: number): CurriculumStandard[] {
  const kgResults = searchStandards(keywords, gradeGroup, topK, 5)
  const jsonResults = searchJsonStandards(keywords, gradeGroup, topK, 3)
  const seenCodes = new Set(kgResults.map(item => item.code))
  const merged = [...kgResults]
  for (const item of jsonResults) {
    if (!seenCodes.has(item.code)) {
      seenCodes.add(item.code)
      merged.push(item)
    }
  }
  return merged.slice(0, topK)
}

/** 여러 학년군 컨텍스트 총 길이 상한 — 학년군 수만큼 늘어나므로 프롬프트 폭주를 막는다. */
const MULTI_BAND_CONTEXT_LIMIT = 24_000

/** 시트에 없는 성취기준 대체 요청을 위한 최근 교사 발언 기반 후보. 초등 학년군마다 최대 5개. */
export function buildReplacementStandardsContext(
  messages: Array<{ role: string; content: string }>,
  gradeGroup: string,
  teamGradeBands?: readonly (string | null | undefined)[] | null,
): string {
  const recent = messages
    .filter(message => message.role === 'user' && !message.content.startsWith('[시스템 리마인더]'))
    .slice(-3)
    .map(message => ({ ...message, content: message.content.replace(/^\[[^\]]+\]:\s*/, '') }))
  if (!recent.some(message => /바꿔|바꾸|대신|고쳐|수정|교체|추가|넣어/.test(message.content))) return ''
  const bands = normalizeTeamGradeBands(teamGradeBands)
  const allowedBands = bands.length ? bands : normalizeTeamGradeBands([gradeGroup])
  if (!allowedBands.length) return ''
  const keywords = extractKeywords(recent)
  if (!keywords.length) return ''
  const blocks = allowedBands.map(band => {
    const code = toGradeGroupCode(band)
    const found = new Map<string, CurriculumStandard>()
    for (const standard of searchMergedStandards(keywords, code, 10)) {
      if (standard.grade_band !== code) continue
      const key = standard.code.replace(/^\[|\]$/g, '')
      if (!found.has(key)) found.set(key, standard)
    }
    const candidates = [...found.values()].slice(0, 5)
    return `### ${band}\n${candidates.map(standard => `${standard.code} — ${standard.text}`).join('\n') || '(대체 후보 없음 — 확인 필요)'}`
  })
  return `\n\n## 대체 후보 성취기준 (최근 사용자 요청 기반, 학년군별 최대 5개)\n${blocks.join('\n\n')}\n▶ 대체 요청 시 해당 학년군의 이 후보에서만 고르고, 후보가 없으면 확인 필요로 안내한다. 성취기준 코드·원문을 지어내지 않는다.`
}

/**
 * 여러 학년군 팀(1·3·5학년 담임 등)의 교육과정 컨텍스트.
 *
 * 기존 단일 학년군 빌더를 **학년군마다 한 번씩** 돌려 블록으로 이어 붙인다. 학년군을 섞어
 * 한 번에 검색하면 1-2학년군 교사에게 3-4학년군 성취기준이 제시되는 오염이 생기므로,
 * 블록 머리에 학년군을 명시하고 각 블록 안에서만 인용하도록 지시한다.
 * 학년군 공통인 핵심아이디어는 중복 문장을 표시로 바꿔 길이를 줄이고, 총 길이를 상한으로 자른다.
 */
function buildMultiBandCurriculumContext(
  activityCode: ActivityCode,
  messages: Array<{ role: string; content: string }>,
  bands: string[],
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>,
  graphSavedData?: GraphSavedData | null,
  targetSubjects: string[] = [],
): string {
  const keywords = extractKeywords(messages, confirmedArtifacts)
  // 학년군 수만큼 블록이 생기므로 학년군별 검색 폭은 좁힌다(단일 학년군 경로는 그대로).
  const topK = activityCode === 'A-2-1' ? 10 : 8

  const blocks: string[] = []
  for (const band of bands) {
    const parts: string[] = []
    // 기존 빌더들은 프로젝트 학년그룹 코드('초1-2')를 기대한다 — 라벨을 그대로 넘기면
    // graphReader의 포함 비교가 0건을 내므로 반드시 변환해서 넘긴다.
    const gradeGroupCode = toGradeGroupCode(band)

    if (activityCode === 'A-2-1' && graphSavedData) {
      const graphContext = buildGraphBasedA21Context(graphSavedData, gradeGroupCode)
      if (graphContext) parts.push(graphContext)
    }
    if (parts.length === 0 && keywords.length > 0) {
      const standards = searchMergedStandards(keywords, gradeGroupCode, topK)
      if (standards.length > 0) parts.push(buildActivityContext(activityCode, standards, keywords))
    }
    if (keywords.length > 0 && isContentSystemContextEnabled()) {
      const contentSystemContext = buildContentSystemContext(activityCode, keywords, gradeGroupCode, includeTeamSubjects(targetSubjects, [band]))
      if (contentSystemContext) parts.push(contentSystemContext)
    }

    const missing = subjectsMissingInGradeBand(targetSubjects, band)
    const availability = `개설 교과: ${subjectsForGradeBand(band).join('·')}`
      + (missing.length > 0 ? ` / 이 학년군에 없는 팀 교과: ${missing.join('·')}` : '')

    if (parts.length === 0) {
      blocks.push(`### ${band} 교육과정 근거\n${availability}\n(이 학년군에서 매칭된 교육과정 데이터를 찾지 못했습니다. 이 학년군의 성취기준을 추정해 만들지 말고 교사에게 확인하거나 분석시트를 사용하세요.)`)
      continue
    }
    blocks.push(`### ${band} 교육과정 근거\n${availability}\n${parts.join('\n')}`)
  }

  if (blocks.length === 0) return ''

  const header = `## 여러 학년군 팀의 교육과정 근거 (학년군별 분리 제공)

팀 학년군: ${formatGradeBandList(bands)}
⚠️ 아래 블록은 **학년군별로 따로** 조회한 결과다. 한 학년군 블록의 성취기준·내용 요소를 다른 학년군에 옮겨 쓰지 말 것.
⚠️ 표·목록을 만들 때 학년군을 드러내고, 학년군마다 해당 블록의 자료만 인용할 것.
⚠️ 블록이 비어 있는 학년군은 "데이터 없음"으로 안내하고 성취기준을 지어내지 말 것.`

  // Allocate space per band so a long low-grade block cannot cut off the high-grade team.
  const blockLimit = Math.floor((MULTI_BAND_CONTEXT_LIMIT - header.length - 600) / blocks.length)
  return dedupeCoreIdeaLines(`\n\n---\n${header}\n\n${blocks.map(block => capContextLength(block, blockLimit)).join('\n\n')}`)
}

/**
 * 교육과정 온톨로지 컨텍스트를 생성합니다.
 * system prompt 마지막에 주입됩니다.
 *
 * @returns 주입할 컨텍스트 문자열 (없으면 빈 문자열)
 */
export function buildCurriculumContext(
  activityCode: ActivityCode,
  messages: Array<{ role: string; content: string }>,
  gradeGroup: string,
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>,
  graphSavedData?: GraphSavedData | null,
  targetSubjects: string[] = [],
  teamGradeBands?: readonly (string | null | undefined)[] | null,
): string {
  // 활성화된 활동인지 확인
  if (!ONTOLOGY_ENABLED_ACTIVITIES.includes(activityCode)) return ''
  const replacementContext = activityCode === 'A-2-1'
    ? buildReplacementStandardsContext(messages, gradeGroup, teamGradeBands)
    : ''

  // 여러 학년군 팀: 학년군마다 컨텍스트를 따로 만든다(한 학년군 팀은 아래 기존 경로 그대로).
  const teamBands = normalizeTeamGradeBands(teamGradeBands)
  if (teamBands.length >= 2) {
    return buildMultiBandCurriculumContext(
      activityCode,
      messages,
      teamBands,
      confirmedArtifacts,
      graphSavedData,
      targetSubjects,
    ) + replacementContext
  }
  if (teamBands.length === 1) gradeGroup = toGradeGroupCode(teamBands[0])

  // A-2-1: 지식 그래프 저장 데이터 우선 사용
  if (activityCode === 'A-2-1' && graphSavedData) {
    const ctx = buildGraphBasedA21Context(graphSavedData, gradeGroup)
    if (ctx) {
      const contentSystemContext = isContentSystemContextEnabled()
        ? buildContentSystemContext(
            activityCode,
            extractKeywords(messages, confirmedArtifacts),
            gradeGroup,
            targetSubjects,
          )
        : ''
      return '\n\n---\n' + ctx + contentSystemContext + replacementContext
    }
  }

  // 키워드 추출
  const keywords = extractKeywords(messages, confirmedArtifacts)
  if (keywords.length === 0) return replacementContext

  // 성취기준 검색: KG + JSON 교육과정 병합 (KG에 없는 성취기준을 JSON에서 보완)
  const standards = searchMergedStandards(keywords, gradeGroup, activityCode === 'A-2-1' ? 20 : 12)
  if (standards.length === 0) return replacementContext

  // 활동별 컨텍스트 블록 생성
  return '\n\n---\n'
    + buildActivityContext(activityCode, standards, keywords)
    + buildContentSystemContext(activityCode, keywords, gradeGroup, targetSubjects)
    + replacementContext
}

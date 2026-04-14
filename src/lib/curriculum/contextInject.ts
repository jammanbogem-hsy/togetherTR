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
  CurriculumStandard,
} from './graphReader'
import { searchJsonStandards } from './curriculumJsonReader'

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
      const fn  = (std.functions ?? []).length > 0 ? ` | 기능: ${std.functions.join(', ')}` : ''
      const con = (std.concepts  ?? []).length > 0 ? ` | 개념: ${std.concepts.join(', ')}` : ''
      lines.push(`  ${std.code} [${std.grade_band}학년군] ${std.text}${kws}${fn}${con}`)
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

      return `## 🎯 온톨로지 기반 통합 목표 수립 근거 (A-2-2)

관련 성취기준:
${formatStandards(standards)}

통합 목표 작성에 활용할 요소:
• 통합 가능 기능: ${allFunctions.join(', ') || '(성취기준 원문에서 동사구 추출 필요)'}
• 통합 가능 개념: ${allConcepts.join(', ') || '(성취기준 원문에서 명사구 추출 필요)'}

▶ "~을 이해하고 ~할 수 있다" ABCD 목표 형식으로 통합하세요.
▶ 모든 교과의 성취기준이 포함되어야 융합 수업으로 인정됩니다.`
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
function buildGraphBasedA21Context(graphData: GraphSavedData): string {
  const { centerNode, selectedStandards, agentNotes } = graphData
  if (!centerNode && selectedStandards.length === 0) return ''

  const noteMap = new Map(agentNotes.map(n => [n.standardId, n]))

  // 서버에서 그래프 로드하여 핵심아이디어 데이터 주입
  const graph = loadGraph()
  const subjectNameMap = new Map(graph?.subjects.map(s => [s.id, s.name_ko]) ?? [])
  const stdCoreIdeaIdMap = new Map(
    (graph?.achievementStandards ?? [])
      .filter(s => s.core_idea_id)
      .map(s => [s.id, s.core_idea_id!])
  )

  // 교과별 핵심아이디어 후보 수집
  const allStdIds = [centerNode?.id, ...selectedStandards.map(s => s.id)].filter(Boolean) as string[]
  const subjectIdSet = new Set([centerNode?.subjectId, ...selectedStandards.map(s => s.subjectId)].filter(Boolean) as string[])
  const subjectCoreIdeasText: string[] = []

  for (const subjectId of subjectIdSet) {
    if (!graph) break
    const stdId = allStdIds.find(id => {
      const std = graph.achievementStandards.find(s => s.id === id)
      return std?.subject_id === subjectId
    })
    const coreIdeaId = stdId ? stdCoreIdeaIdMap.get(stdId) : undefined
    const subjectIdeas = graph.coreIdeas.filter(ci => ci.subject_id === subjectId)
    const relevantIdeas = coreIdeaId
      ? subjectIdeas.filter(ci => ci.id === coreIdeaId)
      : subjectIdeas.slice(0, 2) // 최대 2개 영역만

    const ideas = relevantIdeas.flatMap(ci => ci.ideas)
    if (ideas.length > 0) {
      const subjName = subjectNameMap.get(subjectId) ?? subjectId
      const isCenterSubj = subjectId === centerNode?.subjectId
      subjectCoreIdeasText.push(
        `${isCenterSubj ? '★ ' : ''}[${subjName} 핵심아이디어 후보]\n${ideas.map((idea, i) => `  ${i + 1}. ${idea}`).join('\n')}`
      )
    }
  }

  const coreIdeasSection = subjectCoreIdeasText.length > 0
    ? `\n## 교과별 핵심아이디어 후보 (이 중에서 연관 성취기준과 가장 밀접한 것을 선정하여 분석표에 반영하세요)\n${subjectCoreIdeasText.join('\n\n')}`
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
1. 성취기준 분석표: 7열 — 성취기준 내용(원문) 열 없음 (교과 | 성취기준 코드 | 핵심아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 비고)
   - 핵심아이디어 열: 해당 교과의 선정된 핵심아이디어 원문 기입 (같은 교과의 여러 성취기준 행은 동일한 핵심아이디어 반복)
   - 중심 성취기준 행: 코드 앞에 ★ 표시, 비고란에 "중심" 기입
   - 지식·이해: 학생이 알아야 할 핵심 개념·원리, 명사구로 2-3항목 (지필 평가 기준 수준)
   - 과정·기능: "~하기" 형식 수행 동사 2-3개 (수행평가 행동 지표 수준)
   - 가치·태도: 형성 기대 정의적 요소 1-2항목 (루브릭 태도 기준 수준)
2. 교과 간 융합 분석: 공통 핵심 개념 / 공통 수행 기능 / 루브릭 연계 핵심 지표 2~3개
▶ 중심 성취기준 [${centerNode?.label ?? '미설정'}]이 이 통합 수업의 핵심축입니다. 이 성취기준의 요소를 가장 풍부하게 작성하세요.`
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
): string {
  // 활성화된 활동인지 확인
  if (!ONTOLOGY_ENABLED_ACTIVITIES.includes(activityCode)) return ''

  // A-2-1: 지식 그래프 저장 데이터 우선 사용
  if (activityCode === 'A-2-1' && graphSavedData) {
    const ctx = buildGraphBasedA21Context(graphSavedData)
    if (ctx) return '\n\n---\n' + ctx
  }

  // 키워드 추출
  const keywords = extractKeywords(messages, confirmedArtifacts)
  if (keywords.length === 0) return ''

  // 성취기준 검색: KG + JSON 교육과정 병합 (KG에 없는 성취기준을 JSON에서 보완)
  const topK = activityCode === 'A-2-1' ? 20 : 12
  const kgResults = searchStandards(keywords, gradeGroup, topK, 5)
  const jsonResults = searchJsonStandards(keywords, gradeGroup, topK, 3)

  // KG 결과 우선 + JSON에서 신규 코드만 추가 (중복 제거)
  const seenCodes = new Set(kgResults.map(s => s.code))
  const merged = [...kgResults]
  for (const s of jsonResults) {
    if (!seenCodes.has(s.code)) {
      seenCodes.add(s.code)
      merged.push(s)
    }
  }
  const standards = merged.slice(0, topK)
  if (standards.length === 0) return ''

  // 활동별 컨텍스트 블록 생성
  return '\n\n---\n' + buildActivityContext(activityCode, standards, keywords)
}

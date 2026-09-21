/**
 * Jev(TypeSafe System One) 판단 패킷 라우트 — /dev/curriculum-map 비교 검증용.
 *
 * 기존 /api/curriculum-sheet/autofill 은 OpenAI 임베딩 유사도로 핵심아이디어·성취기준을
 * 고른다. 이 라우트는 같은 입력(주제·학년군·교과)을 Jev 한 번의 fan-out 호출로 판정해
 * 영역 Choice · 핵심아이디어 Choice · 성취기준별 Score · 정보충분성 Score · 융합 Noul 을
 * 확률/confidence 와 함께 돌려준다. 교과마다 1회 호출, 교과 간 병렬.
 *
 * 그래프 조회 헬퍼는 autofill 라우트의 것과 같은 규칙을 최소 복제했다
 * (route.ts 는 핸들러 외 export 가 제한되어 공유 불가).
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph, type CurriculumStandard, type KnowledgeGraph } from '@/lib/curriculum/graphReader'
import { gradeBandNeedle, isUsableCoreIdea } from '@/lib/curriculum/curriculumFilters'
import { canonicalSubjectName, graphSubjectIdsForSubject } from '@/lib/curriculum/subjectAliases'
import {
  concentrationConfidence,
  isJevConfigured,
  rankedProbabilities,
  systemOne,
  type JevChoiceAnswer,
  type JevNoulAnswer,
  type JevQuestion,
  type JevScoreAnswer,
} from '@/lib/curriculum/jev'

export const maxDuration = 60

// autofill 라우트와 같은 교과 목록. 통합교과는 지식 그래프 이름이
// '바른 생활·슬기로운 생활·즐거운 생활'이라 별칭 표(subjectAliases)로만 해소된다.
const SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과', '통합교과'] as const

/** 설계안의 3단계 게이트: confidence 로 대화 목표를 코드가 정한다. */
const MODE_THRESHOLDS = { present: 0.8, confirm: 0.5 } as const
type Mode = '제시' | '확인' | '명료화'

const STANDARD_LEVELS = [
  '무관 — 이 수업 주제와 연결점이 없다',
  '약함 — 주제와 부분적으로만 닿아 있어 보조 활동에서나 다룰 수 있다',
  '관련 — 주제의 한 축을 직접 다룬다',
  '핵심 — 이 주제 수업의 중심 성취기준이 될 수 있다',
]

const SUFFICIENCY_LEVELS = [
  '부족 — 주제만 있어 여러 성취기준이 비슷하게 가능하다',
  '보통 — 방향은 보이지만 차시·활동 정보가 있으면 더 좁힐 수 있다',
  '충분 — 성취기준 하나를 특정할 수 있다',
]

interface RequestBody {
  topic?: string
  gradeGroup?: string
  subjects?: string[]
  center?: string
  chatContext?: string
}

interface CoreIdeaCandidate {
  key: string
  idea: string
  /** 같은 문장이 그래프의 여러 핵심아이디어 노드(영역)에 중복 수록된 경우 모두 기록. */
  memberships: Array<{ coreIdeaId: string; area: string }>
}

interface JevSubjectResult {
  subject: string
  isCenter: boolean
  error?: string
  elapsedMs: number
  usage: { input_tokens: number; output_tokens: number }
  questionCount: number
  area: {
    choice: string
    confidence: number
    ranked: Array<{ area: string; probability: number }>
  }
  coreIdea: {
    confidence: number
    /** 1위 − 2위 확률 차. 옵션이 많아 confidence 가 낮게 나올 때 보조 지표. */
    margin: number
    /** 1위 영역 안의 문장만 재정규화해 다시 잰 집중도. */
    withinTopAreaConfidence: number
    mode: Mode
    ranked: Array<{ coreIdeaId: string; area: string; areas: string[]; idea: string; probability: number }>
  }
  standards: Array<{
    code: string
    text: string
    area: string
    coreIdeaId: string
    score: number
    confidence: number
    level: string
  }>
  sufficiency: { score: number; confidence: number; level: string }
  fusion: number
}

function canonicalSubject(value: string): string {
  const compact = (value ?? '').trim()
  if (!compact) return ''
  const aliased = canonicalSubjectName(compact)
  if (aliased) return aliased
  return SUBJECTS.find(subject => compact.includes(subject) || subject.includes(compact)) ?? compact
}

function getSubjectIds(graph: KnowledgeGraph, subject: string): string[] {
  const canonical = canonicalSubject(subject)
  if (!canonical) return []
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

function standardsForSubject(graph: KnowledgeGraph, subject: string, gradeGroup: string): CurriculumStandard[] {
  const subjectIds = getSubjectIds(graph, subject)
  const needle = gradeBandNeedle(gradeGroup)
  return graph.achievementStandards.filter(std =>
    subjectIds.includes(std.subject_id) &&
    (!needle || (std.grade_band ?? '').includes(needle)) &&
    Boolean(std.core_idea_id),
  )
}

function formatCode(code: string): string {
  const trimmed = code.trim()
  return trimmed.startsWith('[') ? trimmed : `[${trimmed}]`
}

function gradeLabel(gradeGroup: string): string {
  const needle = gradeBandNeedle(gradeGroup)
  return needle ? `초등학교 ${needle}학년군` : gradeGroup
}

function modeFor(confidence: number): Mode {
  if (confidence >= MODE_THRESHOLDS.present) return '제시'
  if (confidence >= MODE_THRESHOLDS.confirm) return '확인'
  return '명료화'
}

function levelLabel(answer: JevScoreAnswer): string {
  const nearest = String(Math.round(answer.score))
  return (answer.legend[nearest] ?? '').split(' — ')[0]
}

async function judgeSubject(params: {
  graph: KnowledgeGraph
  subject: string
  isCenter: boolean
  topic: string
  gradeGroup: string
  chatContext?: string
}): Promise<JevSubjectResult> {
  const { graph, subject, isCenter, topic, gradeGroup, chatContext } = params
  const standards = standardsForSubject(graph, subject, gradeGroup)
  const empty: JevSubjectResult = {
    subject, isCenter, elapsedMs: 0, usage: { input_tokens: 0, output_tokens: 0 }, questionCount: 0,
    area: { choice: '', confidence: 0, ranked: [] },
    coreIdea: { confidence: 0, margin: 0, withinTopAreaConfidence: 0, mode: '명료화', ranked: [] },
    standards: [], sufficiency: { score: 0, confidence: 0, level: '' }, fusion: 0,
  }
  if (standards.length === 0) return { ...empty, error: `${subject} ${gradeGroup} 성취기준이 그래프에 없음` }

  // 그래프의 핵심아이디어 노드(=영역 묶음) → 완전한 문장만 후보로.
  // [2026-09-20] 같은 문장이 두 노드에 중복 수록된 경우(사회 5-6 인문환경 4문장 등)가 있어
  // 문장 단위로 합친다. 따로 두면 Choice 확률이 반으로 갈려 confidence·게이트가 오판된다.
  const coreIdeaIds = [...new Set(standards.map(std => std.core_idea_id!))]
  const candidates: CoreIdeaCandidate[] = []
  const candidateByText = new Map<string, CoreIdeaCandidate>()
  const areas: string[] = []
  for (const coreIdeaId of coreIdeaIds) {
    const node = graph.coreIdeas.find(item => item.id === coreIdeaId)
    if (!node) continue
    if (!areas.includes(node.area)) areas.push(node.area)
    for (const idea of node.ideas) {
      if (!isUsableCoreIdea(idea)) continue
      const text = idea.replace(/\s+/g, ' ').trim()
      let candidate = candidateByText.get(text)
      if (!candidate) {
        candidate = { key: `c${candidates.length}`, idea: text, memberships: [] }
        candidateByText.set(text, candidate)
        candidates.push(candidate)
      }
      if (!candidate.memberships.some(m => m.coreIdeaId === coreIdeaId)) candidate.memberships.push({ coreIdeaId, area: node.area })
    }
  }
  const areasOf = (candidate: CoreIdeaCandidate) => [...new Set(candidate.memberships.map(m => m.area))]
  if (candidates.length === 0) return { ...empty, error: `${subject} 핵심아이디어 후보 없음` }

  const questions: Record<string, JevQuestion> = {}
  questions.area = {
    type: 'choice',
    instructions: `이 수업 주제를 다루기에 가장 적합한 ${subject} 교과의 영역은 무엇인가?`,
    criteria: Object.fromEntries(areas.map((area, index) => {
      const sample = candidates.find(c => c.memberships.some(m => m.area === area))?.idea ?? ''
      return [`a${index}`, `${area} (예: ${sample.slice(0, 60)})`]
    })),
  }
  questions.coreIdea = {
    type: 'choice',
    instructions: `이 수업 주제를 ${subject} 교과에서 다룰 때 가장 적합한 핵심아이디어는 무엇인가?`,
    criteria: Object.fromEntries(candidates.map(c => [c.key, `[${areasOf(c).join(' / ')}] ${c.idea}`])),
  }
  questions.sufficiency = {
    type: 'score',
    instructions: `입력된 정보(주제·맥락)만으로 ${subject} 교과 성취기준 하나를 특정하기에 충분한가?`,
    criteria: SUFFICIENCY_LEVELS,
  }
  questions.fusion = {
    type: 'noul',
    instructions: '이 수업 주제는 두 개 이상의 교과 또는 영역에 걸친 융합 주제인가?',
  }
  // 성취기준별 관련도 — 문서의 speculative fan-out: 질문을 늘려도 응답 시간이 거의 늘지 않는다.
  const standardKeys = new Map<string, CurriculumStandard>()
  standards.forEach((std, index) => {
    const key = `s${index}`
    standardKeys.set(key, std)
    questions[key] = {
      type: 'score',
      instructions: `다음 성취기준이 이 수업 주제와 얼마나 관련 있는가? ${formatCode(std.code)} ${std.text}`,
      criteria: STANDARD_LEVELS,
    }
  })

  const state = {
    학년군: gradeLabel(gradeGroup),
    교과: subject,
    역할: isCenter ? '중심 교과' : '연계 교과',
    수업주제: topic,
    추가맥락: chatContext?.slice(0, 1500) ?? '',
  }

  let response
  try {
    response = await systemOne(state, questions)
  } catch (error) {
    return { ...empty, questionCount: Object.keys(questions).length, error: error instanceof Error ? error.message : String(error) }
  }
  const answers = response.answers

  const areaAnswer = answers.area as JevChoiceAnswer
  const areaRanked = rankedProbabilities(areaAnswer).map(([key, probability]) => ({
    area: areas[Number(key.slice(1))] ?? key,
    probability,
  }))

  const ideaAnswer = answers.coreIdea as JevChoiceAnswer
  const ideaRanked = rankedProbabilities(ideaAnswer).map(([key, probability]) => {
    const candidate = candidates.find(c => c.key === key)
    const candidateAreas = candidate ? areasOf(candidate) : []
    return {
      coreIdeaId: candidate?.memberships[0]?.coreIdeaId ?? '',
      area: candidateAreas.join(' / '),
      areas: candidateAreas,
      idea: candidate?.idea ?? key,
      probability,
    }
  })
  const topArea = ideaRanked[0]?.areas[0] ?? ''
  const withinTopArea = ideaRanked.filter(item => item.areas.includes(topArea)).map(item => item.probability)

  const scoredStandards = [...standardKeys.entries()].map(([key, std]) => {
    const answer = answers[key] as JevScoreAnswer
    return {
      code: formatCode(std.code),
      text: std.text,
      area: std.area,
      coreIdeaId: std.core_idea_id ?? '',
      score: answer.score,
      confidence: answer.confidence,
      level: levelLabel(answer),
    }
  }).sort((a, b) => b.score - a.score)

  const sufficiencyAnswer = answers.sufficiency as JevScoreAnswer
  return {
    subject,
    isCenter,
    elapsedMs: response.elapsedMs,
    usage: response.usage,
    questionCount: Object.keys(questions).length,
    area: { choice: areaRanked[0]?.area ?? '', confidence: areaAnswer.confidence, ranked: areaRanked.slice(0, 3) },
    coreIdea: {
      confidence: ideaAnswer.confidence,
      margin: (ideaRanked[0]?.probability ?? 0) - (ideaRanked[1]?.probability ?? 0),
      withinTopAreaConfidence: concentrationConfidence(withinTopArea),
      mode: modeFor(ideaAnswer.confidence),
      ranked: ideaRanked.slice(0, 5),
    },
    standards: scoredStandards.slice(0, 5),
    sufficiency: { score: sufficiencyAnswer.score, confidence: sufficiencyAnswer.confidence, level: levelLabel(sufficiencyAnswer) },
    fusion: (answers.fusion as JevNoulAnswer).noul,
  }
}

export async function POST(request: NextRequest) {
  if (!isJevConfigured()) {
    return NextResponse.json({ error: 'TYPESAFE_API_KEY가 설정되지 않았습니다.' }, { status: 503 })
  }
  const body = await request.json().catch(() => ({})) as RequestBody
  const topic = (body.topic ?? '').trim()
  const gradeGroup = (body.gradeGroup ?? '').trim()
  if (!topic || !gradeGroup) {
    return NextResponse.json({ error: 'topic 과 gradeGroup 이 필요합니다.' }, { status: 400 })
  }
  const chatContext = body.chatContext?.trim() || undefined
  let subjects = [...new Set((body.subjects ?? []).map(canonicalSubject).filter(Boolean))]
  if (subjects.length === 0) {
    const mention = `${topic} ${chatContext ?? ''}`
    subjects = SUBJECTS.filter(subject => mention.includes(subject))
  }
  if (subjects.length === 0) {
    return NextResponse.json({ error: '교과를 하나 이상 지정하세요.' }, { status: 400 })
  }
  const center = canonicalSubject(body.center ?? '')
  const graph = loadGraph()
  if (!graph) return NextResponse.json({ error: '지식 그래프를 불러올 수 없습니다.' }, { status: 500 })

  const started = performance.now()
  const results = await Promise.all(subjects.map(subject => judgeSubject({
    graph,
    subject,
    isCenter: subject === (subjects.includes(center) ? center : subjects[0]),
    topic,
    gradeGroup,
    chatContext,
  })))
  const usage = results.reduce(
    (sum, item) => ({ input_tokens: sum.input_tokens + item.usage.input_tokens, output_tokens: sum.output_tokens + item.usage.output_tokens }),
    { input_tokens: 0, output_tokens: 0 },
  )
  return NextResponse.json({
    model: 'jev-latest',
    totalMs: Math.round(performance.now() - started),
    usage,
    thresholds: MODE_THRESHOLDS,
    subjects: results,
  })
}

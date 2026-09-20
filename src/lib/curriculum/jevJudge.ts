/**
 * 교육과정 분석 시트용 Jev 판정 함수 모음.
 *
 * 설계 원칙(2026-09-20): "무엇이 맞는지"는 Jev가 확률·confidence로 판정하고,
 * LLM은 확정된 값을 받아 설명만 쓴다. 이 파일은 판정만 담당하며 실패 시 null을
 * 돌려 호출자가 임베딩 경로로 폴백하게 한다.
 *
 * 옵션 키는 ASCII(c0, s0, k0…)로 두고 한글 원문은 설명에만 넣는다
 * (한글 키 허용 여부가 문서에 없음).
 */

import {
  isJevConfigured,
  systemOne,
  type JevChoiceAnswer,
  type JevNoulAnswer,
  type JevQuestion,
  type JevScoreAnswer,
} from '@/lib/curriculum/jev'

export type JudgeMode = '제시' | '확인' | '명료화'

/** 문서 권장 3단계 게이트. 우리 데이터 20건 실측에서 그대로 쓸 만했다(제시 8건 전부 정답). */
export const MODE_THRESHOLDS = { present: 0.8, confirm: 0.5 } as const

export function modeFor(confidence: number): JudgeMode {
  if (confidence >= MODE_THRESHOLDS.present) return '제시'
  if (confidence >= MODE_THRESHOLDS.confirm) return '확인'
  return '명료화'
}

/** 판정 사용 여부: 키가 있고 CURRICULUM_JUDGE 로 임베딩을 강제하지 않았을 때. */
export function jevJudgeEnabled(): boolean {
  if (process.env.CURRICULUM_JUDGE === 'embedding') return false
  return isJevConfigured()
}

export interface JudgeContext {
  subject: string
  isCenter: boolean
  gradeGroup: string
  topic: string
  chatContext?: string
  focus?: string
}

function stateOf(ctx: JudgeContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    학년군: ctx.gradeGroup,
    교과: ctx.subject,
    역할: ctx.isCenter ? '중심 교과' : '연계 교과',
    ...(ctx.focus ? { 교과_초점: ctx.focus } : {}),
    수업주제: ctx.topic,
    추가맥락: ctx.chatContext?.slice(0, 1500) ?? '',
    ...extra,
  }
}

const RELEVANCE_LEVELS = [
  '무관 — 이 수업 주제와 연결점이 없다',
  '약함 — 주제와 부분적으로만 닿아 있어 보조 활동에서나 다룰 수 있다',
  '관련 — 주제의 한 축을 직접 다룬다',
  '핵심 — 이 주제 수업의 중심이 될 수 있다',
]

const ELEMENT_LEVELS = [
  '불필요 — 선택한 성취기준·주제의 수업에서 다루지 않는다',
  '보조 — 있으면 좋지만 없어도 수업이 성립한다',
  '필요 — 이 수업에서 실제로 다루게 되는 요소다',
  '필수 — 선택한 성취기준을 달성하려면 반드시 다루는 요소다',
]

async function callJev(state: Record<string, unknown>, questions: Record<string, JevQuestion>) {
  try {
    return await systemOne(state, questions)
  } catch (error) {
    console.error('[jevJudge]', error)
    return null
  }
}

// ── 핵심아이디어 ────────────────────────────────────────────────────────────

export interface CoreIdeaJudgement {
  /** 옵션 키 → 확률 */
  probabilities: Record<string, number>
  confidence: number
  mode: JudgeMode
  elapsedMs: number
}

export async function judgeCoreIdeas(
  ctx: JudgeContext,
  options: Array<{ key: string; area: string; idea: string }>,
): Promise<CoreIdeaJudgement | null> {
  if (options.length === 0) return null
  if (options.length === 1) {
    return { probabilities: { [options[0].key]: 1 }, confidence: 1, mode: '제시', elapsedMs: 0 }
  }
  const response = await callJev(stateOf(ctx), {
    coreIdea: {
      type: 'choice',
      instructions: `이 수업 주제를 ${ctx.subject} 교과에서 다룰 때 가장 적합한 핵심아이디어는 무엇인가?`,
      criteria: Object.fromEntries(options.map(o => [o.key, `[${o.area}] ${o.idea}`])),
    },
  })
  const answer = response?.answers.coreIdea as JevChoiceAnswer | undefined
  if (!answer || answer.type !== 'choice') return null
  return {
    probabilities: answer.probabilities,
    confidence: answer.confidence,
    mode: modeFor(answer.confidence),
    elapsedMs: response!.elapsedMs,
  }
}

// ── 성취기준 ────────────────────────────────────────────────────────────────

export interface StandardJudgement {
  /** 성취기준 id → 관련도 0~3 (Score 기대값) */
  scores: Record<string, number>
  confidences: Record<string, number>
  elapsedMs: number
}

export async function judgeStandards(
  ctx: JudgeContext,
  coreIdea: { area: string; idea: string },
  standards: Array<{ id: string; code: string; text: string }>,
): Promise<StandardJudgement | null> {
  if (standards.length === 0) return null
  const questions: Record<string, JevQuestion> = {}
  standards.forEach((std, index) => {
    questions[`s${index}`] = {
      type: 'score',
      instructions: `다음 성취기준이 이 수업 주제와 선택한 핵심아이디어를 다루기에 얼마나 관련 있는가? ${std.code} ${std.text}`,
      criteria: RELEVANCE_LEVELS,
    }
  })
  const response = await callJev(stateOf(ctx, { 선택한_핵심아이디어: `[${coreIdea.area}] ${coreIdea.idea}` }), questions)
  if (!response) return null
  const scores: Record<string, number> = {}
  const confidences: Record<string, number> = {}
  standards.forEach((std, index) => {
    const answer = response.answers[`s${index}`] as JevScoreAnswer | undefined
    if (answer?.type === 'score') {
      scores[std.id] = answer.score
      confidences[std.id] = answer.confidence
    }
  })
  return { scores, confidences, elapsedMs: response.elapsedMs }
}

// ── 지식·이해 / 과정·기능 / 가치·태도 ──────────────────────────────────────

export interface ElementJudgement {
  knowledge: Record<string, number>
  functions: Record<string, number>
  attitudes: Record<string, number>
  elapsedMs: number
}

/**
 * 내용체계 요소를 한 번의 fan-out 으로 판정한다. 세 목록을 합쳐도 보통 30개 안팎.
 * 반환 점수는 0~3(불필요~필수). 호출자가 목록별 상위 n개를 고른다.
 */
export async function judgeElements(
  ctx: JudgeContext,
  confirmed: { area: string; idea: string; standard: string },
  lists: { knowledge: string[]; functions: string[]; attitudes: string[] },
): Promise<ElementJudgement | null> {
  const questions: Record<string, JevQuestion> = {}
  const register = (prefix: string, label: string, items: string[]) => {
    items.forEach((item, index) => {
      questions[`${prefix}${index}`] = {
        type: 'score',
        instructions: `다음 ${label} 요소가 선택한 성취기준으로 이 수업을 할 때 얼마나 필요한가? ${item}`,
        criteria: ELEMENT_LEVELS,
      }
    })
  }
  register('k', '지식·이해', lists.knowledge)
  register('f', '과정·기능', lists.functions)
  register('a', '가치·태도', lists.attitudes)
  if (Object.keys(questions).length === 0) return null

  const response = await callJev(stateOf(ctx, {
    선택한_핵심아이디어: `[${confirmed.area}] ${confirmed.idea}`,
    선택한_성취기준: confirmed.standard,
  }), questions)
  if (!response) return null

  const collect = (prefix: string, items: string[]) => {
    const scores: Record<string, number> = {}
    items.forEach((item, index) => {
      const answer = response.answers[`${prefix}${index}`] as JevScoreAnswer | undefined
      if (answer?.type === 'score') scores[item] = answer.score
    })
    return scores
  }
  return {
    knowledge: collect('k', lists.knowledge),
    functions: collect('f', lists.functions),
    attitudes: collect('a', lists.attitudes),
    elapsedMs: response.elapsedMs,
  }
}

/** 점수 사전으로 상위 count개를 고른다. 점수가 없는 항목은 뒤로 보내되 버리지 않는다. */
export function pickTopByScore(items: string[], scores: Record<string, number>, count: number): string[] {
  return items
    .map((text, index) => ({ text, index, score: scores[text] ?? -1 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count)
    .map(item => item.text)
}

// ── LLM 출력 검증 ───────────────────────────────────────────────────────────

export interface DescriptionVerdict {
  /** 교과명 → 0~1 (확정 사실 범위 안에서 쓰였는가) */
  inScope: Record<string, number>
  elapsedMs: number
}

export async function verifyDescriptions(
  topic: string,
  gradeGroup: string,
  rows: Array<{ subject: string; coreIdea: string; standard: string; knowledge: string; processFunction: string; valueAttitude: string }>,
  descriptions: Record<string, string>,
): Promise<DescriptionVerdict | null> {
  const targets = rows.filter(row => descriptions[row.subject])
  if (targets.length === 0) return null
  const questions: Record<string, JevQuestion> = {}
  targets.forEach((row, index) => {
    questions[`d${index}`] = {
      type: 'noul',
      instructions: {
        질문: `${row.subject} 교과의 "수업내용 설명"이 아래 확정된 핵심아이디어·성취기준·내용 요소의 범위 안에서 그 교과의 역할을 설명하고 있는가? 확정되지 않은 다른 성취기준이나 내용을 끌어오면 아니오.`,
        확정_핵심아이디어: row.coreIdea,
        확정_성취기준: row.standard,
        확정_지식이해: row.knowledge,
        확정_과정기능: row.processFunction,
        확정_가치태도: row.valueAttitude,
        수업내용_설명: descriptions[row.subject],
      },
    }
  })
  const response = await callJev({ 학년군: gradeGroup, 수업주제: topic }, questions)
  if (!response) return null
  const inScope: Record<string, number> = {}
  targets.forEach((row, index) => {
    const answer = response.answers[`d${index}`] as JevNoulAnswer | undefined
    if (answer?.type === 'noul') inScope[row.subject] = answer.noul
  })
  return { inScope, elapsedMs: response.elapsedMs }
}

// ── 성취기준 간 관계(지식 그래프·수업 예시) ────────────────────────────────

/** 관계 유형 설명 — ontologyRelation.ts 의 규칙 기반 설명과 같은 뜻으로 맞춘다. */
export const RELATION_TYPE_CRITERIA: Record<string, string> = {
  '의미연결': '두 성취기준이 공통 개념·주제를 중심으로 연결된다',
  '도구-활용': '한 교과의 기능·방법(그래프, 글쓰기 기법, 측정 등)을 다른 교과 탐구의 도구로 쓴다',
  '현상-가치': '한 교과에서 탐구한 현상·사실을 다른 교과에서 가치·윤리 관점으로 성찰한다',
  '내용-표현': '한 교과에서 탐구한 내용을 다른 교과의 활동(그림, 음악, 몸짓, 글)으로 표현한다',
  '개념-적용': '한쪽은 개념 이해, 다른 쪽은 그 개념을 실제 상황에 적용·실천한다',
  '문제-해결': '두 교과가 같은 문제를 서로 다른 방식으로 함께 해결한다',
  '탐구-실천': '탐구 활동의 결과가 생활 속 실천 활동으로 이어진다',
  '원인-결과': '한쪽 내용이 다른 쪽의 원인 또는 결과가 되는 인과 구조다',
}

const RELATION_STRENGTH_LEVELS = [
  '무관 — 두 성취기준을 한 수업에 엮을 근거가 없다',
  '약함 — 억지로 엮을 수는 있지만 자연스럽지 않다',
  '관련 — 한 수업 시퀀스에서 자연스럽게 이어진다',
  '핵심 — 이 주제의 융합 수업을 이 두 성취기준으로 설계하는 것이 가장 자연스럽다',
]

export interface RelationStandard {
  id: string
  code: string
  subjectName: string
  text: string
  coreIdea?: string
}

export interface RelationJudgement {
  byCandidateId: Record<string, {
    relationType: string
    typeConfidence: number
    /** 0~1 (Score 0~3 을 3으로 나눔) */
    strength: number
    strengthConfidence: number
  }>
  elapsedMs: number
}

function standardBlock(std: RelationStandard): Record<string, string> {
  return { 교과: std.subjectName, 코드: std.code, 성취기준: std.text, 핵심아이디어: std.coreIdea ?? '' }
}

/** 후보마다 관계 유형 Choice + 관계 강도 Score 를 한 번의 fan-out 으로 판정한다. */
export async function judgeRelations(
  theme: string,
  center: RelationStandard,
  candidates: RelationStandard[],
  artifactContext?: string,
): Promise<RelationJudgement | null> {
  if (candidates.length === 0) return null
  const typeKeys = Object.keys(RELATION_TYPE_CRITERIA)
  const questions: Record<string, JevQuestion> = {}
  candidates.forEach((cand, index) => {
    const pair = `중심 ${center.code}(${center.subjectName}) ↔ 후보 ${cand.code}(${cand.subjectName}) "${cand.text}"`
    questions[`t${index}`] = {
      type: 'choice',
      instructions: `${pair} — 두 성취기준을 한 융합 수업으로 엮을 때 관계 유형은 무엇인가?`,
      criteria: Object.fromEntries(typeKeys.map((type, k) => [`r${k}`, `${type}: ${RELATION_TYPE_CRITERIA[type]}`])),
    }
    questions[`s${index}`] = {
      type: 'score',
      instructions: `${pair} — 수업 주제를 두고 두 성취기준을 엮는 것이 얼마나 자연스러운가?`,
      criteria: RELATION_STRENGTH_LEVELS,
    }
  })
  const state = {
    수업주제: theme || '(미지정)',
    수업설계맥락: artifactContext?.slice(0, 1500) ?? '',
    중심_성취기준: standardBlock(center),
    후보_성취기준: candidates.map((cand, index) => ({ 번호: index + 1, ...standardBlock(cand) })),
  }
  const response = await callJev(state, questions)
  if (!response) return null
  const byCandidateId: RelationJudgement['byCandidateId'] = {}
  candidates.forEach((cand, index) => {
    const type = response.answers[`t${index}`] as JevChoiceAnswer | undefined
    const strength = response.answers[`s${index}`] as JevScoreAnswer | undefined
    if (type?.type !== 'choice' || strength?.type !== 'score') return
    byCandidateId[cand.id] = {
      relationType: typeKeys[Number(type.choice.slice(1))] ?? typeKeys[0],
      typeConfidence: type.confidence,
      strength: Math.max(0, Math.min(1, strength.score / 3)),
      strengthConfidence: strength.confidence,
    }
  })
  return { byCandidateId, elapsedMs: response.elapsedMs }
}

export interface TeachingNoteVerdict {
  /** 후보 id → 0~1 (수업 제안이 두 성취기준을 실제로 다루는가) */
  byCandidateId: Record<string, number>
  elapsedMs: number
}

/** [4] LLM 이 쓴 수업 제안·아이디어가 확정된 두 성취기준을 실제로 다루는지 검증한다. */
export async function verifyTeachingNotes(
  theme: string,
  center: RelationStandard,
  items: Array<{ candidate: RelationStandard; relationType: string; teachingNote: string; ideas?: string[] }>,
): Promise<TeachingNoteVerdict | null> {
  const targets = items.filter(item => item.teachingNote)
  if (targets.length === 0) return null
  const questions: Record<string, JevQuestion> = {}
  targets.forEach((item, index) => {
    questions[`v${index}`] = {
      type: 'noul',
      instructions: {
        질문: `이 수업 제안이 중심 성취기준 ${center.code}과 후보 성취기준 ${item.candidate.code}을 둘 다 실제 활동으로 다루며, 확정된 관계 유형(${item.relationType})에 맞게 엮고 있는가? 한쪽 성취기준이 이름만 언급되거나 다른 성취기준 내용을 끌어오면 아니오.`,
        중심_성취기준: standardBlock(center),
        후보_성취기준: standardBlock(item.candidate),
        수업_제안: item.teachingNote,
        수업_아이디어: item.ideas ?? [],
      },
    }
  })
  const response = await callJev({ 수업주제: theme || '(미지정)' }, questions)
  if (!response) return null
  const byCandidateId: Record<string, number> = {}
  targets.forEach((item, index) => {
    const answer = response.answers[`v${index}`] as JevNoulAnswer | undefined
    if (answer?.type === 'noul') byCandidateId[item.candidate.id] = answer.noul
  })
  return { byCandidateId, elapsedMs: response.elapsedMs }
}

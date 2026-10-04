// 연수용 모드 — 교사들이 종이·토의로 먼저 만든 결과를 앱에 옮겨 적는 약식 진행.
// 모든 분기는 isTrainingActivity(project, code) 하나를 거친다. 연수용이 아닌 프로젝트는 지금 동작 그대로.
// 칸 분류: A 필수(비면 알림) · B 한 번 묻기(뒤 활동·보고서가 참고, 이유 함께) · C 생략(필요하면 [AI 도움]).
// 섹션 키는 ACTIVITY_META.recommendedSections 의 key 와 같다(산출물 content 키 그대로).
import type { ActivityCode, Project } from '@/types'
import { ACTIVITY_META, displayActivityCode } from '@/types'

export type TrainingFieldTier = 'A' | 'B' | 'C'

export interface TrainingField {
  /** 산출물 content 키(= recommendedSections key) */
  key: string
  /** 화면·프롬프트용 한글 라벨 */
  label: string
  tier: TrainingFieldTier
  /** B 칸: 왜 한 번 묻는지(뒤 활동·보고서가 무엇에 쓰는지) */
  reason?: string
  /** 입력 양식 안내 문구 */
  placeholder?: string
}

export interface TrainingHelpAction {
  /** 버튼 이름 — 채팅에는 '[AI 도움: 버튼이름]' 으로 보낸다 */
  label: string
  /** 버튼 뒤에 붙여 보내는 요청 본문 */
  prompt: string
}

export interface TrainingActivityDef {
  code: ActivityCode
  fields: readonly TrainingField[]
  help: readonly TrainingHelpAction[]
}

/** 핵심 절차 — coreFormal=true 이면 일반 진행 (표시 T-1, T-2, A-2, A-3, A-4) */
export const TRAINING_CORE_ACTIVITIES: readonly ActivityCode[] = ['T-1-1', 'T-1-2', 'A-1-2', 'A-2-1', 'A-2-2']

const f = (key: string, tier: TrainingFieldTier, extra: Partial<TrainingField> = {}): Omit<TrainingField, 'label'> & { label?: string } =>
  ({ key, tier, ...extra })

const RAW: Record<ActivityCode, { fields: Array<ReturnType<typeof f>>; help: TrainingHelpAction[] }> = {
  'T-1-1': {
    fields: [
      f('팀 공통 비전', 'A', { label: '팀 공통 비전 문장', placeholder: '우리 팀이 함께 지향하는 수업을 한 문장으로' }),
      f('개인 비전', 'A', { label: '개인 비전 키워드·정교화 문장' }),
      f('핵심 키워드', 'C', { label: '비전 핵심 키워드 (3~5개)' }),
    ],
    help: [
      { label: '비전 문장 다듬기', prompt: '적은 비전 문장을 더 분명하게 다듬는 표현 2가지만 제안해 주세요.' },
      { label: '키워드 뽑기', prompt: '비전 문장에서 핵심 키워드 3~5개를 뽑아 주세요.' },
    ],
  },
  'T-1-2': {
    fields: [f('설계 방향', 'A', { label: '수업설계 방향 (방향·근거)', placeholder: '"~하려면 ~해야 한다" 형식 3~5개' })],
    help: [{ label: '방향 문장 다듬기', prompt: '적은 설계 방향을 "~하려면 ~해야 한다" 형식으로 다듬어 주세요.' }],
  },
  'T-2-1': {
    fields: [f('역할 배분', 'A', { label: '역할 배분 (누가·무엇을·언제까지)' })],
    help: [{ label: '역할 표로 정리', prompt: '적은 역할을 누가·무엇을·언제까지 표로 정리해 주세요.' }],
  },
  'T-2-2': {
    fields: [f('팀 규칙', 'A', { label: '핵심 팀 규칙 (규칙명·실천 방법)' })],
    help: [{ label: '갈등 규칙 예시', prompt: '의견이 갈릴 때 쓸 수 있는 팀 규칙 예시 2가지만 보여 주세요.' }],
  },
  'T-2-3': {
    fields: [f('팀 일정', 'A', { label: '팀 일정표 (기간·활동·담당자)' })],
    help: [{ label: '역산 일정 만들기', prompt: '수업 실행일에서 거꾸로 계산한 준비 일정을 표로 만들어 주세요.' }],
  },
  'A-1-1': {
    fields: [f('주제 선정 기준', 'A', { label: '주제 선정 기준' })],
    help: [{ label: '기준 예시', prompt: '주제를 고를 때 쓸 수 있는 기준 예시 3가지만 보여 주세요.' }],
  },
  'A-1-2': {
    fields: [
      f('최종 선정 주제', 'A', { label: '선정 주제' }),
      f('선정 근거', 'B', { label: '선정 근거 (비전·교과·학생 맥락)', reason: '성취기준 분석과 보고서가 주제를 고른 이유를 참고해요' }),
      f('주제 선정 기준', 'C', { label: '주제 선정 기준' }),
      f('주제 유형', 'C', { label: '주제 유형 (내용/기능/혼합)' }),
    ],
    help: [{ label: '근거 한 줄 정리', prompt: '선정 주제를 비전·교과·학생 맥락과 이어 근거 한 줄로 정리해 주세요.' }],
  },
  'A-2-1': {
    fields: [f('성취기준분석표', 'A', { label: '성취기준 분석 (지식·이해 / 과정·기능 / 가치·태도)' })],
    help: [{ label: '성취기준 찾기', prompt: '선정 주제와 이어지는 성취기준 후보를 교과별로 찾아 주세요.' }],
  },
  'A-2-2': {
    fields: [
      f('통합 수업목표', 'A', { label: '통합 수업목표 (한 문장)' }),
      f('공통 핵심 아이디어', 'A', { label: '공통 핵심 아이디어 (1문장)' }),
      f('교과별 수업목표', 'A', { label: '교과별 수업목표' }),
      f('탐구 질문', 'B', { label: '탐구 질문 (학생 언어)', reason: '문제상황의 핵심 질문과 이어져요' }),
    ],
    help: [{ label: '목표 문장 다듬기', prompt: '통합 수업목표를 학생 행동이 드러나는 한 문장으로 다듬어 주세요.' }],
  },
  'A-2-3': {
    fields: [f('학습자 프로필', 'A', { label: '학습자 프로필 (학생 특성·맥락)', placeholder: '선수 지식, 흥미, 지원이 필요한 학생, 환경 제약' })],
    help: [{ label: '프로필 항목 정리', prompt: '적은 학생 특성을 선수 지식·흥미·지원 필요·환경 항목으로 정리해 주세요.' }],
  },
  'Ds-1-1': {
    fields: [f('평가 계획', 'A', { label: '평가 계획 (확인 지점·요소·방법·시점·주체)' })],
    help: [
      { label: '평가 표로 정리', prompt: '적은 평가 내용을 확인 지점·평가 요소·방법·시점·주체 표로 정리해 주세요.' },
      { label: '근거 성취기준 붙이기', prompt: '평가 요소마다 A-2-1에 있는 근거 성취기준 코드를 붙여 주세요.' },
    ],
  },
  'Ds-1-2': {
    fields: [
      f('문제상황', 'A', { label: '문제상황 시나리오 (제목·실제성·학습 내용+산출물·청중+행위)' }),
      f('핵심 질문', 'C', { label: '문제상황 핵심 질문' }),
    ],
    help: [{ label: '시나리오 다듬기', prompt: '적은 문제상황을 실제성·학습 내용+산출물·청중+행위 세 줄로 다듬어 주세요.' }],
  },
  'Ds-1-3': {
    fields: [
      f('학습 활동', 'A', { label: '학습 활동 (흐름·활동명·차시)' }),
      f('AI 점검', 'C', { label: 'AI 점검' }),
    ],
    help: [{ label: '활동 흐름 점검', prompt: '적은 학습 활동이 문제 이해→정보 탐색→분석→의사결정→산출물→공유 흐름에 맞는지 짧게 봐 주세요.' }],
  },
  'Ds-2-1': {
    fields: [
      f('활동별 자료 설계', 'A', { label: '도구 연결 (활동·도구·담당)' }),
      f('Human-AI Agency', 'B', { label: '학생·AI·교사의 역할 경계', reason: '스캐폴딩과 AI 활용 범위를 정할 때 참고해요' }),
      f('AI 점검', 'C', { label: 'AI 점검' }),
    ],
    help: [{ label: '도구 추천', prompt: '학습 활동별로 쓸 만한 도구를 1~2개씩 추천해 주세요.' }],
  },
  'Ds-2-2': {
    fields: [
      f('스캐폴딩 계획', 'A', { label: '스캐폴딩 계획 (활동·지원 내용·대상·제거 시점)' }),
      f('지원 방안 정리', 'C', { label: '지원 방안 정리' }),
      f('AI 점검', 'C', { label: 'AI 점검' }),
    ],
    help: [{ label: '지원 방안 예시', prompt: '어려워할 만한 활동 하나를 골라 지원 방안 예시를 보여 주세요.' }],
  },
  'DI-1-1': {
    fields: [f('개발 자료 목록', 'A', { label: '개발 자료 목록 (자료·담당·일정)' })],
    help: [{ label: '자료 목록 정리', prompt: '준비할 자료를 자료·탐색/개발·담당·일정 표로 정리해 주세요.' }],
  },
  'DI-2-1': {
    fields: [
      f('주요 상황 기록', 'A', { label: '주요 상황 기록 (시점·상황·학생 반응)' }),
      f('E단계 확인 질문', 'C', { label: '평가 단계에서 확인할 질문' }),
    ],
    help: [{ label: '기록 정리', prompt: '적은 수업 기록을 시점·상황·학생 반응·증거 표로 정리해 주세요.' }],
  },
  'E-1-1': {
    fields: [
      f('해석', 'A', { label: '원인 분석 (해석)' }),
      f('수정안', 'A', { label: '개선 아이디어 (수정안)' }),
      f('사실', 'B', { label: '루브릭 기준 도달 확인 (관찰한 사실)', reason: '원인 분석이 실제 학생 도달 정도에서 출발하게 해요' }),
    ],
    help: [{ label: '사실·해석 나누기', prompt: '적은 성찰을 사실과 해석으로 나눠 정리해 주세요.' }],
  },
  'E-2-1': {
    fields: [
      f('협력 과정 성찰', 'A', { label: '초기 합의 사항 대조 (협력 과정 성찰)' }),
      f('팀 개선안', 'A', { label: '다음 협력 운영 원칙' }),
      f('다음 주기 선택', 'C', { label: '다음 주기 선택' }),
    ],
    help: [{ label: '개선안 다듬기', prompt: '협력 성찰에서 다음에 바꿀 운영 원칙 2가지를 뽑아 주세요.' }],
  },
}

/** 연수용 첫 안내의 '이 활동에서 할 일' 한 줄 */
export const TRAINING_INTRO: Readonly<Record<ActivityCode, string>> = {
  'T-1-1': '팀이 함께 지향하는 수업을 한 문장으로 적어요.',
  'T-1-2': '수업설계에서 지킬 방향을 "~하려면 ~해야 한다"로 적어요.',
  'T-2-1': '누가 무엇을 언제까지 맡을지 적어요.',
  'T-2-2': '협의가 막힐 때 지킬 팀 규칙을 적어요.',
  'T-2-3': '수업 실행일을 기준으로 팀 일정을 적어요.',
  'A-1-1': '주제를 고를 기준을 적어요.',
  'A-1-2': '팀이 고른 주제와 고른 이유를 적어요.',
  'A-2-1': '주제와 이어지는 성취기준을 분석해 적어요.',
  'A-2-2': '통합 수업목표를 한 문장으로 적어요.',
  'A-2-3': '우리 학생들의 특성과 맥락을 적어요.',
  'Ds-1-1': '무엇으로 학습을 확인할지 평가 계획을 적어요.',
  'Ds-1-2': '학생이 해결할 문제상황을 적어요.',
  'Ds-1-3': '학습 활동의 흐름과 차시를 적어요.',
  'Ds-2-1': '활동마다 쓸 도구와 자료를 적어요.',
  'Ds-2-2': '어려워할 활동에 줄 지원을 적어요.',
  'DI-1-1': '준비할 자료 목록을 적어요.',
  'DI-2-1': '수업에서 있었던 주요 장면을 적어요.',
  'E-1-1': '수업에서 본 사실·해석·수정안을 적어요.',
  'E-2-1': '협력 과정을 돌아보고 다음 운영 원칙을 적어요.',
}

function sectionLabel(code: ActivityCode, key: string): string {
  return ACTIVITY_META[code].recommendedSections?.find(section => section.key === key)?.label
    ?? ACTIVITY_META[code].requiredSections?.find(section => section.key === key)?.label
    ?? key
}

/** 19개 활동의 연수용 정의(칸 분류·AI 도움 버튼). */
export const TRAINING_ACTIVITIES: Readonly<Record<ActivityCode, TrainingActivityDef>> = Object.fromEntries(
  (Object.keys(RAW) as ActivityCode[]).map(code => [code, {
    code,
    fields: RAW[code].fields.map(field => ({ ...field, label: field.label ?? sectionLabel(code, field.key) })),
    help: RAW[code].help,
  }]),
) as unknown as Record<ActivityCode, TrainingActivityDef>

export interface TrainingDependency {
  /** 생략됐는지 볼 앞 활동 */
  from: ActivityCode
  /** 그 활동을 건너뛰었을 때 한 번만 묻는 최소 정보 */
  ask: string
}

/** 앞 활동을 생략(산출물 없음)했을 때 이 활동에서 한 번 묻는 최소 정보 */
export const TRAINING_DEPENDENCIES: Readonly<Partial<Record<ActivityCode, readonly TrainingDependency[]>>> = {
  'A-1-2': [{ from: 'T-1-1', ask: '팀이 중요하게 여기는 수업 방향 한 줄' }],
  'A-2-1': [{ from: 'A-1-2', ask: '선정한 주제' }],
  'A-2-2': [{ from: 'A-2-1', ask: '다룰 교과와 성취기준 코드' }],
  'Ds-1-1': [{ from: 'A-2-2', ask: '통합 수업목표 한 문장' }],
  'Ds-1-2': [{ from: 'Ds-1-1', ask: '평가에서 확인할 최종 결과물' }],
  'Ds-1-3': [{ from: 'Ds-1-2', ask: '문제상황 제목과 최종 산출물' }],
  'Ds-2-1': [{ from: 'Ds-1-3', ask: '도구가 필요한 학습 활동 이름' }],
  'Ds-2-2': [{ from: 'Ds-1-3', ask: '지원이 필요한 학습 활동 이름' }],
  'DI-1-1': [{ from: 'Ds-2-1', ask: '준비해야 할 자료' }],
  'DI-2-1': [{ from: 'Ds-1-3', ask: '실행한 차시와 활동' }],
  'E-1-1': [{ from: 'DI-2-1', ask: '수업에서 관찰한 주요 장면 한두 개' }],
}

type TrainingProject = Pick<Project, 'trainingMode'> | null | undefined

/** 연수용 모드가 켜진 프로젝트인지 */
export function isTrainingProject(project: TrainingProject): boolean {
  return project?.trainingMode?.enabled === true
}

/**
 * 이 활동을 연수용(약식)으로 진행하는지. 연수용 모드가 켜져 있고,
 * coreFormal(기본 true)이면 핵심 절차 5개는 일반 진행으로 둔다.
 * @MX:ANCHOR [AUTO] 연수용 분기의 단일 관문 — 프롬프트·채팅 저장·화면이 모두 이 함수로 판단한다
 */
export function isTrainingActivity(project: TrainingProject, code: string): boolean {
  if (!isTrainingProject(project)) return false
  const coreFormal = project?.trainingMode?.coreFormal !== false
  return !(coreFormal && TRAINING_CORE_ACTIVITIES.includes(code as ActivityCode))
}

function hasValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(hasValue)
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).some(([k, v]) => !k.startsWith('_') && hasValue(v))
  return true
}

export interface TrainingStatus {
  /** 비어 있는 A 칸 */
  missingRequired: TrainingField[]
  /** 채워진 칸(A·B·C) */
  filled: TrainingField[]
  /** A 칸 수 */
  requiredTotal: number
}

/** 산출물 content 로 칸 상태를 계산한다(섹션 키 기준). */
export function trainingStatus(code: string, artifactContent: unknown): TrainingStatus {
  const def = TRAINING_ACTIVITIES[code as ActivityCode]
  if (!def) return { missingRequired: [], filled: [], requiredTotal: 0 }
  const content = artifactContent && typeof artifactContent === 'object' ? artifactContent as Record<string, unknown> : {}
  const filled = def.fields.filter(field => hasValue(content[field.key]))
  const required = def.fields.filter(field => field.tier === 'A')
  return { missingRequired: required.filter(field => !filled.includes(field)), filled, requiredTotal: required.length }
}

// ─── 개입 선호(시간순 마지막 표현 우선) ───────────────────────────────

const QUIET_RE = /개입\s*하지\s*마|개입\s*(?:은|는)?\s*(?:필요\s*)?없|조언\s*(?:은|는)?\s*(?:필요\s*)?없|조언\s*없이|저장만|그대로\s*저장|간섭\s*하지\s*마|도와\s*주지\s*마|도움\s*(?:은|는)?\s*필요\s*없/g
const NORMAL_RE = /조언\s*해\s*주|조언\s*(?:을|좀)?\s*(?:주세요|부탁)|도와\s*주(?!지\s*마)|도와줘|도움\s*(?:을|이|좀)?\s*(?:주세요|필요해|필요합니다|받고)|단계별로/g

export type InterventionPreference = 'quiet' | 'normal'

/** 사용자 발화(시간순)에서 마지막 개입 표현을 따른다. 아무 표현이 없으면 'normal'. */
/**
 * 화면 버튼이 만든 문구 — 교사가 직접 친 말이 아니므로 개입 선호 판단에서 뺀다.
 * 양식 저장 알림·AI 도움·단계별 진행·직접 적기 복귀.
 */
export function isTrainingSystemText(text: string): boolean {
  const body = text.replace(/^\s*\[답장:[^\]]*\]\s*/, '')
  return /^\s*\[(?:연수 양식 저장|AI 도움):/.test(body) || body.includes('[단계별로 함께 진행]')
}

function lastPreferenceIn(text: string): InterventionPreference | null {
  const marks = [
    ...[...text.matchAll(QUIET_RE)].map(m => ({ end: (m.index ?? 0) + m[0].length, kind: 'quiet' as const })),
    ...[...text.matchAll(NORMAL_RE)].map(m => ({ end: (m.index ?? 0) + m[0].length, kind: 'normal' as const })),
  ].sort((a, b) => a.end - b.end || (a.kind === 'quiet' ? 1 : -1))
  return marks.length ? marks[marks.length - 1].kind : null
}

/**
 * 교사가 직접 친 발화(시간순)에서 마지막 개입 표현을 따른다. 아무 표현이 없으면 'normal'.
 * 화면 버튼 문구(isTrainingSystemText)는 보지 않는다 — 버튼은 그 요청 한 번만 처리하고 상태는 바꾸지 않는다.
 */
export function detectInterventionPreference(userTexts: readonly string[]): InterventionPreference {
  let preference: InterventionPreference = 'normal'
  for (const text of userTexts) {
    if (isTrainingSystemText(text)) continue
    preference = lastPreferenceIn(text) ?? preference
  }
  return preference
}

export interface TrainingMessageLike {
  role: string
  content: string
  activityCode?: string
}

/** 이 활동이 지금 개입 금지 상태인지 — 화면이 'AI 조언 받기' 체크 상태 표시에 쓴다. */
export function isTrainingQuiet(messages: readonly TrainingMessageLike[], code: string): boolean {
  return detectInterventionPreference(
    messages.filter(m => m.role === 'user' && m.activityCode === code).map(m => m.content),
  ) === 'quiet'
}

// ─── 채팅 메시지 형식(화면 ↔ 채팅) ─────────────────────────────────────

/** 개입 금지일 때 AI 호출 없이 남기는 고정 응답 */
export const TRAINING_QUIET_REPLY = '저장했습니다.'

/** 양식 저장 알림: '[연수 양식 저장: T-3 역할 배분]' */
export function formatTrainingSaveNotice(code: ActivityCode): string {
  return `[연수 양식 저장: ${displayActivityCode(code)} ${ACTIVITY_META[code].label}]`
}

const SAVE_NOTICE_RE = /^\s*\[연수 양식 저장:\s*([^\]\s]+)\s*([^\]]*)\]/

export function parseTrainingSaveNotice(text: string): { displayCode: string; label: string } | null {
  const match = text.match(SAVE_NOTICE_RE)
  return match ? { displayCode: match[1], label: match[2].trim() } : null
}

/** AI 도움 요청: '[AI 도움: 버튼이름] 요청 본문' */
export function formatTrainingHelpRequest(action: TrainingHelpAction): string {
  return `[AI 도움: ${action.label}] ${action.prompt}`
}

export function parseTrainingHelpRequest(text: string): { label: string; body: string } | null {
  const match = text.match(/^\s*\[AI 도움:\s*([^\]]+)\]\s*([\s\S]*)$/)
  return match ? { label: match[1].trim(), body: match[2].trim() } : null
}

/** 단계별 진행 요청 문구와 복귀 문구 */
export const TRAINING_STEP_BY_STEP = '[단계별로 함께 진행]'
export const TRAINING_DIRECT_ENTRY = '직접 적을게요'

/** 이 활동 대화(시간순)에서 단계별 진행이 켜져 있는지 — 마지막 요청/복귀 문구를 따른다. */
export function isStepByStepActive(userTexts: readonly string[]): boolean {
  let active = false
  for (const text of userTexts) {
    const on = text.lastIndexOf(TRAINING_STEP_BY_STEP)
    const off = text.lastIndexOf(TRAINING_DIRECT_ENTRY)
    if (on >= 0 || off >= 0) active = on > off
  }
  return active
}

/** 화면(연수 막대·양식)이 채팅으로 메시지를 보낼 때 쓰는 브라우저 이벤트. ChatPanel 이 받아 전송한다. */
export const TRAINING_SEND_EVENT = 'tcid:training-send'

export function requestTrainingChatSend(text: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ text: string }>(TRAINING_SEND_EVENT, { detail: { text } }))
}

/**
 * 양식 저장 알림에 AI 없이 '저장했습니다.'로 답할지 — 연수용 활동의 양식 저장 알림이고,
 * (1) 교사가 직접 친 말로 이 활동이 개입 금지 상태이거나(알림의 체크 문구와 무관),
 * (2) 이번 알림 자체가 조언을 원하지 않는다고 할 때('AI 조언 받기' 해제).
 */
export function shouldReplyTrainingQuietly(
  project: TrainingProject,
  code: string,
  text: string,
  previousUserTexts: readonly string[],
): boolean {
  if (!isTrainingActivity(project, code) || parseTrainingSaveNotice(text) === null) return false
  const suffix = text.replace(SAVE_NOTICE_RE, '')
  // 개입 금지 중에도 교사가 체크를 다시 켠 저장은 그 1회만 조언한다(알림은 시스템 문구라 상태는 그대로 quiet).
  if (suffix.includes(TRAINING_ADVICE_ONCE.trim())) return false
  if (detectInterventionPreference(previousUserTexts) === 'quiet') return true
  return lastPreferenceIn(suffix) === 'quiet'
}

/** 양식 저장 알림 끝에 붙이는 조언 의사 — 체크(보통) / 체크 해제 / 개입 금지 중 다시 켠 체크(이번 1회) */
export const TRAINING_ADVICE_ON = ' 조언해 주세요'
export const TRAINING_ADVICE_OFF = ' 조언은 필요 없어요'
export const TRAINING_ADVICE_ONCE = ' 이번 저장만 조언해 주세요'

/** 채팅에 보이는 저장 알림 칩 문구 — 저장 데이터('[연수 양식 저장: …]')는 그대로 두고 표시만 바꾼다. */
export function trainingSaveNoticeChip(text: string): string | null {
  const notice = parseTrainingSaveNotice(text)
  return notice ? `${notice.displayCode} ${notice.label} 양식을 저장했어요` : null
}

/**
 * 연수용 활동의 첫 안내(AI 없이 고정) — 할 일 한 줄, 필수 칸, 한 번 묻는 칸, 도움 버튼, 저장 안내.
 * 일반 환영(ACTIVITY_WELCOME) 대신 쓴다.
 */
export function buildTrainingWelcome(code: ActivityCode): string {
  const def = TRAINING_ACTIVITIES[code]
  const required = def.fields.filter(field => field.tier === 'A').map(field => field.label)
  const askOnce = def.fields.filter(field => field.tier === 'B').map(field => field.label)
  return [
    `**${displayActivityCode(code)} ${ACTIVITY_META[code].label}** — ${TRAINING_INTRO[code]}`,
    required.length ? `- 필수 칸: ${required.join(', ')}` : '',
    askOnce.length ? `- 있으면 좋은 칸: ${askOnce.join(', ')}` : '',
    def.help.length ? `- 도움이 필요하면 위 버튼: ${def.help.map(action => action.label).join(', ')}` : '',
    '',
    '토의한 결과를 오른쪽 양식에 옮겨 적고 저장하세요.',
  ].filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== '')).join('\n')
}

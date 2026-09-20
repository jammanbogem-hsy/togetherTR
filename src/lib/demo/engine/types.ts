import {
  ACTIVITY_META,
  STAGES,
  type ActivityCode,
  type GradeGroup,
  type SchoolLevel,
  type StageCode,
} from '@/types'
import { getDemoActivityContract, validateDemoArtifactContent } from '@/lib/activity/demo-contracts'

export const DEMO_TEACHER_COUNT_MIN = 2
export const DEMO_TEACHER_COUNT_MAX = 5

export const DEMO_TURN_PHASES = [
  'orchestrator-intro',
  'teacher-contribution',
  'teacher-response',
  'orchestrator-synthesis',
  'teacher-review',
  'orchestrator-revision',
] as const

export type DemoTurnPhase = (typeof DEMO_TURN_PHASES)[number]

export interface DemoSetupInput {
  teacherCount: number
  personaHints: string[]
  lessonHint: string
  schoolLevel: SchoolLevel
  gradeGroup: GradeGroup
  subjects: string[]
}

export interface DemoTeacherPersona {
  id: string
  displayName: string
  subject: string
  career: string
  strengths: string[]
  collaborationStyle: string
  priority: string
  summary: string
  color: string
  emoji: string
}

export interface DemoLessonSpec {
  title: string
  topic: string
  overview: string
  schoolLevel: SchoolLevel
  gradeGroup: GradeGroup
  subjects: string[]
  totalSessions: number
  goals: string[]
  learnerContext: string
  constraints: string[]
  dataPlan: string
}

export interface DemoEngineConfig {
  personas: DemoTeacherPersona[]
  lesson: DemoLessonSpec
}

export interface DemoExpandResponse {
  config: DemoEngineConfig
}

export type DemoJsonPrimitive = string | number | boolean | null
export type DemoJsonValue =
  | DemoJsonPrimitive
  | DemoJsonValue[]
  | { [key: string]: DemoJsonValue }

export interface DemoPriorArtifact {
  title: string
  content: Record<string, DemoJsonValue>
  status?: 'confirmed' | 'in_review' | 'ai_draft' | 'rejected'
}

export type DemoPriorArtifacts = Partial<Record<ActivityCode, DemoPriorArtifact>>

export interface DemoDiscussionTurn {
  phase: DemoTurnPhase
  speakerId: string
  speakerName: string
  content: string
  stepId?: string
  round?: number
  review?: DemoTeacherReview
  references?: DemoTurnReference[]
}

export interface DemoTeacherReview {
  decision: 'approve' | 'revise'
  reason: string
  // Optional only for reading previously stored reviews. New model responses require both.
  blockers?: DemoReviewBlocker[]
  suggestions?: string[]
}

export interface DemoReviewBlocker {
  criterionId: string
  sectionKey: string
  evidence: string
  issue: string
  change: string
}

export function getDemoReviewCriteria(activityCode: ActivityCode): Array<{ id: string; description: string }> {
  return [
    ...getDemoActivityContract(activityCode).completionCriteria.map((description, index) => ({ id: `activity-${index + 1}`, description })),
    { id: 'format', description: '현재 활동에서 요구한 산출물 섹션·형식을 충족한다.' },
    { id: 'alignment', description: '초안이 교사의 실제 제안·확정 공동 비전·입력 수업 조건과 모순되지 않는다. 이후 단계의 상세 설계 미완성은 모순이 아니다.' },
    { id: 'safety', description: '초안의 구체적 내용이 학생 안전·개인정보·접근성을 해치거나 합성 자료를 실제 사실로 잘못 제시하지 않는다. 막연한 우려나 새 행정 절차 요구는 해당하지 않는다.' },
  ]
}

export interface DemoTurnReference {
  speakerId: string
  quote: string
}

export interface DemoTurnInput {
  phase: DemoTurnPhase
  activityCode: ActivityCode
  config: DemoEngineConfig
  priorArtifacts: DemoPriorArtifacts
  discussion: DemoDiscussionTurn[]
  teacherId?: string
  stepId?: string
  round?: number
  candidateArtifact?: DemoGeneratedArtifact
  validationFeedback?: string[]
}

export interface DemoGeneratedArtifact {
  activityCode: ActivityCode
  title: string
  content: Record<string, string>
}

export interface DemoGeneratedStageReport {
  stage: StageCode
  content: string
}

export interface DemoTurnResponse {
  content: string
  artifact?: DemoGeneratedArtifact
  stageReport?: DemoGeneratedStageReport
  review?: DemoTeacherReview
  references?: DemoTurnReference[]
}

export type DemoRunStatus = 'ready' | 'running' | 'paused' | 'completed' | 'failed'

export interface DemoRunState {
  status: DemoRunStatus
  config: DemoEngineConfig
  activityIndex: number
  activityCode?: ActivityCode
  phase?: DemoTurnPhase
  completedTurns: number
  totalTurns: number
  startedAt?: number
  updatedAt: number
  completedAt?: number
  error?: string | null
  engineVersion?: 2
  stepId?: string
  round?: number
  lease?: { runId: string; expiresAt: number } | null
  journal?: Record<string, DemoTurnResponse>
}

/** Raw shape required from the model before section arrays are normalized for Firestore. */
export interface DemoTurnModelOutput {
  content: string
  review: DemoTeacherReview | null
  references: DemoTurnReference[]
  artifact: null | {
    title: string
    sections: Array<{ key: string; value: string }>
  }
  stageReport: null | {
    stage: StageCode
    content: string
  }
}

export class DemoValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string | string[]) {
    const normalized = Array.isArray(issues) ? issues : [issues]
    super(normalized.join(' '))
    this.name = 'DemoValidationError'
    this.issues = normalized
  }
}

const SCHOOL_LEVELS: readonly SchoolLevel[] = ['초등학교', '중학교', '고등학교']
const GRADE_GROUPS: readonly GradeGroup[] = ['초1-2', '초3-4', '초5-6', '중1-3', '고공통', '고선택']
const ACTIVITY_CODES = Object.keys(ACTIVITY_META) as ActivityCode[]
const ACTIVITY_CODE_SET = new Set<string>(ACTIVITY_CODES)
const TURN_PHASE_SET = new Set<string>(DEMO_TURN_PHASES)
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

type UnknownRecord = Record<string, unknown>

function fail(path: string, message: string): never {
  throw new DemoValidationError(`${path}: ${message}`)
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, '객체여야 합니다.')
  }
  return value as UnknownRecord
}

function assertExactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional])
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknownKeys.length > 0) {
    fail(path, `허용되지 않은 필드가 있습니다: ${unknownKeys.join(', ')}`)
  }
  const missingKeys = required.filter((key) => !(key in value))
  if (missingKeys.length > 0) {
    fail(path, `필수 필드가 없습니다: ${missingKeys.join(', ')}`)
  }
}

function asString(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  if (typeof value !== 'string') fail(path, '문자열이어야 합니다.')
  const result = value.trim()
  const min = options.min ?? 1
  const max = options.max ?? 4_000
  if (result.length < min || result.length > max) {
    fail(path, `${min}~${max}자여야 합니다.`)
  }
  if (options.pattern && !options.pattern.test(result)) {
    fail(path, '형식이 올바르지 않습니다.')
  }
  return result
}

function asInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(path, `${min}~${max} 사이의 정수여야 합니다.`)
  }
  return value as number
}

function asStringArray(
  value: unknown,
  path: string,
  options: { minItems?: number; maxItems: number; itemMax?: number; unique?: boolean },
): string[] {
  if (!Array.isArray(value)) fail(path, '배열이어야 합니다.')
  const minItems = options.minItems ?? 0
  if (value.length < minItems || value.length > options.maxItems) {
    fail(path, `${minItems}~${options.maxItems}개 항목이어야 합니다.`)
  }
  const result = value.map((item, index) => asString(
    item,
    `${path}[${index}]`,
    { max: options.itemMax ?? 500 },
  ))
  if (options.unique && new Set(result).size !== result.length) {
    fail(path, '중복 항목을 포함할 수 없습니다.')
  }
  return result
}

function asSchoolLevel(value: unknown, path: string): SchoolLevel {
  if (typeof value !== 'string' || !SCHOOL_LEVELS.includes(value as SchoolLevel)) {
    fail(path, `다음 중 하나여야 합니다: ${SCHOOL_LEVELS.join(', ')}`)
  }
  return value as SchoolLevel
}

function asGradeGroup(value: unknown, path: string): GradeGroup {
  if (typeof value !== 'string' || !GRADE_GROUPS.includes(value as GradeGroup)) {
    fail(path, `다음 중 하나여야 합니다: ${GRADE_GROUPS.join(', ')}`)
  }
  return value as GradeGroup
}

function asActivityCode(value: unknown, path: string): ActivityCode {
  if (typeof value !== 'string' || !ACTIVITY_CODE_SET.has(value)) {
    fail(path, '알 수 없는 내부 활동 코드입니다.')
  }
  return value as ActivityCode
}

function asTurnPhase(value: unknown, path: string): DemoTurnPhase {
  if (typeof value !== 'string' || !TURN_PHASE_SET.has(value)) {
    fail(path, `다음 중 하나여야 합니다: ${DEMO_TURN_PHASES.join(', ')}`)
  }
  return value as DemoTurnPhase
}

function asJsonValue(value: unknown, path: string, depth = 0): DemoJsonValue {
  if (depth > 8) fail(path, 'JSON 중첩 깊이는 8단계를 넘을 수 없습니다.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, '유한한 숫자여야 합니다.')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail(path, '배열 항목은 100개를 넘을 수 없습니다.')
    return value.map((item, index) => asJsonValue(item, `${path}[${index}]`, depth + 1))
  }
  const record = asRecord(value, path)
  const entries = Object.entries(record)
  if (entries.length > 80) fail(path, '객체 필드는 80개를 넘을 수 없습니다.')
  const result: Record<string, DemoJsonValue> = Object.create(null) as Record<string, DemoJsonValue>
  for (const [key, item] of entries) {
    const cleanKey = asString(key, `${path} key`, { max: 100 })
    if (BLOCKED_OBJECT_KEYS.has(cleanKey)) fail(path, `위험한 객체 키(${cleanKey})는 사용할 수 없습니다.`)
    result[cleanKey] = asJsonValue(item, `${path}.${cleanKey}`, depth + 1)
  }
  return result
}

function parsePersona(value: unknown, path: string): DemoTeacherPersona {
  const record = asRecord(value, path)
  assertExactKeys(record, [
    'id', 'displayName', 'subject', 'career', 'strengths', 'collaborationStyle',
    'priority', 'summary', 'color', 'emoji',
  ], [], path)
  return {
    id: asString(record.id, `${path}.id`, { max: 64, pattern: /^[a-z0-9][a-z0-9-]*$/ }),
    displayName: asString(record.displayName, `${path}.displayName`, { max: 60 }),
    subject: asString(record.subject, `${path}.subject`, { max: 80 }),
    career: asString(record.career, `${path}.career`, { max: 120 }),
    strengths: asStringArray(record.strengths, `${path}.strengths`, {
      minItems: 1,
      maxItems: 6,
      itemMax: 80,
      unique: true,
    }),
    collaborationStyle: asString(record.collaborationStyle, `${path}.collaborationStyle`, { max: 300 }),
    priority: asString(record.priority, `${path}.priority`, { max: 300 }),
    summary: asString(record.summary, `${path}.summary`, { max: 500 }),
    color: asString(record.color, `${path}.color`, { max: 7, pattern: /^#[0-9A-Fa-f]{6}$/ }).toUpperCase(),
    emoji: asString(record.emoji, `${path}.emoji`, { max: 16 }),
  }
}

function parseLesson(value: unknown, path: string): DemoLessonSpec {
  const record = asRecord(value, path)
  assertExactKeys(record, [
    'title', 'topic', 'overview', 'schoolLevel', 'gradeGroup', 'subjects',
    'totalSessions', 'goals', 'learnerContext', 'constraints', 'dataPlan',
  ], [], path)
  return {
    title: asString(record.title, `${path}.title`, { max: 160 }),
    topic: asString(record.topic, `${path}.topic`, { max: 200 }),
    overview: asString(record.overview, `${path}.overview`, { max: 1_500 }),
    schoolLevel: asSchoolLevel(record.schoolLevel, `${path}.schoolLevel`),
    gradeGroup: asGradeGroup(record.gradeGroup, `${path}.gradeGroup`),
    subjects: asStringArray(record.subjects, `${path}.subjects`, {
      minItems: 1,
      maxItems: 8,
      itemMax: 40,
      unique: true,
    }),
    totalSessions: asInteger(record.totalSessions, `${path}.totalSessions`, 1, 40),
    goals: asStringArray(record.goals, `${path}.goals`, {
      minItems: 1,
      maxItems: 8,
      itemMax: 300,
      unique: true,
    }),
    learnerContext: asString(record.learnerContext, `${path}.learnerContext`, { max: 1_500 }),
    constraints: asStringArray(record.constraints, `${path}.constraints`, {
      maxItems: 10,
      itemMax: 300,
      unique: true,
    }),
    dataPlan: asString(record.dataPlan, `${path}.dataPlan`, { max: 1_500 }),
  }
}

export function parseDemoSetupInput(value: unknown): DemoSetupInput {
  const record = asRecord(value, 'request')
  assertExactKeys(record, [
    'teacherCount', 'personaHints', 'lessonHint', 'schoolLevel', 'gradeGroup', 'subjects',
  ], [], 'request')
  const teacherCount = asInteger(
    record.teacherCount,
    'request.teacherCount',
    DEMO_TEACHER_COUNT_MIN,
    DEMO_TEACHER_COUNT_MAX,
  )
  return {
    teacherCount,
    personaHints: asStringArray(record.personaHints, 'request.personaHints', {
      maxItems: teacherCount,
      itemMax: 500,
      unique: true,
    }),
    lessonHint: asString(record.lessonHint, 'request.lessonHint', { min: 3, max: 4_000 }),
    schoolLevel: asSchoolLevel(record.schoolLevel, 'request.schoolLevel'),
    gradeGroup: asGradeGroup(record.gradeGroup, 'request.gradeGroup'),
    subjects: asStringArray(record.subjects, 'request.subjects', {
      minItems: 1,
      maxItems: 8,
      itemMax: 40,
      unique: true,
    }),
  }
}

export function parseDemoEngineConfig(value: unknown, path = 'config'): DemoEngineConfig {
  const record = asRecord(value, path)
  assertExactKeys(record, ['personas', 'lesson'], [], path)
  if (!Array.isArray(record.personas)) fail(`${path}.personas`, '배열이어야 합니다.')
  if (
    record.personas.length < DEMO_TEACHER_COUNT_MIN
    || record.personas.length > DEMO_TEACHER_COUNT_MAX
  ) {
    fail(`${path}.personas`, `${DEMO_TEACHER_COUNT_MIN}~${DEMO_TEACHER_COUNT_MAX}명이어야 합니다.`)
  }
  const personas = record.personas.map((item, index) => parsePersona(item, `${path}.personas[${index}]`))
  if (new Set(personas.map((persona) => persona.id)).size !== personas.length) {
    fail(`${path}.personas`, '교사 에이전트 id가 중복되었습니다.')
  }
  if (new Set(personas.map((persona) => persona.displayName)).size !== personas.length) {
    fail(`${path}.personas`, '교사 에이전트 이름이 중복되었습니다.')
  }
  return { personas, lesson: parseLesson(record.lesson, `${path}.lesson`) }
}

export function parseDemoExpandResponse(value: unknown): DemoExpandResponse {
  const record = asRecord(value, 'response')
  assertExactKeys(record, ['config'], [], 'response')
  return { config: parseDemoEngineConfig(record.config) }
}

function parsePriorArtifacts(value: unknown): DemoPriorArtifacts {
  const record = asRecord(value, 'request.priorArtifacts')
  if (Object.keys(record).length > ACTIVITY_CODES.length) {
    fail('request.priorArtifacts', `최대 ${ACTIVITY_CODES.length}개 활동만 포함할 수 있습니다.`)
  }
  const result: DemoPriorArtifacts = {}
  for (const [rawCode, rawArtifact] of Object.entries(record)) {
    const code = asActivityCode(rawCode, `request.priorArtifacts.${rawCode}`)
    const artifact = asRecord(rawArtifact, `request.priorArtifacts.${code}`)
    assertExactKeys(artifact, ['title', 'content'], ['status'], `request.priorArtifacts.${code}`)
    const content = asJsonValue(artifact.content, `request.priorArtifacts.${code}.content`)
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      fail(`request.priorArtifacts.${code}.content`, 'JSON 객체여야 합니다.')
    }
    let status: DemoPriorArtifact['status']
    if (artifact.status !== undefined) {
      if (!['confirmed', 'in_review', 'ai_draft', 'rejected'].includes(String(artifact.status))) {
        fail(`request.priorArtifacts.${code}.status`, '알 수 없는 산출물 상태입니다.')
      }
      status = artifact.status as DemoPriorArtifact['status']
    }
    result[code] = {
      title: asString(artifact.title, `request.priorArtifacts.${code}.title`, { max: 200 }),
      content: content as Record<string, DemoJsonValue>,
      ...(status ? { status } : {}),
    }
  }
  if (JSON.stringify(result).length > 80_000) {
    fail('request.priorArtifacts', '직렬화 크기는 80,000자를 넘을 수 없습니다.')
  }
  return result
}

function parseDiscussion(value: unknown, config: DemoEngineConfig): DemoDiscussionTurn[] {
  if (!Array.isArray(value)) fail('request.discussion', '배열이어야 합니다.')
  if (value.length > 100) fail('request.discussion', '대화 턴은 100개를 넘을 수 없습니다.')
  const personaIds = new Set(config.personas.map((persona) => persona.id))
  const turns = value.map((item, index): DemoDiscussionTurn => {
    const path = `request.discussion[${index}]`
    const record = asRecord(item, path)
    assertExactKeys(record, ['phase', 'speakerId', 'speakerName', 'content'], ['stepId', 'round', 'review', 'references'], path)
    const phase = asTurnPhase(record.phase, `${path}.phase`)
    const speakerId = asString(record.speakerId, `${path}.speakerId`, {
      max: 64,
      pattern: /^[a-z0-9][a-z0-9-]*$/,
    })
    const speakerName = asString(record.speakerName, `${path}.speakerName`, { max: 80 })
    if (phase.startsWith('teacher-') && !personaIds.has(speakerId)) {
      fail(`${path}.speakerId`, 'config에 없는 교사 에이전트입니다.')
    }
    if (phase.startsWith('teacher-')) {
      const persona = config.personas.find((candidate) => candidate.id === speakerId)
      if (persona && speakerName !== persona.displayName) {
        fail(`${path}.speakerName`, '교사 에이전트 id의 displayName과 일치해야 합니다.')
      }
    }
    if (phase.startsWith('orchestrator-') && speakerId !== 'orchestrator') {
      fail(`${path}.speakerId`, '총괄 AI 턴의 speakerId는 orchestrator여야 합니다.')
    }
    if (phase.startsWith('orchestrator-') && speakerName !== '총괄 AI') {
      fail(`${path}.speakerName`, '총괄 AI 턴의 speakerName은 총괄 AI여야 합니다.')
    }
    return {
      phase,
      speakerId,
      speakerName,
      content: asString(record.content, `${path}.content`, { max: 12_000 }),
      ...(record.stepId === undefined ? {} : { stepId: asString(record.stepId, `${path}.stepId`, { max: 80 }) }),
      ...(record.round === undefined ? {} : { round: asInteger(record.round, `${path}.round`, 0, 2) }),
      ...(record.review === undefined ? {} : { review: parseReview(record.review, `${path}.review`) }),
      ...(record.references === undefined ? {} : { references: parseReferences(record.references, `${path}.references`) }),
    }
  })
  if (turns.reduce((sum, turn) => sum + turn.content.length, 0) > 180_000) {
    fail('request.discussion', '대화 본문 합계는 180,000자를 넘을 수 없습니다.')
  }
  return turns
}

function assertTurnPrerequisites(input: DemoTurnInput): void {
  const steps = getDemoActivityContract(input.activityCode).steps
  const stepId = input.stepId ?? steps[0].id
  const stepIndex = steps.findIndex(step => step.id === stepId)
  if (stepIndex < 0) fail('request.stepId', '활동에 없는 작업 단계입니다.')
  const matching = (phase: DemoTurnPhase, id?: string) => input.discussion.filter(turn =>
    turn.phase === phase && (id === undefined || (turn.stepId ?? steps[0].id) === id))
  const allTeachers = (turns: DemoDiscussionTurn[]) => input.config.personas.every(persona =>
    turns.filter(turn => turn.speakerId === persona.id).length === 1)
  const completeStep = (id: string) => matching('orchestrator-intro', id).length === 1
    && allTeachers(matching('teacher-contribution', id))
  const isWork = input.phase === 'orchestrator-intro' || input.phase === 'teacher-contribution'
  const requiredSteps = isWork ? steps.slice(0, stepIndex) : steps
  if (!requiredSteps.every(step => completeStep(step.id))) {
    fail('request.discussion', '이전 작업 단계마다 총괄 AI 제시와 모든 교사의 활동이 필요합니다.')
  }
  if (isWork) {
    if (input.discussion.some(turn => !['orchestrator-intro', 'teacher-contribution'].includes(turn.phase))) {
      fail('request.discussion', '작업 단계에 후속 검토 턴을 섞을 수 없습니다.')
    }
    if (steps.slice(stepIndex + 1).some(step => matching('orchestrator-intro', step.id).length)) {
      fail('request.discussion', '미래 작업 단계의 대화를 포함할 수 없습니다.')
    }
    const expectedIntros = input.phase === 'teacher-contribution' ? 1 : 0
    if (matching('orchestrator-intro', stepId).length !== expectedIntros || matching('teacher-contribution', stepId).length) {
      fail('request.discussion', '현재 작업은 AI 제시 후 동료의 현재 답변을 보지 않고 개별 활동해야 합니다.')
    }
    return
  }
  const responses = matching('teacher-response')
  if (input.phase === 'teacher-response') {
    if (responses.length || input.discussion.some(turn => ['orchestrator-synthesis', 'orchestrator-revision', 'teacher-review'].includes(turn.phase))) {
      fail('request.discussion', '동료 응답은 작업 완료 시점의 동일한 대화를 검토합니다.')
    }
    return
  }
  if (!allTeachers(responses)) fail('request.discussion', '모든 교사의 동료 응답이 필요합니다.')
  if (input.phase === 'orchestrator-synthesis') {
    if (input.discussion.some(turn => ['orchestrator-synthesis', 'orchestrator-revision', 'teacher-review'].includes(turn.phase))) {
      fail('request.discussion', '초안은 한 번 생성하고 이후에는 수정 단계를 사용합니다.')
    }
    return
  }
  if (!input.candidateArtifact) fail('request.candidateArtifact', '검토할 산출물 원문이 필요합니다.')
  const round = input.round ?? 0
  if (input.phase === 'teacher-review') {
    const proposalPhase = round === 0 ? 'orchestrator-synthesis' : 'orchestrator-revision'
    if (!input.discussion.some(turn => turn.phase === proposalPhase && (turn.round ?? 0) === round)) {
      fail('request.discussion', '검토 회차와 일치하는 산출물 제안이 필요합니다.')
    }
    if (matching('teacher-review').some(turn => (turn.round ?? 0) === round)) {
      fail('request.discussion', '교사 검토는 다른 교사의 같은 회차 결정 없이 독립 수행합니다.')
    }
  } else {
    const reviews = matching('teacher-review').filter(turn => (turn.round ?? 0) === round - 1)
    if (round < 1 || !allTeachers(reviews) || !reviews.some(turn => turn.review?.decision === 'revise')) {
      fail('request.discussion', '수정은 이전 회차 모든 교사의 검토와 실제 수정 요청이 있어야 합니다.')
    }
  }
}

function parseReview(value: unknown, path: string): DemoTeacherReview {
  const record = asRecord(value, path)
  assertExactKeys(record, ['decision', 'reason'], ['blockers', 'suggestions'], path)
  if (record.decision !== 'approve' && record.decision !== 'revise') fail(path, 'approve 또는 revise 결정이 필요합니다.')
  let blockers: DemoReviewBlocker[] | undefined
  if (record.blockers !== undefined) {
    if (!Array.isArray(record.blockers) || record.blockers.length > 5) fail(path, '필수 수정은 최대 5개 배열이어야 합니다.')
    blockers = record.blockers.map((item, index) => {
      const at = `${path}.blockers[${index}]`, block = asRecord(item, at)
      assertExactKeys(block, ['criterionId', 'sectionKey', 'evidence', 'issue', 'change'], [], at)
      return {
        criterionId: asString(block.criterionId, `${at}.criterionId`, { max: 40 }),
        sectionKey: asString(block.sectionKey, `${at}.sectionKey`, { max: 100 }),
        evidence: asString(block.evidence, `${at}.evidence`, { min: 5, max: 300 }),
        issue: asString(block.issue, `${at}.issue`, { min: 5, max: 600 }),
        change: asString(block.change, `${at}.change`, { min: 5, max: 1000 }),
      }
    })
  }
  return { decision: record.decision, reason: asString(record.reason, `${path}.reason`, { min: 5, max: 2000 }),
    ...(blockers === undefined ? {} : { blockers }),
    ...(record.suggestions === undefined ? {} : { suggestions: asStringArray(record.suggestions, `${path}.suggestions`, { maxItems: 5, itemMax: 600 }) }),
  }
}

function parseReferences(value: unknown, path: string): DemoTurnReference[] {
  if (!Array.isArray(value) || value.length > 5) fail(path, '인용은 최대 5개 배열이어야 합니다.')
  return value.map((item, index) => {
    const ref = asRecord(item, `${path}[${index}]`)
    assertExactKeys(ref, ['speakerId', 'quote'], [], path)
    return { speakerId: asString(ref.speakerId, `${path}.speakerId`, { max: 64 }), quote: asString(ref.quote, `${path}.quote`, { min: 5, max: 300 }) }
  })
}

function parseCandidate(value: unknown, code: ActivityCode): DemoGeneratedArtifact {
  const record = asRecord(value, 'request.candidateArtifact')
  assertExactKeys(record, ['activityCode', 'title', 'content'], [], 'request.candidateArtifact')
  if (record.activityCode !== code) fail('request.candidateArtifact', '현재 활동 산출물이어야 합니다.')
  const content = asRecord(record.content, 'request.candidateArtifact.content')
  assertExactKeys(content, getDemoArtifactSectionKeys(code), [], 'request.candidateArtifact.content')
  return { activityCode: code, title: asString(record.title, 'request.candidateArtifact.title', { max: 200 }),
    content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, asString(value, `candidate.${key}`, { max: 12_000 })])) }
}

export function parseDemoTurnInput(value: unknown): DemoTurnInput {
  const record = asRecord(value, 'request')
  assertExactKeys(record, [
    'phase', 'activityCode', 'config', 'priorArtifacts', 'discussion',
  ], ['teacherId', 'stepId', 'round', 'candidateArtifact', 'validationFeedback'], 'request')
  const phase = asTurnPhase(record.phase, 'request.phase')
  const config = parseDemoEngineConfig(record.config, 'request.config')
  const teacherId = record.teacherId === undefined
    ? undefined
    : asString(record.teacherId, 'request.teacherId', {
      max: 64,
      pattern: /^[a-z0-9][a-z0-9-]*$/,
    })
  const isTeacherPhase = phase.startsWith('teacher-')
  if (isTeacherPhase && !teacherId) {
    fail('request.teacherId', `${phase} 단계에는 teacherId가 필요합니다.`)
  }
  if (!isTeacherPhase && teacherId) {
    fail('request.teacherId', `${phase} 단계에는 teacherId를 보낼 수 없습니다.`)
  }
  if (teacherId && !config.personas.some((persona) => persona.id === teacherId)) {
    fail('request.teacherId', 'config에 없는 교사 에이전트입니다.')
  }
  const input: DemoTurnInput = {
    phase,
    activityCode: asActivityCode(record.activityCode, 'request.activityCode'),
    config,
    priorArtifacts: parsePriorArtifacts(record.priorArtifacts),
    discussion: parseDiscussion(record.discussion, config),
    ...(teacherId ? { teacherId } : {}),
    ...(record.stepId === undefined ? {} : { stepId: asString(record.stepId, 'request.stepId', { max: 80 }) }),
    ...(record.round === undefined ? {} : { round: asInteger(record.round, 'request.round', 0, 2) }),
    ...(record.candidateArtifact === undefined ? {} : { candidateArtifact: parseCandidate(record.candidateArtifact, asActivityCode(record.activityCode, 'request.activityCode')) }),
    ...(record.validationFeedback === undefined ? {} : { validationFeedback: asStringArray(record.validationFeedback, 'request.validationFeedback', { maxItems: 30, itemMax: 1000 }) }),
  }
  assertTurnPrerequisites(input)
  return input
}

function isStageBoundary(activityCode: ActivityCode): boolean {
  const stage = STAGES.find((item) => item.code === ACTIVITY_META[activityCode].stage)
  return stage?.activities.at(-1) === activityCode
}

export function getDemoArtifactSectionKeys(activityCode: ActivityCode): string[] {
  const meta = ACTIVITY_META[activityCode]
  const sections = meta.requiredSections ?? meta.recommendedSections ?? []
  return sections.map((section) => section.key)
}

export function parseDemoTurnModelOutput(
  value: unknown,
  input: DemoTurnInput,
): DemoTurnResponse {
  const record = asRecord(value, 'response')
  assertExactKeys(record, ['content', 'artifact', 'stageReport'], ['review', 'references'], 'response')
  const content = asString(record.content, 'response.content', { max: 12_000 })
  const exposedField = content.match(/\[(?:ARTIFACT_UPDATE|ACTIVITY_ADVANCE|ACTIVITY_RETURN|ACTION_CARD)\b|\b(?:artifact|stageReport|candidateArtifact|currentWorkStep|priorArtifacts|visibleDiscussion|completionCriteria|reviewCriteria|review\.decision|references)/i)
  if (exposedField) {
    fail('response.content', `대화 본문에 내부 필드명 '${exposedField[0]}'을 쓰지 마세요. 해당 단어를 '산출물/단계 보고서/현재 과제' 등의 한국어로 바꾸고 null이나 JSON 필드를 설명하는 문장은 삭제하세요. JSON 최상위 키는 스키마대로 유지합니다.`)
  }
  const isSynthesis = input.phase === 'orchestrator-synthesis' || input.phase === 'orchestrator-revision'
  const references = parseReferences(record.references ?? [], 'response.references')
  for (const ref of references) {
    if (!input.discussion.some(turn => turn.speakerId === ref.speakerId && turn.content.includes(ref.quote))) {
      fail('response.references', '인용문과 발화자는 실제 입력 대화에 정확히 일치해야 합니다.')
    }
  }
  const review = input.phase === 'teacher-review' ? parseReview(record.review, 'response.review') : undefined
  if (review) {
    if (!review.blockers || !review.suggestions) fail('response.review', '필수 수정 blockers와 후속 제안 suggestions를 각각 배열로 구분하세요.')
    if ((review.decision === 'revise') !== (review.blockers.length > 0)) fail('response.review', '필수 수정이 있을 때만 revise이며, approve에는 필수 수정이 없어야 합니다. 후속 제안은 승인 조건이 아닙니다.')
    const criteria = new Set(getDemoReviewCriteria(input.activityCode).map(item => item.id))
    for (const blocker of review.blockers) {
      if (!criteria.has(blocker.criterionId)) fail('response.review', '필수 수정은 제공된 고정 검토 기준의 ID에 연결해야 합니다. 새 기준을 추가하지 마세요.')
      const section = input.candidateArtifact?.content[blocker.sectionKey]
      if (!section || !section.includes(blocker.evidence)) fail('response.review', '필수 수정의 증거는 지정한 초안 섹션에서 5~300자를 원문 그대로 인용하세요. 누락 문제는 그 내용을 포함해야 할 인접 문구를 인용하세요.')
    }
  }
  if (input.phase !== 'teacher-review' && record.review != null) fail('response.review', '교사 검토 이외 턴은 null이어야 합니다.')

  if (!isSynthesis) {
    if (record.artifact !== null || record.stageReport !== null) {
      fail('response', '종합 이외 턴의 artifact와 stageReport는 null이어야 합니다.')
    }
    if (input.phase === 'orchestrator-intro' && input.activityCode === 'T-1-2' && input.stepId === 'priorities-veto') {
      const principleLines = content.split('\n').filter(line => /(?:하려면|되려면).+해야/.test(line) && /^\s*\|?\s*(?:\*\*)?[1-5](?:[.)\s|]|\*\*)/.test(line))
      if (principleLines.length < 3 || principleLines.length > 5) {
        fail('response.content', 'T-2 원칙 조정에서는 교사가 판단할 3~5개의 번호 있는 조건-행동 원칙 초안을 지금 제시해야 합니다. 번호 목록 또는 표에 각 원칙을 한 줄씩 쓰세요. 표를 나중에 제공하겠다는 약속으로 대체하지 마세요.')
      }
    }
    if (input.phase === 'orchestrator-intro' && input.activityCode === 'T-1-1') {
      const missingInvitees = input.config.personas
        .filter((persona) => !content.includes(persona.displayName))
        .map((persona) => persona.displayName)
      if (missingInvitees.length > 0) {
        fail('response.content', `첫 활동에서 초대한 교사 이름을 모두 소개해야 합니다. 누락: ${missingInvitees.join(', ')}`)
      }
    }
    if (input.phase === 'teacher-response') {
      const peerNames = input.config.personas
        .filter((persona) => persona.id !== input.teacherId)
        .map((persona) => persona.displayName)
      if (!peerNames.some((name) => content.includes(name))) {
        fail('response.content', '2차 발언에는 다른 교사 에이전트의 이름을 직접 언급해야 합니다.')
      }
      if (!references.some(ref => ref.speakerId !== input.teacherId && input.config.personas.some(p => p.id === ref.speakerId))) {
        fail('response.references', '실제 동료 교사의 발언을 최소 1개 정확히 인용해야 합니다.')
      }
    }
    return { content, ...(review ? { review } : {}), ...(references.length ? { references } : {}) }
  }

  if (record.artifact === null) fail('response.artifact', '종합 턴에는 산출물이 필요합니다.')
  const artifactRecord = asRecord(record.artifact, 'response.artifact')
  assertExactKeys(artifactRecord, ['title', 'sections'], [], 'response.artifact')
  if (!Array.isArray(artifactRecord.sections)) {
    fail('response.artifact.sections', '배열이어야 합니다.')
  }
  const expectedKeys = getDemoArtifactSectionKeys(input.activityCode)
  const sectionDefinitions = ACTIVITY_META[input.activityCode].requiredSections
    ?? ACTIVITY_META[input.activityCode].recommendedSections
    ?? []
  const sections = artifactRecord.sections.map((item, index) => {
    const path = `response.artifact.sections[${index}]`
    const section = asRecord(item, path)
    assertExactKeys(section, ['key', 'value'], [], path)
    const key = asString(section.key, `${path}.key`, { max: 100 })
    const definition = sectionDefinitions.find((candidate) => candidate.key === key)
    return {
      key,
      value: asString(section.value, `${path}.value`, {
        min: Math.max(3, definition?.minChars ?? 3),
        max: 12_000,
      }),
    }
  })
  const actualKeys = sections.map((section) => section.key)
  if (new Set(actualKeys).size !== actualKeys.length) {
    fail('response.artifact.sections', '섹션 키가 중복되었습니다.')
  }
  const missingKeys = expectedKeys.filter((key) => !actualKeys.includes(key))
  const unknownKeys = actualKeys.filter((key) => !expectedKeys.includes(key))
  if (missingKeys.length > 0 || unknownKeys.length > 0) {
    fail(
      'response.artifact.sections',
      `활동 섹션과 일치해야 합니다. 누락: ${missingKeys.join(', ') || '없음'}, 알 수 없음: ${unknownKeys.join(', ') || '없음'}`,
    )
  }

  const artifactContent = Object.fromEntries(sections.map(section => [section.key, section.value]))
  if (input.activityCode === 'E-1-1') {
    const observedIds = new Set(JSON.stringify(input.priorArtifacts['DI-2-1']?.content ?? {}).match(/SIM-\d+/g) ?? [])
    const citedIds = Object.values(artifactContent).join('\n').match(/SIM-\d+/g) ?? []
    if (!citedIds.length || citedIds.some(id => !observedIds.has(id))) {
      fail('response.artifact', `성찰은 DI의 실제 저장 장면 ID만 인용해야 합니다. 사용 가능: ${[...observedIds].join(', ') || '없음'}`)
    }
  }
  const issues = validateDemoArtifactContent(input.activityCode, artifactContent, input.config.personas.map(persona => persona.displayName))
  if (issues.length) throw new DemoValidationError(issues)

  let stageReport: DemoGeneratedStageReport | undefined
  if (isStageBoundary(input.activityCode)) {
    if (record.stageReport === null) fail('response.stageReport', '단계 마지막 활동에는 단계 보고서가 필요합니다.')
    const stageReportRecord = asRecord(record.stageReport, 'response.stageReport')
    assertExactKeys(stageReportRecord, ['stage', 'content'], [], 'response.stageReport')
    const expectedStage = ACTIVITY_META[input.activityCode].stage
    if (stageReportRecord.stage !== expectedStage) {
      fail('response.stageReport.stage', `현재 단계(${expectedStage})와 일치해야 합니다.`)
    }
    stageReport = {
      stage: expectedStage,
      content: asString(stageReportRecord.content, 'response.stageReport.content', { min: 20, max: 12_000 }),
    }
  } else if (record.stageReport !== null) {
    fail('response.stageReport', '단계 마지막 활동이 아니면 null이어야 합니다.')
  }

  return {
    content,
    artifact: {
      activityCode: input.activityCode,
      title: asString(artifactRecord.title, 'response.artifact.title', { max: 200 }),
      content: artifactContent,
    },
    ...(stageReport ? { stageReport } : {}),
    ...(references.length ? { references } : {}),
  }
}

export function assertExpandedConfigMatchesSetup(
  config: DemoEngineConfig,
  setup: DemoSetupInput,
): void {
  if (config.personas.length !== setup.teacherCount) {
    fail('response.config.personas', `요청한 ${setup.teacherCount}명과 일치해야 합니다.`)
  }
  const expectedIds = Array.from({ length: setup.teacherCount }, (_, index) => `teacher-${index + 1}`)
  const actualIds = config.personas.map((persona) => persona.id)
  if (actualIds.some((id, index) => id !== expectedIds[index])) {
    fail('response.config.personas', `id는 순서대로 ${expectedIds.join(', ')}여야 합니다.`)
  }
  if (config.lesson.schoolLevel !== setup.schoolLevel) {
    fail('response.config.lesson.schoolLevel', '요청 학교급과 일치해야 합니다.')
  }
  if (config.lesson.gradeGroup !== setup.gradeGroup) {
    fail('response.config.lesson.gradeGroup', '요청 학년군과 일치해야 합니다.')
  }
  if (
    config.lesson.subjects.length !== setup.subjects.length
    || config.lesson.subjects.some((subject, index) => subject !== setup.subjects[index])
  ) {
    fail('response.config.lesson.subjects', '요청 교과와 같은 순서로 일치해야 합니다.')
  }
}

export function isDemoValidationError(error: unknown): error is DemoValidationError {
  return error instanceof DemoValidationError
}

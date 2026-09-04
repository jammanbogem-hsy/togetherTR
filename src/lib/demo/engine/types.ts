import {
  ACTIVITY_META,
  STAGES,
  type ActivityCode,
  type GradeGroup,
  type SchoolLevel,
  type StageCode,
} from '@/types'

export const DEMO_TEACHER_COUNT_MIN = 2
export const DEMO_TEACHER_COUNT_MAX = 5

export const DEMO_TURN_PHASES = [
  'orchestrator-intro',
  'teacher-contribution',
  'teacher-response',
  'orchestrator-synthesis',
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
}

export interface DemoTurnInput {
  phase: DemoTurnPhase
  activityCode: ActivityCode
  config: DemoEngineConfig
  priorArtifacts: DemoPriorArtifacts
  discussion: DemoDiscussionTurn[]
  teacherId?: string
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
}

/** Raw shape required from the model before section arrays are normalized for Firestore. */
export interface DemoTurnModelOutput {
  content: string
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
    assertExactKeys(record, ['phase', 'speakerId', 'speakerName', 'content'], [], path)
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
      content: asString(record.content, `${path}.content`, { max: 8_000 }),
    }
  })
  if (turns.reduce((sum, turn) => sum + turn.content.length, 0) > 60_000) {
    fail('request.discussion', '대화 본문 합계는 60,000자를 넘을 수 없습니다.')
  }
  return turns
}

function assertTurnPrerequisites(input: DemoTurnInput): void {
  const intros = input.discussion.filter((turn) => turn.phase === 'orchestrator-intro')
  const contributions = input.discussion.filter((turn) => turn.phase === 'teacher-contribution')
  const responses = input.discussion.filter((turn) => turn.phase === 'teacher-response')
  const syntheses = input.discussion.filter((turn) => turn.phase === 'orchestrator-synthesis')
  const expectedIds = input.config.personas.map((persona) => persona.id)

  const countFor = (turns: DemoDiscussionTurn[], id: string) => (
    turns.filter((turn) => turn.speakerId === id).length
  )

  if (input.phase === 'orchestrator-intro' && input.discussion.length > 0) {
    fail('request.discussion', '총괄 AI의 활동 제시 전에는 현재 활동 대화를 보낼 수 없습니다.')
  }

  if (input.phase === 'teacher-contribution') {
    if (intros.length !== 1 || contributions.length > 0 || responses.length > 0 || syntheses.length > 0) {
      fail('request.discussion', '교사 1차 발언에는 총괄 AI의 활동 제시 한 턴만 필요합니다.')
    }
  }
  if (input.phase === 'teacher-response') {
    const invalidContributions = expectedIds.filter((id) => countFor(contributions, id) !== 1)
    if (intros.length !== 1 || invalidContributions.length > 0 || responses.length > 0 || syntheses.length > 0) {
      fail(
        'request.discussion',
        `모든 교사의 1차 발언이 정확히 한 번씩 필요합니다. 확인 필요: ${invalidContributions.join(', ') || '대화 순서'}`,
      )
    }
  }
  if (input.phase === 'orchestrator-synthesis') {
    const invalidContributions = expectedIds.filter((id) => countFor(contributions, id) !== 1)
    const invalidResponses = expectedIds.filter((id) => countFor(responses, id) !== 1)
    if (
      intros.length !== 1
      || invalidContributions.length > 0
      || invalidResponses.length > 0
      || syntheses.length > 0
    ) {
      fail(
        'request.discussion',
        `종합 전 모든 교사 턴이 정확히 한 번씩 필요합니다. 1차 확인: ${invalidContributions.join(', ') || '없음'}, 2차 확인: ${invalidResponses.join(', ') || '없음'}`,
      )
    }
  }
}

export function parseDemoTurnInput(value: unknown): DemoTurnInput {
  const record = asRecord(value, 'request')
  assertExactKeys(record, [
    'phase', 'activityCode', 'config', 'priorArtifacts', 'discussion',
  ], ['teacherId'], 'request')
  const phase = asTurnPhase(record.phase, 'request.phase')
  const config = parseDemoEngineConfig(record.config, 'request.config')
  const teacherId = record.teacherId === undefined
    ? undefined
    : asString(record.teacherId, 'request.teacherId', {
      max: 64,
      pattern: /^[a-z0-9][a-z0-9-]*$/,
    })
  const isTeacherPhase = phase === 'teacher-contribution' || phase === 'teacher-response'
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
  assertExactKeys(record, ['content', 'artifact', 'stageReport'], [], 'response')
  const content = asString(record.content, 'response.content', { max: 12_000 })
  const isSynthesis = input.phase === 'orchestrator-synthesis'

  if (!isSynthesis) {
    if (record.artifact !== null || record.stageReport !== null) {
      fail('response', '종합 이외 턴의 artifact와 stageReport는 null이어야 합니다.')
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
    }
    return { content }
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
      content: Object.fromEntries(sections.map((section) => [section.key, section.value])),
    },
    ...(stageReport ? { stageReport } : {}),
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

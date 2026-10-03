// 문제상황(Ds-1-2) 생성 로직 — 프롬프트 구성·응답 파싱·병합.
//
// 배경: Firebase Hosting은 요청 하나를 60초에서 끊는다(함수 제한 시간과 무관).
// 후보 3개의 상세를 한 번에 받으면 1분 30초를 넘겨 502로 실패했으므로,
// 생성을 두 단계로 나눠 각 요청이 60초 안에 끝나게 한다.
//   1) outline — 탐구 질문 + 후보 3개 요약 (짧은 응답)
//   2) detail  — 후보 하나의 상세 (후보마다 별도 요청, 클라이언트가 병렬 호출)
//
// 이 파일은 런타임 import 없이 순수 함수만 두어 node:test로 그대로 검증한다.
// (잘린 JSON 복구기는 호출부가 주입한다 — 라우트는 lib/llm/recoverJson을 넘긴다.)

import type { GraphSavedData } from '../knowledge-graph/domain'

// 잘린 JSON 응답을 복구하는 함수. 복구 불가면 null.
export type JsonRecover = (raw: string) => unknown | null

// ─── 결과 타입 (route.ts에서 re-export) ─────────────────────────────

export interface ProblemStandardAlignment {
  standardId: string   // 성취기준 코드
  subject: string      // 교과명
  isCenter: boolean    // 중심 성취기준 여부
  connection: string   // 문제상황 내 구체적 연결 설명
}
export interface ProblemRealData {
  label: string        // 출처명 및 설명
  url?: string         // 공개 URL (있는 경우)
}

// 각 후보가 모두 완전한 상세를 가진다 (책갈피 전환 시 재생성 없이 즉시 표시).
// 상세 필드는 옛 저장 데이터 호환과 outline 단계(상세 없음)를 위해 optional.
export interface ProblemScenarioCandidate {
  title: string
  scenario: string      // 2-3문장 요약 (탭/테이블 미리보기용)
  dataSources: string   // 활용 데이터/자료
  fullScenario?: string                          // 완전한 문제 상황 서술
  standardsAlignment?: ProblemStandardAlignment[] // 성취기준 연결
  realData?: ProblemRealData[]                    // 실제 데이터 출처
  learningContent?: string                        // 교과별 학습 내용
  artifacts?: string                              // 산출물 목록
  alignmentCheck?: string                         // AI 점검: 성취기준·평가 정합성
}

export interface ProblemSituationResult {
  candidates: ProblemScenarioCandidate[]
  recommended: {
    index: number         // candidates 인덱스 (0-2) — 추천 후보
    title: string
    fullScenario: string
    standardsAlignment: ProblemStandardAlignment[]
    realData: ProblemRealData[]
    learningContent: string
    artifacts: string
    alignmentCheck: string
  }
  drivingQuestion: string
  essentialQuestions: string[]
}

// detail 단계가 돌려주는 후보 하나의 상세.
export interface ProblemCandidateDetail {
  fullScenario: string
  standardsAlignment: ProblemStandardAlignment[]
  realData: ProblemRealData[]
  learningContent: string
  artifacts: string
  alignmentCheck: string
}

export type GeneratePhase = 'outline' | 'detail'

// 후보 상세는 두 조각으로 나눠 받는다. 한 요청에 다 담으면 50초에 육박해 60초 제한에 걸린다.
//   scenario → fullScenario · standardsAlignment · realData
//   plan     → learningContent · artifacts · alignmentCheck
export type DetailPart = 'scenario' | 'plan'
export const DETAIL_PARTS: readonly DetailPart[] = ['scenario', 'plan']

export interface ProblemSituationContext {
  projectTitle: string
  targetGradeGroup: string
  teamGradeBands?: string[]
  targetSubjects: string[]
  nodeContext: string
  achievementStandardsAnalysis?: string
  evaluationPlan?: string
  learningObjective?: string
  learnerProfile?: string
  /** T단계 팀 준비 산출물(비전·원칙 위주) 요약 */
  teamPreparation?: string
  /** Ds-2(내부 Ds-1-2) 대화의 최근 내용 — 신호 태그 제거·화자 표시·글자 수 상한 적용 */
  recentConversation?: string
}

export const CANDIDATE_COUNT = 3
// 출력 상한. 실측(Sonnet 4.6, 한국어) 약 50 tok/s이므로 각 요청이 Hosting 60초 제한 안에 끝나도록 잡는다.
// outline 실측 17초, 상세 한 조각은 절반으로 나눠 25초 안팎을 목표로 한다.
export const OUTLINE_MAX_TOKENS = 2500
export const DETAIL_MAX_TOKENS = 2000

// ─── 요청 단계 판별 ───────────────────────────────────────────────

export type ResolvedPhase =
  | { phase: 'outline' }
  | { phase: 'detail'; candidateIndex: number; part: DetailPart }
  | { error: string }

// phase 미지정은 outline으로 본다 (한 번에 전부 받는 옛 방식은 60초를 넘겨 폐기).
export function resolveGeneratePhase(body: Record<string, unknown>): ResolvedPhase {
  const phase = body.phase ?? 'outline'
  if (phase === 'outline') return { phase: 'outline' }
  if (phase !== 'detail') return { error: `알 수 없는 생성 단계입니다: ${String(phase)}` }

  const idx = body.candidateIndex
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= CANDIDATE_COUNT) {
    return { error: 'candidateIndex는 0 이상 2 이하의 정수여야 합니다.' }
  }
  const part = body.part
  if (part !== 'scenario' && part !== 'plan') {
    return { error: "part는 'scenario' 또는 'plan'이어야 합니다." }
  }
  const outline = body.outline as Partial<ProblemSituationResult> | undefined
  if (!outline || !Array.isArray(outline.candidates) || !outline.candidates[idx]) {
    return { error: 'detail 단계에는 outline 결과와 해당 후보가 필요합니다.' }
  }
  return { phase: 'detail', candidateIndex: idx, part }
}

// ─── 프롬프트 ───────────────────────────────────────────────────

export function buildNodeContext(
  centerNode: GraphSavedData['centerNode'],
  selectedStandards: GraphSavedData['selectedStandards'],
  agentNotes: GraphSavedData['agentNotes'],
): string {
  if (!centerNode && selectedStandards.length === 0) return '(성취기준 데이터 없음)'
  const noteMap = Object.fromEntries(agentNotes.map(n => [n.standardId, n]))
  const lines: string[] = []
  if (centerNode) {
    lines.push(`중심 성취기준: [${centerNode.id}] ${centerNode.label} (${centerNode.subjectId})`)
    lines.push(`  내용: ${centerNode.text}`)
    lines.push('')
    lines.push('연결된 성취기준:')
  }
  for (const s of selectedStandards) {
    if (centerNode && s.id === centerNode.id) continue
    const note = noteMap[s.id]
    lines.push(`  - [${s.id}] ${s.label} (${s.subjectId})`)
    if (note?.explanation) lines.push(`    교육적 연결: ${note.explanation}`)
    if (note?.teachingNote) lines.push(`    수업 팁: ${note.teachingNote}`)
  }
  return lines.join('\n')
}

const PERSONA = `당신은 초·중등 교과 융합 PBL 수업설계 전문가입니다.
교사팀이 제공한 성취기준, 평가 계획, 학습자 특성을 분석하여 교실 내 협력 학습을 위한 문제상황을 설계합니다.

중요: 이 문제상황은 교실 내 학생들의 협력적 수업 활동을 위한 것입니다. 외부 청중 발표보다 학생들의 탐구 과정과 교과 융합 학습에 초점을 맞추세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.`

function contextBlock(ctx: ProblemSituationContext): string {
  const teamGradeBands = ctx.teamGradeBands ?? []
  const teamGradeContext = teamGradeBands.length >= 2
    ? `\n팀 학년군: ${teamGradeBands.join(', ')} — 여러 학년군 협력 수업. 공통 문제상황 안에서 학년군별 학생 역할·과제·산출물 장면을 나누고, 성취기준 연결은 A-2-1 분석에 있는 성취기준에서 각 학년군을 고르게 포함한다. A-2-1 에 없는 성취기준을 새로 만들지 않는다.`
    : ''
  return `프로젝트 제목: ${ctx.projectTitle}
학년군: ${ctx.targetGradeGroup}${teamGradeContext}
교과: ${ctx.targetSubjects.join(', ')}

=== A-2-1 교과 융합 성취기준 분석 (팀이 도출한 분석 결과) ===
${ctx.achievementStandardsAnalysis ?? '(없음)'}

=== A-2-1 교과 융합 성취기준 (지식 그래프 노드) ===
${ctx.nodeContext}

=== A-2-2 통합 수업목표 ===
${ctx.learningObjective ?? '(없음)'}

=== A-2-3 학습자·맥락 프로필 ===
${ctx.learnerProfile ?? '(없음)'}

=== Ds-1-1 평가 계획 ===
${ctx.evaluationPlan ?? '(아직 수립되지 않음)'}${ctx.teamPreparation ? `

=== T단계 팀 준비 (비전·원칙·역할·규칙·일정) ===
${ctx.teamPreparation}` : ''}${ctx.recentConversation ? `

=== Ds-2 문제상황 대화의 최근 내용 (오래된 것은 생략) ===
${ctx.recentConversation}

⚠️ 우선순위: 대화의 합의가 위 확정 산출물과 충돌하면 확정 산출물을 우선하되, 대화에 나온 구체적 아이디어(소재·장면·학생 활동)는 시나리오 장면에 반영하세요. 팀 비전·원칙은 문제상황의 방향과 맞추세요.` : ''}`
}

export function buildOutlinePrompts(ctx: ProblemSituationContext): { system: string; user: string } {
  const system = `${PERSONA}

⚠️ 매우 중요 — 작성 순서를 반드시 지키세요: drivingQuestion → essentialQuestions → recommended → candidates 순서로, 탐구 질문과 하위 탐구 질문을 **가장 먼저** 작성하세요. 이 두 필드는 산출물의 핵심이므로 절대 비워두거나 누락하면 안 됩니다.

이 단계에서는 후보의 **요약만** 작성합니다. 전문·성취기준 연결·자료 출처 등 상세는 다음 단계에서 후보별로 따로 요청하므로 여기서는 쓰지 마세요.

{
  "drivingQuestion": "단원 전체를 관통하는 탐구 질문 1문장. 학생의 언어로 된 개방형 질문이며 완전한 물음표 문장으로 작성. (절대 비워두지 말 것)",
  "essentialQuestions": [
    "하위 탐구 질문 1 (완전한 물음표 문장)",
    "하위 탐구 질문 2 (완전한 물음표 문장)",
    "하위 탐구 질문 3 (완전한 물음표 문장)"
  ],
  "recommended": { "index": 0 },
  "candidates": [
    {
      "title": "제목 (10자 이내 키워드 형식)",
      "scenario": "문제 상황 요약. 학생들이 해결해야 할 실제적 맥락을 2-3문장으로 서술. 반드시 완전한 문장으로 작성.",
      "dataSources": "활용할 실제 데이터·자료 출처 (쉼표로 구분)"
    },
    { "title": "...", "scenario": "...", "dataSources": "..." },
    { "title": "...", "scenario": "...", "dataSources": "..." }
  ]
}

⚠️ recommended는 추천 후보의 candidates 인덱스(0~2)만 적으세요.
⚠️ candidates는 서로 뚜렷이 다른 맥락의 후보 3개여야 합니다.`

  const user = `다음 정보를 바탕으로 교과 융합 PBL 문제상황 후보를 설계해주세요:

${contextBlock(ctx)}

⚠️ 위 A단계 분석 결과(성취기준 분석, 수업목표, 학습자 프로필)와 평가 계획을 문제상황 설계의 핵심 근거로 삼으세요.
문제상황은 반드시 위 성취기준들이 자연스럽게 융합되고, 수업목표를 달성할 수 있으며, 학습자 특성에 맞아야 합니다.

JSON 형식으로만 응답하세요.`

  return { system, user }
}

const SCENARIO_PART_SCHEMA = `{
  "fullScenario": "완전한 문제 상황 서술. 학생들이 처한 실제적 맥락에서 출발하여 탐구해야 할 문제를 3-5문장으로 완전하게 서술. 반드시 완전한 문장으로 끝내세요.",
  "standardsAlignment": [
    {
      "standardId": "입력받은 성취기준 코드 그대로 (예: 6사03-01)",
      "subject": "교과명 (예: 사회)",
      "isCenter": true,
      "connection": "이 성취기준이 이 후보의 문제상황 어디에서 어떻게 구현되는지 1-2문장으로 구체적 설명"
    },
    {
      "standardId": "연계 성취기준 코드",
      "subject": "교과명",
      "isCenter": false,
      "connection": "연계 방식 설명"
    }
  ],
  "realData": [
    { "label": "출처명: 활용 방법 설명", "url": "https://실제공개URL (없으면 null)" }
  ]
}

standardsAlignment 작성 규칙:
- 입력된 모든 성취기준에 대해 항목을 생성할 것 (누락 금지)
- standardId는 입력된 코드에서 숫자+영문 부분만 추출 (예: sub_soc_6A03-01 → 6사03-01 형태로 교과 약어 포함)
- isCenter: true인 항목을 반드시 첫 번째에 배치
- connection은 "학생들이 ~함으로써 ~를 달성한다" 형태로 1-2문장으로 작성

realData 작성 규칙:
- 실제로 존재하는 공개 데이터·자료만 포함 (가상의 URL 금지), 3~5개
- 국가기관(교육부, 국가인권위원회 등) 공식 사이트 URL은 정확하게 기재
- URL이 불확실하면 null로 설정 (틀린 URL보다 null이 낫다)`

const PLAN_PART_SCHEMA = `{
  "learningContent": "이 후보에서 각 교과가 배울 핵심 개념·기능을 교과별로 구분하여 서술 (교과당 1-2문장)",
  "artifacts": "이 후보에서 학생들이 제작할 산출물 목록 (단계별로 구분, 3~5개)",
  "alignmentCheck": "이 후보가 성취기준·평가 계획과 어떻게 연결되는지, 교과 융합의 자연스러움, 학습자 특성 적합성을 분석한 AI 점검 내용 (4-6문장)"
}`

export function buildDetailPrompts(
  ctx: ProblemSituationContext,
  outline: ProblemSituationResult,
  candidateIndex: number,
  part: DetailPart,
): { system: string; user: string } {
  const candidate = outline.candidates[candidateIndex]
  const others = outline.candidates
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i !== candidateIndex)
    .map(({ c, i }) => `  ${i + 1}. ${c.title} — ${c.scenario}`)
    .join('\n')

  const system = `${PERSONA}

${part === 'scenario' ? SCENARIO_PART_SCHEMA : PLAN_PART_SCHEMA}`

  const task = part === 'scenario'
    ? '아래 문제상황 후보 하나의 **문제 상황 전문·성취기준 연결·실제 데이터**를 작성해주세요.'
    : '아래 문제상황 후보 하나의 **교과별 학습 내용·산출물·AI 점검**을 작성해주세요.'

  const user = `${task} 요약과 탐구 질문은 이미 확정되었으니 그 맥락을 그대로 이어받아 구체화합니다.

=== 상세를 작성할 후보 (${candidateIndex + 1}번) ===
제목: ${candidate.title}
요약: ${candidate.scenario}
활용 자료: ${candidate.dataSources}

=== 확정된 탐구 질문 ===
탐구 질문: ${outline.drivingQuestion || '(없음)'}
하위 탐구 질문:
${(outline.essentialQuestions ?? []).map((q, i) => `  ${i + 1}. ${q}`).join('\n') || '  (없음)'}

=== 다른 후보 (중복되지 않게 참고만) ===
${others || '  (없음)'}

${contextBlock(ctx)}

⚠️ 위 A단계 분석 결과와 평가 계획을 근거로, 이 후보의 문제상황이 성취기준 전부를 자연스럽게 융합하고 학습자 특성에 맞도록 상세를 작성하세요.

JSON 형식으로만 응답하세요.`

  return { system, user }
}

// ─── 응답 파싱 ───────────────────────────────────────────────────

// 마크다운 코드 블록을 벗기고 JSON 본문만 남긴다.
export function extractJsonBlock(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/(\{[\s\S]*\})/)
  return (braced ? braced[1] : raw).trim()
}

// JSON.parse 실패 시 주입된 복구기로 잘린 응답 복구를 시도한다.
export function parseJsonLoose(raw: string, recover?: JsonRecover): unknown | null {
  const text = extractJsonBlock(raw)
  try {
    return JSON.parse(text)
  } catch {
    return recover ? recover(text) : null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function normalizeQuestions(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map(q => q.trim())
    : []
}

function normalizeAlignment(v: unknown): ProblemStandardAlignment[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map(a => ({
      standardId: str(a.standardId),
      subject: str(a.subject),
      isCenter: a.isCenter === true,
      connection: str(a.connection),
    }))
    .filter(a => a.standardId.length > 0)
}

function normalizeRealData(v: unknown): ProblemRealData[] {
  if (!Array.isArray(v)) return []
  const items: ProblemRealData[] = []
  for (const d of v) {
    if (typeof d === 'string' && d.trim()) { items.push({ label: d.trim() }); continue }
    if (!d || typeof d !== 'object') continue
    const rec = d as Record<string, unknown>
    const label = str(rec.label)
    if (!label) continue
    const url = str(rec.url)
    items.push(url ? { label, url } : { label })
  }
  return items
}

// outline 응답 → 상세가 비어 있는 ProblemSituationResult.
// recommended는 후보 제목만 채운 자리표시자이며, 상세는 applyCandidateDetail로 채운다.
export function parseOutline(raw: string, recover?: JsonRecover): ProblemSituationResult | null {
  const parsed = parseJsonLoose(raw, recover)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  const candidates: ProblemScenarioCandidate[] = (Array.isArray(obj.candidates) ? obj.candidates : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(c => ({ title: str(c.title), scenario: str(c.scenario), dataSources: str(c.dataSources) }))
    .filter(c => c.title.length > 0)
    .slice(0, CANDIDATE_COUNT)
  if (candidates.length === 0) return null

  const rec = obj.recommended as Record<string, unknown> | undefined
  const recIdxRaw = typeof rec?.index === 'number' ? rec.index : 0
  const index = Math.min(Math.max(0, Math.floor(recIdxRaw)), candidates.length - 1)

  return {
    candidates,
    recommended: {
      index,
      title: candidates[index].title,
      fullScenario: '',
      standardsAlignment: [],
      realData: [],
      learningContent: '',
      artifacts: '',
      alignmentCheck: '',
    },
    drivingQuestion: str(obj.drivingQuestion),
    essentialQuestions: normalizeQuestions(obj.essentialQuestions),
  }
}

// detail 응답 → 해당 조각의 필드만 담은 부분 상세.
//   scenario 조각은 전문(fullScenario)이, plan 조각은 세 필드 중 하나라도 있어야 성공으로 본다.
export function parseCandidateDetail(
  raw: string,
  part: DetailPart,
  recover?: JsonRecover,
): Partial<ProblemCandidateDetail> | null {
  const parsed = parseJsonLoose(raw, recover)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  if (part === 'scenario') {
    const fullScenario = str(obj.fullScenario)
    if (!fullScenario) return null
    return {
      fullScenario,
      standardsAlignment: normalizeAlignment(obj.standardsAlignment),
      realData: normalizeRealData(obj.realData),
    }
  }

  const plan = {
    learningContent: str(obj.learningContent),
    artifacts: str(obj.artifacts),
    alignmentCheck: str(obj.alignmentCheck),
  }
  if (!plan.learningContent && !plan.artifacts && !plan.alignmentCheck) return null
  return plan
}

// ─── 병합 ───────────────────────────────────────────────────────

// 두 조각이 모두 들어왔는지 (전문 + 계획 필드 하나 이상).
export function hasCandidateDetail(result: ProblemSituationResult, index: number): boolean {
  const c = result.candidates[index]
  return !!c?.fullScenario && !!(c.learningContent || c.artifacts || c.alignmentCheck)
}

// 후보 index에 (부분) 상세를 채운 새 결과를 돌려준다. 추천 후보면 recommended도 함께 채운다.
export function applyCandidateDetail(
  result: ProblemSituationResult,
  index: number,
  detail: Partial<ProblemCandidateDetail>,
): ProblemSituationResult {
  const target = result.candidates[index]
  if (!target) return result
  const candidates = result.candidates.map((c, i) => (i === index ? { ...c, ...detail } : c))
  const recommended = result.recommended.index === index
    ? { ...result.recommended, ...detail, index, title: target.title }
    : result.recommended
  return { ...result, candidates, recommended }
}

import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Ds-1-2 "문제 상황 설정" 산출물용 AI 제안 API. (2-mode + basedOn + customPrompts)
//  - artifact: 채팅에서 이미 생성된 Ds-1-2 산출물(existingArtifact)을 출발점으로 정교화
//  - chat:    빈 워크스페이스 — 팀 채팅 대화(chatContext)에서 맥락 단서를 읽고 시나리오 초안 작성
// 문제상황 = 실제성·학습내용+산출물·청중+행위 3행 + 탐구 질문(Driving Question).

export interface ProblemSituationScenario {
  title: string
  authenticity: string   // 행1 실제성
  contentProduct: string // 행2 학습 내용+산출물
  audienceAction: string // 행3 청중+행위
}

export interface ProblemSituationSuggestRequest {
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이전 단계 산출물 */
  integratedGoal?: string         // A-2-2 통합 수업목표
  subjectGoals?: Array<{ subject: string; goal: string }>
  learnerProfile?: string         // A-2-3 학습자·맥락 요약
  evaluationPlan?: string         // Ds-1-1 평가 계획 요약 (문제상황이 이 평가를 이끌어내야 함)
  currentDraft?: { scenario?: Partial<ProblemSituationScenario>; drivingQuestion?: string }
  mode?: 'artifact' | 'chat'
  existingArtifact?: { scenario?: Partial<ProblemSituationScenario>; drivingQuestion?: string }
  chatContext?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  customPrompts?: Array<{ teacherName: string; text: string }>
}

export interface ProblemSituationSuggestResult {
  scenario: ProblemSituationScenario
  drivingQuestion: string
  rationale?: string
  basedOn?: {
    mode: 'artifact' | 'chat'
    summary: string
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중·고 협력적 수업설계의 문제 상황 설정 코치입니다.
Ds-1-2 "문제 상황 설정" 산출물의 추천 형식(시나리오 3행 + 탐구 질문)에 맞춰 두 가지 모드 중 하나로 제안합니다.
문제 상황은 학습자가 수업에 발을 들이는 출발점이자 이후 모든 학습활동을 이끄는 핵심 맥락입니다. 단순한 흥미 유발 장치가 아니라 학생 역할·해결 과제·제약 조건·산출물 요구가 함께 드러나, 학생이 무엇을 판단하고 무엇을 만들어야 하는지 분명해야 합니다. 실생활 맥락은 흥미만이 아니라 '학생이 실제로 데이터를 모으고 개선안을 낼 수 있는가', '수업 시간 안에 다룰 수 있는가'를 기준으로 고르고, 완성한 상황이 Ds-1-1 평가 요소(결과·과정)와 정합하는지 점검하되 평가에 맞추려다 탐구 여지를 막는 과도한 구조화는 피합니다. 서술 수준은 학생용 제시문에 곧바로 쓸 만큼 쉽고 간결하게 합니다. AI가 내놓는 제시문은 결론이 아니라 후보·초안이며, 최종 확정은 교사팀의 몫입니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 시나리오·탐구 질문을 존중하되, 모호하거나 평가 연결이 약한 부분을 정교화합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀 채팅 대화(chatContext)에서 언급된 실생활 맥락·학생 역할·산출물 단서를 읽고, A-2-2 통합 목표·Ds-1-1 평가와 결합해 시나리오 초안을 작성합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "scenario": {
    "title": "문제상황 제목",
    "authenticity": "행1 실제성 — 실제 데이터·청중·맥락이 있는 문제 서술. 학생들이 처한 현실 장면으로 시작하되 해결이 필요한 이유가 드러나게",
    "contentProduct": "행2 학습 내용+산출물 — 학생 역할 + 각 교과 학습 내용 + 해결 과제 + 제약 조건(예: 예산·기한 등, 있을 때) + 최종 제출 산출물 요구",
    "audienceAction": "행3 청중+행위 — 구체적 청중(이름/직책 있는 실존 인물·집단) + 발표/제출 방식"
  },
  "drivingQuestion": "단원 전체를 관통하는 단 하나의 탐구 질문 (개방형, 학생 언어, 행동 유도)",
  "rationale": "이 문제상황이 A-2-2 목표·Ds-1-1 평가와 어떻게 연결되는지 1-2문장 (선택)",
  "basedOn": {
    "mode": "artifact 또는 chat",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영', 산출물 모드면 '기존 산출물의 ~을 정교화' 식.",
    "references": [ { "source": "채팅: 김나희 / 산출물: 행2 등", "text": "구체 인용 한두 줄" } ]
  }
}

작성 규칙:
- 문제상황은 '흥미 유발 문장'으로 끝나지 않는다. 학생이 어떤 판단을 하고 어떤 결과(산출물)를 만들어야 하는지가 자연스럽게 드러나야 한다.
- 학생 역할·해결 과제·제약 조건·산출물 요구가 상황 안에 함께 드러나되, 서술은 학생용 제시문에 바로 쓸 만큼 쉽고 간결하게(학년군 수준의 언어로).
- 실생활 맥락은 흥미만이 아니라 '학생이 실제로 데이터를 모으고 개선안을 낼 수 있는가'와 '수업 시간 안에 다룰 수 있는가'를 기준으로 판단.
- A-2-2 통합 수업목표와 Ds-1-1 평가 요소(결과·과정)가 시나리오 안에서 자연스럽게 이끌어 내져야 한다. 다만 평가에 맞추려다 정답 경로를 미리 정해 주는 과도한 구조화는 피해 탐구 여지를 남긴다.
- 너무 길거나 극적이지 않게. 학생이 바로 이해할 수 있는 서사 + 탐구 여지 사이 균형.
- 탐구 질문은 yes/no로 답할 수 없는 개방형, 학생이 직접 읽을 언어.
- 본문에 마크다운·코드 블록·추가 설명 절대 금지 (JSON만).
- 존중하는 동료 교사 어조.
`

function resolveMode(body: ProblemSituationSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const ea = body.existingArtifact
  const has = !!(ea?.scenario && (ea.scenario.title || ea.scenario.authenticity || ea.scenario.contentProduct)) || !!ea?.drivingQuestion?.trim()
  return has ? 'artifact' : 'chat'
}

function buildUserPrompt(body: ProblemSituationSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에 어느 행을 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 채팅 대화에서 누가 어떤 맥락을 언급했는지 읽고 반영하세요.')
  lines.push('')
  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }
  if (body.integratedGoal?.trim()) {
    lines.push('### A-2-2 통합 수업목표 (문제상황이 이 목표를 구현해야 함)')
    lines.push(body.integratedGoal.trim())
    lines.push('')
  }
  if (body.subjectGoals?.length) {
    lines.push('### A-2-2 교과별 수업목표')
    for (const sg of body.subjectGoals) {
      if (!sg.subject && !sg.goal) continue
      lines.push(`- ${sg.subject || '(교과)'}: ${sg.goal || ''}`)
    }
    lines.push('')
  }
  if (body.evaluationPlan?.trim()) {
    lines.push('### Ds-1-1 평가 계획 (문제상황이 이 평가를 이끌어내야 함)')
    lines.push(body.evaluationPlan.trim().slice(0, 1000))
    lines.push('')
  }
  if (body.learnerProfile?.trim()) {
    lines.push('### A-2-3 학습자·맥락 (실제성·흥미성 판단 기준)')
    lines.push(body.learnerProfile.trim().slice(0, 800))
    lines.push('')
  }
  if (mode === 'artifact' && body.existingArtifact) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 정교화)')
    const s = body.existingArtifact.scenario
    if (s?.title) lines.push(`- 제목: ${s.title}`)
    if (s?.authenticity) lines.push(`- 행1 실제성: ${s.authenticity}`)
    if (s?.contentProduct) lines.push(`- 행2 학습내용+산출물: ${s.contentProduct}`)
    if (s?.audienceAction) lines.push(`- 행3 청중+행위: ${s.audienceAction}`)
    if (body.existingArtifact.drivingQuestion) lines.push(`- 탐구 질문: ${body.existingArtifact.drivingQuestion}`)
    lines.push('')
  }
  if (mode === 'chat' && body.chatContext && body.chatContext.length > 0) {
    lines.push('### 팀 채팅 대화 (시간순)')
    for (const msg of body.chatContext) {
      const speaker = msg.role === 'assistant' ? 'AI' : (msg.displayName?.trim() || '팀원')
      const text = (msg.content ?? '').trim().slice(0, 500)
      if (text) lines.push(`- [${speaker}] ${text}`)
    }
    lines.push('')
  }
  if (body.currentDraft && (body.currentDraft.scenario || body.currentDraft.drivingQuestion)) {
    lines.push('### 현재 워크스페이스 초안 (중복/누락 참고)')
    const s = body.currentDraft.scenario
    if (s?.title) lines.push(`- 제목: ${s.title}`)
    if (s?.authenticity) lines.push(`- 행1: ${s.authenticity}`)
    if (s?.contentProduct) lines.push(`- 행2: ${s.contentProduct}`)
    if (s?.audienceAction) lines.push(`- 행3: ${s.audienceAction}`)
    if (body.currentDraft.drivingQuestion) lines.push(`- 탐구 질문: ${body.currentDraft.drivingQuestion}`)
    lines.push('')
  }
  if (body.customPrompts && body.customPrompts.length > 0) {
    const meaningful = body.customPrompts.filter(p => (p.text ?? '').trim().length > 0)
    if (meaningful.length > 0) {
      lines.push('### 팀원별 추가 요청 (협업 프롬프트 — 각 팀원이 자기 의견을 직접 적은 것)')
      lines.push('이 의견들을 모두 의미 있게 반영하되, 충돌하면 다수 의견 또는 수업목표·평가와의 정합성을 우선으로 합의안을 만드세요. basedOn에 어떤 팀원의 의견을 어떻게 반영했는지 명시하세요.')
      for (const p of meaningful) lines.push(`- ${p.teacherName || '팀원'}: ${p.text.trim()}`)
      lines.push('')
    }
  }
  lines.push('위 정보를 종합하여 문제상황 산출물 형식의 JSON으로만 응답하세요. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProblemSituationSuggestRequest
    const hasContext = !!body.integratedGoal?.trim() ||
      !!(body.subjectGoals && body.subjectGoals.length > 0) ||
      !!body.evaluationPlan?.trim() ||
      !!(body.currentDraft && (body.currentDraft.scenario || body.currentDraft.drivingQuestion)) ||
      !!body.existingArtifact ||
      !!(body.chatContext && body.chatContext.length > 0)
    if (!hasContext) {
      return Response.json({ error: 'A-2-2 통합 수업목표·Ds-1-1 평가 계획이 아직 준비되지 않아 문제상황을 제안할 수 없습니다.' }, { status: 400 })
    }
    const mode = resolveMode(body)
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3072,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })
    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText
    let result: ProblemSituationSuggestResult
    try {
      result = JSON.parse(jsonStr.trim()) as ProblemSituationSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 })
      }
      result = recovered as ProblemSituationSuggestResult
    }
    result.scenario = result.scenario ?? { title: '', authenticity: '', contentProduct: '', audienceAction: '' }
    result.drivingQuestion = result.drivingQuestion ?? ''
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

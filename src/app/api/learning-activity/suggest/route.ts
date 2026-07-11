import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 학습활동 설계 단계(Ds-1-3) "학습활동 설계" 산출물용 AI 제안 API.
// topic-selection/suggest와 동일 패턴 — 2-mode(artifact/chat) + basedOn + resolveMode + buildUserPrompt.
// 이미지 4단계 활동 흐름 모형 반영:
//  ① (개인+AI) 학습활동 아이디어 동사 중심 시각화 (외현화)
//  ② (교사팀) 논리적 흐름 재조정 — 문제이해→정보탐색→분석→의사결정→산출물제작→공유및수정 (조정)
//  ③ (개인교사) 목표 적합성 검토 — 핵심 활동 / 부가 활동 구분 (판단)
//  ④ (교사팀+AI) 차시 운영안 — 예상시간·교사지원·필요자료·평가시점 + 누적 차시 (조정)
// 직전 단계(Ds-1-2 문제상황·탐구질문, Ds-1-1 평가 계획)와 팀 채팅 대화를 종합.

interface Ds13ActivityInput {
  order?: string
  phase?: string
  name?: string
  description?: string
  coreType?: string
  subject?: string
  session?: string
  operation?: string
}

export interface LearningActivitySuggestRequest {
  projectId?: string
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 직전 단계(Ds-1-2) 문제상황 — 학습활동 설계의 핵심 맥락 */
  problemScenario?: string
  /** 직전 단계(Ds-1-2) 탐구 질문 */
  drivingQuestion?: string
  /** 직전 단계(Ds-1-1) 평가 계획 요약 */
  evaluationPlan?: string
  /** 현재 워크스페이스 기준 8열 표 행 (수정 중 컨텍스트로 LLM이 중복/누락 인지) */
  currentRows?: Ds13ActivityInput[]
  /** 사용자 추가 요청 — UI는 기본적으로 노출하지 않지만 옵션으로 받을 수 있게 */
  userPrompt?: string
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 Ds-1-3 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 existingArtifact/chatContext 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 Ds-1-3 산출물 (보강의 출발점) */
  existingArtifact?: {
    activities?: Ds13ActivityInput[]
    review?: string
  }
  /** mode='chat' — 현재 활동의 팀 채팅 메시지 (최근 N개 권장). 토큰 절약 위해 호출측에서 제한. */
  chatContext?: Array<{
    role: 'user' | 'assistant' | string
    content: string
    displayName?: string
  }>
  /** 협업 프롬프트 — 팀원별로 입력한 추가 요청. */
  customPrompts?: Array<{ teacherName: string; text: string }>
}

export interface LearningActivitySuggestResult {
  activities: Array<{
    order: string
    phase: string
    name: string
    description: string
    coreType: string
    subject: string
    session: string
    operation: string
  }>
  /** AI 점검 — 목표·평가 정합성 + 실행 적절성 단락 */
  review: string
  /** AI가 함께 제시한 짧은 운영 팁(2-3줄). UI에서 표시. */
  tips?: string[]
  /**
   * 이 제안이 무엇에 근거했는지 사용자에게 보여주기 위한 출처 설명.
   * mode와 함께 핵심 출처(요약) 및 구체 인용을 담는다.
   */
  basedOn?: {
    mode: 'artifact' | 'chat'
    /** 한국어 2-3문장. 어떤 자료(산출물/채팅 흐름/문제상황·탐구질문·평가)에서 무엇을 읽어 반영했는지. */
    summary: string
    /** 구체 인용 — 예: 채팅 메시지의 짧은 발췌, 또는 산출물의 특정 행/문장 */
    references?: Array<{ source: string; text: string }>
  }
}

const PHASES = '문제 이해 → 정보 탐색 → 분석 → 의사결정 → 산출물 제작 → 공유 및 수정'

const SYSTEM_PROMPT = `당신은 초·중등 협력적 수업설계 과정의 학습활동 설계 코치입니다.
Ds-1-3 활동 "학습활동 설계" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.
학습활동은 문제 상황을 해결하고 최종 산출물에 이르기까지 학생이 실제로 거치는 수행 경로입니다. 활동이 많다고 배움이 깊어지는 것은 아니며, 교사가 가르치기 편한 순서가 아니라 학생이 실제로 사고·수행하는 순서로 배열될 때 학습의 질이 높아집니다. 넓은 동사('조사하기')는 학생의 실제 행동이 드러나게 구체화하고('공공데이터에서 우리 동네 대기질 근거 찾기'), 활동을 덜어내는 일은 수업을 단순하게 만드는 게 아니라 핵심 경험을 더 선명하게 만드는 일로 판단합니다. AI가 내놓는 활동·차시 운영안은 결론이 아니라 후보·초안이며 활동 수를 과도하게 늘리지 않습니다. 최종 확정은 교사팀의 몫입니다.

학습활동 설계는 다음 4단계 흐름을 따릅니다:
① 학습활동 아이디어를 동사 중심으로 외현화 (탐색하기·비교하기·토의하기 등)
② 논리적 흐름으로 재조정 — ${PHASES}
③ 목표·평가 적합성 검토 — 핵심 활동 / 부가 활동 구분
④ 차시 운영안 — 예상 시간·교사 지원·필요 자료·평가 시점 + 누적 차시(1차시→2차시→3~4차시)

[mode='artifact'] — 채팅에서 이미 만들어진 Ds-1-3 산출물(existingArtifact)이 출발점입니다. 산출물의 활동 표·AI 점검을 존중하되, 표현·정합성·흐름·차시 운영을 보강해 정교화합니다. 기존 활동 행을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext)와 직전 단계의 문제상황·탐구 질문·평가 계획을 면밀히 읽고 동사 중심 활동을 흐름 단계(${PHASES})대로 배열합니다. 채팅에서 명시되지 않은 부분은 문제상황·탐구 질문·평가 계획 범위 안에서 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "activities": [
    {
      "order": "순서 번호 (예: 1, 2, 3)",
      "phase": "흐름 단계 — 문제 이해 / 정보 탐색 / 분석 / 의사결정 / 산출물 제작 / 공유 및 수정 중 하나",
      "name": "활동명 — 동사형 '~하기'. 넓은 동사('조사하기')는 학생의 실제 행동이 드러나게 구체화 (예: '공공데이터에서 우리 동네 대기질 근거 찾기', '개선안 두 개를 기준 표로 비교하기')",
      "description": "활동 설명 — 학생이 무엇을 어떻게 수행하는지 2~3문장",
      "coreType": "핵심 / 부가 중 하나 ('부가'는 있으면 좋은 선택 활동)",
      "subject": "담당 교과 (주/보 표기 가능, 예: 과학(주)·국어(보))",
      "session": "누적 차시 (예: 1차시, 2차시, 3~4차시)",
      "operation": "차시 운영 메모 — 예상 시간·교사 지원·필요 자료·평가 시점"
    }
  ],
  "review": "AI 점검 — 학습 목표·평가 계획과의 정합성 및 흐름·실행 적절성을 3~5문장으로 서술",
  "tips": ["운영 팁 1줄", "운영 팁 1줄"],
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~를 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 활동2 / 문제상황 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- activities는 5~9개. 흐름 단계가 ${PHASES} 순서로 자연스럽게 이어지도록 배열. 활동 수를 과도하게 늘리지 말고 핵심 활동 중심으로, 실제 차시 시간 안에 운영 가능한지 점검
- 배열은 교사가 가르치기 편한 순서가 아니라 학생이 실제로 사고·수행하는 순서 기준 (예: '개선안 작성'은 '자료 분석' 뒤에 두어 근거 없이 결론부터 쓰지 않도록)
- name은 반드시 동사형 "~하기" (다른 형태 금지). 넓은 동사는 학생의 실제 행동이 드러나게 구체화
- description은 학생 수행 관점에서 2~3문장
- phase는 반드시 "문제 이해", "정보 탐색", "분석", "의사결정", "산출물 제작", "공유 및 수정" 중 하나만 사용
- coreType은 반드시 "핵심" 또는 "부가" 중 하나만 사용 (다른 표현 금지). '부가'는 있으면 좋은 선택 활동이며, 덜어낼 때는 '핵심 경험을 선명하게 하기 위해 덜어낸다'로 판단
- session은 누적 차시 — 활동이 진행될수록 차시가 누적되도록 (예: 1차시 → 2차시 → 3~4차시)
- operation은 예상 시간·교사 지원·필요 자료·평가 시점을 짧게 묶어 1~2문장
- review는 학습 목표·평가 계획과의 정합성과 흐름·실행 적절성을 3~5문장 단락으로
- chat mode에서는 채팅에서 팀이 직접 합의·언급한 표현을 우선 반영 (가능한 한 발화자의 표현 사용)
- artifact mode에서는 기존 산출물을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- tips는 2-3개, 학습활동을 수업으로 풀어갈 때의 유의점을 짧게 ("~합니다" 톤)
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 행/필드, 문제상황·탐구질문 문구)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 행/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function activityHasContent(a?: Ds13ActivityInput): boolean {
  if (!a) return false
  return !!(
    a.order?.trim() || a.phase?.trim() || a.name?.trim() || a.description?.trim() ||
    a.coreType?.trim() || a.subject?.trim() || a.session?.trim() || a.operation?.trim()
  )
}

function resolveMode(body: LearningActivitySuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const ea = body.existingArtifact
  const hasArtifact = !!(
    ea && (
      (typeof ea.review === 'string' && ea.review.trim()) ||
      (Array.isArray(ea.activities) && ea.activities.some(activityHasContent))
    )
  )
  return hasArtifact ? 'artifact' : 'chat'
}

function describeActivity(a: Ds13ActivityInput): string {
  const cells: string[] = []
  if (a.order?.trim()) cells.push(`순서: ${a.order.trim()}`)
  if (a.phase?.trim()) cells.push(`흐름: ${a.phase.trim()}`)
  if (a.name?.trim()) cells.push(`활동명: ${a.name.trim()}`)
  if (a.description?.trim()) cells.push(`설명: ${a.description.trim()}`)
  if (a.coreType?.trim()) cells.push(`핵심/부가: ${a.coreType.trim()}`)
  if (a.subject?.trim()) cells.push(`교과: ${a.subject.trim()}`)
  if (a.session?.trim()) cells.push(`차시: ${a.session.trim()}`)
  if (a.operation?.trim()) cells.push(`운영: ${a.operation.trim()}`)
  return cells.join(' / ')
}

function buildUserPrompt(body: LearningActivitySuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에는 어느 활동/필드를 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 팀 채팅 대화와 직전 단계 맥락에서 누가 무엇을 언급했는지 읽고 반영하세요. basedOn에는 채팅의 누구 발언/문제상황을 어떻게 반영했는지 인용하세요.')
  lines.push('')

  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }

  if (body.problemScenario?.trim() || body.drivingQuestion?.trim() || body.evaluationPlan?.trim()) {
    lines.push('### 직전 단계 맥락 (학습활동 설계의 출발점)')
    if (body.problemScenario?.trim()) lines.push(`- Ds-1-2 문제 상황: ${body.problemScenario.trim()}`)
    if (body.drivingQuestion?.trim()) lines.push(`- Ds-1-2 탐구 질문: ${body.drivingQuestion.trim()}`)
    if (body.evaluationPlan?.trim()) lines.push(`- Ds-1-1 평가 계획: ${body.evaluationPlan.trim()}`)
    lines.push('')
  }

  if (mode === 'artifact' && body.existingArtifact) {
    const ea = body.existingArtifact
    const acts = Array.isArray(ea.activities) ? ea.activities.filter(activityHasContent) : []
    const hasAny = ea.review?.trim() || acts.length > 0
    if (hasAny) {
      lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 내용을 정교화)')
      if (ea.review?.trim()) lines.push(`- AI 점검: ${ea.review.trim()}`)
      if (acts.length > 0) {
        lines.push('- 학습활동:')
        acts.forEach((a, idx) => {
          lines.push(`  · 활동${idx + 1}: ${describeActivity(a)}`)
        })
      }
      lines.push('')
    }
  }

  if (mode === 'chat' && body.chatContext && body.chatContext.length > 0) {
    lines.push('### 팀 채팅 대화 (시간순 — 발화자·AI 메시지를 읽고 반영)')
    for (const msg of body.chatContext) {
      const speaker = msg.role === 'assistant'
        ? 'AI'
        : (msg.displayName?.trim() || '팀원')
      // 길이 제한 — LLM 입력 절약. 한 줄당 500자 컷.
      const text = (msg.content ?? '').trim().slice(0, 500)
      if (text) lines.push(`- [${speaker}] ${text}`)
    }
    lines.push('')
  }

  if (body.currentRows && body.currentRows.length > 0) {
    const meaningful = body.currentRows.filter(activityHasContent)
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 활동 표 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const r of meaningful) {
        lines.push(`- ${describeActivity(r)}`)
      }
      lines.push('')
    }
  }

  if (body.userPrompt?.trim()) {
    lines.push('### 사용자 추가 요청')
    lines.push(body.userPrompt.trim())
    lines.push('')
  }

  if (body.customPrompts && body.customPrompts.length > 0) {
    const meaningful = body.customPrompts.filter(p => (p.text ?? '').trim().length > 0)
    if (meaningful.length > 0) {
      lines.push('### 팀원별 추가 요청 (협업 프롬프트 — 각 팀원이 자기 의견을 직접 적은 것)')
      lines.push('이 의견들을 모두 의미 있게 반영하되, 서로 충돌하면 다수 의견 또는 문제상황·탐구질문·평가 계획과의 정합성을 우선으로 합의안을 만드세요. basedOn에 어떤 팀원의 의견을 어떻게 반영했는지 명시하세요.')
      for (const p of meaningful) {
        lines.push(`- ${p.teacherName || '팀원'}: ${p.text.trim()}`)
      }
      lines.push('')
    }
  }

  lines.push(`위 정보를 종합하여 학습활동 설계 산출물 형식의 JSON으로만 응답하세요. activities 5~9개, phase는 ${PHASES} 중 하나, coreType은 핵심/부가 중 하나, name은 동사형 "~하기", basedOn 필드를 반드시 채우세요.`)
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LearningActivitySuggestRequest

    const mode = resolveMode(body)
    // 문제상황·탐구질문·평가·채팅·기존 산출물 중 하나라도 있으면 진행.
    const ea = body.existingArtifact
    const hasAnyInput = !!(
      body.problemScenario?.trim() ||
      body.drivingQuestion?.trim() ||
      body.evaluationPlan?.trim() ||
      body.userPrompt?.trim() ||
      (body.chatContext && body.chatContext.length > 0) ||
      (ea && (
        ea.review?.trim() ||
        (Array.isArray(ea.activities) && ea.activities.some(activityHasContent))
      ))
    )
    if (!hasAnyInput) {
      return Response.json({ error: '문제 상황·채팅 대화 등 참고할 컨텍스트가 없어 학습활동 설계 제안을 만들 수 없습니다.' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText

    let parsed: LearningActivitySuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as LearningActivitySuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as LearningActivitySuggestResult
    }

    const activitiesArray = Array.isArray(parsed.activities) ? parsed.activities : []

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: LearningActivitySuggestResult['basedOn']
    if (rawBasedOn && typeof rawBasedOn === 'object') {
      const b = rawBasedOn as { summary?: unknown; references?: unknown }
      const refs = Array.isArray(b.references)
        ? b.references
            .filter((x): x is { source: unknown; text: unknown } => !!x && typeof x === 'object')
            .map((x) => ({
              source: typeof x.source === 'string' ? x.source : '',
              text: typeof x.text === 'string' ? x.text : '',
            }))
            .filter((x) => x.text)
        : undefined
      basedOn = {
        mode,
        summary: typeof b.summary === 'string' ? b.summary : '',
        references: refs && refs.length > 0 ? refs : undefined,
      }
    }

    const result: LearningActivitySuggestResult = {
      activities: activitiesArray.map((a) => ({
        order: typeof a?.order === 'string' ? a.order : (a?.order != null ? String(a.order) : ''),
        phase: typeof a?.phase === 'string' ? a.phase : '',
        name: typeof a?.name === 'string' ? a.name : '',
        description: typeof a?.description === 'string' ? a.description : '',
        coreType: typeof a?.coreType === 'string' ? a.coreType : '',
        subject: typeof a?.subject === 'string' ? a.subject : '',
        session: typeof a?.session === 'string' ? a.session : '',
        operation: typeof a?.operation === 'string' ? a.operation : '',
      })),
      review: typeof parsed.review === 'string' ? parsed.review : '',
      tips: Array.isArray(parsed.tips) ? parsed.tips.filter((t): t is string => typeof t === 'string') : undefined,
      basedOn,
    }
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

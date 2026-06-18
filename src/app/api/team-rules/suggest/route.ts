import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 팀 규칙 수립 단계(T-2-2) "팀 규칙" 산출물용 AI 제안 API.
// role-distribution/suggest와 동일 패턴 — 직전 단계(T-1-1 팀 비전, T-2-1 역할 배분)와 팀 채팅/산출물을 종합하여 한 번에 제안.

export interface TeamRulesSuggestRequest {
  projectId?: string
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 현재 워크스페이스 표 행 (수정 중 컨텍스트로 LLM이 중복/누락 인지) */
  currentRows?: Array<{
    category?: string
    name?: string
    description?: string
    violation?: string
  }>
  /** 직전 단계(T-1-1 팀 비전)의 핵심 키워드/비전 — 규칙의 어조·중점 결정 맥락 */
  teamVision?: string
  coreKeywords?: string[]
  /** 직전 단계(T-2-1 역할 배분) 행 요약 — 누구의 어떤 역할이 잡혔는지 규칙 설계에 반영 */
  existingRoles?: Array<{ teacherName?: string; role?: string }>
  /** 사용자 추가 요청 — UI는 기본적으로 노출하지 않지만 옵션으로 받을 수 있게 */
  userPrompt?: string
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 chatContext/existingArtifact 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 T-2-2 산출물 (보강의 출발점) */
  existingArtifact?: {
    rules?: Array<{
      category?: string
      name?: string
      description?: string
      violation?: string
    }>
  }
  /** mode='chat' — 현재 활동의 팀 채팅 메시지 (최근 N개 권장). 토큰 절약 위해 호출측에서 제한. */
  chatContext?: Array<{
    role: 'user' | 'assistant' | string
    content: string
    displayName?: string
  }>
}

export interface TeamRulesRuleSuggestion {
  category: string
  name: string
  description: string
  violation: string
}

export interface TeamRulesSuggestResult {
  rules: TeamRulesRuleSuggestion[]
  /** AI가 함께 제시한 짧은 운영 팁(2-3줄). UI에서 표시. */
  tips?: string[]
  /**
   * 이 제안이 무엇에 근거했는지 사용자에게 보여주기 위한 출처 설명.
   * mode와 함께 핵심 출처(요약) 및 구체 인용을 담는다.
   */
  basedOn?: {
    mode: 'artifact' | 'chat'
    /** 한국어 2-3문장. 어떤 자료(산출물/채팅 흐름/팀 비전·키워드·역할)에서 무엇을 읽어 반영했는지. */
    summary: string
    /** 구체 인용 — 예: 채팅 메시지의 짧은 발췌, 또는 산출물의 특정 행/문장 */
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중등 협력적 수업설계 과정의 팀 규칙 수립 코치입니다.
T-2-2 활동 "팀 규칙 수립" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 산출물의 각 규칙 행을 존중하되, 분류·문장을 정교화하고 누락된 영역(소통·시간·의사결정·역할·갈등 등)을 보충합니다. 기존 규칙은 의미 있는 사유가 없으면 그대로 유지합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext) — 누가 어떤 협업 어려움·원칙·기대를 언급했는지, AI가 어떤 규칙 안을 제시했는지 — 를 면밀히 읽고 팀 비전·역할 분담 맥락에 맞춰 초안을 작성합니다. 채팅에서 명시되지 않은 부분은 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "rules": [
    {
      "category": "분류 (예: 소통, 시간, 의사결정, 역할, 갈등 — 한 단어 우선, 대괄호 없이)",
      "name": "규칙명 (명확한 행동 동사로, 12자 내외)",
      "description": "설명 — 어떤 상황에서 어떻게 행동하는지 1-2문장",
      "violation": "위반 시 조치 — 합의된 회복 절차 (벌이 아닌 복구·재합의·기록 등) 1문장"
    }
  ],
  "tips": ["운영 팁 1줄", "운영 팁 1줄"],
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~를 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 행2 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- 규칙은 3-6개 — 너무 적으면 누락, 너무 많으면 운영 불가
- 분류(category)는 가능한 한 다양화 — 소통·시간·의사결정·역할·갈등·기록·AI 활용 등에서 균형 있게 선택
- 규칙명(name)은 명확한 행동 동사 — "정해진 회의 시간 지키기", "이견은 24시간 안에 글로 정리하기" 등
- 설명(description)은 추상적 슬로건이 아닌 구체 행동 — "언제·누가·어떻게"
- 위반 시 조치(violation)는 벌이 아닌 회복 지향 — 사과·기록·재합의·역할 보완·다음 회의 안건화 등
- 팀 비전·핵심 키워드가 주어지면 규칙 어조가 그것과 정합되도록 작성
- 역할 배분(existingRoles)이 주어지면 해당 역할 수행에 필요한 약속(예: 진행자는 시작·종료 시간 알림 등)도 반영
- chat mode에서는 채팅에서 본인이 직접 말한 협업 어려움/원칙을 우선 반영 (가능한 한 본인의 표현 사용)
- artifact mode에서는 기존 산출물 행을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- tips는 2-3개, 협업 운영 시 유의점을 짧게 ("~합니다" 톤)
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 행)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 행/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function resolveMode(body: TeamRulesSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const hasArtifact = !!(body.existingArtifact?.rules && body.existingArtifact.rules.length > 0)
  return hasArtifact ? 'artifact' : 'chat'
}

function buildUserPrompt(body: TeamRulesSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에는 어느 행/필드를 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 팀 채팅 대화에서 누가 무엇을 언급했는지 읽고 반영하세요. basedOn에는 채팅의 누구 발언을 어떻게 반영했는지 인용하세요.')
  lines.push('')

  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }

  if (body.teamVision?.trim() || (body.coreKeywords && body.coreKeywords.length > 0)) {
    lines.push('### 직전 단계(T-1-1) 팀 공통 비전')
    if (body.teamVision?.trim()) lines.push(`- 팀 비전: ${body.teamVision.trim()}`)
    if (body.coreKeywords?.length) lines.push(`- 핵심 키워드: ${body.coreKeywords.join(', ')}`)
    lines.push('')
  }

  if (body.existingRoles && body.existingRoles.length > 0) {
    const meaningful = body.existingRoles.filter((r) => (r.teacherName && r.teacherName.trim()) || (r.role && r.role.trim()))
    if (meaningful.length > 0) {
      lines.push('### 직전 단계(T-2-1) 역할 배분 — 규칙 설계에 반영')
      for (const r of meaningful) {
        const name = r.teacherName?.trim() ?? ''
        const role = r.role?.trim() ?? ''
        if (name && role) lines.push(`- ${name}: ${role}`)
        else if (role) lines.push(`- (역할) ${role}`)
        else if (name) lines.push(`- ${name}`)
      }
      lines.push('')
    }
  }

  if (mode === 'artifact' && body.existingArtifact?.rules && body.existingArtifact.rules.length > 0) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 행들을 정교화)')
    body.existingArtifact.rules.forEach((r, idx) => {
      const cells: string[] = []
      if (r.category?.trim()) cells.push(`분류: ${r.category.trim()}`)
      if (r.name?.trim()) cells.push(`규칙명: ${r.name.trim()}`)
      if (r.description?.trim()) cells.push(`설명: ${r.description.trim()}`)
      if (r.violation?.trim()) cells.push(`위반 시 조치: ${r.violation.trim()}`)
      lines.push(`- 행${idx + 1}: ${cells.join(' · ')}`)
    })
    lines.push('')
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
    const meaningful = body.currentRows.filter((r) =>
      (r.category && r.category.trim()) ||
      (r.name && r.name.trim()) ||
      (r.description && r.description.trim()) ||
      (r.violation && r.violation.trim())
    )
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 표 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const r of meaningful) {
        const cells: string[] = []
        if (r.category?.trim()) cells.push(`분류: ${r.category.trim()}`)
        if (r.name?.trim()) cells.push(`규칙명: ${r.name.trim()}`)
        if (r.description?.trim()) cells.push(`설명: ${r.description.trim()}`)
        if (r.violation?.trim()) cells.push(`위반 시 조치: ${r.violation.trim()}`)
        lines.push(`- ${cells.join(' · ')}`)
      }
      lines.push('')
    }
  }

  if (body.userPrompt?.trim()) {
    lines.push('### 사용자 추가 요청')
    lines.push(body.userPrompt.trim())
    lines.push('')
  }

  lines.push('위 정보를 종합하여 팀 규칙 산출물 형식의 JSON으로만 응답하세요. 규칙 3-6개, 분류를 다양화하고, 위반 시 조치는 회복 지향으로 작성하세요. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeamRulesSuggestRequest

    const hasArtifact = !!(body.existingArtifact?.rules && body.existingArtifact.rules.length > 0)
    const hasChat = !!(body.chatContext && body.chatContext.length > 0)
    const hasCurrent = !!(body.currentRows && body.currentRows.some((r) =>
      (r.category && r.category.trim()) || (r.name && r.name.trim()) || (r.description && r.description.trim()) || (r.violation && r.violation.trim())
    ))
    if (!hasArtifact && !hasChat && !hasCurrent && !body.teamVision?.trim() && !(body.coreKeywords && body.coreKeywords.length > 0)) {
      return Response.json({ error: '팀 채팅·기존 산출물·팀 비전 중 하나 이상이 필요합니다.' }, { status: 400 })
    }

    const mode = resolveMode(body)
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText

    let parsed: TeamRulesSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as TeamRulesSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as TeamRulesSuggestResult
    }

    const rulesArray = Array.isArray(parsed.rules) ? parsed.rules : []
    if (rulesArray.length === 0) {
      return Response.json({ error: 'LLM이 빈 규칙 배열을 반환했습니다.' }, { status: 500 })
    }

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: TeamRulesSuggestResult['basedOn']
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

    const result: TeamRulesSuggestResult = {
      rules: rulesArray.map((r) => ({
        category: typeof r?.category === 'string' ? r.category : '',
        name: typeof r?.name === 'string' ? r.name : '',
        description: typeof r?.description === 'string' ? r.description : '',
        violation: typeof r?.violation === 'string' ? r.violation : '',
      })),
      tips: Array.isArray(parsed.tips) ? parsed.tips.filter((t): t is string => typeof t === 'string') : undefined,
      basedOn,
    }
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

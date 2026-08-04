import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 역할 배분 단계(T-2-1) "역할 배분" 산출물용 AI 제안 API.
// team-vision/suggest와 동일 패턴 — 직전 단계(T-1-1 팀 공통 비전)와 팀원 정보를 종합하여 한 번에 제안.

export interface RoleDistributionSuggestRequest {
  projectId?: string
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 팀원 displayName 목록 — 역할 배분의 핵심 입력 */
  memberNames: string[]
  /** 현재 워크스페이스 표 행 (수정 중 컨텍스트로 LLM이 중복/누락 인지) */
  currentRows?: Array<{
    teacherName?: string
    subject?: string
    strengths?: string
    role?: string
    responsibilities?: string
    deadline?: string
  }>
  /** 직전 단계(T-1-1 팀 비전)의 핵심 키워드/비전 — 역할 결정 맥락 */
  teamVision?: string
  coreKeywords?: string[]
  /** 사용자 추가 요청 — UI는 기본적으로 노출하지 않지만 옵션으로 받을 수 있게 */
  userPrompt?: string
  /** 협업 프롬프트 — 팀원별로 입력한 추가 요청. 모달의 "구체적으로 AI에게 요청하기"에서 수집. */
  customPrompts?: Array<{ teacherName: string; text: string }>
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 chatContext/existingArtifact 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 T-2-1 산출물 (보강의 출발점) */
  existingArtifact?: {
    roles?: Array<{
      teacherName?: string
      subject?: string
      strengths?: string
      role?: string
      responsibilities?: string
      deadline?: string
    }>
  }
  /** mode='chat' — 현재 활동의 팀 채팅 메시지 (최근 N개 권장). 토큰 절약 위해 호출측에서 제한. */
  chatContext?: Array<{
    role: 'user' | 'assistant' | string
    content: string
    displayName?: string
  }>
}

export interface RoleDistributionRoleSuggestion {
  teacherName: string
  subject: string
  strengths: string
  role: string
  responsibilities: string
  deadline: string
}

export interface RoleDistributionSuggestResult {
  roles: RoleDistributionRoleSuggestion[]
  /** AI가 함께 제시한 짧은 운영 팁(2-3줄). UI에서 표시. */
  tips?: string[]
  /**
   * 이 제안이 무엇에 근거했는지 사용자에게 보여주기 위한 출처 설명.
   * mode와 함께 핵심 출처(요약) 및 구체 인용을 담는다.
   */
  basedOn?: {
    mode: 'artifact' | 'chat'
    /** 한국어 2-3문장. 어떤 자료(산출물/채팅 흐름/팀 비전·키워드)에서 무엇을 읽어 반영했는지. */
    summary: string
    /** 구체 인용 — 예: 채팅 메시지의 짧은 발췌, 또는 산출물의 특정 행/문장 */
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중·고 협력적 수업설계 과정의 역할 배분 코치입니다.
T-2-1 활동 "역할 배분" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.
역할 배분은 설계 전 과정의 세부 과업(회의 진행·기록·자료 탐색·AI 프롬프트 작성·평가 도구 검토 등)을 먼저 목록화한 뒤, 각자의 강점과 도전하고 싶은 역할을 살펴 한 사람에게 쏠리지 않게 나누는 활동입니다. 준비 단계 역할이 실행(수업) 단계의 몫으로 자연스럽게 이어지도록 배려하고, 역할은 고정이 아니라 진행 중 유연하게 조정할 수 있습니다. AI가 내놓는 배분안은 결론이 아니라 후보·초안이며, 최종 결정은 교사팀의 몫입니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 산출물의 각 행을 존중하되, 누락·중복·편중을 보강해 정교화합니다. 새 사람을 추가하지 말고, 기존 행만 수정·보완합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext) — 누가 어떤 강점·관심사·교과를 언급했는지, AI가 어떤 역할 분담안을 제시했는지 — 를 면밀히 읽고 팀원 명단(memberNames)에 맞춰 초안을 작성합니다. 채팅에서 명시되지 않은 부분은 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "roles": [
    {
      "teacherName": "팀원 이름 (입력된 이름 그대로)",
      "subject": "담당 교과 (모르면 빈 문자열)",
      "strengths": "추정 강점/관심사 1-2개 (쉼표 구분)",
      "role": "역할 명칭 (예: 회의 진행자, 기록자, 자료 탐색자, AI 프롬프트 작성자, 평가 도구 검토자 등)",
      "responsibilities": "구체적 담당 업무 — 준비 단계 역할이 실행(수업) 단계로 이어지는 지점도 함께 1-2문장",
      "deadline": "완료 시점 또는 확인 시점 — 예: A단계 시작 전, 매주 수요일 회의 전"
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
- 입력된 memberNames의 모든 팀원이 빠짐없이 1행씩 등장 — 순서·이름 그대로 사용
- 설계 전 과정의 세부 과업을 먼저 떠올려, 협력적 수업설계에 필요한 세부 역할(회의 진행자, 기록자, 자료 탐색자, AI 프롬프트 작성자, 평가 도구 검토자, 학습 흐름 설계자, 학생 반응 관찰자 등)을 빠짐없이 고려
- 한 명에게 과도하게 편중되지 않게 분배 — 가능하면 팀원 수만큼 서로 다른 역할. 강점만이 아니라 도전해 보고 싶은 역할도 반영
- teacherName·responsibilities·deadline을 함께 읽으면 "누가·무엇을·언제까지"가 분명히 드러나게 작성
- 역할은 고정이 아니라 진행 중 유연하게 조정될 수 있음을 전제로 서술
- 팀 비전·핵심 키워드가 주어지면 역할 명칭이 비전과 정합되도록 표현
- chat mode에서는 채팅에서 본인이 직접 말한 강점/관심사를 강점·역할에 우선 반영 (가능한 한 본인의 표현 사용)
- artifact mode에서는 기존 산출물 행을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- tips는 2-3개, 협업 운영 시 유의점을 짧게 ("~합니다" 톤)
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 행)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 행/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function resolveMode(body: RoleDistributionSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const hasArtifact = !!(body.existingArtifact?.roles && body.existingArtifact.roles.length > 0)
  return hasArtifact ? 'artifact' : 'chat'
}

function buildUserPrompt(body: RoleDistributionSuggestRequest, mode: 'artifact' | 'chat'): string {
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

  lines.push('### 팀원 목록 (memberNames — 이 순서·이름 그대로 모두 1행씩)')
  for (const name of body.memberNames) {
    const trimmed = name?.trim()
    if (trimmed) lines.push(`- ${trimmed}`)
  }
  lines.push('')

  if (mode === 'artifact' && body.existingArtifact?.roles && body.existingArtifact.roles.length > 0) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 행들을 정교화)')
    body.existingArtifact.roles.forEach((r, idx) => {
      const cells: string[] = []
      if (r.teacherName?.trim()) cells.push(`이름: ${r.teacherName.trim()}`)
      if (r.subject?.trim()) cells.push(`교과: ${r.subject.trim()}`)
      if (r.strengths?.trim()) cells.push(`강점: ${r.strengths.trim()}`)
      if (r.role?.trim()) cells.push(`역할: ${r.role.trim()}`)
      if (r.responsibilities?.trim()) cells.push(`책임: ${r.responsibilities.trim()}`)
      if (r.deadline?.trim()) cells.push(`완료 시점: ${r.deadline.trim()}`)
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
      (r.teacherName && r.teacherName.trim()) ||
      (r.subject && r.subject.trim()) ||
      (r.strengths && r.strengths.trim()) ||
      (r.role && r.role.trim()) ||
      (r.responsibilities && r.responsibilities.trim()) ||
      (r.deadline && r.deadline.trim())
    )
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 표 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const r of meaningful) {
        const cells: string[] = []
        if (r.teacherName?.trim()) cells.push(`이름: ${r.teacherName.trim()}`)
        if (r.subject?.trim()) cells.push(`교과: ${r.subject.trim()}`)
        if (r.strengths?.trim()) cells.push(`강점: ${r.strengths.trim()}`)
        if (r.role?.trim()) cells.push(`역할: ${r.role.trim()}`)
        if (r.responsibilities?.trim()) cells.push(`책임: ${r.responsibilities.trim()}`)
        if (r.deadline?.trim()) cells.push(`완료 시점: ${r.deadline.trim()}`)
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

  if (body.customPrompts && body.customPrompts.length > 0) {
    const meaningful = body.customPrompts.filter(p => (p.text ?? '').trim().length > 0)
    if (meaningful.length > 0) {
      lines.push('### 팀원별 추가 요청 (협업 프롬프트 — 각 팀원이 자기 의견을 직접 적은 것)')
      lines.push('이 의견들을 모두 의미 있게 반영하되, 서로 충돌하면 다수 의견 또는 팀 비전·핵심 키워드와의 정합성을 우선으로 합의안을 만드세요. basedOn에 어떤 팀원의 의견을 어떻게 반영했는지 명시하세요.')
      for (const p of meaningful) {
        lines.push(`- ${p.teacherName || '팀원'}: ${p.text.trim()}`)
      }
      lines.push('')
    }
  }

  lines.push('위 정보를 종합하여 역할 배분 산출물 형식의 JSON으로만 응답하세요. 모든 팀원이 1행씩 빠짐없이 등장해야 합니다. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RoleDistributionSuggestRequest

    if (!Array.isArray(body.memberNames) || body.memberNames.filter((n) => n?.trim()).length === 0) {
      return Response.json({ error: '팀원 목록(memberNames)이 비어 있어 역할 배분 제안을 만들 수 없습니다.' }, { status: 400 })
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

    let parsed: RoleDistributionSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as RoleDistributionSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as RoleDistributionSuggestResult
    }

    const rolesArray = Array.isArray(parsed.roles) ? parsed.roles : []
    if (rolesArray.length === 0) {
      return Response.json({ error: 'LLM이 빈 역할 배열을 반환했습니다.' }, { status: 500 })
    }

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: RoleDistributionSuggestResult['basedOn']
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

    const result: RoleDistributionSuggestResult = {
      roles: rolesArray.map((r) => ({
        teacherName: typeof r?.teacherName === 'string' ? r.teacherName : '',
        subject: typeof r?.subject === 'string' ? r.subject : '',
        strengths: typeof r?.strengths === 'string' ? r.strengths : '',
        role: typeof r?.role === 'string' ? r.role : '',
        responsibilities: typeof r?.responsibilities === 'string' ? r.responsibilities : '',
        deadline: typeof r?.deadline === 'string' ? r.deadline : '',
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

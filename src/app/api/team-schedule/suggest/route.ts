import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 팀 일정 결정(T-2-3) "팀 일정" 산출물용 AI 제안 API.
// role-distribution/suggest와 동일 패턴 — 직전 단계(T-1-1 팀 비전, T-2-1 역할, T-2-2 규칙)와
// 팀 채팅·기존 산출물을 종합하여 한 번에 4열(기간·활동·내용·담당자) 일정 제안.

export interface TeamScheduleSuggestRequest {
  projectId?: string
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 현재 워크스페이스 표 행 (수정 중 컨텍스트로 LLM이 중복/누락 인지) */
  currentRows?: Array<{
    period?: string
    activity?: string
    content?: string
    assignee?: string
  }>
  /** 직전 단계(T-1-1 팀 비전)의 핵심 키워드/비전 — 일정 도출 맥락 */
  teamVision?: string
  coreKeywords?: string[]
  /** 직전 단계(T-2-1 역할 배분) — 담당자 균형/회전 분배 시 참고 */
  existingRoles?: Array<{ teacherName?: string; role?: string }>
  /** 직전 단계(T-2-2 팀 규칙) — 운영 리듬/회의 주기 등 맥락 보강 */
  existingRules?: Array<{ category?: string; name?: string }>
  /** 사용자 추가 요청 — UI는 기본적으로 노출하지 않지만 옵션으로 받을 수 있게 */
  userPrompt?: string
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 chatContext/existingArtifact 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 T-2-3 산출물 (보강의 출발점) */
  existingArtifact?: {
    schedule?: Array<{
      period?: string
      activity?: string
      content?: string
      assignee?: string
    }>
  }
  /** mode='chat' — 현재 활동의 팀 채팅 메시지 (최근 N개 권장). 토큰 절약 위해 호출측에서 제한. */
  chatContext?: Array<{
    role: 'user' | 'assistant' | string
    content: string
    displayName?: string
  }>
}

export interface TeamScheduleScheduleSuggestion {
  period: string
  activity: string
  content: string
  assignee: string
}

export interface TeamScheduleSuggestResult {
  schedule: TeamScheduleScheduleSuggestion[]
  /** AI가 함께 제시한 짧은 운영 팁(2-3줄). UI에서 표시. */
  tips?: string[]
  /**
   * 이 제안이 무엇에 근거했는지 사용자에게 보여주기 위한 출처 설명.
   * mode와 함께 핵심 출처(요약) 및 구체 인용을 담는다.
   */
  basedOn?: {
    mode: 'artifact' | 'chat'
    /** 한국어 2-3문장. 어떤 자료(산출물/채팅 흐름/팀 비전·키워드·역할·규칙)에서 무엇을 읽어 반영했는지. */
    summary: string
    /** 구체 인용 — 예: 채팅 메시지의 짧은 발췌, 또는 산출물의 특정 행/문장 */
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중등 협력적 수업설계 과정의 팀 일정 결정 코치입니다.
T-2-3 활동 "팀 일정 결정" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.
팀 일정은 수업을 실행(또는 공개)하는 날짜를 기준으로 거꾸로 짚어(역산) 분석·설계·개발 등 단계별 핵심 목표일을 먼저 세우고, 실행일 바로 앞에 하루 이틀의 '예비일'을 비워 두는 데서 출발합니다. 각자의 학교 행사·지필고사 출제 기간·출장 같은 제약을 공유해 팀 공통으로 빠듯한 주간은 비동기 협업으로 대체하고, 정기 회의는 요일·시간을 고정해 둡니다. 공유 캘린더에는 날짜만이 아니라 '그날 회의의 목표'와 '준비해 올 것'을 한 줄로 덧붙입니다. AI가 내놓는 로드맵·기간 배분은 결론이 아니라 후보·초안이며, 최종 확정은 교사팀의 몫입니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 산출물의 각 행을 존중하되, 누락된 기간 채우기·담당자 편중 해소·활동 표현 구체화로 정교화합니다. 의미 없이 행을 추가하지 말고, 기존 일정 흐름을 보강합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext) — 누가 어떤 기간/활동/마감을 언급했는지, AI가 어떤 일정안을 제시했는지 — 를 면밀히 읽고 4-8개 기간 단위의 일정 초안을 작성합니다. 채팅에서 명시되지 않은 부분은 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "schedule": [
    {
      "period": "기간 표기 (예: '1주차', '2~3주차')",
      "activity": "활동명 + 날짜 범위를 함께 (예: '분석 및 비전 수립(4.1.~4.7.)', '개발 및 자료 제작(4.22.~4.28.)')",
      "content": "구체 진행 + 주의사항을 1-2문장으로. 회의가 있는 기간이면 '회의 목표·준비물'을 한 줄 덧붙여도 좋음 (예: '교육과정 성취기준을 분석하고 융합 주제를 확정합니다. (※ 4월 5일은 현장체험학습일이므로 대면 회의 대신 30분 온라인 화상 회의로 대체합니다. / 회의 목표: 주제 확정 · 준비물: 각자 담당 교과 성취기준 발췌)')",
      "assignee": "담당자 (1인 또는 협업 표기 — '홍성용', '김연주·인주상', '팀 전체')"
    }
  ],
  "tips": ["운영 팁 1줄", "운영 팁 1줄"],
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~를 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 행2 / 역할표: 평가 담당 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- 일정은 4-6개 행 — 너무 적으면 흐름 누락, 너무 많으면 실행 부담. 한 행이 여러 주에 걸칠 수 있음('2~3주차').
- 수업 실행(공개)일을 기준으로 역산하여 분석·설계·개발·실천·성찰의 단계별 핵심 목표일을 배치. 실행일 바로 앞 기간에는 하루 이틀의 '예비일'을 비워 자료 인쇄 지연·돌발 학사 일정에 대비
- period는 반드시 명시 (주 단위 '1주차' 또는 묶음 '2~3주차'). 막연한 '초반' '중반' 금지
- activity는 단계 이름 + 날짜 범위를 함께. 예: '분석 및 비전 수립(4.1.~4.7.)'. 'A안 토의' 같은 추상 표현 금지
- content는 구체 진행 + 주의사항(체험학습일 대체, 휴가 겹침, 출제 기간 등)을 1-2문장으로. '(※ ...)' 형식으로 주의사항을 한 문장 더 붙여도 좋음
- 개인별 제약(학교 행사·지필고사 출제 기간·출장·연가)이 주어지거나 채팅에 나오면 그 기간을 피해 배치하고, 팀 공통으로 빠듯한 주간은 대면 대신 비동기 협업(공유 문서에 의견 남기기)으로 대체함을 content에 명시
- 정기 회의는 요일·시간을 고정('매주 화요일 점심시간'식)해 반복 일정처럼 제시, 필요하면 길게 모일 비정기 워크숍을 별도 배치. 회의가 있는 기간의 content에는 '그날 회의의 목표'와 '준비해 올 것'을 한 줄로 덧붙임
- assignee는 한 명에게 과도하게 편중되지 않게 회전 분배 — existingRoles가 주어지면 역할표의 사람들로 균형 있게 배정. 협업·전체 표기('김연주·인주상', '팀 전체') 허용
- 팀 비전·핵심 키워드가 주어지면 활동/산출물 표현이 비전과 정합되도록 작성
- existingRules가 주어지면 회의 주기·합의 방식 등 팀 운영 리듬과 충돌하지 않도록 정렬
- chat mode에서는 채팅에서 본인이 직접 말한 기간/활동/마감을 가능한 한 그대로 사용
- artifact mode에서는 기존 산출물 행을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- tips는 2-3개, 일정 운영 시 유의점을 짧게 ("~합니다" 톤)
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 행, 역할표의 누구)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 행/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function resolveMode(body: TeamScheduleSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const hasArtifact = !!(body.existingArtifact?.schedule && body.existingArtifact.schedule.length > 0)
  return hasArtifact ? 'artifact' : 'chat'
}

function buildUserPrompt(body: TeamScheduleSuggestRequest, mode: 'artifact' | 'chat'): string {
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
    const meaningfulRoles = body.existingRoles.filter(r => (r.teacherName && r.teacherName.trim()) || (r.role && r.role.trim()))
    if (meaningfulRoles.length > 0) {
      lines.push('### 직전 단계(T-2-1) 역할 배분 (담당자 회전 분배 시 참고)')
      for (const r of meaningfulRoles) {
        const name = r.teacherName?.trim() || '이름 미정'
        const role = r.role?.trim() || '역할 미정'
        lines.push(`- ${name} — ${role}`)
      }
      lines.push('')
    }
  }

  if (body.existingRules && body.existingRules.length > 0) {
    const meaningfulRules = body.existingRules.filter(r => (r.category && r.category.trim()) || (r.name && r.name.trim()))
    if (meaningfulRules.length > 0) {
      lines.push('### 직전 단계(T-2-2) 팀 규칙 (운영 리듬·회의 주기 참고)')
      for (const r of meaningfulRules) {
        const cat = r.category?.trim() || ''
        const name = r.name?.trim() || ''
        lines.push(`- ${[cat, name].filter(Boolean).join(' · ')}`)
      }
      lines.push('')
    }
  }

  if (mode === 'artifact' && body.existingArtifact?.schedule && body.existingArtifact.schedule.length > 0) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 행들을 정교화)')
    body.existingArtifact.schedule.forEach((s, idx) => {
      const cells: string[] = []
      if (s.period?.trim()) cells.push(`기간: ${s.period.trim()}`)
      if (s.activity?.trim()) cells.push(`활동: ${s.activity.trim()}`)
      if (s.content?.trim()) cells.push(`내용: ${s.content.trim()}`)
      if (s.assignee?.trim()) cells.push(`담당: ${s.assignee.trim()}`)
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
      (r.period && r.period.trim()) ||
      (r.activity && r.activity.trim()) ||
      (r.content && r.content.trim()) ||
      (r.assignee && r.assignee.trim())
    )
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 표 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const r of meaningful) {
        const cells: string[] = []
        if (r.period?.trim()) cells.push(`기간: ${r.period.trim()}`)
        if (r.activity?.trim()) cells.push(`활동: ${r.activity.trim()}`)
        if (r.content?.trim()) cells.push(`내용: ${r.content.trim()}`)
        if (r.assignee?.trim()) cells.push(`담당: ${r.assignee.trim()}`)
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

  lines.push('위 정보를 종합하여 팀 일정 결정 산출물 형식의 JSON으로만 응답하세요. 수업 실행일 역산·예비일 확보·정기 회의 고정·회의 목표·준비물 한 줄·담당자 균형 분배를 반영. 4-6개 행, 기간 명시, 활동에 날짜 범위 포함. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeamScheduleSuggestRequest

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

    let parsed: TeamScheduleSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as TeamScheduleSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as TeamScheduleSuggestResult
    }

    const scheduleArray = Array.isArray(parsed.schedule) ? parsed.schedule : []
    if (scheduleArray.length === 0) {
      return Response.json({ error: 'LLM이 빈 일정 배열을 반환했습니다.' }, { status: 500 })
    }

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: TeamScheduleSuggestResult['basedOn']
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

    const result: TeamScheduleSuggestResult = {
      schedule: scheduleArray.map((s) => ({
        period: typeof s?.period === 'string' ? s.period : '',
        activity: typeof s?.activity === 'string' ? s.activity : '',
        content: typeof s?.content === 'string' ? s.content : '',
        assignee: typeof s?.assignee === 'string' ? s.assignee : '',
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

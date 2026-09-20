import Anthropic from '@anthropic-ai/sdk'
import { contextFromBody, verifySuggestion } from '@/lib/curriculum/suggestVerify'
import { claudeJsonParams, resolveClaudeModel } from '@/lib/llm/anthropic'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 주제 선정 단계(A-1-2) "주제 선정" 산출물용 AI 제안 API.
// role-distribution/suggest와 동일 패턴 — 2-mode(artifact/chat) + basedOn + resolveMode + buildUserPrompt.
// 직전 단계(T-1-1 팀 공통 비전)와 팀 채팅 대화를 종합하여 주제 선정 기준·선정 주제·유형·근거를 한 번에 제안.

export interface TopicSelectionSuggestRequest {
  projectId?: string
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 직전 단계(T-1-1 팀 비전)의 핵심 비전/키워드 — 주제 선정의 핵심 맥락 */
  teamVision?: string
  coreKeywords?: string[]
  /** 현재 워크스페이스 기준 표 행 (수정 중 컨텍스트로 LLM이 중복/누락 인지) */
  currentRows?: Array<{
    criterion?: string
    description?: string
    priority?: string
  }>
  /** 사용자 추가 요청 — UI는 기본적으로 노출하지 않지만 옵션으로 받을 수 있게 */
  userPrompt?: string
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 A-1-2 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 existingArtifact/chatContext 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 A-1-2 산출물 (보강의 출발점) */
  existingArtifact?: {
    criteria?: Array<{ criterion?: string; description?: string; priority?: string }>
    selectedTopic?: string
    topicType?: string
    rationale?: string
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

export interface TopicSelectionSuggestResult {
  criteria: Array<{ criterion: string; description: string; priority: string }>
  selectedTopic: string
  /** 내용요소형 / 기능요소형 / 혼합형 */
  topicType: string
  rationale: string
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

const SYSTEM_PROMPT = `당신은 초·중·고 협력적 수업설계 과정의 주제 선정 코치입니다.
A-1-2 활동 "비전 기반 주제 선정" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.
주제 선정은 앞선 활동(A-1-1)에서 팀이 함께 확정한 '주제 선정 기준'을 잣대로, 다양한 후보를 펼쳐 놓고 그 기준에 비추어 최종 주제를 고르는 활동입니다. 주제는 내용요소형(예: 환경 문제·인권)·기능요소형(예: 문제해결·제작·표현)·혼합형(내용+기능)으로 나뉘며, 유형을 미리 헤아리면 기능·표현 중심 교과의 제안도 대등한 후보로 올라옵니다. 낯선 교과의 주제는 곧장 반박하기보다 '그 주제로 학생들이 무엇을 하길 바라세요?'라고 의도를 먼저 헤아리고, 탈락한 후보도 버리지 말고 '어떤 요소를 최종 주제에 살릴까'를 함께 살핍니다. AI가 내놓는 평가·주제안은 결론이 아니라 후보·초안이며, 최종 선정은 교사팀의 몫입니다.

[mode='artifact'] — 채팅에서 이미 만들어진 A-1-2 산출물(existingArtifact)이 출발점입니다. 산출물의 선정 기준 표·선정 주제·주제 유형·선정 근거를 존중하되, 표현·정합성·세부 진술을 보강해 정교화합니다. 기존 기준 행을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext) — 어떤 주제 후보·선정 기준·학생/교과 맥락을 논의했는지, AI가 어떤 안을 제시했는지 — 를 면밀히 읽고 팀 비전·핵심 키워드에 맞춰 초안을 작성합니다. 채팅에서 명시되지 않은 부분은 팀 비전·핵심 키워드 범위 안에서 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "criteria": [
    {
      "criterion": "선정 기준 명칭 (팀이 확정한 기준이 입력에 있으면 그 명칭 그대로. 없을 때만 학생 흥미·관심, 교과 연계성, 사회적 시의성, 탐구 가능성 등에서 제안)",
      "description": "기준에 대한 설명 1-2문장",
      "priority": "우선순위 (예: 높음 / 중간 / 낮음 또는 1·2·3 순위)"
    }
  ],
  "selectedTopic": "최종 선정 주제 1문장",
  "topicType": "내용요소형 / 기능요소형 / 혼합형 중 하나만",
  "rationale": "이 주제를 선정한 근거 — 위 선정 기준 중 무엇을 더 잘 충족하는지, 팀 비전·교과·학생 맥락과 어떻게 연결되는지 2-4문장. 탈락 후보가 있었다면 그 주제의 어떤 요소를 최종 주제에 살렸는지 한 줄 덧붙임(가능할 때)",
  "tips": ["운영 팁 1줄", "운영 팁 1줄"],
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~를 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 기준2 / 비전 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- criteria는 3~5개. 입력(기존 산출물의 선정 기준·현재 워크스페이스 기준 표)에 팀이 이미 확정한 기준이 있으면 그 기준을 그대로 쓰고 표현만 다듬음 — 임의로 새 기준으로 바꾸지 말 것. 확정 기준이 없을 때만 협력적 수업설계에서 통상 고려하는 관점(학생 흥미·관심, 교과 연계성, 사회적 시의성·실생활 관련성, 탐구·활동 가능성, 평가 적합성 등)으로 기본 기준을 제안. 각 기준은 서로 명확히 구분되게
- selectedTopic은 1개의 명료한 문장으로 — 학생이 탐구할 주제가 한눈에 보이도록. '다수결'이 아니라 '어떤 후보가 우리 기준을 더 잘 충족하는가'로 판단
- topicType은 반드시 "내용요소형", "기능요소형", "혼합형" 중 하나만 사용 (다른 표현 금지). 기능·표현 중심 교과의 후보도 대등하게 검토
- rationale은 위 선정 기준 중 무엇을 충족하는지 선정 근거를 선정 주제와 나란히 밝히고, 팀 비전·핵심 키워드·대상 교과·학년군·학생 맥락과의 정합성을 구체적으로 연결
- chat mode에서는 채팅에서 팀이 직접 합의·언급한 표현을 우선 반영 (가능한 한 발화자의 표현 사용)
- artifact mode에서는 기존 산출물을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- tips는 2-3개, 주제를 수업으로 풀어갈 때의 유의점을 짧게 ("~합니다" 톤)
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 행/필드, 팀 비전 문구)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 행/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function resolveMode(body: TopicSelectionSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const ea = body.existingArtifact
  const hasArtifact = !!(
    ea && (
      (typeof ea.selectedTopic === 'string' && ea.selectedTopic.trim()) ||
      (typeof ea.topicType === 'string' && ea.topicType.trim()) ||
      (typeof ea.rationale === 'string' && ea.rationale.trim()) ||
      (Array.isArray(ea.criteria) && ea.criteria.length > 0)
    )
  )
  return hasArtifact ? 'artifact' : 'chat'
}

function buildUserPrompt(body: TopicSelectionSuggestRequest, mode: 'artifact' | 'chat'): string {
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

  if (mode === 'artifact' && body.existingArtifact) {
    const ea = body.existingArtifact
    const hasAny = (
      ea.selectedTopic?.trim() || ea.topicType?.trim() || ea.rationale?.trim() ||
      (ea.criteria && ea.criteria.length > 0)
    )
    if (hasAny) {
      lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 내용을 정교화)')
      if (ea.selectedTopic?.trim()) lines.push(`- 선정 주제: ${ea.selectedTopic.trim()}`)
      if (ea.topicType?.trim()) lines.push(`- 주제 유형: ${ea.topicType.trim()}`)
      if (ea.rationale?.trim()) lines.push(`- 선정 근거: ${ea.rationale.trim()}`)
      if (ea.criteria?.length) {
        lines.push('- 선정 기준:')
        ea.criteria.forEach((c, idx) => {
          if (!c.criterion && !c.description && !c.priority) return
          const cells: string[] = []
          if (c.criterion?.trim()) cells.push(`기준: ${c.criterion.trim()}`)
          if (c.description?.trim()) cells.push(`설명: ${c.description.trim()}`)
          if (c.priority?.trim()) cells.push(`우선순위: ${c.priority.trim()}`)
          lines.push(`  · 기준${idx + 1}: ${cells.join(' / ')}`)
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
    const meaningful = body.currentRows.filter((r) =>
      (r.criterion && r.criterion.trim()) ||
      (r.description && r.description.trim()) ||
      (r.priority && r.priority.trim())
    )
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 기준 표 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const r of meaningful) {
        const cells: string[] = []
        if (r.criterion?.trim()) cells.push(`기준: ${r.criterion.trim()}`)
        if (r.description?.trim()) cells.push(`설명: ${r.description.trim()}`)
        if (r.priority?.trim()) cells.push(`우선순위: ${r.priority.trim()}`)
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

  lines.push('위 정보를 종합하여 주제 선정 산출물 형식의 JSON으로만 응답하세요. 입력에 팀 확정 기준이 있으면 그 기준으로 적합성을 평가하고 선정 근거를 함께 밝힘. criteria 3~5개, topicType은 내용요소형/기능요소형/혼합형 중 하나, basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TopicSelectionSuggestRequest

    const mode = resolveMode(body)
    // 팀 비전·키워드·채팅·기존 산출물 중 하나라도 있으면 진행.
    const ea = body.existingArtifact
    const hasAnyInput = !!(
      body.teamVision?.trim() ||
      (body.coreKeywords && body.coreKeywords.length > 0) ||
      body.userPrompt?.trim() ||
      (body.chatContext && body.chatContext.length > 0) ||
      (ea && (
        ea.selectedTopic?.trim() ||
        ea.topicType?.trim() ||
        ea.rationale?.trim() ||
        (ea.criteria && ea.criteria.length > 0)
      ))
    )
    if (!hasAnyInput) {
      return Response.json({ error: '팀 비전·채팅 대화 등 참고할 컨텍스트가 없어 주제 선정 제안을 만들 수 없습니다.' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      ...claudeJsonParams(resolveClaudeModel('suggest'), 4096),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText

    let parsed: TopicSelectionSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as TopicSelectionSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as TopicSelectionSuggestResult
    }

    const criteriaArray = Array.isArray(parsed.criteria) ? parsed.criteria : []

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: TopicSelectionSuggestResult['basedOn']
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

    const result: TopicSelectionSuggestResult = {
      criteria: criteriaArray.map((c) => ({
        criterion: typeof c?.criterion === 'string' ? c.criterion : '',
        description: typeof c?.description === 'string' ? c.description : '',
        priority: typeof c?.priority === 'string' ? c.priority : '',
      })),
      selectedTopic: typeof parsed.selectedTopic === 'string' ? parsed.selectedTopic : '',
      topicType: typeof parsed.topicType === 'string' ? parsed.topicType : '',
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      tips: Array.isArray(parsed.tips) ? parsed.tips.filter((t): t is string => typeof t === 'string') : undefined,
      basedOn,
    }
    // [2026-09-20] 사후 검증(차단 없음): 성취기준 코드 대조 + Jev 정합·적정성. 응답 메타로만 붙인다.
    const verification = await verifySuggestion('topic-selection', result, contextFromBody(body as unknown as Record<string, unknown>, {}))
    return Response.json({ ...result, verification })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

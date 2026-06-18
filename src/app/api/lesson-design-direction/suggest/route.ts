import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// T-1-2 "수업설계 방향 설정" 산출물용 AI 제안 API.
// 사용자 추가 프롬프트 없이 이전 단계(T-1-1 팀 공통 비전·핵심 키워드) 데이터만으로 한 번에 제안.
// [2026-05-15] 2-mode + basedOn 패턴 확장 (RoleDistribution과 동일):
//  - artifact: 채팅에서 이미 생성된 T-1-2 산출물(existingArtifact)을 출발점으로 정교화
//  - chat:    빈 워크스페이스 — 팀 채팅 대화(chatContext)에서 설계 원칙·근거 단서를 읽고 반영

export interface LessonDesignDirectionSuggestRequest {
  /** 프로젝트 메타 */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이전 단계 산출물 (T-1-1) */
  teamVision?: string
  coreKeywords?: string[]
  /** 현재 워크스페이스 초안 (보강 요청 시 참고) */
  currentDraft?: {
    designPrinciples?: Array<{ principle: string; rationale: string }>
  }
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 existingArtifact 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 T-1-2 산출물 (보강의 출발점) */
  existingArtifact?: {
    designPrinciples?: Array<{ principle?: string; rationale?: string }>
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

export interface LessonDesignDirectionSuggestResult {
  /** 수업 설계 원칙 + 근거 목록 */
  designPrinciples: Array<{ principle: string; rationale: string }>
  rationale?: string
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

const SYSTEM_PROMPT = `당신은 초·중등 협력적 수업설계 코치입니다.
T-1-2 활동 "수업설계 방향 설정" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 산출물의 각 설계 원칙을 존중하되, 표현이 모호하거나 근거가 약한 부분을 정교화하고, 누락된 관점이 있으면 1-2개 보강합니다. 임의로 전부 새로 쓰지 말고 기존 원칙은 가능한 유지합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext) — 누가 어떤 학습 가치·방법론·평가 방식·학생상을 언급했는지, AI가 어떤 설계 원칙을 제시했는지 — 를 면밀히 읽고 팀 비전·핵심 키워드와 결합해 초안을 작성합니다. 채팅에서 명시되지 않은 부분은 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "designPrinciples": [
    { "principle": "설계 원칙 (구체적 방법론 포함, 1문장)", "rationale": "이 원칙의 근거 (1문장)" }
  ],
  "rationale": "이 제안이 팀 비전·핵심 키워드와 어떻게 연결되는지 1-2문장 짧은 안내 (선택)",
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~원칙을 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 원칙2 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- designPrinciples는 3~5개 권장
- 각 principle은 구체적 방법론(PBL, 협동학습, 탐구학습, 평가·과제 형태 등)을 포함하되 1문장으로 압축
- 각 rationale은 팀 비전·핵심 키워드 중 어느 부분에 닿는지 명시
- 임의로 새 비전·키워드를 만들지 말 것 — 입력에 있는 표현 우선 활용
- chat mode에서는 채팅에서 팀원이 직접 말한 학습 가치·방법론·학생상을 원칙·근거에 우선 반영 (가능한 한 본인의 표현 사용)
- artifact mode에서는 기존 산출물 원칙을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 원칙)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 원칙/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function resolveMode(body: LessonDesignDirectionSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const hasArtifact = !!(body.existingArtifact?.designPrinciples && body.existingArtifact.designPrinciples.length > 0)
  return hasArtifact ? 'artifact' : 'chat'
}

function buildUserPrompt(body: LessonDesignDirectionSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에는 어느 원칙을 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 팀 채팅 대화에서 누가 무엇을 언급했는지 읽고 반영하세요. basedOn에는 채팅의 누구 발언을 어떻게 반영했는지 인용하세요.')
  lines.push('')

  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }
  if (body.teamVision?.trim()) {
    lines.push('### T-1-1에서 합의된 팀 공통 비전')
    lines.push(body.teamVision.trim())
    lines.push('')
  }
  if (body.coreKeywords?.length) {
    lines.push('### 핵심 키워드')
    lines.push(body.coreKeywords.join(', '))
    lines.push('')
  }

  if (mode === 'artifact' && body.existingArtifact?.designPrinciples && body.existingArtifact.designPrinciples.length > 0) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 원칙들을 정교화)')
    body.existingArtifact.designPrinciples.forEach((dp, idx) => {
      const parts: string[] = []
      if (dp.principle?.trim()) parts.push(`원칙: ${dp.principle.trim()}`)
      if (dp.rationale?.trim()) parts.push(`근거: ${dp.rationale.trim()}`)
      if (parts.length) lines.push(`- 원칙${idx + 1}: ${parts.join(' · ')}`)
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

  if (body.currentDraft?.designPrinciples?.length) {
    const meaningful = body.currentDraft.designPrinciples.filter(dp => dp.principle?.trim() || dp.rationale?.trim())
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 초안 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const dp of meaningful) {
        lines.push(`- ${dp.principle || '(원칙 미작성)'}${dp.rationale ? ` / ${dp.rationale}` : ''}`)
      }
      lines.push('')
    }
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

  lines.push('위 정보를 종합하여 수업설계 방향 산출물 형식의 JSON으로만 응답하세요. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LessonDesignDirectionSuggestRequest

    const hasContext = !!body.teamVision?.trim() ||
      !!(body.coreKeywords && body.coreKeywords.length > 0) ||
      !!(body.currentDraft?.designPrinciples && body.currentDraft.designPrinciples.length > 0) ||
      !!(body.existingArtifact?.designPrinciples && body.existingArtifact.designPrinciples.length > 0) ||
      !!(body.chatContext && body.chatContext.length > 0)
    if (!hasContext) {
      return Response.json({ error: '팀 공통 비전이 아직 수집되지 않아 제안을 만들 수 없습니다.' }, { status: 400 })
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

    let parsed: LessonDesignDirectionSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as LessonDesignDirectionSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as LessonDesignDirectionSuggestResult
    }

    const designPrinciplesArr = Array.isArray(parsed.designPrinciples) ? parsed.designPrinciples : []

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: LessonDesignDirectionSuggestResult['basedOn']
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

    const result: LessonDesignDirectionSuggestResult = {
      designPrinciples: designPrinciplesArr.map((dp) => ({
        principle: typeof dp?.principle === 'string' ? dp.principle : '',
        rationale: typeof dp?.rationale === 'string' ? dp.rationale : '',
      })),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
      basedOn,
    }
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

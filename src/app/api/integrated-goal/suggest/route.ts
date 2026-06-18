import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface IntegratedGoalSuggestRequest {
  /** 사용자가 모달에서 입력한 자유 요청 (선택 — chat/artifact 모드에서는 비어도 됨) */
  prompt: string
  /** 프로젝트 메타 (있으면 정합성 향상) */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** A-2-1 분석 결과 등 사전 컨텍스트 (있을 때 전달) */
  existingAnalysis?: string
  existingCoreIdea?: string
  /** 워크스페이스에 이미 입력된 내용(부분 채움 상태에서 보강 요청 시) */
  currentDraft?: {
    commonCoreIdea?: string
    integratedGoal?: string
    convergentKeywords?: string[]
    method?: 'inductive' | 'deductive'
    subjectGoals?: Array<{ subject: string; goal: string; knowledge?: string; process?: string; attitude?: string }>
  }
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 A-2-2 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 existingArtifact/chatContext 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 A-2-2 산출물 (보강의 출발점) */
  existingArtifact?: {
    commonCoreIdea?: string
    integratedGoal?: string
    subjectGoals?: Array<{ subject: string; goal: string; knowledge?: string; process?: string; attitude?: string }>
    convergentKeywords?: string[]
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

export interface IntegratedGoalSuggestResult {
  commonCoreIdea: string
  integratedGoal: string
  convergentKeywords: string[]
  method?: 'inductive' | 'deductive'
  subjectGoals: Array<{
    subject: string
    goal: string
    knowledge?: string
    process?: string
    attitude?: string
  }>
  /** 모달 미리보기 표시용 짧은 안내 (선택) */
  rationale?: string
  /**
   * 이 제안이 무엇에 근거했는지 사용자에게 보여주기 위한 출처 설명.
   * mode와 함께 핵심 출처(요약) 및 구체 인용을 담는다.
   */
  basedOn?: {
    mode: 'artifact' | 'chat'
    /** 한국어 2-3문장. 어떤 자료(산출물/채팅 흐름/A-2-1 분석)에서 무엇을 읽어 반영했는지. */
    summary: string
    /** 구체 인용 — 예: 채팅 메시지의 짧은 발췌, 또는 산출물의 특정 필드/행 */
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중등 교과 융합 수업설계 전문가입니다.
A-2-2 활동 "통합 수업목표 진술" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.

[mode='artifact'] — 채팅에서 이미 만들어진 A-2-2 산출물(existingArtifact)이 출발점입니다. 산출물의 공통 핵심 아이디어 · 통합 수업목표 · 교과별 수업목표 행을 존중하되, 표현·정합성·세부 진술을 보강해 정교화합니다. 새 교과를 추가하지 말고, 기존 교과 행만 수정·보완합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext) — 어떤 공통 핵심 아이디어·통합 수업목표·교과별 학습 초점을 논의했는지, AI가 어떤 안을 제시했는지 — 를 면밀히 읽고 A-2-1 분석 결과(있다면)에 맞춰 초안을 작성합니다. 채팅에서 명시되지 않은 부분은 A-2-1 분석 결과 범위 안에서 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "commonCoreIdea": "교과를 가로지르는 공통 핵심 아이디어 1문장",
  "integratedGoal": "학생은 ~ 할 수 있다 형태의 통합 수업목표 1문장",
  "convergentKeywords": ["수렴 키워드1", "수렴 키워드2", "..."],
  "method": "inductive 또는 deductive (선택, 명확하지 않으면 생략)",
  "subjectGoals": [
    {
      "subject": "교과명",
      "goal": "학생은 ~를 통해 ~할 수 있다 형태의 교과별 수업목표. 본문에 (지식·이해), (과정·기능), (가치·태도) 인라인 태그를 포함해도 됨",
      "knowledge": "지식·이해 핵심 (선택)",
      "process": "과정·기능 핵심 (선택)",
      "attitude": "가치·태도 핵심 (선택)"
    }
  ],
  "rationale": "이 제안이 입력 요청과 어떻게 연결되는지 1-2문장 짧은 안내 (선택)",
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~를 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 통합목표 / A-2-1: 국어 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- integratedGoal은 1개의 상위 문장으로, 반드시 "학생은"으로 시작
- subjectGoals는 입력된 A-2-1 분석 결과의 교과 수만큼만 작성 — 임의로 다른 교과 추가 금지
- **반드시 "### A-2-1 교과 융합 성취기준 분석 결과"에 명시된 학년군·교과·성취기준·핵심아이디어·지식·이해·과정·기능의 범위 안에서만 진술하세요.** 입력에 없는 학년(예: 초등 → 중등) 또는 입력에 없는 성취기준의 내용을 임의로 가져오지 마세요.
- subjectGoals의 knowledge·process·attitude는 A-2-1 입력에 있는 표현을 우선 활용
- knowledge/process/attitude 필드가 명확하지 않으면 빈 문자열 또는 생략
- convergentKeywords는 3~5개 권장
- chat mode에서는 채팅에서 팀이 직접 합의·언급한 표현을 우선 반영 (가능한 한 발화자의 표현 사용)
- artifact mode에서는 기존 산출물을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 필드)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 필드/행이 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
`

function resolveMode(body: IntegratedGoalSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const ea = body.existingArtifact
  const hasArtifact = !!(
    ea && (
      (typeof ea.integratedGoal === 'string' && ea.integratedGoal.trim()) ||
      (typeof ea.commonCoreIdea === 'string' && ea.commonCoreIdea.trim()) ||
      (Array.isArray(ea.subjectGoals) && ea.subjectGoals.length > 0) ||
      (Array.isArray(ea.convergentKeywords) && ea.convergentKeywords.length > 0)
    )
  )
  return hasArtifact ? 'artifact' : 'chat'
}

function buildUserPrompt(body: IntegratedGoalSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에는 어느 필드/행을 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 팀 채팅 대화에서 누가 무엇을 언급했는지 읽고 반영하세요. basedOn에는 채팅의 누구 발언을 어떻게 반영했는지 인용하세요.')
  lines.push('')

  if (body.prompt?.trim()) {
    lines.push('### 사용자 요청')
    lines.push(body.prompt.trim())
    lines.push('')
  }
  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }
  if (body.existingCoreIdea) {
    lines.push('### A-2-1에서 합의된 공통 핵심 아이디어')
    lines.push(body.existingCoreIdea.trim())
    lines.push('')
  }
  if (body.existingAnalysis) {
    lines.push('### A-2-1 교과 융합 성취기준 분석 결과')
    lines.push(body.existingAnalysis.trim())
    lines.push('')
  }

  if (mode === 'artifact' && body.existingArtifact) {
    const ea = body.existingArtifact
    const hasAny = (ea.commonCoreIdea?.trim() || ea.integratedGoal?.trim() ||
      (ea.subjectGoals && ea.subjectGoals.length > 0) ||
      (ea.convergentKeywords && ea.convergentKeywords.length > 0))
    if (hasAny) {
      lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 내용을 정교화)')
      if (ea.commonCoreIdea?.trim()) lines.push(`- 공통 핵심 아이디어: ${ea.commonCoreIdea.trim()}`)
      if (ea.integratedGoal?.trim()) lines.push(`- 통합 수업목표: ${ea.integratedGoal.trim()}`)
      if (ea.convergentKeywords?.length) lines.push(`- 수렴 키워드: ${ea.convergentKeywords.join(', ')}`)
      if (ea.subjectGoals?.length) {
        lines.push('- 교과별 수업목표:')
        for (const sg of ea.subjectGoals) {
          if (!sg.subject && !sg.goal) continue
          const extras: string[] = []
          if (sg.knowledge?.trim()) extras.push(`지식·이해: ${sg.knowledge.trim()}`)
          if (sg.process?.trim()) extras.push(`과정·기능: ${sg.process.trim()}`)
          if (sg.attitude?.trim()) extras.push(`가치·태도: ${sg.attitude.trim()}`)
          const extraStr = extras.length ? ` [${extras.join(' / ')}]` : ''
          lines.push(`  · ${sg.subject || '(교과 미지정)'}: ${sg.goal || '(목표 미작성)'}${extraStr}`)
        }
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

  if (body.currentDraft) {
    const d = body.currentDraft
    const hasContent =
      (d.commonCoreIdea && d.commonCoreIdea.trim()) ||
      (d.integratedGoal && d.integratedGoal.trim()) ||
      (d.convergentKeywords && d.convergentKeywords.length > 0) ||
      (d.subjectGoals && d.subjectGoals.length > 0)
    if (hasContent) {
      lines.push('### 현재 워크스페이스 초안 (보강·정교화 요청 시 참고)')
      if (d.commonCoreIdea?.trim()) lines.push(`- 공통 핵심 아이디어: ${d.commonCoreIdea.trim()}`)
      if (d.integratedGoal?.trim()) lines.push(`- 통합 수업목표: ${d.integratedGoal.trim()}`)
      if (d.convergentKeywords?.length) lines.push(`- 수렴 키워드: ${d.convergentKeywords.join(', ')}`)
      if (d.method) lines.push(`- 진술 방식: ${d.method === 'inductive' ? '귀납적' : '연역적'}`)
      if (d.subjectGoals?.length) {
        lines.push('- 교과별 수업목표 (초안):')
        for (const sg of d.subjectGoals) {
          if (!sg.subject && !sg.goal) continue
          lines.push(`  · ${sg.subject || '(교과 미지정)'}: ${sg.goal || '(목표 미작성)'}`)
        }
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

  lines.push('위 정보를 종합하여 통합 수업목표 진술 산출물 형식의 JSON으로만 응답하세요. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IntegratedGoalSuggestRequest

    const mode = resolveMode(body)
    // prompt가 없더라도 mode/chat-context/existing-artifact/existingAnalysis 중 하나가 있으면 진행.
    const hasAnyInput = !!(
      body.prompt?.trim() ||
      body.existingAnalysis?.trim() ||
      body.existingCoreIdea?.trim() ||
      (body.chatContext && body.chatContext.length > 0) ||
      (body.existingArtifact && (
        body.existingArtifact.commonCoreIdea?.trim() ||
        body.existingArtifact.integratedGoal?.trim() ||
        (body.existingArtifact.subjectGoals && body.existingArtifact.subjectGoals.length > 0) ||
        (body.existingArtifact.convergentKeywords && body.existingArtifact.convergentKeywords.length > 0)
      ))
    )
    if (!hasAnyInput) {
      return Response.json({ error: '요청 내용을 입력해 주세요.' }, { status: 400 })
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

    let parsed: IntegratedGoalSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as IntegratedGoalSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as IntegratedGoalSuggestResult
    }
    // 최소 필드 보정 — 누락되어도 클라이언트 머지 로직이 안전하게 처리하도록 기본값 설정
    parsed.commonCoreIdea = parsed.commonCoreIdea ?? ''
    parsed.integratedGoal = parsed.integratedGoal ?? ''
    parsed.convergentKeywords = Array.isArray(parsed.convergentKeywords) ? parsed.convergentKeywords : []
    parsed.subjectGoals = Array.isArray(parsed.subjectGoals) ? parsed.subjectGoals : []

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: IntegratedGoalSuggestResult['basedOn']
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

    const result: IntegratedGoalSuggestResult = {
      ...parsed,
      basedOn,
    }
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

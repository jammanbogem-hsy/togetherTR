import Anthropic from '@anthropic-ai/sdk'
import { claudeJsonParams, resolveClaudeModel } from '@/lib/llm/anthropic'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 스캐폴딩 설계 단계(Ds-2-2) "스캐폴딩 설계" 산출물용 AI 제안 API.
// learning-activity/suggest와 동일 패턴 — 2-mode(artifact/chat) + basedOn + resolveMode + buildUserPrompt.
// 이미지 4단계 흐름 모형 반영:
//  ① (교사팀,공유) 활동별 예상 어려움·지원 아이디어 — 실제 수업 장면 기반 (인지 분산·외현화)
//  ② (교사팀,협의) 학습목표 근거 적절성 토론 — 정답 제공보다 발판 제공 (조정·상호 의존)
//  ③ (교사팀+AI,조정) 탐색·개발 자료 보완 — 학생 수행 장면 상상 (조정)
//  ④ (개인교사,점검) 수정 자료 공유·재보완 — 반복 검토 (상호 의존·조정)
// 직전 단계(Ds-1-3 학습활동·누적 차시, A-2-3 학습자 프로필)와 팀 채팅 대화를 종합.

interface Ds22ScaffoldInput {
  targetActivity?: string
  type?: string
  content?: string
  level?: string
  fadeOut?: string
}

export interface ScaffoldingSuggestRequest {
  projectId?: string
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 직전 단계(Ds-1-3) 학습활동 표 요약 — 활동명 + 누적 차시 */
  learningActivities?: string
  /** 직전 단계(A-2-3) 학습자 프로필 요약 — 학습 지원·다문화 등 개별화 단서 */
  learnerProfile?: string
  /** 현재 워크스페이스 기준 5열 표 행 (수정 중 컨텍스트로 LLM이 중복/누락 인지) */
  currentRows?: Ds22ScaffoldInput[]
  /** 사용자 추가 요청 — UI는 기본적으로 노출하지 않지만 옵션으로 받을 수 있게 */
  userPrompt?: string
  /**
   * 제안 컨텍스트 모드:
   * - 'artifact': 채팅에서 이미 만들어진 Ds-2-2 산출물(existingArtifact)을 기반으로 보강·정교화
   * - 'chat':    빈 워크스페이스에서 시작 — 팀 채팅 대화(chatContext)를 바탕으로 초안 제안
   * 누락 시 existingArtifact/chatContext 존재 여부로 서버에서 자동 판정.
   */
  mode?: 'artifact' | 'chat'
  /** mode='artifact' — 이미 생성된 Ds-2-2 산출물 (보강의 출발점) */
  existingArtifact?: {
    scaffolds?: Ds22ScaffoldInput[]
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

export interface ScaffoldingSuggestResult {
  scaffolds: Array<{
    targetActivity: string
    type: string
    content: string
    level: string
    fadeOut: string
  }>
  /** 지원 방안 정리 (자료명 + 간략 설명 / 대상 활동) */
  supportPlans?: Array<{ support: string; targetActivity: string }>
  /** AI 점검 — GRR 부합·개별화 충분성·제거 시점 명확성 단락 */
  review: string
  /** AI가 함께 제시한 짧은 운영 팁(2-3줄). UI에서 표시. */
  tips?: string[]
  /**
   * 이 제안이 무엇에 근거했는지 사용자에게 보여주기 위한 출처 설명.
   * mode와 함께 핵심 출처(요약) 및 구체 인용을 담는다.
   */
  basedOn?: {
    mode: 'artifact' | 'chat'
    /** 한국어 2-3문장. 어떤 자료(산출물/채팅 흐름/학습활동·학습자 프로필)에서 무엇을 읽어 반영했는지. */
    summary: string
    /** 구체 인용 — 예: 채팅 메시지의 짧은 발췌, 또는 산출물의 특정 행/문장 */
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중·고 협력적 수업설계 과정의 스캐폴딩 설계 코치입니다.
Ds-2-2 활동 "스캐폴딩 설계" 산출물의 추천 형식에 맞춰, 두 가지 모드 중 하나로 제안합니다.
스캐폴딩은 학습자가 스스로 과제를 해내도록 놓아 주는 발판입니다. 좋은 스캐폴딩은 학생을 쉽게 정답에 이르게 하는 것이 아니라 스스로 해내도록 돕는 것이어서, '개선안 예시 3개'를 그대로 주기보다 '좋은 개선안의 조건'을 묻는 질문형·선택형 안내로 바꿉니다. 각 활동에서 학생이 막힐 장면을 실제 수업 경험에 비추어 구체적으로 예측하고(예: '평균은 구해도 그래서 뭐가 문제인지 해석을 못 함' → 해석을 돕는 질문 카드), 제공 시점·방식·대상을 정리하며 '학생인 척' 따라 풀어 보는 시범 검토로 다듬습니다. AI가 내놓는 발판은 결론이 아니라 후보·초안이며, 정답을 직접 알려 주지 않고 사고를 돕는 형태인지·지원이 과한 곳은 없는지는 교사팀이 판단합니다.

스캐폴딩 설계는 다음 4단계 흐름을 따릅니다:
① (교사팀, 공유) 활동별 예상 어려움·지원 아이디어를 실제 수업 장면 기반으로 외현화 (인지 분산)
② (교사팀, 협의) 학습목표 근거로 적절성 토론 — 정답을 제공하지 말고 발판을 제공 (조정·상호 의존)
③ (교사팀+AI, 조정) 탐색·개발 자료 보완 — 학생 수행 장면을 상상하며 수정 (조정)
④ (개인교사, 점검) 수정 자료를 공유·재보완 — 반복 검토 (상호 의존·조정)

핵심 원칙 — GRR(점진적 책임 이양, Gradual Release of Responsibility):
- 교사 모델링 → 협력 수행 → 자율 수행 순으로 책임을 학생에게 점진적으로 넘깁니다.
- 스캐폴딩은 "정답 제공"이 아니라 학생이 스스로 도달하도록 돕는 "발판"입니다.
- 점진적 제거 계획(fadeOut)은 Ds-1-3 누적 차시를 기준으로 단계적 철수로 적습니다 (예: "4차시: 예시+가이드 제공 → 5차시: 체크리스트만 → 6차시: 자율 수행").
- 학습 지원·다문화 학생은 별도 수준(level)으로 개별화된 발판을 함께 설계합니다.

[mode='artifact'] — 채팅에서 이미 만들어진 Ds-2-2 산출물(existingArtifact)이 출발점입니다. 산출물의 스캐폴딩 표·AI 점검을 존중하되, GRR 부합·개별화·제거 시점을 보강해 정교화합니다. 기존 행을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀이 그동안 채팅으로 나눈 대화(chatContext)와 직전 단계의 학습활동 표(누적 차시)·학습자 프로필을 면밀히 읽고, 학생이 어려움을 겪을 활동마다 발판을 설계합니다. 채팅에서 명시되지 않은 부분은 학습활동·학습자 프로필 범위 안에서 합리적으로 추정합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "scaffolds": [
    {
      "targetActivity": "대상 활동 — Ds-1-3 활동명 + 누적 차시 (예: 데이터 비교·해석하기 (3차시)). 학생이 막힐 지점을 실제 수업 장면으로 예측해 선정",
      "type": "스캐폴딩 유형 — 질문 카드 / 분석 틀 / 체크리스트 / 개념 안내형 / 절차 안내형 / 언어 프레임 / 구조화 틀 등. 정답을 고르게 하는 '예시 제공'보다 사고를 여는 질문형·선택형 우선",
      "content": "구체적 내용 — 제공 자료·진행 방식을 학생 수행 관점에서 2~3문장. 정답을 대신 주지 말고 '좋은 ~의 조건'을 묻는 질문형·선택형으로. 제공 방식·대상도 함께",
      "level": "대상 수준 — 전체 / 학습 지원 / 다문화 등 (개별화 시 별도 행 권장)",
      "fadeOut": "점진적 제거 계획 — 누적 차시 기준 단계적 철수 (예: 4차시: 예시+가이드 → 5차시: 체크리스트만 → 6차시: 자율)"
    }
  ],
  "supportPlans": [
    { "support": "지원 방안 — 자료명 + 간략 설명", "targetActivity": "대상 활동 (활동명 + 누적 차시)" }
  ],
  "review": "AI 점검 — GRR 부합 여부, 개별화(학습 지원·다문화) 충분성, 제거 시점의 명확성을 3~5문장으로 서술",
  "tips": ["운영 팁 1줄", "운영 팁 1줄"],
  "basedOn": {
    "mode": "artifact 또는 chat (입력 모드와 동일)",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장으로 설명. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영했습니다' 식으로, 산출물 모드면 '기존 산출물의 ~를 정교화했습니다' 식으로.",
    "references": [
      { "source": "채팅: 김나희 / 산출물: 스캐폴딩2 / 학습활동·학습자 프로필 등 출처 식별자", "text": "구체 인용 — 짧은 발췌 한두 줄" }
    ]
  }
}

작성 규칙:
- scaffolds는 4~8개. 각 활동에서 학생이 막힐 장면을 실제 수업 경험에 비추어 구체적으로 예측하고, 그에 맞는 발판을 설계 (예: '평균은 구해도 해석을 못 함' → 해석을 돕는 질문 카드). 특히 분석·의사결정·산출물 제작에 집중
- type·content는 사고를 대신하지 않는 발판 — '예시 3개 제공'처럼 정답을 고르게 하는 대신 '좋은 ~의 조건'을 묻는 질문형·선택형으로 (질문 카드·분석 틀·체크리스트 등)
- content는 학생 수행 장면 관점에서 2~3문장 — "무엇을 어떻게 제공하고(제공 방식·대상) 학생이 어떻게 활용하는지"
- level은 전체/학습 지원/다문화 등 — 개별화가 필요하면 동일 활동에 대해 수준별로 행을 분리
- fadeOut은 반드시 Ds-1-3 누적 차시를 기준으로 단계적 철수 ("N차시: 발판 → M차시: 축소 → L차시: 자율")
- review는 GRR 부합 여부 + 개별화 충분성 + 제거 시점 명확성을 3~5문장 단락으로. 지원이 과한 곳(과잉 지원)이 있으면 '줄일 곳'을 함께 짚음
- supportPlans는 0~6개 — 스캐폴딩 구현에 필요한 보조 자료를 자료명+설명/대상 활동으로 정리 (없으면 빈 배열)
- chat mode에서는 채팅에서 팀이 직접 합의·언급한 표현을 우선 반영 (가능한 한 발화자의 표현 사용)
- artifact mode에서는 기존 산출물을 출발점으로 — 의미 있는 변경 사유가 없으면 그대로 유지
- tips는 2-3개, 스캐폴딩을 수업에서 운영할 때의 유의점을 짧게 ("~합니다" 톤)
- basedOn.summary는 사용자가 읽고 "납득"할 수 있도록 구체적 자료(채팅의 누구 발언, 산출물의 어떤 행/필드, 학습활동·학습자 프로필 문구)를 짧게 인용
- basedOn.references는 1~4개. 채팅 모드면 가급적 발화자 이름과 핵심 문구. 산출물 모드면 어떤 행/필드가 출발점이었는지.
- 본문에 마크다운, 코드 블록, 추가 설명을 절대 포함하지 말 것 (JSON만)
- 존중하는 동료 교사 어조로 작성합니다
`

function scaffoldHasContent(s?: Ds22ScaffoldInput): boolean {
  if (!s) return false
  return !!(
    s.targetActivity?.trim() || s.type?.trim() || s.content?.trim() ||
    s.level?.trim() || s.fadeOut?.trim()
  )
}

function resolveMode(body: ScaffoldingSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const ea = body.existingArtifact
  const hasArtifact = !!(
    ea && (
      (typeof ea.review === 'string' && ea.review.trim()) ||
      (Array.isArray(ea.scaffolds) && ea.scaffolds.some(scaffoldHasContent))
    )
  )
  return hasArtifact ? 'artifact' : 'chat'
}

function describeScaffold(s: Ds22ScaffoldInput): string {
  const cells: string[] = []
  if (s.targetActivity?.trim()) cells.push(`대상 활동: ${s.targetActivity.trim()}`)
  if (s.type?.trim()) cells.push(`유형: ${s.type.trim()}`)
  if (s.content?.trim()) cells.push(`내용: ${s.content.trim()}`)
  if (s.level?.trim()) cells.push(`대상 수준: ${s.level.trim()}`)
  if (s.fadeOut?.trim()) cells.push(`점진적 제거: ${s.fadeOut.trim()}`)
  return cells.join(' / ')
}

function buildUserPrompt(body: ScaffoldingSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에는 어느 스캐폴딩/필드를 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 팀 채팅 대화와 직전 단계 맥락에서 누가 무엇을 언급했는지 읽고 반영하세요. basedOn에는 채팅의 누구 발언/학습활동을 어떻게 반영했는지 인용하세요.')
  lines.push('')

  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }

  if (body.learningActivities?.trim() || body.learnerProfile?.trim()) {
    lines.push('### 직전 단계 맥락 (스캐폴딩 설계의 출발점)')
    if (body.learningActivities?.trim()) lines.push(`- Ds-1-3 학습활동(활동명·누적 차시): ${body.learningActivities.trim()}`)
    if (body.learnerProfile?.trim()) lines.push(`- A-2-3 학습자 프로필(학습 지원·다문화 등 개별화 단서): ${body.learnerProfile.trim()}`)
    lines.push('')
  }

  if (mode === 'artifact' && body.existingArtifact) {
    const ea = body.existingArtifact
    const scs = Array.isArray(ea.scaffolds) ? ea.scaffolds.filter(scaffoldHasContent) : []
    const hasAny = ea.review?.trim() || scs.length > 0
    if (hasAny) {
      lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 내용을 정교화)')
      if (ea.review?.trim()) lines.push(`- AI 점검: ${ea.review.trim()}`)
      if (scs.length > 0) {
        lines.push('- 스캐폴딩:')
        scs.forEach((s, idx) => {
          lines.push(`  · 스캐폴딩${idx + 1}: ${describeScaffold(s)}`)
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
    const meaningful = body.currentRows.filter(scaffoldHasContent)
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 스캐폴딩 표 (이미 입력된 내용 — 중복/누락 피하기 위해 참고)')
      for (const r of meaningful) {
        lines.push(`- ${describeScaffold(r)}`)
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
      lines.push('이 의견들을 모두 의미 있게 반영하되, 서로 충돌하면 다수 의견 또는 학습활동·학습자 프로필과의 정합성을 우선으로 합의안을 만드세요. basedOn에 어떤 팀원의 의견을 어떻게 반영했는지 명시하세요.')
      for (const p of meaningful) {
        lines.push(`- ${p.teacherName || '팀원'}: ${p.text.trim()}`)
      }
      lines.push('')
    }
  }

  lines.push('위 정보를 종합하여 스캐폴딩 설계 산출물 형식의 JSON으로만 응답하세요. scaffolds 4~8개, 각 스캐폴딩은 정답이 아닌 발판, fadeOut은 Ds-1-3 누적 차시 기준 단계적 철수, 학습 지원·다문화 학생 개별화, basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScaffoldingSuggestRequest

    const mode = resolveMode(body)
    // 학습활동·학습자 프로필·채팅·기존 산출물 중 하나라도 있으면 진행.
    const ea = body.existingArtifact
    const hasAnyInput = !!(
      body.learningActivities?.trim() ||
      body.learnerProfile?.trim() ||
      body.userPrompt?.trim() ||
      (body.chatContext && body.chatContext.length > 0) ||
      (ea && (
        ea.review?.trim() ||
        (Array.isArray(ea.scaffolds) && ea.scaffolds.some(scaffoldHasContent))
      ))
    )
    if (!hasAnyInput) {
      return Response.json({ error: '학습활동·채팅 대화 등 참고할 컨텍스트가 없어 스캐폴딩 설계 제안을 만들 수 없습니다.' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      ...claudeJsonParams(resolveClaudeModel('suggest'), 4096),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText

    let parsed: ScaffoldingSuggestResult
    try {
      parsed = JSON.parse(jsonStr.trim()) as ScaffoldingSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      parsed = recovered as ScaffoldingSuggestResult
    }

    const scaffoldsArray = Array.isArray(parsed.scaffolds) ? parsed.scaffolds : []
    const supportArray = Array.isArray(parsed.supportPlans) ? parsed.supportPlans : []

    // basedOn 정규화 — LLM이 mode를 누락하거나 다른 값을 넣더라도 서버 결정값을 신뢰.
    const rawBasedOn = (parsed as { basedOn?: unknown }).basedOn
    let basedOn: ScaffoldingSuggestResult['basedOn']
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

    const result: ScaffoldingSuggestResult = {
      scaffolds: scaffoldsArray.map((s) => ({
        targetActivity: typeof s?.targetActivity === 'string' ? s.targetActivity : '',
        type: typeof s?.type === 'string' ? s.type : '',
        content: typeof s?.content === 'string' ? s.content : '',
        level: typeof s?.level === 'string' ? s.level : '',
        fadeOut: typeof s?.fadeOut === 'string' ? s.fadeOut : '',
      })),
      supportPlans: supportArray
        .map((p) => ({
          support: typeof p?.support === 'string' ? p.support : '',
          targetActivity: typeof p?.targetActivity === 'string' ? p.targetActivity : '',
        }))
        .filter((p) => p.support || p.targetActivity),
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

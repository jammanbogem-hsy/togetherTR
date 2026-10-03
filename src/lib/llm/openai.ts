/**
 * OpenAI 모델 선택·생성 파라미터·사용량 로깅 (2026-09-20 하이브리드 0단계).
 *
 * 왜: 라우트마다 'gpt-4o'·'gpt-5-mini'·reasoning_effort 를 하드코딩해 두면 모델을 바꿀 때
 * 파라미터 호환이 깨진다. 실측(docs/eval-2026-09-20): gpt-5.6-luna 는 reasoning_effort
 * 'minimal' 을 400 으로 거부하고(지원값 none/low/medium/high/xhigh/max), gpt-5 계열은
 * temperature·max_tokens 를 받지 않는다. 여기서 모델 계열별로 안전한 파라미터를 만든다.
 *
 * 역할(env):
 *   chat    OPENAI_CHAT_MODEL     퍼실리테이션 대화 (기본 gpt-4o — 기존 동작 유지)
 *   utility OPENAI_UTILITY_MODEL  분석·종합·설명 등 gpt-4o 를 쓰던 보조 라우트 (기본 gpt-4o)
 *   demo    OPENAI_DEMO_MODEL     데모 엔진 (기본 chat 과 동일)
 * 대화 effort 는 OPENAI_CHAT_EFFORT 로 강제 가능. 미설정 시 계열별 기본값(아래 chatEffort).
 */

export type OpenAIRole = 'chat' | 'utility' | 'demo'

/** 라우트가 원하는 추론 강도. 모델 계열별로 실제 값이 달라진다. */
export type EffortIntent = 'fastest' | 'light' | 'balanced' | 'deep'

export function resolveOpenAIModel(role: OpenAIRole): string {
  const chat = process.env.OPENAI_CHAT_MODEL || 'gpt-4o'
  if (role === 'chat') return chat
  if (role === 'utility') return process.env.OPENAI_UTILITY_MODEL || 'gpt-4o'
  return process.env.OPENAI_DEMO_MODEL || chat
}

/** gpt-5·gpt-6 계열(및 o-시리즈): max_completion_tokens·reasoning_effort 를 쓰고 max_tokens·temperature 를 거부한다. */
export function isReasoningModel(model: string): boolean {
  return /^gpt-[56]/.test(model) || /^o\d/.test(model)
}

/** gpt-5.6·gpt-6 계열(luna·terra·sol·astra): 'minimal' 을 400 으로 거부하고 'none' 이 최저 단계 (2026-10-03 gpt-6-luna 실측). */
export function isGpt56Family(model: string): boolean {
  return /^gpt-(5\.6|6)/.test(model)
}

export function reasoningEffortFor(model: string, intent: EffortIntent): string | undefined {
  if (!isReasoningModel(model)) return undefined
  const lowest = isGpt56Family(model) ? 'none' : 'minimal'
  return { fastest: lowest, light: 'low', balanced: 'medium', deep: 'high' }[intent]
}

/**
 * 대화 라우트 기본 effort — 실측에서 gpt-5-mini 는 minimal(기존), luna 는 low 가 가장 좋았다
 * (none 은 안내가 빈약, 25점 심사 20.7 vs low 21.5). OPENAI_CHAT_EFFORT 로 덮어쓸 수 있다.
 */
export function chatEffort(model: string): string | undefined {
  if (!isReasoningModel(model)) return undefined
  const override = process.env.OPENAI_CHAT_EFFORT?.trim()
  if (override) return override
  return isGpt56Family(model) ? 'low' : 'minimal'
}

export interface GenerationOptions {
  maxTokens: number
  /** 추론 모델일 때만 적용. 미지정 시 reasoning_effort 를 보내지 않는다(모델 기본값). */
  effort?: EffortIntent | { raw: string }
  /** 비추론 모델(gpt-4o 등)에만 적용 — gpt-5 계열은 temperature 를 거부하므로 버린다. */
  temperature?: number
  json?: boolean
  stream?: boolean
  /** 같은 접두사를 쓰는 요청끼리 캐시 라우팅을 돕는 키 (gpt-5 계열). */
  cacheKey?: string
}

/** 모델 계열에 맞는 chat.completions 파라미터. 호출부는 messages 만 덧붙이면 된다. */
export function generationParams(model: string, options: GenerationOptions): Record<string, unknown> {
  const params: Record<string, unknown> = { model }
  if (isReasoningModel(model)) {
    params.max_completion_tokens = options.maxTokens
    const effort = typeof options.effort === 'object' ? options.effort.raw : options.effort ? reasoningEffortFor(model, options.effort) : undefined
    if (effort) params.reasoning_effort = effort
    if (options.cacheKey) params.prompt_cache_key = options.cacheKey
  } else {
    params.max_tokens = options.maxTokens
    if (options.temperature !== undefined) params.temperature = options.temperature
  }
  if (options.json) params.response_format = { type: 'json_object' }
  if (options.stream) {
    params.stream = true
    params.stream_options = { include_usage: true }
  }
  return params
}

export interface UsageLike {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/**
 * 사용량 한 줄 로그 — Cloud Functions 로그에서 `[llm-usage]` 로 걸러 캐시 적중률·추론 토큰을 본다.
 * 0단계 게이트("캐시 적중률 수치 확보")의 데이터 소스.
 */
export function logLlmUsage(route: string, model: string, usage: UsageLike | null | undefined, elapsedMs: number, extra: Record<string, unknown> = {}): void {
  console.log('[llm-usage]', JSON.stringify({
    route,
    model,
    ms: Math.round(elapsedMs),
    in: usage?.prompt_tokens ?? null,
    cached: usage?.prompt_tokens_details?.cached_tokens ?? null,
    out: usage?.completion_tokens ?? null,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    ...extra,
  }))
}

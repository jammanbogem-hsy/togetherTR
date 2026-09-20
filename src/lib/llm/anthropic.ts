/**
 * Anthropic(Claude) 모델 선택 (2026-09-20 하이브리드 3단계).
 *
 * 역할(env):
 *   suggest   ANTHROPIC_SUGGEST_MODEL   제안 라우트 11종·공동편집·문제상황 생성 (기본 claude-sonnet-4-6)
 *   analysis  ANTHROPIC_ANALYSIS_MODEL  누적 분석 (기본 claude-opus-4-6)
 *   relation  ANTHROPIC_RELATION_MODEL  성취기준 관계·온톨로지 검색 (기본 claude-haiku-4-5-20251001)
 * 기본값은 기존 모델 그대로이고 .env.local 로만 바꾼다(롤백 = env 한 줄).
 *
 * Claude 5 계열(sonnet-5 등)은 thinking 을 생략하면 adaptive 로 켜진다. JSON 한 방 생성 라우트는
 * 사고 토큰이 max_tokens 를 잠식해 JSON 이 잘릴 수 있어 명시적으로 끈다(sonnet-4-6 과 동일 동작).
 * 긴 분석(누적 분석, 스트리밍)은 기본 adaptive 를 그대로 둔다.
 */

export type ClaudeRole = 'suggest' | 'analysis' | 'relation'

export function resolveClaudeModel(role: ClaudeRole): string {
  if (role === 'suggest') return process.env.ANTHROPIC_SUGGEST_MODEL || 'claude-sonnet-4-6'
  if (role === 'analysis') return process.env.ANTHROPIC_ANALYSIS_MODEL || 'claude-opus-4-6'
  return process.env.ANTHROPIC_RELATION_MODEL || 'claude-haiku-4-5-20251001'
}

export function isClaude5Family(model: string): boolean {
  return /^claude-(sonnet|opus|fable|mythos)-5/.test(model)
}

/** JSON 한 방 생성용 파라미터: 모델 + max_tokens + (Claude 5 계열이면 thinking off). */
export function claudeJsonParams(model: string, maxTokens: number): { model: string; max_tokens: number; thinking?: { type: 'disabled' } } {
  return isClaude5Family(model)
    ? { model, max_tokens: maxTokens, thinking: { type: 'disabled' } }
    : { model, max_tokens: maxTokens }
}

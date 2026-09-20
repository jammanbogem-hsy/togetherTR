/**
 * TypeSafe Jev(System One) HTTP 클라이언트.
 *
 * SDK(@typesafe-ai/sdk) 대신 문서화된 HTTP API(POST /v1/systemone)를 직접 호출한다.
 * 의존성 없이 요청·응답 형태를 이 파일 하나로 고정하기 위함.
 * 문서: https://docs.typesafe.ai/api.md
 *
 * - 인증: Authorization: Bearer <TYPESAFE_API_KEY>
 * - Choice: criteria = { 옵션키: 설명|null } (최대 255개) → choice/probabilities/confidence
 * - Score : criteria = [단계 설명 ...] (2~10단계, 0부터 번호) → score/legend/probabilities/confidence
 * - Noul  : 예/아니오 → noul(0~1)
 * - 한도: 요청당 64k 토큰(state 32k). 429/529는 지수 백오프.
 */

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string | Record<string, unknown> | unknown[]
  criteria: Record<string, string | null>
}

export interface JevScoreQuestion {
  type: 'score'
  instructions: string | Record<string, unknown> | unknown[]
  criteria: string[]
}

export interface JevNoulQuestion {
  type: 'noul'
  instructions: string | Record<string, unknown> | unknown[]
  criteria?: { true: string; false: string }
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export interface JevScoreAnswer {
  type: 'score'
  score: number
  legend: Record<string, string>
  probabilities: Record<string, number>
  confidence: number
}

export interface JevNoulAnswer {
  type: 'noul'
  noul: number
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer

export interface JevResponse {
  model: string
  answers: Record<string, JevAnswer>
  usage: { input_tokens: number; output_tokens: number }
  /** 클라이언트 측 측정 왕복 시간(ms) — 문서에 지연시간 수치가 없어 직접 잰다. */
  elapsedMs: number
}

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const DEFAULT_MODEL = 'jev-latest'
const RETRYABLE = new Set([429, 529])

export function isJevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY)
}

export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'JevError'
  }
}

export async function systemOne(
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, JevQuestion>,
  options: { model?: string; timeoutMs?: number; maxRetries?: number } = {},
): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new JevError('TYPESAFE_API_KEY가 설정되지 않았습니다.')
  const { model = DEFAULT_MODEL, timeoutMs = 30_000, maxRetries = 2 } = options
  const body = JSON.stringify({ state, model, questions })

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const started = performance.now()
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal: controller.signal,
      })
      const elapsedMs = Math.round(performance.now() - started)
      if (RETRYABLE.has(resp.status) && attempt < maxRetries) {
        lastError = new JevError(`Jev ${resp.status} (재시도 ${attempt + 1}/${maxRetries})`, resp.status)
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
        continue
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new JevError(`Jev HTTP ${resp.status}: ${text.slice(0, 300)}`, resp.status)
      }
      const data = await resp.json() as Omit<JevResponse, 'elapsedMs'>
      return { ...data, elapsedMs }
    } catch (error) {
      if (error instanceof JevError && error.status !== undefined && !RETRYABLE.has(error.status)) throw error
      lastError = error
      if (attempt >= maxRetries) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new JevError(String(lastError))
}

/** Choice 답의 확률을 내림차순 [키, 확률] 배열로. */
export function rankedProbabilities(answer: JevChoiceAnswer | JevScoreAnswer): Array<[string, number]> {
  return Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])
}

/**
 * 문서의 confidence 정의(확률이 한 옵션에 얼마나 몰렸나)를 n개 옵션에 일반화한 값:
 * (n·p_max − 1) / (n − 1). 3옵션일 때 문서 예시 (3·p_max − 1)/2 와 일치.
 * 옵션 부분집합(예: 특정 영역 안의 핵심아이디어만)으로 재정규화해 다시 계산할 때 쓴다.
 */
export function concentrationConfidence(probabilities: number[]): number {
  const n = probabilities.length
  if (n <= 1) return 1
  const total = probabilities.reduce((sum, p) => sum + p, 0)
  if (total <= 0) return 0
  const pMax = Math.max(...probabilities) / total
  return Math.max(0, Math.min(1, (n * pMax - 1) / (n - 1)))
}

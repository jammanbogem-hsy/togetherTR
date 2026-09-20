/**
 * 제안 라우트 사후 검증 (2026-09-20 하이브리드 3단계).
 *
 * 개방형 생성(주제 후보·통합 목표·학습활동·평가계획·문제상황)은 LLM 이 그대로 쓰고,
 * 여기서는 "맞는지"만 코드와 Jev 로 확인해 응답 메타(verification)로 붙인다. 응답 본문은
 * 바꾸지 않는다(차단 없음) — 결과는 [suggest-verify] 로그로 남겨 게이트(성취기준 코드 정확도
 * 100%, 정합 점수)를 측정한다.
 *
 * - 성취기준 코드 유효성: 코드 대조(그래프에 있는 코드만 유효). Jev 가 아니라 코드가 한다.
 * - 정합·적정성·안전: Jev Noul. 확정 사실이 없으면 해당 질문은 건너뛴다.
 */

import { loadGraph } from '@/lib/curriculum/graphReader'
import { jevJudgeEnabled } from '@/lib/curriculum/jevJudge'
import { systemOne, type JevNoulAnswer, type JevQuestion } from '@/lib/curriculum/jev'

export interface SuggestVerifyContext {
  gradeGroup?: string
  topic?: string
  vision?: string
  integratedGoal?: string
  /** 확정된 성취기준 원문/코드 목록 */
  standards?: string[]
  /** 문제상황·학습활동처럼 학생 활동을 담는 출력이면 안전 위험도 묻는다 */
  studentActivity?: boolean
}

export interface SuggestVerification {
  codesChecked: number
  invalidCodes: string[]
  jev?: {
    /** 출력이 확정 성취기준 범위 안에 있는가 (0~1) */
    inScope?: number
    /** 학년군 수준에 맞는가 (0~1) */
    gradeFit?: number
    /** 팀 비전·통합 목표와 부합하는가 (0~1) */
    goalFit?: number
    /** 학생 안전상 위험 활동이 포함됐는가 (0~1, 높을수록 위험) */
    safetyRisk?: number
    elapsedMs: number
  }
}

let validCodes: Set<string> | null = null
function codeSet(): Set<string> {
  if (validCodes) return validCodes
  const graph = loadGraph()
  validCodes = new Set((graph?.achievementStandards ?? []).map(std => std.code.replace(/[\[\]]/g, '')))
  return validCodes
}

function extractCodes(text: string): string[] {
  return [...new Set([...text.matchAll(/\[?(\d[가-힣A-Za-z]+\d{2}-\d{2})\]?/g)].map(m => m[1]))]
}

export async function verifySuggestion(route: string, output: unknown, ctx: SuggestVerifyContext): Promise<SuggestVerification> {
  const text = JSON.stringify(output ?? {})
  const codes = extractCodes(text)
  const valid = codeSet()
  const invalidCodes = valid.size > 0 ? codes.filter(code => !valid.has(code)) : []
  const result: SuggestVerification = { codesChecked: codes.length, invalidCodes }

  if (jevJudgeEnabled()) {
    const questions: Record<string, JevQuestion> = {}
    if (ctx.standards?.length) {
      questions.inScope = { type: 'noul', instructions: '출력 내용이 확정된 성취기준(`확정_성취기준`)의 범위 안에서 만들어졌는가? 확정되지 않은 다른 성취기준의 내용을 끌어오거나 성취기준을 새로 지어냈으면 아니오.' }
    }
    if (ctx.gradeGroup) {
      questions.gradeFit = { type: 'noul', instructions: '출력 내용의 활동·어휘·과제 난이도가 `학년군` 초등학생 수준에 맞는가?' }
    }
    if (ctx.vision || ctx.integratedGoal) {
      questions.goalFit = { type: 'noul', instructions: '출력 내용이 `팀_비전` 과 `통합_목표` 의 방향과 부합하는가? 어긋나거나 무관하면 아니오.' }
    }
    if (ctx.studentActivity) {
      questions.safetyRisk = { type: 'noul', instructions: '출력에 초등학생에게 안전상 위험한 활동(위험 약품·화기·고온·하천 입수·차도 활동 등)이 안전 조치 없이 포함되어 있는가?' }
    }
    if (Object.keys(questions).length > 0) {
      try {
        const response = await systemOne({
          라우트: route,
          학년군: ctx.gradeGroup ?? '',
          수업주제: ctx.topic ?? '',
          팀_비전: ctx.vision ?? '',
          통합_목표: ctx.integratedGoal ?? '',
          확정_성취기준: ctx.standards ?? [],
          출력: text.slice(0, 12_000),
        }, questions, { timeoutMs: 8_000, maxRetries: 0 })
        const noul = (key: string) => {
          const answer = response.answers[key] as JevNoulAnswer | undefined
          return answer?.type === 'noul' ? answer.noul : undefined
        }
        result.jev = { inScope: noul('inScope'), gradeFit: noul('gradeFit'), goalFit: noul('goalFit'), safetyRisk: noul('safetyRisk'), elapsedMs: response.elapsedMs }
      } catch (error) {
        console.error('[suggest-verify] jev', error)
      }
    }
  }
  console.log('[suggest-verify]', JSON.stringify({ route, ...result }))
  return result
}

/** 요청 본문에서 검증 맥락을 느슨하게 뽑는다 — 라우트마다 필드 이름이 달라서. */
export function contextFromBody(body: Record<string, unknown>, extra: Partial<SuggestVerifyContext> = {}): SuggestVerifyContext {
  const str = (...keys: string[]) => {
    for (const key of keys) { const value = body[key]; if (typeof value === 'string' && value.trim()) return value.trim() }
    return undefined
  }
  const standards: string[] = []
  const goals = body['subjectGoals']
  if (Array.isArray(goals)) {
    for (const item of goals) {
      if (typeof item === 'string') standards.push(item)
      else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const std = record['standard'] ?? record['achievementStandard'] ?? record['standards']
        if (typeof std === 'string') standards.push(std)
        else if (Array.isArray(std)) standards.push(...std.filter((s): s is string => typeof s === 'string'))
      }
    }
  }
  const plain = body['standards']
  if (Array.isArray(plain)) standards.push(...plain.filter((s): s is string => typeof s === 'string'))
  return {
    gradeGroup: str('gradeGroup', 'targetGradeGroup'),
    topic: str('selectedTopic', 'topic', 'theme'),
    vision: str('teamVision', 'vision'),
    integratedGoal: str('integratedGoal'),
    standards: standards.length ? standards : undefined,
    ...extra,
  }
}

import type { ProblemCandidateDetail } from './generation'

const STANDARD_CODE = /(?<![\d가-힣])(\d{1,2}[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2})(?![\d가-힣])/g

/** A-2-1에 실제로 있는 코드만 성취기준 연결로 허용한다. 분석 코드가 없으면 기존 결과를 유지한다. */
export function validateProblemStandards(
  detail: Partial<ProblemCandidateDetail>,
  achievementStandardsAnalysis?: string,
): Partial<ProblemCandidateDetail> {
  const allowed = new Set(Array.from((achievementStandardsAnalysis ?? '').matchAll(STANDARD_CODE), match => match[1]))
  if (!allowed.size || !detail.standardsAlignment) return detail
  return {
    ...detail,
    standardsAlignment: detail.standardsAlignment.filter(alignment =>
      allowed.has(alignment.standardId.trim().replace(/^\[|\]$/g, '')),
    ),
  }
}

import { gradeBandFromStandardCode, toGradeBandLabel } from './sheetGradeBands'

export interface LessonStandardAudience { code: string; gradeBand?: string }

/** Generation policy, not an achievement-standard replacement. Keep the selected standard verbatim. */
export const LESSON_AUDIENCE_VERSION = 'elementary-lesson-v2'

const PROFILES: Record<string, string> = {
  '1-2학년군': '사진·그림·실물과 교사가 읽어 주는 짧은 이야기로 시작한다. 관찰·분류·놀이·그림·말하기 중심으로 한 번에 한 과제를 제안하고, 쓰기는 낱말이나 짧은 문장을 선택하게 한다.',
  '3-4학년군': '생활 주변의 관찰, 교사가 골라 쉬운 한국어로 제시한 짧은 글·사진·작은 표를 사용한다. 자료 2~3개의 차이를 찾아 말하고, 그림·간단한 표나 그래프·이유를 붙인 짧은 문장으로 표현한다. 자료 읽기와 표현에 교사의 질문·예시·문장 틀을 함께 제공한다.',
  '5-6학년군': '교사가 출처와 난이도를 확인한 어린이용 설명·기사 발췌·적은 수의 실제 자료를 비교한다. 선택한 성취기준 범위에서 간단한 조사·그래프·근거를 든 문단·실천 제안을 구성하며, 자료 찾기와 해석을 교사가 안내한다.',
}

export function lessonAudienceBands(gradeGroup?: string, standards: readonly LessonStandardAudience[] = []): string[] {
  const bands = [toGradeBandLabel(gradeGroup), ...standards.map(s => toGradeBandLabel(s.gradeBand) || gradeBandFromStandardCode(s.code))]
  return [...new Set(bands.filter(Boolean))].sort()
}

export function lessonAudiencePrompt(gradeGroup?: string, standards: readonly LessonStandardAudience[] = []): string {
  const bands = lessonAudienceBands(gradeGroup, standards)
  return `## 대상 학년군과 실행 수준 — 참신함보다 우선
선택 학년군: ${toGradeBandLabel(gradeGroup) || bands.join(', ') || '초등학교(학년군 미확인)'}
성취기준별 학년군: ${standards.map(s => `${s.code}: ${toGradeBandLabel(s.gradeBand) || gradeBandFromStandardCode(s.code) || '미확인'}`).join(' / ')}
${bands.length ? bands.map(band => `- ${band}: ${PROFILES[band]}`).join('\n') : '- 학년군이 확인되지 않으면 그림·실물 관찰과 말하기 수준의 짧은 활동을 제안하고, 읽기·쓰기 분량이나 선수 지식을 임의로 정하지 않는다.'}
- 학생이 실제로 읽는 자료와 교사가 미리 준비·가공하는 자료를 구분해서 쓴다. NASA·기상청 등의 자료는 교사가 고른 사진·쉬운 한국어 설명·간단한 수치로 재구성해 제공할 수 있다. 학생에게 해외 기관 사이트·영어 원문·과학 논문·논문 요약본·전문 보고서를 직접 탐색하거나 읽고 분석하게 하지 않는다.
- 주제와 성취기준에 없는 어려운 개념, 정해진 글자 수의 긴 논증문, 정책제안서, 데이터 대시보드를 참신함만을 위해 추가하지 않는다. 읽기 분량·어휘·쓰기 산출물·수업 시간·기기 접근성을 해당 학년 수준으로 맞춘다.
- 학년군이 여럿이면 학년군별 자료·도움·산출물을 구분하고, 공통 활동은 낮은 학년군도 참여할 수 있게 한다.
- 최신 선정 주제와 교사가 적은 수업내용을 기준으로 한다. 기후 변화 수업을 임의로 태양계·행성 탐구로 바꾸거나, 인간 활동에 따른 기후 변화라는 과학적 사실 자체를 찬반 선택 대상으로 만들지 않는다.
- 쉽게 설명하더라도 개념의 정확성을 유지한다. 기후 변화의 근거는 교사가 확인한 여러 해의 같은 시기 관측 자료를 쉽게 재구성해 제시하고, 계절별 사진이나 한 해의 월별 기온 차이를 장기 기후 변화의 증거로 삼지 않는다. 제시되지 않은 수치·자료를 실제 관측값처럼 만들지 않는다.
- 선택한 성취기준과 주제가 자연스럽게 연결되지 않으면 연결의 한계를 짧게 밝히고 무리한 융합 과제를 만들지 않는다.
- 짧은 2~3단계로 자료 → 학생 행동 → 산출물과 간단한 확인 방법을 적는다. 교과 원문의 어려운 표현을 학생 과제에 그대로 옮기지 않는다.`
}

/** A narrow backstop for concrete overloads; institution names alone are never rejected. */
export function lessonDifficultyIssues(text: string, gradeGroup?: string, standards: readonly LessonStandardAudience[] = []): string[] {
  const issues: string[] = []
  const clauses = text.split(/[.!?。\n→]+/)
  const academic = /(?:과학|학술|연구)\s*논문(?:\s*요약본)?|논문\s*(?:원문|요약본)|전문\s*보고서|영어\s*원문|IPCC\s*(?:보고서|원문)/i
  for (const clause of clauses) {
    if (!academic.test(clause)) continue
    const adapted = /교사/.test(clause) && /(?:쉬운\s*(?:한국어|말)|어린이용|그림\s*카드|사진\s*자료)/.test(clause)
      && /(?:재구성|바꾸|바꾼|가공|풀어)/.test(clause)
    const explicitlyExcluded = /(?:읽|분석|탐색)[^,;]{0,12}(?:않|금지|제외)/.test(clause)
    if (!adapted && !explicitlyExcluded) issues.push('학생에게 전문·외국어 자료 읽기를 요구함')
  }
  const bands = lessonAudienceBands(gradeGroup, standards)
  if (bands.includes('1-2학년군') || bands.includes('3-4학년군')) {
    if (/(?:[5-9]\d{2}|\d{4,})\s*자\s*(?:이상|내외|분량|작성|의견문|논증문|[)）])/.test(text)) issues.push('낮은 학년군에 긴 글의 글자 수를 강제함')
    if (/정책\s*제안서|데이터\s*대시보드|회귀\s*분석|통계적\s*유의/.test(text)) issues.push('학년군에 비해 전문적인 산출물·분석을 요구함')
  }
  return [...new Set(issues)]
}

/** Include teachers' own sheet plans, never the previous AI example, in generation context. */
export function buildLessonTeachingContext(context: string | undefined, rows: ReadonlyArray<{ subject?: string; standard?: string; description?: string }> = []): string | undefined {
  const plans = rows.filter(row => row.description?.trim()).map(row =>
    `${row.subject || '교과'} ${(row.standard?.match(/\[?\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2}\]?/g) ?? []).join(', ')}: ${row.description!.trim().slice(0, 300)}`
  ).join('\n').slice(0, 1500)
  const parts = [context?.slice(0, 1500), plans && `교사가 분석시트에 적은 수업내용(활동 방향을 존중):\n${plans}`].filter(Boolean)
  return parts.join('\n') || undefined
}

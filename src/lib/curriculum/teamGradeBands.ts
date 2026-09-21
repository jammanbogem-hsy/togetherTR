/**
 * 팀 학년군(team grade bands) 헬퍼 — 순수 함수 모음.
 *
 * 1·3·5학년 담임이 한 팀으로 수업을 설계하는 일은 흔한데, 지금까지 앱은 프로젝트마다
 * 학년군 하나(`targetGradeGroup`)만 알고 있었다. 교사가 채팅에서 "저는 1학년, 저는 5학년"
 * 이라고 말해도 그 사실이 저장되지 않아 분석시트·AI 추론 어디에도 닿지 못했다.
 * 이 모듈은 "팀이 어느 학년군들로 구성되어 있는가"를 판정·표기·검증하는 규칙만 담당한다
 * (React·Firestore·파일시스템 의존 없음).
 *
 * 표기 규칙은 시트와 동일하다: 정규 라벨 '1-2학년군' | '3-4학년군' | '5-6학년군'.
 * 정규화는 sheetGradeBands.toGradeBandLabel 하나만 쓴다(규칙 중복 방지).
 *
 * 테스트: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/teamGradeBands.test.mjs
 * (확장자 없는 상대 import를 쓰므로 로더 훅이 필요하다.)
 */

import { ELEMENTARY_GRADE_BANDS, toGradeBandLabel, type ElementaryGradeBand } from './sheetGradeBands'

/** AI가 팀 학년군을 알릴 때 쓰는 내부 신호 이름 — 사용자에게 노출 금지. */
export const TEAM_GRADE_BANDS_SIGNAL = 'TEAM_GRADE_BANDS'

/** 신호 형식: [TEAM_GRADE_BANDS: 1-2,5-6] */
const TEAM_GRADE_BANDS_SIGNAL_RE = /\[TEAM_GRADE_BANDS:\s*([^\]]*)\]/

/**
 * 임의의 학년군 표기 목록을 정규 라벨로 정규화한다.
 * - 초등 학년군으로 환원되지 않는 값('중1-3', '2-3', 빈 값)은 버린다.
 * - 중복을 제거하고 항상 1-2 → 3-4 → 5-6 순서로 정렬한다(표시·저장 순서 고정).
 */
export function normalizeTeamGradeBands(
  values?: readonly (string | null | undefined)[] | null,
): ElementaryGradeBand[] {
  const found = new Set<string>()
  for (const value of values ?? []) {
    const label = toGradeBandLabel(value)
    if (label) found.add(label)
  }
  return ELEMENTARY_GRADE_BANDS.filter(band => found.has(band))
}

/** 학년군이 2개 이상이면 "여러 학년군 팀" — 시트 multi 모드·프롬프트 규칙의 발동 조건. */
export function isMultiGradeBandTeam(bands?: readonly (string | null | undefined)[] | null): boolean {
  return normalizeTeamGradeBands(bands).length >= 2
}

/**
 * 표시용 문자열: ['1-2학년군','5-6학년군'] → '1-2·5-6학년군'.
 * 대시보드 카드·프롬프트·채팅 안내가 모두 이 형식을 쓴다. 빈 목록은 ''.
 */
export function formatGradeBandList(bands?: readonly (string | null | undefined)[] | null): string {
  const normalized = normalizeTeamGradeBands(bands)
  if (normalized.length === 0) return ''
  return `${normalized.map(band => band.replace('학년군', '')).join('·')}학년군`
}

/**
 * 프로젝트가 실제로 쓸 학년군 목록.
 * 저장된 `teamGradeBands`가 있으면 그것, 없으면 `targetGradeGroup` 하나(기존 동작).
 * 초등이 아니면 [](중·고 프로젝트는 학년군 규칙을 쓰지 않는다).
 */
export function resolveTeamGradeBands(project: {
  teamGradeBands?: readonly (string | null | undefined)[] | null
  targetGradeGroup?: string | null
}): ElementaryGradeBand[] {
  const stored = normalizeTeamGradeBands(project.teamGradeBands)
  if (stored.length > 0) return stored
  return normalizeTeamGradeBands([project.targetGradeGroup])
}

/**
 * AI 응답에서 [TEAM_GRADE_BANDS: …] 신호를 뽑고 본문에서 제거한다.
 * 신호가 없으면 null. 신호가 있으면 항상 객체를 돌려주는데(bands가 빈 배열일 수 있음),
 * 판독 불가한 값이 와도 원문에서 신호를 반드시 지워 사용자 화면에 노출되지 않게 하려는 것이다.
 */
export function parseTeamGradeBandsSignal(
  text: string,
): { bands: ElementaryGradeBand[]; cleanText: string } | null {
  const match = (text ?? '').match(TEAM_GRADE_BANDS_SIGNAL_RE)
  if (!match) return null
  // 구분자를 가리지 않고 'N-M' 패턴을 전부 긁는다 — 모델이 쉼표·가운뎃점·'및'·줄바꿈을
  // 섞어 써도('1-2 · 5-6학년군', '1~2학년, 5~6학년') 같은 결과가 나오도록.
  const bands = normalizeTeamGradeBands(
    [...match[1].matchAll(/\d\s*[-~]\s*\d/g)].map(hit => hit[0]),
  )
  return {
    bands,
    cleanText: (text ?? '').replace(/\n*\[TEAM_GRADE_BANDS:[^\]]*\]/g, '').trimEnd(),
  }
}

/**
 * 정규 라벨 → 프로젝트 학년그룹 코드('1-2학년군' → '초1-2').
 *
 * 지식 그래프의 성취기준은 `grade_band`에 '초1-2' 형태를 저장하고 graphReader.searchStandards는
 * 니들 추출 없이 문자열 포함 비교를 하므로, 학년군 라벨을 그대로 넘기면 **조용히 0건**이 된다.
 * 학년군별 검색을 돌릴 때는 반드시 이 함수로 변환한 값을 기존 단일 학년군 빌더에 넘긴다.
 * 초등이 아니면 ''.
 */
export function toGradeGroupCode(band?: string | null): string {
  const label = toGradeBandLabel(band)
  return label ? `초${label.replace('학년군', '')}` : ''
}

// ─── 학년군별 교과 개설 사실 (2022 개정 교육과정) ───────────────────────────

/** 통합교과의 세 과목 — 1~2학년군에만 존재하며 사회·과학 등을 대신한다. */
export const INTEGRATED_SUBJECT_COURSES = ['바른 생활', '슬기로운 생활', '즐거운 생활'] as const

/** 1~2학년군 전용 교과 표기(시트·성취기준 데이터의 교과명). */
export const INTEGRATED_SUBJECT = '통합교과'

/**
 * 학년군별로 성취기준이 존재하는 교과.
 *  - 1-2학년군: 국어·수학·통합교과뿐이다(사회·과학·도덕·체육·음악·미술·영어 없음).
 *  - 3-4학년군: 사회·과학·도덕·체육·음악·미술·영어가 시작된다.
 *  - 5-6학년군: 3-4학년군 교과 + 실과(실과는 5-6학년군에만 있다).
 */
export const GRADE_BAND_SUBJECTS: Record<ElementaryGradeBand, readonly string[]> = {
  '1-2학년군': ['국어', '수학', INTEGRATED_SUBJECT],
  '3-4학년군': ['국어', '수학', '사회', '과학', '도덕', '체육', '음악', '미술', '영어'],
  '5-6학년군': ['국어', '수학', '사회', '과학', '도덕', '체육', '음악', '미술', '영어', '실과'],
}

/** 창의적 체험활동처럼 학년군 구분이 없는 교과 — 개설 판정에서 제외(항상 사용 가능). */
const BAND_FREE_SUBJECTS = ['창의적 체험활동', '창체', '자율', '동아리', '봉사', '진로']

/**
 * 교과명 별칭 → 표 기준 교과명. '실과'·'통합교과'처럼 이름 끝의 '과'가 교과명의 일부인
 * 경우가 있어 접미사 제거 같은 일반 규칙을 쓰지 않고 별칭을 명시한다.
 */
const SUBJECT_ALIASES: Record<string, string> = {
  국어과: '국어',
  수학과: '수학',
  사회과: '사회',
  과학과: '과학',
  도덕과: '도덕',
  체육과: '체육',
  음악과: '음악',
  미술과: '미술',
  영어과: '영어',
  실과과: '실과',
  기술가정: '실과',
  '기술·가정': '실과',
  정보: '실과',
}

function canonicalSubjectName(subject?: string | null): string {
  const name = (subject ?? '').replace(/\s+/g, '').trim()
  if (!name) return ''
  if (name.includes(INTEGRATED_SUBJECT)) return INTEGRATED_SUBJECT
  if (INTEGRATED_SUBJECT_COURSES.some(course => name.includes(course.replace(/\s+/g, '')))) {
    return INTEGRATED_SUBJECT
  }
  return SUBJECT_ALIASES[name] ?? name
}


/** 그 학년군에서 성취기준이 있는 교과 목록. */
export function subjectsForGradeBand(band?: string | null): readonly string[] {
  const label = toGradeBandLabel(band)
  if (!label) return []
  return GRADE_BAND_SUBJECTS[label as ElementaryGradeBand]
}

/**
 * 그 교과에 성취기준이 있는 학년군 목록.
 * 표에 없는 교과(창의적 체험활동 등 학년군 구분이 없는 자료)는 세 학년군 모두로 본다 —
 * 근거 없이 선택지를 좁히면 기존 데이터를 못 쓰게 되므로.
 */
export function gradeBandsForSubject(subject?: string | null): ElementaryGradeBand[] {
  const name = canonicalSubjectName(subject)
  if (!name) return [...ELEMENTARY_GRADE_BANDS]
  if (BAND_FREE_SUBJECTS.some(free => name.includes(free.replace(/\s+/g, '')))) {
    return [...ELEMENTARY_GRADE_BANDS]
  }
  const known = ELEMENTARY_GRADE_BANDS.filter(band =>
    GRADE_BAND_SUBJECTS[band].some(listed => canonicalSubjectName(listed) === name),
  )
  return known.length > 0 ? known : [...ELEMENTARY_GRADE_BANDS]
}

/** 그 교과가 그 학년군에 개설되어 있는지. 학년군을 판정할 수 없으면 true(= 제약 없음). */
export function subjectAvailableInGradeBand(subject?: string | null, band?: string | null): boolean {
  const label = toGradeBandLabel(band)
  if (!label) return true
  return gradeBandsForSubject(subject).includes(label as ElementaryGradeBand)
}

/** 팀이 고른 교과 중 그 학년군에 성취기준이 없는 것들 — 연결 줄·대체 교과 안내 대상. */
export function subjectsMissingInGradeBand(
  subjects: readonly (string | null | undefined)[] | null | undefined,
  band?: string | null,
): string[] {
  const label = toGradeBandLabel(band)
  if (!label) return []
  const out: string[] = []
  for (const subject of subjects ?? []) {
    const name = (subject ?? '').trim()
    if (!name || out.includes(name)) continue
    if (!subjectAvailableInGradeBand(name, label)) out.push(name)
  }
  return out
}

/**
 * 프롬프트에 넣을 "학년군별 교과 개설" 안내 줄. 팀 학년군만 다룬다(불필요한 학년군 설명 금지).
 * targetSubjects를 주면 그 학년군에 없는 교과를 함께 지적한다.
 */
export function describeGradeBandSubjects(
  bands?: readonly (string | null | undefined)[] | null,
  targetSubjects?: readonly string[] | null,
): string {
  const normalized = normalizeTeamGradeBands(bands)
  if (normalized.length === 0) return ''
  return normalized
    .map(band => {
      const available = subjectsForGradeBand(band).join('·')
      const missing = subjectsMissingInGradeBand(targetSubjects ?? [], band)
      const integrated = band === '1-2학년군'
        ? ` (통합교과 = ${INTEGRATED_SUBJECT_COURSES.join('·')})`
        : ''
      // 조사(은/는)는 목록 마지막 낱말에 따라 달라지므로 조사 없는 형태로 쓴다.
      const missingNote = missing.length > 0
        ? ` — 이 학년군에 성취기준이 없는 팀 교과: ${missing.join('·')}`
        : ''
      return `- ${band}: ${available}${integrated}${missingNote}`
    })
    .join('\n')
}

// ─── 여러 학년군 컨텍스트 조립 보조 ─────────────────────────────────────────

const DUPLICATE_CORE_IDEA_MARK = '(앞 학년군과 동일)'

/**
 * 학년군별 컨텍스트를 이어 붙이면 같은 교과·영역의 핵심아이디어 문장이 학년군마다 그대로
 * 반복된다(핵심아이디어는 학년군 공통이므로). 두 번째 이후 중복 문장을 표시로 바꿔
 * 프롬프트 길이를 줄인다. 원문 인용 규칙은 첫 등장 문장이 그대로 남으므로 유지된다.
 */
export function dedupeCoreIdeaLines(text: string): string {
  const seen = new Set<string>()
  return (text ?? '')
    .split('\n')
    .map(line => {
      const match = line.match(/^(\s*(?:핵심아이디어|✅ 핵심 아이디어)\s*:\s*)(.+)$/)
      if (!match) return line
      const value = match[2].trim()
      if (!value || value.startsWith('(')) return line
      if (seen.has(value)) return `${match[1]}${DUPLICATE_CORE_IDEA_MARK}`
      seen.add(value)
      return line
    })
    .join('\n')
}

/**
 * 프롬프트 폭주 방지용 상한. 학년군 수만큼 컨텍스트가 늘어나므로 총 길이를 자르고
 * 잘렸다는 사실을 남긴다(조용한 절단은 AI가 없는 데이터를 지어내게 만든다).
 */
export function capContextLength(text: string, limit: number): string {
  const value = text ?? ''
  if (limit <= 0) return ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n\n⚠️ (학년군별 교육과정 컨텍스트가 길어 이후 내용은 생략되었습니다. 필요한 학년군을 지정해 다시 질문하세요.)`
}

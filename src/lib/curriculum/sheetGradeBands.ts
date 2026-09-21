/**
 * 교육과정 분석 시트의 행별 학년군(grade band) 헬퍼 — 순수 함수 모음.
 *
 * 1·3·5학년 담임이 한 팀으로 수업을 설계하면 시트 한 장에 서로 다른 학년군의
 * 성취기준이 함께 들어온다. 기존 시트는 프로젝트 단위 `targetGradeGroup` 하나로
 * 모든 행을 필터링해 다른 학년군의 성취기준·내용 요소를 아예 불러올 수 없었다.
 * 이 모듈은 "행마다 학년군" 모델의 판정 규칙만 담당한다(React·Firestore 의존 없음).
 *
 * 표기 규칙: 학년군 라벨은 항상 '1-2학년군' | '3-4학년군' | '5-6학년군' 형태로
 * 정규화한다. 저장된 행에 `gradeBand`가 없으면 "시트 기준 학년군"을 뜻하므로
 * 기존 시트는 마이그레이션 없이 그대로 동작한다.
 *
 * 시트에는 두 가지 모드가 있다(프로젝트 문서에 저장 → 팀원 전체 공유):
 *  - 'single'(한 학년군): 시트 전체가 학년군 하나를 쓴다. 한 학년 팀도 1~6학년
 *    아무 학년군이나 직접 고를 수 있다. 행의 gradeBand는 보존만 하고 무시한다.
 *  - 'multi'(다양한 학년군): 행마다 학년군을 고른다. 행에 값이 없으면 시트 기준 학년군.
 */

/**
 * 학년군 표기에서 'N-M' 니들을 뽑는다 — curriculumFilters.gradeBandNeedle과 동일 규칙.
 * 그 함수를 import하지 않고 같은 정규식을 두는 이유: 이 모듈의 단위 테스트는
 * `node --experimental-strip-types`로 직접 실행되고, 그 로더는 확장자 없는 상대
 * import를 해석하지 못한다(tsconfig는 allowImportingTsExtensions 미사용).
 * 규칙이 바뀌면 curriculumFilters.gradeBandNeedle과 함께 수정해야 한다.
 */
function gradeBandNeedle(gradeGroup?: string | null): string {
  const match = (gradeGroup ?? '').trim().match(/(\d)\s*[-~]\s*(\d)/)
  return match ? `${match[1]}-${match[2]}` : ''
}

/** 초등 학년군 정규 라벨 (시트 선택기 옵션 순서와 동일). */
export const ELEMENTARY_GRADE_BANDS = ['1-2학년군', '3-4학년군', '5-6학년군'] as const

export type ElementaryGradeBand = (typeof ELEMENTARY_GRADE_BANDS)[number]

/** 통합교과(바른 생활·슬기로운 생활·즐거운 생활)는 1~2학년군에만 존재한다. */
export const INTEGRATED_SUBJECT = '통합교과'

/** 성취기준 코드의 선두 숫자(학년)를 뽑기 위한 패턴 — 예: [4국01-01], 2슬01-03. */
const STANDARD_CODE_RE = /(\d)[가-힣]{1,3}[\d가-힣]*\d{2}\s*-\s*\d{2}/

/** 학년군 판정에 쓰는 행의 최소 형태(시트 행과 자동 채우기 응답 모두 수용). */
export interface GradeBandRowLike {
  subject?: string
  standard?: string
  coreIdea?: string
  gradeBand?: string
  /** 다른 교과 핵심아이디어와 연결된 '연결 줄'이면 그 원본(교과·핵심아이디어). */
  linkedCoreIdea?: { subject: string; coreIdea: string }
}

function isElementaryBand(label: string): label is ElementaryGradeBand {
  return (ELEMENTARY_GRADE_BANDS as readonly string[]).includes(label)
}

/**
 * 임의의 학년군/학년그룹 표기를 정규 라벨로 변환한다.
 * '초3-4' · '3~4' · '3-4학년군' · '초등학교 3-4학년' → '3-4학년군'.
 * 초등 학년군으로 환원되지 않는 값('중1-3', '고공통', 빈 값)은 ''을 돌려주고,
 * 호출부는 "학년군 필터 없음"(= 기존 동작 유지)으로 처리한다.
 */
export function toGradeBandLabel(gradeGroupOrBand?: string | null): string {
  const needle = gradeBandNeedle(gradeGroupOrBand)
  if (!needle) return ''
  const label = `${needle}학년군`
  return isElementaryBand(label) ? label : ''
}

/** 성취기준 코드의 선두 학년 숫자로 학년군을 추정한다. 판정 불가 시 ''. */
export function gradeBandFromStandardCode(standard?: string | null): string {
  const digit = (standard ?? '').match(STANDARD_CODE_RE)?.[1]
  if (digit === '1' || digit === '2') return '1-2학년군'
  if (digit === '3' || digit === '4') return '3-4학년군'
  if (digit === '5' || digit === '6') return '5-6학년군'
  return ''
}

/** 해당 교과에서 고를 수 있는 학년군 — 통합교과만 1~2학년군으로 제한된다. */
export function allowedGradeBandsForSubject(subject?: string | null): ElementaryGradeBand[] {
  const name = (subject ?? '').trim()
  if (name && (name === INTEGRATED_SUBJECT || name.includes(INTEGRATED_SUBJECT))) return ['1-2학년군']
  return [...ELEMENTARY_GRADE_BANDS]
}

/**
 * 행이 실제로 사용할 학년군. 우선순위: 행에 저장된 값 → 프로젝트 학년군.
 * 교과가 통합교과면 저장값과 무관하게 1~2학년군으로 고정한다.
 * 어느 쪽도 초등 학년군이 아니면 ''(= 학년군 필터 없음).
 */
export function resolveRowGradeBand(row: GradeBandRowLike, projectGradeGroup?: string | null): string {
  const allowed = allowedGradeBandsForSubject(row.subject)
  if (allowed.length === 1) return allowed[0]
  const own = toGradeBandLabel(row.gradeBand)
  if (own) return own
  return toGradeBandLabel(projectGradeGroup)
}

/**
 * 지식·이해/과정·기능/가치·태도 값에 붙일 학년군 접두어 판정.
 * 우선순위: 행에 저장된 값 → 성취기준 코드에서 추정 → 프로젝트 학년군.
 * (행에 학년군이 없는 기존 시트는 "코드 → 프로젝트" 순서가 그대로 유지된다.)
 */
export function resolveGradePrefixBand(row: GradeBandRowLike, projectGradeGroup?: string | null): string {
  const allowed = allowedGradeBandsForSubject(row.subject)
  if (allowed.length === 1) return allowed[0]
  const own = toGradeBandLabel(row.gradeBand)
  if (own) return own
  const fromCode = gradeBandFromStandardCode(row.standard)
  if (fromCode) return fromCode
  return toGradeBandLabel(projectGradeGroup)
}

/**
 * 성취기준(코드 또는 '1~2학년군' 같은 학년군 표기)이 대상 학년군에 속하는지.
 * 대상 학년군을 판정할 수 없으면 true(= 필터링하지 않음)를 돌려준다.
 */
export function standardMatchesGradeBand(standardCodeOrBand?: string | null, band?: string | null): boolean {
  const target = toGradeBandLabel(band)
  if (!target) return true
  const fromCode = gradeBandFromStandardCode(standardCodeOrBand)
  if (fromCode) return fromCode === target
  const fromLabel = toGradeBandLabel(standardCodeOrBand)
  if (fromLabel) return fromLabel === target
  return true
}

/**
 * 내용 요소를 행 학년군으로 "엄격하게" 필터한다.
 *  - 학년군을 판정할 수 없으면 그대로(필터 없음).
 *  - 학년군 접두어가 붙은 항목이 없으면 그대로(창의적 체험활동처럼 학년군 구분이 없는 자료).
 *  - 접두어가 있으면 그 학년군 항목만 남기고, 하나도 없으면 [].
 *
 * curriculumFilters.filterContentItemsByGrade와 다른 점은 마지막 줄이다. 그쪽은 "빈 셀보다
 * 공식 자료가 낫다"며 전체 접두어 항목으로 복구하는데, 시트에서는 그 복구가 곧 오염이다.
 * 해당 학년군에 성취기준이 없는 교과(1-2학년군의 사회 등)에 다른 학년군 내용 요소가
 * 들어차기 때문이다. 성취기준이 비면 지식·이해/과정·기능/가치·태도도 함께 비어야 한다.
 * (공유 헬퍼는 다른 API 라우트가 복구 동작에 의존하므로 그대로 둔다.)
 */
export function filterItemsByGradeBandStrict(items: string[], band?: string | null): string[] {
  const target = toGradeBandLabel(band)
  if (!target) return items
  const prefixed = items.filter(item => /^\d+-\d+학년군:/.test(item))
  if (prefixed.length === 0) return items
  return prefixed.filter(item => toGradeBandLabel(item.slice(0, item.indexOf(':'))) === target)
}

/** 학년군 판정에 쓰는 성취기준의 최소 형태(시트가 불러온 FlatStandard와 호환). */
export interface GradeBandStandardLike {
  subject: string
  code?: string
  gradeBand?: string
}

/**
 * 그 교과가 실제로 성취기준을 가진 학년군 목록. 불러온 성취기준에서 코드 선두 학년 →
 * 원문 학년군 표기 순으로 판정하고, 교과 제약(통합교과=1-2학년군)과 교집합을 취한다.
 * 성취기준이 아직 로딩 중이면(빈 배열) 교과 제약을 그대로 돌려준다 — 판정 근거가 없을 때
 * 선택지를 좁히면 기존 데이터를 못 고치게 되므로.
 */
export function bandsWithStandards(
  standards: GradeBandStandardLike[],
  subject?: string | null,
): ElementaryGradeBand[] {
  const allowed = allowedGradeBandsForSubject(subject)
  if (standards.length === 0) return allowed
  const name = (subject ?? '').trim()
  const found = new Set<string>()
  for (const standard of standards) {
    if (name && standard.subject !== name) continue
    const band = gradeBandFromStandardCode(standard.code) || toGradeBandLabel(standard.gradeBand)
    if (band) found.add(band)
  }
  const scoped = allowed.filter(band => found.has(band))
  return scoped
}

/** 그 교과에 성취기준이 없는 학년군 — '연결 줄'을 제안할 대상(사회 1-2학년군 등). */
export function bandsLackingStandards(
  standards: GradeBandStandardLike[],
  subject?: string | null,
): ElementaryGradeBand[] {
  if (standards.length === 0) return []
  const withStandards = bandsWithStandards(standards, subject)
  return allowedGradeBandsForSubject(subject).filter(band => !withStandards.includes(band))
}

/**
 * 연결 줄 생성 — 팀이 고른 핵심아이디어는 linkedCoreIdea에 남기고, 교과·핵심아이디어·
 * 성취기준·내용 요소는 비운다('유사 성취기준 찾기'로 그 학년군 실제 성취기준을 채운다).
 */
export function makeBridgeRow<T extends GradeBandRowLike>(
  sourceRow: T,
  band: string,
): {
  subject: string
  coreIdea: string
  standard: string
  knowledge: string
  processFunction: string
  valueAttitude: string
  gradeBand: string
  isCenter: false
  linkedCoreIdea: { subject: string; coreIdea: string }
} {
  return {
    subject: '',
    coreIdea: '',
    standard: '',
    knowledge: '',
    processFunction: '',
    valueAttitude: '',
    gradeBand: band,
    isCenter: false,
    linkedCoreIdea: {
      subject: (sourceRow.subject ?? '').trim(),
      coreIdea: (sourceRow.coreIdea ?? '').trim(),
    },
  }
}

/**
 * 같은 교과·핵심아이디어 묶음에서 이미 쓰인 학년군 목록.
 * 그 핵심아이디어에 연결된 '연결 줄'(linkedCoreIdea)도 같은 묶음으로 센다 —
 * 1-2학년군 연결 줄을 이미 만들었으면 같은 버튼을 다시 제안하지 않도록.
 */
export function usedGradeBands(
  rows: GradeBandRowLike[],
  subject: string,
  coreIdea: string,
  projectGradeGroup?: string | null,
): string[] {
  const subjectKey = (subject ?? '').trim()
  const ideaKey = (coreIdea ?? '').trim()
  const inGroup = (row: GradeBandRowLike) => (
    ((row.subject ?? '').trim() === subjectKey && (row.coreIdea ?? '').trim() === ideaKey)
    || ((row.linkedCoreIdea?.subject ?? '').trim() === subjectKey
      && (row.linkedCoreIdea?.coreIdea ?? '').trim() === ideaKey)
  )
  return [...new Set(
    rows
      .filter(inGroup)
      .map(row => resolveRowGradeBand(row, projectGradeGroup))
      .filter(Boolean),
  )]
}

/**
 * '＋ 학년군 줄'이 새로 만들 학년군. 같은 교과·핵심아이디어에서 아직 쓰지 않은
 * 학년군 중 fallback 다음 순서를 고르고, 남은 학년군이 없으면 ''을 돌려준다
 * (호출부는 버튼을 비활성화한다).
 */
export function nextUnusedGradeBand(
  rows: GradeBandRowLike[],
  subject: string,
  coreIdea: string,
  fallbackGradeGroup?: string | null,
  allowedBands?: readonly ElementaryGradeBand[],
): string {
  // allowedBands를 주면 그 교과가 성취기준을 가진 학년군으로 좁힌다(없는 학년군 줄 생성 방지).
  const allowed = allowedBands && allowedBands.length > 0
    ? ELEMENTARY_GRADE_BANDS.filter(band => allowedBands.includes(band))
    : allowedGradeBandsForSubject(subject)
  const used = new Set(usedGradeBands(rows, subject, coreIdea, fallbackGradeGroup))
  const remaining = allowed.filter(band => !used.has(band))
  if (remaining.length === 0) return ''
  const current = toGradeBandLabel(fallbackGradeGroup)
  const startIndex = current ? allowed.indexOf(current as ElementaryGradeBand) : -1
  if (startIndex >= 0) {
    // fallback 다음 학년군부터 순환 탐색 — 3-4 프로젝트면 5-6 → 1-2 순서.
    for (let step = 1; step <= allowed.length; step += 1) {
      const candidate = allowed[(startIndex + step) % allowed.length]
      if (!used.has(candidate)) return candidate
    }
  }
  return remaining[0]
}

/** 시트 학년군 모드 — 프로젝트 문서의 curriculumSheetGradeMode. */
export type SheetGradeMode = 'single' | 'multi'

/**
 * 저장된 모드가 없을 때의 기본값. 이미 서로 다른 학년군이 2개 이상 들어간 시트는
 * 혼성 학년 팀이 쓰던 것이므로 'multi', 그 밖에는 'single'.
 * (행에 실제로 저장된 gradeBand만 센다 — 폴백으로 유도된 값은 세지 않는다.)
 */
export function defaultGradeMode(rows: GradeBandRowLike[]): SheetGradeMode {
  const explicit = new Set(
    rows.map(row => toGradeBandLabel(row.gradeBand)).filter(Boolean),
  )
  return explicit.size >= 2 ? 'multi' : 'single'
}

/**
 * 시트 기준 학년군 — 저장된 값이 초등 학년군이면 그것, 아니면 프로젝트 학년군.
 * 둘 다 판정 불가면 ''(중·고 프로젝트: 학년군 UI를 쓰지 않는다).
 */
export function resolveSheetGradeBand(savedBand?: string | null, projectGradeGroup?: string | null): string {
  return toGradeBandLabel(savedBand) || toGradeBandLabel(projectGradeGroup)
}

/**
 * 행이 실제로 쓰는 학년군 — 모드에 따라 달라진다.
 *  - 'single': 시트 기준 학년군 하나(행 값 무시, 데이터는 보존).
 *  - 'multi': 행 값 → 시트 기준 학년군.
 * 통합교과는 두 모드 모두 1~2학년군으로 고정한다(다른 학년군에 존재하지 않는 교과).
 */
export function effectiveRowGradeBand(
  row: GradeBandRowLike,
  mode: SheetGradeMode,
  sheetGradeBand?: string | null,
): string {
  const allowed = allowedGradeBandsForSubject(row.subject)
  if (allowed.length === 1) return allowed[0]
  if (mode === 'single') return toGradeBandLabel(sheetGradeBand)
  return resolveRowGradeBand(row, sheetGradeBand)
}

/**
 * 학년군 접두어 판정의 모드 대응판.
 *  - 'single': 행에 저장된 학년군은 무시하고 "성취기준 코드 → 시트 학년군" 순서로 본다.
 *    (행 값을 보존하되 화면·저장 내용이 시트 학년군과 어긋나지 않게.)
 *  - 'multi': 행 값 → 성취기준 코드 → 시트 학년군.
 */
export function resolveGradePrefixBandForMode(
  row: GradeBandRowLike,
  mode: SheetGradeMode,
  sheetGradeBand?: string | null,
): string {
  if (mode === 'single') return resolveGradePrefixBand({ ...row, gradeBand: undefined }, sheetGradeBand)
  return resolveGradePrefixBand(row, sheetGradeBand)
}

/**
 * 'single' 모드에서 시트 학년군과 통합교과가 어긋난 행인지.
 * (통합교과는 1~2학년군 전용이라 시트가 3-4/5-6이면 그 행만 1~2학년군으로 동작한다 → 행에 안내 표시.)
 */
export function integratedBandMismatch(
  row: GradeBandRowLike,
  mode: SheetGradeMode,
  sheetGradeBand?: string | null,
): boolean {
  if (mode !== 'single') return false
  if (allowedGradeBandsForSubject(row.subject).length !== 1) return false
  const sheetBand = toGradeBandLabel(sheetGradeBand)
  return !!sheetBand && sheetBand !== '1-2학년군'
}

/**
 * 시트 전체에서 실제로 쓰인 학년군 — 2개 이상일 때만 산출물 표에 학년군을 덧붙인다.
 * single 모드는 행에 저장된 학년군을 무시하므로 보통 1개로 수렴한다(표가 기존과 동일).
 */
export function distinctGradeBands(
  rows: GradeBandRowLike[],
  mode: SheetGradeMode,
  sheetGradeBand?: string | null,
): string[] {
  return [...new Set(
    rows
      .map(row => resolveGradePrefixBandForMode(row, mode, sheetGradeBand))
      .filter(Boolean),
  )]
}

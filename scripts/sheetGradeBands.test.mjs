// Regression tests for src/lib/curriculum/sheetGradeBands.ts
// Run: node --experimental-strip-types scripts/sheetGradeBands.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ELEMENTARY_GRADE_BANDS,
  toGradeBandLabel,
  gradeBandFromStandardCode,
  allowedGradeBandsForSubject,
  resolveRowGradeBand,
  resolveGradePrefixBand,
  standardMatchesGradeBand,
  usedGradeBands,
  nextUnusedGradeBand,
  distinctGradeBands,
  defaultGradeMode,
  resolveSheetGradeBand,
  effectiveRowGradeBand,
  integratedBandMismatch,
  resolveGradePrefixBandForMode,
  filterItemsByGradeBandStrict,
  bandsWithStandards,
  bandsLackingStandards,
  makeBridgeRow,
  extractStandardCode,
  planMapPickApplication,
} from '../src/lib/curriculum/sheetGradeBands.ts'

test('ELEMENTARY_GRADE_BANDS: canonical labels in picker order', () => {
  assert.deepEqual([...ELEMENTARY_GRADE_BANDS], ['1-2학년군', '3-4학년군', '5-6학년군'])
})

test('toGradeBandLabel: canonicalizes project grade groups and band labels', () => {
  assert.equal(toGradeBandLabel('초3-4'), '3-4학년군')
  assert.equal(toGradeBandLabel('3~4'), '3-4학년군')
  assert.equal(toGradeBandLabel('3-4학년군'), '3-4학년군')
  assert.equal(toGradeBandLabel('1~2학년군'), '1-2학년군')
  assert.equal(toGradeBandLabel('초등학교 5-6학년'), '5-6학년군')
})

test('toGradeBandLabel: non-elementary or unparseable values yield empty (no filtering)', () => {
  assert.equal(toGradeBandLabel('중1-3'), '')
  assert.equal(toGradeBandLabel('고공통'), '')
  assert.equal(toGradeBandLabel(''), '')
  assert.equal(toGradeBandLabel(null), '')
  assert.equal(toGradeBandLabel(undefined), '')
})

test('gradeBandFromStandardCode: infers the band from the leading grade digit', () => {
  assert.equal(gradeBandFromStandardCode('[2슬01-03] 우리가 사는 곳을 살펴본다'), '1-2학년군')
  assert.equal(gradeBandFromStandardCode('4국01-01'), '3-4학년군')
  assert.equal(gradeBandFromStandardCode('[6수02-05] 합동과 대칭'), '5-6학년군')
})

test('gradeBandFromStandardCode: returns empty for non-elementary codes and prose', () => {
  assert.equal(gradeBandFromStandardCode('[9국01-01]'), '')
  assert.equal(gradeBandFromStandardCode('3-4학년군: 밀기와 당기기'), '')
  assert.equal(gradeBandFromStandardCode(''), '')
  assert.equal(gradeBandFromStandardCode(undefined), '')
})

test('allowedGradeBandsForSubject: 통합교과 is 1-2 only, every other subject gets all three', () => {
  assert.deepEqual(allowedGradeBandsForSubject('통합교과'), ['1-2학년군'])
  assert.deepEqual(allowedGradeBandsForSubject('바른 생활·슬기로운 생활·즐거운 생활 (통합교과)'), ['1-2학년군'])
  assert.deepEqual(allowedGradeBandsForSubject('국어'), ['1-2학년군', '3-4학년군', '5-6학년군'])
  assert.deepEqual(allowedGradeBandsForSubject(''), ['1-2학년군', '3-4학년군', '5-6학년군'])
})

test('resolveRowGradeBand: row value wins, missing value falls back to the project band', () => {
  assert.equal(resolveRowGradeBand({ subject: '국어', gradeBand: '5-6학년군' }, '초3-4'), '5-6학년군')
  // 기존 시트(학년군 없음)는 프로젝트 학년군을 그대로 쓴다 — 하위 호환.
  assert.equal(resolveRowGradeBand({ subject: '국어' }, '초3-4'), '3-4학년군')
  assert.equal(resolveRowGradeBand({}, '초5-6'), '5-6학년군')
})

test('resolveRowGradeBand: 통합교과 is forced to 1-2 regardless of stored or project band', () => {
  assert.equal(resolveRowGradeBand({ subject: '통합교과', gradeBand: '5-6학년군' }, '초5-6'), '1-2학년군')
  assert.equal(resolveRowGradeBand({ subject: '통합교과' }, '초3-4'), '1-2학년군')
})

test('resolveRowGradeBand: ignores the achievement-standard code (picker must follow the chosen band)', () => {
  assert.equal(resolveRowGradeBand({ subject: '수학', standard: '[4수01-01]' }, '초5-6'), '5-6학년군')
})

test('resolveGradePrefixBand: row band → standard code → project band', () => {
  assert.equal(resolveGradePrefixBand({ subject: '수학', gradeBand: '1-2학년군', standard: '[4수01-01]' }, '초5-6'), '1-2학년군')
  assert.equal(resolveGradePrefixBand({ subject: '수학', standard: '[4수01-01]' }, '초5-6'), '3-4학년군')
  assert.equal(resolveGradePrefixBand({ subject: '수학' }, '초5-6'), '5-6학년군')
  assert.equal(resolveGradePrefixBand({ subject: '수학' }, '중1-3'), '')
})

test('standardMatchesGradeBand: code and band-label inputs both resolve', () => {
  assert.equal(standardMatchesGradeBand('[4국01-01] 대화의 즐거움', '3-4학년군'), true)
  assert.equal(standardMatchesGradeBand('[4국01-01] 대화의 즐거움', '5-6학년군'), false)
  assert.equal(standardMatchesGradeBand('1~2학년군', '1-2학년군'), true)
  assert.equal(standardMatchesGradeBand('1~2학년군', '3-4학년군'), false)
})

test('standardMatchesGradeBand: undecidable target or source keeps the standard (no silent wipe)', () => {
  assert.equal(standardMatchesGradeBand('[4국01-01]', ''), true)
  assert.equal(standardMatchesGradeBand('[4국01-01]', '중1-3'), true)
  assert.equal(standardMatchesGradeBand('전학년', '3-4학년군'), true)
})

test('usedGradeBands: groups by subject + coreIdea only', () => {
  const rows = [
    { subject: '국어', coreIdea: '아이디어 A', gradeBand: '3-4학년군' },
    { subject: '국어', coreIdea: '아이디어 A', gradeBand: '5-6학년군' },
    { subject: '국어', coreIdea: '아이디어 B', gradeBand: '1-2학년군' },
    { subject: '수학', coreIdea: '아이디어 A', gradeBand: '1-2학년군' },
  ]
  assert.deepEqual(usedGradeBands(rows, '국어', '아이디어 A', '초3-4'), ['3-4학년군', '5-6학년군'])
  assert.deepEqual(usedGradeBands(rows, '국어', '아이디어 B', '초3-4'), ['1-2학년군'])
})

test('usedGradeBands: a row without a band counts as the project band', () => {
  const rows = [{ subject: '국어', coreIdea: '아이디어 A' }]
  assert.deepEqual(usedGradeBands(rows, '국어', '아이디어 A', '초3-4'), ['3-4학년군'])
})

test('nextUnusedGradeBand: starts after the project band and wraps around', () => {
  const rows = [{ subject: '국어', coreIdea: '아이디어 A' }] // 프로젝트 학년군 3-4 사용 중
  assert.equal(nextUnusedGradeBand(rows, '국어', '아이디어 A', '초3-4'), '5-6학년군')
  const withFive = [...rows, { subject: '국어', coreIdea: '아이디어 A', gradeBand: '5-6학년군' }]
  assert.equal(nextUnusedGradeBand(withFive, '국어', '아이디어 A', '초3-4'), '1-2학년군')
})

test('nextUnusedGradeBand: empty when every allowed band is taken (button disabled)', () => {
  const rows = ELEMENTARY_GRADE_BANDS.map(gradeBand => ({ subject: '국어', coreIdea: '아이디어 A', gradeBand }))
  assert.equal(nextUnusedGradeBand(rows, '국어', '아이디어 A', '초3-4'), '')
})

test('nextUnusedGradeBand: 통합교과 has only one band, so it is immediately exhausted', () => {
  assert.equal(nextUnusedGradeBand([], '통합교과', '아이디어 A', '초1-2'), '1-2학년군')
  const rows = [{ subject: '통합교과', coreIdea: '아이디어 A', gradeBand: '1-2학년군' }]
  assert.equal(nextUnusedGradeBand(rows, '통합교과', '아이디어 A', '초1-2'), '')
})

test('nextUnusedGradeBand: unparseable project band still returns a free band', () => {
  assert.equal(nextUnusedGradeBand([], '국어', '아이디어 A', '중1-3'), '1-2학년군')
})

test('distinctGradeBands: single-band sheets stay single (artifact keeps its columns)', () => {
  const rows = [
    { subject: '국어', standard: '[4국01-01]' },
    { subject: '수학', standard: '[4수01-01]' },
  ]
  assert.deepEqual(distinctGradeBands(rows, 'multi', '초3-4'), ['3-4학년군'])
})

test('distinctGradeBands: mixed-grade sheets report every band used', () => {
  const rows = [
    { subject: '국어', gradeBand: '3-4학년군' },
    { subject: '국어', gradeBand: '5-6학년군' },
    { subject: '통합교과' },
  ]
  assert.deepEqual(distinctGradeBands(rows, 'multi', '초3-4'), ['3-4학년군', '5-6학년군', '1-2학년군'])
  // single 모드는 행 학년군을 무시하므로 한 학년군으로 수렴한다(통합교과만 예외).
  assert.deepEqual(distinctGradeBands(rows, 'single', '초3-4'), ['3-4학년군', '1-2학년군'])
})

// ─── 시트 학년군 모드 (한 학년군 / 다양한 학년군) ───────────────────────────

test('defaultGradeMode: multi only when 2+ distinct bands are actually stored', () => {
  assert.equal(defaultGradeMode([]), 'single')
  assert.equal(defaultGradeMode([{ subject: '국어' }, { subject: '수학' }]), 'single')
  assert.equal(defaultGradeMode([{ gradeBand: '3-4학년군' }, { gradeBand: '3-4학년군' }]), 'single')
  assert.equal(defaultGradeMode([{ gradeBand: '3-4학년군' }, { gradeBand: '5-6학년군' }]), 'multi')
})

test('defaultGradeMode: ignores unparseable stored bands', () => {
  assert.equal(defaultGradeMode([{ gradeBand: '3-4학년군' }, { gradeBand: '중1-3' }]), 'single')
})

test('resolveSheetGradeBand: saved band wins, else the project grade group', () => {
  assert.equal(resolveSheetGradeBand('5-6학년군', '초3-4'), '5-6학년군')
  assert.equal(resolveSheetGradeBand(undefined, '초3-4'), '3-4학년군')
  assert.equal(resolveSheetGradeBand('', '초1-2'), '1-2학년군')
  assert.equal(resolveSheetGradeBand(null, '중1-3'), '')
})

test('effectiveRowGradeBand: single mode uses the sheet band and ignores the row value', () => {
  const row = { subject: '국어', gradeBand: '1-2학년군' }
  assert.equal(effectiveRowGradeBand(row, 'single', '5-6학년군'), '5-6학년군')
  // 행 데이터는 보존만 하므로 multi로 되돌리면 그대로 살아난다.
  assert.equal(effectiveRowGradeBand(row, 'multi', '5-6학년군'), '1-2학년군')
})

test('effectiveRowGradeBand: multi mode falls back to the sheet band', () => {
  assert.equal(effectiveRowGradeBand({ subject: '국어' }, 'multi', '3-4학년군'), '3-4학년군')
})

test('effectiveRowGradeBand: 통합교과 stays 1-2 in both modes', () => {
  assert.equal(effectiveRowGradeBand({ subject: '통합교과' }, 'single', '5-6학년군'), '1-2학년군')
  assert.equal(effectiveRowGradeBand({ subject: '통합교과', gradeBand: '3-4학년군' }, 'multi', '3-4학년군'), '1-2학년군')
})

test('integratedBandMismatch: warns only in single mode when the sheet band is not 1-2', () => {
  assert.equal(integratedBandMismatch({ subject: '통합교과' }, 'single', '3-4학년군'), true)
  assert.equal(integratedBandMismatch({ subject: '통합교과' }, 'single', '1-2학년군'), false)
  assert.equal(integratedBandMismatch({ subject: '통합교과' }, 'multi', '5-6학년군'), false)
  assert.equal(integratedBandMismatch({ subject: '국어' }, 'single', '5-6학년군'), false)
})

test('resolveGradePrefixBandForMode: single mode ignores the row band but trusts the standard code', () => {
  const row = { subject: '수학', gradeBand: '1-2학년군', standard: '[6수01-01]' }
  assert.equal(resolveGradePrefixBandForMode(row, 'single', '5-6학년군'), '5-6학년군')
  assert.equal(resolveGradePrefixBandForMode({ subject: '수학' }, 'single', '5-6학년군'), '5-6학년군')
  // 성취기준 코드가 시트 학년군과 다르면 코드를 따른다(내용의 실제 출처).
  assert.equal(resolveGradePrefixBandForMode({ subject: '수학', standard: '[4수01-01]' }, 'single', '5-6학년군'), '3-4학년군')
})

test('resolveGradePrefixBandForMode: multi mode keeps row band first', () => {
  const row = { subject: '수학', gradeBand: '1-2학년군', standard: '[6수01-01]' }
  assert.equal(resolveGradePrefixBandForMode(row, 'multi', '5-6학년군'), '1-2학년군')
})

// ─── 학년군에 성취기준이 없는 교과 (사회 1-2학년군 등) ─────────────────────

test('filterItemsByGradeBandStrict: keeps only the requested band', () => {
  const items = ['3-4학년군: 밀기와 당기기', '5-6학년군: 속력']
  assert.deepEqual(filterItemsByGradeBandStrict(items, '5-6학년군'), ['5-6학년군: 속력'])
})

test('filterItemsByGradeBandStrict: empty when the band has nothing (no recovery)', () => {
  // 공유 filterContentItemsByGrade는 전체 접두어 항목으로 복구하지만, 시트는 비워야 한다.
  const items = ['3-4학년군: 지역의 위치', '5-6학년군: 국토의 지형']
  assert.deepEqual(filterItemsByGradeBandStrict(items, '1-2학년군'), [])
})

test('filterItemsByGradeBandStrict: unprefixed items and undecidable bands pass through', () => {
  const plain = ['자율·자치 활동', '동아리 활동']
  assert.deepEqual(filterItemsByGradeBandStrict(plain, '1-2학년군'), plain)
  const prefixed = ['3-4학년군: A']
  assert.deepEqual(filterItemsByGradeBandStrict(prefixed, '중1-3'), prefixed)
  assert.deepEqual(filterItemsByGradeBandStrict(prefixed, ''), prefixed)
})

test('bandsWithStandards: derives bands from the code, else the band label', () => {
  const standards = [
    { subject: '사회', code: '4사01-01', gradeBand: '3~4학년군' },
    { subject: '사회', code: '6사01-01', gradeBand: '5~6학년군' },
    { subject: '국어', code: '2국01-01', gradeBand: '1~2학년군' },
    { subject: '실과', code: '', gradeBand: '5~6학년군' },
  ]
  assert.deepEqual(bandsWithStandards(standards, '사회'), ['3-4학년군', '5-6학년군'])
  assert.deepEqual(bandsWithStandards(standards, '국어'), ['1-2학년군'])
  assert.deepEqual(bandsWithStandards(standards, '실과'), ['5-6학년군'])
})

test('bandsWithStandards: intersects with the subject constraint and falls back while loading', () => {
  const standards = [{ subject: '통합교과', code: '2바01-01', gradeBand: '1~2학년군' }]
  assert.deepEqual(bandsWithStandards(standards, '통합교과'), ['1-2학년군'])
  // 성취기준 로딩 전(빈 배열)에는 교과 제약을 그대로 — 선택지를 성급히 좁히지 않는다.
  assert.deepEqual(bandsWithStandards([], '사회'), ['1-2학년군', '3-4학년군', '5-6학년군'])
  // 해당 교과 성취기준이 하나도 없으면 빈 목록(호출부가 안내를 띄운다).
  assert.deepEqual(bandsWithStandards(standards, '사회'), [])
})

test('nextUnusedGradeBand: respects the allowed-band list', () => {
  const rows = [{ subject: '사회', coreIdea: '아이디어 A', gradeBand: '3-4학년군' }]
  const allowed = ['3-4학년군', '5-6학년군']
  assert.equal(nextUnusedGradeBand(rows, '사회', '아이디어 A', '초3-4', allowed), '5-6학년군')
  const both = [...rows, { subject: '사회', coreIdea: '아이디어 A', gradeBand: '5-6학년군' }]
  // 1-2학년군은 사회에 성취기준이 없으므로 더 만들 줄이 없다.
  assert.equal(nextUnusedGradeBand(both, '사회', '아이디어 A', '초3-4', allowed), '')
  // 목록을 주지 않으면 기존처럼 세 학년군 전부를 본다.
  assert.equal(nextUnusedGradeBand(both, '사회', '아이디어 A', '초3-4'), '1-2학년군')
})

// ─── 연결 줄 (다른 교과 성취기준을 팀 핵심아이디어에 연결) ─────────────────

const SOCIAL_STANDARDS = [
  { subject: '사회', code: '4사01-01', gradeBand: '3~4학년군' },
  { subject: '사회', code: '6사01-01', gradeBand: '5~6학년군' },
  { subject: '실과', code: '6실01-01', gradeBand: '5~6학년군' },
  { subject: '국어', code: '2국01-01', gradeBand: '1~2학년군' },
]

test('bandsLackingStandards: bands the subject has no standards in', () => {
  assert.deepEqual(bandsLackingStandards(SOCIAL_STANDARDS, '사회'), ['1-2학년군'])
  assert.deepEqual(bandsLackingStandards(SOCIAL_STANDARDS, '실과'), ['1-2학년군', '3-4학년군'])
  assert.deepEqual(bandsLackingStandards(SOCIAL_STANDARDS, '국어'), ['3-4학년군', '5-6학년군'])
})

test('bandsLackingStandards: 통합교과 is 1-2 only, so it lacks nothing; loading yields nothing', () => {
  const integrated = [{ subject: '통합교과', code: '2바01-01', gradeBand: '1~2학년군' }]
  assert.deepEqual(bandsLackingStandards(integrated, '통합교과'), [])
  // 성취기준 로딩 전에는 연결 줄을 제안하지 않는다(근거 없음).
  assert.deepEqual(bandsLackingStandards([], '사회'), [])
})

test('makeBridgeRow: empties the mapping cells and keeps the source idea as a link', () => {
  const source = { subject: '사회', coreIdea: '지역은 고유한 특성을 가진다.', gradeBand: '3-4학년군' }
  const bridge = makeBridgeRow(source, '1-2학년군')
  assert.equal(bridge.subject, '')
  assert.equal(bridge.coreIdea, '')
  assert.equal(bridge.standard, '')
  assert.equal(bridge.knowledge, '')
  assert.equal(bridge.processFunction, '')
  assert.equal(bridge.valueAttitude, '')
  assert.equal(bridge.gradeBand, '1-2학년군')
  assert.equal(bridge.isCenter, false)
  assert.deepEqual(bridge.linkedCoreIdea, { subject: '사회', coreIdea: '지역은 고유한 특성을 가진다.' })
})

test('usedGradeBands: counts bridge rows in the source core-idea group', () => {
  const rows = [
    { subject: '사회', coreIdea: '아이디어 A', gradeBand: '3-4학년군' },
    // 통합교과 연결 줄 — 교과·핵심아이디어는 다르지만 같은 묶음으로 센다.
    { subject: '통합교과', coreIdea: '우리는 서로 관계를 맺으며 생활한다.', gradeBand: '1-2학년군', linkedCoreIdea: { subject: '사회', coreIdea: '아이디어 A' } },
  ]
  assert.deepEqual(usedGradeBands(rows, '사회', '아이디어 A', '초3-4'), ['3-4학년군', '1-2학년군'])
})

// ─── 분석맵 → 시트 반영 계획 ───────────────────────────────────────────

const PICK_KOR = { code: '[4국01-01]', standard: '[4국01-01] 대화의 즐거움을 안다', subject: '국어', band: '3-4학년군', coreIdea: '듣기·말하기는 소통이다.', contentCoreIdea: '화자와 청자는 의미를 나눈다.' }
const PICK_KOR2 = { code: '[4국01-02]', standard: '[4국01-02] 요약하며 듣는다', subject: '국어', band: '3-4학년군', coreIdea: '듣기·말하기는 소통이다.', contentCoreIdea: '화자와 청자는 의미를 나눈다.' }
const PICK_MATH = { code: '[4수01-01]', standard: '[4수01-01] 큰 수를 안다', subject: '수학', band: '3-4학년군', coreIdea: '수는 양을 나타낸다.' }
const PICK_MATH6 = { code: '[6수01-01]', standard: '[6수01-01] 분수의 나눗셈', subject: '수학', band: '5-6학년군', coreIdea: '수는 양을 나타낸다.' }

test('extractStandardCode: bracketed or bare', () => {
  assert.equal(extractStandardCode('[4국01-01] 대화'), '4국01-01')
  assert.equal(extractStandardCode('4국01-01'), '4국01-01')
  assert.equal(extractStandardCode('없음'), '')
})

test('planMapPickApplication: same-subject picks append to the target line, deduped by code', () => {
  const rows = [{ id: 'r1', subject: '국어', coreIdea: '이미 있음', standard: '[4국01-01] 대화의 즐거움을 안다', gradeBand: '3-4학년군' }]
  const plan = planMapPickApplication(rows, [PICK_KOR, PICK_KOR2], 'r1', 'multi', '3-4학년군')
  assert.deepEqual(plan.cellUpdates, [
    { rowId: 'r1', field: 'standard', value: '[4국01-01] 대화의 즐거움을 안다 | [4국01-02] 요약하며 듣는다' },
  ])
  assert.equal(plan.newRows.length, 0)
  assert.equal(plan.appliedCount, 1)
  assert.equal(plan.focusRowId, 'r1')
  assert.equal(plan.notes[0], '성취기준 1개를 반영했습니다 (새 줄 0개)')
})

test('planMapPickApplication: fills an empty core idea (content-system sentence first) and keeps the band, noting mismatches', () => {
  const rows = [{ id: 'r1', subject: '수학', coreIdea: '', standard: '', gradeBand: '3-4학년군' }]
  const plan = planMapPickApplication(rows, [PICK_MATH6], 'r1', 'multi', '3-4학년군')
  assert.deepEqual(plan.cellUpdates, [
    { rowId: 'r1', field: 'standard', value: '[6수01-01] 분수의 나눗셈' },
    { rowId: 'r1', field: 'coreIdea', value: '수는 양을 나타낸다.' },
  ])
  assert.ok(plan.notes.some(note => note.includes('5-6학년군 성취기준') && note.includes('3-4학년군을 유지')))
})

test('planMapPickApplication: cross-subject picks become new rows directly below the target', () => {
  const rows = [{ id: 'r1', subject: '국어', coreIdea: '아이디어', standard: '', gradeBand: '3-4학년군' }, { id: 'r2', subject: '과학', coreIdea: '', standard: '' }]
  const plan = planMapPickApplication(rows, [PICK_KOR, PICK_MATH, PICK_MATH6], 'r1', 'multi', '3-4학년군')
  assert.equal(plan.cellUpdates.find(u => u.field === 'standard')?.value, '[4국01-01] 대화의 즐거움을 안다')
  // 수학은 학년군이 달라 두 줄로 나뉜다.
  assert.deepEqual(plan.newRows, [
    { afterRowId: 'r1', subject: '수학', gradeBand: '3-4학년군', coreIdea: '수는 양을 나타낸다.', standard: '[4수01-01] 큰 수를 안다' },
    { afterRowId: 'r1', subject: '수학', gradeBand: '5-6학년군', coreIdea: '수는 양을 나타낸다.', standard: '[6수01-01] 분수의 나눗셈' },
  ])
  assert.equal(plan.appliedCount, 3)
})

test('planMapPickApplication: an empty target line adopts the first pick subject', () => {
  const rows = [{ id: 'r1', subject: '', coreIdea: '', standard: '' }]
  const plan = planMapPickApplication(rows, [PICK_MATH], 'r1', 'single', '3-4학년군')
  assert.deepEqual(plan.cellUpdates.map(u => u.field), ['subject', 'standard', 'coreIdea'])
  assert.equal(plan.cellUpdates[0].value, '수학')
})

test('planMapPickApplication: no target groups by subject + core idea + band into new rows at the end', () => {
  const plan = planMapPickApplication([], [PICK_KOR, PICK_KOR2, PICK_MATH, PICK_KOR], undefined, 'multi', '3-4학년군')
  assert.deepEqual(plan.newRows, [
    { subject: '국어', gradeBand: '3-4학년군', coreIdea: '화자와 청자는 의미를 나눈다.', standard: '[4국01-01] 대화의 즐거움을 안다 | [4국01-02] 요약하며 듣는다' },
    { subject: '수학', gradeBand: '3-4학년군', coreIdea: '수는 양을 나타낸다.', standard: '[4수01-01] 큰 수를 안다' },
  ])
  assert.equal(plan.appliedCount, 3) // 중복 pick(국어 01-01)은 한 번만
  assert.equal(plan.focusRowId, undefined)
  assert.equal(plan.notes[0], '성취기준 3개를 반영했습니다 (새 줄 2개)')
})

test('planMapPickApplication: nothing usable yields an explanatory note only', () => {
  const plan = planMapPickApplication([], [{ code: '', standard: '', subject: '국어', band: '', coreIdea: '' }], undefined, 'single', '3-4학년군')
  assert.equal(plan.appliedCount, 0)
  assert.deepEqual(plan.notes, ['반영할 성취기준이 없습니다.'])
})

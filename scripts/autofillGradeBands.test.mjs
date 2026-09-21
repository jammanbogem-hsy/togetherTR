// Regression tests for the per-row grade-band helpers used by
// /api/curriculum-sheet/autofill and /api/core-ideas.
// Run: node --experimental-strip-types scripts/autofillGradeBands.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_GRADE_BANDS,
  isElementaryGradeGroup,
  resolveRequestedBands,
  toCanonicalGradeBand,
  sliceContentItemsPerBand,
} from '../src/lib/curriculum/curriculumFilters.ts'
import {
  SHEET_SUBJECTS,
  canonicalSubjectName,
  contentSubjectNamesForSubject,
  coerceGradeBandForSubject,
  gradeBandsForSubject,
  graphSubjectIdsForSubject,
  planSubjectBands,
} from '../src/lib/curriculum/subjectAliases.ts'

// ── band canonicalization ───────────────────────────────────────────────────

test('toCanonicalGradeBand: accepts every shape a row or project may carry', () => {
  assert.equal(toCanonicalGradeBand('초1-2'), '1-2학년군')
  assert.equal(toCanonicalGradeBand('1-2학년군'), '1-2학년군')
  assert.equal(toCanonicalGradeBand('3~4학년군'), '3-4학년군')
  assert.equal(toCanonicalGradeBand('초등학교 5-6학년'), '5-6학년군')
  assert.equal(toCanonicalGradeBand('초5-6'), '5-6학년군')
})

test('toCanonicalGradeBand: rejects non-elementary and unparseable values', () => {
  assert.equal(toCanonicalGradeBand('중1-3'), '')
  assert.equal(toCanonicalGradeBand('고공통'), '')
  assert.equal(toCanonicalGradeBand('전학년'), '')
  assert.equal(toCanonicalGradeBand(''), '')
  assert.equal(toCanonicalGradeBand(null), '')
  assert.equal(toCanonicalGradeBand(undefined), '')
})

test('toCanonicalGradeBand: round-trips every canonical band', () => {
  for (const band of CANONICAL_GRADE_BANDS) {
    assert.equal(toCanonicalGradeBand(band), band)
  }
})

// ── targetGradeGroup accepts a GradeGroup or a canonical band label ─────────

test('isElementaryGradeGroup: accepts both GradeGroup and band-label forms', () => {
  // The sheet's single-band mode sends the band label as targetGradeGroup.
  for (const value of ['초1-2', '초3-4', '초5-6', '1-2학년군', '3-4학년군', '5-6학년군', '초등학교 3-4학년', '3~4']) {
    assert.equal(isElementaryGradeGroup(value), true, value)
  }
})

test('isElementaryGradeGroup: still rejects other school levels and blanks', () => {
  for (const value of ['중1-3', '중학교 1-3학년', '고공통', '고선택', '고등학교', '', null, undefined]) {
    assert.equal(isElementaryGradeGroup(value), false, String(value))
  }
})

// ── requested-band normalization (per-row and single-selection fills) ───────

test('resolveRequestedBands: the confirm dialog selection wins over sheet rows', () => {
  assert.deepEqual(resolveRequestedBands({
    selectedBands: ['5-6학년군'],
    rowBands: ['1-2학년군', '3-4학년군'],
    defaultBand: '3-4학년군',
  }), ['5-6학년군'])
})

test('resolveRequestedBands: falls back to sheet row bands, de-duplicated in order', () => {
  assert.deepEqual(resolveRequestedBands({
    selectedBands: [],
    rowBands: ['초5-6', '1-2학년군', '5-6학년군'],
    defaultBand: '3-4학년군',
  }), ['5-6학년군', '1-2학년군'])
})

test('resolveRequestedBands: unparseable or blank entries become the default band', () => {
  assert.deepEqual(resolveRequestedBands({
    rowBands: ['', '전학년', '중1-3'],
    defaultBand: '3-4학년군',
  }), ['3-4학년군'])
})

test('resolveRequestedBands: nothing requested means nothing forced', () => {
  // Empty result = caller uses its own default, which keeps old single-band
  // clients (no gradeBand anywhere) on the previous behavior.
  assert.deepEqual(resolveRequestedBands({ defaultBand: '3-4학년군' }), [])
  assert.deepEqual(resolveRequestedBands({ selectedBands: [], rowBands: [], defaultBand: '' }), [])
})

test('single-selection fill: one band in, one band out', () => {
  const requested = resolveRequestedBands({ selectedBands: ['5-6학년군'], defaultBand: '3-4학년군' })
  assert.deepEqual(planSubjectBands('국어', requested, '3-4학년군'), {
    gradeBands: ['5-6학년군'],
    coerced: [],
  })
})

test('single-selection fill: 통합교과 asked for 3-4학년군 yields one 1-2학년군 row plus a note', () => {
  const requested = resolveRequestedBands({ selectedBands: ['3-4학년군'], defaultBand: '3-4학년군' })
  assert.deepEqual(planSubjectBands('통합교과', requested, '3-4학년군'), {
    gradeBands: ['1-2학년군'],
    coerced: [{ requested: '3-4학년군', used: '1-2학년군' }],
  })
})

// ── per-band slicing (core-ideas allBands=1) ────────────────────────────────

test('sliceContentItemsPerBand: caps each band separately, keeping order', () => {
  const items = [
    '1-2학년군: a1', '1-2학년군: a2', '1-2학년군: a3',
    '3-4학년군: b1', '3-4학년군: b2',
    '5-6학년군: c1', '5-6학년군: c2', '5-6학년군: c3',
  ]
  assert.deepEqual(sliceContentItemsPerBand(items, 2), [
    '1-2학년군: a1', '1-2학년군: a2',
    '3-4학년군: b1', '3-4학년군: b2',
    '5-6학년군: c1', '5-6학년군: c2',
  ])
})

test('sliceContentItemsPerBand: a global slice would starve later bands', () => {
  // 15 items of 1-2학년군 followed by one 5-6학년군 item: items.slice(0, 15)
  // drops the 5-6 item entirely, which is the bug this helper fixes.
  const items = [
    ...Array.from({ length: 15 }, (_, i) => `1-2학년군: a${i}`),
    '5-6학년군: z',
  ]
  assert.equal(items.slice(0, 15).includes('5-6학년군: z'), false)
  assert.equal(sliceContentItemsPerBand(items, 15).includes('5-6학년군: z'), true)
  assert.equal(sliceContentItemsPerBand(items, 15).length, 16)
})

test('sliceContentItemsPerBand: unprefixed items form one group, kept once', () => {
  const items = ['다항식', '방정식', '부등식', '3-4학년군: 무게']
  assert.deepEqual(sliceContentItemsPerBand(items, 2), ['다항식', '방정식', '3-4학년군: 무게'])
})

test('sliceContentItemsPerBand: empty input and non-positive limit', () => {
  assert.deepEqual(sliceContentItemsPerBand([], 5), [])
  assert.deepEqual(sliceContentItemsPerBand(['1-2학년군: a'], 0), [])
})

// ── subject alias resolution ────────────────────────────────────────────────

test('canonicalSubjectName: 통합교과 resolves from every source spelling', () => {
  assert.equal(canonicalSubjectName('통합교과'), '통합교과')
  // knowledge-graph subjects[].name_ko for sub_int
  assert.equal(canonicalSubjectName('바른 생활·슬기로운 생활·즐거운 생활'), '통합교과')
  // content-system 과목 values
  assert.equal(canonicalSubjectName('바른 생활'), '통합교과')
  assert.equal(canonicalSubjectName('슬기로운 생활'), '통합교과')
  assert.equal(canonicalSubjectName('즐거운 생활'), '통합교과')
  assert.equal(canonicalSubjectName('바슬즐'), '통합교과')
  assert.equal(canonicalSubjectName('sub_int'), '통합교과')
})

test('canonicalSubjectName: existing subjects still resolve from graph names', () => {
  assert.equal(canonicalSubjectName('사회'), '사회')
  assert.equal(canonicalSubjectName('사회과'), '사회')
  assert.equal(canonicalSubjectName('실과'), '실과')
  assert.equal(canonicalSubjectName('실과(기술·가정)/정보'), '실과')
  assert.equal(canonicalSubjectName('국어'), '국어')
  assert.equal(canonicalSubjectName('수학'), '수학')
  assert.equal(canonicalSubjectName('과학'), '과학')
  assert.equal(canonicalSubjectName('도덕'), '도덕')
  assert.equal(canonicalSubjectName('미술'), '미술')
  assert.equal(canonicalSubjectName('음악'), '음악')
  assert.equal(canonicalSubjectName('체육'), '체육')
  assert.equal(canonicalSubjectName('영어'), '영어')
})

test('canonicalSubjectName: 창의적 체험활동 is never matched by accident', () => {
  for (const subject of SHEET_SUBJECTS) {
    assert.notEqual(canonicalSubjectName(subject), '창의적 체험활동')
  }
  for (const value of ['체육', '통합교과', '즐거운 생활', '활동', '체험', '생활']) {
    assert.notEqual(canonicalSubjectName(value), '창의적 체험활동')
  }
  // Only its own names (or a prefix of one, as for every other subject) reach it.
  assert.equal(canonicalSubjectName('창의적 체험활동'), '창의적 체험활동')
  assert.equal(canonicalSubjectName('창체'), '창의적 체험활동')
  assert.equal(canonicalSubjectName('창의'), '창의적 체험활동')
  assert.equal(SHEET_SUBJECTS.includes('창의적 체험활동'), false)
})

test('canonicalSubjectName: junk and near-miss values stay unresolved', () => {
  assert.equal(canonicalSubjectName(''), '')
  assert.equal(canonicalSubjectName(' '), '')
  assert.equal(canonicalSubjectName('생활'), '') // must not become 통합교과
  assert.equal(canonicalSubjectName('한국사'), '')
})

test('canonicalSubjectName: 통합과학 stays 과학, not 통합교과', () => {
  assert.equal(canonicalSubjectName('통합과학1'), '과학')
  assert.equal(canonicalSubjectName('통합사회 1'), '사회')
})

test('graphSubjectIdsForSubject: explicit ids, no name guessing', () => {
  assert.deepEqual(graphSubjectIdsForSubject('통합교과'), ['sub_int'])
  assert.deepEqual(graphSubjectIdsForSubject('바른 생활'), ['sub_int'])
  assert.deepEqual(graphSubjectIdsForSubject('사회'), ['sub_soc'])
  assert.deepEqual(graphSubjectIdsForSubject('실과'), ['sub_prac'])
  assert.deepEqual(graphSubjectIdsForSubject('생활'), [])
  for (const subject of SHEET_SUBJECTS) {
    assert.equal(graphSubjectIdsForSubject(subject).includes('sub_extra'), false)
  }
})

test('contentSubjectNamesForSubject: 통합교과 covers its three component subjects', () => {
  assert.deepEqual(contentSubjectNamesForSubject('통합교과'), [
    '통합교과', '바른 생활', '슬기로운 생활', '즐거운 생활',
  ])
})

// ── band planning per subject ───────────────────────────────────────────────

test('gradeBandsForSubject: only 통합교과 is band-restricted', () => {
  assert.deepEqual(gradeBandsForSubject('통합교과'), ['1-2학년군'])
  assert.equal(gradeBandsForSubject('국어'), null)
  assert.equal(gradeBandsForSubject('사회'), null)
})

test('coerceGradeBandForSubject: 통합교과 is clamped to 1-2학년군', () => {
  assert.deepEqual(coerceGradeBandForSubject('통합교과', '5-6학년군'), { band: '1-2학년군', coerced: true })
  assert.deepEqual(coerceGradeBandForSubject('통합교과', '1-2학년군'), { band: '1-2학년군', coerced: false })
  assert.deepEqual(coerceGradeBandForSubject('국어', '5-6학년군'), { band: '5-6학년군', coerced: false })
})

test('planSubjectBands: falls back to the project band when no row asks for one', () => {
  assert.deepEqual(planSubjectBands('국어', [], '3-4학년군'), {
    gradeBands: ['3-4학년군'],
    coerced: [],
  })
})

test('planSubjectBands: keeps one row per requested band, de-duplicated in order', () => {
  assert.deepEqual(planSubjectBands('국어', ['5-6학년군', '1-2학년군', '5-6학년군'], '3-4학년군'), {
    gradeBands: ['5-6학년군', '1-2학년군'],
    coerced: [],
  })
})

test('planSubjectBands: 통합교과 collapses other bands to 1-2학년군 and reports it', () => {
  assert.deepEqual(planSubjectBands('통합교과', ['3-4학년군', '5-6학년군'], '3-4학년군'), {
    gradeBands: ['1-2학년군'],
    coerced: [
      { requested: '3-4학년군', used: '1-2학년군' },
      { requested: '5-6학년군', used: '1-2학년군' },
    ],
  })
})

test('planSubjectBands: 통합교과 in a 3-4학년군 project falls back to 1-2학년군 and says so', () => {
  // No per-row band was set, so the project band is used as the request and the
  // swap to 1-2학년군 is still reported to the teacher.
  assert.deepEqual(planSubjectBands('통합교과', [], '3-4학년군'), {
    gradeBands: ['1-2학년군'],
    coerced: [{ requested: '3-4학년군', used: '1-2학년군' }],
  })
})

test('planSubjectBands: unknown subjects are not band-restricted', () => {
  assert.deepEqual(planSubjectBands('창의적 체험활동', ['5-6학년군'], '3-4학년군'), {
    gradeBands: ['5-6학년군'],
    coerced: [],
  })
})

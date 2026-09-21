// Regression tests for src/lib/curriculum/teamGradeBands.ts
// Run: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/teamGradeBands.test.mjs
// (The module imports './sheetGradeBands' without an extension, so the loader hooks are required.)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTeamGradeBands,
  isMultiGradeBandTeam,
  formatGradeBandList,
  resolveTeamGradeBands,
  parseTeamGradeBandsSignal,
  subjectsForGradeBand,
  gradeBandsForSubject,
  subjectAvailableInGradeBand,
  subjectsMissingInGradeBand,
  describeGradeBandSubjects,
  dedupeCoreIdeaLines,
  capContextLength,
  toGradeGroupCode,
  GRADE_BAND_SUBJECTS,
} from '../src/lib/curriculum/teamGradeBands.ts'

test('normalizeTeamGradeBands: canonicalizes, de-duplicates and orders', () => {
  assert.deepEqual(normalizeTeamGradeBands(['초5-6', '1~2학년', '5-6학년군']), ['1-2학년군', '5-6학년군'])
  assert.deepEqual(normalizeTeamGradeBands(['초3-4']), ['3-4학년군'])
  assert.deepEqual(normalizeTeamGradeBands([]), [])
  assert.deepEqual(normalizeTeamGradeBands(null), [])
})

test('normalizeTeamGradeBands: drops non-elementary and unparseable values', () => {
  assert.deepEqual(normalizeTeamGradeBands(['중1-3', '고공통', '2-3학년군', '', null, undefined]), [])
  assert.deepEqual(normalizeTeamGradeBands(['중1-3', '초1-2']), ['1-2학년군'])
})

test('isMultiGradeBandTeam: two or more distinct bands', () => {
  assert.equal(isMultiGradeBandTeam(['1-2학년군', '5-6학년군']), true)
  assert.equal(isMultiGradeBandTeam(['초1-2', '1-2학년군']), false)
  assert.equal(isMultiGradeBandTeam(['초3-4']), false)
  assert.equal(isMultiGradeBandTeam(undefined), false)
})

test('formatGradeBandList: dashboard/prompt label', () => {
  assert.equal(formatGradeBandList(['1-2학년군', '5-6학년군']), '1-2·5-6학년군')
  assert.equal(formatGradeBandList(['초5-6', '초1-2', '초3-4']), '1-2·3-4·5-6학년군')
  assert.equal(formatGradeBandList(['초3-4']), '3-4학년군')
  assert.equal(formatGradeBandList([]), '')
})

test('resolveTeamGradeBands: stored bands win, targetGradeGroup is the fallback', () => {
  assert.deepEqual(
    resolveTeamGradeBands({ teamGradeBands: ['초1-2', '초5-6'], targetGradeGroup: '초1-2' }),
    ['1-2학년군', '5-6학년군'],
  )
  assert.deepEqual(resolveTeamGradeBands({ targetGradeGroup: '초3-4' }), ['3-4학년군'])
  assert.deepEqual(resolveTeamGradeBands({ teamGradeBands: [], targetGradeGroup: '초5-6' }), ['5-6학년군'])
  assert.deepEqual(resolveTeamGradeBands({ targetGradeGroup: '중1-3' }), [])
})

test('parseTeamGradeBandsSignal: canonical form', () => {
  const parsed = parseTeamGradeBandsSignal('팀 구성을 확인했습니다.\n[TEAM_GRADE_BANDS: 1-2,5-6]')
  assert.ok(parsed)
  assert.deepEqual(parsed.bands, ['1-2학년군', '5-6학년군'])
  assert.equal(parsed.cleanText, '팀 구성을 확인했습니다.')
})

test('parseTeamGradeBandsSignal: tolerates the spellings a model may emit', () => {
  for (const payload of [
    '초1-2, 초5-6',
    '1~2학년, 5~6학년',
    '1-2학년군 · 5-6학년군',
    '1-2학년군 및 5-6학년군',
    '5-6, 1-2',
  ]) {
    const parsed = parseTeamGradeBandsSignal(`본문\n[TEAM_GRADE_BANDS: ${payload}]`)
    assert.ok(parsed, payload)
    assert.deepEqual(parsed.bands, ['1-2학년군', '5-6학년군'], payload)
  }
})

test('parseTeamGradeBandsSignal: strips the signal even when no band is readable', () => {
  const parsed = parseTeamGradeBandsSignal('본문입니다.\n[TEAM_GRADE_BANDS: 중1-3]')
  assert.ok(parsed)
  assert.deepEqual(parsed.bands, [])
  assert.equal(parsed.cleanText, '본문입니다.')
})

test('parseTeamGradeBandsSignal: no signal → null, and other signals are untouched', () => {
  assert.equal(parseTeamGradeBandsSignal('그냥 대화'), null)
  assert.equal(parseTeamGradeBandsSignal('[TEAM_DISCUSSION_READY: 주제]'), null)
})

test('parseTeamGradeBandsSignal: removes every occurrence', () => {
  const parsed = parseTeamGradeBandsSignal('가\n[TEAM_GRADE_BANDS: 1-2]\n나\n[TEAM_GRADE_BANDS: 3-4]')
  assert.ok(parsed)
  assert.deepEqual(parsed.bands, ['1-2학년군'])
  assert.equal(parsed.cleanText.includes('TEAM_GRADE_BANDS'), false)
  assert.equal(parsed.cleanText, '가\n나')
})

test('toGradeGroupCode: canonical label → project grade-group code', () => {
  // 지식 그래프의 grade_band는 '초1-2' 형태이므로 라벨을 그대로 넘기면 검색이 0건이 된다.
  assert.equal(toGradeGroupCode('1-2학년군'), '초1-2')
  assert.equal(toGradeGroupCode('5-6학년군'), '초5-6')
  assert.equal(toGradeGroupCode('초3-4'), '초3-4')
  assert.equal(toGradeGroupCode('3~4학년'), '초3-4')
  assert.equal(toGradeGroupCode('중1-3'), '')
  assert.equal(toGradeGroupCode(''), '')
})

test('subjectsForGradeBand: 1-2 has 국어·수학·통합교과 only', () => {
  assert.deepEqual([...subjectsForGradeBand('1-2학년군')], ['국어', '수학', '통합교과'])
  assert.equal(subjectsForGradeBand('초1-2').includes('사회'), false)
  assert.equal(subjectsForGradeBand('3-4학년군').includes('사회'), true)
  assert.equal(subjectsForGradeBand('3-4학년군').includes('실과'), false)
  assert.equal(subjectsForGradeBand('5-6학년군').includes('실과'), true)
  assert.deepEqual([...subjectsForGradeBand('중1-3')], [])
})

test('GRADE_BAND_SUBJECTS: 사회·과학·도덕·체육·음악·미술·영어 start at 3-4', () => {
  for (const subject of ['사회', '과학', '도덕', '체육', '음악', '미술', '영어']) {
    assert.equal(GRADE_BAND_SUBJECTS['1-2학년군'].includes(subject), false, subject)
    assert.equal(GRADE_BAND_SUBJECTS['3-4학년군'].includes(subject), true, subject)
    assert.equal(GRADE_BAND_SUBJECTS['5-6학년군'].includes(subject), true, subject)
  }
})

test('gradeBandsForSubject: per-subject availability', () => {
  assert.deepEqual(gradeBandsForSubject('국어'), ['1-2학년군', '3-4학년군', '5-6학년군'])
  assert.deepEqual(gradeBandsForSubject('사회'), ['3-4학년군', '5-6학년군'])
  assert.deepEqual(gradeBandsForSubject('실과'), ['5-6학년군'])
  assert.deepEqual(gradeBandsForSubject('통합교과'), ['1-2학년군'])
  assert.deepEqual(gradeBandsForSubject('즐거운 생활'), ['1-2학년군'])
  assert.deepEqual(gradeBandsForSubject('사회과'), ['3-4학년군', '5-6학년군'])
})

test('gradeBandsForSubject: unknown or band-free subjects keep every band', () => {
  assert.deepEqual(gradeBandsForSubject('창의적 체험활동'), ['1-2학년군', '3-4학년군', '5-6학년군'])
  assert.deepEqual(gradeBandsForSubject('창체'), ['1-2학년군', '3-4학년군', '5-6학년군'])
  assert.deepEqual(gradeBandsForSubject('프로젝트'), ['1-2학년군', '3-4학년군', '5-6학년군'])
  assert.deepEqual(gradeBandsForSubject(''), ['1-2학년군', '3-4학년군', '5-6학년군'])
})

test('subjectAvailableInGradeBand', () => {
  assert.equal(subjectAvailableInGradeBand('과학', '1-2학년군'), false)
  assert.equal(subjectAvailableInGradeBand('과학', '3-4학년군'), true)
  assert.equal(subjectAvailableInGradeBand('실과', '3-4학년군'), false)
  assert.equal(subjectAvailableInGradeBand('통합교과', '5-6학년군'), false)
  // 학년군을 판정할 수 없으면 제약을 걸지 않는다.
  assert.equal(subjectAvailableInGradeBand('실과', '중1-3'), true)
})

test('subjectsMissingInGradeBand: what the team picked but the band lacks', () => {
  assert.deepEqual(subjectsMissingInGradeBand(['국어', '사회', '과학', '실과'], '1-2학년군'), ['사회', '과학', '실과'])
  assert.deepEqual(subjectsMissingInGradeBand(['국어', '사회', '과학'], '5-6학년군'), [])
  assert.deepEqual(subjectsMissingInGradeBand(['국어', '국어'], '1-2학년군'), [])
  assert.deepEqual(subjectsMissingInGradeBand(['실과'], '중1-3'), [])
})

test('describeGradeBandSubjects: one line per team band, with missing subjects flagged', () => {
  const text = describeGradeBandSubjects(['초1-2', '초5-6'], ['국어', '사회'])
  const lines = text.split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^- 1-2학년군: 국어·수학·통합교과 \(통합교과 = 바른 생활·슬기로운 생활·즐거운 생활\)/)
  assert.match(lines[0], / — 이 학년군에 성취기준이 없는 팀 교과: 사회$/)
  assert.match(lines[1], /^- 5-6학년군: /)
  assert.equal(lines[1].includes('성취기준이 없는'), false)
  assert.equal(describeGradeBandSubjects([], ['국어']), '')
})

test('dedupeCoreIdeaLines: keeps the first core idea, marks later repeats', () => {
  const input = [
    '[1-2학년군]',
    '핵심아이디어: 사람들은 서로 다른 방식으로 소통한다.',
    '[5-6학년군]',
    '핵심아이디어: 사람들은 서로 다른 방식으로 소통한다.',
    '핵심아이디어: 사회는 규칙으로 운영된다.',
  ].join('\n')
  const out = dedupeCoreIdeaLines(input).split('\n')
  assert.equal(out[1], '핵심아이디어: 사람들은 서로 다른 방식으로 소통한다.')
  assert.equal(out[3], '핵심아이디어: (앞 학년군과 동일)')
  assert.equal(out[4], '핵심아이디어: 사회는 규칙으로 운영된다.')
})

test('dedupeCoreIdeaLines: leaves placeholders and other lines alone', () => {
  const input = [
    '  ✅ 핵심 아이디어: 자료는 해석을 통해 의미를 갖는다.',
    '  ✅ 핵심 아이디어: 자료는 해석을 통해 의미를 갖는다.',
    '핵심아이디어: (없음)',
    '핵심아이디어: (없음)',
    '지식⋅이해: 무게, 부피',
  ].join('\n')
  const out = dedupeCoreIdeaLines(input).split('\n')
  assert.equal(out[0], '  ✅ 핵심 아이디어: 자료는 해석을 통해 의미를 갖는다.')
  assert.equal(out[1], '  ✅ 핵심 아이디어: (앞 학년군과 동일)')
  assert.equal(out[2], '핵심아이디어: (없음)')
  assert.equal(out[3], '핵심아이디어: (없음)')
  assert.equal(out[4], '지식⋅이해: 무게, 부피')
})

test('capContextLength: truncation is announced, short text untouched', () => {
  assert.equal(capContextLength('짧은 컨텍스트', 100), '짧은 컨텍스트')
  const capped = capContextLength('가'.repeat(50), 10)
  assert.equal(capped.startsWith('가'.repeat(10)), true)
  assert.match(capped, /생략되었습니다/)
  assert.equal(capContextLength('무엇이든', 0), '')
})

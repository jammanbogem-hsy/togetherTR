// Regression tests for src/lib/curriculum/curriculumFilters.ts
// Run: node --experimental-strip-types scripts/curriculumFilters.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gradeBandNeedle,
  filterContentItemsByGrade,
  isUsableCoreIdea,
  curriculumJsonAssetPath,
} from '../src/lib/curriculum/curriculumFilters.ts'

test('gradeBandNeedle: canonicalizes many grade-group shapes to N-M', () => {
  assert.equal(gradeBandNeedle('초5-6'), '5-6')
  assert.equal(gradeBandNeedle('5~6'), '5-6')
  assert.equal(gradeBandNeedle('초등학교 5-6학년'), '5-6') // previously produced bogus needle
  assert.equal(gradeBandNeedle('5-6학년군'), '5-6')
  assert.equal(gradeBandNeedle('초3-4'), '3-4')
  assert.equal(gradeBandNeedle('중1-3'), '1-3')
})

test('gradeBandNeedle: returns empty (=> no filtering) when no band derivable', () => {
  assert.equal(gradeBandNeedle('고공통'), '')
  assert.equal(gradeBandNeedle('전학년'), '')
  assert.equal(gradeBandNeedle(''), '')
  assert.equal(gradeBandNeedle(null), '')
  assert.equal(gradeBandNeedle(undefined), '')
})

test('filterContentItemsByGrade: keeps only the requested band when present', () => {
  const items = ['3-4학년군: 밀기와 당기기', '5-6학년군: 속력']
  assert.deepEqual(filterContentItemsByGrade(items, '초5-6'), ['5-6학년군: 속력'])
  assert.deepEqual(filterContentItemsByGrade(items, '초3-4'), ['3-4학년군: 밀기와 당기기'])
})

test('filterContentItemsByGrade: unparseable grade returns items unchanged (no silent wipe)', () => {
  const items = ['3-4학년군: A', '5-6학년군: B']
  assert.deepEqual(filterContentItemsByGrade(items, '전학년'), items)
  assert.deepEqual(filterContentItemsByGrade(items, ''), items)
})

test('filterContentItemsByGrade: recovers to full prefixed set when band matches nothing', () => {
  // Area only has 3-4 content but project targets 5-6: recover to official data, not empty.
  const items = ['3-4학년군: 밀기와 당기기', '3-4학년군: 무게']
  assert.deepEqual(filterContentItemsByGrade(items, '초5-6'), items)
})

test('filterContentItemsByGrade: unprefixed items pass through unchanged', () => {
  const items = ['다항식', '방정식과 부등식']
  assert.deepEqual(filterContentItemsByGrade(items, '초5-6'), items)
})

test('isUsableCoreIdea: accepts a complete curriculum idea sentence', () => {
  assert.equal(
    isUsableCoreIdea(
      '열은 온도가 높은 곳에서 낮은 곳으로 이동하며, 일상생활에서는 다양한 분야에 이용된다.',
    ),
    true,
  )
})

test('isUsableCoreIdea: rejects PDF-extraction junk and fragments', () => {
  assert.equal(isUsableCoreIdea('[별표 2] 의사소통 기능과 예시문'), false)
  assert.equal(isUsableCoreIdea('친교나 사회적 목적의 담화와 글 (대화, 편지, 이메일 등)'), false)
  assert.equal(isUsableCoreIdea('단어와 문장의 강세, 리듬, 억양, 연음이나 축약'), false)
  assert.equal(isUsableCoreIdea('짧다.'), false)
  assert.equal(isUsableCoreIdea(''), false)
})

test('curriculumJsonAssetPath: encodes to the NFD-normalized on-disk filename', () => {
  // public/curriculum_json/*.json filenames are stored NFD; source literals are NFC.
  const nfcLiteral = '영어 교육과정.json'
  const expected = `/curriculum_json/${encodeURIComponent(nfcLiteral.normalize('NFD'))}`
  assert.equal(curriculumJsonAssetPath(nfcLiteral), expected)
})

test('curriculumJsonAssetPath: NFC and NFD inputs produce the same path (no failing NFC request)', () => {
  const name = '과학교육과정.json'
  assert.equal(
    curriculumJsonAssetPath(name.normalize('NFC')),
    curriculumJsonAssetPath(name.normalize('NFD')),
  )
})

test('curriculumJsonAssetPath: encodes the literal space and prefixes the asset dir', () => {
  const path = curriculumJsonAssetPath('영어 교육과정.json')
  assert.ok(path.startsWith('/curriculum_json/'))
  assert.ok(path.includes('%20')) // space in '영어 교육과정.json'
  assert.ok(!/[가-힣]/.test(path)) // fully percent-encoded, no raw Hangul
})

test('curriculumJsonAssetPath: ascii filename only gains the asset-dir prefix', () => {
  assert.equal(curriculumJsonAssetPath('plain.json'), '/curriculum_json/plain.json')
})

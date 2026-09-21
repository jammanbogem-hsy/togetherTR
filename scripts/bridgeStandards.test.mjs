// Regression tests for the bridge-standard helpers used by
// POST /api/curriculum-sheet/autofill with mode 'bridgeStandards'.
// Run: node --experimental-strip-types scripts/bridgeStandards.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BRIDGE_LEVELS,
  bridgeLevelFor,
  chunkItems,
  clampBridgeLimit,
  dedupeByStandardCode,
  normalizeStandardCode,
  sortBridgeCandidates,
} from '../src/lib/curriculum/bridgeStandards.ts'
import { resolveBridgeSubjects, SHEET_SUBJECTS } from '../src/lib/curriculum/subjectAliases.ts'

// ── score → level ───────────────────────────────────────────────────────────

test('bridgeLevelFor: maps a 0..1 score onto the Jev 0-3 level labels', () => {
  assert.deepEqual([...BRIDGE_LEVELS], ['무관', '약함', '관련', '핵심'])
  assert.equal(bridgeLevelFor(0), '무관')
  assert.equal(bridgeLevelFor(1 / 3), '약함')   // Jev score 1
  assert.equal(bridgeLevelFor(2 / 3), '관련')   // Jev score 2
  assert.equal(bridgeLevelFor(1), '핵심')       // Jev score 3
  assert.equal(bridgeLevelFor(0.8), '관련')     // 2.4 rounds to 2
  assert.equal(bridgeLevelFor(0.9), '핵심')     // 2.7 rounds to 3
  assert.equal(bridgeLevelFor(0.5), '관련')     // 1.5 rounds to 2
})

test('bridgeLevelFor: clamps out-of-range and non-numeric scores', () => {
  assert.equal(bridgeLevelFor(-1), '무관')
  assert.equal(bridgeLevelFor(4), '핵심')
  assert.equal(bridgeLevelFor(Number.NaN), '무관')
})

// ── candidate assembly ──────────────────────────────────────────────────────

test('normalizeStandardCode: strips brackets and whitespace', () => {
  assert.equal(normalizeStandardCode('[2슬01-04]'), '2슬01-04')
  assert.equal(normalizeStandardCode(' 2슬01-04 '), '2슬01-04')
  assert.equal(normalizeStandardCode(''), '')
})

test('dedupeByStandardCode: one entry per standard, first occurrence wins', () => {
  const items = [
    { code: '[2슬01-04]', subject: '통합교과' },
    { code: '2슬01-04', subject: '통합교과' },   // same standard, unbracketed
    { code: '[2국03-03]', subject: '국어' },
  ]
  assert.deepEqual(dedupeByStandardCode(items), [
    { code: '[2슬01-04]', subject: '통합교과' },
    { code: '[2국03-03]', subject: '국어' },
  ])
})

test('dedupeByStandardCode: drops entries with no usable code', () => {
  assert.deepEqual(dedupeByStandardCode([{ code: '' }, { code: '   ' }]), [])
})

test('sortBridgeCandidates: relevance first, then code for stable ties', () => {
  const ranked = sortBridgeCandidates([
    { code: '[2국03-03]', score: 0.67 },
    { code: '[2슬02-01]', score: 1 },
    { code: '[2바02-02]', score: 0.67 },
  ])
  // Ties fall back to code order: 국 sorts before 바.
  assert.deepEqual(ranked.map(item => item.code), ['[2슬02-01]', '[2국03-03]', '[2바02-02]'])
})

test('sortBridgeCandidates: does not mutate its input', () => {
  const input = [{ code: '[2국03-03]', score: 0 }, { code: '[2슬02-01]', score: 1 }]
  sortBridgeCandidates(input)
  assert.equal(input[0].code, '[2국03-03]')
})

test('chunkItems: splits into fan-out batches, last batch short', () => {
  assert.deepEqual(chunkItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunkItems([1, 2], 10), [[1, 2]])
  assert.deepEqual(chunkItems([], 3), [])
  // A nonsensical size must not loop forever or lose items.
  assert.deepEqual(chunkItems([1, 2], 0), [[1], [2]])
})

test('clampBridgeLimit: defaults to 8 and caps at 20', () => {
  assert.equal(clampBridgeLimit(undefined), 8)
  assert.equal(clampBridgeLimit(null), 8)
  assert.equal(clampBridgeLimit(0), 8)
  assert.equal(clampBridgeLimit(-3), 8)
  assert.equal(clampBridgeLimit(5), 5)
  assert.equal(clampBridgeLimit(50), 20)
  assert.equal(clampBridgeLimit(Number.NaN), 8)
})

// ── subject defaulting ──────────────────────────────────────────────────────

test('resolveBridgeSubjects: defaults to every sheet subject', () => {
  assert.deepEqual(resolveBridgeSubjects(), [...SHEET_SUBJECTS])
  assert.deepEqual(resolveBridgeSubjects([]), [...SHEET_SUBJECTS])
  assert.equal(resolveBridgeSubjects().includes('통합교과'), true)
  assert.equal(resolveBridgeSubjects().includes('창의적 체험활동'), false)
})

test('resolveBridgeSubjects: canonicalizes an explicit list and de-duplicates', () => {
  assert.deepEqual(
    resolveBridgeSubjects(['바른 생활', '통합교과', '사회과', '국어']),
    ['통합교과', '사회', '국어'],
  )
})

test('resolveBridgeSubjects: drops unknown names and 창의적 체험활동', () => {
  assert.deepEqual(resolveBridgeSubjects(['국어', '생활', '', null, undefined]), ['국어'])
  assert.deepEqual(resolveBridgeSubjects(['창의적 체험활동']), [])
  assert.deepEqual(resolveBridgeSubjects(['창체', '수학']), ['수학'])
})

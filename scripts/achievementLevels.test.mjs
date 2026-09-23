// Regression tests for 성취수준(A·B·C) lookup and prompt injection.
// Run: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/achievementLevels.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACHIEVEMENT_LEVEL_ACTIVITIES,
  buildAchievementLevelContext,
  collectDesignStandardCodes,
  getAchievementLevels,
  knownStandardCodesIn,
} from '../src/lib/curriculum/achievementLevels.ts'
import { designStandardSources, extractStandardCodes } from '../src/lib/curriculum/standardCodes.ts'

test('getAchievementLevels: accepts codes with or without brackets', () => {
  const withBrackets = getAchievementLevels('[4사03-02]')
  assert.ok(withBrackets)
  assert.equal(getAchievementLevels('4사03-02'), withBrackets)
  assert.equal(withBrackets.band, '3-4학년군')
  assert.match(withBrackets.A, /다양한 자료를 통해/)
  assert.match(withBrackets.C, /나열/)
})

test('level text keeps words joined across PDF line breaks', () => {
  // "나타나는 긍⏎정적" was once extracted as "긍 정적".
  assert.ok(getAchievementLevels('[4사03-02]').A.includes('긍정적 효과'))
})

test('extractStandardCodes: unique codes in first-seen order', () => {
  assert.deepEqual(
    extractStandardCodes('[4사03-02] … [6국01-01] 그리고 다시 [4사03-02]'),
    ['[4사03-02]', '[6국01-01]'],
  )
  assert.deepEqual(extractStandardCodes('코드 없음'), [])
})

test('knownStandardCodesIn: drops codes without achievement levels (e.g. 중학교)', () => {
  assert.deepEqual(knownStandardCodesIn(['[4사03-02]', '[9국01-01]']), ['[4사03-02]'])
})

test('designStandardSources / collectDesignStandardCodes: A-2-1 artifact first, then sheet', () => {
  const artifacts = { 'A-2-1': { content: { 성취기준분석표: '| 사회 | … | [4사03-02] 우리 사회에 … |' } } }
  const sheet = [{ standard: '[4국01-01] 중요한 내용과 주제를 파악하며 듣고…' }, { standard: '' }]
  assert.equal(designStandardSources(artifacts, sheet).length, 2)
  assert.deepEqual(collectDesignStandardCodes(artifacts, sheet), ['[4사03-02]', '[4국01-01]'])
  assert.deepEqual(collectDesignStandardCodes(undefined, undefined), [])
})

test('buildAchievementLevelContext: verbatim A·B·C for target activities only', () => {
  const entry = getAchievementLevels('[4사03-02]')
  const block = buildAchievementLevelContext('Ds-1-1', ['[4사03-02]'])
  assert.ok(block.includes(`- A: ${entry.A}`))
  assert.ok(block.includes(`- B: ${entry.B}`))
  assert.ok(block.includes(`- C: ${entry.C}`))
  assert.match(block, /상↔A, 중↔B, 하↔C/)
  assert.equal(buildAchievementLevelContext('T-1-1', ['[4사03-02]']), '')
  assert.equal(buildAchievementLevelContext('Ds-1-1', []), '')
  assert.deepEqual([...ACHIEVEMENT_LEVEL_ACTIVITIES], ['A-2-2', 'Ds-1-1', 'Ds-1-3', 'Ds-2-2'])
})

test('buildAchievementLevelContext: marks inferred levels and caps the list', () => {
  assert.match(buildAchievementLevelContext('Ds-2-2', ['[4사08-01]']), /서술 순서로 배정/)
  const many = knownStandardCodesIn(['[4국01-01][4국01-02][4국01-03][4국01-04][4국01-05][4국01-06][4국02-01][4국02-02][4국02-03][4국02-04][4국02-05][4국03-01][4국03-02]'])
  assert.equal(many.length, 13)
  const block = buildAchievementLevelContext('Ds-1-3', many)
  assert.equal((block.match(/^### /gm) ?? []).length, 12)
  assert.match(block, /성취기준 1개는 길이 제한으로 생략/)
})

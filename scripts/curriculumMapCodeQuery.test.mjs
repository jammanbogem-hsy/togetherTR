// Code queries in the curriculum-map search must match with or without brackets (2026-10-09 teacher feedback).
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/curriculumMapCodeQuery.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { findStandardsByCode, parseCodeQuery } from '../src/lib/curriculum/curriculumMap.ts'

test('parseCodeQuery normalizes bare, bracketed and spaced codes', () => {
  assert.deepEqual(parseCodeQuery('6사12-02'), { codes: ['[6사12-02]'], rest: '' })
  assert.deepEqual(parseCodeQuery('[6사12-02]'), { codes: ['[6사12-02]'], rest: '' })
  assert.deepEqual(parseCodeQuery(' 6사 12-02 '), { codes: ['[6사12-02]'], rest: '' })
  assert.deepEqual(parseCodeQuery('6사12-02, [6과12-01]'), { codes: ['[6사12-02]', '[6과12-01]'], rest: '' })
  assert.deepEqual(parseCodeQuery('6사12-02 인구 문제'), { codes: ['[6사12-02]'], rest: '인구 문제' })
  assert.deepEqual(parseCodeQuery('인구 문제'), { codes: [], rest: '인구 문제' })
})

test('findStandardsByCode ignores brackets and keeps query order', () => {
  const standards = [{ id: 'a', code: '[6과12-01]' }, { id: 'b', code: '[6사12-02]' }, { id: 'c', code: '6국01-01' }]
  assert.deepEqual(findStandardsByCode(standards, ['[6사12-02]', '[6과12-01]']).map(s => s.id), ['b', 'a'])
  assert.deepEqual(findStandardsByCode(standards, ['[6국01-01]']).map(s => s.id), ['c'])
  assert.deepEqual(findStandardsByCode(standards, ['[6수01-01]']), [])
})

test('search route puts exact code matches first', () => {
  const route = fs.readFileSync('src/app/api/curriculum-map/search/route.ts', 'utf8')
  assert.match(route, /parseCodeQuery\(query\)/)
  assert.match(route, /findStandardsByCode\(graph\.achievementStandards/)
})

// Real request → curriculum DB → response, with only external model calls replaced.
// node --experimental-strip-types --experimental-test-module-mocks --import ./scripts/lib/register-ts-hooks.mjs --test scripts/collaborativeAutofillRoute.test.mjs
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context)
} })
mock.module('openai', { defaultExport: class FakeOpenAI {
  embeddings = { create: async ({ input }) => ({ data: input.map((_, i) => ({ embedding: [1, (i % 3) / 10] })) }) }
} })
process.env.JEV_JUDGE = 'off'
const { POST } = await import('../src/app/api/curriculum-sheet/autofill/route.ts')
const bands = ['1-2학년군', '3-4학년군', '5-6학년군']
async function post(body) {
  const response = await POST(new Request('http://localhost/api/curriculum-sheet/autofill', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}
test('empty 1/3/5-grade team sheet proposes and builds all three bands using real curriculum records', async () => {
  const common = { targetGradeGroup: '초5-6', teamGradeBands: bands, existingRows: [], a12Artifact: { selectedTopic: '우리 마을의 생활', targetSubjects: ['국어', '사회'] } }
  const review = await post({ ...common, mode: 'coreIdeas' })
  assert.deepEqual(review.proposals.find(p => p.subject === '국어').gradeBands, bands)
  assert.deepEqual(review.proposals.find(p => p.subject === '사회').gradeBands, bands.slice(1))
  assert.deepEqual(review.proposals.find(p => p.subject === '통합교과').gradeBands, bands.slice(0, 1))
  const allKoreanOptions = new Set(review.proposals.find(p => p.subject === '국어').options.flatMap(p => p.gradeBands))
  bands.forEach(band => assert.ok(allKoreanOptions.has(band), band))
  const generated = await post({ ...common, mode: 'rows', selectedCoreIdeas: review.proposals.map(p => ({ subject: p.subject, coreIdea: p.selectedCoreIdea, gradeBands: p.gradeBands })) })
  assert.deepEqual([...new Set(generated.rows.map(r => r.gradeBand))].sort(), bands)
  for (const band of bands) assert.equal(generated.rows.filter(r => r.gradeBand === band && r.isCenter).length, 1)
  for (const row of generated.rows) {
    const expected = row.gradeBand[2]
    for (const code of row.standard.matchAll(/\[(\d)[^\]]+\]/g)) assert.equal(code[1], expected, row.standard)
  }
})
test('the actual rows route preserves different center subjects for low and high grades', async () => {
  const existingRows = [
    { subject: '통합교과', gradeBand: bands[0], isCenter: true },
    { subject: '사회', gradeBand: bands[2], isCenter: true },
  ]
  const result = await post({ mode: 'rows', targetGradeGroup: '초5-6', teamGradeBands: [bands[0], bands[2]], existingRows,
    a12Artifact: { selectedTopic: '함께 사는 마을', targetSubjects: ['통합교과', '사회'] } })
  assert.deepEqual(result.rows.filter(r => r.isCenter).map(r => [r.gradeBand, r.subject]).sort(), [[bands[0], '통합교과'], [bands[2], '사회']])
})

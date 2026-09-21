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
const { GET: getCoreIdeas } = await import('../src/app/api/core-ideas/route.ts')
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

test('art in grades 1–2 finds official integrated-subject alternatives with usable core ideas', async () => {
  const result = await post({ mode: 'bridgeStandards', sourceSubject: '미술',
    sourceCoreIdea: '다양한 발상은 아이디어와 주제를 발전시키고 표현의 토대가 된다.',
    targetBand: '1-2학년군', topic: '우리 마을을 다양한 재료로 표현하기', limit: 8 })
  assert.ok(result.candidates.some(c=>c.subject==='통합교과'))
  assert.equal(result.candidates.length,8)
  for (const candidate of result.candidates) {
    assert.ok(['통합교과','국어','수학'].includes(candidate.subject), candidate.subject)
    assert.match(candidate.standard, /^\[2/)
    assert.ok(candidate.contentCoreIdea || candidate.coreIdea, candidate.standard)
  }
  assert.ok(result.notes.some(note=>note.includes('통합교과')))
})

test('sheet content API keeps integrated courses separate so 2슬 standards cannot receive 2바 content', async () => {
  const response = await getCoreIdeas(new Request('http://localhost/api/core-ideas?gradeGroup=초5-6&allBands=1'))
  assert.equal(response.status,200)
  const {items}=await response.json()
  const integrated=items.filter(i=>i.subject==='통합교과')
  assert.equal(integrated.length,12)
  assert.deepEqual([...new Set(integrated.map(i=>i.course))].sort(),['바른 생활','슬기로운 생활','즐거운 생활'].sort())
  const target=integrated.find(i=>i.course==='슬기로운 생활'&&i.coreIdeas.includes('우리는 경험하고 상상하고 만들며 생활한다.'))
  assert.ok(target.knowledge.includes('1-2학년군: 다양한 매체와 재료'))
  assert.ok(target.functions.includes('1-2학년군: 상상하여 구현하기'))
  assert.ok(target.attitudes.includes('1-2학년군: 창의성'))
  assert.ok(!target.knowledge.some(value=>value.includes('학습 습관')))
  assert.ok(items.some(i=>i.subject==='미술'&&i.knowledge.some(k=>k.startsWith('5-6학년군:'))))
})

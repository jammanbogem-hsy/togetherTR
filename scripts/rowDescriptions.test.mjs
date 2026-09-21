import test from 'node:test'
import assert from 'node:assert/strict'
import { requestRowDescription, canFillRowDescription } from '../src/lib/curriculum/rowDescriptions.ts'

const row = { id: 'bridge-low', subject: '통합교과', gradeBand: '1-2학년군', coreIdea: '함께 사는 마을',
  standard: '[2슬01-01] 학교 안팎의 모습을 살펴본다.', knowledge: '마을의 모습', processFunction: '살펴보기', valueAttitude: '관심 갖기', description: '' }
test('describes the selected low-grade row with its actual standard and lesson context', async () => {
  const result = await requestRowDescription(row, { targetGradeGroup: '초5-6', a12Artifact: { selectedTopic: '우리 마을' }, chatContext: '여러 학년이 함께 설계' }, async (url, options) => {
    assert.equal(url, '/api/curriculum-sheet/autofill')
    const body = JSON.parse(options.body)
    assert.equal(body.mode, 'describe')
    assert.deepEqual(body.rows, [row])
    assert.equal(body.a12Artifact.selectedTopic, '우리 마을')
    return Response.json({ descriptions: { [row.id]: '마을의 모습을 살펴보고 발견한 것을 친구들과 나눈다.' } })
  })
  assert.match(result, /마을의 모습/)
})
test('does not request or overwrite a teacher-written description, or describe an empty standard', async () => {
  const never = async () => { assert.fail('should not call the model') }
  assert.equal(await requestRowDescription({ ...row, description: '교사 작성' }, {}, never), null)
  assert.equal(await requestRowDescription({ ...row, standard: '' }, {}, never), null)
  assert.equal(canFillRowDescription({ ...row, description: '다른 팀원 작성' }, row), false)
})
test('reports failed/empty responses instead of showing successful automatic input', async () => {
  await assert.rejects(requestRowDescription(row, {}, async () => Response.json({ error: '작성 실패' }, { status: 503 })), /작성 실패/)
  await assert.rejects(requestRowDescription(row, {}, async () => Response.json({ descriptions: { 다른행: '설명' } })), /설명을 작성하지 못했습니다/)
})
test('late descriptions are rejected after curriculum inputs or target row change', () => {
  assert.equal(canFillRowDescription(row, row), true)
  for (const field of ['id', 'subject', 'gradeBand', 'coreIdea', 'standard', 'knowledge', 'processFunction', 'valueAttitude']) {
    assert.equal(canFillRowDescription({ ...row, [field]: '변경됨' }, row), false, field)
  }
})
test('display-only grade prefixes do not block a legacy row description; a different band still does', () => {
  assert.equal(canFillRowDescription(row, { ...row, knowledge: '1-2학년군: 마을의 모습' }), true)
  assert.equal(canFillRowDescription(row, { ...row, knowledge: '5-6학년군: 마을의 모습' }), false)
})

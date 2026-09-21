// Real project mutation functions against an in-memory Firestore transaction adapter (no network).
// node --experimental-strip-types --experimental-test-module-mocks --import ./scripts/lib/register-ts-hooks.mjs --test scripts/collaborativeGradePersistence.test.mjs
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import * as firestore from 'firebase/firestore'

let state
const auth = { currentUser: { uid: 'host' } }
const deleted = Symbol('delete')
function apply(fields) {
  for (const [path, value] of Object.entries(fields)) {
    const keys = path.split('.')
    let parent = state
    for (const key of keys.slice(0, -1)) parent = parent[key] ??= {}
    const key = keys.at(-1)
    if (value === deleted) delete parent[key]
    else parent[key] = structuredClone(value)
  }
}
mock.module('../src/lib/firebase/config.ts', { namedExports: { auth, db: {}, storage: {} }, defaultExport: {} })
mock.module('firebase/firestore', { namedExports: {
  ...firestore, doc: (_db, ...segments) => segments.join('/'), serverTimestamp: () => 'server-time', deleteField: () => deleted,
  updateDoc: async (_ref, fields) => apply(fields),
  runTransaction: async (_db, callback) => callback({
    get: async () => ({ exists: () => true, data: () => structuredClone(state) }),
    update: (_ref, fields) => apply(fields),
  }),
} })
const { updateTeamGradeBands, proposeTeamGradeBands, resolveTeamGradeBandProposal, patchCurriculumSheet } = await import('../src/lib/firebase/projects.ts')
function reset() {
  auth.currentUser = { uid: 'host' }
  state = { hostUid: 'host', createdBy: 'host', memberUids: ['host', 'member'], targetGradeGroup: '초5-6', curriculumSheetGradeMode: 'single', curriculumSheet: [] }
}
test('member recognition persists only a proposal; host confirmation commits bands and switch together', async () => {
  reset()
  auth.currentUser.uid = 'member'
  await assert.rejects(updateTeamGradeBands('p', ['1-2학년군', '5-6학년군']), /방장/)
  await proposeTeamGradeBands('p', ['1-2학년군'], '저학년 교사')
  assert.equal(state.teamGradeBands, undefined)
  assert.equal(state.curriculumSheetGradeMode, 'single')
  const proposal = state.teamGradeBandProposals.member
  await assert.rejects(resolveTeamGradeBandProposal('p', 'member', proposal.id, true), /방장/)
  auth.currentUser.uid = 'host'
  await resolveTeamGradeBandProposal('p', 'member', proposal.id, true)
  assert.deepEqual(state.teamGradeBands, ['1-2학년군', '5-6학년군'])
  assert.equal(state.curriculumSheetGradeMode, 'multi')
  assert.equal(state.teamGradeBandProposals.member, undefined)
})
test('stale approval does not consume a newer proposal, and rejection does not change the team', async () => {
  reset()
  auth.currentUser.uid = 'member'
  await proposeTeamGradeBands('p', ['1-2학년군'], '교사')
  const oldId = state.teamGradeBandProposals.member.id
  await proposeTeamGradeBands('p', ['3-4학년군'], '교사')
  const newId = state.teamGradeBandProposals.member.id
  auth.currentUser.uid = 'host'
  await assert.rejects(resolveTeamGradeBandProposal('p', 'member', oldId, true), /변경/)
  assert.equal(state.teamGradeBandProposals.member.id, newId)
  await resolveTeamGradeBandProposal('p', 'member', newId, false)
  assert.equal(state.teamGradeBands, undefined)
})
test('mode repair uses latest team composition and keeps existing teacher-written rows', async () => {
  reset()
  state.teamGradeBands = ['1-2학년군', '3-4학년군', '5-6학년군']
  state.curriculumSheet = [{ id: 'old', subject: '국어', standard: '[6국01-01]', description: '교사 설명' }]
  await updateTeamGradeBands('p', ['1-2학년군', '5-6학년군'], { repairModeOnly: true })
  assert.equal(state.teamGradeBands.length, 3)
  assert.equal(state.curriculumSheetGradeMode, 'multi')
  assert.equal(state.curriculumSheet[0].gradeBand, '5-6학년군')
  assert.equal(state.curriculumSheet[0].description, '교사 설명')
})
test('autofill transaction preserves unsynced peer edits and description-only/bridge rows', async () => {
  reset()
  state.curriculumSheet = [
    { id: 'peer', subject: '국어', gradeBand: '5-6학년군', coreIdea: '말하기', standard: '[6국01-01]', description: '다른 팀원의 최신 편집', knowledge: '원문' },
    { id: 'draft', subject: '', description: '설명부터 작성' },
    { id: 'bridge', subject: '', gradeBand: '1-2학년군', linkedCoreIdea: { subject: '사회', coreIdea: '우리 마을' } },
  ]
  await patchCurriculumSheet('p', { type: 'merge-autofill', rows: [
    { id: 'generated', subject: '국어', gradeBand: '5-6학년군', coreIdea: '말하기', standard: '[6국01-02]', description: 'AI 덮어쓰기' },
    { id: 'low', subject: '통합교과', gradeBand: '1-2학년군', coreIdea: '마을', standard: '[2슬01-01]', description: '' },
  ] })
  assert.equal(state.curriculumSheet.length, 4)
  assert.equal(state.curriculumSheet.find(r => r.id === 'peer').description, '다른 팀원의 최신 편집')
  state.curriculumSheet.find(r => r.id === 'low').standard = '[2슬01-02]'
  await patchCurriculumSheet('p', { type: 'fill-descriptions', rows: [
    { id: 'peer', coreIdea: '말하기', standard: '[6국01-01]', description: '늦게 도착한 설명' },
    { id: 'low', coreIdea: '마을', standard: '[2슬01-01]', description: '변경 전 기준의 설명' },
  ] })
  assert.equal(state.curriculumSheet.find(r => r.id === 'peer').description, '다른 팀원의 최신 편집')
  assert.equal(state.curriculumSheet.find(r => r.id === 'low').description, '')
})

test('row descriptions persist only while the selected curriculum inputs remain unchanged', async () => {
  reset()
  const source = { id: 'low', subject: '통합교과', gradeBand: '1-2학년군', coreIdea: '마을', standard: '[2슬01-01]', knowledge: '마을 모습', description: '' }
  state.curriculumSheet = [source]
  await patchCurriculumSheet('p', { type: 'fill-descriptions', rows: [{ ...source, description: '함께 마을을 살펴본다.' }] })
  assert.equal(state.curriculumSheet[0].description, '함께 마을을 살펴본다.')
  for (const field of ['subject', 'gradeBand', 'knowledge']) {
    state.curriculumSheet = [{ ...source, [field]: '동료 수정' }]
    await patchCurriculumSheet('p', { type: 'fill-descriptions', rows: [{ ...source, description: '이전 내용으로 작성한 설명' }] })
    assert.equal(state.curriculumSheet[0].description, '', field)
  }
  state.curriculumSheet = []
  await patchCurriculumSheet('p', { type: 'fill-descriptions', rows: [{ ...source, description: '삭제된 행 설명' }] })
  assert.deepEqual(state.curriculumSheet, [])
})

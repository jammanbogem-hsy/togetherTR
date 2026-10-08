import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { isTrainingActivity } from '../src/lib/training/trainingMode.ts'

const source = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let fn
function walk(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'ensureCurrentArtifactSavedAndConfirmed') fn = node.getText(tree); ts.forEachChild(node, walk) }
walk(tree)
function fixture(training = true, status = 'in_review', content = { '수업 성찰': '자료를 근거로 이야기했다.' }) {
  const writes = [], errors = []
  const context = {
    proj: { id: 'room', trainingMode: { enabled: training, coreFormal: false }, artifacts: { 'E-1-1': { title: '성찰', status, version: 1, content } } },
    currentActivity: 'E-1-1', currentArtifact: null, pendingArtifactSave: null,
    ACTIVITY_META: { 'E-1-1': { label: '성찰', requiredSections: [{ key: '정식 필수 항목' }] } },
    userProfile: { uid: 'host' }, isTrainingActivity,
    validateRequiredSections: () => true, displayActivityCode: code => code,
    setProjectArtifact: async (...args) => writes.push(args), setChatError: text => errors.push(text),
  }
  vm.runInNewContext(ts.transpileModule(fn + '\nthis.run=ensureCurrentArtifactSavedAndConfirmed', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { context, writes, errors }
}
test('saved training records advance without a confirmation write or formal-section check', async () => {
  for (const status of ['in_review', 'confirmed']) {
    const f = fixture(true, status)
    f.context.validateRequiredSections = () => { throw new Error('Formal gate must not run for training') }
    assert.equal(await f.context.run(), true)
    assert.equal(f.writes.length, 0)
  }
})
test('normal mode still confirms an in-review record and does not rewrite an already confirmed one', async () => {
  const f = fixture(false)
  assert.equal(await f.context.run(), true)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][2].status, 'confirmed')
  const confirmed = fixture(false, 'confirmed')
  assert.equal(await confirmed.context.run(), true)
  assert.equal(confirmed.writes.length, 0)
})
test('empty saved artifact is not reported as ready by the saved-record action', async () => {
  const f = fixture(true, 'in_review', {})
  assert.equal(await f.context.run(), false)
  assert.equal(f.writes.length, 0)
  assert.match(f.errors[0], /저장할 산출물이 없습니다/)
})

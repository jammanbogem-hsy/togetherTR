import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { isEffectivelyDone } from '../src/lib/activity/completion.ts'
import { TRAINING_ACTIVITIES } from '../src/lib/training/trainingMode.ts'
import { ACTIVITY_META, STAGES, SOLO_HIDDEN_ACTIVITIES } from '../src/types/index.ts'
const training = { trainingMode: { enabled: true, coreFormal: false } }
const art = content => ({ title: '저장한 결과', content, status: 'in_review', version: 1 })

test('saved training prose is complete for every activity without an AI advance/status update', () => {
  for (const [code, definition] of Object.entries(TRAINING_ACTIVITIES)) {
    const content = Object.fromEntries(definition.fields.filter(f => f.tier === 'A').map(f => [f.key, '교사가 글로 정리한 결과입니다.']))
    const artifacts = { [code]: art(content) }
    assert.equal(isEffectivelyDone(code, { [code]: 'in_progress' }, artifacts, training), true, code)
    for (const key of Object.keys(content)) delete content[key]
    assert.equal(isEffectivelyDone(code, { [code]: 'completed' }, artifacts, training), false, code + ' empty record')
  }
})
test('text, table and structured roles use the same completed-state rule; draft-only and rejected are incomplete', () => {
  for (const content of [{ '역할 배분': '김교사: 자료 조사, 금요일까지' }, { '역할 배분': '| 담당자 | 할 일 |\n|---|---|\n| 김교사 | 조사 |' }, { roles: [{ teacherName: '김교사', role: '자료 조사' }] }]) {
    assert.equal(isEffectivelyDone('T-2-1', {}, { 'T-2-1': art(content) }, training), true)
  }
  for (const content of [{}, { '역할 배분': '  ' }, { manualWorkspace: { rows: [{ content: '초안' }] } }]) {
    assert.equal(isEffectivelyDone('T-2-1', { 'T-2-1': 'completed' }, { 'T-2-1': art(content) }, training), false)
  }
  assert.equal(isEffectivelyDone('T-2-1', {}, { 'T-2-1': { ...art({ '역할 배분': '정리' }), status: 'rejected' } }, training), false)
})
test('normal mode and formal core activities retain original completion requirements', () => {
  const artifact = { 'T-1-2': art({ '설계 방향': '관찰에 근거해 설명하기' }) }
  for (const project of [undefined, { trainingMode: { enabled: false } }, { trainingMode: { enabled: true, coreFormal: true } }]) {
    assert.equal(isEffectivelyDone('T-1-2', { 'T-1-2': 'in_progress' }, artifact, project), false)
    assert.equal(isEffectivelyDone('T-1-2', { 'T-1-2': 'completed' }, artifact, project), true)
  }
})
test('actual stage transition warning recognizes saved prose and still reports missing required results', () => {
  const source = fs.readFileSync(new URL('../src/components/modals/StageMoveModal.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('StageMoveModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'getIncompleteActivities')
  const context = vm.createContext({ isEffectivelyDone, STAGES, SOLO_HIDDEN_ACTIVITIES, ACTIVITY_META })
  vm.runInContext(ts.transpileModule(fn.getText(tree) + '\nthis.run=getIncompleteActivities', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const artifacts = Object.fromEntries(STAGES.find(s => s.code === 'T').activities.map(code => [code, art(Object.fromEntries(TRAINING_ACTIVITIES[code].fields.filter(f => f.tier === 'A').map(f => [f.key, '글로 저장한 결과']))) ]))
  assert.equal(context.run('T', {}, artifacts, false, training).length, 0)
  delete artifacts['T-2-3']
  assert.deepEqual(Array.from(context.run('T', {}, artifacts, false, training)), [ACTIVITY_META['T-2-3'].label])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as model from '../src/lib/chat/checklist.ts'
import { appendReviewDraft, isReviewAction } from '../src/lib/chat/reviewAction.ts'

const source = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function load(name, bindings) {
  let fn
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node; ts.forEachChild(node, visit) }
  visit(tree); assert.ok(fn)
  const code = ts.transpileModule(fn.getText(tree) + `\nthis.result=${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const context = vm.createContext({ ...model, ...bindings }); vm.runInContext(code, context); return context.result
}
function fixture() {
  const writes = [], errors = []
  const store = { project: { id: 'p' }, messages: [{ id: 'msg', content: '- [ ] 확인', checklistState: { 0: { checked: true, by: '옛 이름', b: { checked: true, name: 'B' } } } }] }
  const toggle = load('toggleChecklistItem', {
    userProfile: { uid: 'a', displayName: 'A' }, proj: store.project, useProjectStore: { getState: () => store },
    checklistWritesRef: { current: new Map() },
    replaceMessage(id, content, patch) { const index = store.messages.findIndex(m => m.id === id); store.messages[index] = { ...store.messages[index], content, ...patch } },
    updateMessageChecklist: (...args) => new Promise((resolve, reject) => writes.push({ args, resolve, reject })),
    setChatError: message => errors.push(message), console: { error() {} },
  })
  return { store, toggle, writes, errors, item: () => store.messages[0].checklistState[0] }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('optimistic toggle reads latest message and preserves another user and legacy data', async () => {
  const f = fixture(), stale = f.store.messages[0]
  f.store.messages[0] = { ...stale, checklistState: model.applyChecklistToggle(stale.checklistState, 0, 'c', true, 'C') }
  f.toggle(stale, 0, true)
  assert.equal(f.item().a.checked, true); assert.equal(f.item().b.checked, true); assert.equal(f.item().c.checked, true)
  assert.equal(f.item().by, '옛 이름'); assert.equal(f.writes[0].args[3], 'a')
  f.writes[0].resolve(); await tick()
})
test('failed save rolls back only its own edit while retaining later remote checks', async () => {
  const f = fixture(); f.toggle(f.store.messages[0], 0, true)
  f.store.messages[0].checklistState = model.applyChecklistToggle(f.store.messages[0].checklistState, 0, 'c', true, 'C')
  f.writes[0].reject(new Error('denied')); await tick()
  assert.equal(f.item().a, undefined); assert.equal(f.item().b.checked, true); assert.equal(f.item().c.checked, true)
  assert.equal(f.item().checked, true); assert.equal(f.errors.length, 1)
})
test('older rejected save cannot revert a newer click', async () => {
  const f = fixture(); f.toggle(f.store.messages[0], 0, true); f.toggle(f.store.messages[0], 0, false)
  f.writes[0].reject(new Error('old')); await tick(); assert.equal(f.item().a.checked, false)
  f.writes[1].resolve(); await tick(); assert.equal(f.item().b.checked, true)
})
test('review extra-input handler never sends, selects the card, or changes a saved artifact', async () => {
  let draft = '작성 중', focused = false
  const forbidden = () => assert.fail('extra-input must only edit composer')
  const run = load('handleActionCardClick', {
    project: { id: 'p' }, isReviewAction, appendReviewDraft, setInput: fn => { draft = fn(draft) }, setSlashQuery() {},
    requestAnimationFrame: fn => fn(), document: { querySelector: () => ({ value: draft, focus() { focused = true }, setSelectionRange() {} }) },
    updateMessageActionCardState: forbidden, sendMessageDirectly: forbidden, recordActionCardSkip: forbidden,
  })
  await run({ activityCode: 'T-2-1', content: '역할을 검토해 주세요.', actionCard: { primary: '검토 완료', secondary: '추가 내용 입력' } }, 'secondary', '추가 내용 입력')
  assert.match(draft, /^작성 중\n\n검토 후 추가 의견/); assert.match(draft, /누가·무엇을·언제까지/); assert.equal(focused, true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as model from '../src/lib/coedit/workspace-crdt.ts'
import * as cursor from '../src/lib/coedit/workspaceCursor.ts'
import { seedWorkspace, applyWorkspaceDiff, workspaceToJSON } from '../src/lib/coedit/workspace-crdt.ts'
import {
  workspaceTextForField, workspaceFieldValue, encodeWorkspaceCaret, resolveWorkspaceCaret,
  resolveWorkspaceCaretLocation, resolveWorkspacePresenceCaret, captureWorkspaceSelection,
  resolveWorkspaceSelection, createSelectionRestoreGuard,
} from '../src/lib/coedit/workspaceCursor.ts'

const initial = () => ({
  note: '기후위기 수업', keywords: ['폭염', '그늘'],
  columns: [{ id: 'c', label: '담당 업무' }], rows: [{ id: 'r', cells: { c: '함께 지도 만들기' } }],
  blocks: [
    { id: 'body', type: 'paragraph', content: '우리 동네의 그늘' },
    { id: 'checks', type: 'checklist', content: '- [ ] 지도 읽기\n- [x] 인터뷰 질문' },
    { id: 'table', type: 'table', content: '', table: {
      columns: [{ id: 'tc', label: '자료 출처' }], rows: [{ id: 'tr', cells: { tc: '우리 동네 지도' } }],
    } },
  ],
})
function docs(t, count = 3) {
  const first = new Y.Doc(); seedWorkspace(first, initial())
  const all = [first, ...Array.from({ length: count - 1 }, () => {
    const next = new Y.Doc(); Y.applyUpdate(next, Y.encodeStateAsUpdate(first)); return next
  })]
  t.after(() => all.forEach(doc => doc.destroy()))
  return all
}
const sync = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from))

test('R4 cursor: 표·메타·열·블록·보조 표의 상대 선택은 원격 앞 삽입 후 같은 문자를 가리킨다', t => {
  const [a, b] = docs(t, 2)
  for (const key of ['r:c', 'meta:note', 'column:c', 'block:body', 'block-table:table:tr:tc', 'block-table-column:table:tc']) {
    const text = workspaceTextForField(b, key), old = text.toString()
    const selected = captureWorkspaceSelection(b, key, 2, 4, 'backward')
    workspaceTextForField(a, key).insert(0, '새 '); sync(a, b)
    const location = resolveWorkspaceSelection(b, selected)
    assert.deepEqual({ start: location.start, end: location.end, direction: location.direction }, { start: 4, end: 6, direction: 'backward' }, key)
    assert.equal(text.toString().slice(location.start, location.end), old.slice(2, 4), key)
  }
})

test('R4 cursor: 다른 칸의 A 입력은 대기 중인 B·C 커서를 움직이지 않고 같은 칸 앞 삽입은 각각 문자 anchor를 따른다', t => {
  const [a, b, c] = docs(t)
  const bAnchor = encodeWorkspaceCaret(b, 'r:c', 3), cAnchor = encodeWorkspaceCaret(c, 'r:c', 6)
  workspaceTextForField(a, 'meta:note').insert(0, 'A의 생각 '); sync(a, b); sync(a, c)
  assert.equal(resolveWorkspaceCaret(b, 'r:c', bAnchor), 3)
  assert.equal(resolveWorkspaceCaret(c, 'r:c', cAnchor), 6)
  workspaceTextForField(a, 'r:c').insert(0, 'A '); sync(a, b); sync(a, c)
  assert.equal(resolveWorkspaceCaret(b, 'r:c', bAnchor), 5)
  assert.equal(resolveWorkspaceCaret(c, 'r:c', cAnchor), 8)
})

test('R4 cursor: 새 문자 presence가 update보다 먼저 오면 숫자 fallback 없이 숨기고 도착 후 resolve한다', t => {
  const [a, b] = docs(t, 2)
  workspaceTextForField(a, 'r:c').insert(0, '새문자 ')
  const encoded = encodeWorkspaceCaret(a, 'r:c', 2)
  assert.equal(resolveWorkspacePresenceCaret(b, 'r:c', encoded, 0), undefined)
  assert.equal(resolveWorkspacePresenceCaret(null, 'r:c', encoded, 99), undefined)
  assert.equal(resolveWorkspacePresenceCaret(b, 'r:c', 'broken', 5), undefined)
  assert.equal(resolveWorkspacePresenceCaret(b, 'r:c', '', 5), undefined)
  assert.equal(resolveWorkspacePresenceCaret(b, 'r:c', undefined, 5), 5)
  sync(a, b)
  assert.equal(resolveWorkspacePresenceCaret(b, 'r:c', encoded, 0), 2)
})

test('R4 cursor: 행·블록 재정렬은 anchor identity를 유지하고 삭제·다른 필드·교체된 Y.Text는 null', t => {
  const [a] = docs(t, 1)
  const caret = encodeWorkspaceCaret(a, 'r:c', 4), column = encodeWorkspaceCaret(a, 'column:c', 2), block = encodeWorkspaceCaret(a, 'block:body', 3)
  const before = workspaceToJSON(a), next = structuredClone(before)
  next.blocks.reverse(); applyWorkspaceDiff(a, before, next)
  assert.equal(resolveWorkspaceCaret(a, 'block:body', block), 3)
  assert.equal(resolveWorkspaceCaret(a, 'r:c', caret), 4)
  assert.equal(resolveWorkspaceCaret(a, 'meta:note', caret), null)
  assert.equal(resolveWorkspaceCaret(a, 'r:c', column), null)
  const current = workspaceToJSON(a)
  applyWorkspaceDiff(a, current, { ...current, rows: [] })
  assert.equal(resolveWorkspaceCaret(a, 'r:c', caret), null)
  const columns = a.getMap('workspace').get('columns')
  columns.get(0).set('label', new Y.Text('새 담당 업무'))
  assert.equal(resolveWorkspaceCaret(a, 'column:c', column), null)
})

test('R4 cursor: 기존 키 별칭과 공통 모달 보조 표 키가 같은 Y.Text를 가리킨다', t => {
  const [a] = docs(t, 1)
  assert.equal(workspaceTextForField(a, 'main:r:c'), workspaceTextForField(a, 'r:c'))
  assert.equal(workspaceTextForField(a, 'table:tr:tc'), workspaceTextForField(a, 'block-table:table:tr:tc'))
  assert.equal(resolveWorkspaceCaret(a, 'main:r:c', encodeWorkspaceCaret(a, 'r:c', 3)), 3)
  assert.deepEqual(resolveWorkspaceCaretLocation(a, 'main:r:c', encodeWorkspaceCaret(a, 'r:c', 3)), { fieldKey: 'main:r:c', caretPos: 3 })
  assert.deepEqual(resolveWorkspaceCaretLocation(a, 'table:tr:tc', encodeWorkspaceCaret(a, 'block-table:table:tr:tc', 2)), { fieldKey: 'table:tr:tc', caretPos: 2 })
  assert.equal(workspaceTextForField(a, 'modal:idle'), undefined)
  assert.equal(encodeWorkspaceCaret(a, 'meta:keywords', 3), null, '배열 join 입력은 저장 모델을 변경하지 않음')
})

test('R4 cursor: 체크리스트는 마커 제외 offset·같은 줄 앞 삽입·원격 앞줄 삽입·삭제를 구분한다', t => {
  const [a, b] = docs(t, 2)
  const key = 'block:checks:check:0', caret = encodeWorkspaceCaret(b, key, 3)
  assert.equal(workspaceFieldValue(b, key), '지도 읽기')
  assert.equal(resolveWorkspaceCaret(b, key, caret), 3)
  const content = workspaceTextForField(a, 'block:checks')
  content.insert(6, '지역 '); sync(a, b)
  assert.equal(resolveWorkspaceCaret(b, key, caret), 6)
  content.insert(0, '- [ ] 새 항목\n'); sync(a, b)
  assert.deepEqual(resolveWorkspaceCaretLocation(b, key, caret), { fieldKey: 'block:checks:check:1', caretPos: 6 })
  assert.equal(resolveWorkspaceCaret(b, key, caret), null, '다른 index 입력에 예전 offset을 붙이지 않음')
  const start = content.toString().indexOf('- [ ] 지역'), end = content.toString().indexOf('\n', start)
  content.delete(start, end - start + 1); sync(a, b)
  assert.equal(resolveWorkspaceCaretLocation(b, key, caret), null, '삭제된 항목을 다음 항목으로 옮기지 않음')
})

test('R4 cursor: UTF-16 한글·emoji 및 CRLF 체크리스트 offset은 글자 사이를 분리하지 않는다', t => {
  const [a] = docs(t, 1)
  const text = workspaceTextForField(a, 'r:c'); text.delete(0, text.length); text.insert(0, '가😀나')
  assert.equal(resolveWorkspaceCaret(a, 'r:c', encodeWorkspaceCaret(a, 'r:c', 2)), 1)
  assert.equal(resolveWorkspaceCaret(a, 'r:c', encodeWorkspaceCaret(a, 'r:c', 3)), 3)
  const checklist = workspaceTextForField(a, 'block:checks')
  checklist.delete(0, checklist.length); checklist.insert(0, '- [ ] 하나\r\n- [x] 둘😀')
  const key = 'block:checks:check:1'
  assert.equal(workspaceFieldValue(a, key), '둘😀')
  assert.equal(resolveWorkspaceCaret(a, key, encodeWorkspaceCaret(a, key, 3)), 3)
})

test('R4 cursor: 프로그램 복원 select는 재송신하지 않고 실제 사용자 동작이나 새로운 선택에서 허용한다', () => {
  const guard = createSelectionRestoreGuard(), input = { selectionStart: 3, selectionEnd: 5 }
  guard.mark(input, 3, 5)
  assert.equal(guard.shouldSend(input), false)
  assert.equal(guard.shouldSend(input), false, '동일한 select가 여러 번 와도 다시 보내지 않음')
  input.selectionStart = input.selectionEnd = 4
  assert.equal(guard.shouldSend(input), true)
  guard.mark(input, 4, 4); guard.clear(input)
  assert.equal(guard.shouldSend(input), true, 'pointer/keydown/beforeinput에서 clear')
})

// Actual production hook, minimal React lifecycle + DOM doubles, memory-only provider.
async function hookFixture(t, fieldKey) {
  const source = fs.readFileSync(new URL('../src/components/artifacts/useRealtimeWorkspace.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const providerDoc = new Y.Doc(); seedWorkspace(providerDoc, initial())
  let workspace = initial(), index = 0, session
  const slots = [], layouts = [], effects = [], cleanups = []
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useRef(value) { const i = index++; return slots[i] ??= { current: value } },
    useState(value) { const i = index++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
    useCallback(callback, deps) { const i = index++; if (!depsEqual(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback },
    useEffect(callback, deps) { const i = index++; if (!depsEqual(slots[i]?.deps, deps)) { slots[i] = { deps }; effects.push(callback) } },
    useLayoutEffect(callback, deps) { const i = index++; if (!depsEqual(slots[i]?.deps, deps)) { slots[i] = { deps }; layouts.push(callback) } },
  }
  class Input {
    dataset = { workspaceField: fieldKey }
    isConnected = true
    ownerDocument
    focus() { throw new Error('선택 복원은 focus를 호출하면 안 됨') }
    selectionStart = 0; selectionEnd = 0; selectionDirection = 'none'; _value = ''; selects = 0
    get value() { return this._value }
    set value(value) { if (value !== this._value) { this._value = value; this.selectionStart = this.selectionEnd = value.length } }
    setSelectionRange(start, end, direction) {
      this.selectionStart = Math.min(start, this.value.length); this.selectionEnd = Math.min(end, this.value.length); this.selectionDirection = direction
      this.selects++
      session?.boundaryProps.onSelectCapture({ target: this })
    }
  }
  const input = new Input(), document = { activeElement: input, body: {}, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  input.ownerDocument = document
  const inputs = [input]
  const provider = { ydoc: providerDoc, ready: Promise.resolve(), flush: async () => {}, destroy: async () => providerDoc.destroy(), getWorkspace: () => workspaceToJSON(providerDoc) }
  const project = { id: 'fixture', trainingMode: { enabled: true }, currentCycle: 1 }
  const context = { exports: {}, document, HTMLInputElement: Input, HTMLTextAreaElement: Input, setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} }, require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return {}
      if (name === 'yjs') return Y
      if (name === '@/store/project') return { useProjectStore: select => select({ project }) }
      if (name === '@/lib/coedit/workspace-crdt') return model
      if (name === '@/lib/coedit/workspaceCursor') return cursor
      if (name === '@/lib/coedit/firestore-workspace') return { connectWorkspace: () => provider }
      throw new Error(name)
    } }
  vm.runInNewContext(compiled, context)
  const raw = update => { workspace = typeof update === 'function' ? update(workspace) : update }
  const initialWorkspace = initial()
  function render() {
    index = 0
    session = context.exports.useRealtimeWorkspace({ open: true, projectId: 'fixture', workspaceField: 'teamVisionWorkspace', workspace, incoming: initialWorkspace, setWorkspace: raw })
  }
  function commit() {
    render()
    for (const target of inputs) target.value = workspaceFieldValue(providerDoc, target.dataset.workspaceField) ?? ''
    while (layouts.length) layouts.shift()()
    while (effects.length) { const cleanup = effects.shift()(); if (cleanup) cleanups.push(cleanup) }
  }
  commit()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  commit()
  t.after(() => cleanups.reverse().forEach(cleanup => cleanup()))
  return {
    input, providerDoc, commit, document,
    get session() { return session },
    focus(start, end = start, direction = 'none') {
      document.activeElement = input
      input.selectionStart = start; input.selectionEnd = end; input.selectionDirection = direction
      session.boundaryProps.onFocusCapture({ target: input })
    },
    focusOther(key, start) {
      const target = new Input()
      target.dataset.workspaceField = key
      target.ownerDocument = document
      target.value = workspaceFieldValue(providerDoc, key) ?? ''
      target.selectionStart = target.selectionEnd = start
      inputs.push(target)
      document.activeElement = target
      session.boundaryProps.onFocusCapture({ target })
      return target
    },
    local(value, caretPos) {
      session.boundaryProps.onBeforeInputCapture({ target: input })
      input.value = value; input.selectionStart = input.selectionEnd = caretPos
      session.boundaryProps.onInputCapture({ target: input })
      session.setWorkspace(current => {
        const next = structuredClone(current)
        if (fieldKey === 'r:c') next.rows[0].cells.c = value
        else if (fieldKey === 'meta:note') next.note = value
        return next
      })
    },
  }
}

test('R4 actual hook: 메타·열·블록·표 선택을 원격 삽입 뒤 복원하고 프로그램 onSelect 재송신을 막는다', async t => {
  for (const key of ['meta:note', 'column:c', 'block:body', 'r:c', 'block-table:table:tr:tc', 'block-table-column:table:tc']) {
    const fixture = await hookFixture(t, key)
    fixture.focus(2, 4, 'backward')
    workspaceTextForField(fixture.providerDoc, key).insert(0, '새 ')
    fixture.commit()
    assert.equal(fixture.input.selectionStart, 4, key)
    assert.equal(fixture.input.selectionEnd, 6, key)
    assert.equal(fixture.input.selectionDirection, 'backward', key)
    assert.equal(fixture.session.shouldSendPresence(fixture.input), false, '프로그램적 select가 presence를 다시 보내지 않음')
    fixture.session.boundaryProps.onPointerDownCapture({ target: fixture.input })
    assert.equal(fixture.session.shouldSendPresence(fixture.input), true)
  }
})

test('R4 actual hook: React commit 전 연속 원격 update도 오래된 DOM offset을 재캡처하지 않는다', async t => {
  const fixture = await hookFixture(t, 'r:c')
  fixture.focus(3)
  const text = workspaceTextForField(fixture.providerDoc, 'r:c')
  text.insert(0, 'A '); text.insert(0, 'B ')
  fixture.commit()
  assert.equal(fixture.input.selectionStart, 7)
  assert.equal(fixture.input.selectionEnd, 7)
})

test('R4 actual hook: 운영 T5 추가 본문 재현 — B 선택3, A 앞 X 삽입 후 B 선택4 유지', async t => {
  const fixture = await hookFixture(t, 'block:body')
  const text = workspaceTextForField(fixture.providerDoc, 'block:body')
  text.delete(0, text.length); text.insert(0, '가나다라마바사 아자차카타파하')
  fixture.commit(); fixture.focus(3)
  const anchor = fixture.session.encodeCaret('block:body', 3)
  text.insert(0, 'X')
  fixture.commit()
  assert.equal(fixture.input.selectionStart, 4)
  assert.equal(fixture.input.selectionEnd, 4)
  assert.equal(fixture.session.resolveCaret('block:body', anchor, 3), 4)
  assert.equal(fixture.session.shouldSendPresence(fixture.input), false)
})

test('R4 actual hook: 비활성 iframe의 BODY 포커스에서도 마지막 본문 선택을 복원하며 포커스를 빼앗지 않는다', async t => {
  const fixture = await hookFixture(t, 'block:body')
  const text = workspaceTextForField(fixture.providerDoc, 'block:body')
  text.delete(0, text.length); text.insert(0, '가나다라마바사 아자차카타파하')
  fixture.commit(); fixture.focus(3)
  // 먼저 commit하여 pending selection 없이 마지막 입력란만 남은 상황도 재현한다.
  fixture.providerDoc.getMap('workspace').set('updatedAt', 1)
  fixture.commit()
  fixture.document.activeElement = fixture.document.body
  text.insert(0, 'X')
  fixture.commit()
  assert.equal(fixture.input.selectionStart, 4)
  assert.equal(fixture.input.selectionEnd, 4)
  assert.equal(fixture.input.ownerDocument.activeElement, fixture.document.body)
  assert.equal(fixture.session.shouldSendPresence(fixture.input), false)
  text.insert(0, 'Y'); text.insert(0, 'Z')
  fixture.commit()
  assert.equal(fixture.input.selectionStart, 6, '비활성 상태의 연속 업데이트도 상대 선택을 유지')
  fixture.providerDoc.getMap('workspace').set('updatedAt', 2)
  fixture.commit()
  assert.equal(fixture.input.selectionStart, 6, 'ack도 선택을 끝으로 보내지 않음')
})

test('R4 actual hook: 다른 workspace 필드의 새 선택이 이전 필드의 미복원 선택보다 우선한다', async t => {
  const fixture = await hookFixture(t, 'block:body')
  fixture.focus(3)
  workspaceTextForField(fixture.providerDoc, 'block:body').insert(0, 'X')
  const other = fixture.focusOther('meta:note', 2)
  fixture.document.activeElement = fixture.document.body
  workspaceTextForField(fixture.providerDoc, 'meta:note').insert(0, 'Y')
  fixture.commit()
  assert.equal(other.selectionStart, 3)
  assert.equal(other.selectionEnd, 3)
  assert.equal(fixture.input.selects, 0, '이전 입력란으로 선택을 되돌리지 않음')
  assert.equal(fixture.document.activeElement, fixture.document.body)
})

test('R4 actual hook: DOM에서 제거된 마지막 입력란은 선택을 복원하지 않는다', async t => {
  const fixture = await hookFixture(t, 'block:body')
  fixture.focus(3)
  fixture.input.isConnected = false
  fixture.document.activeElement = fixture.document.body
  workspaceTextForField(fixture.providerDoc, 'block:body').insert(0, 'X')
  fixture.commit()
  assert.equal(fixture.input.selects, 0)
  assert.equal(fixture.document.activeElement, fixture.document.body)
})

test('R4 actual hook: 로컬 입력 직후 서버 ack·다른 칸 업데이트가 와도 입력자의 커서가 0으로 돌아가지 않는다', async t => {
  const fixture = await hookFixture(t, 'r:c')
  fixture.focus(3)
  const value = fixture.input.value.slice(0, 3) + 'A' + fixture.input.value.slice(3)
  fixture.local(value, 4)
  const server = new Y.Doc(); t.after(() => server.destroy()); sync(fixture.providerDoc, server)
  server.getMap('workspace').set('updatedAt', 999)
  sync(server, fixture.providerDoc)
  fixture.commit()
  assert.equal(fixture.input.value, value)
  assert.equal(fixture.input.selectionStart, 4)
  fixture.session.boundaryProps.onKeyDownCapture({ target: fixture.input })
  assert.equal(fixture.session.shouldSendPresence(fixture.input), true)
})

test('R4 actual hook: IME 중 원격 입력은 대기하고 조합 완료 후 글자와 선택이 함께 수렴한다', async t => {
  const fixture = await hookFixture(t, 'r:c')
  fixture.focus(3)
  fixture.session.boundaryProps.onCompositionStartCapture()
  workspaceTextForField(fixture.providerDoc, 'r:c').insert(0, '원격 ')
  const old = fixture.input.value
  assert.equal(fixture.input.value, old)
  fixture.session.boundaryProps.onCompositionEndCapture()
  await new Promise(resolve => setTimeout(resolve, 0))
  fixture.commit()
  assert.equal(fixture.input.value, `원격 ${old}`)
  assert.equal(fixture.input.selectionStart, 6)
})

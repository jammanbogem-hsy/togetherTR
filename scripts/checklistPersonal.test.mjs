import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { FieldPath } from 'firebase/firestore'
import * as checklist from '../src/lib/chat/checklist.ts'
import { ACTIVITY_META } from '../src/types/index.ts'

test('personal checklist: uid의 명시 상태가 없으면 AI [x]·이전 공동 체크와 무관하게 false', () => {
  const state = { 0: { checked: true, by: '이전 교사', at: 10 }, 1: { a: { checked: true, name: 'A', at: 20 } } }
  assert.equal(checklist.isChecklistChecked(0, [true], state, 'a'), false)
  assert.equal(checklist.isChecklistChecked(0, [true], undefined, 'a'), false)
  assert.equal(checklist.isChecklistChecked(1, [true, true], state, 'b'), false)
  assert.equal(checklist.isChecklistChecked(1, [true, true], state, 'a'), true)
  assert.deepEqual(checklist.checklistProgress('- [x] 첫째\n- [x] 둘째', state, 'a'), { total: 2, checked: 1, allChecked: false })
  assert.deepEqual(checklist.checklistProgress('- [x] 첫째\n- [x] 둘째', state, 'b'), { total: 2, checked: 0, allChecked: false })
})

test('personal checklist: uid 생략은 legacy/default 호환·공동 기록 배지는 개인 참여자로 세지 않음', () => {
  const state = { 0: { checked: true, by: '김 교사', at: 10 }, 1: { checked: false, by: '이 교사' } }
  assert.equal(checklist.isChecklistChecked(0, [false], state), true)
  assert.equal(checklist.isChecklistChecked(1, [false, true], state), false)
  assert.equal(checklist.isChecklistChecked(0, [true]), true)
  assert.deepEqual(checklist.checklistLegacyEntry(0, state), { checked: true, by: '김 교사', at: 10 })
  assert.deepEqual(checklist.checklistParticipants(0, state), [])
  assert.deepEqual(checklist.checklistProgress('- [ ] 첫째\n- [x] 둘째', state), { total: 2, checked: 1, allChecked: false })
})

test('personal checklist: legacy에 A·B 기록을 더해도 공동 기록과 다른 uid를 변경하지 않음', () => {
  const legacy = { 0: { checked: true, by: '김 교사', at: 10 }, 1: { c: { checked: true, name: 'C', at: 1 } } }
  const before = structuredClone(legacy)
  const a = checklist.applyChecklistToggle(legacy, 0, 'a', true, 'A', 20)
  const b = checklist.applyChecklistToggle(a, 0, 'b', true, 'B', 21)
  const toggled = checklist.applyChecklistToggle(b, 0, 'a', false, 'A', 22)
  assert.deepEqual(checklist.checklistLegacyEntry(0, toggled), legacy[0])
  assert.equal(checklist.isChecklistChecked(0, [true], toggled, 'a'), false)
  assert.equal(checklist.isChecklistChecked(0, [true], toggled, 'b'), true)
  assert.equal(checklist.isChecklistChecked(0, [true], toggled, 'missing'), false)
  assert.equal(toggled[1], legacy[1], '다른 칸도 원형 보존')
  assert.equal(toggled[0].b, b[0].b, '다른 uid 객체 교체하지 않음')
  assert.deepEqual(checklist.checklistParticipants(0, toggled), [{ uid: 'a', checked: false, name: 'A', at: 22 }, { uid: 'b', checked: true, name: 'B', at: 21 }])
  assert.deepEqual(legacy, before)
})

test('personal checklist: 순수 개인 기록·빈 값·깨진 데이터·잘못된 토글은 안전하게 처리', () => {
  const state = checklist.applyChecklistToggle(undefined, 0, 'a.b[1]', true, '', 1)
  assert.deepEqual(state, { 0: { 'a.b[1]': { checked: true, name: 'a.b[1]', at: 1 } } })
  assert.equal(checklist.checklistLegacyEntry(0, state), null)
  assert.deepEqual(checklist.checklistParticipants(1, state), [])
  assert.deepEqual(checklist.checklistParticipants(0, { 0: { checked: true, at: { checked: true }, invalid: null } }), [])
  assert.deepEqual(checklist.checklistProgress('체크 없는 문장', state, 'a'), { total: 0, checked: 0, allChecked: false })
  assert.throws(() => checklist.applyChecklistToggle({}, -1, 'a', true, 'A'), /invalid-index/)
  assert.throws(() => checklist.applyChecklistToggle({}, 0, '', true, 'A'), /user-required/)
})

function storageFixture({ offline = false, legacy = false } = {}) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('projects.ts', source, ts.ScriptTarget.Latest, true)
  function declaration(name) {
    let found
    function walk(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, walk) }
    walk(tree); assert.ok(found, name); return found.getText(tree).replace(/^export\s+/, '')
  }
  const state = { content: '원문 그대로', checklistState: legacy ? { 0: { checked: true, by: '과거 교사', at: 10 }, 2: { c: { checked: true, name: 'C', at: 5 } } } : {} }
  const auth = { currentUser: { uid: 'a', displayName: 'A' } }, calls = [], queued = []
  const context = { exports: {}, auth, db: {}, FieldPath, ACTIVITY_META, messageDocPath: checklist.messageDocPath,
    serverTimestamp: () => ({ serverTime: true }), doc: (_db, path) => ({ path }),
    updateDoc(ref, path, value) {
      const uid = auth.currentUser.uid
      const indexes = Array.from({ length: 5 }, (_, i) => i)
      const index = indexes.find(index => path instanceof FieldPath && path.isEqual(new FieldPath('checklistState', String(index), uid)))
      assert.notEqual(index, undefined, '문자열 경로·부모 map 교체가 아니라 해당 UID의 FieldPath 하나')
      calls.push({ ref, index, uid, value })
      const apply = () => {
        const row = state.checklistState[index] ??= {}
        row[uid] = value
      }
      if (!offline) { apply(); return Promise.resolve() }
      return new Promise(resolve => queued.push(() => { apply(); resolve() }))
    },
  }
  vm.runInNewContext(ts.transpileModule(`${declaration('updateMessageChecklist')}\n${declaration('setMessageChecklistItem')}\nexports.update = updateMessageChecklist; exports.compat = setMessageChecklistItem;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const message = { id: 'm', activityCode: 'T-1-1' }
  return { state, calls, auth, context, message, update: context.exports.update, compat: context.exports.compat,
    actor(uid, name = uid) { auth.currentUser = { uid, displayName: name } },
    flush() { queued.splice(0).forEach(apply => apply()) },
  }
}

test('personal checklist storage: 인증 uid·칸 검증 실패면 쓰지 않고 정상 호출은 uid FieldPath 한 개만 쓴다', async () => {
  const f = storageFixture()
  await assert.rejects(f.update('p', f.message, 0, 'b', true, 'B'), /user-mismatch/)
  await assert.rejects(f.update('p', f.message, -1, 'a', true, 'A'), /invalid-index/)
  await assert.rejects(f.update('p', f.message, 0, 'a', 'true', 'A'), /invalid-checked/)
  f.auth.currentUser = null
  await assert.rejects(f.update('p', f.message, 0, 'a', true, 'A'), /auth-required/)
  assert.equal(f.calls.length, 0)
  f.actor('a'); await f.update('p', f.message, 0, 'a', true, 'A')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].ref.path, 'projects/p/conversations/T-1-1/messages/m')
  assert.equal(f.state.checklistState[0].a.name, 'A')
})

test('personal checklist storage: 오프라인 A/B 동시 쓰기는 나중에 재연결돼도 각 uid 최신 토글과 legacy/본문 보존', async () => {
  const f = storageFixture({ offline: true, legacy: true })
  const before = structuredClone(f.state)
  f.actor('a'); const aOn = f.update('p', f.message, 0, 'a', true, 'A')
  f.actor('b'); const bOn = f.update('p', f.message, 0, 'b', true, 'B')
  f.actor('a'); const aOff = f.update('p', f.message, 0, 'a', false, 'A')
  assert.deepEqual(f.state, before, '서버 ack 전에도 read/transaction 없이 세 write를 큐에 넣음')
  assert.equal(f.calls.length, 3)
  f.flush(); await Promise.all([aOn, bOn, aOff])
  assert.equal(f.state.checklistState[0].a.checked, false)
  assert.equal(f.state.checklistState[0].b.checked, true)
  assert.deepEqual(checklist.checklistLegacyEntry(0, f.state.checklistState), before.checklistState[0])
  assert.deepEqual(f.state.checklistState[2], before.checklistState[2])
  assert.equal(f.state.content, before.content)
})

test('personal checklist storage: 특수문자 UID도 한 키로 저장·레거시 메시지 경로·5인자 호출 이름 호환', async () => {
  const f = storageFixture({ legacy: true })
  f.actor('a.b[1]', '특수 교사')
  await f.update('p', { ...f.message, legacyPath: true }, 0, 'a.b[1]', true, '특수 교사')
  assert.equal(f.calls[0].ref.path, 'projects/p/conversations/T/messages/m')
  assert.equal(f.state.checklistState[0]['a.b[1]'].name, '특수 교사')
  f.actor('a', '프로필 이름'); await f.compat('p', f.message, 0, false, '과거 인자 이름')
  assert.equal(f.state.checklistState[0].a.name, '과거 인자 이름')
  assert.equal(f.state.checklistState[0]['a.b[1]'].checked, true)
  assert.equal(f.state.checklistState[0].checked, true, '이전 공동 기록은 삭제·이관하지 않음')
})

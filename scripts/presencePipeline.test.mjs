import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createPresenceThrottle, samePresenceEntry, PRESENCE_THROTTLE_MS } from '../src/lib/coedit/presenceThrottle.ts'
import * as presenceOwner from '../src/lib/coedit/presenceOwner.ts'

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const entry = (updatedAt, caretPos = 3) => ({ uid: 'a', displayName: '사회 교사', color: '#A0BCE8', cellKey: 'r1:c1', caretPos, updatedAt })
function clock(t) { t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 }) }

test('presence: 첫 위치는 즉시, 끊임없는 입력도 250ms마다 최신 위치를 송신하고 모든 호출을 완료한다', async t => {
  clock(t)
  const send = createPresenceThrottle(), writes = [], calls = []
  const write = async value => { writes.push({ at: Date.now(), value }) }
  calls.push(send('p:a:roles', entry(Date.now(), 0), write)); await settle()
  assert.equal(writes.length, 1)
  for (let i = 1; i <= 10; i++) {
    t.mock.timers.tick(50)
    calls.push(send('p:a:roles', entry(Date.now(), i), write)); await settle()
  }
  t.mock.timers.tick(250); await settle(); await Promise.all(calls)
  assert.equal(PRESENCE_THROTTLE_MS, 250)
  assert.ok(writes.length >= 3, '입력이 끝나기 전에도 송신')
  for (let i = 1; i < writes.length; i++) assert.equal(writes[i].at - writes[i - 1].at, 250)
  assert.equal(writes.at(-1).value.caretPos, 10)
})

test('presence: 같은 칸·caret의 heartbeat도 최신 timestamp를 보내며 활성자가 20/60초 뒤 사라지지 않는다', async t => {
  clock(t)
  const send = createPresenceThrottle(), writes = []
  const write = async value => { writes.push(value) }
  let current = entry(Date.now())
  await send('p:a:roles', current, write)
  for (let i = 0; i < 15; i++) {
    t.mock.timers.tick(10_000)
    const next = entry(Date.now())
    await send('p:a:roles', next, write)
    assert.equal(samePresenceEntry(current, next), false)
    current = next
    assert.ok(Date.now() - current.updatedAt < 20_000)
    assert.ok(Date.now() - current.updatedAt < 60_000)
  }
  assert.equal(writes.at(-1).updatedAt, 151_000)
  assert.equal(samePresenceEntry(current, { ...current }), true)
  for (const change of [{ displayName: '새 이름' }, { color: '#00FF00' }, { cellKey: 'r2:c1' }, { caretPos: 4 }]) {
    assert.equal(samePresenceEntry(current, { ...current, ...change }), false)
  }
})

test('presence: 삭제는 대기 Promise를 정리하고 진행 중 쓰기가 끝난 뒤 실행하여 이전 위치를 되살리지 않는다', async t => {
  clock(t)
  const send = createPresenceThrottle(), writes = []
  let release, stored, removed = false
  const blocked = new Promise(resolve => { release = resolve })
  const write = async value => {
    writes.push(value)
    if (value) await blocked
    stored = value
  }
  const first = send('p:a:roles', entry(1000, 1), write); await settle()
  const queued = send('p:a:roles', entry(1001, 2), write)
  const deleting = send('p:a:roles', null, write).then(() => { removed = true })
  await queued
  assert.equal(removed, false)
  t.mock.timers.tick(1000); await settle()
  assert.equal(writes.length, 1, '삭제는 진행 중 쓰기를 추월하지 않음')
  release(); await first; await deleting; await settle()
  assert.equal(stored, null)
  assert.deepEqual(writes.map(value => value?.caretPos ?? null), [1, null])
  t.mock.timers.tick(1000); await settle(); assert.equal(stored, null)
  await send('p:a:roles', entry(Date.now(), 5), write)
  assert.equal(stored.caretPos, 5, '다시 연 창의 새 위치는 정상 송신')
})

test('presence: 삭제가 겹쳐도 각 삭제 Promise는 실제 삭제까지 기다리고 다른 키는 막지 않는다', async t => {
  clock(t)
  const send = createPresenceThrottle(), writes = []
  let release, deleted = false
  const blocked = new Promise(resolve => { release = resolve })
  const write = async value => { if (value) await blocked; else deleted = true; writes.push(value) }
  const first = send('roles:a', entry(1000), write); await settle()
  const deletes = [send('roles:a', null, write), send('roles:a', null, write)]
  let complete = 0; deletes.forEach(promise => promise.then(() => { complete++ }))
  await send('schedule:a', entry(1000), async () => {})
  assert.equal(complete, 0); assert.equal(deleted, false)
  release(); await first; await Promise.all(deletes)
  assert.equal(complete, 2); assert.equal(deleted, true)
  assert.equal(writes.filter(value => value === null).length, 1)
})

test('presence: write 실패도 호출 Promise를 종료하고 다음 heartbeat를 계속 보낸다', async t => {
  clock(t)
  const send = createPresenceThrottle(), failure = new Error('permission-denied')
  const rejected = assert.rejects(send('p:a:roles', entry(1000), async () => { throw failure }), /permission-denied/)
  await settle(); await rejected
  let latest
  const next = send('p:a:roles', entry(1100), async value => { latest = value })
  t.mock.timers.tick(250); await settle(); await next
  assert.equal(latest.updatedAt, 1100)
})

function loadProjects(writes) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  // Presence writes go through a transaction (#R4-C); this mock applies them to an in-memory store.
  const store = new Map()
  const firestore = {
    doc: (_db, ...segments) => segments.join('/'),
    setDoc: async (path, value) => { writes.push({ path, value }) },
    deleteDoc: async path => { writes.push({ path, value: null }) },
    runTransaction: async (_db, fn) => fn({
      get: async path => ({ exists: () => store.has(path), data: () => store.get(path) }),
      set: (path, value) => { store.set(path, value); writes.push({ path, value }) },
      delete: path => { store.delete(path); writes.push({ path, value: null }) },
    }),
  }
  const context = { exports: {}, console, Date, setTimeout, clearTimeout, require(name) {
    if (name === 'firebase/firestore') return firestore
    if (name === '@/lib/coedit/presenceThrottle') return { createPresenceThrottle }
    if (name === '@/lib/coedit/presenceOwner') return presenceOwner
    return {}
  } }
  vm.runInNewContext(compiled, context)
  return context.exports
}

test('presence: 실제 projects.ts의 16개 송신 경로는 즉시 송신·latest heartbeat·즉시 삭제를 같은 통로로 처리한다', async t => {
  clock(t)
  const writes = [], projects = loadProjects(writes)
  const scopes = ['TeamVision', 'IntegratedGoal', 'LessonDesignDirection', 'EvaluationPlan', 'ProblemSituation', 'SupportTool', 'RoleDistribution', 'TeamRules', 'TeamSchedule', 'TopicSelection', 'LearningActivity', 'Scaffolding', 'MaterialDev', 'LessonRecord', 'LessonReflection', 'CollaborationReflection']
  for (const scope of scopes) {
    const set = projects[`set${scope}WorkspacePresence`]
    assert.equal(typeof set, 'function', scope)
    const before = writes.length
    await set('p', 'a', { ...entry(Date.now()), caretPos: undefined })
    assert.equal(writes.length, before + 1, `${scope}: 첫 호출은 대기하지 않음`)
    assert.equal(Object.hasOwn(writes.at(-1).value, 'caretPos'), false, 'Firestore undefined 제거')
    const heartbeat = set('p', 'a', entry(Date.now() + 100))
    const latest = set('p', 'a', entry(Date.now() + 200))
    t.mock.timers.tick(250); await settle(); await Promise.all([heartbeat, latest])
    assert.equal(writes.at(-1).value.updatedAt, Date.now() - 50, `${scope}: 최신 heartbeat`)
    await set('p', 'a', null)
    assert.equal(writes.at(-1).value, null)
    assert.match(writes.at(-1).path, /^projects\/p\/[^/]+Presence\/a$/)
  }
  assert.equal(new Set(writes.map(write => write.path)).size, 16)
})

test('presence: 12개 ChatPanel watcher는 timestamp를 포함하는 비교를 사용한다', () => {
  const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.equal((chat.match(/if \(!samePresenceEntry\(a, b\)\) return next/g) ?? []).length, 12)
  assert.doesNotMatch(chat, /if \(!a \|\| a\.cellKey !== b\.cellKey \|\| a\.caretPos !== b\.caretPos\) return next/)
})

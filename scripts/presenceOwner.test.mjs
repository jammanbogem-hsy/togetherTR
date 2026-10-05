// #R4-C: tabs of the same account share one presence doc (doc id = uid). Each write is arbitrated in a
// transaction by sessionId + interactionAt so an idle tab cannot overwrite or delete the caret of the
// tab the person is actually using. updatedAt only marks abandoned docs as claimable.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createPresenceThrottle } from '../src/lib/coedit/presenceThrottle.ts'
import * as presenceOwner from '../src/lib/coedit/presenceOwner.ts'

const { decidePresenceWrite, PRESENCE_OWNER_STALE_MS } = presenceOwner
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }

test('decide: own session always writes; idle tab never takes an active doc', () => {
  const active = { sessionId: 'A', interactionAt: 5000, updatedAt: 9000 }
  assert.equal(decidePresenceWrite(null, { interactionAt: 0 }, 'B', 9000), 'set', 'empty doc is free')
  assert.equal(decidePresenceWrite(active, { interactionAt: 5000 }, 'A', 9000), 'set', 'own heartbeat')
  assert.equal(decidePresenceWrite(active, { interactionAt: 0 }, 'B', 9000), 'skip', 'initial idle 0')
  assert.equal(decidePresenceWrite(active, {}, 'B', 9000), 'skip', 'missing interactionAt = 0')
  assert.equal(decidePresenceWrite(active, { interactionAt: 5000 }, 'B', 9000), 'skip', 'tie keeps owner')
  assert.equal(decidePresenceWrite(active, { interactionAt: 5001 }, 'B', 9000), 'set', 'newer real input takes over')
})

test('decide: updatedAt is freshness only — a newer heartbeat does not win, an abandoned doc can be claimed', () => {
  const owner = { sessionId: 'A', interactionAt: 5000, updatedAt: 9000 }
  assert.equal(decidePresenceWrite(owner, { interactionAt: 100, updatedAt: 99999 }, 'B', 9500), 'skip')
  assert.equal(decidePresenceWrite(owner, { interactionAt: 0 }, 'B', 9000 + PRESENCE_OWNER_STALE_MS), 'skip')
  assert.equal(decidePresenceWrite(owner, { interactionAt: 0 }, 'B', 9001 + PRESENCE_OWNER_STALE_MS), 'set')
})

test('decide: close deletes only this session\'s entry', () => {
  assert.equal(decidePresenceWrite({ sessionId: 'A' }, null, 'A', 0), 'delete')
  assert.equal(decidePresenceWrite({ sessionId: 'A' }, null, 'B', 0), 'skip', 'other tab cursor survives')
  assert.equal(decidePresenceWrite({}, null, 'B', 0), 'skip', 'legacy entry without sessionId is not ours')
  assert.equal(decidePresenceWrite(null, null, 'B', 0), 'skip')
})

// Optimistic-concurrency transaction mock: commit fails and retries if a read doc changed meanwhile.
function createStore() {
  const docs = new Map()
  const history = []
  let gate = null // optional async pause between get and commit, to interleave two tabs
  return {
    docs, history,
    pauseReads(promise) { gate = promise },
    firestore: {
      doc: (_db, ...segments) => segments.join('/'),
      setDoc: async () => { throw new Error('presence must not bypass the transaction') },
      deleteDoc: async () => { throw new Error('presence must not bypass the transaction') },
      async runTransaction(_db, fn) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const reads = new Map(), ops = []
          await fn({
            get: async path => {
              const entry = docs.get(path)
              reads.set(path, entry?.version ?? 0)
              if (gate) await gate
              return { exists: () => !!entry, data: () => entry && { ...entry.value } }
            },
            set: (path, value) => ops.push({ path, value }),
            delete: path => ops.push({ path, value: null }),
          })
          if ([...reads].some(([path, version]) => (docs.get(path)?.version ?? 0) !== version)) continue
          for (const { path, value } of ops) {
            const version = (docs.get(path)?.version ?? 0) + 1
            if (value) docs.set(path, { value, version }); else docs.delete(path)
            history.push(value ? { ...value } : null)
          }
          return
        }
        throw new Error('transaction retries exhausted')
      },
    },
  }
}

// Each call is a separate module instance = a separate tab with its own sessionId.
function openTab(store) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {}, console: { ...console, warn() {} }, Date, setTimeout, clearTimeout, globalThis: {}, require(name) {
    if (name === 'firebase/firestore') return store.firestore
    if (name === '@/lib/coedit/presenceThrottle') return { createPresenceThrottle }
    if (name === '@/lib/coedit/presenceOwner') return presenceOwner
    return {}
  } }
  context.globalThis = context
  vm.runInNewContext(compiled, context)
  return context.exports
}

const PATH = 'projects/p/teamSchedulePresence/a'
const at = (caretPos, interactionAt) => ({ uid: 'a', displayName: '사회 교사', color: '#A0BCE8', cellKey: 'block:b1', caretPos, interactionAt, updatedAt: Date.now() })
function clock(t) { t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 }) }
async function send(tab, value, t) { const p = tab.setTeamScheduleWorkspacePresence('p', 'a', value); t.mock.timers.tick(300); await settle(); await p }

test('two tabs: the stale tab heartbeat no longer drags the caret back (R4-B scenario)', async t => {
  clock(t)
  const store = createStore()
  const active = openTab(store), stale = openTab(store)
  await send(stale, at(0, 0), t) // stale tab opened first, idle at the start
  let interactionAt = Date.now()
  for (let s = 0; s < 30; s++) {
    t.mock.timers.tick(1000)
    interactionAt = Date.now()
    await send(active, at(10 + s, interactionAt), t)
    if (s % 10 === 0) await send(stale, at(0, 0), t) // its 10s heartbeat
  }
  const carets = store.history.map(v => v?.caretPos)
  const firstActive = carets.indexOf(10)
  assert.ok(firstActive >= 0)
  assert.deepEqual(carets.slice(firstActive).filter(c => c === 0), [], `back-and-forth: ${carets.join(',')}`)
  assert.equal(store.docs.get(PATH).value.caretPos, 39)
})

test('two tabs: closing the idle tab cannot delete the active tab cursor; closing the owner can', async t => {
  clock(t)
  const store = createStore()
  const active = openTab(store), idle = openTab(store)
  await send(active, at(7, Date.now()), t)
  await send(idle, at(0, 0), t)
  await send(idle, null, t)
  assert.equal(store.docs.get(PATH)?.value.caretPos, 7, 'other tab close kept the live cursor')
  await send(active, null, t)
  assert.equal(store.docs.has(PATH), false, 'owner close removes it')
  await send(idle, at(0, 0), t)
  assert.equal(store.docs.get(PATH)?.value.caretPos, 0, 'after owner left, the remaining tab appears')
})

test('two tabs: switching to the other tab and typing there takes over; the old tab heartbeat does not take it back', async t => {
  clock(t)
  const store = createStore()
  const first = openTab(store), second = openTab(store)
  const firstAt = Date.now()
  await send(first, at(3, firstAt), t)
  t.mock.timers.tick(2000)
  await send(second, at(20, Date.now()), t)
  assert.equal(store.docs.get(PATH).value.caretPos, 20)
  t.mock.timers.tick(10000)
  await send(first, at(3, firstAt), t) // heartbeat repeats its old interactionAt
  assert.equal(store.docs.get(PATH).value.caretPos, 20)
})

test('two tabs racing inside the transaction: the read-check-write stays atomic', async t => {
  clock(t)
  const store = createStore()
  const active = openTab(store), idle = openTab(store)
  await send(active, at(5, Date.now()), t)
  let open
  store.pauseReads(new Promise(resolve => { open = resolve }))
  const idleWrite = idle.setTeamScheduleWorkspacePresence('p', 'a', at(0, 0))
  const activeWrite = active.setTeamScheduleWorkspacePresence('p', 'a', at(9, Date.now() + 1))
  await settle()
  store.pauseReads(null); open()
  t.mock.timers.tick(300); await settle(); await Promise.all([idleWrite, activeWrite])
  assert.equal(store.docs.get(PATH).value.caretPos, 9)
  assert.ok(store.history.every(v => v === null || v.caretPos !== 0), store.history.map(v => v?.caretPos).join(','))
})

test('every write carries the tab sessionId, different per tab', async t => {
  clock(t)
  const store = createStore()
  const a = openTab(store), b = openTab(store)
  await send(a, at(1, 0), t)
  const first = store.docs.get(PATH).value.sessionId
  await send(a, null, t); await send(b, at(1, 0), t)
  const second = store.docs.get(PATH).value.sessionId
  assert.equal(typeof first, 'string'); assert.equal(typeof second, 'string')
  assert.notEqual(first, second)
})

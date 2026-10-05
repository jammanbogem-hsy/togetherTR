// #R4: presence carries relativeCaret (Y.RelativePosition JSON) next to caretPos, and the
// per-tab send pipeline never re-sends an older caret after a newer one — so a caret that
// jumps back and forth on a teammate's screen cannot come from one tab's sender.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPresenceThrottle, samePresenceEntry } from '../src/lib/coedit/presenceThrottle.ts'

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const entry = (caretPos, updatedAt, relativeCaret) => ({ uid: 'a', displayName: '사회 교사', color: '#A0BCE8', cellKey: 'block:b1', caretPos, relativeCaret, updatedAt })

test('samePresenceEntry: a relativeCaret change alone is a new state', () => {
  const base = entry(4, 1000, '{"type":null,"tname":null,"item":{"client":1,"clock":3},"assoc":0}')
  assert.equal(samePresenceEntry(base, { ...base }), true)
  assert.equal(samePresenceEntry(base, { ...base, relativeCaret: '{"type":null,"tname":null,"item":{"client":1,"clock":9},"assoc":0}' }), false)
  assert.equal(samePresenceEntry(base, { ...base, relativeCaret: undefined }), false)
})

test('one tab: slow writes + typing + heartbeats are written in order, never an older caret after a newer one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const send = createPresenceThrottle()
  const writes = []
  // Each Firestore write takes 400ms, longer than the 250ms throttle window.
  const write = value => new Promise(resolve => setTimeout(() => { writes.push(value); resolve() }, 400))
  const calls = []
  let caret = 0
  for (let step = 0; step < 40; step++) {
    t.mock.timers.tick(37)
    caret += 1
    calls.push(send('p:a:schedule', entry(caret, Date.now()), write))
    // the modal heartbeat re-sends the latest caret at arbitrary moments
    if (step % 9 === 0) calls.push(send('p:a:schedule', entry(caret, Date.now()), write))
    await settle()
  }
  for (let i = 0; i < 20; i++) { t.mock.timers.tick(250); await settle() }
  await Promise.all(calls)
  const carets = writes.map(w => w.caretPos)
  for (let i = 1; i < carets.length; i++) assert.ok(carets[i] >= carets[i - 1], `caret went back: ${carets.join(',')}`)
  assert.equal(carets.at(-1), 40)
})

test('two tabs of the same uid sharing one presence doc reproduce the back-and-forth', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const doc = { current: null }
  const seen = []
  const write = value => { doc.current = value; seen.push(value?.caretPos); return Promise.resolve() }
  const tabA = createPresenceThrottle()
  const tabB = createPresenceThrottle() // stale tab: last focused the same field at its start
  for (let s = 0; s < 30; s++) {
    t.mock.timers.tick(1000)
    await tabA('p:a:schedule', entry(10 + s, Date.now()), write)
    if (s % 10 === 0) await tabB('p:a:schedule', entry(0, Date.now()), write) // its 10s heartbeat
    await settle()
  }
  // the doc the teammate watches jumps to 0 at every stale-tab heartbeat, then back to current
  const jumps = seen.filter((c, i) => i > 0 && c === 0 && seen[i - 1] > 0).length
  assert.ok(jumps >= 2, `expected periodic jumps, saw ${seen.join(',')}`)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseScrollController } from '../src/lib/chat/responseScroll.ts'

function fixture(zoom = 1) {
  const flags = [], writes = []
  let saved = [], stream = null
  const viewport = { scrollTop: 0, scrollHeight: 1400, clientHeight: 400, offsetHeight: 400, clientTop: 0,
    getBoundingClientRect: () => ({ top: 50, height: 400 * zoom }),
    querySelectorAll: () => saved, querySelector: () => stream,
    scrollTo({ top }) { this.scrollTop = top; writes.push(top) },
  }
  const element = (id, top, revision = 1) => ({ dataset: { aiResponseId: id, aiRevision: revision },
    getBoundingClientRect: () => ({ top: 50 + (top - viewport.scrollTop) * zoom }),
  })
  const controller = createResponseScrollController(() => viewport, value => flags.push(value))
  return { viewport, flags, writes, controller, element, saved: value => { saved = value }, stream: value => { stream = value },
    sync: (scope = 'p:T1', ready = true) => controller.sync(scope, ready),
    userScroll(top) { controller.onUserIntent(); viewport.scrollTop = top; controller.onScroll() },
  }
}

test('new local or remote stream starts at its first line and long growth does not chase the end', () => {
  for (const zoom of [1, 1.5]) {
    const f = fixture(zoom); f.saved([f.element('old', 100)]); f.sync()
    const stream = f.element('', 1100); f.stream(stream); f.sync(); assert.equal(f.viewport.scrollTop, 1000)
    f.controller.onScroll() // browser's clamped programmatic event must not opt into tail mode
    stream.dataset.aiRevision++; f.viewport.scrollHeight = 2500; f.sync(); assert.equal(f.viewport.scrollTop, 1100)
    stream.dataset.aiRevision++; f.viewport.scrollHeight = 3500; f.sync(); assert.equal(f.viewport.scrollTop, 1100)
  }
})
test('reading older text preserves position, signals unseen updates, button returns to answer beginning', () => {
  const f = fixture(); f.saved([f.element('one', 700)]); f.sync(); f.userScroll(120)
  f.stream(f.element('', 1000)); f.viewport.scrollHeight = 2500; f.sync()
  assert.equal(f.viewport.scrollTop, 120); assert.equal(f.flags.at(-1), true)
  f.controller.goToLatest(); assert.equal(f.viewport.scrollTop, 1000); assert.equal(f.flags.at(-1), false)
})
test('intentional bottom scroll follows only this response; next answer resets to its beginning', () => {
  const f = fixture(); f.saved([f.element('old', 100)]); f.stream(f.element('', 600)); f.sync()
  f.userScroll(1000); f.viewport.scrollHeight = 2500; f.sync(); assert.equal(f.viewport.scrollTop, 2100)
  f.stream(null); f.saved([f.element('done', 600)]); f.sync()
  f.stream(f.element('', 2200)); f.sync(); f.controller.onScroll()
  f.viewport.scrollHeight = 4000; f.sync(); assert.equal(f.viewport.scrollTop, 2200)
})
test('deferred saved message gap does not jump back to the previous answer', () => {
  const f = fixture(); f.saved([f.element('old', 100)]); f.stream(f.element('', 900)); f.sync()
  f.stream(null); f.sync(); assert.equal(f.viewport.scrollTop, 900)
  f.saved([f.element('new', 900)]); f.sync(); assert.equal(f.viewport.scrollTop, 900)
})
test('activity change resets paused state and waits for its messages', () => {
  const f = fixture(); f.saved([f.element('old', 800)]); f.sync(); f.userScroll(200)
  f.sync('p:T2', false); assert.equal(f.viewport.scrollTop, 200)
  f.saved([f.element('next', 400)]); f.sync('p:T2'); assert.equal(f.viewport.scrollTop, 400)
  assert.notEqual(f.flags.at(-1), true)
})
test('non-user scroll restoration and unrelated rerenders cannot enable following', () => {
  const f = fixture(); f.saved([f.element('old', 500)]); f.sync(); f.controller.onScroll()
  f.viewport.scrollTop = 1000; f.controller.onScroll(); f.viewport.scrollHeight = 3000; f.sync()
  assert.equal(f.viewport.scrollTop, 500)
  f.userScroll(250); f.sync(); assert.equal(f.viewport.scrollTop, 250)
})

// Regression tests for src/lib/curriculum/sheetMapHistory.ts
// Run: node --experimental-strip-types scripts/sheetMapHistory.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldPushEntry,
  decidePopOwner,
  closeViaHistory,
  setMapLayerOpen,
  isMapLayerOpen,
} from '../src/lib/curriculum/sheetMapHistory.ts'

test('shouldPushEntry: push only when our key is not already on top (StrictMode remount safe)', () => {
  assert.equal(shouldPushEntry(null, 'tcidSheet'), true)
  assert.equal(shouldPushEntry({ __NA: true }, 'tcidSheet'), true)
  assert.equal(shouldPushEntry({ tcidSheet: true }, 'tcidSheet'), false)
  assert.equal(shouldPushEntry({ tcidSheet: true }, 'tcidMap'), true)
  assert.equal(shouldPushEntry({ tcidMap: true }, 'tcidMap'), false)
})

test('decidePopOwner: map back arrow pops the map entry → only the map closes', () => {
  // 스택: page → tcidSheet → tcidMap, back() 후 새 state = tcidSheet
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: true, newState: { tcidSheet: true } }), 'map')
})

test('decidePopOwner: while the map is open and its entry is still on top, nobody closes', () => {
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: true, newState: { tcidMap: true } }), 'none')
})

test('decidePopOwner: sheet closes only when neither entry remains and the map is closed', () => {
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: false, newState: { __NA: true } }), 'sheet')
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: false, newState: null }), 'sheet')
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: false, newState: { tcidSheet: true } }), 'none')
  // 맵 항목이 위에 남아 있는 비정상 상태에서도 시트는 닫지 않는다.
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: false, newState: { tcidMap: true } }), 'none')
})

test('decidePopOwner: closed sheet ignores every pop', () => {
  assert.equal(decidePopOwner({ sheetOpen: false, mapOpen: false, newState: null }), 'none')
})

test('decidePopOwner: two quick back presses close map first, then sheet', () => {
  // 1st pop: 맵 열림, 새 state = tcidSheet
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: true, newState: { tcidSheet: true } }), 'map')
  // 호출부가 맵 플래그를 내린 뒤 2nd pop: 새 state = page
  assert.equal(decidePopOwner({ sheetOpen: true, mapOpen: false, newState: { __NA: true } }), 'sheet')
})

test('closeViaHistory: consumes our entry with back() when on top, closes directly otherwise', () => {
  const calls = []
  assert.equal(closeViaHistory({ currentState: { tcidMap: true }, key: 'tcidMap', backPending: false, back: () => calls.push('back'), close: () => calls.push('close') }), 'back')
  assert.equal(closeViaHistory({ currentState: { tcidSheet: true }, key: 'tcidMap', backPending: false, back: () => calls.push('back'), close: () => calls.push('close') }), 'close')
  assert.deepEqual(calls, ['back', 'close'])
})

test('closeViaHistory: a second request while back() is pending does nothing (no double pop)', () => {
  const calls = []
  assert.equal(closeViaHistory({ currentState: { tcidMap: true }, key: 'tcidMap', backPending: true, back: () => calls.push('back'), close: () => calls.push('close') }), 'pending')
  assert.deepEqual(calls, [])
})

test('map layer flag: set/read', () => {
  setMapLayerOpen(true)
  assert.equal(isMapLayerOpen(), true)
  setMapLayerOpen(false)
  assert.equal(isMapLayerOpen(), false)
})

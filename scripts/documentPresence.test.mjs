// TASK-R3: 구글 문서식 작업 위치 — T-1-2 본문 커서(Firestore awareness 어댑터)·DI/E 공동 편집 칸 커서
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const lib = await import('../src/lib/coedit/documentPresence.ts')

function fakeTransport() {
  const calls = { writes: [], removes: 0, subs: 0, unsubs: 0 }
  let push = () => {}
  return {
    calls,
    push: records => push(records),
    transport: {
      write: record => { calls.writes.push(record) },
      remove: () => { calls.removes++ },
      subscribe: cb => { calls.subs++; push = cb; return () => { calls.unsubs++ } },
    },
  }
}
const me = { uid: 'host', displayName: '홍성용', color: '#A0BCE8' }
const cursor = n => ({ anchor: { type: null, tname: 'default', item: { client: 1, clock: n }, assoc: 0 }, head: { type: null, tname: 'default', item: { client: 1, clock: n }, assoc: 0 } })

test('R3a: 내 커서는 200ms throttle(앞·뒤)로 보내고, 마지막 위치가 반드시 나간다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const f = fakeTransport()
  let now = 1000
  const aw = new lib.FirestoreDocumentAwareness(me, f.transport, { now: () => now }).start()
  aw.setLocalStateField('cursor', cursor(1))
  assert.equal(f.calls.writes.length, 1) // 앞
  for (let i = 2; i <= 5; i++) { now += 30; aw.setLocalStateField('cursor', cursor(i)) }
  assert.equal(f.calls.writes.length, 1)
  now += 200; t.mock.timers.tick(200)
  assert.equal(f.calls.writes.length, 2) // 뒤 — 마지막 위치
  assert.equal(f.calls.writes[1].cursor.anchor.item.clock, 5)
  assert.equal(f.calls.writes[1].displayName, '홍성용')
  // heartbeat: 커서가 있으면 10초마다 다시 보냄
  now += 10_000; t.mock.timers.tick(10_000)
  assert.equal(f.calls.writes.length, 3)
  // 포커스를 잃으면(커서 null) 위치를 지운 기록을 보내고 heartbeat 은 멈춤
  now += 300; aw.setLocalStateField('cursor', null)
  assert.equal(f.calls.writes.at(-1).cursor, null)
  const sent = f.calls.writes.length
  now += 10_000; t.mock.timers.tick(10_000)
  assert.equal(f.calls.writes.length, sent)
  aw.setLocalStateField('user', { name: 'x' }) // cursor 외 필드는 무시
  assert.equal(f.calls.writes.length, sent)
  aw.destroy()
  assert.equal(f.calls.removes, 1)
  assert.equal(f.calls.unsubs, 1)
})

test('R3b: 다른 사람 위치 — 나는 빼고, 30초 넘게 신호 없으면 숨기고, uid 마다 같은 id', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fakeTransport()
  let now = 100_000
  const aw = new lib.FirestoreDocumentAwareness(me, f.transport, { now: () => now }).start()
  let changes = 0
  const listener = () => { changes++ }
  aw.on('change', listener)
  f.push([
    { uid: 'host', displayName: '홍성용', color: '#A0BCE8', cursor: cursor(1), updatedAt: now },
    { uid: 'm1', displayName: '캔바1', color: '#F4AAAA', cursor: cursor(2), updatedAt: now - 5_000 },
    { uid: 'm2', displayName: '잠만보', color: '#CCECA0', cursor: cursor(3), updatedAt: now - 31_000 },
    { uid: 'm3', displayName: '보는 중', color: '#BAA0E8', cursor: null, updatedAt: now },
  ])
  assert.equal(changes, 1)
  const states = aw.getStates()
  assert.deepEqual([...states.keys()], [lib.presenceClientId('m1')])
  assert.equal(states.get(lib.presenceClientId('m1')).user.name, '캔바1')
  assert.equal(lib.presenceClientId('m1'), lib.presenceClientId('m1'))
  assert.notEqual(lib.presenceClientId('m1'), lib.presenceClientId('m2'))
  // 시간이 지나 캔바1 신호도 끊기면 시계가 다시 그려 숨긴다
  now += 30_000; t.mock.timers.tick(5_000)
  assert.equal(aw.getStates().size, 0)
  assert.equal(changes, 2)
  aw.off('change', listener)
  aw.destroy()
})

test('R3c: 한글 조합 중에는 원격 위치 갱신(화면 트랜잭션)을 미뤘다가 조합이 끝나면 한 번 반영', () => {
  const f = fakeTransport()
  let composing = true
  const aw = new lib.FirestoreDocumentAwareness(me, f.transport, {}).start()
  aw.setComposingCheck(() => composing)
  let changes = 0
  aw.on('change', () => { changes++ })
  f.push([{ uid: 'm1', displayName: '캔바1', color: '#F4AAAA', cursor: cursor(2), updatedAt: Date.now() }])
  f.push([{ uid: 'm1', displayName: '캔바1', color: '#F4AAAA', cursor: cursor(3), updatedAt: Date.now() }])
  assert.equal(changes, 0) // 조합 중: 내 입력·선택을 건드리는 메타 트랜잭션 없음
  composing = false
  aw.flushDeferred()
  assert.equal(changes, 1)
  aw.flushDeferred()
  assert.equal(changes, 1) // 미룬 것이 없으면 아무 일 없음
  // 내 커서 보내기는 조합 중에도 계속(위치만 공유, 문서 변경 없음)
  composing = true
  aw.setLocalStateField('cursor', cursor(9))
  assert.equal(f.calls.writes.at(-1).cursor.anchor.item.clock, 9)
  aw.destroy()
})

test('R3d: React 개발 모드처럼 destroy 뒤 start 해도 다시 구독하고, 이후 destroy 는 한 번만 삭제', () => {
  const f = fakeTransport()
  const aw = new lib.FirestoreDocumentAwareness(me, f.transport, {}).start()
  aw.destroy()
  aw.start()
  assert.equal(f.calls.subs, 2)
  aw.setLocalStateField('cursor', cursor(1))
  assert.equal(f.calls.writes.length, 1)
  aw.destroy(); aw.destroy()
  assert.equal(f.calls.removes, 2)
})

test('R3e: 본문 에디터 연결 — y-tiptap 커서 플러그인·진한 이름표·조합 끝 반영·닫기/이탈 시 삭제, Coedit 칸 커서 송신', () => {
  const doc = fs.readFileSync(new URL('../src/components/artifacts/CollaborativeDocument.tsx', import.meta.url), 'utf8')
  assert.match(doc, /yCursorPlugin\(awareness as unknown as Parameters<typeof yCursorPlugin>\[0\], \{ cursorBuilder: buildDocumentCursor, selectionBuilder: documentSelectionAttrs \}\)/)
  assert.match(doc, /dom\.addEventListener\('compositionend', onEnd\)/)
  assert.match(doc, /awareness\.setComposingCheck\(\(\) => editor\.view\.composing\)/)
  assert.match(doc, /window\.addEventListener\('pagehide', onPageHide\)/)
  assert.match(doc, /return \(\) => \{ window\.removeEventListener\('pagehide', onPageHide\); awareness\.destroy\(\) \}/)
  const transport = fs.readFileSync(new URL('../src/lib/coedit/documentPresenceFirestore.ts', import.meta.url), 'utf8')
  assert.match(transport, /doc\(db, 'projects', projectId, DOCUMENT_PRESENCE_COLLECTION, uid\)/)
  assert.equal(lib.DOCUMENT_PRESENCE_COLLECTION, 'lessonDesignDirectionDocumentPresence')
  assert.match(lib.DOCUMENT_PRESENCE_COLLECTION, /Presence$/) // 규칙 와일드카드(.*Presence, 본인 uid 쓰기)
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  assert.match(rules, /allow create, update, delete: if isMember\(pid\) && request\.auth\.uid == uid && presenceCol\.matches\('\.\*Presence'\)/)
  const coedit = fs.readFileSync(new URL('../src/components/artifacts/CoeditWorkspaceModal.tsx', import.meta.url), 'utf8')
  assert.match(coedit, /caretEditors=\{others\}/)
  const selectHandler = coedit.match(/onSelect=\{([^\n]+)\}/)?.[1] ?? ''
  assert.match(selectHandler, /if \(realtime\.shouldSendPresence\(e\.currentTarget\)\)/)
  assert.match(selectHandler, /reportPresence\(cellKey, e\.currentTarget\.selectionStart \?\? 0\)/)
  assert.match(coedit, /\.\.\.\(typeof caretPos === 'number' \? \{ caretPos \} : \{\}\)/)
})

test('R3f: 본문 커서 모양 — 진한 세로선과 흰 글자 이름표(대비 4.5:1)', async () => {
  // 최소 DOM 대역
  const make = tag => ({ tag, attrs: {}, children: [], className: '', textContent: '', setAttribute(k, v) { this.attrs[k] = v }, append(...items) { this.children.push(...items) } })
  globalThis.document = { createElement: make }
  const ts = (await import('typescript')).default
  const vm = await import('node:vm')
  const presence = await (async () => {
    const src = fs.readFileSync(new URL('../src/components/artifacts/presence.tsx', import.meta.url), 'utf8')
    const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const React = (await import('react')).default
    const jsx = await import('react/jsx-runtime')
    const ctx = { exports: {}, require: n => n === 'react' ? React : jsx, setInterval, clearInterval, Date, Math }
    vm.runInNewContext(out, ctx)
    return ctx.exports
  })()
  const source = fs.readFileSync(new URL('../src/components/artifacts/CollaborativeDocument.tsx', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('export function buildDocumentCursor'), source.indexOf('export function documentSelectionAttrs'))
  const out = ts.transpileModule(`${fn}\nexports.build = buildDocumentCursor`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const ctx = { exports: {}, document: globalThis.document, presenceInk: presence.presenceInk, presenceTagStyle: presence.presenceTagStyle }
  vm.runInNewContext(out, ctx)
  const el = ctx.exports.build({ name: '캔바1', color: '#A0BCE8' })
  const ink = presence.presenceInk('#A0BCE8')
  assert.match(el.attrs.style, new RegExp(`border-left: 2px solid ${ink}`))
  const label = el.children[1]
  assert.equal(label.textContent, '캔바1')
  assert.match(label.attrs.style, new RegExp(`background-color: ${ink}; color: #FFFFFF`))
  assert.ok(presence.contrastRatio(ink, '#FFFFFF') >= 4.5)
  delete globalThis.document
})

test('R3g: compositionend 순간 아직 조합 중이면 미룬 채 두고, 다음 틱 재시도에서 반영(언마운트 시 재시도 취소)', () => {
  const f = fakeTransport()
  let composing = true
  const aw = new lib.FirestoreDocumentAwareness(me, f.transport, {}).start()
  aw.setComposingCheck(() => composing)
  let changes = 0
  aw.on('change', () => { changes++ })
  f.push([{ uid: 'm1', displayName: '캔바1', color: '#F4AAAA', cursor: cursor(2), updatedAt: Date.now() }])
  aw.flushDeferred() // compositionend 직후: view.composing 이 아직 true
  assert.equal(changes, 0)
  composing = false
  aw.flushDeferred() // 다음 틱 재시도
  assert.equal(changes, 1)
  aw.destroy()
  const doc = fs.readFileSync(new URL('../src/components/artifacts/CollaborativeDocument.tsx', import.meta.url), 'utf8')
  assert.match(doc, /awareness\.flushDeferred\(\)\n      if \(retry\) clearTimeout\(retry\)\n      retry = setTimeout\(\(\) => \{ retry = undefined; awareness\.flushDeferred\(\) \}, 0\)/)
  assert.match(doc, /return \(\) => \{\n      if \(retry\) clearTimeout\(retry\)/)
})

test('R3h: 어댑터가 바뀌면(프로필 이름·색 갱신) 에디터도 새로 만들어 지난 어댑터를 붙잡지 않는다', () => {
  const doc = fs.readFileSync(new URL('../src/components/artifacts/CollaborativeDocument.tsx', import.meta.url), 'utf8')
  assert.match(doc, /\}, \[document, awareness\]\)/)
  assert.match(doc, /useMemo\(\(\) => presenceUid\n    \? new FirestoreDocumentAwareness[\s\S]*?\[projectId, presenceUid, presenceName, presenceColor\]\)/)
  // 지난 어댑터는 destroy 뒤 원격을 받지 않고 보내지도 않는다
  const f = fakeTransport()
  const old = new lib.FirestoreDocumentAwareness(me, f.transport, {}).start()
  let changes = 0
  old.on('change', () => { changes++ })
  old.destroy()
  f.push([{ uid: 'm1', displayName: '캔바1', color: '#F4AAAA', cursor: cursor(2), updatedAt: Date.now() }])
  old.setLocalStateField('cursor', cursor(5))
  assert.equal(changes, 0)
  assert.equal(f.calls.writes.length, 0)
})

// ─── 본문 저장 예약: debounce → throttle (계속 타이핑해도 250ms마다 저장·원격 표시) ─────────
async function loadFlushThrottle() {
  const ts = (await import('typescript')).default
  const vm = await import('node:vm')
  const src = fs.readFileSync(new URL('../src/lib/coedit/firestore-document.ts', import.meta.url), 'utf8')
  // 이 파일은 Firebase 초기화를 import 하므로, 실제 함수 코드만 떼어 실행한다(같은 코드 그대로)
  const start = src.indexOf('export const DOCUMENT_FLUSH_THROTTLE_MS')
  const end = src.indexOf('/** Transactional Yjs state merge')
  const out = ts.transpileModule(`${src.slice(start, end)}\nexports.createFlushThrottle = createFlushThrottle\nexports.MS = DOCUMENT_FLUSH_THROTTLE_MS`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const ctx = { exports: {}, setTimeout, clearTimeout }
  vm.runInNewContext(out, ctx)
  return ctx.exports
}

test('R3i: 1.2초 동안 50ms마다 입력해도(실제 타이머) 250ms마다 저장된다 — 예전 debounce 는 입력이 멈출 때까지 0회', async () => {
  const { createFlushThrottle, MS } = await loadFlushThrottle()
  assert.equal(MS, 250)
  const flushes = []
  const started = Date.now()
  const throttle = createFlushThrottle(() => flushes.push(Date.now() - started))
  // 예전 방식(입력마다 지우고 다시 예약)과 나란히 비교
  let debounceTimer, debounced = 0
  const oldSchedule = () => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(() => { debounced++ }, 250) }
  for (let t = 0; t < 1200; t += 50) {
    throttle.schedule(); oldSchedule()
    await new Promise(r => setTimeout(r, 50))
  }
  assert.ok(flushes.length >= 4, `throttle 저장 ${flushes.length}회`)
  assert.ok(flushes[0] < 400, `첫 저장 ${flushes[0]}ms`)
  for (let i = 1; i < flushes.length; i++) assert.ok(flushes[i] - flushes[i - 1] >= 200, '간격 유지')
  assert.equal(debounced, 0) // 결함 재현: 계속 입력하면 한 번도 저장되지 않았다
  clearTimeout(debounceTimer)
  // 입력이 멈추면 마지막 예약 한 번으로 끝난다
  const before = flushes.length
  await new Promise(r => setTimeout(r, 300))
  assert.ok(flushes.length - before <= 1)
  assert.equal(throttle.scheduled, false)
})

test('R3j: 바로 저장(flush) 시작 때 예약을 지우면 다음 입력이 새로 예약하고, 같은 예약은 한 번만 실행', async () => {
  const { createFlushThrottle } = await loadFlushThrottle()
  let runs = 0
  const throttle = createFlushThrottle(() => { runs++ }, 30)
  throttle.schedule(); throttle.schedule(); throttle.schedule()
  assert.equal(throttle.scheduled, true)
  throttle.cancel() // flush() 시작
  assert.equal(throttle.scheduled, false)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(runs, 0)
  throttle.schedule()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(runs, 1)
  // 실제 연결 코드도 이 throttle 을 쓴다(입력 → schedule, flush 시작·종료 → cancel)
  const src = fs.readFileSync(new URL('../src/lib/coedit/firestore-document.ts', import.meta.url), 'utf8')
  assert.equal((src.match(/throttle\.schedule\(\)/g) ?? []).length, 1)
  assert.doesNotMatch(src, /if \(timer\) clearTimeout\(timer\)\n\s*timer = setTimeout/)
})

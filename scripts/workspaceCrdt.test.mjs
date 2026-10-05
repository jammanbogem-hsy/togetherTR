import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'
import * as Y from 'yjs'
import { seedWorkspace, workspaceToJSON, applyWorkspaceDiff, applyWorkspacePatch, getCellText, applyCellDelta, textDelta } from '../src/lib/coedit/workspace-crdt.ts'
import { connectWorkspace, firestoreTransport, mergeWorkspaceTransaction, estimateProjectBytes, WORKSPACE_CRDT_FIELD, WORKSPACE_THROTTLE_MS } from '../src/lib/coedit/firestore-workspace.ts'

const json = () => ({ columns: [{ id: 'name', label: '활동', color: '#0B57D0' }, { id: 'note', label: '메모' }], rows: [{ id: 'r1', cells: { name: '폭염 지도', note: '인터뷰' } }, { id: 'r2', cells: { name: '그늘막', note: '' } }], blocks: [{ id: 'b1', type: 'paragraph', content: '첫 메모' }, { id: 'b2', type: 'table', content: '', table: { columns: [{ id: 'a', label: '자료' }], rows: [{ id: 's1', cells: { a: '사회 지도' } }] } }], review: '학생 질문', updatedAt: 1 })
function replicas(count = 2) {
  const seed = new Y.Doc(); seedWorkspace(seed, json())
  const state = Y.encodeStateAsUpdate(seed); seed.destroy()
  return Array.from({ length: count }, () => { const doc = new Y.Doc(); Y.applyUpdate(doc, state); return doc })
}
function exchange(docs) {
  const updates = docs.map(doc => Y.encodeStateAsUpdate(doc))
  for (const doc of docs) for (const update of [...updates].reverse()) Y.applyUpdate(doc, update)
  for (const doc of docs) assert.deepEqual(workspaceToJSON(doc), workspaceToJSON(docs[0]))
}
const edits = (doc, change) => { const before = workspaceToJSON(doc); const next = structuredClone(before); change(next); applyWorkspaceDiff(doc, before, next) }
const cleanup = (t, docs) => t.after(() => docs.forEach(doc => doc.destroy()))

test('R1: 기존 JSON 왕복은 메타·보조 표·안정 ID를 보존하고 표는 Y.Array<Y.Map>·셀은 Y.Text다', t => {
  const doc = new Y.Doc(); cleanup(t, [doc]); const input = json()
  seedWorkspace(doc, input)
  assert.deepEqual(workspaceToJSON(doc), input)
  const rows = doc.getMap('workspace').get('rows')
  assert.ok(rows instanceof Y.Array)
  assert.ok(rows.get(0) instanceof Y.Map)
  assert.ok(getCellText(doc, 'r1', 'name') instanceof Y.Text)
  assert.ok(getCellText(doc, 's1', 'a', 'b2') instanceof Y.Text)
  seedWorkspace(doc, { ...input, review: '중복 seed 금지' })
  assert.deepEqual(workspaceToJSON(doc), input)
})

test('R1: 같은 셀의 두 동시 입력은 앞·뒤 문자열을 모두 보존하고 순서가 다른 update도 수렴한다', t => {
  const docs = replicas(); cleanup(t, docs)
  edits(docs[0], ws => { ws.rows[0].cells.name = '우리 폭염 지도' })
  edits(docs[1], ws => { ws.rows[0].cells.name = '폭염 지도 보기' })
  exchange(docs)
  assert.equal(getCellText(docs[0], 'r1', 'name').toString(), '우리 폭염 지도 보기')
})

test('R1: 같은 위치 동시 삽입·분리된 칸 편집은 양쪽 입력을 살린다', t => {
  const docs = replicas(); cleanup(t, docs)
  applyCellDelta(docs[0], 'r1', 'name', { index: 0, deleteCount: 0, insert: 'A' })
  applyCellDelta(docs[1], 'r1', 'name', { index: 0, deleteCount: 0, insert: 'B' })
  edits(docs[0], ws => { ws.rows[1].cells.note = '학생 질문 카드' })
  edits(docs[1], ws => { ws.review = '주민 설명회' })
  exchange(docs)
  assert.match(getCellText(docs[0], 'r1', 'name').toString(), /^(AB|BA)폭염 지도$/)
  assert.equal(workspaceToJSON(docs[0]).rows[1].cells.note, '학생 질문 카드')
  assert.equal(workspaceToJSON(docs[0]).review, '주민 설명회')
})

test('R1: 한글·emoji 편집은 바뀐 범위만 처리하며 동일 snapshot replace-all은 완전 no-op', t => {
  const [doc] = replicas(1); cleanup(t, [doc])
  const text = getCellText(doc, 'r1', 'name'), changes = []
  text.observe(event => changes.push(event.delta))
  edits(doc, ws => { ws.rows[0].cells.name = '폭염 그늘 지도' })
  assert.equal(getCellText(doc, 'r1', 'name'), text)
  assert.deepEqual(changes[0], [{ retain: 3 }, { insert: '그늘 ' }])
  let updates = 0; doc.on('update', () => updates++)
  applyWorkspacePatch(doc, { type: 'replace-all', workspace: workspaceToJSON(doc) })
  assert.equal(updates, 0)
  assert.deepEqual(textDelta('🌞자료', '🌳자료'), { index: 0, deleteCount: 2, insert: '🌳' })
})

test('R1: before→next에서 손대지 않은 셀·map 키는 새 원격 값을 덮지 않는다', t => {
  const [doc] = replicas(1); cleanup(t, [doc])
  const before = workspaceToJSON(doc), next = structuredClone(before)
  applyWorkspacePatch(doc, { type: 'update-meta', field: 'review', value: '원격 수정됨' })
  next.rows[0].cells.name += ' 학생 조사'
  applyWorkspaceDiff(doc, before, next)
  assert.equal(workspaceToJSON(doc).review, '원격 수정됨')
})

test('R1: 행·블록 재정렬 후 순서가 실제로 바뀌고 기존 Y.Map/Y.Text 객체는 유지된다', t => {
  const [doc] = replicas(1); cleanup(t, [doc])
  const row = doc.getMap('workspace').get('rows').get(0), cell = getCellText(doc, 'r1', 'name'), blockCell = getCellText(doc, 's1', 'a', 'b2')
  edits(doc, ws => ws.rows.reverse())
  applyWorkspacePatch(doc, { type: 'reorder-blocks', blockIds: ['b2', 'b1'] })
  assert.deepEqual(workspaceToJSON(doc).rows.map(row => row.id), ['r2', 'r1'])
  assert.deepEqual(workspaceToJSON(doc).blocks.map(block => block.id), ['b2', 'b1'])
  assert.equal(doc.getMap('workspace').get('rows').get(0), row)
  assert.equal(getCellText(doc, 'r1', 'name'), cell)
  assert.equal(getCellText(doc, 's1', 'a', 'b2'), blockCell)
})

test('R1: 같은 두 행 사이 동시 삽입도 모든 안정ID를 한 번씩 표시하고 순서가 수렴한다', t => {
  const docs = replicas(); cleanup(t, docs)
  edits(docs[0], ws => ws.rows.splice(1, 0, { id: 'new-a', cells: { name: '학생 역할 A', note: '' } }))
  edits(docs[1], ws => ws.rows.splice(1, 0, { id: 'new-b', cells: { name: '학생 역할 B', note: '' } }))
  exchange(docs)
  const ids = workspaceToJSON(docs[0]).rows.map(row => row.id)
  assert.equal(ids[0], 'r1'); assert.equal(ids.at(-1), 'r2')
  assert.deepEqual(new Set(ids), new Set(['r1', 'new-a', 'new-b', 'r2']))
  assert.equal(ids.length, 4)
})

test('R1: 행 삭제와 다른 행 동시 삽입·편집은 삭제한 행을 되살리지 않는다', t => {
  const docs = replicas(); cleanup(t, docs)
  applyWorkspacePatch(docs[0], { type: 'delete-row', rowId: 'r1' })
  applyWorkspacePatch(docs[1], { type: 'add-row', row: { id: 'r3', cells: { name: '새 조사', note: '' } } })
  edits(docs[1], ws => { ws.rows[0].cells.name += ' 원격 입력' })
  exchange(docs)
  assert.deepEqual(new Set(workspaceToJSON(docs[0]).rows.map(row => row.id)), new Set(['r2', 'r3']))
})

test('R1: IME view Doc은 원격 update를 지연해도 조합 입력·원격 입력 모두 보존한다', t => {
  const [provider, other] = replicas(), view = new Y.Doc(); cleanup(t, [provider, other, view])
  Y.applyUpdate(view, Y.encodeStateAsUpdate(provider))
  const localOrigin = Symbol('view'), remoteOrigin = Symbol('provider'), queued = []
  view.on('update', (update, origin) => { if (origin !== remoteOrigin) Y.applyUpdate(provider, update, localOrigin) })
  provider.on('update', (update, origin) => { if (origin !== localOrigin) queued.push(update) })
  edits(view, ws => { ws.rows[0].cells.name += ' 조' })
  edits(other, ws => { ws.rows[0].cells.name = '우리 ' + ws.rows[0].cells.name })
  Y.applyUpdate(provider, Y.encodeStateAsUpdate(other))
  assert.equal(getCellText(view, 'r1', 'name').toString(), '폭염 지도 조')
  edits(view, ws => { ws.rows[0].cells.name = '폭염 지도 조사' })
  for (const update of queued) Y.applyUpdate(view, update, remoteOrigin)
  assert.equal(getCellText(view, 'r1', 'name').toString(), '우리 폭염 지도 조사')
  assert.deepEqual(workspaceToJSON(view), workspaceToJSON(provider))
})

test('R1: 보조 표·메타·열 변경 patch 호환성과 blocks 제외 동작', t => {
  const [doc] = replicas(1); cleanup(t, [doc])
  applyWorkspacePatch(doc, { type: 'add-column', column: { id: 'new', label: '근거' } })
  assert.ok(getCellText(doc, 'r1', 'new') instanceof Y.Text)
  applyWorkspacePatch(doc, { type: 'update-column', columnId: 'new', label: '출처', color: '#123456' })
  applyWorkspacePatch(doc, { type: 'update-cell', rowId: 'r1', columnId: 'new', value: '주민 인터뷰' })
  applyWorkspacePatch(doc, { type: 'update-meta', field: 'review', value: '완료' })
  assert.equal(workspaceToJSON(doc).columns.at(-1).label, '출처')
  assert.equal(getCellText(doc, 'r1', 'new').toString(), '주민 인터뷰')
  applyWorkspacePatch(doc, { type: 'delete-column', columnId: 'new' })
  assert.equal(getCellText(doc, 'r1', 'new'), undefined)
  const excluded = new Y.Doc(); cleanup(t, [excluded]); seedWorkspace(excluded, json(), { excludeFields: ['blocks'] })
  assert.equal(workspaceToJSON(excluded).blocks, undefined)
  applyWorkspacePatch(excluded, { type: 'upsert-block', block: { id: 'mine', type: 'paragraph', content: '덮으면 안 됨' } }, { excludeFields: ['blocks'] })
  assert.equal(workspaceToJSON(excluded).blocks, undefined)
})

class MemoryStorage {
  values = new Map()
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}
class MemoryProject {
  constructor(extra = {}) { this.data = { createdBy: 'a', memberUids: ['a', 'b'], trainingMode: { enabled: true }, currentCycle: 1, ...extra } }
  offline = false; listeners = new Set(); serial = Promise.resolve(); writes = []; starts = []; hold = null
  transport = {
    transact: change => {
      const job = this.serial.then(async () => {
        this.starts.push(Date.now())
        if (this.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' })
        if (this.hold) await this.hold
        const result = change(structuredClone(this.data))
        if (Object.keys(result.updates).length) {
          for (const [path, value] of Object.entries(result.updates)) {
            const keys = path.split('.'); let target = this.data
            for (const key of keys.slice(0, -1)) target = target[key] ??= {}
            target[keys.at(-1)] = structuredClone(value)
          }
          this.writes.push(structuredClone(result.updates))
          for (const listener of this.listeners) listener(structuredClone(this.data))
        }
        return result.value
      })
      this.serial = job.catch(() => {})
      return job
    },
    subscribe: (next) => { this.listeners.add(next); next(structuredClone(this.data)); return () => this.listeners.delete(next) },
  }
  connect(uid = 'a', extra = {}) { return connectWorkspace({ projectId: 'test', workspaceField: 'teamRulesWorkspace', initialWorkspace: json(), transport: this.transport, uid, storage: new MemoryStorage(), retryMs: 10_000, ...extra }) }
}
function connections(t, providers) { t.after(async () => { await Promise.allSettled(providers.map(provider => provider.destroy())) }) }

test('R1 provider: 동시 seed는 transaction 단일화되고 두 클라이언트가 같은 CRDT를 편집한다', async t => {
  const server = new MemoryProject(), a = server.connect('a'), b = server.connect('b'); connections(t, [a, b])
  await Promise.all([a.ready, b.ready])
  assert.equal(server.writes.length, 1)
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '우리 폭염 지도' })
  b.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '폭염 지도 보기' })
  await Promise.all([a.flush(), b.flush()])
  assert.equal(a.getWorkspace().rows[0].cells.name, '우리 폭염 지도 보기')
  assert.deepEqual(a.getWorkspace(), b.getWorkspace())
  assert.equal(server.data.teamRulesWorkspace.rows[0].cells.name, '우리 폭염 지도 보기')
  const writes = server.writes.length
  a.applyPatch({ type: 'replace-all', workspace: a.getWorkspace() }); await a.flush()
  assert.equal(server.writes.length, writes)
})

test('R1 provider: 연속 입력은 debounce되지 않고 250ms throttle로 입력 중에도 전송한다', async t => {
  const server = new MemoryProject(), a = server.connect(); connections(t, [a]); await a.ready
  const start = Date.now(), before = server.starts.length
  for (let i = 0; i < 9; i++) { a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: `입력${i}` }); await wait(70) }
  assert.equal(WORKSPACE_THROTTLE_MS, 250)
  assert.ok(server.starts.length >= before + 2, '연속 입력 도중에도 두 번 이상 전송')
  assert.ok(server.starts[before] - start < 450, '첫 입력 후 제한된 시간 안에 전송 시작')
  await a.flush(); assert.equal(server.data.teamRulesWorkspace.rows[0].cells.name, '입력8')
})

test('R1 provider: 저장 도중 새 입력도 flush가 기다려 모두 저장한다', async t => {
  const server = new MemoryProject(), a = server.connect(); connections(t, [a]); await a.ready
  let release; server.hold = new Promise(resolve => { release = resolve })
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '첫 입력' })
  const saving = a.flush(); await wait(5)
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '첫 입력 이어서' })
  release(); server.hold = null; await saving
  assert.equal(server.data.teamRulesWorkspace.rows[0].cells.name, '첫 입력 이어서')
})

test('R1 provider: 두 오프라인 탭 백업은 서로 덮지 않고 닫기·재연결 후 모든 입력을 복구한다', async t => {
  const server = new MemoryProject(), storage = new MemoryStorage(), status = []
  const a = server.connect('a', { storage, onStatus: value => status.push(value) }), b = server.connect('a', { storage })
  await Promise.all([a.ready, b.ready]); server.offline = true
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '우리 폭염 지도' })
  b.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '폭염 지도 보기' })
  await Promise.allSettled([a.flush(), b.flush()])
  assert.equal(storage.length, 2); assert.ok(status.includes('offline'))
  await Promise.allSettled([a.destroy(), b.destroy()]); assert.equal(storage.length, 2)
  server.offline = false
  const restored = server.connect('a', { storage }); connections(t, [restored]); await restored.ready; await restored.flush()
  assert.equal(restored.getWorkspace().rows[0].cells.name, '우리 폭염 지도 보기')
  assert.equal(storage.length, 0)
})

test('R1 provider: 초기 오프라인은 ready를 거짓 성공시키지 않고 재접속하면 seed·ready를 완료한다', async t => {
  const server = new MemoryProject(); server.offline = true
  const a = server.connect('a', { retryMs: 15 }); connections(t, [a]); let ready = false
  void a.ready.then(() => { ready = true }); await wait(10); assert.equal(ready, false)
  server.offline = false; await a.ready
  assert.equal(ready, true); assert.equal(server.writes.length, 1)
})

test('R1 provider: T-1-2 blocks는 seed·patch에서 제외하고 flush/getWorkspace는 최신 서버 본문을 보존한다', async t => {
  const initial = json(), server = new MemoryProject({ lessonDesignDirectionWorkspace: initial })
  const a = server.connect('a', { workspaceField: 'lessonDesignDirectionWorkspace', excludeFields: ['blocks'] }); connections(t, [a]); await a.ready
  assert.equal(workspaceToJSON(a.ydoc).blocks, undefined)
  const freshBlocks = [{ id: 'new-body', type: 'paragraph', content: '별도 본문 provider의 최신 입력' }]
  server.data.lessonDesignDirectionWorkspace.blocks = freshBlocks
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '본문과 독립' }); await a.flush()
  assert.deepEqual(a.getWorkspace().blocks, freshBlocks)
  assert.deepEqual(server.data.lessonDesignDirectionWorkspace.blocks, freshBlocks)
  server.data.lessonDesignDirectionWorkspace.blocks = [...freshBlocks, { id: 'later', type: 'paragraph', content: '추가 본문' }]
  await a.flush(); assert.deepEqual(a.getWorkspace().blocks, server.data.lessonDesignDirectionWorkspace.blocks)
})

test('R1 provider: 주기 변경 후 이전 입력을 새 주기로 보내지 않고 백업도 주기별로 분리한다', async t => {
  const server = new MemoryProject(), storage = new MemoryStorage(), a = server.connect('a', { storage }); await a.ready
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '이전 주기 입력' })
  server.data.currentCycle = 2
  await assert.rejects(a.flush(), /주기/); await assert.rejects(a.destroy(), /주기/)
  assert.equal(storage.length, 1)
  server.data.teamRulesWorkspace = json()
  const next = server.connect('a', { storage, cycle: 2 }); connections(t, [next]); await next.ready; await next.flush()
  assert.equal(next.getWorkspace().rows[0].cells.name, '폭염 지도')
  assert.equal(storage.length, 1)
})

test('R1 provider: 일반 모드·비멤버·다른 주기의 접속을 거절하고 프로젝트에 쓰지 않는다', async () => {
  for (const [extra, uid, options, message] of [[{ trainingMode: { enabled: false } }, 'a', {}, /연수용/], [{}, 'intruder', {}, /팀원/], [{ currentCycle: 2 }, 'a', { cycle: 1 }, /주기/]]) {
    const server = new MemoryProject(extra), p = server.connect(uid, options)
    await assert.rejects(p.ready, message); assert.equal(server.writes.length, 0); await p.destroy()
  }
})

test('R1 provider: 개별 state·전체 프로젝트 UTF-8 용량을 제한하고 실패한 입력을 지우지 않는다', async t => {
  const server = new MemoryProject(), storage = new MemoryStorage(), a = server.connect('a', { storage, maxStateBytes: 5000 }); connections(t, [a]); await a.ready
  const previous = structuredClone(server.data.teamRulesWorkspace)
  a.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '기록'.repeat(6000) })
  await assert.rejects(a.flush(), /표 편집 용량/)
  assert.equal(a.getWorkspace().rows[0].cells.name.length, 12000)
  assert.deepEqual(server.data.teamRulesWorkspace, previous); assert.equal(storage.length, 1)
  const oversized = new MemoryProject({ artifacts: { text: '한'.repeat(300_000) } }), b = oversized.connect(); connections(t, [b])
  await assert.rejects(b.ready, /프로젝트 저장 용량/); assert.equal(oversized.writes.length, 0)
  assert.ok(estimateProjectBytes({ text: '한'.repeat(10) }) > 30)
})

test('R1 provider: destroy는 구독·예약을 정리하고 마지막 입력을 저장하며 동일 호출은 같은 promise다', async () => {
  const server = new MemoryProject(), p = server.connect(); await p.ready
  let notices = 0; const unsubscribe = p.subscribe(() => notices++)
  p.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '닫기 직전' }); assert.ok(notices > 0)
  unsubscribe(); const closing = p.destroy(); assert.equal(p.destroy(), closing); await closing
  assert.equal(server.data.teamRulesWorkspace.rows[0].cells.name, '닫기 직전')
  assert.equal(server.listeners.size, 0)
  assert.throws(() => p.applyPatch({ type: 'delete-row', rowId: 'r1' }), /연결/)
})

test('R1 provider: transaction 병합은 다른 workspace CRDT·제어 필드를 그대로 보존한다', () => {
  const project = { currentCycle: 1, artifacts: { immutable: { text: '확정 유지' } }, [WORKSPACE_CRDT_FIELD]: { teamVisionWorkspace: { version: 1, cycle: 1, state: 'existing' } } }
  const result = mergeWorkspaceTransaction(project, { workspaceField: 'teamRulesWorkspace', initialWorkspace: json() }, 1)
  assert.deepEqual(Object.keys(result.updates).sort(), ['coeditWorkspaceCrdt.teamRulesWorkspace', 'teamRulesWorkspace'])
  assert.equal(project[WORKSPACE_CRDT_FIELD].teamVisionWorkspace.state, 'existing')
  assert.equal(project.artifacts.immutable.text, '확정 유지')
})

test('R1 provider: seed transaction 재실행은 이미 승리한 seed를 사용하고 두 번째 초기 JSON을 주입하지 않는다', () => {
  const options = { workspaceField: 'teamRulesWorkspace', initialWorkspace: json() }
  const losingSeed = mergeWorkspaceTransaction({}, options, 1)
  const winnerSeed = mergeWorkspaceTransaction({}, { ...options, initialWorkspace: { ...json(), review: '먼저 참여한 교사' } }, 1)
  const project = { [WORKSPACE_CRDT_FIELD]: { teamRulesWorkspace: winnerSeed.updates['coeditWorkspaceCrdt.teamRulesWorkspace'] }, teamRulesWorkspace: winnerSeed.updates.teamRulesWorkspace }
  const retried = mergeWorkspaceTransaction(project, options, 1)
  assert.equal(retried.value.workspace.review, '먼저 참여한 교사')
  assert.equal(Object.keys(retried.updates).length, 0)
  assert.notDeepEqual(losingSeed.value.state, retried.value.state)
})

test('R1 provider: 편집 중 state가 제거돼도 빈 flush로 몰래 재seed하지 않는다', async t => {
  const server = new MemoryProject(), p = server.connect(); connections(t, [p]); await p.ready
  const count = server.writes.length
  delete server.data[WORKSPACE_CRDT_FIELD].teamRulesWorkspace
  await assert.rejects(p.flush(), /편집 기준/)
  assert.equal(server.writes.length, count)
})

test('R1 provider: 브라우저 임시 저장 실패 시 메모리 입력은 남고 연결 복구 후 저장할 수 있다', async t => {
  const server = new MemoryProject(), storage = new MemoryStorage(), statuses = []
  storage.setItem = () => { throw new Error('QuotaExceededError') }
  const p = server.connect('a', { storage, onStatus: (...args) => statuses.push(args) }); connections(t, [p]); await p.ready
  server.offline = true
  p.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value: '메모리에는 남아요' })
  await assert.rejects(p.flush(), /offline/)
  assert.equal(p.getWorkspace().rows[0].cells.name, '메모리에는 남아요')
  assert.ok(statuses.some(([state, detail]) => state === 'error' && /임시 저장 공간/.test(detail)))
  server.offline = false; await p.flush()
  assert.equal(server.data.teamRulesWorkspace.rows[0].cells.name, '메모리에는 남아요')
})

test('R1 provider: 여러 보조 표와 세 클라이언트의 연속 동시 입력은 중복 없이 수렴한다', t => {
  const docs = replicas(3); cleanup(t, docs)
  for (let i = 0; i < 15; i++) for (let client = 0; client < docs.length; client++) {
    const text = getCellText(docs[client], 's1', 'a', 'b2')
    text.insert(text.length, ` 교사${client}-${i}`)
  }
  exchange(docs)
  const content = getCellText(docs[0], 's1', 'a', 'b2').toString()
  for (let i = 0; i < 15; i++) for (let client = 0; client < docs.length; client++) assert.equal([...content.matchAll(new RegExp(` 교사${client}-${i}(?= |$)`, 'g'))].length, 1)
})

test('R1 seed: 기본 열·빈 셀뿐인 legacy 초안은 정규화한 산출물 초기 내용을 사용한다', () => {
  const options = { workspaceField: 'teamRulesWorkspace', initialWorkspace: json() }
  for (const blank of [{ columns: json().columns }, { columns: json().columns, rows: [{ id: 'blank', cells: { name: '', note: '  ' } }], blocks: [], updatedBy: '교사', updatedAt: 123 }]) {
    const result = mergeWorkspaceTransaction({ teamRulesWorkspace: blank }, options, 1)
    assert.equal(result.value.workspace.rows[0].cells.name, '폭염 지도')
    assert.equal(result.value.workspace.review, '학생 질문')
  }
  const existing = { ...json(), review: '기존 공동 초안' }
  assert.equal(mergeWorkspaceTransaction({ teamRulesWorkspace: existing }, options, 1).value.workspace.review, '기존 공동 초안')
})

test('R1 seed: 이미 CRDT 상태가 있으면 빈 legacy와 다른 초기 산출물을 무시하고 기존 상태를 권위로 삼는다', () => {
  const blank = { columns: json().columns, rows: [], blocks: [], review: '' }
  const options = { workspaceField: 'teamRulesWorkspace', initialWorkspace: blank }
  const seeded = mergeWorkspaceTransaction({}, options, 1)
  const project = { [WORKSPACE_CRDT_FIELD]: { teamRulesWorkspace: seeded.updates['coeditWorkspaceCrdt.teamRulesWorkspace'] }, teamRulesWorkspace: blank }
  const later = mergeWorkspaceTransaction(project, { ...options, initialWorkspace: json() }, 1)
  assert.equal(later.value.workspace.rows.length, 0)
  assert.equal(later.value.workspace.review, '')
  assert.equal(Object.keys(later.updates).length, 0)
})

test('R1 seed: 본문 provider의 blocks가 있어도 제외된 표 초안이 비었으면 산출물 표를 사용한다', () => {
  const body = [{ id: 'body', type: 'paragraph', content: '이미 공동 작성 중인 본문' }]
  const legacy = { columns: json().columns, rows: [], blocks: body }
  const result = mergeWorkspaceTransaction({ lessonDesignDirectionWorkspace: legacy }, { workspaceField: 'lessonDesignDirectionWorkspace', initialWorkspace: json(), excludeFields: ['blocks'] }, 1)
  assert.equal(result.value.workspace.rows[0].cells.name, '폭염 지도')
  assert.deepEqual(result.value.workspace.blocks, body)
})

test('R1 provider: 손상되거나 알 수 없는 같은 주기 CRDT state를 legacy JSON으로 덮어 초기화하지 않는다', async () => {
  for (const entry of [{ version: 1, cycle: 1, state: 'not-valid-!' }, { version: 2, cycle: 1, state: 'future-version' }]) {
    const server = new MemoryProject({ [WORKSPACE_CRDT_FIELD]: { teamRulesWorkspace: entry } }), p = server.connect()
    await assert.rejects(p.ready, /저장 상태|저장 형식/)
    assert.equal(server.writes.length, 0)
    assert.deepEqual(server.data[WORKSPACE_CRDT_FIELD].teamRulesWorkspace, entry)
    await p.destroy()
  }
})

// Production adapter를 그대로 쓰고 Firebase SDK의 I/O만 대체한다.
function firestoreHarness(server) {
  let listener, failure, options, stopped = false
  const sdk = {
    doc: () => ({ id: 'test' }),
    serverTimestamp: () => 123,
    async runTransaction(_db, change) {
      if (server.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' })
      const updates = {}
      const result = await change({
        get: async () => ({ exists: () => true, data: () => structuredClone(server.data) }),
        update: (_ref, values) => Object.assign(updates, values),
      })
      for (const [path, value] of Object.entries(updates)) {
        const keys = path.split('.'); let target = server.data
        for (const key of keys.slice(0, -1)) target = target[key] ??= {}
        target[keys.at(-1)] = structuredClone(value)
      }
      return result
    },
    onSnapshot(_ref, listenOptions, next, error) {
      options = listenOptions; listener = next; failure = error
      return () => { stopped = true }
    },
  }
  return {
    transport: firestoreTransport('test', sdk, {}),
    get options() { return options },
    emit(data = server.data, metadata = {}, exists = true, metadataOnly = false) {
      if (stopped || (metadataOnly && !options.includeMetadataChanges)) return
      listener({ exists: () => exists, data: () => structuredClone(data), metadata: { fromCache: false, hasPendingWrites: false, ...metadata } })
    },
    fail(error) { failure(error) },
  }
}

test('R1 Firestore adapter: ready 후 seed 없는 캐시 → pending → 동일 data의 metadata-only 서버 ack는 오류 없이 병합한다', async t => {
  const server = new MemoryProject(), stale = structuredClone(server.data), harness = firestoreHarness(server), statuses = []
  const p = server.connect('a', { transport: harness.transport, onStatus: (...args) => statuses.push(args) }); connections(t, [p]); await p.ready
  assert.equal(harness.options.includeMetadataChanges, true)
  const before = p.getWorkspace()
  // 과거 캐시가 프로젝트 자체를 찾지 못하거나 seed를 갖고 있지 않아도 권위 오류가 아니다.
  harness.emit(stale, { fromCache: true }, false)
  harness.emit(stale, { fromCache: true })
  const remote = new Y.Doc(); t.after(() => remote.destroy())
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(p.ydoc))
  applyWorkspacePatch(remote, { type: 'update-cell', rowId: 'r1', columnId: 'name', value: '서버 확정 기록' })
  const result = mergeWorkspaceTransaction(server.data, { workspaceField: 'teamRulesWorkspace', initialWorkspace: json() }, 1, Y.encodeStateAsUpdate(remote))
  const ack = { ...server.data, teamRulesWorkspace: result.value.workspace,
    [WORKSPACE_CRDT_FIELD]: { teamRulesWorkspace: result.updates['coeditWorkspaceCrdt.teamRulesWorkspace'] } }
  harness.emit(ack, { hasPendingWrites: true })
  assert.deepEqual(p.getWorkspace(), before, 'pending 데이터를 원격 상태로 적용하지 않음')
  harness.emit(ack, {}, true, true)
  assert.equal(p.getWorkspace().rows[0].cells.name, '서버 확정 기록')
  assert.equal(statuses.at(-1)[0], 'saved')
  assert.equal(statuses.some(([status]) => status === 'error'), false)
})

test('R1 Firestore adapter: 캐시의 권한·주기 불일치는 건너뛰지만 확정된 서버의 seed 삭제·주기·권한 오류는 유지한다', async t => {
  for (const kind of ['missing', 'cycle', 'permission']) {
    const server = new MemoryProject(), harness = firestoreHarness(server), statuses = []
    const p = server.connect('a', { transport: harness.transport, onStatus: (...args) => statuses.push(args) }); connections(t, [p]); await p.ready
    const invalid = structuredClone(server.data)
    if (kind === 'missing') delete invalid[WORKSPACE_CRDT_FIELD].teamRulesWorkspace
    if (kind === 'cycle') invalid.currentCycle = 2
    if (kind === 'permission') { invalid.createdBy = 'other'; invalid.memberUids = [] }
    harness.emit(invalid, { fromCache: true })
    harness.emit(invalid, { hasPendingWrites: true })
    assert.equal(statuses.at(-1)[0], 'saved')
    harness.emit(invalid)
    assert.equal(statuses.at(-1)[0], 'error', kind)
    assert.match(statuses.at(-1)[1], kind === 'missing' ? /편집 상태/ : kind === 'cycle' ? /주기/ : /팀원/)
  }
})

test('R1 Firestore adapter: 서버 문서 삭제·리스너 permission-denied·손상 state 오류를 감추지 않는다', async t => {
  for (const kind of ['deleted', 'listener', 'corrupt']) {
    const server = new MemoryProject(), harness = firestoreHarness(server), statuses = []
    const p = server.connect('a', { transport: harness.transport, onStatus: (...args) => statuses.push(args) }); connections(t, [p]); await p.ready
    if (kind === 'deleted') harness.emit({}, {}, false)
    if (kind === 'listener') harness.fail(Object.assign(new Error('permission denied'), { code: 'permission-denied' }))
    if (kind === 'corrupt') {
      const invalid = structuredClone(server.data)
      invalid[WORKSPACE_CRDT_FIELD].teamRulesWorkspace.state = 'not-valid-!'
      harness.emit(invalid)
    }
    assert.equal(statuses.at(-1)[0], 'error', kind)
  }
})

test('R1 Firestore adapter: 정상 서버 snapshot도 용량 초과·저장 실패 상태와 미전송 입력을 덮지 않는다', async t => {
  for (const kind of ['capacity', 'offline']) {
    const server = new MemoryProject(), harness = firestoreHarness(server), statuses = [], storage = new MemoryStorage()
    const p = server.connect('a', { transport: harness.transport, maxStateBytes: 5000, storage, onStatus: (...args) => statuses.push(args) }); connections(t, [p]); await p.ready
    const value = kind === 'capacity' ? '기록'.repeat(6000) : '아직 저장 못 한 입력'
    p.applyPatch({ type: 'update-cell', rowId: 'r1', columnId: 'name', value })
    if (kind === 'offline') server.offline = true
    await assert.rejects(p.flush(), kind === 'capacity' ? /표 편집 용량/ : /offline/)
    const last = statuses.at(-1)
    harness.emit(server.data)
    assert.deepEqual(statuses.at(-1), last, '정상 snapshot은 오류를 saved로 덮지 않음')
    assert.equal(p.getWorkspace().rows[0].cells.name, value)
    assert.equal(storage.length, 1)
  }
})

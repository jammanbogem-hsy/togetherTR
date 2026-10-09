import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as model from '../src/lib/admin/consoleModel.ts'
import { ACTIVITY_META } from '../src/types/index.ts'

const routeSource = fs.readFileSync(new URL('../src/app/api/admin/console/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const adminToken = { uid: 'admin', email: 'jammanbogem@gmail.com', email_verified: true }

function harness(seed = {}, users = []) {
  const docs = new Map(Object.entries(seed)); const reads = []; const verification = []; const calls = []
  const ref = path => ({ id: path.split('/').at(-1), path, collection: name => collection(`${path}/${name}`), get: async () => { reads.push(path); return snapshot(path) } })
  const snapshot = path => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => docs.get(path), ref: ref(path) })
  function query(path, max = Infinity, cursor = '') {
    return { select: () => query(path, max, cursor), orderBy: () => query(path, max, cursor), limit: n => query(path, n, cursor), startAfter: value => query(path, max, value),
      get: async () => {
        reads.push(path)
        return { docs: [...docs.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1 && key.split('/').at(-1) > cursor).sort().slice(0, max).map(snapshot) }
      } }
  }
  const collection = path => ({ ...query(path), doc: id => ref(`${path}/${id}`), count: () => ({ get: async () => ({ data: () => ({ count: [...docs.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1).length }) }) }) })
  const db = { collection, getAll: async (...refs) => Promise.all(refs.map(item => item.get())) }
  const tokens = { admin: adminToken, teacher: { uid: 'teacher', email: 'teacher@school.kr', email_verified: true }, unverified: { ...adminToken, email_verified: false } }
  const auth = { verifyIdToken: async (token, revoked) => { verification.push({ token, revoked }); if (!tokens[token]) throw Error('Invalid'); return tokens[token] },
    listUsers: async (limit, cursor) => { calls.push({ limit, cursor }); const offset = Number(cursor) || 0; return { users: users.slice(offset, offset + limit), pageToken: users.length > offset + limit ? String(offset + limit) : undefined } } }
  const context = { exports: {}, Response, URL, console, require: name => name === '@/lib/firebase/admin' ? { getAdminAuth: () => auth, getAdminDb: () => db } : name === '@/lib/admin/consoleModel' ? model : name === '@/types' ? { ACTIVITY_META } : {} }
  vm.runInNewContext(compiled, context)
  const get = async (query = '', token = 'admin') => context.exports.GET(new Request(`http://localhost/api/admin/console?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
  return { get, docs, reads, verification, calls, exports: context.exports }
}

test('all project/member/detail/chat reads require a verified owner token; revoked-token checks and no cache', async () => {
  const h = harness()
  for (const query of ['view=projects', 'view=members', 'view=project&id=p1', 'view=messages&id=p1&activity=T-1-1']) {
    for (const [token, status] of [['', 401], ['invalid', 401], ['teacher', 403], ['unverified', 403]]) {
      const response = await h.get(query, token)
      assert.equal(response.status, status)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
    }
  }
  assert.equal(h.reads.length, 0)
  assert.equal(h.calls.length, 0)
  assert.ok(h.verification.every(call => call.revoked === true))
  assert.equal(model.isSuperAdmin({ ...adminToken, email: 'JammanBogem@gmail.com' }), true)
  assert.equal(model.isSuperAdmin({ ...adminToken, email: 'jammanbogem@gmail.com.evil' }), false)
  assert.equal(h.exports.POST, undefined); assert.equal(h.exports.PATCH, undefined); assert.equal(h.exports.DELETE, undefined)
})

test('project pagination includes other owners, archived and legacy projects without timestamps; viewer does not join or mutate', async () => {
  const projects = Object.fromEntries(Array.from({ length: 53 }, (_, i) => [`projects/p${String(i).padStart(2, '0')}`, { title: `Project ${i}`, createdBy: 'teacher', status: i % 2 ? 'archived' : 'active', inviteCode: 'PRIVATE', artifacts: { secret: 'not list data' } }]))
  const h = harness({ ...projects, 'users/teacher': { displayName: '다른 선생님' } })
  const before = JSON.stringify([...h.docs])
  const first = await (await h.get('view=projects')).json()
  assert.equal(first.total, 53); assert.equal(first.items.length, 50); assert.equal(first.nextCursor, 'p49')
  assert.equal(first.items[0].ownerName, '다른 선생님'); assert.equal(first.items[0].createdAt, null)
  assert.equal(first.items[0].inviteCode, undefined); assert.equal(first.items[0].artifacts, undefined)
  const second = await (await h.get(`view=projects&cursor=${first.nextCursor}`)).json()
  assert.equal(second.items.length, 3); assert.equal(second.nextCursor, null)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 53)
  assert.equal(JSON.stringify([...h.docs]), before)
})

test('member directory combines all Auth accounts with optional profiles, including incomplete profiles, with no secrets in response', async () => {
  const users = Array.from({ length: 51 }, (_, i) => ({ uid: `u${i}`, email: `t${i}@school.kr`, displayName: 'Auth 이름', emailVerified: true, disabled: i === 50, passwordHash: 'NEVER_EXPOSE', tokensValidAfterTime: 'NEVER_EXPOSE', metadata: { creationTime: '2026-10-01T00:00:00Z', lastSignInTime: '2026-10-09T00:00:00Z' } }))
  const h = harness({ 'users/u0': { displayName: '교사 프로필 이름', schoolName: '테스트초', grade: '3학년', folders: ['PRIVATE'] } }, users)
  const first = await (await h.get('view=members')).json()
  assert.equal(first.items.length, 50); assert.equal(first.nextCursor, '50')
  assert.equal(first.items[0].name, '교사 프로필 이름'); assert.equal(first.items[0].school, '테스트초')
  assert.equal(first.items[1].hasProfile, false)
  assert.doesNotMatch(JSON.stringify(first), /NEVER_EXPOSE|PRIVATE|passwordHash|tokensValidAfterTime/)
  const last = await (await h.get('view=members&cursor=50')).json()
  assert.equal(last.items.length, 1); assert.equal(last.items[0].disabled, true); assert.equal(last.nextCursor, null)
})

test('project detail preserves saved artifacts/reports but excludes invite code, drafts, and mutable team controls', async () => {
  const h = harness({ 'projects/p1': { title: '학교 프로젝트', createdBy: 't1', hostUid: 't1', memberUids: ['t1'], memberInfo: { t1: { displayName: '교사', role: '기록', color: '#000' } }, inviteCode: 'SECRET', artifacts: { 'T-1-1': { title: '공동 비전', status: 'confirmed', content: { 비전: '함께 탐구' }, versions: [{ content: 'old' }] } }, stageReports: { T: { content: '# 보고서' } }, curriculumSheetPresence: { private: true } } })
  const response = await h.get('view=project&id=p1'); assert.equal(response.status, 200)
  const data = await response.json(); assert.equal(data.artifacts['T-1-1'].content.비전, '함께 탐구')
  assert.equal(data.reports[0].content, '# 보고서'); assert.equal(data.members[0].name, '교사')
  assert.equal(data.inviteCode, undefined); assert.equal(data.curriculumSheetPresence, undefined)
  assert.equal((await h.get('view=project&id=missing')).status, 404)
  assert.equal((await h.get('view=project&id=..%2Fusers')).status, 400)
})

test('conversation pagination keeps activity and cycle boundaries, legacy compatibility, and distinct-path duplicate preference', async () => {
  const seed = { 'projects/p1': { currentCycle: 2 } }
  for (let i = 0; i < 102; i++) seed[`projects/p1/conversations/T-1-1/messages/m${String(i).padStart(3, '0')}`] = { role: 'user', displayName: '교사', content: String(i), cycleNumber: 2, createdAt: i }
  seed['projects/p1/conversations/T/messages/m000'] = { role: 'user', content: 'old duplicate', activityCode: 'T-1-1', cycleNumber: 2 }
  seed['projects/p1/conversations/T/messages/old'] = { role: 'user', content: 'cycle1', activityCode: 'T-1-1' }
  seed['projects/p1/conversations/T/messages/other'] = { role: 'user', content: 'other activity', activityCode: 'T-2-1', cycleNumber: 2 }
  const h = harness(seed)
  const first = await (await h.get('view=messages&id=p1&activity=T-1-1&cycle=2')).json()
  assert.ok(first.nextCursor); assert.doesNotMatch(JSON.stringify(first.items), /cycle1|other activity/)
  const second = await (await h.get(`view=messages&id=p1&activity=T-1-1&cycle=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json()
  const merged = model.mergeAdminMessages(first.items, second.items)
  assert.equal(merged.length, 102); assert.equal(merged[0].content, '0'); assert.equal(second.nextCursor, null)
  assert.equal(model.mergeAdminMessages(merged, [{ ...merged[0], legacy: true, content: 'stale' }])[0].content, '0')
  const cycle1 = await (await h.get('view=messages&id=p1&activity=T-1-1&cycle=1')).json()
  assert.deepEqual(cycle1.items.map(item => item.content), ['cycle1'])
  assert.equal((await h.get('view=messages&id=p1&activity=__proto__')).status, 400)
  assert.equal((await h.get('view=messages&id=p1&activity=T-1-1&cycle=3')).status, 400)
  assert.equal((await h.get('view=messages&id=p1&activity=T-1-1&cursor=%7Bbad')).status, 400)
})

// Admin console: popup notices + dashboard aggregation.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/adminConsoleNotices.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NOTICE_INBOX_MAX, addToInbox, inboxItems, parseNoticeInput, projectRecipients, removeFromInbox } from '../src/lib/admin/notices.ts'
import { dashboardProject, projectFlags, summarizeDashboard } from '../src/lib/admin/dashboardModel.ts'
import { observerBlocksRequest } from '../src/lib/admin/observer.ts'

test('notice input is validated and cleaned', () => {
  assert.deepEqual(parseNoticeInput({ scope: 'all', target: 'x', title: '  마감  ', body: ' 10분 뒤 공유 ' }), { ok: true, value: { scope: 'all', target: 'all', title: '마감', body: '10분 뒤 공유' } })
  assert.equal(parseNoticeInput({ scope: 'user', target: 'uid_1', body: '안녕' }).value.title, '관리자 알림')
  assert.equal(parseNoticeInput({ scope: 'user', target: '../x', body: '안녕' }).ok, false)
  assert.equal(parseNoticeInput({ scope: 'room', target: 'a', body: '안녕' }).ok, false)
  assert.equal(parseNoticeInput({ scope: 'all', body: '   ' }).ok, false)
  assert.equal(parseNoticeInput({ scope: 'all', body: 'ㄱ'.repeat(1001) }).ok, false)
})

test('inbox keeps unread notices in order, capped, and drops malformed entries', () => {
  let items = []
  for (let i = 0; i < NOTICE_INBOX_MAX + 5; i++) items = addToInbox(items, { id: `n${i}`, title: 't', body: 'b', scope: 'user', createdAt: i })
  assert.equal(items.length, NOTICE_INBOX_MAX)
  assert.equal(items[0].id, 'n5')
  assert.deepEqual(removeFromInbox(items, 'n10').map(item => item.id).includes('n10'), false)
  assert.deepEqual(inboxItems({ items: [{ id: 'a', body: 'x', createdAt: 2, scope: 'project', context: '테스트 방' }, { body: 'no id' }, null, { id: 'b', body: 'y', createdAt: 1 }] }).map(item => [item.id, item.scope, item.title]),
    [['b', 'user', '관리자 알림'], ['a', 'project', '관리자 알림']])
  assert.deepEqual(inboxItems(undefined), [])
})

test('project notices reach every member, the creator and the recorder once', () => {
  assert.deepEqual(projectRecipients({ memberUids: ['a', 'b'], memberInfo: { b: {}, c: {} }, createdBy: 'd', hostUid: 'a' }).sort(), ['a', 'b', 'c', 'd'])
})

test('dashboard flags paused rooms, missing recorders and stale rooms', () => {
  const now = Date.UTC(2026, 9, 10, 3)
  const base = { status: 'active', started: true, createdAt: now - 10 * 86_400_000, memberCount: 3, hostIsMember: true }
  assert.deepEqual(projectFlags({ ...base, updatedAt: now - 5 * 60_000 }, now), [])
  assert.deepEqual(projectFlags({ ...base, updatedAt: now - 45 * 60_000 }, now).map(flag => flag.label), ['45분째 움직임 없음'])
  assert.deepEqual(projectFlags({ ...base, updatedAt: now - 3 * 3_600_000 }, now).map(flag => flag.label), ['3시간째 움직임 없음'])
  assert.deepEqual(projectFlags({ ...base, updatedAt: now - 9 * 86_400_000 }, now).map(flag => flag.kind), ['stale'])
  assert.deepEqual(projectFlags({ ...base, hostIsMember: false, updatedAt: now }, now).map(flag => flag.kind), ['no-recorder'])
  assert.deepEqual(projectFlags({ ...base, status: 'completed', updatedAt: now - 9 * 86_400_000 }, now), [])
  assert.deepEqual(projectFlags({ ...base, started: false, updatedAt: now }, now).map(flag => flag.kind), ['not-started'])
})

test('dashboard rows read artifact marks and reports; summary counts activity windows and stages', () => {
  const now = Date.UTC(2026, 9, 10, 3)
  const row = dashboardProject('p1', {
    title: '연수 방', hostUid: 'a', memberUids: ['a', 'b'], memberInfo: { a: { displayName: '김교사' } }, started: true, status: 'active',
    currentStage: 'A', currentActivity: 'A-1-2', trainingMode: { enabled: true }, updatedAt: now - 10 * 60_000, createdAt: now - 86_400_000,
    artifacts: { 'T-1-1': { status: 'confirmed', version: 2 }, 'T-1-2': { status: 'in_review', version: 1 }, bogus: { status: 'confirmed' } },
    stageReports: { T: { savedAt: now - 3_600_000 } }, cumulativeReport: { savedAt: now },
  }, now)
  assert.deepEqual(row.artifacts, { 'T-1-1': 'confirmed', 'T-1-2': 'saved' })
  assert.deepEqual(row.reports, ['T', 'all'])
  assert.equal(row.hostName, '김교사')
  const stale = dashboardProject('p2', { title: '옛 방', started: true, status: 'active', memberUids: ['x'], hostUid: 'x', currentStage: 'Ds', updatedAt: now - 20 * 86_400_000 }, now)
  const fresh = dashboardProject('p3', { title: '새 방', started: false, memberUids: ['y'], hostUid: 'y', updatedAt: now - 1000, createdAt: now - 1000 }, now)
  const summary = summarizeDashboard([stale, row, fresh], now, { members: 7, messages: 120 })
  assert.equal(summary.totals.projects, 3)
  assert.equal(summary.totals.training, 1)
  assert.equal(summary.totals.activeHour, 2)
  assert.equal(summary.totals.artifacts, 2)
  assert.equal(summary.totals.reports, 2)
  assert.deepEqual([summary.stageCounts.A, summary.stageCounts.Ds, summary.stageCounts.none], [1, 1, 1])
  assert.deepEqual(summary.projects.map(item => item.id), ['p3', 'p1', 'p2'])
  assert.deepEqual(summary.attention.map(item => item.id), ['p2'])
})

test('rules: teachers read only their own inbox and nobody writes it from the client', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8')
  const start = rules.indexOf('match /noticeInbox/{uid} {')
  const block = rules.slice(start, rules.indexOf('\n    }', start))
  assert.match(block, /allow read: if isSignedIn\(\) && request\.auth\.uid == uid;/)
  assert.match(block, /allow write: if false;/)
  assert.doesNotMatch(rules, /match \/adminNotices/)
})

test('observers can still confirm their own notice', () => {
  assert.equal(observerBlocksRequest('/api/notices', 'POST', 'https://togethertr.web.app'), false)
  assert.equal(observerBlocksRequest('/api/admin/notices', 'POST', 'https://togethertr.web.app'), true)
})

test('admin APIs require the verified super admin; mark-read requires any signed-in user', () => {
  for (const file of ['src/app/api/admin/notices/route.ts', 'src/app/api/admin/dashboard/route.ts']) {
    const source = fs.readFileSync(file, 'utf8')
    for (const method of source.matchAll(/export async function (GET|POST|DELETE)\(request: Request\) \{\n  const identity = await (\w+)\(request\)/g)) assert.equal(method[2], 'verifySuperAdminRequest', `${file} ${method[1]}`)
  }
  assert.match(fs.readFileSync('src/app/api/notices/route.ts', 'utf8'), /verifyRequestUser\(request\)/)
  assert.match(fs.readFileSync('src/app/(app)/layout.tsx', 'utf8'), /<AdminNoticePopup \/>/)
})

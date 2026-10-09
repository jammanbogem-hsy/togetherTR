// Super admin observer mode: read-only access to a team's real project screen.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/adminObserver.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isAdminObserver, isProjectParticipant, observerBlocksRequest } from '../src/lib/admin/observer.ts'

const admin = { uid: 'admin', email: 'jammanbogem@gmail.com', emailVerified: true }
const room = { memberUids: ['a', 'b'], createdBy: 'a', hostUid: 'a' }

test('only the verified super admin outside the room is an observer', () => {
  assert.equal(isAdminObserver(room, admin), true)
  assert.equal(isAdminObserver(room, { ...admin, emailVerified: false }), false)
  assert.equal(isAdminObserver(room, { uid: 'x', email: 'someone@example.com', emailVerified: true }), false)
  assert.equal(isAdminObserver({ ...room, memberUids: ['a', 'admin'] }, admin), false)
  assert.equal(isAdminObserver({ memberUids: [], createdBy: 'admin' }, admin), false)
  assert.equal(isAdminObserver(null, admin), false)
  assert.equal(isProjectParticipant(room, 'b'), true)
})

test('observer fetch guard blocks same-origin api writes only', () => {
  const origin = 'https://togethertr.web.app'
  assert.equal(observerBlocksRequest('/api/chat/stream', 'POST', origin), true)
  assert.equal(observerBlocksRequest(`${origin}/api/report`, 'put', origin), true)
  assert.equal(observerBlocksRequest('/api/version', 'GET', origin), false)
  assert.equal(observerBlocksRequest('/api/version', undefined, origin), false)
  assert.equal(observerBlocksRequest('https://firestore.googleapis.com/x', 'POST', origin), false)
  assert.equal(observerBlocksRequest('/_next/data', 'POST', origin), false)
})

test('project page never self-joins an observing admin', () => {
  const page = fs.readFileSync('src/app/(app)/projects/[id]/page.tsx', 'utf8')
  const joinAt = page.indexOf('joinProject(projectId, uid, project.inviteCode')
  const guardAt = page.indexOf('if (isAdminObserver(project, auth.currentUser)) return')
  assert.ok(guardAt > 0 && guardAt < joinAt, 'observer guard must run before the profile join')
})

test('firestore rules give the super admin reads only, never writes', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8')
  assert.match(rules, /function isSuperAdmin\(\)/)
  assert.match(rules, /request\.auth\.token\.email_verified == true/)
  for (const line of rules.split('\n')) {
    if (!line.includes('isSuperAdmin()') || line.includes('function isSuperAdmin')) continue
    assert.match(line, /allow (read|get):/, `super admin may only appear in read rules: ${line.trim()}`)
  }
  assert.doesNotMatch(rules, /allow read, write: if isMember\(pid\) \|\| isSuperAdmin/)
})

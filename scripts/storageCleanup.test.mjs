import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as cleanup from '../src/lib/account/storageCleanup.ts'
import * as deletion from '../src/lib/account/accountDeletion.ts'
import * as consent from '../src/lib/privacy/consentContent.ts'

const queueCollection = cleanup.STORAGE_CLEANUP_COLLECTION
function harness(options = {}) {
  const events = [], records = new Map([
    ['projects/solo', { createdBy: 'user-1', hostUid: 'user-1', memberUids: ['user-1'] }],
    ['users/user-1', { displayName: '사용자' }],
  ])
  const values = { serverTimestamp: () => ({ timestamp: true }), increment: n => ({ increment: n }) }
  const snapshot = key => ({ id: key.split('/').at(-1), exists: records.has(key), data: () => records.get(key) })
  function ref(key) {
    return { id: key.split('/').at(-1), path: key,
      get: async () => snapshot(key),
      update: async patch => {
        assert.ok(records.has(key), `missing ${key}`)
        const value = records.get(key)
        for (const [field, next] of Object.entries(patch)) value[field] = next?.increment ? (value[field] || 0) + next.increment : next
      },
      delete: async () => {
        if (key.startsWith(queueCollection) && options.queueDeleteFails) throw Error('queue-delete-failed')
        events.push(`delete:${key}`); records.delete(key)
      },
      collection: name => collection(`${key}/${name}`),
    }
  }
  function collection(name, filters = [], max = Infinity) {
    return { doc: id => ref(`${name}/${id}`),
      where: (field, op, value) => collection(name, [...filters, [field, op, value]], max),
      limit: n => collection(name, filters, n),
      get: async () => {
        const keys = [...records.keys()].filter(key => key.startsWith(`${name}/`) && !key.slice(name.length + 1).includes('/'))
          .filter(key => filters.every(([field, op, value]) => op === 'array-contains'
            ? records.get(key)[field]?.includes(value) : records.get(key)[field] === value)).slice(0, max)
        return { empty: keys.length === 0, docs: keys.map(snapshot) }
      },
    }
  }
  const db = { collection,
    runTransaction: async fn => {
      const writes = []
      await fn({ get: target => target.get(), set: (target, data) => writes.push([target, data]) })
      for (const [target, data] of writes) {
        if (options.queueWriteFails) throw Error('queue-write-failed')
        events.push(`queue:${target.id}`); records.set(target.path, data)
      }
    },
    recursiveDelete: async target => {
      if (options.projectDeleteFails) throw Error('project-delete-failed')
      events.push(`project:${target.id}`); records.delete(target.path)
    },
  }
  const bucket = { name: 'test-bucket', deleteFiles: async ({ prefix }) => {
    events.push(`storage:${prefix}`)
    if (options.storageFails) throw Error('sensitive SDK error / secret filename')
  } }
  const auth = {
    verifyIdToken: async (token, revoked) => {
      events.push(`verify:${revoked === true}`)
      if (token === 'bad' || options.revoked) throw Error('invalid token')
      return { uid: 'user-1', admin: token === 'admin' }
    },
    getUser: async () => ({ disabled: !!options.disabled, customClaims: { admin: !options.adminRemoved } }),
    deleteUser: async () => { if (options.authFails) throw Error('auth-failed'); events.push('auth:deleted') },
  }
  const admin = { getAdminDb: () => db, getAdminAuth: () => auth, getAdminBucket: () => options.noBucket ? null : bucket, getFieldValue: () => values }
  const stubs = { '@/lib/firebase/admin': admin, '@/lib/account/storageCleanup': cleanup, '@/lib/account/accountDeletion': deletion }
  function load(file) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(js, { module, exports: module.exports, require: name => {
      assert.ok(stubs[name], name); return stubs[name]
    }, Response, Date, console: { error() {}, warn() {} } })
    return module.exports.POST
  }
  const accountPost = load('../src/app/api/account/delete/route.ts')
  const adminPost = load('../src/app/api/admin/storage-cleanup/route.ts')
  async function post(fn, body, token = 'member') {
    const response = await fn(new Request('http://localhost/api/test', { method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }
  return { options, records, events, db, values, bucket,
    withdraw: () => post(accountPost, { confirm: '탈퇴' }),
    retry: (id, token = 'admin') => post(adminPost, { queueId: id }, token),
    queued: () => [...records.entries()].filter(([key]) => key.startsWith(`${queueCollection}/`)),
  }
}

test('A1: durable queue precedes deletion; complete storage cleanup removes hash and paths', async () => {
  const h = harness(), result = await h.withdraw()
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.storageCleanupPending, false)
  assert.equal(h.queued().length, 0)
  assert.ok(h.events.findIndex(e => e.startsWith('queue:')) < h.events.indexOf('project:solo'))
  assert.ok(h.events.indexOf('project:solo') < h.events.indexOf('storage:projects/solo/'))
  assert.ok(h.events.indexOf('storage:projects/solo/') < h.events.indexOf('auth:deleted'))
})

test('A1: Storage failure completes account deletion only with a durable retry record', async () => {
  const h = harness({ storageFails: true }), result = await h.withdraw()
  assert.equal(result.status, 200)
  assert.equal(result.body.storageCleanupPending, true)
  assert.equal(result.body.authDeleted, true)
  assert.equal(h.records.has('users/user-1'), false)
  const [key, record] = h.queued()[0]
  assert.equal(record.uidHash, cleanup.storageCleanupOwnerHash('user-1'))
  assert.deepEqual(record.paths, ['projects/solo/'])
  assert.equal(record.reason, 'storage-delete-failed')
  assert.ok(record.createdAt)
  assert.equal(record.attempts, 1)
  assert.doesNotMatch(JSON.stringify(record), /user-1|displayName|sensitive|secret filename/)
  h.options.storageFails = false
  const retried = await h.retry(key.split('/')[1])
  assert.equal(retried.status, 200)
  assert.equal(retried.body.status, 'deleted')
  assert.equal(h.queued().length, 0)
  assert.equal((await h.retry(key.split('/')[1])).body.status, 'missing')
})

test('A1: missing bucket is pending, never silently treated as clean', async () => {
  const h = harness({ noBucket: true }), result = await h.withdraw()
  assert.equal(result.body.ok, true)
  assert.equal(result.body.storageCleanupPending, true)
  assert.equal(h.queued()[0][1].reason, 'bucket-unavailable')
  h.options.noBucket = false
  assert.equal((await h.retry(h.queued()[0][0].split('/')[1])).body.status, 'deleted')
})

test('A1: queue write failure preserves the project, profile, Auth and Storage', async () => {
  const h = harness({ queueWriteFails: true }), result = await h.withdraw()
  assert.equal(result.status, 500)
  assert.equal(result.body.authDeleted, false)
  assert.equal(h.records.has('projects/solo'), true)
  assert.equal(h.records.has('users/user-1'), true)
  assert.ok(h.events.every(e => e.startsWith('verify:')))
})

test('A1: project deletion failure keeps retry record and blocks administrator Storage deletion', async () => {
  const h = harness({ projectDeleteFails: true }), result = await h.withdraw()
  assert.equal(result.status, 500)
  const id = h.queued()[0][0].split('/')[1]
  assert.equal((await h.retry(id)).status, 409)
  assert.ok(!h.events.some(e => e.startsWith('storage:')))
  const createdAt = h.queued()[0][1].createdAt
  h.options.projectDeleteFails = false
  assert.equal((await h.withdraw()).body.ok, true)
  assert.ok(createdAt)
  assert.equal(h.events.filter(e => e.startsWith('queue:')).length, 1)
})

test('A1: account retry remembers queued files even when earlier run already removed projects', async () => {
  const h = harness({ storageFails: true, authFails: true })
  assert.equal((await h.withdraw()).status, 500)
  assert.equal(h.records.has('projects/solo'), false)
  h.options.authFails = false
  const result = await h.withdraw()
  assert.equal(result.status, 200)
  assert.equal(result.body.storageCleanupPending, true)
})

test('A1: metadata deletion failure leaves a recoverable record after files were removed', async () => {
  const h = harness({ queueDeleteFails: true })
  assert.equal((await h.withdraw()).status, 500)
  assert.equal(h.queued().length, 1)
  assert.equal(h.records.has('users/user-1'), true)
  h.options.queueDeleteFails = false
  assert.equal((await h.retry(h.queued()[0][0].split('/')[1])).status, 200)
})

test('A1: retry requires unrevoked admin token AND current admin claim; ordinary hosts cannot retry', async () => {
  const h = harness({ storageFails: true }); await h.withdraw()
  const id = h.queued()[0][0].split('/')[1], attempts = h.queued()[0][1].attempts
  for (const [token, status] of [['', 401], ['bad', 401], ['member', 403]]) assert.equal((await h.retry(id, token)).status, status)
  h.options.adminRemoved = true
  assert.equal((await h.retry(id)).status, 403)
  h.options.adminRemoved = false; h.options.revoked = true
  assert.equal((await h.retry(id)).status, 401)
  h.options.revoked = false; h.options.disabled = true
  assert.equal((await h.retry(id)).status, 403)
  assert.equal(h.queued()[0][1].attempts, attempts)
  assert.ok(h.events.includes('verify:true'))
})

test('A1: administrator input cannot override prefix or choose another bucket', async () => {
  const h = harness({ storageFails: true }); await h.withdraw()
  const [key, record] = h.queued()[0], id = key.split('/')[1]
  assert.equal((await h.retry('../projects')).status, 400)
  record.paths = ['projects/']
  assert.equal((await h.retry(id)).status, 422)
  record.paths = ['projects/solo/']; record.bucketName = 'other-bucket'
  assert.equal((await h.retry(id)).status, 503)
  assert.equal(record.reason, 'bucket-mismatch')
  assert.equal(h.events.filter(e => e.startsWith('storage:')).length, 1)
})

test('A1: collection stays client-denied and both retention disclosures describe sequential cleanup', () => {
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  assert.doesNotMatch(rules, /match \/storageCleanupQueue/)
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}\s*\}\s*\}/)
  assert.equal(consent.PRIVACY_CONSENT_VERSION, '2026-10-06')
  assert.match(consent.CONSENT_COPY.retention, /탈퇴 후 남은 업로드 자료는 순차 삭제됩니다/)
  assert.match(consent.CONSENT_COLLECTION_TABLE.rows[1][2], /탈퇴 후 남은 업로드 자료는 순차 삭제됩니다/)
  assert.equal(consent.ACCOUNT_DELETION_COPY.doneCleanupPending, '탈퇴가 완료되었습니다. 일부 업로드 자료는 정리 중입니다')
})

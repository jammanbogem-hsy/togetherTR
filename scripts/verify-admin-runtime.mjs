// Run after next build. Real SDK + actual built route; no application data access.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const scenario = process.argv[2]
if (!scenario) {
  for (const name of ['default-app', 'named-app']) execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: 'inherit' })
  process.exit(0)
}
assert.ok(['default-app', 'named-app'].includes(scenario))
if (scenario === 'named-app') require('firebase-admin/app').initializeApp({ projectId: 'admin-runtime-verification' }, 'framework-runtime')
const { routeModule } = require('../.next/server/app/api/admin/console/route.js')
for (const view of ['projects', 'members', 'project', 'messages']) {
  for (const token of ['', 'invalid-token']) {
    const response = await routeModule.userland.GET(new Request(`http://localhost/api/admin/console?view=${view}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
    assert.equal(response.status, 401, `${scenario}/${view}: ${await response.text()}`)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
}
for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(routeModule.userland[method], undefined)
console.log(`Admin production route (${scenario}): real SDK rejects unauthenticated/invalid requests, no mutation handlers, no application data accessed.`)

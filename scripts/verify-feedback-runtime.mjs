// Run after next build. Exercises the actual production bundle with the real Admin SDK.
// Requests have no usable credentials and cannot read or write application data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const scenario = process.argv[2]
if (!scenario) {
  for (const name of ['default-app', 'named-app']) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: 'inherit' })
  }
  process.exit(0)
}
assert.ok(['default-app', 'named-app'].includes(scenario), 'Unknown runtime scenario')
if (scenario === 'named-app') {
  // Firebase Hosting initializes a named app before invoking the Next.js route.
  require('firebase-admin/app').initializeApp({ projectId: 'feedback-runtime-verification' }, 'framework-runtime')
}
const { routeModule } = require('../.next/server/app/api/feedback/route.js')
for (const method of ['GET', 'POST', 'PATCH']) {
  const response = await routeModule.userland[method](new Request('http://localhost/api/feedback', { method }))
  assert.equal(response.status, 401, `${method}: Admin SDK loading must succeed before rejecting unauthenticated access. ${await response.text()}`)
}
const invalid = await routeModule.userland.GET(new Request('http://localhost/api/feedback', { headers: { Authorization: 'Bearer invalid-token' } }))
assert.equal(invalid.status, 401, 'Invalid token must be rejected by the real Admin Auth SDK')
console.log(`Built feedback route (${scenario}): real Admin SDK loads; GET/POST/PATCH unauthenticated and invalid-token requests return 401. No application data accessed.`)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('live demo replaces the seeded dashboard action with a configurable setup route', async () => {
  const dashboard = await source('src/app/(app)/dashboard/page.tsx')
  const setup = await source('src/app/(app)/demo/page.tsx')

  assert.doesNotMatch(dashboard, /createDemoProject/)
  assert.match(dashboard, /router\.push\('\/demo'\)/)
  assert.match(setup, /\[2, 3, 4, 5\]/)
  assert.match(setup, /\/api\/demo\/expand/)
  assert.match(setup, /createLiveDemoProject/)
  assert.match(setup, /\/demo\/run\/\$\{projectId\}/)
})

test('the runtime performs real model turns in the required collaboration order', async () => {
  const runner = await source('src/lib/demo/engine/run.ts')
  const intro = runner.indexOf("'orchestrator-intro'")
  const contribution = runner.indexOf("'teacher-contribution'", intro + 1)
  const response = runner.indexOf("'teacher-response'", contribution + 1)
  const synthesis = runner.indexOf("'orchestrator-synthesis'", response + 1)

  assert.ok(intro >= 0)
  assert.ok(contribution > intro)
  assert.ok(response > contribution)
  assert.ok(synthesis > response)
  assert.match(runner, /fetch\('\/api\/demo\/turn'/)
  assert.match(runner, /deleteActivityMessages\(projectId, activityCode\)/)
  assert.match(runner, /setProjectArtifact\(projectId, activityCode/)
  assert.match(runner, /saveStageReport/)
  assert.match(runner, /finishLiveDemoProject/)
  assert.match(runner, /ALL_ACTIVITIES\s*\n\s*\.filter\(\(code\) => project\.artifacts\?\.\[code\]\)/)
})

test('teacher agents see peers before revising and the orchestrator preserves disagreement', async () => {
  const prompts = await source('src/lib/demo/engine/prompts.ts')
  const types = await source('src/lib/demo/engine/types.ts')

  assert.match(types, /DEMO_TEACHER_COUNT_MIN = 2/)
  assert.match(types, /DEMO_TEACHER_COUNT_MAX = 5/)
  assert.match(types, /모든 교사의 1차 발언이 정확히 한 번씩 필요합니다/)
  assert.match(types, /종합 전 모든 교사 턴이 정확히 한 번씩 필요합니다/)
  assert.match(types, /2차 발언에는 다른 교사 에이전트의 이름을 직접 언급해야 합니다/)
  assert.match(prompts, /최소 한 명의 다른 교사 에이전트 displayName을 그대로 직접 언급하세요/)
  assert.match(prompts, /초대한 교사 에이전트 전원의 이름과 서로 다른 초대 관점/)
  assert.match(prompts, /소수 의견과 조건부 동의도 보존하세요/)
  assert.match(prompts, /실제 교사가 발언했거나 실제 학급에서 실행했다고 속이지 않습니다/)
})

test('demo APIs use validated strict JSON output on the proven chat-completions path', async () => {
  const expandRoute = await source('src/app/api/demo/expand/route.ts')
  const turnRoute = await source('src/app/api/demo/turn/route.ts')

  for (const route of [expandRoute, turnRoute]) {
    assert.match(route, /chat\.completions\.create/)
    assert.match(route, /type: 'json_schema'/)
    assert.match(route, /strict: true/)
    assert.doesNotMatch(route, /client\.responses\.create/)
  }
})

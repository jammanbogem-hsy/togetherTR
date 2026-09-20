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
  const project = await source('src/lib/demo/engine/project.ts')
  const workLoop = runner.indexOf('for (const step of getDemoActivityContract(activityCode).steps)')
  const intro = runner.indexOf("await turn('orchestrator-intro'", workLoop)
  const contribution = runner.indexOf("'teacher-contribution'", intro + 1)
  const response = runner.indexOf("'teacher-response'", contribution + 1)
  const synthesis = runner.indexOf("'orchestrator-synthesis'", response + 1)
  const review = runner.indexOf("await turn('teacher-review'", synthesis + 1)
  const revision = runner.indexOf("await turn('orchestrator-revision'", review + 1)

  assert.ok(workLoop >= 0)
  assert.ok(intro >= 0)
  assert.ok(contribution > intro)
  assert.ok(response > contribution)
  assert.ok(synthesis > response)
  assert.ok(review > synthesis)
  assert.ok(revision > review)
  assert.match(runner, /fetch\('\/api\/demo\/turn'/)
  // Resumption now preserves completed work; deleting dialogue was the old contract.
  assert.doesNotMatch(runner, /deleteActivityMessages/)
  assert.match(runner, /journal\[key\] \?\? await requestTurn/)
  assert.match(runner, /commitDemoTurn\(projectId, runId, activityCode/)
  assert.match(runner, /saveLiveDemoArtifact\(projectId, runId, activityCode/)
  assert.match(runner, /approvedBy\.length === config\.personas\.length/)
  assert.match(runner, /confirmedBy: 'demo-teacher-team'/)
  assert.match(project, /stageReports\.\$\{ACTIVITY_META\[code\]\.stage\}/)
  assert.match(runner, /finishLiveDemoProject/)
  assert.match(runner, /ALL_ACTIVITIES\.filter\(code => project\.artifacts\?\.\[code\]\)/)
})

test('teacher agents see peers before revising and the orchestrator preserves disagreement', async () => {
  const prompts = await source('src/lib/demo/engine/prompts.ts')
  const types = await source('src/lib/demo/engine/types.ts')

  assert.match(types, /DEMO_TEACHER_COUNT_MIN = 2/)
  assert.match(types, /DEMO_TEACHER_COUNT_MAX = 5/)
  assert.match(types, /이전 작업 단계마다 총괄 AI 제시와 모든 교사의 활동이 필요합니다/)
  assert.match(types, /모든 교사의 동료 응답이 필요합니다/)
  assert.match(types, /turns\.filter\(turn => turn\.speakerId === persona\.id\)\.length === 1/)
  assert.match(types, /2차 발언에는 다른 교사 에이전트의 이름을 직접 언급해야 합니다/)
  assert.match(types, /인용문과 발화자는 실제 입력 대화에 정확히 일치해야 합니다/)
  assert.match(prompts, /최소 한 명의 다른 교사 displayName을 정확히 부르/)
  assert.match(prompts, /교사 에이전트 전원의 이름을 사용해 참여를 요청하세요/)
  assert.match(prompts, /소수 의견과 미해결 조건을 보존하세요/)
  assert.match(prompts, /반대는 실질적인 문제가 있을 때만 하며 억지 갈등/)
  assert.match(prompts, /시간\/호출 회차 때문에 승인하지 마세요/)
  assert.match(prompts, /candidateArtifact 전체 원문을 자신의 발언·페르소나·공동 목표·completionCriteria와 대조/)
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

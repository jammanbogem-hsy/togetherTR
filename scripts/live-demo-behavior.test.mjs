// Executes the real engine; only model and Firestore boundaries are replaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = fileURLToPath(new URL('../', import.meta.url))
function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative), loadedModule = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, console, DOMException, AbortController, setTimeout, clearTimeout, ...globals, require: name => {
    if (name in mocks) return mocks[name]
    throw new Error(`Unmocked dependency: ${name}`)
  } }, { filename })
  return loadedModule.exports
}
const meta = load('src/types/index.ts')
const codes = meta.STAGES.flatMap(s => s.activities)
const contracts = load('src/lib/activity/demo-contracts.ts', { '@/types': meta })
const types = load('src/lib/demo/engine/types.ts', { '@/types': meta, '@/lib/activity/demo-contracts': contracts })
const countTurns = (n, code) => contracts.getDemoActivityContract(code).steps.length * (n + 1) + 2 * n + 1
const configFor = count => ({ personas: Array.from({ length: count }, (_, i) => ({ id: `teacher-${i + 1}`, displayName: `교사${i + 1}`, subject: `영역${i + 1}`, career: '7년차', strengths: ['검토'], collaborationStyle: '근거 중심', priority: '학생 참여', summary: '학생 참여 점검', color: '#2F6FED', emoji: '🔬' })), lesson: { title: '측우기 협력 설계 검증', topic: '측우기와 데이터', overview: '측우기와 자료 해석 융합', schoolLevel: '초등학교', gradeGroup: '초5-6', subjects: ['과학', '수학'], totalSessions: 3, goals: ['근거로 판단한다.'], learnerContext: '표현 차이', constraints: ['합성 표시'], dataPlan: '합성 강우 자료' } })
function harness(count = 3, respond) {
  const config = configFor(count), project = { createdBy: 'owner', artifacts: {}, stageReports: {}, activityStatuses: {}, demoRun: {} }
  const calls = [], messages = new Map(), journals = {}, writes = []
  let lease = null, renewals = 0
  const helpers = {
    totalDemoTurns: n => codes.reduce((sum, code) => sum + countTurns(n, code), 0),
    turnsPerActivity: countTurns,
    acquireLiveDemoLease: async () => { if (lease) throw new Error('이미 실행 중'); lease = 'test-lease'; return lease },
    renewLiveDemoLease: async () => { if (!lease) throw new Error('실행권 만료'); renewals += 1 },
    releaseLiveDemoLease: async () => { lease = null },
    loadDemoJournal: async (_id, code) => journals[code] ?? {},
    commitDemoTurn: async (_id, _lease, code, key, response, message) => {
      journals[code] ??= {}; journals[code][key] = structuredClone(response)
      if (!messages.has(key)) messages.set(key, structuredClone(message))
      writes.push(['turn', key])
    },
    patchLiveDemoRun: async (_id, patch) => { Object.assign(project.demoRun, patch); writes.push(['patch']) },
    beginLiveDemoActivity: async (_id, index, code) => { project.currentActivity = code; project.demoRun.activityIndex = index },
    saveLiveDemoArtifact: async (_id, _lease, code, artifact) => { project.artifacts[code] = structuredClone(artifact); writes.push(['artifact', code, artifact.status]) },
    completeLiveDemoActivity: async (_id, _lease, code, next, report) => { project.activityStatuses[code] = 'completed'; if (report) project.stageReports[meta.ACTIVITY_META[code].stage] = { content: report }; project.currentActivity = next ?? code },
    finishLiveDemoProject: async (_id, _lease, report) => { project.status = 'completed'; project.cumulativeReport = report; project.demoRun.status = 'completed' },
  }
  const engine = load('src/lib/demo/engine/run.ts', { '@/types': meta, '@/lib/activity/demo-contracts': contracts, '@/lib/firebase/projects': { getProject: async () => structuredClone(project) }, './project': helpers }, {
    crypto: { randomUUID: () => 'test-lease' }, window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout },
    fetch: async (_url, options) => {
      const input = JSON.parse(options.body); types.parseDemoTurnInput(input); calls.push(input)
      if (respond) { const custom = await respond(input, { project, calls, signal: options.signal, renewalCount: () => renewals, loseLease: () => { lease = null } }); if (custom) return { ok: !custom.error, status: custom.status ?? 502, json: async () => custom } }
      const result = { content: '교사 간의 활동 결과와 검토 근거입니다.' }
      if (input.phase === 'teacher-review') result.review = { decision: 'approve', reason: '제 의견과 활동 형식을 반영했습니다.' }
      if (['orchestrator-synthesis', 'orchestrator-revision'].includes(input.phase)) {
        result.artifact = { activityCode: input.activityCode, title: '공동 산출물', content: Object.fromEntries(types.getDemoArtifactSectionKeys(input.activityCode).map(key => [key, '동료의 의견을 반영한 공동 결과와 다음 활동 연결입니다.'])) }
        if (meta.STAGES.some(s => s.activities.at(-1) === input.activityCode)) result.stageReport = { stage: meta.ACTIVITY_META[input.activityCode].stage, content: '근거를 기록한 단계 보고서입니다.' }
      }
      return { ok: true, json: async () => result }
    },
  })
  return { run: (signal = new AbortController().signal) => engine.runLiveMultiAgentDemo('test', 'owner', config, 0, { signal }), buildPriorArtifacts: engine.buildPriorArtifacts, config, project, calls, messages, journals, writes }
}
for (const count of [2, 3, 4, 5]) test(`${count} teachers: activity substeps, independent contributions, explicit unanimous approval`, async () => {
  const h = harness(count); await h.run()
  assert.equal(h.calls.length, codes.reduce((sum, code) => sum + countTurns(count, code), 0))
  assert.equal(h.messages.size, h.calls.length)
  assert.equal(Object.keys(h.project.artifacts).length, 19)
  assert.equal(Object.keys(h.project.stageReports).length, 5)
  assert.equal(h.project.status, 'completed')
  for (const input of h.calls.filter(c => c.phase === 'teacher-contribution')) {
    assert.equal(input.discussion.filter(t => t.stepId === input.stepId && t.phase === 'teacher-contribution').length, 0)
    const steps = contracts.getDemoActivityContract(input.activityCode).steps, stepIndex = steps.findIndex(step => step.id === input.stepId)
    for (const step of steps.slice(0, stepIndex)) assert.equal(input.discussion.filter(t => t.stepId === step.id && t.phase === 'teacher-contribution').length, count)
  }
  for (const artifact of Object.values(h.project.artifacts)) {
    assert.equal(artifact.status, 'confirmed'); assert.equal(artifact.confirmedBy, 'demo-teacher-team')
    assert.equal(artifact.demoReview.approvedBy.length, count)
  }
  assert.ok(h.calls.find(c => c.activityCode === 'E-2-1').priorArtifacts['T-1-1'])
  assert.ok(h.calls.find(c => c.activityCode === 'E-2-1').priorArtifacts['T-1-1'].content['협의 근거(실제 실행 발언)'].includes('교사1'))
})
test('dissent revises shared draft and obtains new approvals before confirming', async () => {
  const h = harness(2, input => input.phase === 'teacher-review' && input.activityCode === 'T-1-1' && input.round === 0 && input.teacherId === 'teacher-1' ? { content: '제 키워드가 빠졌습니다.', review: { decision: 'revise', reason: '개인 키워드를 복구하세요.' } } : null)
  await h.run()
  assert.equal(h.calls.filter(c => c.phase === 'orchestrator-revision').length, 1)
  assert.equal(h.project.artifacts['T-1-1'].demoReview.round, 1)
  assert.ok(h.writes.some(w => w[0] === 'artifact' && w[2] === 'in_review'))
})
test('continued dissent stops without confirmation or further activity', async () => {
  const h = harness(2, input => input.phase === 'teacher-review' ? { content: '근거를 다시 확인해야 합니다.', review: { decision: 'revise', reason: '합의하지 않았습니다.' } } : null)
  await assert.rejects(h.run(), /합의|승인|검토/)
  assert.equal(h.project.artifacts['T-1-1'].status, 'in_review')
  assert.equal(h.calls.filter(c => c.phase === 'orchestrator-revision').length, 2)
  assert.ok(h.calls.every(c => c.activityCode === 'T-1-1'))
})
test('failed teacher stops all writes, retry reuses persisted turns without deleting discussion', async () => {
  let fail = true
  const h = harness(3, input => { if (fail && input.teacherId === 'teacher-2') throw new Error('모델 실패'); return null })
  await assert.rejects(h.run(), /모델 실패/)
  const saved = h.messages.size, before = h.writes.length, introCalls = h.calls.filter(c => c.phase === 'orchestrator-intro').length
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(h.writes.length, before)
  fail = false; await h.run()
  assert.ok(h.messages.size > saved)
  assert.equal(h.calls.filter(c => c.activityCode === 'T-1-1' && c.phase === 'orchestrator-intro').length, introCalls + contracts.getDemoActivityContract('T-1-1').steps.length - 1)
})
test('abort after provider response never commits that response', async () => {
  const controller = new AbortController()
  const h = harness(2, () => { controller.abort(); return { content: '중단 직후 반환' } })
  await assert.rejects(h.run(controller.signal), { name: 'AbortError' })
  assert.equal(h.messages.size, 0)
})
test('a pending model request renews its lease without waiting for the response', async () => {
  let renewedWhilePending = false
  const h = harness(2, async (_input, { calls, renewalCount }) => {
    if (calls.length !== 1) return null
    const before = renewalCount()
    await new Promise(resolve => setTimeout(resolve, 20))
    renewedWhilePending = renewalCount() > before
    return null
  })
  await h.run()
  assert.ok(renewedWhilePending, 'lease must renew during model wait')
  assert.equal(h.project.status, 'completed')
})
test('lease loss during a model request aborts that request and prevents a commit', async () => {
  let requestAborted = false
  const h = harness(2, async (_input, { signal, loseLease }) => {
    loseLease()
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('request did not abort on lease loss')), 100)
      signal.addEventListener('abort', () => { requestAborted = true; clearTimeout(timer); resolve() }, { once: true })
    })
    return { content: '실행권을 잃은 요청의 응답' }
  })
  await assert.rejects(h.run(), /실행권/)
  assert.equal(requestAborted, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.messages.size, 0)
})
test('model validation issues guide the retry rather than silently repeating the same request', async () => {
  const h = harness(2, (_input, { calls }) => calls.length === 1 ? { error: '응답 검증 실패', issues: ['교사의 개인 키워드를 빠짐없이 포함하세요.'], status: 502 } : null)
  await h.run()
  assert.deepEqual(h.calls[1].validationFeedback, ['교사의 개인 키워드를 빠짐없이 포함하세요.'])
  assert.equal(h.project.status, 'completed')
})
test('invalid input fails once with actionable issue details', async () => {
  const h = harness(2, () => ({ error: '요청 값이 올바르지 않습니다.', issues: ['입력 단계 순서 불일치'], status: 400 }))
  await assert.rejects(h.run(), /입력 단계 순서 불일치/)
  assert.equal(h.calls.length, 1)
  assert.equal(h.project.demoRun.status, 'failed')
})
test('legacy partially executed projects are refused before lease or state changes', async () => {
  for (const priorState of ['turns', 'artifact']) {
    const h = harness(2)
    if (priorState === 'turns') h.project.demoRun.completedTurns = 1
    else h.project.artifacts['T-1-1'] = { title: '이전 버전 결과', status: 'confirmed', content: { 결과: '이전 기록' } }
    const before = structuredClone(h.project)
    await assert.rejects(h.run(), /이전 버전.*새 데모/)
    assert.deepEqual(h.project, before)
    assert.equal(h.writes.length, 0)
    assert.equal(h.calls.length, 0)
  }
})
test('v2 confirmed artifact without every teacher approval cannot be skipped as complete', async () => {
  for (const approvedBy of [undefined, ['teacher-1']]) {
    const h = harness(2)
    h.project.demoRun.engineVersion = 2
    const artifact = { title: '검토되지 않은 결과', status: 'confirmed', content: { 결과: '임의 확정' }, ...(approvedBy ? { demoReview: { approvedBy, round: 0, simulated: true } } : {}) }
    h.project.artifacts['T-1-1'] = artifact
    await assert.rejects(h.run(), /검토.*승인/)
    assert.deepEqual(h.project.artifacts['T-1-1'], artifact)
    assert.equal(h.calls.length, 0)
    assert.equal(h.project.activityStatuses['T-1-1'], undefined)
  }
})
test('E memory retains T agreements and the full DI material tail within serialized budget', () => {
  const h = harness(2)
  for (const code of codes) h.project.artifacts[code] = {
    title: '긴 산출물', status: 'confirmed', content: Object.fromEntries(types.getDemoArtifactSectionKeys(code).map(key => [key, '"\n\\'.repeat(4000)])),
    demoReview: { evidence: [{ speakerId: 'teacher-1', speakerName: '교사1', quote: '실제로 했던 협력 발언입니다.' }] },
  }
  const material = '실제로 내려받을 활동지·CSV·루브릭\n' + '자료 본문'.repeat(2000) + '\nEND_OF_ACTUAL_MATERIAL'
  h.project.artifacts['DI-1-1'].content['개발 자료 목록'] = material
  const memory = h.buildPriorArtifacts(h.project)
  assert.equal(Object.keys(memory).length, 19)
  assert.equal(memory['DI-1-1'].content['개발 자료 목록'], material)
  assert.ok(memory['T-1-1'].content['협의 근거(실제 실행 발언)'].includes('실제로 했던'))
  assert.ok(JSON.stringify(memory).length <= 80_000)
})

function transactionHarness() {
  const documents = new Map([['projects/test', { createdBy: 'owner', demoRun: {}, artifacts: {} }]])
  let now = 1_000, sequence = 0
  const snapshot = ref => ({ exists: () => documents.has(ref), data: () => structuredClone(documents.get(ref)) })
  const sdk = {
    doc: (_db, ...segments) => segments.join('/'), collection: (_db, ...segments) => segments.join('/'), serverTimestamp: () => now,
    getDocs: async collection => ({ docs: [...documents].filter(([key]) => key.startsWith(collection + '/')).map(([key]) => ({ id: key.split('/').at(-1), data: () => structuredClone(documents.get(key)) })) }),
    runTransaction: async (_db, task) => {
      const operations = []
      const transaction = { get: async ref => snapshot(ref), set: (ref, value) => operations.push(() => documents.set(ref, structuredClone(value))), update: (ref, updates) => operations.push(() => {
        const value = documents.get(ref)
        for (const [key, entry] of Object.entries(updates)) {
          const parts = key.split('.'); let parent = value
          for (const part of parts.slice(0, -1)) { parent[part] ??= {}; parent = parent[part] }
          parent[parts.at(-1)] = structuredClone(entry)
        }
      }) }
      await task(transaction)
      operations.forEach(operation => operation())
    },
  }
  const helpers = load('src/lib/demo/engine/project.ts', { 'firebase/firestore': sdk, '@/lib/firebase/config': { db: {} }, '@/lib/firebase/projects': {}, '@/lib/inviteCode': {}, '@/types': meta, '@/lib/activity/demo-contracts': contracts, '@/lib/artifacts/artifactUpdatedAt': load('src/lib/artifacts/artifactUpdatedAt.ts') }, { Date: { now: () => now }, crypto: { randomUUID: () => `lease-${++sequence}` } })
  return { helpers, documents, advance: ms => { now += ms } }
}
test('transaction lease rejects another tab and stale runner writes after takeover', async () => {
  const h = transactionHarness(), api = h.helpers
  const old = await api.acquireLiveDemoLease('test', 'owner')
  await assert.rejects(api.acquireLiveDemoLease('test', 'owner'), /다른 탭/)
  await assert.rejects(api.acquireLiveDemoLease('test', 'stranger'), /생성자/)
  h.advance(180_001)
  const current = await api.acquireLiveDemoLease('test', 'owner')
  await assert.rejects(api.patchLiveDemoRun('test', { status: 'failed' }, old), /실행권/)
  await assert.rejects(api.commitDemoTurn('test', old, 'T-1-1', 'late', { content: '늦게 온 응답' }, { content: '늦게 온 응답' }), /실행권/)
  await api.releaseLiveDemoLease('test', old)
  assert.equal(h.documents.get('projects/test').demoRun.lease.runId, current)
  await api.patchLiveDemoRun('test', { status: 'failed' })
  assert.equal(h.documents.get('projects/test').demoRun.status, undefined)
})
test('atomic journal and visible message commit once, resume preserves timestamps and human notes', async () => {
  const h = transactionHarness(), api = h.helpers, lease = await api.acquireLiveDemoLease('test', 'owner')
  const path = 'projects/test/conversations/T-1-1/messages/turn-1'
  h.documents.set('projects/test/conversations/T-1-1/messages/human-note', { content: '관찰자의 메모', createdAt: 1 })
  await api.commitDemoTurn('test', lease, 'T-1-1', 'turn-1', { content: '첫 번째 실제 응답' }, { role: 'assistant', content: '첫 번째 실제 응답' })
  const first = structuredClone(h.documents.get(path)); h.advance(100)
  await api.commitDemoTurn('test', lease, 'T-1-1', 'turn-1', { content: '다른 응답' }, { role: 'assistant', content: '다른 응답' })
  assert.deepEqual(h.documents.get(path), first)
  const journal = await api.loadDemoJournal('test', 'T-1-1')
  assert.equal(journal['turn-1'].content, '첫 번째 실제 응답')
  assert.equal(Object.keys(journal).length, 1)
  assert.ok(h.documents.has('projects/test/conversations/T-1-1/messages/human-note'))
})

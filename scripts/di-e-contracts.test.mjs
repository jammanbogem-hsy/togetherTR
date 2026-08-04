import test from 'node:test'
import assert from 'node:assert/strict'

test('artifact signal targets accept display codes and reject unknown codes', async () => {
  const {
    parseArtifactConfirm,
    parseArtifactUpdates,
  } = await import('../src/lib/chat/signals.ts')

  const confirms = parseArtifactConfirm('[ARTIFACT_CONFIRM@E-1]')
  assert.deepEqual(confirms.codes, ['E-1-1'])

  const parsed = parseArtifactUpdates('[ARTIFACT_UPDATE@DI-1: 개발 자료 목록=자료]')
  assert.equal(parsed.updates[0]?.activityCode, 'DI-1-1')
  assert.deepEqual(parsed.updates[0]?.sections, { '개발 자료 목록': '자료' })

  const invalid = parseArtifactUpdates('[ARTIFACT_UPDATE@UNKNOWN: 사실=잘못된 대상]')
  assert.deepEqual(invalid.updates, [])
})

test('incomplete streamed artifact signals are discarded', async () => {
  const { parseArtifactUpdates } = await import('../src/lib/chat/signals.ts')
  const parsed = parseArtifactUpdates(
    '기록을 저장합니다.\n[ARTIFACT_UPDATE: 주요 상황 기록=| 시점 | 상황 |\n| 1차시 | 학생',
  )

  assert.deepEqual(parsed.updates, [])
  assert.equal(parsed.cleanText, '기록을 저장합니다.')
})

test('artifact updates that request confirmation are committed once with the new content', async () => {
  const { applyArtifactSignalBatch } = await import('../src/lib/chat/artifactSignalBatch.ts')
  const events = []

  await applyArtifactSignalBatch({
    currentActivity: 'E-1-1',
    updates: [
      { sections: { 사실: '학생 산출물에 나타난 객관적 사실입니다.' } },
    ],
    confirmCodes: [''],
    commitUpdate: async (activityCode, sections, confirm) => {
      events.push({ kind: 'update', activityCode, sections, confirm })
    },
    confirmExisting: async activityCode => {
      events.push({ kind: 'confirm', activityCode })
    },
  })

  assert.deepEqual(events, [{
    kind: 'update',
    activityCode: 'E-1-1',
    sections: { 사실: '학생 산출물에 나타난 객관적 사실입니다.' },
    confirm: true,
  }])
})

test('the first completed cycle transitions from cycle 1 to cycle 2 exactly once', async () => {
  const {
    completedCycleNumberForTransition,
    nextCycleNumber,
  } = await import('../src/lib/activity/cycle.ts')

  const completed = completedCycleNumberForTransition({ currentCycle: 1, cycleCount: 1 })
  assert.equal(completed, 1)
  assert.equal(nextCycleNumber(completed), 2)
})

test('E completion requires official reflection outputs while next-cycle choice stays optional', async () => {
  const { ACTIVITY_META } = await import('../src/types/index.ts')
  const { validateRequiredSections } = await import('../src/lib/activity/requiredSections.ts')

  const e1Sections = ACTIVITY_META['E-1-1'].requiredSections
  assert.equal(validateRequiredSections({
    사실: '학생 산출물과 관찰 기록에서 확인한 객관적인 사실입니다.',
  }, e1Sections), false)
  assert.equal(validateRequiredSections({
    사실: '학생 산출물과 관찰 기록에서 확인한 객관적인 사실입니다.',
    해석: '루브릭과 실제 배움의 간극이 생긴 원인을 분석한 내용입니다.',
    수정안: '다음 수업에서 발문을 구체화하고 그 이유까지 기록한 내용입니다.',
  }, e1Sections), true)

  const e2Sections = ACTIVITY_META['E-2-1'].requiredSections
  assert.equal(validateRequiredSections({
    '다음 주기 선택': 'A안 — 개선사항을 반영하며 다음 주기 시작',
  }, e2Sections), false)
  assert.equal(validateRequiredSections({
    '협력 과정 성찰': '기대했던 협력과 실제 실행을 비교하고, 잘 작동한 구조와 막힌 구조를 구체적인 장면으로 정리했습니다.',
  }, e2Sections), false)
  assert.equal(validateRequiredSections({
    '협력 과정 성찰': '기대했던 협력과 실제 실행을 비교하고, 잘 작동한 구조와 막힌 구조를 구체적인 장면으로 정리했습니다.',
    '팀 개선안': '공유 문서에 의견을 남기면 알림을 보내고 모든 팀원이 하루 안에 확인 댓글을 남깁니다.',
  }, e2Sections), true)
})

test('solo T-1-1 preserves design principles for the later E reflection context', async () => {
  const { buildT11Structured } = await import('../src/lib/artifacts/schemas.ts')
  const result = buildT11Structured({
    '팀 공통 비전': '학생이 실제 문제를 스스로 탐구하는 수업',
    '핵심 키워드': '실제 문제, 자기주도, 탐구',
    '설계 원칙': '1. 실제 문제를 다루려면 학생이 자료를 직접 수집한다.\n2. 자기주도성을 기르려면 선택권을 제공한다.',
  }, [])

  assert.equal(result.designPrinciples?.length, 2)
  assert.match(result.designPrinciples?.[0]?.principle ?? '', /자료를 직접 수집/)
})

test('messages are isolated by design cycle while legacy messages remain in cycle 1', async () => {
  const { mergeMessagesForCycle } = await import('../src/lib/chat/messageCycles.ts')
  const messages = mergeMessagesForCycle([[
    { id: 'legacy', role: 'user', content: '첫 주기 레거시', activityCode: 'E-1-1', createdAt: 1 },
    { id: 'cycle-1', role: 'user', content: '첫 주기', activityCode: 'E-1-1', cycleNumber: 1, createdAt: 2 },
    { id: 'cycle-2', role: 'user', content: '둘째 주기', activityCode: 'E-1-1', cycleNumber: 2, createdAt: 3 },
  ]], 2)

  assert.deepEqual(messages.map(message => message.id), ['cycle-2'])
})

test('a streamed response is stale after the team changes activities', async () => {
  const { isStaleActivityResponse } = await import('../src/lib/chat/responseContext.ts')
  assert.equal(isStaleActivityResponse('DI-2-1', 'E-1-1'), true)
  assert.equal(isStaleActivityResponse('DI-2-1', 'DI-2-1'), false)
  assert.equal(isStaleActivityResponse('DI-2-1', 'DI-2-1', 1, 2), true)
})

test('a new T-1 artifact is required before clearing the E-completed cycle marker', async () => {
  const { hasNewCycleT11Artifact, shouldOpenCycleTransition } = await import('../src/lib/activity/cycle.ts')

  assert.equal(hasNewCycleT11Artifact(4, 4), false)
  assert.equal(hasNewCycleT11Artifact(4, 5), true)
  assert.equal(shouldOpenCycleTransition(true, 'A'), true)
  assert.equal(shouldOpenCycleTransition(true, 'B'), false)
})

test('project rules reserve workflow and artifact fields for the host', async () => {
  const { readFile } = await import('node:fs/promises')
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')

  assert.match(rules, /function isHostOf/)
  assert.match(rules, /function isMemberSafeProjectUpdate/)
  assert.match(rules, /artifacts/)
  assert.match(rules, /currentCycle/)
  assert.match(rules, /allow update: if isHostOf\(resource\)/)
})

test('DI and E prompts keep evidence-first facilitation and leave cycle movement to the UI', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/lib/prompts/system.ts', import.meta.url), 'utf8')
  const e2Start = source.indexOf("'E-2-1': `## E-2-1")
  const e2End = source.indexOf("`,\n}", e2Start)
  const e2 = source.slice(e2Start, e2End)
  const di2Start = source.indexOf("'DI-2-1': `## DI-2-1")
  const di2End = source.indexOf("\n\n  'E-1-1':", di2Start)
  const di2 = source.slice(di2Start, di2End)

  assert.doesNotMatch(e2, /ACTIVITY_RETURN/)
  assert.match(e2, /단계 이동 신호를 출력하지/)
  assert.doesNotMatch(di2, /각 유형 최소 1개/)
  assert.match(source, /학생 산출물.*관찰 기록.*먼저/)
  assert.match(source, /사용 활동.*완성 형태.*개별·모둠.*협력 구조/)
})

test('demo DI/E artifacts use the same section contracts as live agent output', async () => {
  const { DEMO_ACTIVITY_SEEDS } = await import('../src/lib/demo/scenario.ts')
  const byCode = code => DEMO_ACTIVITY_SEEDS.find(seed => seed.code === code)?.artifact.content ?? {}

  assert.deepEqual(Object.keys(byCode('DI-2-1')).sort(), ['주요 상황 기록', '종합 시사점'].sort())
  assert.deepEqual(Object.keys(byCode('E-1-1')).sort(), ['사실', '수정안', '해석'].sort())
  assert.deepEqual(Object.keys(byCode('E-2-1')).sort(), ['다음 주기 선택', '팀 개선안'].sort())
})

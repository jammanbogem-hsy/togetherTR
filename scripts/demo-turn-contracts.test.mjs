import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies = {}) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, require: name => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unknown dependency ${name}`)
  } })
  return mod.exports
}
const meta = load('src/types/index.ts')
const contracts = {
  getDemoActivityContract: () => ({ steps: [{ id: 'first' }, { id: 'second' }], completionCriteria: ['공동 비전에 교사 관점이 반영됨'] }),
  validateDemoArtifactContent: () => [],
}
const api = load('src/lib/demo/engine/types.ts', { '@/types': meta, '@/lib/activity/demo-contracts': contracts })
const prompts = load('src/lib/demo/engine/prompts.ts', { '@/types': meta, '@/lib/activity/demo-contracts': contracts, './types': api })
const config = {
  personas: [1, 2].map(i => ({ id: `teacher-${i}`, displayName: `교사${i}`, subject: '과학', career: '5년', strengths: ['탐구'], collaborationStyle: '근거', priority: '참여', summary: '협력하는 교사', color: '#123456', emoji: '🌱' })),
  lesson: { title: '측우기', topic: '측정', overview: '측정과 협력', schoolLevel: '초등학교', gradeGroup: '초5-6', subjects: ['과학'], totalSessions: 3, goals: ['탐구'], learnerContext: '다양성', constraints: [], dataPlan: '합성 자료' },
}
const intro = stepId => ({ phase: 'orchestrator-intro', speakerId: 'orchestrator', speakerName: '총괄 AI', content: '교사1, 교사2의 생각을 먼저 묻습니다.', stepId })
const contributions = stepId => config.personas.map(p => ({ phase: 'teacher-contribution', speakerId: p.id, speakerName: p.displayName, content: '서로 다른 관점을 비교합시다.', stepId }))
const work = [intro('first'), ...contributions('first'), intro('second'), ...contributions('second')]
const responses = config.personas.map(p => ({ phase: 'teacher-response', speakerId: p.id, speakerName: p.displayName, content: '다른 관점의 근거를 검토했습니다.' }))
const candidateArtifact = { activityCode: 'T-1-1', title: '공동 비전', content: Object.fromEntries(api.getDemoArtifactSectionKeys('T-1-1').map(k => [k, '모든 교사가 검토할 공동 비전 초안 내용입니다.'])) }
const proposal = { phase: 'orchestrator-synthesis', speakerId: 'orchestrator', speakerName: '총괄 AI', content: '검토할 공동 초안입니다.', round: 0 }
const input = (phase, extra = {}) => ({ phase, activityCode: 'T-1-1', config, priorArtifacts: {}, discussion: [], ...extra })
const output = extra => ({ content: '검토 결과입니다.', artifact: null, stageReport: null, review: null, references: [], ...extra })

test('두 번째 작업은 이전 대화를 유지하며 총괄 AI가 먼저 제시한다', () => {
  const result = api.parseDemoTurnInput(input('orchestrator-intro', { stepId: 'second', discussion: work.slice(0, 3) }))
  assert.equal(result.stepId, 'second')
  assert.throws(() => api.parseDemoTurnInput(input('teacher-contribution', { teacherId: 'teacher-1', stepId: 'second', discussion: work.slice(0, 3) })))
})
test('산출물 검토는 초안과 모든 선행 교사 발언이 있어야 가능하다', () => {
  const request = input('teacher-review', { teacherId: 'teacher-1', round: 0, candidateArtifact, discussion: [...work, ...responses, proposal] })
  assert.equal(api.parseDemoTurnInput(request).candidateArtifact.title, '공동 비전')
  assert.throws(() => api.parseDemoTurnInput({ ...request, candidateArtifact: undefined }))
  assert.throws(() => api.parseDemoTurnInput({ ...request, discussion: [proposal] }))
})
test('교사 검토에는 명시적 승인/수정 결정이 필요하다', () => {
  const request = input('teacher-review', { teacherId: 'teacher-1', candidateArtifact })
  assert.throws(() => api.parseDemoTurnModelOutput(output({}), request))
  assert.equal(api.parseDemoTurnModelOutput(output({ review: { decision: 'approve', reason: '개인의 관점과 공동 비전이 연결됩니다.', blockers: [], suggestions: ['학생 과제는 이후 설계 단계에서 구체화합니다.'] } }), request).review.decision, 'approve')
})
test('수정 요구는 고정된 활동 기준과 현재 초안 원문에 연결되어야 한다', () => {
  const request = input('teacher-review', { teacherId: 'teacher-1', candidateArtifact })
  const blocker = { criterionId: 'activity-1', sectionKey: Object.keys(candidateArtifact.content)[0], evidence: '모든 교사가 검토할', issue: '개인 교사의 관점이 누락되었습니다.', change: '개인 비전에 드러난 접근성 관점을 공동 비전에 반영합니다.' }
  const review = { decision: 'revise', reason: blocker.issue, blockers: [blocker], suggestions: [] }
  assert.equal(api.parseDemoTurnModelOutput(output({ review }), request).review.blockers.length, 1)
  assert.throws(() => api.parseDemoTurnModelOutput(output({ review: { ...review, blockers: [] } }), request))
  assert.throws(() => api.parseDemoTurnModelOutput(output({ review: { ...review, decision: 'approve' } }), request))
  assert.throws(() => api.parseDemoTurnModelOutput(output({ review: { ...review, blockers: [{ ...blocker, criterionId: 'new-file-naming-rule' }] } }), request))
  assert.throws(() => api.parseDemoTurnModelOutput(output({ review: { ...review, blockers: [{ ...blocker, evidence: '실제로 존재하지 않는 초안 문구' }] } }), request))
})
test('동료 응답의 인용은 실제 다른 교사의 발언과 일치해야 한다', () => {
  const request = input('teacher-response', { teacherId: 'teacher-1', discussion: work })
  assert.throws(() => api.parseDemoTurnModelOutput(output({ content: '교사2가 제안했습니다.', references: [{ speakerId: 'teacher-2', quote: '없는 발언' }] }), request))
  assert.equal(api.parseDemoTurnModelOutput(output({ content: '교사2의 서로 다른 관점을 비교하자는 제안을 수용합니다.', references: [{ speakerId: 'teacher-2', quote: '서로 다른 관점을 비교합시다.' }] }), request).references.length, 1)
})
test('모델 인용 스키마는 실제 동료 구절과 발화자의 쌍만 선택하게 한다', () => {
  const quoteWork = [...work, { ...contributions('second')[1], content: '제 제안: "동일 조건을 비교합시다." 경로\\표기를 함께 확인합시다.' }]
  const request = input('teacher-response', { teacherId: 'teacher-1', discussion: quoteWork })
  const choices = prompts.buildDemoTurnResponseSchema(request).properties.references.items.anyOf
  assert.ok(choices.length > 0)
  for (const choice of choices) {
    const speakerId = choice.properties.speakerId.enum[0]
    assert.notEqual(speakerId, request.teacherId)
    for (const quote of choice.properties.quote.enum) {
      assert.ok(quote.length >= 5 && quote.length <= 300)
      assert.ok(quoteWork.some(turn => turn.speakerId === speakerId && turn.content.includes(quote)))
      assert.doesNotMatch(quote, /["\\\u0000-\u001f]/)
    }
  }
  assert.ok(prompts.buildDemoTurnInput(request).includes('peerQuoteOptions'))
})
test('T-2 원칙 조정 안내는 초안을 제시하겠다는 약속만으로 통과하지 않는다', () => {
  const request = input('orchestrator-intro', { activityCode: 'T-1-2', stepId: 'priorities-veto' })
  assert.throws(() => api.parseDemoTurnModelOutput(output({ content: '원칙 표를 곧 제시하겠습니다. 우선 멈춤 조건을 말씀해주세요.' }), request))
  const content = '1. 공정하게 측정하려면 조건을 통일해야 한다.\n2. 근거로 설명하려면 기록을 비교해야 한다.\n3. 모두 참여하는 수업이 되려면 표현 방법을 선택하게 해야 한다.\n세 원칙의 멈춤 조건을 정해주세요.'
  assert.equal(api.parseDemoTurnModelOutput(output({ content }), request).content, content)
})
test('후속 총괄 지시는 검토 대상을 현재 응답에 제시하고 교사의 생각 변경을 허용한다', () => {
  const instruction = prompts.buildDemoTurnInstructions(input('orchestrator-intro', { activityCode: 'A-1-1', stepId: 'second' }))
  assert.match(instruction, /현재 응답의 content에.*실제 본문/)
  assert.match(instruction, /다음 턴.*미루지/)
  assert.match(instruction, /생각을 바꿀 수/)
  assert.match(instruction, /후보 3안.*일률적으로/)
})
test('대화 본문에 내부 출력 필드와 앱 신호가 노출되면 거절한다', () => {
  assert.throws(() => api.parseDemoTurnModelOutput(output({ content: 'artifact: null, stageReport: null' }), input('teacher-contribution')))
  assert.throws(() => api.parseDemoTurnModelOutput(output({ content: '[ACTIVITY_ADVANCE: T-1-2]' }), input('teacher-contribution')))
  assert.throws(() => api.parseDemoTurnModelOutput(output({ content: 'artifact와 stageReport는 이번 턴에서 null로 유지됩니다.' }), input('teacher-contribution')))
  for (const token of ['priorArtifacts', 'visibleDiscussion', 'completionCriteria', 'references']) {
    assert.throws(() => api.parseDemoTurnModelOutput(output({ content: `${token}를 참고하여 확인했습니다.` }), input('teacher-contribution')))
  }
})
test('E 성찰은 실제 DI 기록에 있는 장면만 증거로 참조한다', () => {
  const request = input('orchestrator-synthesis', { activityCode: 'E-1-1', priorArtifacts: { 'DI-2-1': { title: '모의 관찰', content: { '주요 상황 기록': 'SIM-1 관찰 기록' } } } })
  const artifact = { title: '성찰', sections: api.getDemoArtifactSectionKeys('E-1-1').map(key => ({ key, value: 'SIM-99 가상 증거를 사용하여 학생의 판단 근거를 검토하고 개선 문안을 작성합니다.' })) }
  assert.throws(() => api.parseDemoTurnModelOutput(output({ artifact }), request))
  artifact.sections.forEach(section => { section.value = section.value.replace('SIM-99', 'SIM-1') })
  assert.ok(api.parseDemoTurnModelOutput(output({ artifact }), request).artifact)
})

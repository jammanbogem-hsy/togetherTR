// node --experimental-strip-types --experimental-test-module-mocks --import ./scripts/lib/register-ts-hooks.mjs --test scripts/autofillContext.test.mjs
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { registerHooks } from 'node:module'
import * as contextHelper from '../src/lib/curriculum/autofillContext.ts'
registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context) } })
const seen = []
let judgementMode = '제시'
let useJudge = true
let opposeReading = false
mock.module('openai', { defaultExport: class FakeOpenAI {
  embeddings = { create: async ({ input }) => ({ data: input.map(text => ({ embedding: [opposeReading && /긍정적 정서/.test(text) ? -1 : 1, 0] })) }) }
} })
const judges = await import('../src/lib/curriculum/jevJudge.ts')
mock.module('../src/lib/curriculum/jevJudge.ts', { namedExports: {
  ...judges, jevJudgeEnabled: () => useJudge,
  judgeCoreIdeas: async (ctx, options) => {
    seen.push({ ctx, options })
    const climate = /기후위기|폭염/.test(ctx.topic)
    let chosen = options.findIndex(option => ctx.subject === '국어'
      ? (climate ? /논리|근거|설득|주장|글쓰기/.test(option.idea) : /긍정적 정서/.test(option.idea))
      : /자료/.test(option.area))
    if (chosen < 0) chosen = 0
    return { probabilities: Object.fromEntries(options.map((option, index) => [option.key, index === chosen ? 0.9 : 0.001])), confidence: 0.9, mode: judgementMode, elapsedMs: 1 }
  },
} })
const { POST } = await import('../src/app/api/curriculum-sheet/autofill/route.ts')
const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
function tree(file) { return ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }
function find(ast, predicate) { let found; function walk(node) { if (predicate(node)) found = node; ts.forEachChild(node, walk) } walk(ast); assert.ok(found); return found }
function loadFunction(file, name, bindings) {
  const ast = tree(file), fn = find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  const env = { exports: {}, ...bindings }
  vm.runInNewContext(ts.transpileModule(`exports.fn = ${fn.getText(ast).replace(/^export\s+/, '')}`, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, env)
  return env.exports.fn
}
const climateProject = enabled => ({ id: 'fixture', targetSubjects: ['국어', '수학'], currentActivity: 'A-2-1', currentCycle: 1, trainingMode: { enabled }, artifacts: {
  'A-1-2': { content: { '최종 선정 주제': '기후위기: 우리 동네 폭염 자료를 근거로 그늘 제안하기', '선정 근거': '온도 자료를 읽고 근거 있는 주장 글로 제안한다.' } },
  'T-1-1': { content: { '팀 공통 비전': '실제 자료로 지역 문제 해결에 참여한다.' } },
} })
function workspacePayload(enabled) {
  const project = climateProject(enabled), messages = [
    { role: 'assistant', activityCode: 'A-2-1', content: '이전 예시는 독서 경험의 긍정적 정서입니다.' },
    { role: 'user', activityCode: 'A-2-1', content: '기후위기요' },
  ]
  function Sheet() { return null }
  const Workspace = loadFunction('src/components/chat/CurriculumWorkspaceModal.tsx', 'CurriculumWorkspaceModal', {
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(),
    useProjectStore: select => select({ project, messages, currentActivity: 'A-2-1' }),
    buildAutofillContext: contextHelper.buildAutofillContext, resolveAutofillTopic: contextHelper.resolveAutofillTopic, loadTopicFromA12Chat: async () => '', CurriculumSheetModal: Sheet, createPortal: value => value, document: { body: {} },
    require(name) { if (name === 'react/jsx-runtime') return jsx; throw new Error(name) },
  })
  const element = Workspace({ open: true, onClose() {}, projectId: 'fixture', a12Artifact: { ...project.artifacts['A-1-2'].content, selectedTopic: undefined, targetSubjects: ['국어', '수학'] },
    chatContext: '[assistant] 이전 독서 예시', sheetRows: [], onSheetSave() {}, targetGradeGroup: '초5-6' })
  function child(value) { if (!value || typeof value !== 'object') return null; if (Array.isArray(value)) return value.map(child).find(Boolean); return value.type === Sheet ? value : child(value.props?.children) }
  const props = child(element).props
  const payload = loadFunction('src/components/chat/CurriculumSheetModal.tsx', 'autofillCommonPayload', {
    a12Artifact: props.a12Artifact, chatContext: props.chatContext, graphSavedData: null, sheetBand: '5-6학년군', targetGradeGroup: props.targetGradeGroup,
    confirmedTeamBands: ['5-6학년군'], getAutofillExistingRows: () => undefined, ...contextHelper,
  })()
  return payload
}
async function post(body) {
  const response = await POST(new Request('http://localhost/api/curriculum-sheet/autofill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value
}

test('CORE-CTX: 실제 Workspace→Sheet payload→실제 route/DB→mock 판정에서 일반·연수 모두 기후위기 맥락을 잃지 않음', async () => {
  for (const enabled of [false, true]) {
    seen.length = 0
    const payload = workspacePayload(enabled)
    const result = await post({ ...payload, mode: 'coreIdeas' })
    if (enabled && process.env.AUTOFILL_BROWSER_RESPONSE_FILE) fs.writeFileSync(process.env.AUTOFILL_BROWSER_RESPONSE_FILE, JSON.stringify(result))
    assert.match(payload.a12Artifact.selectedTopic, /기후위기/)
    assert.match(payload.chatContext, /선정 근거.*온도 자료/)
    assert.match(payload.chatContext, /최근 교사 발언.*기후위기요/)
    assert.doesNotMatch(payload.chatContext, /이전 독서 예시|긍정적 정서/)
    assert.ok(seen.length >= 2)
    for (const call of seen) { assert.match(call.ctx.topic, /기후위기/); assert.match(call.ctx.chatContext, /기후위기요/) }
    const korean = result.proposals.find(item => item.subject === '국어')
    assert.doesNotMatch(korean.selectedCoreIdea, /긍정적 정서/)
    assert.ok(seen.find(call => call.ctx.subject === '국어').options.some(option => option.idea === korean.selectedCoreIdea), '추천은 DB 후보 원문 그대로')
  }
})

test('CORE-CTX: 한글 정식키 직접 payload와 selectedTopic/명시 topic도 서버에서 읽고 이전 예시는 주제로 추측하지 않음', async () => {
  for (const body of [
    { a12Artifact: { '최종 선정 주제': '기후위기', targetSubjects: ['국어'] } },
    { a12Artifact: { selectedTopic: '기후위기', targetSubjects: ['국어'] } },
    { topic: '기후위기', existingRows: [{ subject: '국어' }] },
  ]) {
    seen.length = 0
    await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', ...body })
    assert.equal(seen[0].ctx.topic, '기후위기')
  }
  assert.equal(contextHelper.resolveAutofillTopic(undefined), '')
  assert.equal(contextHelper.resolveAutofillTopic({ '최종 선정 주제': '기후위기', selectedTopic: '옛 독서 예시' }), '기후위기')
})

test('CORE-CTX: 현재 교사 긴말/짧은말·선정근거·저장결과는 제한 내 보존하고 다른 활동/cycle/시스템/AI 예시는 제외', () => {
  const project = climateProject(true), before = structuredClone(project)
  const value = contextHelper.buildAutofillContext({ project, currentActivity: 'A-2-1', messages: [
    { role: 'user', activityCode: 'A-1-2', content: '옛 활동의 무관한 예시' },
    { role: 'user', activityCode: 'A-2-1', cycleNumber: 0, content: '기후위기요' },
    { role: 'user', activityCode: 'A-2-1', cycleNumber: 2, content: '미래 주기의 다른 주제' },
    { role: 'user', activityCode: 'A-2-1', content: '[연수 양식 저장: A-3]' },
    { role: 'assistant', activityCode: 'A-2-1', content: 'AI 옛 독서 예시' },
    { role: 'user', activityCode: 'A-2-1', content: `긴 설명 시작 ${'조사 장면 '.repeat(250)} 핵심은 폭염 그늘막 제안입니다.` },
  ] })
  assert.match(value.chatContext, /폭염 그늘막 제안/)
  assert.match(value.chatContext, /선정 근거/)
  assert.ok(value.chatContext.length <= contextHelper.AUTOFILL_CONTEXT_LIMIT)
  assert.doesNotMatch(value.chatContext, /옛 활동|미래 주기|연수 양식|AI 옛 독서/)
  assert.deepEqual(project, before)
})

test('CORE-CTX: 기존 coreIdea 부스트가 현재 주제 판정과 다르면 선택 보존+명시 확인 필요', async () => {
  seen.length = 0
  await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', a12Artifact: { selectedTopic: '기후위기', targetSubjects: ['국어'] } })
  const options = seen[0].options
  const different = options.find(option => /긍정적 정서/.test(option.idea)) ?? options.find(option => !/논리|근거|설득|주장|글쓰기/.test(option.idea))
  assert.ok(different)
  const result = await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', a12Artifact: { selectedTopic: '기후위기' }, existingRows: [{ subject: '국어', coreIdea: different.idea }] })
  assert.equal(result.proposals[0].selectedCoreIdea, different.idea, '기존 명시 선택을 임의 대체하지 않음')
  assert.equal(result.proposals[0].requiresConfirmation, true)
  assert.equal(result.proposals[0].mode, '확인')
  assert.match(result.proposals[0].selectionNote, /현재 맥락/)
})

test('CORE-CTX: 맥락이 없거나 판정이 명료화를 요구하면 첫 DB 후보로 강제 기본선택하지 않음', async () => {
  const empty = await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', existingRows: [{ subject: '국어' }] })
  assert.equal(empty.proposals[0].selectedCoreIdea, '')
  assert.equal(empty.proposals[0].requiresConfirmation, true)
  assert.ok(empty.proposals[0].options.length > 0, '후보 비교는 유지')
  judgementMode = '명료화'
  try {
    const uncertain = await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', a12Artifact: { selectedTopic: '기후위기', targetSubjects: ['국어'] } })
    assert.equal(uncertain.proposals[0].selectedCoreIdea, '')
    assert.equal(uncertain.proposals[0].mode, '명료화')
  } finally { judgementMode = '제시' }
})

test('CORE-CTX: 부스트 뒤에도 순위가 낮아 상한 밖인 기존 후보는 value와 표시 목록에 명시 보존', async () => {
  seen.length = 0
  await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', a12Artifact: { selectedTopic: '기후위기', targetSubjects: ['국어'] } })
  const reading = seen[0].options.find(option => /긍정적 정서/.test(option.idea))
  assert.ok(reading)
  useJudge = false; opposeReading = true
  try {
    const response = await post({ mode: 'coreIdeas', targetGradeGroup: '초5-6', a12Artifact: { selectedTopic: '기후위기' }, existingRows: [{ subject: '국어', coreIdea: reading.idea }] })
    const proposal = response.proposals[0]
    assert.equal(proposal.selectedCoreIdea, reading.idea)
    assert.ok(proposal.options.some(option => option.idea === reading.idea))
    assert.equal(proposal.requiresConfirmation, true)
  } finally { useJudge = true; opposeReading = false }
})

test('CORE-CTX: 실제 컴포넌트·route 파일의 문법이 유효하고 미확인 후보의 생성 경로는 차단', async () => {
  for (const file of ['src/components/chat/CurriculumWorkspaceModal.tsx', 'src/components/chat/CurriculumSheetModal.tsx', 'src/app/api/curriculum-sheet/autofill/route.ts']) assert.equal(tree(file).parseDiagnostics.length, 0, file)
  let calls = 0, error = ''
  const apply = loadFunction('src/components/chat/CurriculumSheetModal.tsx', 'applyAutofillReview', {
    autofillReview: { proposals: [{ subject: '국어', selectedCoreIdea: '기존 후보', requiresConfirmation: true }] },
    coreIdeaSelections: { 국어: '기존 후보' }, coreIdeaConfirmations: {}, setAutofillError: value => { error = value },
    fetch: () => { calls++; throw new Error('미확인 상태에서 호출하면 안 됨') },
  })
  await apply()
  assert.equal(calls, 0)
  assert.match(error, /확인/)
})

function saveFixture(patch = true, fail = false) {
  const row = { id: 'r', subject: '국어', coreIdea: '내가 적은 값', standard: '', isCenter: false }
  const refs = { dirty: { current: { 'r:coreIdea': 1 } }, rows: { current: [row] }, pending: { current: new Set(['r']) }, timers: { current: {} } }
  const events = [], timers = []
  let resolve, reject, status = 'idle', error = '', current = refs.rows.current, writes = 0
  const request = () => { writes++; return new Promise((done, failed) => { resolve = done; reject = failed }) }
  const env = {
    rows: current, rowsRef: refs.rows, dirtyCellVersionsRef: refs.dirty, pendingRowIdsRef: refs.pending, patchTimersRef: refs.timers, saveTimerRef: { current: null },
    manualSaveInFlightRef: { current: false }, manualSaveFeedbackTimerRef: { current: null }, manualSaveMountedRef: { current: true },
    onPatchSave: patch ? request : undefined, onSave: request, currentUserName: '교사',
    clearPendingCellTimers: () => { refs.dirty.current = {} }, hasPendingLocalChanges: () => Object.keys(refs.dirty.current).length > 0 || refs.pending.current.size > 0,
    mergeIncomingRows: (incoming, live) => incoming.map(saved => ({ ...saved, ...(refs.dirty.current['r:coreIdea'] ? { coreIdea: live[0].coreIdea } : {}) })),
    setRows: update => { current = typeof update === 'function' ? update(current) : update; refs.rows.current = current },
    setDirty: value => events.push(['dirty', value]), setManualSaveStatus: value => { status = value; events.push(['status', value]) }, setManualSaveError: value => { error = value },
    onRequestArtifactSave: () => events.push(['proposal']), setShowGraphPrompt: () => events.push(['graph']), console: { error() {}, warn() {} },
    setTimeout: callback => { timers.push(callback); return timers.length }, clearTimeout() {},
  }
  const save = loadFunction('src/components/chat/CurriculumSheetModal.tsx', 'handleManualSave', env)
  return { save, events, refs, timers, env, get status() { return status }, get error() { return error }, get writes() { return writes }, get current() { return current },
    settle() { if (fail) reject(new Error('mock failure')); else resolve(patch ? [{ ...row, coreIdea: '서버 응답' }] : undefined) },
  }
}

test('sheet manual save: patch/legacy Promise 완료 전 성공안내·전송 없음, 중복 클릭 잠금, 완료 후 안내와 짧은 만료', async () => {
  for (const patch of [false, true]) {
    const f = saveFixture(patch)
    const pending = f.save()
    try {
      assert.equal(f.status, 'saving')
      assert.equal(f.events.some(event => event[0] === 'proposal'), false)
      await f.save(); assert.equal(f.writes, 1)
    } finally { f.settle(); await pending }
    assert.equal(f.status, 'saved')
    assert.equal(f.events.filter(event => event[0] === 'proposal').length, 1)
    f.timers.at(-1)(); assert.equal(f.status, 'idle')
  }
})

test('sheet manual save: reject는 실패안내·입력/dirty 유지·잘못된 성공/산출물 제안 안 함·다시 시도 가능', async () => {
  const f = saveFixture(true, true)
  const pending = f.save(); f.settle(); await pending
  assert.equal(f.status, 'error')
  assert.match(f.error, /입력한 내용은 그대로/)
  assert.equal(f.current[0].coreIdea, '내가 적은 값')
  assert.equal(f.refs.dirty.current['r:coreIdea'], 1, '원격 snapshot 병합으로 실패 입력을 덮지 않음')
  assert.equal(f.events.some(event => event[0] === 'proposal'), false)
  const retry = f.save(); assert.equal(f.writes, 2); f.settle(); await retry
})

test('sheet manual save: 저장 중 새 입력은 성공 응답에도 최신 값/dirty 버전 보존', async () => {
  const f = saveFixture(true)
  const pending = f.save()
  f.refs.rows.current = [{ ...f.current[0], coreIdea: '저장 중 새 입력' }]
  f.env.setRows(f.refs.rows.current)
  f.refs.dirty.current['r:coreIdea'] = 2
  f.settle(); await pending
  assert.equal(f.current[0].coreIdea, '저장 중 새 입력')
  assert.equal(f.refs.dirty.current['r:coreIdea'], 2)
  assert.deepEqual(f.events.filter(event => event[0] === 'dirty').at(-1), ['dirty', true])
})

test('sheet manual save: 실제 피드백 JSX는 성공 role=status/aria-live polite, 오류 alert, 저장버튼 busy/disabled', () => {
  const ast = tree('src/components/chat/CurriculumSheetModal.tsx')
  const notice = find(ast, node => ts.isJsxExpression(node) && node.expression?.getText(ast).includes("manualSaveStatus !== 'idle'"))
  const button = find(ast, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'MD3Button'
    && node.openingElement.attributes.getText(ast).includes('onClick={handleManualSave}'))
  function render(node, status) {
    const env = { exports: {}, manualSaveStatus: status, manualSaveError: '저장 실패', MD3Button: ({ children, disabled, ...props }) => React.createElement('button', { disabled, 'aria-busy': props['aria-busy'] }, children), handleManualSave() {}, MD3_ICON: { sm: 18 }, require: () => jsx }
    vm.runInNewContext(ts.transpileModule(`exports.view = ${node.getText(ast)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, env)
    return renderToStaticMarkup(env.exports.view)
  }
  const env = { exports: {}, manualSaveStatus: 'saved', manualSaveError: '', require: () => jsx }
  vm.runInNewContext(ts.transpileModule(`exports.view = ${notice.expression.getText(ast)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, env)
  assert.match(renderToStaticMarkup(env.exports.view), /role="status" aria-live="polite"/)
  assert.match(renderToStaticMarkup(env.exports.view), /저장되었습니다/)
  assert.match(render(button, 'saving'), /disabled="" aria-busy="true"/)
})

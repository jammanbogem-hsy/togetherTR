import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { isTrainingProject } from '../src/lib/training/trainingMode.ts'

const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const training = { id: 'training', createdBy: 'host', trainingMode: { enabled: true, coreFormal: true }, teamDiscussions: { 'T-1-1': { active: true } }, teamDiscussionRequests: { 'T-1-1': { pending: true } } }
function execute(code, bindings) {
  const context = { exports: {}, ...bindings }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return context.exports
}
function findNode(predicate) {
  let found
  function walk(node) { if (predicate(node)) found = node; ts.forEachChild(node, walk) }
  walk(tree); assert.ok(found); return found
}
function loadFunction(name, bindings) {
  const node = findNode(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  return execute(`exports.fn = ${node.getText(tree)}`, { isTrainingProject, ...bindings }).fn
}
function retireFixture() {
  const calls = []
  const module = execute(fs.readFileSync(new URL('../src/lib/chat/trainingTeamDiscussion.ts', import.meta.url), 'utf8'), { require(name) {
    if (name === '@/lib/training/trainingMode') return { isTrainingProject }
    if (name === '@/lib/firebase/projects') return {
      async setTeamDiscussion(...args) { calls.push(['discussion', ...args]) },
      async clearTeamDiscussionRequest(...args) { calls.push(['request', ...args]) },
    }
    throw new Error(name)
  } })
  return { calls, retire: module.retireTrainingTeamDiscussion }
}

test('C3: 연수 방의 기존 팀 채팅은 AI 모드로 보며 핵심 정식 활동에도 예외 없음', () => {
  const variable = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'isTeamMode')
  const evaluate = (project, discussionMode) => execute(`exports.value = ${variable.initializer.getText(tree)}`, { project, discussionMode, isTrainingProject }).value
  assert.equal(evaluate(training, 'team_discussion'), false)
  assert.equal(evaluate(training, 'ai_facilitated'), false)
  assert.equal(evaluate({ trainingMode: { enabled: false } }, 'team_discussion'), true)
  assert.equal(evaluate({}, 'team_discussion'), true)
})

test('C3: 방장만 공유 토의·대기 요청 종료, 일반 방·팀원은 저장하지 않고 기존 데이터 보존', async () => {
  const f = retireFixture(), before = structuredClone(training)
  await f.retire(training, 'T-1-1', 'host')
  assert.deepEqual(f.calls, [['discussion', 'training', 'T-1-1', false], ['request', 'training', 'T-1-1']])
  assert.deepEqual(training, before)
  f.calls.length = 0
  await f.retire(training, 'T-1-1', 'member')
  await f.retire({ ...training, trainingMode: { enabled: false } }, 'T-1-1', 'host')
  await f.retire(training, 'A-1-2', 'host')
  assert.equal(f.calls.length, 0)
})

test('C3: 복귀 effect는 오프라인 정리 대기에도 로컬 AI 복귀·제안 해제하고 저장 중복을 막는다', async () => {
  const effect = findNode(node => ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('retireTrainingTeamDiscussion('))
  const calls = [], ref = { current: null }
  let finish
  const bindings = {
    project: training, currentActivity: 'T-1-1', userProfile: { uid: 'host' }, discussionMode: 'team_discussion', pendingTeamDiscussion: { topic: '토의' },
    isTrainingProject, trainingRecoveryRef: ref,
    setDiscussionMode: value => calls.push(['mode', value]), setPendingTeamDiscussion: value => calls.push(['pending', value]),
    retireTrainingTeamDiscussion: () => { calls.push(['remote']); return new Promise(resolve => { finish = resolve }) },
    console: { warn() {} },
  }
  const run = execute(`exports.fn = ${effect.arguments[0].getText(tree)}`, bindings).fn
  run(); run()
  assert.deepEqual(calls.slice(0, 2), [['mode', 'ai_facilitated'], ['pending', null]])
  assert.equal(calls.filter(call => call[0] === 'remote').length, 1)
  finish(); await Promise.resolve(); await Promise.resolve()
  assert.equal(ref.current, null)
  run(); assert.equal(calls.filter(call => call[0] === 'remote').length, 2, '복구 재시도 가능한 ref 정리')
  finish(); await Promise.resolve(); await Promise.resolve()
})

test('C3: 연수용 시작·수락·분석 종료·슬래시 명령을 직접 호출해도 진입/저장하지 않는다', async () => {
  for (const name of ['handleAcceptDiscussion', 'handleConfirmStartDiscussion', 'handleEndDiscussion', 'handleEndDiscussionAndAnalyze']) {
    const fn = loadFunction(name, { proj: training })
    await fn()
  }
  await loadFunction('executeSlashCommand', { proj: training })('team-chat')
  const common = { proj: training, isHost: true, SLASH_COMMANDS: [{ id: 'team-chat', label: '팀 채팅', keywords: ['토의'], hostOnly: true }, { id: 'briefing', label: '브리핑', keywords: ['정리'] }] }
  assert.deepEqual(Array.from(loadFunction('filterSlashCommands', common)(''), command => command.id), ['briefing'])
  const normal = { ...common, proj: { ...training, trainingMode: { enabled: false } } }
  assert.deepEqual(Array.from(loadFunction('filterSlashCommands', normal)(''), command => command.id), ['team-chat', 'briefing'])
  const writes = []
  await loadFunction('handleAcceptDiscussion', { proj: normal.proj, currentActivity: 'T-1-1', pendingTeamDiscussion: { topic: '토의' }, messages: [], setPendingTeamDiscussion() {}, setTeamDiscussion: async (...args) => writes.push(args), setDiscussionMode: mode => writes.push(mode), setTeamDiscussionStartIdx() {} })()
  assert.equal(writes[0][2], true)
  assert.equal(writes[1], 'team_discussion')
})

test('C3: 도움 카드의 다른 도움은 그대로, 팀 토의 버튼만 handler 없으면 숨김', () => {
  const { HelpCard } = execute(fs.readFileSync(new URL('../src/components/chat/HelpCard.tsx', import.meta.url), 'utf8'), { require(name) {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return jsx
    if (name === '@phosphor-icons/react') return new Proxy({}, { get: () => () => null })
    throw new Error(name)
  } })
  const props = { message: '활동', onSearchStandards() {}, onShowExample() {}, onShowGuide() {} }
  const trainingHtml = renderToStaticMarkup(React.createElement(HelpCard, props))
  assert.doesNotMatch(trainingHtml, /팀 토의 하기/)
  assert.equal((trainingHtml.match(/<button/g) ?? []).length, 4, '닫기+일반 도움 3개')
  const normalHtml = renderToStaticMarkup(React.createElement(HelpCard, { ...props, onStartTeamDiscussion() {} }))
  assert.match(normalHtml, /팀 토의 하기/)
  assert.equal((normalHtml.match(/<button/g) ?? []).length, 5)
})

test('C3: 시작 확인·팀원 요청·AI 제안 카드/기본 버튼·도움 경로는 연수 방에서 숨기되 안 선택 안내 유지', () => {
  for (const gate of ['showDiscussionConfirm', 'proj.teamDiscussionRequests?.[currentActivity]?.pending', 'pendingTeamDiscussion']) assert.ok(chat.includes(`{!isTrainingProject(proj) && isHost && ${gate}`))
  assert.match(chat, /\(!isTrainingProject\(proj\) \|\| isWaitingForChoice\)/)
  assert.match(chat, /onStartTeamDiscussion=\{isTrainingProject\(proj\) \? undefined/)
  assert.match(chat, /if \(!userProfile \|\| isTrainingProject\(proj\)\) return/)
})

test('C3 추가: T-1 비전 공동 편집 버튼·기존 열린 모달은 연수 프로젝트면 핵심 정식 여부와 무관하게 숨김', () => {
  const button = findNode(node => ts.isJsxExpression(node) && node.expression?.getText(tree).includes('<CoeditButton label="비전 공동 편집"'))
  const props = { currentActivity: 'T-1-1', coeditHintActivity: null, isTrainingProject, setCoeditHintActivity() {}, setShowTeamVisionWorkspace() {}, require(name) { if (name === 'react/jsx-runtime') return jsx; throw new Error(name) }, CoeditButton: ({ label }) => React.createElement('button', {}, label) }
  const render = proj => renderToStaticMarkup(execute(`exports.render = () => (${button.expression.getText(tree)})`, { ...props, proj }).render())
  for (const coreFormal of [true, false]) assert.equal(render({ ...training, trainingMode: { enabled: true, coreFormal } }), '')
  assert.match(render({ ...training, trainingMode: { enabled: false } }), /비전 공동 편집/)
  const modal = findNode(node => ts.isBinaryExpression(node) && node.right.getText(tree).startsWith('<TeamVisionWorkspaceModal'))
  const visible = proj => execute(`exports.value = ${modal.left.getText(tree)}`, { proj, isTrainingProject, showTeamVisionWorkspace: true }).value
  assert.equal(visible(training), false, '이미 열림 상태가 남아 있어도 모달을 마운트하지 않음')
  assert.equal(visible({ ...training, trainingMode: { enabled: false } }), true)
})

test('C3 추가: 비전 직접 열기를 차단하고 모든 활동의 공동 편집 버튼은 연수에서 숨김·일반에서 유지', () => {
  const arrow = findNode(node => ts.isArrowFunction(node) && node.getText(tree).includes('setShowTeamVisionWorkspace(true)'))
  const open = [], bindings = { isTrainingProject, setCoeditHintActivity() {}, setShowTeamVisionWorkspace: value => open.push(value) }
  execute(`exports.fn = ${arrow.getText(tree)}`, { ...bindings, proj: training }).fn()
  assert.deepEqual(open, [])
  execute(`exports.fn = ${arrow.getText(tree)}`, { ...bindings, proj: { trainingMode: { enabled: false } } }).fn()
  assert.deepEqual(open, [true])
  const buttons = []
  function collect(node) {
    if (ts.isBinaryExpression(node) && /^\(\s*<CoeditButton /.test(node.right.getText(tree))) buttons.push(node)
    ts.forEachChild(node, collect)
  }
  collect(tree)
  assert.equal(buttons.length, 16, 'T·A·Ds·DI·E 공동 편집 전체 활동')
  for (const button of buttons) {
    const activity = button.left.getText(tree).match(/currentActivity === '([^']+)'/)[1]
    const props = { currentActivity: activity, coeditHintActivity: activity, isTrainingProject,
      require(name) { if (name === 'react/jsx-runtime') return jsx; throw new Error(name) },
      CoeditButton: ({ label }) => React.createElement('button', {}, label) }
    const render = proj => renderToStaticMarkup(execute(`exports.render = () => (${button.getText(tree)})`, { ...props, proj }).render())
    for (const coreFormal of [true, false]) assert.equal(render({ trainingMode: { enabled: true, coreFormal } }), '', activity)
    for (const proj of [{}, { trainingMode: { enabled: false } }]) assert.match(render(proj), /공동 편집/, activity)
  }
})

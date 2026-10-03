// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/teamTestFixes.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../src/lib/markdown/remarkPlugins.ts'
import { ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME, buildSystemPrompt } from '../src/lib/prompts/system.ts'
import { buildOutlinePrompts, buildDetailPrompts, parseOutline } from '../src/lib/problem-situation/generation.ts'
import { parsePsReady, cleanPsReady } from '../src/lib/problem-situation/readySignal.ts'
import { ACTIVITY_META, displayActivityCode } from '../src/types/index.ts'
import { applyArtifactSignalBatch, artifactContentEquals } from '../src/lib/chat/artifactSignalBatch.ts'
import { buildT12Structured, sanitizeArtifactSections, sanitizeChatForExtraction } from '../src/lib/artifacts/schemas.ts'

const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function loadChatFunction(name, bindings, sourceTree = tree) {
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(sourceTree)
  assert.ok(found, name)
  const source = ts.transpileModule(`exports.fn = ${found.getText(sourceTree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const context = { exports: {}, ...bindings }
  vm.runInNewContext(source, context)
  return context.exports.fn
}

for (const [text, expected] of [
  ['사회 3-4는 지역 문제·주민 참여로 바꿔서 분석표 만들어 주세요', false],
  ['태양계 대신 기후변화 성취기준을 추가하고 시트로 산출물 저장해 주세요', false],
  ['분석시트 그대로 분석표 만들어 주세요', true],
  ['시트로 산출물 저장해 주세요', true],
]) {
  test(`14: 시트 산출물 요청의 로컬 처리 판정 (${expected}): ${text}`, () => {
    const isRequest = loadChatFunction('isA21SheetArtifactRequest', { currentActivity: 'A-2-1' })
    assert.equal(isRequest(text), expected)
  })
}

test('16: AI 저장 확인 선택 문구는 로컬 시트 저장 요청이 아니다', () => {
  const isRequest = loadChatFunction('isA21SheetArtifactRequest', { currentActivity: 'A-2-1' })
  assert.equal(isRequest('A안을 선택하겠습니다. "이 분석표를 현재 내용으로 산출물에 저장하겠습니다"'), false)
})

test('16: 순수한 시트 기반 분석표 생성 요청은 로컬 처리를 유지한다', () => {
  const isRequest = loadChatFunction('isA21SheetArtifactRequest', { currentActivity: 'A-2-1' })
  assert.equal(isRequest('분석시트 그대로 분석표 만들어 주세요'), true)
})

for (const [text, expected] of [
  ['저장은 됐고요, 이제 A-4 활동으로 이동해 주세요', false],
  ['다음으로 넘어가 주세요', false],
  ['분석시트로 산출물 만들어 주세요', true],
]) {
  test(`17: 이동 의도와 명시적인 시트 산출물 요청을 구분한다 (${expected}): ${text}`, () => {
    const isRequest = loadChatFunction('isA21SheetArtifactRequest', { currentActivity: 'A-2-1' })
    assert.equal(isRequest(text), expected)
  })
}

const problemContext = {
  projectTitle: '동네 폭염과 그늘', targetGradeGroup: '1-2학년군', targetSubjects: ['사회', '국어'],
  nodeContext: '(성취기준 데이터 없음)',
  achievementStandardsAnalysis: '1-2학년군 [2바02-01], 3-4학년군 [4사08-02], 5-6학년군 [6사02-01]',
}
const problemOutline = parseOutline(JSON.stringify({
  drivingQuestion: '우리 동네에서 누가 더위에 힘들까?',
  candidates: [{ title: '그늘 지도', scenario: '필요한 그늘을 제안한다.', dataSources: '동네 지도' }],
  recommended: { index: 0 },
}))

test('22: 여러 학년군 워크숍은 개요·상세 모두 학년군별 역할과 분석 기반 성취기준 연결을 지시한다', () => {
  const ctx = { ...problemContext, teamGradeBands: ['1-2', '3-4', '5-6'] }
  const prompts = [buildOutlinePrompts(ctx), ...['scenario', 'plan'].map(part => buildDetailPrompts(ctx, problemOutline, 0, part))]
  for (const { user } of prompts) {
    assert.match(user, /팀 학년군: 1-2, 3-4, 5-6 — 여러 학년군 협력 수업/)
    assert.match(user, /공통 문제상황 안에서 학년군별 학생 역할·과제·산출물 장면을 나누고/)
    assert.match(user, /A-2-1 분석에 있는 성취기준에서 각 학년군을 고르게 포함한다/)
    assert.match(user, /A-2-1 에 없는 성취기준을 새로 만들지 않는다/)
    assert.ok(user.includes(problemContext.achievementStandardsAnalysis))
  }
})

test('22: 한 학년군 워크숍은 여러 학년군 지시 없이 기존 프롬프트와 같다', () => {
  const ctx = { ...problemContext, teamGradeBands: ['1-2'] }
  assert.deepEqual(buildOutlinePrompts(ctx), buildOutlinePrompts(problemContext))
  for (const part of ['scenario', 'plan']) {
    assert.deepEqual(buildDetailPrompts(ctx, problemOutline, 0, part), buildDetailPrompts(problemContext, problemOutline, 0, part))
  }
  assert.doesNotMatch(buildOutlinePrompts(ctx).user, /팀 학년군:|여러 학년군 협력 수업|학년군별 학생 역할/)
})

test('23·24: 성취기준 코드 뒤 분리된 저장 표시도 행 내용과 탐구 질문을 온전히 읽고 숨긴다', () => {
  const body = '그늘막 위치를 제안하며 [4사08-02]·[6사02-01]을 적용한다.'
  const text = `${body}\n[PS_READY: 제목=그늘 지도|행1=동네 폭염을 조사한다.|행2=주민의 필요를 비교한다.|행3=사진·지도 자료로 그늘막 위치를 제안하며 [4사08-02]·[6사02-01]을 적용한다.][핵심질문=누구에게 그늘이 필요할까?][탐구1=누가 이 길을 이용할까?][탐구2=그늘이 어디에 있을까?][탐구3=어디를 먼저 바꿀까?]`
  const parsed = parsePsReady(text)
  assert.equal(parsed.scenario.row3, `사진·지도 자료로 ${body}`)
  assert.equal(parsed.drivingQuestion, '누구에게 그늘이 필요할까?')
  assert.deepEqual(parsed.essentialQuestions, ['누가 이 길을 이용할까?', '그늘이 어디에 있을까?', '어디를 먼저 바꿀까?'])
  assert.equal(cleanPsReady(text), body)
})

test('23·24: 기존 한 묶음 저장 형식도 일반 대괄호·구분자를 보존하고 저장 표시만 제거한다', () => {
  const body = '[4사08-02]·[6사02-01]을 적용한다. [참고=동네 지도]'
  const signal = '[PS_READY: 제목=그늘 지도|행1=폭염을 살핀다.|행2=[4사08-02]·[6사02-01]을 적용한다.|행3=사진 | 지도 자료를 주민에게 설명한다.|핵심질문=어디에 그늘이 필요할까?|탐구1=누가 더 힘들까?|탐구2=어떤 자료가 필요할까?|탐구3=어떤 제안이 좋을까?]'
  const parsed = parsePsReady(`${body}\n${signal}\n완료했습니다.`)
  assert.equal(parsed.scenario.row2, '[4사08-02]·[6사02-01]을 적용한다.')
  assert.equal(parsed.scenario.row3, '사진 | 지도 자료를 주민에게 설명한다.')
  assert.equal(parsed.drivingQuestion, '어디에 그늘이 필요할까?')
  assert.equal(parsed.essentialQuestions.length, 3)
  assert.equal(cleanPsReady(`${body}\n${signal}\n완료했습니다.`), `${body}\n\n완료했습니다.`)
  assert.equal(parsePsReady(body), null)
  assert.equal(cleanPsReady(`${body}\n[PS_READY: 제목=그늘 [4사08-02]`), body)
})

const rows = Array.from({ length: 10 }, (_, i) => ({
  id: `row-${i}`, subject: i === 0 ? '국어' : '사회', isCenter: i === 0,
  gradeBand: i % 2 ? '3-4학년군' : '5-6학년군',
  coreIdea: `핵심아이디어-${i}`, standard: `[6사02-${i}] 저장된 성취기준 원문-${i}`,
  knowledge: `지식-${i}`, processFunction: `과정-${i}`, valueAttitude: `가치-${i}`, description: '',
}))
const project = {
  title: '기후위기', schoolLevel: '초등학교', targetGradeGroup: '초5-6',
  targetSubjects: ['국어', '사회', '과학', '미술'], mode: 'collaborative', currentCycle: 1,
  teamGradeBands: ['1-2학년군', '3-4학년군', '5-6학년군'], curriculumSheet: rows,
}
function prompt(code, overrides = {}) {
  return buildSystemPrompt(ACTIVITY_META[code].stage, code, { ...project, ...overrides }, '팀+AI')
}
function sheetSection(text) {
  return text.match(/## 저장된 교육과정 분석시트[^]*?임의로 만들지 않는다\./)?.[0] ?? ''
}

test('A: 분석·목표·Ds 프롬프트에 비중심 행을 포함한 저장 시트 10행이 전달된다', () => {
  for (const mode of ['solo', 'collaborative']) {
    for (const code of ['A-2-1', 'A-2-2', 'Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2']) {
      const text = sheetSection(prompt(code, { mode }))
      assert.match(text, /저장 10행 중 10행 제공/)
      for (const row of rows) for (const key of ['gradeBand', 'subject', 'coreIdea', 'standard', 'knowledge', 'processFunction', 'valueAttitude']) {
        assert.ok(text.includes(row[key]), `${code}: ${key} ${row.id}`)
      }
    }
  }
  assert.ok(sheetSection(prompt('A-2-1', { teamGradeBands: undefined })).includes(rows[9].standard))
})

test('A: 다른 활동·빈 시트에는 새 시트 블록이 없고 큰 시트는 명시된 상한을 지킨다', () => {
  for (const code of ['T-1-1', 'A-1-1', 'A-1-2', 'A-2-3', 'DI-1-1', 'E-1-1']) {
    assert.equal(sheetSection(prompt(code)), '', code)
  }
  assert.equal(sheetSection(prompt('A-2-1', { curriculumSheet: [] })), '')
  const manyRows = Array.from({ length: 40 }, (_, i) => ({ ...rows[1], id: `many-${i}` }))
  assert.match(sheetSection(prompt('A-2-1', { curriculumSheet: manyRows })), /저장 40행 중 30행 제공/)
  const longRows = manyRows.map(row => ({ ...row, coreIdea: '긴'.repeat(2000), standard: '원문'.repeat(2000), knowledge: '지식'.repeat(2000), processFunction: '과정'.repeat(2000), valueAttitude: '가치'.repeat(2000) }))
  const text = sheetSection(prompt('A-2-1', { curriculumSheet: longRows }))
  const body = text.split('가치·태도\n')[1].split('\n상한으로')[0]
  assert.ok(body.length <= 16_000)
  assert.match(text, /생략된 행은 미확인/)
  assert.match(text, /…/)
})

test('E: 생성한 현재 제목·절차 머리말은 표시 번호, 이동 신호는 내부 코드다', () => {
  for (const code of ['T-2-1', 'A-2-1', 'Ds-2-1']) {
    const text = prompt(code)
    assert.ok(text.includes(`사용자에게 표시할 현재 활동 제목: **${displayActivityCode(code)}: ${ACTIVITY_META[code].label}**`))
    assert.match(text, new RegExp(`\\n## ${displayActivityCode(code)} `))
    assert.doesNotMatch(text, new RegExp(`\\n## ${code} `))
  }
  assert.match(prompt('T-2-1'), /\[ACTIVITY_ADVANCE: T-2-2\]/)
})

test('B: 다른 팀원이 재시도해도 사용자 메시지는 추가·저장하지 않고 원래 이름을 API에 전달한다', async () => {
  const original = { id: 'host-message', role: 'user', content: '다음으로 가요', displayName: '홍성용', userId: 'host', activityCode: 'A-1-2' }
  const additions = [], saves = [], requests = []
  const send = loadChatFunction('sendMessageDirectly', {
    messages: [original], project: { id: 'test' }, proj: { id: 'test' }, currentActivity: 'A-1-2',
    userProfile: { uid: 'member', displayName: '잠만보잠만보' }, isLoading: false, isAnalyzing: false,
    setIsIdle() {}, setChatError() {}, setIsLoading() {}, clearStreamingText() {}, appendStreamingText() {},
    setFailedChatRequest() {}, getRetryRequest: () => null,
    streamingAccumRef: { current: '' }, streamingFlushRef: { current: null },
    setStreamingState: async () => {}, clearStreamingState: async () => {},
    setInterval: () => 1, clearInterval() {},
    generateMessageId: () => 'new-message', Timestamp: { now: () => 1 },
    addMessage: message => additions.push(message), saveMessage: async (...args) => saves.push(args),
    handleA21SheetArtifactRequest: () => false,
    streamFromAPI: async request => { requests.push(request) }, console,
  })
  await send(original.content, true)
  assert.equal(additions.length, 0)
  assert.equal(saves.length, 0)
  assert.equal(requests[0].length, 1)
  assert.equal(requests[0][0].displayName, '홍성용')
  const buildApiMessages = loadChatFunction('buildApiMessages', {
    currentActivity: 'T-2-1', ACTIVITY_META, displayActivityCode,
    confirmedArtifactReminder: () => '',
  })
  const apiMessages = buildApiMessages(requests[0])
  assert.equal(apiMessages.at(-1).content, '[홍성용]: 다음으로 가요')
  assert.match(apiMessages[0].content, /머리말은 "T-3: 역할 배분"/)
  await send('새 의견')
  assert.equal(additions.length, 1)
  assert.equal(saves.length, 1)
  assert.equal(requests[1][1].displayName, '잠만보잠만보')
})

test('5b: 확정 상태에서만 매 요청 리마인더에 실제 다음 활동 이동 신호를 넣는다', () => {
  for (const status of ['confirmed', 'in_review', 'ai_draft', undefined]) {
    const reminder = loadChatFunction('confirmedArtifactReminder', {
      currentActivity: 'A-2-1', currentArtifact: null,
      proj: { artifacts: { 'A-2-1': { status } } }, getNextActivityCode: () => 'A-2-2',
    })
    const build = loadChatFunction('buildApiMessages', {
      currentActivity: 'A-2-1', ACTIVITY_META, displayActivityCode, confirmedArtifactReminder: reminder,
    })
    const text = build([{ role: 'user', content: '다음 활동으로 가요' }])[0].content
    if (status === 'confirmed') {
      assert.match(text, /현재 활동 산출물은 이미 확정됨/)
      assert.match(text, /재저장하지 말고 \[ACTIVITY_ADVANCE: A-2-2\]만 보낸다/)
    } else assert.doesNotMatch(text, /이미 확정됨|\[ACTIVITY_ADVANCE:/)
  }
})

test('5b: 확정 산출물의 동일 내용 신호만 있고 이동 의도가 있을 때 기존 이동 카드 경로를 쓴다', async () => {
  for (const status of ['confirmed', 'in_review']) {
    const h = artifactHarness(status)
    const process = loadChatFunction('processArtifactSignals', {
      currentActivity: 'T-1-2', isHost: true, project: { mode: 'collaborative' },
      applyArtifactUpdates: h.apply, applyArtifactSignalBatch, applyArtifactConfirm: async () => {},
    })
    let offered = 0
    const offer = loadChatFunction('offerAdvanceAfterConfirmedNoop', {
      isHost: true, handlePromptNextCommand: () => offered++,
    })
    const updates = [{ sections: { '설계 방향': '- **자료 읽기**: 근거를 살핀다' } }]
    const unchanged = await process(updates, [], '')
    offer(unchanged, '다음 활동으로 가요')
    assert.equal(offered, status === 'confirmed' ? 1 : 0)
    offer(unchanged, '고맙습니다')
    assert.equal(offered, status === 'confirmed' ? 1 : 0)
    assert.equal(await process([], [], ''), false)
    assert.equal(await process([{ sections: { '설계 방향': '- **자료 읽기**: 출처도 확인한다' } }], [], ''), false)
  }
  let offered = false
  const memberOffer = loadChatFunction('offerAdvanceAfterConfirmedNoop', {
    isHost: false, handlePromptNextCommand: () => { offered = true },
  })
  memberOffer(true, '넘어가 주세요')
  assert.equal(offered, false)
})

test('2: 실패 요청은 해당 클라이언트·발신자·활동에서만 재시도할 수 있다', () => {
  const failed = { activityCode: 'A-2-1', userId: 'member', messages: [{ role: 'user', content: '분석해 주세요' }] }
  const defaults = { isLoading: false, isAnalyzing: false, currentActivity: 'A-2-1', userProfile: { uid: 'member' }, failedChatRequest: failed }
  for (const [overrides, visible] of [
    [{}, true], [{ failedChatRequest: null }, false],
    [{ userProfile: { uid: 'host' } }, false], [{ currentActivity: 'A-2-2' }, false],
    [{ isLoading: true }, false], [{ isAnalyzing: true }, false],
  ]) {
    const request = loadChatFunction('getRetryRequest', { ...defaults, ...overrides })()
    assert.equal(!!request, visible)
  }
})

test('2: 실패 후 다른 팀원 메시지가 도착해도 재시도는 원래 요청만 재전송한다', async () => {
  const original = { role: 'user', content: '분석해 주세요', displayName: '잠만보잠만보' }
  const requests = [], failures = [], additions = [], saves = []
  const bindings = {
    messages: [original, { role: 'user', content: '다른 의견', displayName: '홍성용' }],
    project: { id: 'test' }, proj: { id: 'test' }, currentActivity: 'A-2-1',
    userProfile: { uid: 'member' }, isLoading: false, isAnalyzing: false,
    setIsIdle() {}, setChatError() {}, setIsLoading() {}, clearStreamingText() {}, appendStreamingText() {},
    getRetryRequest: () => ({ messages: [original] }), setFailedChatRequest: value => failures.push(value),
    streamingAccumRef: { current: '' }, streamingFlushRef: { current: null },
    setStreamingState: async () => {}, clearStreamingState: async () => {},
    setInterval: () => 1, clearInterval() {}, console: { error() {} },
    addMessage: value => additions.push(value), saveMessage: async value => saves.push(value),
    streamFromAPI: async request => { requests.push(request); throw new Error('failed') },
  }
  await loadChatFunction('sendMessageDirectly', bindings)(original.content, true)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), [original])
  assert.equal(additions.length + saves.length, 0)
  assert.equal(failures.at(-1).userId, 'member')
  assert.equal(failures.at(-1).messages.length, 1)
  await loadChatFunction('sendMessageDirectly', { ...bindings, streamFromAPI: async () => {} })(original.content, true)
  assert.equal(failures.at(-1), null)
})

test('13: 방장 또는 생성자가 멤버에 있으면 권한 넘겨받기를 숨기고 부재 시에는 유지한다', () => {
  const page = fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8')
  const pageTree = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hasHost = loadChatFunction('hasMemberHost', {}, pageTree)
  assert.equal(hasHost({ createdBy: 'host', memberUids: ['host', 'member'] }), true)
  assert.equal(hasHost({ hostUid: 'new-host', createdBy: 'former-host', memberUids: ['new-host', 'member'] }), true)
  assert.equal(hasHost({ hostUid: 'gone', createdBy: 'host', memberUids: ['host', 'member'] }), true)
  assert.equal(hasHost({ createdBy: 'host', memberInfo: { host: {}, member: {} } }), true)
  assert.equal(hasHost({ hostUid: 'gone', createdBy: 'gone', memberUids: ['member'] }), false)
  assert.equal(hasHost({ memberUids: ['member'] }), false)
})

test('7: 주제 선정 기준 산출물이 없을 때만 A-2 환영 문구를 자연스럽게 바꾼다', () => {
  let welcomeEffect
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes('showWelcomeMessage(welcome)')) welcomeEffect = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(welcomeEffect)
  const source = ts.transpileModule(`exports.fn = ${welcomeEffect.getText(tree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  for (const hasCriteria of [false, true]) {
    const project = { started: true, hostUid: 'host', mode: 'collaborative', artifacts: hasCriteria ? { 'A-1-1': { content: { '주제 선정 기준': '실생활 연결' } } } : {} }
    let shown
    const context = {
      exports: {}, project, proj: project, currentActivity: 'A-1-2', messagesLoaded: true, messages: [],
      userProfile: { uid: 'host' }, ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME,
      showWelcomeMessage: text => { shown = text },
    }
    vm.runInNewContext(source, context)
    context.exports.fn()
    if (hasCriteria) assert.equal(shown, ACTIVITY_WELCOME['A-1-2'])
    else {
      assert.match(shown, /팀 비전과 학생 삶과의 연결을 기준으로 보면/)
      assert.doesNotMatch(shown, /지금까지 정한 기준|팀이 정한 기준/)
    }
  }
})

function artifactHarness(status = 'confirmed', host = true, withLocal = true) {
  const content = buildT12Structured({ '설계 방향': '- **자료 읽기**: 근거를 살핀다' }, [])
  const artifact = { activityCode: 'T-1-2', id: 'artifact', aiDraft: content, status, currentVersion: 3 }
  const writes = [], local = [], proposals = [], confirmations = []
  const apply = loadChatFunction('applyArtifactUpdates', {
    currentActivity: 'T-1-2', currentArtifact: withLocal ? artifact : null, messages: [],
    project: { id: 'test', mode: 'collaborative', artifacts: { 'T-1-2': { content, status, version: 3 } } },
    proj: { id: 'test' }, isHost: host, userProfile: { uid: 'host', displayName: '홍성용' },
    sanitizeArtifactSections, sanitizeChatForExtraction, enrichArtifactSections: value => value,
    buildT12Structured, artifactContentEquals, ACTIVITY_META, Timestamp: { now: () => 1 },
    flashCoeditHint() {}, validateRequiredSections: () => true, setChatError() {},
    setCurrentArtifact: value => local.push(value),
    setProjectArtifact: async (...args) => writes.push(args), setActivityStatus: async () => {},
    proposeArtifactToHost: async (...args) => proposals.push(args), detectMissingFields: () => [],
    applyArtifactConfirm: async code => confirmations.push(code),
  })
  return { apply, writes, local, proposals, confirmations, artifact }
}

test('C: 동일 내용 업데이트는 확정·버전을 유지하고 저장·로컬 갱신·팀원 제안이 없다', async () => {
  for (const host of [true, false]) {
    for (const withLocal of [true, false]) {
      const h = artifactHarness('confirmed', host, withLocal)
      await h.apply({ '설계 방향': '- **자료 읽기**: 근거를 살핀다' })
      await h.apply({ '설계 방향': '- **자료 읽기**: 근거를 살핀다' }, undefined, undefined, 'ai', true)
      assert.equal(h.writes.length + h.local.length + h.proposals.length + h.confirmations.length, 0)
      assert.equal(h.artifact.status, 'confirmed')
      assert.equal(h.artifact.currentVersion, 3)
    }
  }
})

test('C: 실제 수정은 기존대로 버전 증가·검토 중, 동일 내용의 명시적 확정은 별도 처리한다', async () => {
  const changed = artifactHarness()
  await changed.apply({ '설계 방향': '- **자료 읽기**: 출처도 확인한다' })
  assert.equal(changed.writes.length, 1)
  assert.equal(changed.local[0].currentVersion, 4)
  assert.equal(changed.local[0].status, 'in_review')
  const confirm = artifactHarness('in_review')
  await confirm.apply({ '설계 방향': '- **자료 읽기**: 근거를 살핀다' }, undefined, undefined, 'ai', true)
  assert.equal(confirm.confirmations.length, 1)
  assert.equal(confirm.writes.length, 0)
  assert.equal(artifactContentEquals({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }), true)
  assert.equal(artifactContentEquals({ b: [2, 3] }, { b: [3, 2] }), false)
})

test('D: 단일 물결표는 글자 그대로, 이중 물결표만 취소선으로 렌더링한다', () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: REMARK_PLUGINS,
  }, '1~3개, 3~5개, ~해야 한다, ~~지울 말~~'))
  assert.match(html, /1~3개, 3~5개, ~해야 한다/)
  assert.match(html, /<del>지울 말<\/del>/)
  assert.equal((html.match(/<del>/g) ?? []).length, 1)
})

// ─── TASK-013: #18 · #21 · #12 ─────────────────────────────
const { canAutoFillContentCells } = await import('../src/lib/curriculum/sheetContentAutofill.ts')
const { extractFallbackStandards } = await import('../src/lib/problem-situation/standardsFallback.ts')
const { resolveLayoutState, NARROW_DEFAULT_STATE } = await import('../src/components/layout/useLayoutToggle.ts')

test('18: 성취기준이 빈 행은 내용 칸을 자동 보강하지 않는다', () => {
  const coreIdea = '지구의 기후시스템은 태양 복사와 지구 복사, 인간 활동 등의 영향을 받는다.'
  assert.equal(canAutoFillContentCells({ coreIdea, standard: '' }), false)
  assert.equal(canAutoFillContentCells({ coreIdea, standard: '   ' }), false)
  assert.equal(canAutoFillContentCells({ coreIdea: '', standard: '[4과16-01] 기후변화 현상의 예를 알고' }), false)
  assert.equal(canAutoFillContentCells({ coreIdea, standard: '[4과16-01] 기후변화 현상의 예를 알고' }), true)
  const sheet = fs.readFileSync(new URL('../src/components/chat/CurriculumSheetModal.tsx', import.meta.url), 'utf8')
  assert.match(sheet, /if \(!canAutoFillContentCells\(row\)\) return row/)
})

test('21: 지식 그래프가 없으면 A-2-1 분석표·분석시트에서 학년군별 성취기준 목록을 만든다', () => {
  const analysisRows = [
    { subject: '1-2학년군 국어', standard: '필자는 … 글을 쓴다. [2국03-02] 쓰기에 흥미를 가지며 자신의 생각이나 느낌을 문장으로 표현한다.' },
    { subject: '3-4학년군 과학', standard: '[4과16-01] 기후변화 현상의 예를 알고 토의할 수 있다. / [4과16-03] 기후변화 대응 방법을 조사하고 실천할 수 있다.' },
    { subject: '5-6학년군 사회', standard: '[6사02-01] 우리나라의 계절별 기후 특징을 자료에서 탐구한다.' },
  ]
  const sheetRows = [{ gradeBand: '5-6학년군', subject: '과학', standard: '[6과06-01] 기상 요소를 조사한다.' }, { subject: '사회', standard: '[6사02-01] 중복' }]
  const list = extractFallbackStandards({ analysisRows, sheetRows })
  assert.deepEqual(list.map(item => item.code), ['2국03-02', '4과16-01', '4과16-03', '6과06-01', '6사02-01'])
  assert.deepEqual(list.map(item => item.gradeBand), ['1-2학년군', '3-4학년군', '3-4학년군', '5-6학년군', '5-6학년군'])
  assert.equal(list.find(item => item.code === '4과16-01').subject, '과학')
  assert.match(list.find(item => item.code === '4과16-01').text, /^기후변화 현상의 예를 알고/)
  assert.equal(list.find(item => item.code === '6사02-01').text, '우리나라의 계절별 기후 특징을 자료에서 탐구한다.')
  // 행 데이터가 없으면 산출물 텍스트에서 코드만 읽고, 아무것도 없으면 빈 목록(기존 안내 유지)
  assert.deepEqual(extractFallbackStandards({ analysisText: 'rows: [object Object]\ncommonElements: [4사08-02] 지역 문제' }).map(item => item.code), ['4사08-02'])
  assert.deepEqual(extractFallbackStandards({ analysisRows: '[object Object]', sheetRows: null }), [])
  const designer = fs.readFileSync(new URL('../src/components/problem-situation/ProblemSituationDesigner.tsx', import.meta.url), 'utf8')
  assert.match(designer, /fallbackStandards=\{fallbackStandards\}/)
  assert.match(designer, /setStandardSources\(\{ analysisRows: d\?\.artifacts\?\.\['A-2-1'\]\?\.content\?\.rows, sheetRows: d\?\.curriculumSheet \}\)/)
})

test('12: 좁은 화면은 저장값이 없으면 사이드바·산출물을 접고, 넓은 화면·사용자 저장값은 그대로 둔다', () => {
  assert.deepEqual(resolveLayoutState(null, true), NARROW_DEFAULT_STATE)
  assert.deepEqual(NARROW_DEFAULT_STATE, { stage: true, sidebar: false, artifact: false })
  assert.deepEqual(resolveLayoutState(null, false), { stage: true, sidebar: true, artifact: true })
  assert.deepEqual(resolveLayoutState({ sidebar: true }, true), { stage: true, sidebar: true, artifact: false })
  assert.deepEqual(resolveLayoutState({ stage: false, sidebar: false, artifact: true }, false), { stage: false, sidebar: false, artifact: true })
  const hook = fs.readFileSync(new URL('../src/components/layout/useLayoutToggle.ts', import.meta.url), 'utf8')
  // 좁은 화면 선택은 별도 키에 저장해 넓은 화면 저장값을 덮어쓰지 않는다.
  assert.match(hook, /`layoutPanels:\$\{projectId\}:narrow`/)
  assert.match(hook, /writeStorage\(projectId, mode, /)
})

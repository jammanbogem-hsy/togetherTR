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
import { buildSystemPrompt } from '../src/lib/prompts/system.ts'
import { ACTIVITY_META, displayActivityCode } from '../src/types/index.ts'
import { artifactContentEquals } from '../src/lib/chat/artifactSignalBatch.ts'
import { buildT12Structured, sanitizeArtifactSections, sanitizeChatForExtraction } from '../src/lib/artifacts/schemas.ts'

const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function loadChatFunction(name, bindings) {
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, name)
  const source = ts.transpileModule(`exports.fn = ${found.getText(tree)}`, {
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
  })
  const apiMessages = buildApiMessages(requests[0])
  assert.equal(apiMessages.at(-1).content, '[홍성용]: 다음으로 가요')
  assert.match(apiMessages[0].content, /머리말은 "T-3: 역할 배분"/)
  await send('새 의견')
  assert.equal(additions.length, 1)
  assert.equal(saves.length, 1)
  assert.equal(requests[1][1].displayName, '잠만보잠만보')
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

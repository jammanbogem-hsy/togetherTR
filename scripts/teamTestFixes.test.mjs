// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/teamTestFixes.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import * as phosphorIcons from '@phosphor-icons/react'
import { STAGE_COLOR } from '../src/lib/ui/stageColors.ts'
import { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, REPORT_ICON_TONES, reportStageColors } from '../src/components/modals/reportDashboardStyles.ts'
import { cleanReportMarkdown } from '../src/lib/markdown/reportDisplay.ts'
import { buildReportPrintDocument, cloneReportForPrint, REPORT_PRINT_WINDOW_CSS } from '../src/components/modals/printReport.ts'
import { reportDom, staticReportDom, ReportDomElement } from './lib/reportDomFixture.mjs'
import { layoutReportPdf, reportPdfFilename, REPORT_PDF_PAGE } from '../src/components/modals/reportPdfLayout.ts'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { REMARK_PLUGINS } from '../src/lib/markdown/remarkPlugins.ts'
import { REPORT_SECTIONS, findReportSection } from '../src/lib/report/reportSections.ts'
import { ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME, buildSystemPrompt } from '../src/lib/prompts/system.ts'
import { buildOutlinePrompts, buildDetailPrompts, parseOutline } from '../src/lib/problem-situation/generation.ts'
import { parsePsReady, cleanPsReady } from '../src/lib/problem-situation/readySignal.ts'
import { serializeArtifactForPrompt } from '../src/lib/artifacts/serializeArtifactForPrompt.ts'
import { validateProblemStandards } from '../src/lib/problem-situation/validateStandards.ts'
import { withCurriculumReadCache, readOncePerCurriculumContext } from '../src/lib/curriculum/readCache.ts'
import { buildCurriculumContext, buildReplacementStandardsContext } from '../src/lib/curriculum/contextInject.ts'
import { ACTIVITY_META, STAGES, displayActivityCode } from '../src/types/index.ts'
import { applyArtifactSignalBatch, artifactContentEquals } from '../src/lib/chat/artifactSignalBatch.ts'
import { findDroppedTableRows, userAskedToDeleteRows } from '../src/lib/chat/tableRowGuard.ts'
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
  const source = ts.transpileModule(`exports.fn = ${found.getText(sourceTree).replace(/^export\s+/, '')}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const context = { exports: {}, ...bindings }
  vm.runInNewContext(source, context)
  return context.exports.fn
}

test('25: A-2-1 표 행은 학년군·교과·성취기준 원문과 세 차원을 빠짐없이 펼친다', () => {
  const content = {
    _schema: 'A-2-1',
    rows: [
      { subject: '3-4학년군 사회', standard: '[4사08-02] 지역사회의 문제 해결에 참여한다.', coreIdea: '주민 참여', knowledgeUnderstanding: '지역 문제', processFunction: '주민 인터뷰', valueAttitude: '시민 참여' },
      { gradeBand: '5-6학년군', subject: '사회', standard: '[6사02-01] 계절별 기후를 탐구한다.', knowledgeUnderstanding: '계절별 기후', processFunction: '자료 분석', valueAttitude: '대응 실천' },
    ],
    commonElements: '자료로 근거를 찾는다.\n주민의 필요를 살핀다.',
  }
  const original = structuredClone(content)
  const text = serializeArtifactForPrompt(content)
  assert.doesNotMatch(text, /\[object Object\]|_schema/)
  assert.match(text, /학년군 \| 교과 \| 핵심 아이디어 \| 성취기준 코드\+원문 \| 지식·이해 \| 과정·기능 \| 가치·태도/)
  assert.match(text, /3-4학년군 사회 \| 주민 참여 \| \[4사08-02\] 지역사회의 문제 해결에 참여한다\. \| 지역 문제 \| 주민 인터뷰 \| 시민 참여/)
  assert.match(text, /5-6학년군 \| 사회 \|  \| \[6사02-01\] 계절별 기후를 탐구한다\./)
  assert.ok(text.includes(content.commonElements))
  assert.deepEqual(content, original)
})

test('25: 다른 산출물의 객체 표·중첩 객체도 읽을 수 있고 문자열·빈 입력은 그대로다', () => {
  const text = serializeArtifactForPrompt({
    subjectGoals: [{ subject: '사회', goal: '그늘 위치를 제안한다.', evidence: { tool: '지도', sources: ['사진', '인터뷰'] } }, { subject: '국어', goal: '주장 글을 쓴다.' }],
    profile: { constraints: { devices: '태블릿 2인 1대' }, knowledge: ['지도 읽기', '생활 경험'] },
  })
  assert.doesNotMatch(text, /\[object Object\]/)
  assert.match(text, /subject \| goal \| evidence/)
  for (const value of ['사회', '그늘 위치를 제안한다.', '지도', '사진', '인터뷰', '국어', '주장 글을 쓴다.', 'devices: 태블릿 2인 1대', '지도 읽기']) assert.ok(text.includes(value))
  assert.equal(serializeArtifactForPrompt('  원문\n두 번째 줄  '), '  원문\n두 번째 줄  ')
  assert.equal(serializeArtifactForPrompt(null), '')
  assert.equal(serializeArtifactForPrompt(undefined), '')
  assert.equal(serializeArtifactForPrompt([]), '')
  assert.equal(serializeArtifactForPrompt({ count: 2, supported: true }), 'count: 2\nsupported: true')
})

test('25: 생성된 성취기준 연결은 A-2-1에 있는 코드만 유지하며 본문·출처는 보존한다', () => {
  const analysis = serializeArtifactForPrompt({ rows: [{ subject: '3-4학년군 사회', standard: '[4사08-02] 지역 문제 해결' }, { subject: '5-6학년군 사회', standard: '[6사02-01] 기후변화' }] })
  const valid = { standardId: '4사08-02', subject: '사회', isCenter: true, connection: '주민에게 제안한다.' }
  const validBracketed = { ...valid, standardId: '[6사02-01]', isCenter: false }
  const outside = { ...valid, standardId: '4사03-01', connection: '문화 다양성' }
  const detail = { fullScenario: '동네 그늘막을 제안한다.', standardsAlignment: [valid, outside, validBracketed], realData: [{ label: '공개 지도' }] }
  const checked = validateProblemStandards(detail, analysis)
  assert.deepEqual(checked.standardsAlignment, [valid, validBracketed])
  assert.equal(checked.fullScenario, detail.fullScenario)
  assert.deepEqual(checked.realData, detail.realData)
  assert.equal(detail.standardsAlignment.length, 3)
  assert.deepEqual(validateProblemStandards({ ...detail, standardsAlignment: [outside] }, analysis).standardsAlignment, [])
  for (const empty of [undefined, '', 'rows: [object Object]']) assert.equal(validateProblemStandards(detail, empty), detail)
  const plan = { learningContent: '지역 문제', artifacts: '그늘 지도', alignmentCheck: '평가와 연결' }
  assert.equal(validateProblemStandards(plan, analysis), plan)
})

test('25: generate 상세 응답은 클라이언트로 돌려주기 전에 성취기준을 검증한다', async () => {
  const route = fs.readFileSync(new URL('../src/app/api/problem-situation/generate/route.ts', import.meta.url), 'utf8')
  const routeTree = ts.createSourceFile('route.ts', route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const detail = { fullScenario: '주민의 그늘 필요를 조사한다.', standardsAlignment: ['4사08-02', '4사03-01'].map(standardId => ({ standardId, subject: '사회', isCenter: false, connection: '조사' })) }
  const post = loadChatFunction('POST', {
    Response, resolveGeneratePhase: () => ({ phase: 'detail', candidateIndex: 1, part: 'scenario' }),
    buildNodeContext: () => '', buildDetailPrompts: () => ({ system: '', user: '' }),
    complete: async () => '', DETAIL_MAX_TOKENS: 1,
    parseCandidateDetail: () => detail, recoverTruncatedJson: () => null, validateProblemStandards,
  }, routeTree)
  const response = await post({ json: async () => ({ projectTitle: '기후위기', targetGradeGroup: '3-4', targetSubjects: ['사회'], achievementStandardsAnalysis: '[4사08-02] 지역 문제 해결' }) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.index, 1)
  assert.equal(body.part, 'scenario')
  assert.deepEqual(body.detail.standardsAlignment.map(item => item.standardId), ['4사08-02'])
})

test('15a: 성취기준 코드 뒤 원문이 있어도 검증하고 남긴 값은 바꾸지 않는다', () => {
  const good = { standardId: '2국03-02 쓰기에 흥미를 가지며 생각을 표현한다.', subject: '국어', isCenter: true, connection: '포스터 문장을 쓴다.' }
  const bracketed = { ...good, standardId: '[2국03-02] 쓰기 활동' }
  const outside = { ...good, standardId: '2국03-03 글을 쓴다.' }
  const result = validateProblemStandards({ standardsAlignment: [good, bracketed, outside] }, '[2국03-02] 쓰기에 흥미를 가진다.')
  assert.deepEqual(result.standardsAlignment, [good, bracketed])
})

test('21a: 한 연결의 여러 코드 중 A-2-1 밖의 코드만 제거하며 원본은 보존한다', () => {
  const alignment = { standardId: '4과16-01·4과16-03', subject: '과학', isCenter: true, connection: '자료를 비교한다.' }
  const reverse = { ...alignment, standardId: '[4과16-03]·[4과16-01] 자료 비교' }
  const grouped = { ...alignment, standardId: '[4과16-03·4과16-01·6과01-01]' }
  const allOutside = { ...alignment, standardId: '4과16-03·6과01-01' }
  const result = validateProblemStandards({ standardsAlignment: [alignment, reverse, grouped, allOutside] }, '[4과16-01] 자료를 살펴본다.')
  assert.deepEqual(result.standardsAlignment, [
    { ...alignment, standardId: '4과16-01' },
    { ...reverse, standardId: '[4과16-01] 자료 비교' },
    { ...grouped, standardId: '[4과16-01]' },
  ])
  assert.equal(alignment.standardId, '4과16-01·4과16-03')
})

test('21a: 여러 코드가 모두 허용되면 표기·원문을 그대로 유지한다', () => {
  const alignment = { standardId: '[4과16-01]·[4과16-03] 자료 비교', subject: '과학', isCenter: false, connection: '관찰한다.' }
  const result = validateProblemStandards({ standardsAlignment: [alignment] }, '4과16-01 / 4과16-03')
  assert.equal(result.standardsAlignment[0], alignment)
})

test('21b: dev JSON 읽기는 한 동기 컨텍스트 안에서만 공유하고 다음 요청에는 새로 읽는다', () => {
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    let reads = 0
    const read = () => readOncePerCurriculumContext('sample', () => ({ version: ++reads }))
    const first = withCurriculumReadCache(() => {
      const value = read()
      assert.equal(read(), value)
      assert.equal(withCurriculumReadCache(read), value)
      return value
    })
    const second = withCurriculumReadCache(read)
    assert.equal(first.version, 1)
    assert.equal(second.version, 2)
    assert.notEqual(first, second)
    assert.equal(read().version, 3)
    assert.throws(() => withCurriculumReadCache(() => { read(); throw new Error('read failure') }), /read failure/)
    assert.equal(withCurriculumReadCache(read).version, 5)
  } finally {
    if (before === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before
  }
})

test('21b: production에서는 기존 로더 캐시·읽기 경로를 그대로 실행한다', () => {
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    let reads = 0
    withCurriculumReadCache(() => {
      const read = () => readOncePerCurriculumContext('sample', () => ++reads)
      assert.equal(read(), 1)
      assert.equal(read(), 2)
    })
  } finally {
    if (before === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before
  }
})

test('15c: 이동 전 수정·보완을 요청하면 동일 내용 응답이어도 이동 카드를 띄우지 않는다', () => {
  let offered = 0
  const offer = loadChatFunction('offerAdvanceAfterConfirmedNoop', { isHost: true, handlePromptNextCommand: () => offered++ })
  for (const text of ['다음으로 넘어가기 전에 고쳐 주세요', '다음 활동으로 가기 전에 수정해 주세요', '다음 단계 전에 바꿔 주세요', '다음으로 넘기기 전에 보완해 주세요']) offer(true, text)
  assert.equal(offered, 0)
  offer(true, '다음 활동으로 이동해 주세요')
  assert.equal(offered, 1)
})

test('15d: 최근 교사의 대체 요청에서 주민 참여 성취기준과 원문을 찾아 A-2-1 컨텍스트에 넣는다', () => {
  const messages = [
    { role: 'assistant', content: '문화 다양성 성취기준입니다.' },
    { role: 'user', content: '[시스템 리마인더] 현재 활동 A-3' },
    { role: 'user', content: '[잠만보잠만보]: 사회 3-4는 지역 문제·주민 참여 성취기준으로 바꿔 주세요' },
  ]
  const block = buildReplacementStandardsContext(messages, '초3-4')
  assert.match(block, /대체 후보 성취기준/)
  assert.match(block, /\[4사08-02\].*주민 자치와 주민 참여의 중요성/)
  assert.match(block, /후보에서만 고르고, 후보가 없으면 확인 필요/)
  assert.doesNotMatch(block, /중1-3|9[가-힣]+\d{2}-\d{2}/)
  assert.ok(buildCurriculumContext('A-2-1', messages, '초3-4').includes(block))
  assert.doesNotMatch(buildCurriculumContext('A-2-2', messages, '초3-4'), /대체 후보 성취기준/)
  assert.equal(buildReplacementStandardsContext([{ role: 'user', content: '지역 문제·주민 참여가 중요해요' }], '초3-4'), '')
  assert.equal(buildReplacementStandardsContext(messages, '중1-3'), '')
})

test('15d: 여러 학년군의 후보는 각각 최대 5개이며 해당 학년군 코드만 제공한다', () => {
  const block = buildReplacementStandardsContext([{ role: 'user', content: '지역 문제·주민 참여 성취기준으로 바꿔 주세요' }], '초1-2', ['1-2', '3-4', '5-6'])
  const expected = { '1-2학년군': '2', '3-4학년군': '4', '5-6학년군': '6' }
  for (const [band, content] of [...block.matchAll(/### ([^\n]+)\n([\s\S]*?)(?=\n### |\n\n### |\n▶|$)/g)].map(match => [match[1], match[2]])) {
    const codes = [...content.matchAll(/\[?(\d[가-힣]{1,3}\d{2}-\d{2})\]? —/g)].map(match => match[1])
    assert.ok(codes.length <= 5)
    assert.equal(new Set(codes).size, codes.length)
    assert.ok(codes.every(code => code.startsWith(expected[band])), band)
  }
  assert.equal([...block.matchAll(/### /g)].length, 3)
  const graph = { centerNode: { id: 'x', label: '[4사03-01]', text: '사회 변화', subjectId: 'sub_soc' }, selectedStandards: [], agentNotes: [] }
  assert.match(buildCurriculumContext('A-2-1', [{ role: 'user', content: '지역 문제·주민 참여로 바꿔 주세요' }], '초3-4', undefined, graph), /대체 후보 성취기준/)
})

test('15b: 부분 답 재시도는 같은 ID의 Firestore 문서와 로컬 메시지를 대체한다', async () => {
  const original = { role: 'user', content: '자료를 정리해 주세요', displayName: '잠만보잠만보' }
  const writes = [], additions = [], replacements = []
  const send = loadChatFunction('sendMessageDirectly', {
    project: { id: 'test' }, proj: { id: 'test' }, currentActivity: 'A-2-1', messages: [original],
    userProfile: { uid: 'member' }, isLoading: false, isAnalyzing: false,
    getRetryRequest: () => ({ messages: [original], assistantMessageId: 'partial-answer' }),
    setIsIdle() {}, setChatError() {}, setFailedChatRequest() {}, setIsLoading() {},
    clearStreamingText() {}, appendStreamingText() {}, streamingAccumRef: { current: '' }, streamingFlushRef: { current: null },
    setStreamingState: async () => {}, clearStreamingState: async () => {}, setInterval: () => 1, clearInterval() {},
    discardResponseAfterActivityChange: async () => false,
    parseTeamGradeBandsSignal: () => null, parseDiscussionSignal: () => null, parseActivityAdvance: () => null,
    parseActivityReturn: () => null, parseArtifactConfirm: text => ({ codes: [], cleanText: text }),
    parseArtifactUpdates: text => ({ updates: [], cleanText: text }), gateArtifactUpdates: (updates, confirmCodes) => ({ updates, confirmCodes, notices: [] }), appendSaveGateNotice: text => text,
    displayedMessageContent: (_p, m) => m.content, trainingUserTexts: [], shouldReplyTrainingQuietly: () => false,
    parseHelpCard: text => ({ cleanText: text }),
    parseOptions: () => null, parseActionCard: () => null, Timestamp: { now: () => 1 },
    generateMessageId: () => { throw new Error('재시도에 새 ID를 만들면 안 된다') },
    addMessage: message => additions.push(message), replaceMessage: (...args) => replacements.push(args),
    saveMessage: async (...args) => writes.push(args), processArtifactSignals: async () => false,
    offerAdvanceAfterConfirmedNoop() {}, console,
    streamFromAPI: async (_messages, _chunk, done) => { assert.equal(await done('완성된 답변'), 'partial-answer') },
  })
  await send(original.content, true)
  assert.equal(additions.length, 0)
  // TASK-017: 세 번째 인자로 새 응답 필드(actionCard 등)를 함께 넘긴다.
  assert.deepEqual(replacements.map(args => args.slice(0, 2)), [['partial-answer', '완성된 답변']])
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], 'test')
  assert.equal(writes[0][1], 'A-2-1')
  assert.equal(writes[0][3], 'partial-answer')
  assert.equal(writes[0][2].content, '완성된 답변')
})

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
    shouldReplyTrainingQuietly: () => false, TRAINING_QUIET_REPLY: '저장했습니다.',
    displayedMessageContent: (_p, m) => m.content, trainingUserTexts: [],
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
    displayedMessageContent: (_p, m) => m.content, trainingUserTexts: [],
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

test('7: 주제 선정 기준 산출물이 없을 때만 A-2 환영 문구를 자연스럽게 바꾼다', async () => {
  // TASK-024: 환영 effect 가 판정 함수를 쓰므로 실행 환경에 함께 넣는다.
  const { shouldCreateWelcomeMessage } = await import('../src/lib/activity/navigationDecisions.ts')
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
      userProfile: { uid: 'host' }, ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME, shouldCreateWelcomeMessage, messagesLoadedByFallback: false,
      isTrainingActivity: () => false, buildTrainingWelcome: () => '',
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
    isTrainingActivity: () => false,
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

// ─── TASK-016: 워크숍 빈 성취기준 재요청 · 그래프 비움 · 좁은 화면 경계 ─────────
const { isEmptyScenarioDetail, usableGraphData } = await import('../src/lib/problem-situation/designerState.ts')
const { NARROW_QUERY: TASK016_NARROW_QUERY } = await import('../src/components/layout/useLayoutToggle.ts')

test('016a: 성취기준 연결이 빈 scenario 조각만 재요청 대상이고, 자동 재요청은 1회 뒤 empty 안내로 끝난다', () => {
  assert.equal(isEmptyScenarioDetail('scenario', { fullScenario: '전문', standardsAlignment: [], realData: [] }), true)
  assert.equal(isEmptyScenarioDetail('scenario', { fullScenario: '전문' }), true)
  assert.equal(isEmptyScenarioDetail('scenario', null), true)
  assert.equal(isEmptyScenarioDetail('scenario', { standardsAlignment: [{ standardId: '4과16-01', subject: '과학', connection: '', isCenter: false }] }), false)
  assert.equal(isEmptyScenarioDetail('plan', { learningContent: '' }), false)
  const designer = fs.readFileSync(new URL('../src/components/problem-situation/ProblemSituationDesigner.tsx', import.meta.url), 'utf8')
  assert.match(designer, /if \(autoRetry\) return loadCandidateDetail\(outline, index, gen, \['scenario'\], false\)/)
  assert.match(designer, /setDetailStatus\(prev => \(\{ \.\.\.prev, \[index\]: 'empty' \}\)\)/)
  assert.match(designer, /성취기준 연결을 불러오지 못했어요 — 다시 생성/)
  assert.match(designer, /selectedStatus === 'error' \|\| selectedStatus === 'empty'/)
})

test('016b: 비워진 그래프는 null 로 바뀌어 대체 성취기준 목록이 보인다', () => {
  const center = { id: 'E6SOC02-01', text: '기후', subjectId: 'social' }
  assert.equal(usableGraphData(null), null)
  assert.equal(usableGraphData({ centerNode: null, selectedStandards: [], agentNotes: [] }), null)
  assert.equal(usableGraphData({ centerNode: null, selectedStandards: [center] })?.selectedStandards.length, 1)
  assert.equal(usableGraphData({ centerNode: center, selectedStandards: [] })?.centerNode, center)
  const designer = fs.readFileSync(new URL('../src/components/problem-situation/ProblemSituationDesigner.tsx', import.meta.url), 'utf8')
  assert.match(designer, /setLocalGraphData\(usableGraphData\(d\?\.graphSavedData\)\)/)
})

test('016c: 좁은 화면 미디어쿼리는 정확히 900px 미만(소수 폭 포함)이다', () => {
  assert.equal(TASK016_NARROW_QUERY, 'not all and (min-width: 900px)')
})

// ─── TASK-017: 대체 후보 범위·순위·상한·트리거, 재시도 대체 시각 유지 ─────────
const task017Ctx = await import('../src/lib/curriculum/contextInject.ts')
const task017Rows = [
  { gradeBand: '3-4학년군', subject: '사회', coreIdea: '우리 사회는 다양한 사회문제를 경험하고 시민의 역할이 중요하다.', standard: '[4사03-01] 최근 사회 변화의 양상과 특징을 파악한다.' },
  { gradeBand: '3-4학년군', subject: '과학', coreIdea: '지구의 기후시스템은 인간 활동 등의 영향을 받는다.', standard: '[4과13-02] 태양계 구성원을 알고 조사할 수 있다.' },
  { gradeBand: '5-6학년군', subject: '사회', coreIdea: '기후 환경은 지역의 생활양식에 중요하게 작용한다.', standard: '[6사02-01] 우리나라의 계절별 기후 특징을 탐구한다.' },
]
const task017Bands = ['1-2', '3-4', '5-6']
const task017Msg = text => [{ role: 'assistant', content: '분석을 시작합니다.' }, { role: 'user', content: `[잠만보잠만보]: ${text}` }]
const task017Codes = block => [...block.matchAll(/\[(\d[가-힣]{1,3}\d{2}-\d{2})\]/g)].map(m => m[1])

test('017-d1: 요청에 학년군·교과가 있으면 그 범위로만 대체 후보를 만든다', () => {
  const block = task017Ctx.buildReplacementStandardsContext(task017Msg('사회 3-4는 지역 문제·주민 참여 성취기준으로 바꿔 주세요'), '5-6', task017Bands, { sheetRows: task017Rows })
  assert.match(block, /### 3-4학년군/)
  assert.doesNotMatch(block, /### 1-2학년군|### 5-6학년군/)
  const codes = task017Codes(block)
  assert.ok(codes.length > 0 && codes.length <= 5)
  assert.equal(codes[0], '4사08-02')
  assert.ok(codes.every(code => code.startsWith('4사')), codes.join(','))
})

test('017-d2: "X 대신"의 X는 검색에서 빠지고, 교과·학년 언급이 없으면 시트 교과 안에서만 찾는다', () => {
  const sci = task017Ctx.buildReplacementStandardsContext(task017Msg('과학 4학년은 태양계 대신 기후변화 쪽으로 교체해 주세요'), '5-6', task017Bands, { sheetRows: task017Rows })
  const sciCodes = task017Codes(sci)
  assert.ok(sciCodes.includes('4과16-01') && sciCodes.includes('4과16-03'), sciCodes.join(','))
  assert.ok(sciCodes.every(code => code.startsWith('4과')))
  assert.doesNotMatch(sci, /태양계 구성원/)
  const open = task017Ctx.buildReplacementStandardsContext(task017Msg('폭염 대응이랑 더 맞는 성취기준으로 바꿔 주세요'), '5-6', task017Bands, { sheetRows: task017Rows })
  assert.ok(task017Codes(open).every(code => /^\d(사|과)/.test(code)), task017Codes(open).join(','))
  assert.doesNotMatch(open, /\[\d수|\[\d실|\[\d도/)
})

test('017-d3: 교체 의도(바꿔·대신·교체·대체)에만 붙고 "추가"·"수정"만으로는 붙지 않는다', () => {
  for (const text of ['사회 3-4에 지역 문제 성취기준도 추가해 주세요', '사회 3-4 행을 수정해 주세요', '이 성취기준 넣어 주세요']) {
    assert.equal(task017Ctx.buildReplacementStandardsContext(task017Msg(text), '5-6', task017Bands, { sheetRows: task017Rows }), '', text)
  }
  assert.equal(task017Ctx.buildReplacementStandardsContext([{ role: 'user', content: '[시스템 리마인더] 현재 활동: A-3. 바꿔 주세요' }], '5-6', task017Bands), '')
})

test('017-d4: 대체 블록을 포함해도 여러 학년군 컨텍스트 전체가 24,000자를 넘지 않는다', () => {
  const full = task017Ctx.buildCurriculumContext('A-2-1', task017Msg('사회 3-4는 지역 문제·주민 참여 성취기준으로 바꿔 주세요'), '5-6', {}, null, [], task017Bands, task017Rows)
  assert.match(full, /## 대체 후보 성취기준/)
  assert.ok(full.length <= 24_000, String(full.length))
  assert.equal((full.match(/\[9[가-힣]/g) ?? []).length, 0)
})

test('017-b: 재시도로 부분 답을 대체할 때 기존 createdAt 을 유지하고 로컬에도 새 응답 필드를 반영한다', () => {
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  assert.match(projects, /createdAt: createdAt \?\? serverTimestamp\(\)/)
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(chatSource, /const replacedCreatedAt = replacingResponse \? messages\.find\(m => m\.id === newMsgId\)\?\.createdAt : undefined/)
  assert.match(chatSource, /\}, newMsgId, replacedCreatedAt\)/)
  assert.match(chatSource, /replaceMessage\(newMsgId, finalText, \{[\s\S]{0,200}actionCard: parsedActionCardD\?\.card/)
  const store = fs.readFileSync(new URL('../src/store/project.ts', import.meta.url), 'utf8')
  assert.match(store, /messages: state\.messages\.map\(m => m\.id === id \? \{ \.\.\.m, \.\.\.fields, content \} : m\)/)
})

// ─── TASK-019: #26 전송 준비 판정 · #27 응답 끝 깨진 외국 문자 제거 ─────────
const { chatSendBlockReason } = await import('../src/lib/chat/sendReadiness.ts')
const { sanitizeAssistantText } = await import('../src/lib/chat/sanitizeAssistantText.ts')

test('26: 준비 전(프로필·프로젝트·메시지 구독·활동 동기화)에는 전송을 막고, 준비되면 허용한다', () => {
  const ready = { hasProject: true, hasUser: true, messagesLoaded: true, currentActivity: 'DI-2-1', projectActivity: 'DI-2-1' }
  assert.equal(chatSendBlockReason(ready), null)
  assert.ok(chatSendBlockReason({ ...ready, hasProject: false }))
  assert.ok(chatSendBlockReason({ ...ready, hasUser: false }))
  assert.ok(chatSendBlockReason({ ...ready, messagesLoaded: false }))
  // 새로고침 직후 스토어 기본값(T-1-1)이 프로젝트 현재 활동과 다르면 다른 활동 경로에 저장될 수 있어 막는다.
  assert.match(chatSendBlockReason({ ...ready, currentActivity: 'T-1-1' }), /이동하는 중/)
  assert.equal(chatSendBlockReason({ ...ready, projectActivity: undefined }), null)
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  const send = chatSource.slice(chatSource.indexOf('async function handleSend()'))
  // 준비 판정은 입력을 비우기(setInput('')) 전에 있어야 입력한 글이 사라지지 않는다.
  assert.ok(send.indexOf('if (sendBlockReason) return') > 0)
  assert.ok(send.indexOf('if (sendBlockReason) return') < send.indexOf("setInput('')"))
  assert.match(chatSource, /disabled=\{!input\.trim\(\) \|\| \(isLoading && !isTeamMode && !isWaitingForChoice\) \|\| !!sendBlockReason\}/)
})

test('27: 응답 끝에 붙은 깨진 외국 문자 꼬리만 지운다', () => {
  assert.equal(sanitizeAssistantText('이렇게 정리했습니다.ેણ'), '이렇게 정리했습니다.')
  assert.equal(sanitizeAssistantText('추가하거나 수정할 내용이 있으면 말씀해 주세요.азаара'), '추가하거나 수정할 내용이 있으면 말씀해 주세요.')
  assert.equal(sanitizeAssistantText('다음 활동을 안내해 주세요 ેણ\n'), '다음 활동을 안내해 주세요')
  assert.equal(sanitizeAssistantText('확인해 주세요.\nазаара'), '확인해 주세요.')
  assert.equal(sanitizeAssistantText('표로 정리했어요 🙂азаара'), '표로 정리했어요 🙂')
})

test('27: 정상 본문·외국어 인용·한자 병기·끝 신호는 그대로 둔다', () => {
  const keep = [
    '학생들이 "Think globally, act locally."라고 말했어요.',
    '학교(學校) 주변 그늘을 조사합니다.',
    '러시아어 인사는 Привет мир',
    '본문 중간의 азаара 같은 글자는 끝이 아니므로 그대로 둡니다.',
    '저장했습니다.\n[ACTIVITY_ADVANCE: DI-2-1]',
    '긴 외국어 꼬리는 인용일 수 있어 둡니다 Здравствуйте',
    '',
  ]
  for (const text of keep) assert.equal(sanitizeAssistantText(text), text, text)
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(chatSource, /const cleaned = sanitizeAssistantText\(text\)\n\s+return commitResponse\(decisionDeferred \? deferredResponse\(cleaned\) : cleaned\)/)
})

// ─── TASK-022: #28 팀장 종합 저장 후 부재 팀원 확인 ─────────
const task022 = await import('../src/lib/collab/artifactConfirmations.ts')
const task022Team = {
  mode: 'collaborative', hostUid: 'host', createdBy: 'host', memberUids: ['host', 'jam', 'canva'],
  memberInfo: { host: { displayName: '홍성용' }, jam: { displayName: '잠만보잠만보' }, canva: { displayName: '캔바1' } },
}

test('28a: 이 활동에서 말하지 않은 비방장 팀원만 확인 대기로 기록하고, solo·데모·1인 팀은 제외한다', () => {
  const pending = task022.computePendingConfirmations({ ...task022Team, speakerUids: ['host', 'jam'], activityCode: 'T-2-1', version: 2, now: 100 })
  assert.deepEqual(Object.keys(pending), ['canva'])
  assert.deepEqual(pending.canva, { status: 'pending', version: 2, since: 100, displayName: '캔바1' })
  assert.deepEqual(task022.computePendingConfirmations({ ...task022Team, speakerUids: ['host', 'jam', 'canva'], activityCode: 'T-2-1', version: 2, now: 100 }), {})
  assert.deepEqual(task022.computePendingConfirmations({ ...task022Team, mode: 'solo', speakerUids: [], activityCode: 'T-2-1', version: 2, now: 100 }), {})
  assert.deepEqual(task022.computePendingConfirmations({ ...task022Team, demoRun: true, speakerUids: [], activityCode: 'T-2-1', version: 2, now: 100 }), {})
  assert.deepEqual(task022.computePendingConfirmations({ ...task022Team, memberUids: ['host'], speakerUids: [], activityCode: 'T-2-1', version: 2, now: 100 }), {})
  // memberUids 가 없으면 memberInfo 키로 팀을 판단한다.
  assert.deepEqual(Object.keys(task022.computePendingConfirmations({ ...task022Team, memberUids: undefined, speakerUids: ['host'], activityCode: 'T-2-1', version: 1, now: 1 })).sort(), ['canva', 'jam'])
})

test('28b: 같은 버전에 이미 응답(확인·다시 논의)했거나 대기 중이면 다시 묻지 않고, 내용이 바뀐 새 버전이면 다시 묻는다', () => {
  const existing = { canva: { 'T-2-1': { status: 'confirmed', version: 2, since: 1, displayName: '캔바1', respondedAt: 5 } } }
  assert.deepEqual(task022.computePendingConfirmations({ ...task022Team, speakerUids: ['host', 'jam'], activityCode: 'T-2-1', version: 2, now: 100, existing }), {})
  const rediscuss = { canva: { 'T-2-1': { status: 'rediscuss', version: 2, since: 1, displayName: '캔바1', reason: '시트' } } }
  assert.deepEqual(task022.computePendingConfirmations({ ...task022Team, speakerUids: ['host', 'jam'], activityCode: 'T-2-1', version: 2, now: 100, existing: rediscuss }), {})
  assert.deepEqual(Object.keys(task022.computePendingConfirmations({ ...task022Team, speakerUids: ['host', 'jam'], activityCode: 'T-2-1', version: 3, now: 100, existing })), ['canva'])
})

test('28c: 표시 판정 — 본인 대기 목록(오래된 순)과 산출물 패널 배지 요약', () => {
  const confirmations = {
    canva: {
      'A-2-1': { status: 'pending', version: 1, since: 20, displayName: '캔바1' },
      'T-2-1': { status: 'pending', version: 2, since: 10, displayName: '캔바1' },
      'T-2-2': { status: 'confirmed', version: 1, since: 5, displayName: '캔바1' },
    },
    jam: { 'T-2-1': { status: 'rediscuss', version: 2, since: 10, displayName: '잠만보잠만보', reason: '역할을 다시 나눠요' } },
  }
  assert.deepEqual(task022.pendingConfirmationsForUser(confirmations, 'canva').map(item => item.activityCode), ['T-2-1', 'A-2-1'])
  assert.deepEqual(task022.pendingConfirmationsForUser(confirmations, 'jam'), [])
  assert.deepEqual(task022.pendingConfirmationsForUser(confirmations, null), [])
  assert.deepEqual(task022.confirmationSummaryForActivity(confirmations, 'T-2-1'), {
    pending: ['캔바1'], rediscuss: [{ displayName: '잠만보잠만보', reason: '역할을 다시 나눠요' }],
  })
  assert.deepEqual(task022.confirmationSummaryForActivity(undefined, 'T-2-1'), { pending: [], rediscuss: [] })
  assert.equal(task022.rediscussMessage('  역할을 다시 나눠요 '), '[다시 논의 요청] 역할을 다시 나눠요')
})

test('28d: 저장 직후 기록·본인 응답 경로와 규칙(자기 uid 항목만)이 연결돼 있다', () => {
  const projectsSource = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  assert.match(projectsSource, /void recordArtifactConfirmations\(projectId, activityCode, data\.version, projectData\)/)
  assert.match(projectsSource, /\[`artifactConfirmations\.\$\{uid\}\.\$\{activityCode\}`\]: stripUndefinedDeep\(next\)/)
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  assert.match(rules, /get\('artifactConfirmations', \{\}\)\.diff\(resource\.data\.get\('artifactConfirmations', \{\}\)\)\s*\.affectedKeys\(\)\.hasOnly\(\[request\.auth\.uid\]\)/)
  const page = fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /<PendingConfirmationBanner \/>/)
})

test('28e: 새 버전이 저장되면 이전 버전의 다시 논의 요청만 정리 대상이다', () => {
  const confirmations = {
    jam: { 'T-2-1': { status: 'rediscuss', version: 2, since: 1, displayName: '잠만보잠만보', reason: 'x' } },
    canva: { 'T-2-1': { status: 'rediscuss', version: 3, since: 1, displayName: '캔바1', reason: 'y' } },
    other: { 'T-2-1': { status: 'confirmed', version: 2, since: 1, displayName: '다른' } },
  }
  assert.deepEqual(task022.staleRediscussUids(confirmations, 'T-2-1', 3), ['jam'])
  assert.deepEqual(task022.staleRediscussUids(confirmations, 'A-2-1', 3), [])
  assert.deepEqual(task022.staleRediscussUids(undefined, 'T-2-1', 3), [])
})

// ─── TASK-023: #31 재논의 요청과 명시적 저장·확정 구분 ─────────
const task023Flow = await import('../src/lib/activity/conversation-flow.ts')

test('31: 확인 카드의 재논의 요청 뒤 팀 일정 저장 요청은 보류가 아니다', () => {
  const reason = '[다시 논의 요청] 목요일은 돌봄 지원 때문에 어려워요.'
  assert.equal(task023Flow.isDecisionDeferred(reason), false)
  assert.equal(task023Flow.isDecisionDeferred(`[캔바1]: ${reason}`), false)
  assert.equal(task023Flow.hasDeferredDecision([
    { role: 'user', content: reason },
    { role: 'user', content: '화요일 15:40으로 팀 일정 저장해 주세요' },
  ]), false)
})

test('31: 결정은 보류할게요는 명시적인 결정 보류다', () => {
  assert.equal(task023Flow.isDecisionDeferred('결정은 보류할게요'), true)
  assert.equal(task023Flow.hasDeferredDecision([{ role: 'user', content: '결정은 보류할게요' }]), true)
})

test('31: 다시 논의하기 뒤 확정해 주세요는 보류를 해제한다', () => {
  assert.equal(task023Flow.hasDeferredDecision([
    { role: 'user', content: '다시 논의하기' },
    { role: 'user', content: '확정해 주세요' },
  ]), false)
})

test('31: 다시 논의하기 단독은 결정 보류를 유지한다', () => {
  assert.equal(task023Flow.isDecisionDeferred('다시 논의하기'), true)
  assert.equal(task023Flow.hasDeferredDecision([{ role: 'user', content: '다시 논의하기' }]), true)
})

test('31: 띄어쓰기·존댓말 저장 요청은 재개하고 명시적인 저장 거절은 유지한다', () => {
  for (const content of ['저장해 주세요', '저장해 줘', '저장할게요', '저장 할 게요', '저장 부탁해요', '저장 부탁드립니다', '확정해 주세요', '확정해 주십시오', 'A안을 선택하겠습니다']) {
    assert.equal(task023Flow.hasDeferredDecision([{ role: 'user', content: '다시 논의하기' }, { role: 'user', content }]), false, content)
  }
  assert.equal(task023Flow.hasDeferredDecision([
    { role: 'user', content: '저장해 주세요' },
    { role: 'user', content: '저장하지 않을게요' },
  ]), true)
})

// ─── TASK-024: #29 단계를 넘는 되돌아가기 대상 · #30 환영 메시지 재생성 방지 ─────────
const task024 = await import('../src/lib/activity/navigationDecisions.ts')

test('29: 단계를 넘는 되돌아가기는 요청된 활동으로, 새 주기·대상 없음·다른 단계는 단계 첫 활동으로 간다', () => {
  const base = { toStage: 'T', firstActivity: 'T-1-1', isStartingNewCycle: false }
  assert.equal(task024.resolveStageMoveTargetActivity({ ...base, returnActivity: 'T-2-3', returnActivityStage: 'T' }), 'T-2-3')
  assert.equal(task024.resolveStageMoveTargetActivity({ ...base, returnActivity: 'T-2-3', returnActivityStage: 'T', isStartingNewCycle: true }), 'T-1-1')
  assert.equal(task024.resolveStageMoveTargetActivity({ ...base, returnActivity: null }), 'T-1-1')
  assert.equal(task024.resolveStageMoveTargetActivity({ ...base, returnActivity: 'A-2-1', returnActivityStage: 'A' }), 'T-1-1')
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(chatSource, /setPendingStageMove\(targetStage, code\)/)
  const modal = fs.readFileSync(new URL('../src/components/modals/StageMoveModal.tsx', import.meta.url), 'utf8')
  assert.match(modal, /returnActivity: pendingReturnActivity/)
  assert.match(modal, /if \(isActivityReturn\) await withTimeout\(setActivityStatus\(project\.id, firstActivity, 'active_return'\)/)
  const store = fs.readFileSync(new URL('../src/store/project.ts', import.meta.url), 'utf8')
  // 다른 경로(단계 바·분석 창 등)로 창을 열면 이전 되돌아가기 대상이 남지 않는다.
  assert.match(store, /const nextReturn = stage \? returnActivity : null/)
  assert.match(store, /setPendingStageMove: \(stage, returnActivity = null\)/)
})

test('30: 대화나 환영 메시지가 있는 활동에 다시 들어오면 환영 메시지를 만들지 않는다', () => {
  const base = { started: true, messagesLoaded: true, isHost: true, hasWelcomeText: true, welcomeId: 'welcome-1-T-2-3', cycle: 1 }
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, messages: [] }), true)
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, messages: [{ id: 'u1', role: 'user', cycleNumber: 1 }] }), false)
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, messages: [{ id: 'welcome-1-T-2-3', role: 'assistant', cycleNumber: 1 }] }), false)
  // 이전 주기 대화만 있으면 새 주기 첫 진입이므로 환영 메시지를 보낸다.
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, cycle: 2, welcomeId: 'welcome-2-T-2-3', messages: [{ id: 'old', role: 'user', cycleNumber: 1 }] }), true)
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, isHost: false, messages: [] }), false)
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, messagesLoaded: false, messages: [] }), false)
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, started: false, messages: [] }), false)
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  // 비어 있는 레거시 경로 스냅샷이 먼저 와도 '빈 대화 로드 완료'로 내보내지 않는다.
  // TASK-025: 레거시만 먼저 온 빈 목록은 막되(#30) 늦는 레거시를 기다리지는 않는다(#33).
  assert.match(projects, /if \(!canEmitMessageSnapshot\(ready\)\) return/)
  assert.match(projects, /if \(existing\.exists\(\)\) return false/)
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(chatSource, /saveMessageIfAbsent\(proj\.id, currentActivity, \{/)
})

// ─── TASK-025: #33 되돌아가기 직후 기존 대화가 늦게 보임 ─────────
const { canEmitMessageSnapshot } = await import('../src/lib/chat/messageSubscription.ts')

test('33: 활동 경로 첫 스냅샷이 오면 레거시를 기다리지 않고 내보내고, 레거시만 온 빈 상태는 내보내지 않는다', () => {
  assert.equal(canEmitMessageSnapshot({ activity: false, legacy: false }), false)
  // #30: 비어 있는 레거시 경로가 먼저 오면 '빈 대화 로드 완료'로 내보내지 않는다.
  assert.equal(canEmitMessageSnapshot({ activity: false, legacy: true }), false)
  // #33: 레거시 응답이 늦어도 활동 경로의 기존 대화는 바로 보인다.
  assert.equal(canEmitMessageSnapshot({ activity: true, legacy: false }), true)
  assert.equal(canEmitMessageSnapshot({ activity: true, legacy: true }), true)
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const watch = projects.slice(projects.indexOf('export function watchMessages('))
  assert.doesNotMatch(watch.slice(0, 2500), /!ready\.legacy/)
  // 활동 경로 오류도 ready 로 표시해 로드가 막히지 않는다.
  assert.match(watch, /ready\[source\] = true/)
})

// ─── TASK-025b: 대비 타이머(5초)로 켜진 로드 완료에서는 환영 메시지를 만들지 않는다 ─────────
test('33b: 대비 타이머 로드 완료는 환영을 만들지 않고, 실제 스냅샷이 오면 기존 판단으로 돌아간다', async () => {
  const base = { started: true, messagesLoaded: true, isHost: true, hasWelcomeText: true, welcomeId: 'welcome-1-T-2-3', cycle: 1, messages: [] }
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, messagesLoadedByFallback: true }), false)
  assert.equal(task024.shouldCreateWelcomeMessage({ ...base, messagesLoadedByFallback: false }), true)
  assert.equal(task024.shouldCreateWelcomeMessage(base), true)
  // 스토어: 대비 타이머만 플래그를 켜고, 실제 스냅샷·오류 응답(기본 인자)은 해제한다. 활동 전환·초기화도 해제.
  const { useProjectStore } = await import('../src/store/project.ts')
  const store = useProjectStore.getState()
  store.setMessagesLoaded(true, true)
  assert.equal(useProjectStore.getState().messagesLoadedByFallback, true)
  useProjectStore.getState().setMessagesLoaded(true)
  assert.equal(useProjectStore.getState().messagesLoadedByFallback, false)
  useProjectStore.getState().setMessagesLoaded(true, true)
  useProjectStore.getState().setCurrentActivity('A-2-1')
  assert.equal(useProjectStore.getState().messagesLoadedByFallback, false)
  useProjectStore.getState().setMessagesLoaded(false, true)
  assert.equal(useProjectStore.getState().messagesLoadedByFallback, false)
  const page = fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /setMessagesLoaded\(true, true\)/)
  // #26 전송 판정은 messagesLoaded 만 보므로 대비 타이머 뒤에도 지금처럼 전송 가능(입력 보존 경로 유지).
  assert.equal(chatSendBlockReason({ hasProject: true, hasUser: true, messagesLoaded: true, currentActivity: 'T-2-3', projectActivity: 'T-2-3' }), null)
})

// ─── TASK-026: #33 단계 이동 창 경로에서 이미 받은 대화를 지우던 문제 ─────────
test('33c: 단계 이동 창이 끝날 때 이미 동기화·구독으로 받은 새 활동 대화를 지우지 않는다', async () => {
  const { useProjectStore } = await import('../src/store/project.ts')
  const s = () => useProjectStore.getState()
  const loaded = Array.from({ length: 17 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `${i}`, activityCode: 'Ds-1-1', cycleNumber: 1 }))
  // 출발 활동(T-2-3)에서 대화가 보이는 상태
  s().setCurrentActivity('T-2-3'); s().setMessages([{ id: 'old', role: 'user', content: 'old', activityCode: 'T-2-3' }]); s().setMessagesLoaded(true)
  // 창의 await(advanceActivity·logStageTransition) 동안: 프로젝트 스냅샷 → page.tsx 동기화 → 새 활동 구독 결과 도착
  s().setCurrentActivity('Ds-1-1')
  assert.equal(s().messagesLoaded, false)
  s().setMessages(loaded); s().setMessagesLoaded(true)
  // 창의 마무리(수정 후): 같은 활동으로 setCurrentActivity → 아무것도 바꾸지 않는다
  s().setCurrentActivity('Ds-1-1')
  assert.equal(s().messages.length, 17)
  assert.equal(s().messagesLoaded, true)
  // 수정 전 동작(setMessages([]))을 재현하면 목록이 비고, 활동 코드가 같아 구독이 다시 돌지 않아 그대로 남는다.
  s().setMessages([])
  assert.equal(s().messages.length, 0)
  assert.equal(s().currentActivity, 'Ds-1-1')
  const modal = fs.readFileSync(new URL('../src/components/modals/StageMoveModal.tsx', import.meta.url), 'utf8')
  const finish = modal.slice(modal.indexOf('// 로컬 상태도 즉시 반영'))
  assert.doesNotMatch(finish.slice(0, 600).replace(/\/\/.*$/gm, ''), /setMessages\(/)
  assert.doesNotMatch(modal, /^\s*setMessages,\s*$/m)
})

// ─── TASK-029: #34 따옴표·괄호 뒤 한글 조사가 붙는 굵게 표시 ─────────
for (const [markdown, bold, particle] of [
  ['**‘일’**로', '‘일’', '로'],
  ['**산출물(표)**을', '산출물(표)', '을'],
  ['**기후위기**를', '기후위기', '를'],
]) {
  test(`34: ${markdown}는 조사 앞까지 strong으로 파싱한다`, () => {
    const processor = unified().use(remarkParse).use(REMARK_PLUGINS)
    const paragraph = processor.parse(markdown).children[0]
    assert.equal(paragraph.type, 'paragraph')
    assert.deepEqual(paragraph.children.map(node => (
      node.type === 'strong'
        ? { type: node.type, text: node.children.map(child => child.value).join('') }
        : { type: node.type, text: node.value }
    )), [{ type: 'strong', text: bold }, { type: 'text', text: particle }])
  })
}

test('34: CJK 굵게 플러그인을 적용해도 1~3개 범위 물결표는 보존한다', () => {
  const processor = unified().use(remarkParse).use(REMARK_PLUGINS)
  const paragraph = processor.parse('1~3개').children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.children.map(node => ({ type: node.type, text: node.value })), [
    { type: 'text', text: '1~3개' },
  ])
})

// ─── TASK-030: 산출물 본문 Markdown 표시와 팀원 확대 보기 ─────────
function loadArtifactTsx(relativePath, bindings, functionNames) {
  let source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  if (functionNames) {
    const sourceTree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    source = functionNames.map(name => {
      let found
      function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
        ts.forEachChild(node, visit)
      }
      visit(sourceTree)
      assert.ok(found, name)
      return found.getText(sourceTree).replace(/^(?:export\s+)?function/, 'export function')
    }).join('\n')
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const context = { exports: {}, ...bindings, require(name) {
    if (name === 'react/jsx-runtime') return jsxRuntime
    assert.ok(Object.hasOwn(bindings, name), name)
    return bindings[name]
  } }
  vm.runInNewContext(compiled, context)
  return context.exports
}

const { ArtifactMarkdown } = loadArtifactTsx('../src/components/artifacts/ArtifactMarkdown.tsx', {
  'react-markdown': { __esModule: true, default: ReactMarkdown },
  '@/lib/markdown/remarkPlugins': { REMARK_PLUGINS },
})
const { Ds12Renderer } = loadArtifactTsx('../src/components/artifacts/structured/Ds12Renderer.tsx', {
  '../ArtifactMarkdown': { ArtifactMarkdown },
  '@/lib/report/artifactToMarkdown': await import('../src/lib/report/artifactToMarkdown.ts'),
})

test('030: Ds-2 패널·상세 모달은 저장 본문의 굵게·목록·표를 렌더하고 원문을 변경하지 않는다', () => {
  const content = {
    _schema: 'Ds-1-2',
    문제상황: '**제목**: 우리 동네 그늘\n\n**행1 (실제성)**: 1~3개 장소\n\n- **‘일’**로 정하기\n- 인터뷰하기\n\n| 장소 | 이용자 |\n| --- | --- |\n| 학교 | **어린이** |',
    '성취기준 연결': '**1-2학년군 국어 [2국03-02]**: 이유 쓰기',
  }
  const before = structuredClone(content)
  const { ArtifactContent, ArtifactPreviewModal } = loadArtifactTsx('../src/components/artifacts/ArtifactPanel.tsx', {
    StructuredArtifactRenderer: ({ content }) => React.createElement(Ds12Renderer, { data: content }),
    useState: () => [false, () => {}], useEffect: () => {},
    document: { body: {} }, createPortal: children => children,
    STAGE_COLOR: { Ds: {} }, cn: (...values) => values.filter(Boolean).join(' '),
    FileText: () => null, Copy: () => null, Check: () => null, X: () => null, StatusBadge: () => null,
  }, ['ArtifactContent', 'ArtifactPreviewModal'])
  for (const element of [
    React.createElement(ArtifactContent, { content, activityCode: 'Ds-1-2' }),
    React.createElement(ArtifactPreviewModal, { modal: { title: '문제 상황 설정', content, activityCode: 'Ds-1-2', stageCode: 'Ds' }, onClose() {} }),
  ]) {
    const html = renderToStaticMarkup(element)
    assert.match(html, /<strong[^>]*>제목<\/strong>/)
    assert.match(html, /<strong[^>]*>행1 \(실제성\)<\/strong>/)
    assert.match(html, /<strong[^>]*>1-2학년군 국어 \[2국03-02\]<\/strong>/)
    assert.match(html, /<strong[^>]*>‘일’<\/strong>로/)
    assert.match(html, /<ul[^>]*>/)
    assert.match(html, /<table[^>]*>/)
    assert.match(html, /<strong[^>]*>어린이<\/strong>/)
    assert.match(html, /1~3개 장소/)
    assert.doesNotMatch(html, /\*\*|\| --- \|/)
  }
  assert.deepEqual(content, before)
})

test('030: Ds-2 공동편집 전용 표는 열·행을 보존하고 자유 본문만 Markdown으로 렌더한다', () => {
  const content = { manualWorkspace: {
    columns: [{ id: 'label' }, { id: 'value' }],
    rows: [{ id: 'r1', cells: { label: '실제성', value: '학교 주변 조사' } }],
    blocks: [
      { id: 'p1', type: 'paragraph', content: '**우리 동네**\n\n1. 조사\n2. 제안' },
      { id: 't1', type: 'table', table: { columns: [{ id: 'col', label: '자료' }], rows: [{ id: 'row', cells: { col: '지도' } }] } },
    ],
  } }
  const original = structuredClone(content)
  const html = renderToStaticMarkup(React.createElement(Ds12Renderer, { data: content }))
  assert.equal((html.match(/<table\b/g) ?? []).length, 2)
  for (const value of ['실제성', '학교 주변 조사', '자료', '지도']) assert.ok(html.includes(value))
  assert.match(html, /<strong[^>]*>우리 동네<\/strong>/)
  assert.match(html, /<ol[^>]*>/)
  assert.deepEqual(content, original)
})

test('030: 팀원도 내용이 있는 Ds-2 확대 버튼으로 현재 버전의 읽기 전용 상세 모달을 연다', () => {
  const source = fs.readFileSync(new URL('../src/components/artifacts/ArtifactPanel.tsx', import.meta.url), 'utf8')
  const sourceTree = ts.createSourceFile('ArtifactPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let button
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceTree) === 'button'
      && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop)
        && prop.name.getText(sourceTree) === 'aria-label' && prop.initializer?.text === '산출물 전체 보기')) button = node
    ts.forEachChild(node, visit)
  }
  visit(sourceTree)
  assert.ok(button)
  assert.match(button.getText(sourceTree), /onClick=\{openCurrentArtifactPreview\}/)
  assert.doesNotMatch(button.getText(sourceTree), /disabled|isHost/)
  let guard = button.parent
  while (ts.isParenthesizedExpression(guard)) guard = guard.parent
  assert.ok(ts.isBinaryExpression(guard))
  assert.equal(guard.left.getText(sourceTree), 'hasContent')
  const content = { 문제상황: '**제목**: 우리 동네' }
  let opened
  const { openCurrentArtifactPreview } = loadArtifactTsx('../src/components/artifacts/ArtifactPanel.tsx', {
    isHost: false, viewingActivity: 'Ds-1-2', displayContent: content,
    displayArtifact: { title: '문제 상황 설정', currentVersion: 2 },
    activityMeta: { label: '문제 상황 설정', stage: 'Ds' }, effectiveStatus: 'confirmed',
    openArtifactPreview: modal => { opened = modal },
  }, ['openCurrentArtifactPreview'])
  openCurrentArtifactPreview()
  assert.equal(opened.content, content)
  assert.equal(opened.activityCode, 'Ds-1-2')
  assert.equal(opened.subtitle, '문제 상황 설정 · 버전 2')
  assert.equal(opened.status, 'confirmed')
})

// ─── TASK-031: 성취기준 정렬 점검 — 평가 근거 섹션 확장 · 코드 미표기 구분 · 범례·문서 번호 ─────────
const task031 = await import('../src/lib/curriculum/alignment.ts')

test('31a: 평가 계획 밖 섹션(수준 기준 표·문장)의 코드도 평가 근거로 잇고 라벨은 평가 항목명', () => {
  const ds11 = {
    '평가 계획': '| 확인 지점 | 평가 요소 | 평가 방법 |\n|---|---|---|\n| 1-2학년군 결과물 | 그림·스티커로 표시 | 관찰 |',
    '수준 기준': '| 평가 항목 | 근거 성취기준 | 상 | 중 | 하 |\n|---|---|---|---|---|\n| 1-2학년군 발표 말하기 | 근거 성취기준: [2국03-02] A | 이유를 말함 | 일부 | 도움 |\n| 5-6학년군 주장 글 | [6국03-02] B | 출처 | 근거 | 일부 |',
    '평가 메모': '- 3-4학년군 지도 발표: 근거 성취기준 [4사08-02] A\n일반 문장은 연결하지 않는다.',
  }
  const result = task031.buildAlignment(['[2국03-02]', '[6국03-02]', '[4사08-02]', '[4과16-01]'], ds11, null)
  const byCode = Object.fromEntries(result.rows.map(r => [r.code, r.evaluations]))
  assert.deepEqual(byCode['[2국03-02]'], [{ label: '1-2학년군 발표 말하기', levels: ['A'] }])
  assert.deepEqual(byCode['[6국03-02]'], [{ label: '5-6학년군 주장 글', levels: ['B'] }])
  assert.equal(byCode['[4사08-02]'].length, 1)
  assert.match(byCode['[4사08-02]'][0].label, /^3-4학년군 지도 발표/)
  assert.deepEqual(byCode['[4사08-02]'][0].levels, ['A'])
  assert.deepEqual(byCode['[4과16-01]'], [])
  assert.equal(result.evaluationHasNoCodes, false)
})

// ─── TASK-032: 공유 워크숍 닫기·재오픈과 헤더 말풍선 층위 ─────────
function problemSituationOpenHarness() {
  const source = fs.readFileSync(new URL('../src/components/chat/useProblemSituationOpen.ts', import.meta.url), 'utf8')
  const sourceTree = ts.createSourceFile('useProblemSituationOpen.ts', source, ts.ScriptTarget.Latest, true)
  const states = []
  let cursor = 0
  let changed = false
  let props
  let result
  const hook = loadChatFunction('useProblemSituationOpen', {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], update => {
        const next = typeof update === 'function' ? update(states[index]) : update
        if (!Object.is(next, states[index])) { states[index] = next; changed = true }
      }]
    },
  }, sourceTree)
  function render(nextProps = props) {
    props = nextProps
    for (let i = 0; i < 5; i++) {
      cursor = 0; changed = false
      result = hook(props)
      if (!changed) return result[0]
    }
    assert.fail('공유 워크숍 상태가 5번 렌더 후에도 안정되지 않음')
  }
  return { render, setOpen(open) { result[1](open); return render() } }
}

test('032a: 방장 공유 열기·닫기·재오픈을 팀원이 따라가고 로컬 닫기는 일반 업데이트로 취소되지 않는다', () => {
  const h = problemSituationOpenHarness()
  const member = { projectId: 'herdr', userUid: 'member1', isHost: false, sharedOpen: false, currentActivity: 'Ds-1-2' }
  assert.equal(h.render(member), false)
  assert.equal(h.render({ ...member, sharedOpen: true }), true)
  assert.equal(h.setOpen(false), false)
  assert.equal(h.render({ ...member, sharedOpen: true }), false)
  assert.equal(h.render(member), false)
  assert.equal(h.render({ ...member, sharedOpen: true }), true)
  // 팀원이 닫지 않고 보는 중에도 방장 X / 저장으로 false가 오면 닫힌다.
  assert.equal(h.render(member), false)
  assert.equal(h.setOpen(true), true)
  assert.equal(h.render(member), true)
  assert.equal(h.render({ ...member, sharedOpen: true }), true)
  assert.equal(h.render(member), false)
  assert.match(chat, /useProblemSituationOpen\(\{[\s\S]*?sharedOpen: project\.problemSituationOpen/)
  assert.match(chat, /onClose=\{\(\) => \{\s*setShowProblemSituationDesigner\(false\)\s*if \(isHost\) \{[\s\S]*?setProblemSituationOpen\(proj\.id, false\)/)
})

test('032b: 방장 직접 제어·첫 진입·활동 전환 중 열린 워크숍 유지도 보존한다', () => {
  const host = problemSituationOpenHarness()
  const props = { projectId: 'herdr', userUid: 'host', isHost: true, sharedOpen: false, currentActivity: 'Ds-1-2' }
  assert.equal(host.render(props), false)
  assert.equal(host.setOpen(true), true)
  assert.equal(host.render({ ...props, sharedOpen: true }), true)
  assert.equal(host.setOpen(false), false)
  assert.equal(host.render(props), false)
  const member = problemSituationOpenHarness()
  assert.equal(member.render({ ...props, userUid: undefined, isHost: false, sharedOpen: true }), false)
  assert.equal(member.render({ ...props, userUid: 'member', isHost: false, sharedOpen: true }), true)
  assert.equal(member.render({ ...props, userUid: 'member', isHost: false, sharedOpen: true, currentActivity: 'Ds-1-3' }), true)
  assert.equal(member.render({ ...props, userUid: 'member', isHost: false, sharedOpen: false, currentActivity: 'Ds-1-3' }), false)
  const otherActivity = problemSituationOpenHarness()
  assert.equal(otherActivity.render({ ...props, isHost: false, sharedOpen: true, currentActivity: 'T-1-1' }), false)
})

test('032c: 헤더 코치 말풍선은 독립된 20번 층 안에 있고 보고서·이동·상세 모달보다 아래다', () => {
  const { CoeditButton } = loadArtifactTsx('../src/components/chat/ChatPanel.tsx', {
    MD3Button: ({ children }) => React.createElement('button', null, children),
    MD3_ICON: { sm: 16 }, PencilSimple: () => null,
  }, ['CoeditButton'])
  const { ChatPanelHeader } = loadArtifactTsx('../src/components/chat/ChatPanelHeader.tsx', {
    ACTIVITY_META, cn: (...values) => values.filter(Boolean).join(' '),
    ChatFontScaleControl: () => null, Shield: () => null, Star: () => null,
  }, ['ChatPanelHeader'])
  const html = renderToStaticMarkup(React.createElement(ChatPanelHeader, { activity: 'Ds-1-2' },
    React.createElement(CoeditButton, { label: '공동 편집', title: '공동 편집', showHint: true, onClick() {} })))
  assert.match(html, /^<div class="relative isolate z-20 /)
  assert.match(html, /팀원과 함께 공동 편집할 수 있어요/)
  for (const file of ['modals/StageAnalysisModal', 'modals/StageReportsModal', 'modals/StageMoveModal', 'modals/CumulativeReportModal', 'artifacts/ArtifactPanel', 'artifacts/CoeditWorkspaceModal']) {
    const source = fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8')
    const overlay = source.match(/fixed inset-0 z-(?:\[(\d+)\]|(\d+))/)
    assert.ok(overlay, file)
    assert.ok(Number(overlay[1] ?? overlay[2]) > 20, `${file}: 헤더 안내보다 높은 모달 층`)
  }
})

test('032d: 개인 Ds-1 Step 2의 문장부호는 바꾸지 않는다:로 끝난다', () => {
  const project = { title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: [], mode: 'solo', currentCycle: 1 }
  const solo = buildSystemPrompt('Ds', 'Ds-1-1', project, '개인+AI')
  assert.match(solo, /열 구성\(확인 지점 \/ 평가 요소 \/ 평가 방법 \/ 평가 시점 \/ 평가 주체\)은 바꾸지 않는다:/)
  assert.doesNotMatch(solo, /바꾸지 않는다\.:/)
})

test('31b: 평가 산출물에 코드가 하나도 없으면 빈칸이 아니라 코드 미표기로 구분한다(herdr Ds-1-1 v2 형태)', () => {
  const herdrDs11 = { '평가 계획': '| 확인 지점 | 평가 요소 | 평가 방법 | 평가 시점 | 평가 주체 |\n|---|---|---|---|---|\n| 1-2학년군 결과물 | 더운 곳과 그늘이 필요한 곳을 표시 | 관찰 | 발표 때 | 교사 |\n| 모둠 참여 과정 | 역할 수행 | 관찰 | 협의 중 | 교사 |' }
  const ds13 = { '학습 활동': '| 순서 | 흐름 단계 | 활동명 | 활동 설명 | 핵심/부가 | 담당 교과 | 누적 차시 | 차시 운영 |\n|---|---|---|---|---|---|---|---|\n| 1 | 문제 이해 | 더위와 그늘 문제 발견하기 | 스티커 (근거: [2바02-01] A) | 핵심 | 통합 | 1차시 | 1 |' }
  const result = task031.buildAlignment(['[2바02-01]', '[2국03-02]'], herdrDs11, ds13)
  assert.equal(result.hasEvaluationArtifact, true)
  assert.equal(result.evaluationHasNoCodes, true)
  assert.equal(result.activityHasNoCodes, false)
  assert.deepEqual(result.rows[0].activities, [{ label: '1차시 더위와 그늘 문제 발견하기', levels: ['A'] }])
  const card = fs.readFileSync(new URL('../src/components/curriculum/AlignmentMatrixCard.tsx', import.meta.url), 'utf8')
  assert.match(card, /const checksEvaluations = alignment\.hasEvaluationArtifact && !alignment\.evaluationHasNoCodes/)
  assert.match(card, /코드 미표기/)
})

test('31c: 범례·배지 설명·열 머리글 문서 번호', () => {
  const card = fs.readFileSync(new URL('../src/components/curriculum/AlignmentMatrixCard.tsx', import.meta.url), 'utf8')
  // TASK-046b: A·B·C 범례는 보이지 않고 N차시 설명만 남는다.
  assert.match(card, />\s*N차시 = \{displayActivityCode\('Ds-1-3'\)\} 학습 활동의 누적 차시/)
  assert.doesNotMatch(card, /A·B·C = /)
  assert.match(card, /학습 활동 \(\{displayActivityCode\('Ds-1-3'\)\}\)/)
  assert.match(card, /평가 요소 \(\{displayActivityCode\('Ds-1-1'\)\}\)/)
  assert.doesNotMatch(card, /\(Ds-1-3\)<\/th>|\(Ds-1-1\)<\/th>/)
  assert.equal(displayActivityCode('Ds-1-3'), 'Ds-3')
  assert.equal(displayActivityCode('Ds-1-1'), 'Ds-1')
  const badge = fs.readFileSync(new URL('../src/components/curriculum/AchievementLevelDisclosure.tsx', import.meta.url), 'utf8')
  assert.match(badge, /A: '성취수준 A — 가장 높은 수준'/)
  assert.match(badge, /title=\{LEVEL_MEANING\[level\]\}\s+aria-label=\{LEVEL_MEANING\[level\]\}/)
})

// ─── TASK-032: Ds-1 프롬프트 — 평가 요소마다 근거 성취기준 코드 표기 ─────────
test('32: Ds-1 팀·개인 프롬프트가 평가 요소마다 "(근거: [코드])"를 요구하고(수준 글자 없음, TASK-046), 그 표기가 정렬 점검에 연결된다', () => {
  const project = { title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: [], mode: 'collaborative', isA23Completed: false, currentCycle: 1 }
  const team = buildSystemPrompt('Ds', 'Ds-1-1', project, '팀+AI', undefined, null, '홍성용(팀장), 캔바1', {}, undefined)
  const solo = buildSystemPrompt('Ds', 'Ds-1-1', { ...project, mode: 'solo' }, '개인+AI', undefined, null, undefined, {}, undefined)
  for (const prompt of [team, solo]) {
    assert.match(prompt, /근거 성취기준 표기\(필수\)/)
    assert.match(prompt, /"\(근거: \[코드\]\)" 형식으로 반드시 적는다\(여러 개면 쉼표로 "\(근거: \[2국03-02\], \[2바02-01\]\)"\)\. 코드 뒤에 A·B·C 같은 수준 글자는 붙이지 않는다/)
    assert.doesNotMatch(prompt, /근거: \[[^\]]+\] [ABC]\b|\[코드\] A\)|\[코드\] 수준/)
    assert.match(prompt, /코드는 A-2-1\(또는 분석시트\)에 있는 것만 그대로 옮기고 새로 만들지 않는다/)
  }
  // 성취수준 블록 유무와 상관없이 요구한다(이전에는 블록이 있을 때만 병기 → herdr 산출물에 코드가 없었음).
  assert.doesNotMatch(team, /성취수준" 블록이 주입되어 있으면 평가 요소는 그 A·B·C 원문의 행동을 확인하도록 쓰고 근거 코드를 병기한다/)
  // 저장 예시 행을 정렬 점검이 그대로 읽는다.
  const saved = { '평가 계획': '| 확인 지점 | 평가 요소 | 평가 방법 | 평가 시점 | 평가 주체 |\n|---|---|---|---|---|\n| 1-2학년군 결과물 | 더운 곳과 그늘이 필요한 곳을 표시하고 이유를 한 문장으로 표현함 (근거: [2국03-02]) | 그림 지도·문장 확인 | 발표 때 | 교사 |\n| 모둠 참여 과정 | 역할을 수행함 (근거: 과정 평가) | 관찰 | 협의 중 | 교사 |' }
  const result = task031.buildAlignment(['[2국03-02]'], saved, null)
  assert.deepEqual(result.rows[0].evaluations, [{ label: '더운 곳과 그늘이 필요한 곳을 표시하고 이유를 한 문장으로 표현함', levels: [] }])
  assert.equal(task031.hasLevelBadges(result), false)
  assert.equal(result.evaluationHasNoCodes, false)
})

// ─── TASK-033: 문제상황 워크숍 생성 맥락에 T단계 산출물·Ds-2 최근 대화 추가 ─────────
const task033 = await import('../src/lib/problem-situation/workshopContext.ts')
const task033gen = await import('../src/lib/problem-situation/generation.ts')

test('33a: T단계 산출물은 비전·원칙 위주로 직렬화되고 역할·규칙·일정은 짧게 잘린다', () => {
  const long = '가'.repeat(1000)
  const text = task033.buildTeamPreparationContext({
    'T-1-1': { content: { '팀 비전': '아이들이 생활 속 문제를 스스로 해결하는 수업', _meta: 'x' } },
    'T-1-2': { content: '1. 학생 질문에서 출발하려면 질문 시간을 먼저 둔다' },
    'T-2-1': { content: long },
    'T-2-3': { content: [{ 날짜: '10/20', 할일: '수업 실행' }] },
  })
  assert.match(text, /\[팀 비전 \(T-1\)\]\n[\s\S]*생활 속 문제/)
  assert.match(text, /\[설계 원칙 \(T-2\)\]\n1\. 학생 질문/)
  assert.match(text, /\[일정 \(T-5\)\]\n날짜 \| 할일\n10\/20 \| 수업 실행/)
  assert.doesNotMatch(text, /_meta|협력 규칙/)
  const roles = text.split('[역할 분담 (T-3)]\n')[1].split('\n\n')[0]
  assert.ok(roles.length <= 251 && roles.endsWith('…'))
  assert.ok(text.length <= task033.TEAM_PREPARATION_LIMIT + 1)
  assert.equal(task033.buildTeamPreparationContext(undefined), '')
  assert.equal(task033.buildTeamPreparationContext({}), '')
})

test('33b: Ds-2 대화는 신호 태그 제거·화자 표시·활동 필터, 상한 초과 시 오래된 것부터 버린다', () => {
  const messages = [
    { role: 'user', content: '오래된 이야기', activityCode: 'Ds-1-2', displayName: '홍성용' },
    { role: 'assistant', content: '좋아요 [ARTIFACT_UPDATE: 문제상황=| a | b |\n| c | d |] 정리했어요\n[ACTIVITY_ADVANCE: Ds-1-3]', activityCode: 'Ds-1-2' },
    { role: 'user', content: '학교 화단 그늘 지도를 만들자', activityCode: 'Ds-1-2', displayName: '캔바1' },
    { role: 'user', content: '다른 활동 대화', activityCode: 'Ds-1-1', displayName: '캔바1' },
    { role: 'system', content: '시스템', activityCode: 'Ds-1-2' },
  ]
  const all = task033.buildRecentConversationContext(messages)
  assert.equal(all, '홍성용: 오래된 이야기\n\nAI: 좋아요  정리했어요\n\n캔바1: 학교 화단 그늘 지도를 만들자')
  assert.doesNotMatch(all, /ARTIFACT_UPDATE|ACTIVITY_ADVANCE|다른 활동|시스템/)
  const recent = task033.buildRecentConversationContext(messages, 'Ds-1-2', 30)
  assert.equal(recent, '캔바1: 학교 화단 그늘 지도를 만들자')
  const tail = task033.buildRecentConversationContext([{ role: 'user', content: '나'.repeat(100), activityCode: 'Ds-1-2' }], 'Ds-1-2', 20)
  assert.equal(tail.length, 20)
  assert.ok(tail.startsWith('…'))
  assert.equal(task033.buildRecentConversationContext([]), '')
})

test('33c: 생성 프롬프트에 팀 준비·최근 대화·우선순위 한 줄이 들어가고, 없으면 블록이 생기지 않는다', () => {
  const base = { projectTitle: 'p', targetGradeGroup: '1-2', targetSubjects: ['과학'], nodeContext: '' }
  const withCtx = task033gen.buildOutlinePrompts({ ...base, teamPreparation: '[팀 비전 (T-1)]\n생활 속 문제', recentConversation: '캔바1: 그늘 지도' }).user
  assert.match(withCtx, /=== T단계 팀 준비 \(비전·원칙·역할·규칙·일정\) ===\n\[팀 비전 \(T-1\)\]/)
  assert.match(withCtx, /=== Ds-2 문제상황 대화의 최근 내용 \(오래된 것은 생략\) ===\n캔바1: 그늘 지도/)
  assert.match(withCtx, /충돌하면 확정 산출물을 우선하되, 대화에 나온 구체적 아이디어\(소재·장면·학생 활동\)는 시나리오 장면에 반영/)
  const without = task033gen.buildOutlinePrompts(base).user
  assert.doesNotMatch(without, /T단계 팀 준비|Ds-2 문제상황 대화|우선순위:/)
  const route = fs.readFileSync(new URL('../src/app/api/problem-situation/generate/route.ts', import.meta.url), 'utf8')
  assert.match(route, /recentConversation\.slice\(-CONVERSATION_CONTEXT_LIMIT\)/)
  const designer = fs.readFileSync(new URL('../src/components/problem-situation/ProblemSituationDesigner.tsx', import.meta.url), 'utf8')
  assert.match(designer, /setTeamPreparation\(buildTeamPreparationContext\(d\?\.artifacts\)\)/)
  assert.match(designer, /recentConversation: buildRecentConversationContext\(useProjectStore\.getState\(\)\.messages\)/)
})

// ─── TASK-034: 보고서 화면 MD3 표 · 모바일 모달 · 내보내기 보존 ─────────
const reportIcons = loadArtifactTsx('../src/components/ui/ReportSectionIcon.tsx', {})
const reportPhosphorIcons = new Proxy({}, { get: (_, name) => props => React.createElement('svg', { ...props, 'data-report-icon': String(name) }) })
const reportBindings = {
  react: React,
  'react-markdown': { __esModule: true, default: ReactMarkdown },
  '@/lib/markdown/remarkPlugins': { REMARK_PLUGINS },
  '@/lib/markdown/reportDisplay': { cleanReportMarkdown },
  '@/components/ui/ReportSectionIcon': reportIcons,
  '@/types': { STAGES, displayActivityCode },
  '@/lib/ui/stageColors': { STAGE_COLOR },
  './reportDashboardStyles': { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, reportStageColors },
  '@/lib/report/reportSections': { REPORT_SECTIONS, findReportSection },
  '@phosphor-icons/react': reportPhosphorIcons,
}
const { ReportMarkdown, ReportHero, reportSummary } = loadArtifactTsx('../src/components/modals/ReportMarkdown.tsx', reportBindings)

test('034a: 보고서 MD3 데이터 표는 학년군·강조를 보존하고 고정 머리글·첫 열 최소 폭·내부 스크롤을 제공한다', () => {
  const markdown = '# 보고서\n\n## 📊 완성도 평가\n\n**‘일’**로 정하고 1~3개를 비교한다.\n\n1. 첫 활동\n2. 둘째 활동\n\n| 학년군 | 근거 |\n| --- | --- |\n| **1-2학년군** | 3-4학년군 자료\u2028[4사08-02] |\n| 5-6학년군 | 【자료1】 / 【자료2】 |'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: markdown }))
  assert.match(html, /<strong[^>]*>‘일’<\/strong>로/)
  assert.match(html, /1~3개/)
  for (const label of ['1-2학년군', '3-4학년군', '5-6학년군']) assert.ok(html.includes(`<span class="whitespace-nowrap">${label}</span>`))
  assert.match(html, /<strong[^>]*><span><span class="whitespace-nowrap">1-2학년군/)
  assert.match(html, /role="region" aria-label="보고서 표" tabindex="0" class="report-table-scroll"/)
  assert.match(REPORT_DASHBOARD_CSS, /min-width:440px/)
  assert.match(html, /<th scope="col"/); assert.match(REPORT_DASHBOARD_CSS, /position:sticky;top:0/)
  assert.match(REPORT_DASHBOARD_CSS, /td:first-child\{min-width:7rem/)
  assert.match(html, /<br\/>[\s\S]*class="report-standard">\[4사08-02\]/)
  assert.match(html, /【자료1】<\/span><span><br\/>【자료2】/)
  assert.match(html, /<ol>/)
  assert.match(html, /report-section/)
  assert.doesNotMatch(html, /\*\*|<del>/)
})

function reportModalFixture(name, selected = false, isHost = true, content, pdfBusy = false) {
  const callbacks = []
  const markdown = content ?? '# 보고서\n\n| 학년군 | 내용 |\n| --- | --- |\n| 1-2학년군 | **‘일’**로 정하기 |'
  const project = { id: 'herdr', title: '기후위기', currentStage: 'Ds', artifacts: {}, stageReports: { Ds: { content: markdown, savedAt: 1 } } }
  let cursor = 0
  const states = name === 'StageAnalysisModal' ? [markdown, 'done', '', pdfBusy, ''] : [selected ? 'Ds' : null, pdfBusy, '']
  const { MD3Button } = loadArtifactTsx('../src/components/ui/MD3Button.tsx', { react: React, '@/lib/utils': { cn: (...v) => v.filter(Boolean).join(' ') } })
  const bindings = {
    react: { ...React, useState: () => [states[cursor++], () => {}], useEffect() {}, useLayoutEffect() {} },
    'react-markdown': { __esModule: true, default: ReactMarkdown },
    '@/components/ui/ReportSectionIcon': reportIcons,
    '@/lib/markdown/remarkPlugins': { REMARK_PLUGINS },
    '@/lib/markdown/reportDisplay': { cleanReportMarkdown },
    '@/store/project': { useProjectStore: () => ({ project, userProfile: { uid: 'member' }, setPendingStageMove() {} }) },
    '@/types': { STAGES, ACTIVITY_META },
    '@/components/ui/MD3Button': { MD3Button: props => { callbacks.push(props); return React.createElement(MD3Button, props) } },
    './ReportMarkdown': { ReportMarkdown, ReportHero },
    './printReport': { printReport() {} },
    './downloadReportPdf': { downloadReportPdf() {} },
    '@phosphor-icons/react': new Proxy({}, { get: () => () => null }),
    '@/lib/firebase/projects': { setAnalysisReport() {}, saveStageReport() {} },
    '@/lib/hwpx/generateHwpx': { generateHwpx() {} },
  }
  const module = loadArtifactTsx(`../src/components/modals/${name}.tsx`, bindings)
  const html = renderToStaticMarkup(React.createElement(module[name], { onClose() {}, isHost }))
  return { html, callbacks, markdown }
}

test('034b: 생성·저장 보고서 모달은 16px 모바일 여백·폭 제한·줄바꿈 버튼을 쓰며 팀원 이동 권한을 보존한다', () => {
  for (const [name, selected] of [['StageAnalysisModal', false], ['StageReportsModal', true]]) {
    const { html, callbacks } = reportModalFixture(name, selected, false)
    assert.match(html, /fixed inset-0 z-50[^>]*p-4/)
    assert.match(html, /role="dialog" aria-modal="true"/)
    assert.match(html, /w-full min-w-0 max-w-\[860px\]/)
    assert.match(html, /flex flex-wrap gap-2/)
    assert.match(html, /overflow-y-auto overflow-x-hidden/)
    assert.match(html, /rounded-\[var\(--md-sys-radius-xl\)\]/)
    assert.match(html, /aria-label="단계 (?:분석 )?보고서 닫기"/)
    assert.match(html, /class="report-dashboard"/)
    assert.doesNotMatch(html, /<div class="hidden" aria-hidden="true">|material-symbols/)
    assert.equal(callbacks.filter(b => b.variant === 'outlined').length, 2)
    assert.equal(callbacks.filter(b => b.variant === 'tonal').length, 1)
    assert.doesNotMatch(html, /단계로 이동|다시 생성|morph-btn/)
  }
  const host = reportModalFixture('StageAnalysisModal')
  assert.match(host.html, /단계로 이동/)
  assert.ok(host.callbacks.some(b => b.variant === 'filled'))
  const list = reportModalFixture('StageReportsModal')
  assert.match(list.html, /저장된 단계 보고서/)
  assert.match(list.html, /설계\(Ds\) 단계/)
})

test('034c: 화면의 보고서 DOM을 PDF에 공유하고 MD·HWPX 다운로드 입력은 유지한다', () => {
  const generated = fs.readFileSync(new URL('../src/components/modals/StageAnalysisModal.tsx', import.meta.url), 'utf8')
  const saved = fs.readFileSync(new URL('../src/components/modals/StageReportsModal.tsx', import.meta.url), 'utf8')
  for (const source of [generated, saved]) {
    assert.match(source, /<ReportMarkdown content=\{/)
    assert.match(source, /<div ref=\{contentRef\}>/)
    assert.match(source, /printReport\(contentRef\.current,/)
    assert.doesNotMatch(source, /<ReactMarkdown|className="hidden"|ReportIcon/)
  }
  assert.match(generated, /new Blob\(\[cleanReportMarkdown\(markdown\)\]/)
  assert.match(generated, /generateHwpx\(markdown,/)
  assert.match(saved, /new Blob\(\[cleanReportMarkdown\(selectedReport\.content\)\]/)
  assert.match(saved, /generateHwpx\(displayContent,/)
})

// ─── TASK-036: 학습자 프로필 가드레일 요약 ─────────
const stageBarSource = fs.readFileSync(new URL('../src/components/stage/StageBar.tsx', import.meta.url), 'utf8')
const stageBarTree = ts.createSourceFile('StageBar.tsx', stageBarSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const summarizeA23 = loadChatFunction('summarizeA23', { serializeArtifactForPrompt }, stageBarTree)

test('036a: 구조화 A-2-3 요약은 객체 행·중첩 객체를 읽을 수 있게 직렬화하고 내부 키를 숨긴다', () => {
  const content = {
    _schema: 'A-2-3', _meta: { version: 2 },
    commonProfile: [{ item: '선수지식', content: '사진과 지도를 비교한다', _internal: '비공개' }],
    teacherNotes: [{ teacherName: '사회 담당', note: '첫 인터뷰 질문 카드 준비' }],
    환경: { 기기: '태블릿 모둠당 1대', _debug: '비공개' },
  }
  const before = structuredClone(content)
  const summary = summarizeA23(content)
  assert.match(summary, /선수지식 \| 사진과 지도를 비교한다/)
  assert.match(summary, /사회 담당 \| 첫 인터뷰 질문 카드 준비/)
  assert.match(summary, /기기: 태블릿 모둠당 1대/)
  assert.doesNotMatch(summary, /\[object Object\]|_schema|_meta|_internal|_debug|비공개/)
  assert.deepEqual(content, before)
})

test('036b: 평문 요약·빈 산출물 처리를 보존하고 최대 4개 항목·항목별 200자 상한을 적용한다', () => {
  assert.equal(summarizeA23({ _schema: 'A-2-3', 선수지식: '지도 읽기', 오개념: '그늘은 모두 같다' }), '· 선수지식: 지도 읽기\n· 오개념: 그늘은 모두 같다')
  for (const content of [undefined, {}, { _schema: 'A-2-3' }, { 빈칸: ' ', 행: [], 객체: {}, 값: null }]) assert.equal(summarizeA23(content), null)
  const summary = summarizeA23({ _schema: 'A-2-3', 긴항목: '가'.repeat(500), 둘째: '둘', 셋째: '셋', 넷째: '넷', 다섯째: '제외' })
  const items = summary.split('\n')
  assert.equal(items.length, 4)
  assert.equal(items[0].length, 200)
  assert.ok(items[0].endsWith('…'))
  assert.doesNotMatch(summary, /다섯째|_schema/)
})

// ─── TASK-037 / #40: 평가 표 행 누락 · 명시적 삭제 요청 ─────────
const evaluationRowKeys = [
  '1-2학년군 결과물', '3-4학년군 결과물', '5-6학년군 결과물',
  '1-2학년군 발표 말하기', '3-4학년군 발표 말하기', '5-6학년군 발표 말하기',
  '모둠 참여 과정', '개인 성찰',
]
const evaluationTable = rows => '| 확인 지점 | 평가 요소 | 평가 방법 | 평가 시점 | 평가 주체 |\n| --- | --- | --- | --- | --- |\n'
  + rows.map(key => `| ${key} | 자료에 근거해 설명한다 | 관찰 | 발표 때 | 교사 |`).join('\n')

test('037a: 기존 8행에서 학년군별 발표 말하기 3행이 사라진 5행 수정안을 잡는다', () => {
  const nextKeys = evaluationRowKeys.filter(key => !key.includes('발표 말하기'))
  assert.deepEqual(findDroppedTableRows(evaluationTable(evaluationRowKeys), evaluationTable(nextKeys)), [
    '1-2학년군 발표 말하기', '3-4학년군 발표 말하기', '5-6학년군 발표 말하기',
  ])
})

test('037b: 행 순서·강조·공백·평가 내용 변경은 삭제로 보지 않고, 표 아닌 입력은 무시한다', () => {
  const previous = evaluationTable(evaluationRowKeys)
  assert.deepEqual(findDroppedTableRows(previous, evaluationTable([...evaluationRowKeys].reverse())), [])
  assert.deepEqual(findDroppedTableRows(previous, evaluationTable(evaluationRowKeys.map(key => `**${key.replaceAll(' ', '  ')}**`)).replaceAll('자료에 근거해 설명한다', '[4사08-02] A 수준을 확인한다')), [])
  assert.deepEqual(findDroppedTableRows('| 지점 | 내용 |\n|---|---|\n| *발표 말하기* | 확인 |', '| 지점 | 내용 |\n|---|---|\n| __발표 말하기__ | 확인 |'), [])
  for (const [before, after] of [['', previous], ['평문', previous], [previous, '평문'], [previous, '| 지점 | 내용 |\n| 데이터 | 값 |']]) assert.deepEqual(findDroppedTableRows(before, after), [])
  assert.deepEqual(findDroppedTableRows('```md\n' + previous + '\n```', evaluationTable([])), [])
  assert.deepEqual(findDroppedTableRows(previous, evaluationTable([])), evaluationRowKeys)
  assert.deepEqual(findDroppedTableRows('| 지점 | 내용 |\n|---|---|\n| **발표**\\|말하기 | 확인 |', '| 지점 | 내용 |\n|---|---|'), ['발표|말하기'])
})

test('037c: 줄·행·항목·확인 지점 삭제/병합 요청만 참이고 코드·단어 삭제와 부정 요청은 거짓이다', () => {
  for (const text of ['발표 말하기 행은 빼 주세요', '중복 항목 삭제 부탁해요', '마지막 줄을 지워 주세요', '이 행은 없애 주세요', '확인 지점을 줄여 주세요', '두 행을 합쳐 주세요', '발표 말하기 항목을 통합해 주세요']) {
    assert.equal(userAskedToDeleteRows([text]), true, text)
  }
  for (const text of ['[4사08-02]는 빼 주세요', '성취기준 코드만 삭제해 주세요', '문구를 줄여 주세요', '확인 지점의 코드만 빼 주세요', '행은 그대로 두고 단어만 지워 주세요', '발표 말하기 행은 삭제하지 말아 주세요', '평가 계획 표는 그대로 두고 코드만 붙여 다시 저장해 주세요', '다음 활동으로 가요']) {
    assert.equal(userAskedToDeleteRows([text]), false, text)
  }
  assert.equal(userAskedToDeleteRows([]), false)
  assert.equal(userAskedToDeleteRows(['코드만 붙여 주세요', '중복 항목은 삭제해 주세요']), true)
})

test('037d: Ds-1-3 차시·활동 삭제와 병합은 허용하지만 코드만 빼는 요청은 제외한다', () => {
  for (const text of ['4차시랑 5차시 합쳐 주세요', '3차시 빼 주세요', '이 활동은 빼 주세요']) {
    assert.equal(userAskedToDeleteRows([text]), true, text)
  }
  for (const text of ['[2수04-02]는 빼 주세요', '3차시의 [2수04-02]는 빼 주세요', '이 활동의 코드만 삭제해 주세요', '이 활동은 삭제하지 말아 주세요']) {
    assert.equal(userAskedToDeleteRows([text]), false, text)
  }
})

// ─── TASK-038: 근거 코드 허용 목록 주입·저장 관문 (#39 지어낸 코드, #41 수준 글자) ─────────
const task038 = await import('../src/lib/chat/evidenceCodeGate.ts')

test('38a: (근거: …) 묶음 안의 허용 목록 밖 코드만 수준 글자와 함께 지우고, 비면 확인 필요로 바꾼다', () => {
  const allowed = new Set(['[2국03-02]', '[4사08-02]'])
  const text = '| 결과물 | 그늘 지도에 [2수04-02] 를 활용함 (근거: [2국03-02] B, [2수04-02] A) |\n| 측정 | 길이 재기 (근거: [2수04-02] A) |\n| 과정 | 역할 수행 (근거: 과정 평가) |'
  const result = task038.stripDisallowedEvidenceCodes(text, allowed)
  assert.deepEqual(result.removed, ['[2수04-02]'])
  assert.match(result.text, /그늘 지도에 \[2수04-02\] 를 활용함 \(근거: \[2국03-02\] B\)/) // 묶음 밖은 그대로
  assert.match(result.text, /길이 재기 \(근거: 확인 필요\)/)
  assert.match(result.text, /역할 수행 \(근거: 과정 평가\)/)
  const clean = task038.stripDisallowedEvidenceCodes('(근거: [2국03-02] A·B, [4사08-02] A)', allowed)
  assert.equal(clean.text, '(근거: [2국03-02] A·B, [4사08-02] A)')
  assert.deepEqual(clean.removed, [])
})

test('38b: 관문은 Ds-1-1 평가 계획·Ds-1-3 학습 활동만 거르고, 허용 목록이 비면 아무것도 지우지 않는다', () => {
  const updates = [
    { activityCode: 'Ds-1-1', sections: { '평가 계획': '| a | b (근거: [9과01-01] A) |', '메모': '(근거: [9과01-01] A)' } },
    { sections: { '학습 활동': '| 1 | 조사 (근거: [9과01-01] A, [2국03-02] B) |' } },
    { activityCode: 'Ds-1-2', sections: { '선정 문제 상황': '(근거: [9과01-01] A)' } },
  ]
  const gate = task038.gateEvidenceCodes(updates, 'Ds-1-3', ['[2국03-02]'])
  assert.equal(gate.updates[0].sections['평가 계획'], '| a | b (근거: 확인 필요) |')
  assert.equal(gate.updates[0].sections['메모'], '(근거: [9과01-01] A)')
  assert.equal(gate.updates[1].sections['학습 활동'], '| 1 | 조사 (근거: [2국03-02] B) |')
  assert.equal(gate.updates[2], updates[2])
  assert.deepEqual(gate.removed, ['[9과01-01]'])
  assert.equal(task038.evidenceGateNotice(gate.removed), '분석표에 없는 코드 [9과01-01]는 저장에서 뺐습니다.')
  assert.equal(task038.evidenceGateNotice([]), '')
  assert.equal(task038.appendSaveGateNotice('본문  ', ['', '안내']), '본문\n\n안내')
  assert.equal(task038.appendSaveGateNotice('본문', ['']), '본문')
  const none = task038.gateEvidenceCodes(updates, 'Ds-1-3', [])
  assert.deepEqual(none.removed, [])
  assert.equal(none.updates[0].sections['평가 계획'], updates[0].sections['평가 계획'])
})

test('38c: Ds-1-1·Ds-1-3 프롬프트에 허용 근거 코드 목록과 형식 줄(수준 글자 없음)이 붙고, 저장 두 경로가 관문을 거친다', () => {
  const ctx = task038.buildAllowedEvidenceCodesContext('Ds-1-1', ['[2국03-02]', '[4사08-02]'])
  assert.match(ctx, /허용 근거 코드 목록[\s\S]*\[2국03-02\] \[4사08-02\]/)
  assert.match(ctx, /목록 밖 코드는 저장 단계에서 자동으로 지워진다/)
  assert.match(ctx, /"\(근거: \[코드\]\)", 여러 개면 쉼표로 잇는다/)
  assert.match(ctx, /코드 뒤에 A·B·C 같은 수준 글자는 붙이지 않는다/)
  assert.doesNotMatch(ctx, /반드시 붙인다/)
  assert.ok(task038.buildAllowedEvidenceCodesContext('Ds-1-3', ['[2국03-02]']))
  assert.equal(task038.buildAllowedEvidenceCodesContext('Ds-1-2', ['[2국03-02]']), '')
  assert.equal(task038.buildAllowedEvidenceCodesContext('Ds-1-1', []), '')
  const route = fs.readFileSync(new URL('../src/app/api/chat/stream/route.ts', import.meta.url), 'utf8')
  assert.match(route, /achievementLevelContext \+ allowedEvidenceContext \+ materialContext/)
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /gateArtifactUpdates\(rawUpd, rawCCodes, text\)/)
  assert.match(panel, /gateArtifactUpdates\(rawUpdates, rawConfirmCodes2, userMessage\)/)
  assert.match(panel, /processArtifactSignals\(upd, cCodes, finalText\)/)
  assert.match(panel, /processArtifactSignals\(updates, confirmCodes2, displayText\)/)
})

const task038gate = await import('../src/lib/chat/artifactSaveGate.ts')
const task038prev = '| 확인 지점 | 평가 요소 | 평가 방법 | 평가 시점 | 평가 주체 |\n|---|---|---|---|---|\n| 1-2학년군 결과물 | a (근거: [2국03-02] B) | 관찰 | 발표 | 교사 |\n| 3-4학년군 결과물 | b (근거: [4사08-02] A) | 관찰 | 발표 | 교사 |\n| 5-6학년군 결과물 | c (근거: [6국03-02] A) | 관찰 | 발표 | 교사 |\n| 모둠 참여 과정 | d (근거: 과정 평가) | 관찰 | 협의 | 교사 |'
const task038next = '| 확인 지점 | 평가 요소 | 평가 방법 | 평가 시점 | 평가 주체 |\n|---|---|---|---|---|\n| 1-2학년군 결과물 | a2 (근거: [2국03-02] B, [2수04-02] A) | 관찰 | 발표 | 교사 |'

test('38d: 이전 표의 행이 빠지고 삭제 요청이 없으면 그 섹션 저장과 확정을 함께 보류하고 안내한다', () => {
  const input = {
    updates: [{ sections: { '평가 계획': task038next, '메모': '그대로 저장' } }, { activityCode: 'Ds-1-2', sections: { '선정 문제 상황': 'x' } }],
    confirmCodes: ['', 'Ds-1-2'],
    currentActivity: 'Ds-1-1',
    allowedCodes: ['[2국03-02]', '[4사08-02]', '[6국03-02]'],
    previousSection: (code, key) => code === 'Ds-1-1' && key === '평가 계획' ? task038prev : '',
    recentUserTexts: ['표는 그대로 두고 근거 코드만 고쳐 주세요'],
  }
  const held = task038gate.gateArtifactSave(input)
  assert.deepEqual(held.updates, [{ sections: { '메모': '그대로 저장' } }, { activityCode: 'Ds-1-2', sections: { '선정 문제 상황': 'x' } }])
  assert.deepEqual(held.confirmCodes, ['Ds-1-2'])
  assert.deepEqual(held.notices, [
    '분석표에 없는 코드 [2수04-02]는 저장에서 뺐습니다.',
    `이전 표의 '3-4학년군 결과물', '5-6학년군 결과물' 등 3줄이 빠져 저장하지 않았습니다. 일부러 지운 거라면 "그 줄은 지우고 저장"이라고 말씀해 주세요.`,
  ])
  // 사용자가 줄 삭제를 요청하면 저장한다(근거 코드 정리는 그대로 적용).
  const allowed = task038gate.gateArtifactSave({ ...input, recentUserTexts: ['그 줄은 지우고 저장'] })
  assert.equal(allowed.updates[0].sections['평가 계획'], task038next.replace(', [2수04-02] A', ''))
  assert.deepEqual(allowed.confirmCodes, ['', 'Ds-1-2'])
  assert.deepEqual(allowed.notices, ['분석표에 없는 코드 [2수04-02]는 저장에서 뺐습니다.'])
  // 처음 저장(이전 표 없음)은 보류하지 않는다.
  const first = task038gate.gateArtifactSave({ ...input, previousSection: () => '' })
  assert.ok(first.updates[0].sections['평가 계획'])
})

test('38e: 구조화 저장본도 첫 열로 비교하고, 다른 활동은 행이 빠져도 그대로 저장한다', () => {
  assert.equal(task038gate.previousSectionText({ rubric: [{ checkpoint: '결과물' }, { checkpoint: '과정' }] }, 'Ds-1-1', '평가 계획'), '| 첫 열 |\n|---|\n| 결과물 |\n| 과정 |')
  assert.equal(task038gate.previousSectionText({ activities: [{ order: '1' }, { order: '2' }] }, 'Ds-1-3', '학습 활동'), '| 첫 열 |\n|---|\n| 1 |\n| 2 |')
  assert.equal(task038gate.previousSectionText({ '학습 활동': '| a |' }, 'Ds-1-3', '학습 활동'), '| a |')
  assert.equal(task038gate.previousSectionText(undefined, 'Ds-1-1', '평가 계획'), '')
  const other = task038gate.gateArtifactSave({
    updates: [{ sections: { '학습활동-도구 매칭': task038next } }],
    confirmCodes: [''], currentActivity: 'Ds-2-1', allowedCodes: ['[2국03-02]'],
    previousSection: () => task038prev, recentUserTexts: [],
  })
  assert.equal(other.updates[0].sections['학습활동-도구 매칭'], task038next)
  assert.deepEqual(other.confirmCodes, [''])
  assert.deepEqual(other.notices, [])
})

// ─── TASK-040: 보고서 히어로 · 섹션 카드 · 인사이트 · 숫자 열 ─────────
test('040a: ##별 카드에 제목과 본문을 묶고, 코드 블록 제목은 제외하며 소제목·목록·권고를 구조화한다', () => {
  const content = '# 보고서\n\n## 새 보고서 핵심 메모\n\n근거를 확인해 주세요.\n\n> 조사 결과를 다음 활동에 활용하세요.\n\n### Ds-3 학습활동\n\n- 지도 비교\n- 인터뷰\n\n3. 질문 만들기\n4. 기록하기\n\n## 새 활동 기록\n\n```md\n## 코드 블록 제목\n```\n\n| 학년군 | 활동 수 | 도달률 |\n| --- | --- | --- |\n| 1-2학년군 | 3 | 80% |\n| 3-4학년군 | 4 | 90% |'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content }))
  assert.equal((html.match(/<section data-report-section/g) ?? []).length, 2)
  assert.match(html, /<section[^>]*>[\s\S]*<h2[^>]*>[\s\S]*새 보고서 핵심 메모[\s\S]*<div class="report-body">[\s\S]*근거를 확인해 주세요/)
  assert.match(html, /data-report-icon="Target"/)
  assert.match(html, /data-report-icon="ListChecks"/)
  assert.match(html, /<aside role="note" aria-label="인사이트와 권고"/)
  assert.doesNotMatch(html, /인사이트 · 권고|report-callout-label/)
  assert.match(html, /<h3>Ds-3 학습활동<\/h3>/)
  assert.match(html, /aria-hidden="true">•<\/span>/)
  assert.match(html, /aria-hidden="true">3<\/span>/)
  assert.match(html, /aria-hidden="true">4<\/span>/)
  assert.match(html, /<th[^>]*style="text-align:right;min-width:\d+ch">활동 수<\/th>/)
  assert.match(html, /<th[^>]*style="text-align:right;min-width:\d+ch">도달률<\/th>/)
  assert.match(html, /<td[^>]*style="text-align:right;min-width:\d+ch"><span>80%<\/span><\/td>/)
  assert.match(html, /<span class="whitespace-nowrap">1-2학년군<\/span>/)
})

test('040b: 히어로는 현재 단계 데이터로 활동·확정 수와 프로젝트·생성일·갱신일을 표시한다', () => {
  const project = { title: '우리 동네 폭염과 그늘', updatedAt: { toMillis: () => 1700000000000 }, artifacts: { 'Ds-1-1': { status: 'confirmed' }, 'Ds-1-2': { status: 'draft' }, 'T-1-1': { status: 'confirmed' } } }
  const html = renderToStaticMarkup(React.createElement(ReportHero, { stage: 'Ds', project, generatedAt: 1700000000000 }))
  assert.match(html, /설계 단계/)
  assert.match(html, /우리 동네 폭염과 그늘/)
  assert.match(html, /data-report-icon="PencilRuler"/)
  assert.match(html, /<dt>활동<\/dt><dd>[\s\S]*5<small>개<\/small><\/dd>/)
  assert.match(html, /<dt>확정<\/dt><dd>[\s\S]*1<small>개<\/small><\/dd>/)
  assert.match(html, /생성일 ·/)
  assert.match(html, /마지막 갱신/)
  assert.match(html, /class="report-metrics"/)
  const generating = renderToStaticMarkup(React.createElement(ReportHero, { stage: 'A', project: null, generating: true }))
  assert.match(generating, /보고서 생성 중/)
  assert.doesNotMatch(generating, /생성일 ·|마지막 갱신/)
  for (const [name, selected] of [['StageAnalysisModal', false], ['StageReportsModal', true]]) {
    assert.match(reportModalFixture(name, selected).html, /data-report-hero/)
  }
})

test('040c: 공용 섹션 이름의 아이콘과 단계별 정렬 제목을 사용하고, 예전 제목은 키워드로 선택한다', () => {
  for (const section of REPORT_SECTIONS) {
    const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: `## **${section.title}**\n\n내용` }))
    assert.ok(html.includes(`data-report-icon="${section.icon}"`), section.title)
  }
  for (const [title, icon] of [['팀 협력 구조 점검', 'UsersThree'], ['성찰·개선 연결', 'ArrowsClockwise'], ['옛 보고서 출처 목록', 'Database'], ['새 탐구 질문', 'Question'], ['추가 인사이트', 'Lightbulb']]) {
    const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: `## ${title}\n\n내용` }))
    assert.ok(html.includes(`data-report-icon="${icon}"`), title)
  }
})

// ─── TASK-039: 단계 분석 보고서 — 구조화 형식·원문 자리표시·직렬화 ─────────
const task039sections = await import('../src/lib/report/reportSections.ts')
const task039ph = await import('../src/lib/report/artifactPlaceholders.ts')
const task039prompt = await import('../src/lib/report/stageReportPrompt.ts')

test('39a: 보고서 고정 섹션 상수와 단계별 정렬 섹션, 예전 머리글은 null', () => {
  assert.deepEqual(task039sections.REPORT_SECTIONS.map(s => s.title), ['이 단계 핵심 요약', '한눈에 보기', '활동별 산출물 및 분석', '성취기준·평가 연결', '잘 설계된 점', '함께 다듬어 볼 아이디어', '다음 단계 제안', '부록: 산출물 원문'])
  assert.ok(task039sections.REPORT_SECTIONS.every(s => s.key && s.icon))
  assert.equal(task039sections.reportSectionsFor('T')[3].title, '팀 협력 구조 살펴보기')
  assert.equal(task039sections.reportSectionsFor('Ds')[3].title, '성취기준·평가 연결')
  assert.equal(task039sections.REPORT_SECTIONS[3].title, '성취기준·평가 연결') // 원본 상수는 바뀌지 않음
  assert.equal(task039sections.findReportSection('🎯 이 단계 핵심 요약')?.key, 'summary')
  assert.equal(task039sections.findReportSection('성찰·개선 연결')?.key, 'alignment')
  assert.equal(task039sections.findReportSection('설계 강점 (산출물 근거 기반)'), null)
})

test('39b: 자리표시는 청크가 어디서 잘려도 원문으로 바뀌고, 모르는 코드·일반 중괄호는 그대로 둔다', () => {
  const originals = { 'Ds-1-2': '원문 [4사08-02], 6학년은 끝까지' }
  const whole = '앞\n{{ARTIFACT:Ds-1-2}}\n뒤 {중괄호} {{ARTIFACT:X-9-9}}'
  const expected = '앞\n원문 [4사08-02], 6학년은 끝까지\n뒤 {중괄호} {{ARTIFACT:X-9-9}}'
  for (let size = 1; size <= whole.length; size++) {
    const ex = task039ph.createArtifactPlaceholderExpander(originals)
    let out = ''
    for (let i = 0; i < whole.length; i += size) out += ex.push(whole.slice(i, i + size))
    out += ex.flush()
    assert.equal(out, expected, `chunk ${size}`)
  }
  const unterminated = task039ph.createArtifactPlaceholderExpander(originals)
  assert.equal(unterminated.push('끝 {{ARTI') + unterminated.flush(), '끝 {{ARTI')
})

test('39c: 산출물 원문은 JSON 원문 대신 표·문장으로, 프롬프트는 고정 머리글·자리표시·3문장 규칙을 쓴다', () => {
  const artifacts = {
    'Ds-1-1': { status: 'confirmed', content: { _schema: 'Ds-1-1', rubric: [{ checkpoint: '결과물', item: 'a\nb', method: '관찰|기록' }], manualWorkspace: { blocks: [1] } } },
    'Ds-1-2': { content: { _schema: 'Ds-1-2', '선정 문제 상황': { 제목: '그늘', 데이터출처: [{ label: '관찰 사진' }] }, '핵심 질문': '왜?' } },
  }
  const originals = task039prompt.buildArtifactOriginals('Ds', artifacts)
  assert.equal(originals['Ds-1-1'], '**rubric**\n\n| checkpoint | item | method |\n| --- | --- | --- |\n| 결과물 | a / b | 관찰\\|기록 |')
  assert.doesNotMatch(originals['Ds-1-2'], /[{}"]|\[object Object\]/)
  assert.match(originals['Ds-1-2'], /제목: 그늘/)
  assert.match(originals['Ds-1-3'], /아직 작성되지 않았습니다/)
  const overview = task039prompt.buildOverviewTable('Ds', artifacts)
  assert.match(overview, /\| 평가 설계 \(Ds-1\) \| 확정 \| 1개 \|/)
  assert.match(overview, /\(Ds-3\) \| 미작성 \| - \|/)
  const prompt = task039prompt.buildAnalysisPrompt('Ds', { title: 'herdr', targetGradeGroup: '초1-6' }, artifacts)
  for (const title of ['이 단계 핵심 요약', '한눈에 보기', '활동별 산출물 및 분석', '성취기준·평가 연결', '잘 설계된 점', '함께 다듬어 볼 아이디어', '다음 단계 제안']) {
    assert.match(prompt, new RegExp(`\\n## ${title}\\n`))
  }
  // TASK-042: 원문 자리표시는 본문이 아니라 서버가 붙이는 부록에 있다.
  assert.doesNotMatch(prompt, /\{\{ARTIFACT:/)
  assert.match(task039prompt.buildArtifactAppendix('Ds'), /\n\{\{ARTIFACT:Ds-1-1\}\}/)
  assert.match(prompt, /문단을 쓰지 않는다/)
  assert.match(prompt, /'> ' 인용 한 줄/)
  assert.doesNotMatch(prompt, /## 설계 단계 심층 분석|JSON\.stringify/)
  const route = fs.readFileSync(new URL('../src/app/api/analyze/stage/route.ts', import.meta.url), 'utf8')
  assert.match(route, /sendText\(expander\.push\(/)
  assert.doesNotMatch(route, /JSON\.stringify\(v/)
})

test('39d: A-2-1 표 구분선 칸 수가 머리글과 같고, Ds-2 데이터 출처 문자열을 쉼표로 쪼개지 않는다', () => {
  const a21 = task039prompt.buildArtifactOriginals('A', { 'A-2-1': { content: { _schema: 'A-2-1', rows: [{ subject: '국어', coreIdea: 'x', knowledgeUnderstanding: 'k', processFunction: 'p' }] } } })['A-2-1']
  const lines = a21.split('\n').filter(line => line.startsWith('|'))
  assert.equal(lines[0].split('|').length, lines[1].split('|').length)
  const renderer = fs.readFileSync(new URL('../src/components/artifacts/structured/Ds12Renderer.tsx', import.meta.url), 'utf8')
  assert.match(renderer, /ds\.split\(\/\\n\|\\s\+\\\/\\s\+\/\)/)
  assert.doesNotMatch(renderer, /ds\.split\(\/\[\\n,\]\/\)/)
})

// ─── TASK-042: 대시보드형 보고서 — 요약 두 줄·짧은 글머리·부록 원문 ─────────
test('42a: 요약은 한 문장(60자)+키워드 줄, 강점·보완점 글머리 3개, 다음 단계 번호 3개, 활동별 글머리 2개+인용', () => {
  const artifacts = { 'Ds-1-1': { content: { '평가 계획': '| a | b |\n|---|---|\n| 1 | 2 |' } } }
  const prompt = task039prompt.buildAnalysisPrompt('Ds', { title: 'herdr', targetGradeGroup: '초1-6' }, artifacts)
  const section = title => prompt.split(`\n## ${title}\n`).pop().split('\n## ')[0]
  assert.match(section('이 단계 핵심 요약'), /^\n\(팀이 만든 설계의 핵심을 교사 눈높이로 한 문장 — 60자 이내\)\n키워드: \(핵심 키워드 3~5개를 ' · '로 구분\)\n/)
  assert.equal((section('잘 설계된 점').match(/^- \*\*/gm) ?? []).length, 3)
  assert.equal((section('함께 다듬어 볼 아이디어').match(/^- \*\*/gm) ?? []).length, 3)
  assert.doesNotMatch(section('함께 다듬어 볼 아이디어'), /\|/)
  assert.equal((section('다음 단계 제안').match(/^\d\. /gm) ?? []).length, 3)
  const activity = section('활동별 산출물 및 분석').split('\n### ')[1]
  assert.equal((activity.match(/^- /gm) ?? []).length, 2)
  assert.equal((activity.match(/^> /gm) ?? []).length, 1)
  for (const table of section('한눈에 보기').split('\n\n').filter(block => block.startsWith('|'))) {
    const columns = table.split('\n')[0].split('|').length - 2
    assert.ok(columns >= 3 && columns <= 4, table.split('\n')[0])
  }
  assert.match(prompt, /항목당 40자 안팎/)
  assert.doesNotMatch(prompt, /## 부록/) // AI 는 부록을 쓰지 않는다
})

test('42b: 서버가 붙이는 부록은 고정 머리글과 활동별 원문으로 치환되고, 스트림 끝에 한 번만 붙는다', () => {
  const appendix = task039prompt.buildArtifactAppendix('Ds')
  assert.match(appendix, /^\n\n## 부록: 산출물 원문\n\n### 평가 설계 \(Ds-1\)\n\n\{\{ARTIFACT:Ds-1-1\}\}/)
  assert.equal(task039sections.findReportSection('부록: 산출물 원문')?.key, 'appendix')
  const originals = task039prompt.buildArtifactOriginals('Ds', { 'Ds-1-2': { content: { '데이터 출처': '사진, 지도' } } })
  const ex = task039ph.createArtifactPlaceholderExpander(originals)
  const out = ex.push(appendix) + ex.flush()
  assert.match(out, /### 문제 상황 설정 \(Ds-2\)\n\n\*\*데이터 출처\*\*\n\n사진, 지도/)
  assert.doesNotMatch(out, /\{\{ARTIFACT:/)
  const route = fs.readFileSync(new URL('../src/app/api/analyze/stage/route.ts', import.meta.url), 'utf8')
  assert.match(route, /if \(appendixSent\) return/)
  assert.ok(route.indexOf('sendAppendix()') < route.indexOf("type: 'done'"))
})

// ─── TASK-041: 대시보드 · 화면/PDF 동일 마크업 · SVG · 인쇄 색 ─────────
test('041a: 새 요약·키워드를 히어로에 표시하고 기존 보고서·코드 블록은 손실 없이 유지한다', () => {
  const content = '```md\n## 이 단계 핵심 요약\n가짜 요약\n```\n\n## 이 단계 핵심 요약\n근거로 학생의 성장을 확인했습니다.\n키워드: 인터뷰 · 그늘 지도 · 시민 참여\n\n## 강점\n- 질문을 자기 말로 바꿨습니다.'
  const result = reportSummary(content)
  assert.equal(result.summary, '근거로 학생의 성장을 확인했습니다.')
  assert.deepEqual(Array.from(result.keywords), ['인터뷰', '그늘 지도', '시민 참여'])
  const hero = renderToStaticMarkup(React.createElement(ReportHero, { stage: 'Ds', project: { title: '동네 폭염', artifacts: { 'Ds-1-1': { status: 'confirmed', version: 3 }, 'Ds-1-2': { status: 'draft', version: 2 }, 'T-1-1': { status: 'confirmed', version: 8 } } }, content }))
  assert.match(hero, /background-color:#e6f3f2;color:#007065/)
  assert.doesNotMatch(hero, /linear-gradient|report-chip|report-kpi/)
  assert.equal((hero.match(/class="report-metric"/g) ?? []).length, 4)
  for (const [label, count, unit] of [['활동', 5, '개'], ['확정', 1, '개'], ['산출물', 2, '개'], ['저장 버전', 5, '회']]) {
    assert.match(hero, new RegExp(`${label}</dt><dd>[\\s\\S]*?${count}<small>${unit}</small></dd>`), label)
  }
  const old = '## 옛 수업 분석\n\n먼저 학생의 질문 기록을 확인하고 모둠별 차이를 검토합니다.\n\n### 기존 활동\n\n- 원래 기록\n\n| 학년군 | 근거 |\n| --- | --- |\n| 3-4학년군 | [4사08-02] |'
  assert.equal(reportSummary(old).summary, '')
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: old }))
  for (const text of ['먼저 학생의 질문 기록', '기존 활동', '원래 기록', '[4사08-02]']) assert.ok(html.includes(text))
  assert.match(html, /<table\b/)
  assert.doesNotMatch(html, /material-symbols|\[object Object\]/)
})

test('041b: 강점·보완점·정렬·다음 단계·활동 카드를 구조화하고 실제 해당 단계의 확정 상태를 표시한다', () => {
  const content = '## 강점\n- 학생이 근거를 찾았습니다.\n\n## 보완점\n- 첫 질문을 돕습니다.\n\n## 다음 단계 제안\n- 질문 카드 준비\n- 주민에게 묻기\n\n## 성취기준·평가 정렬\n- [4사08-02] 지역 문제 해결\n\n| 학년군 | 성취기준 | 수 |\n| --- | --- | --- |\n| 3-4학년군 | [4사08-02] | 3 |\n\n## 활동별 산출물 및 분석\n### Ds-1 평가 설계\n- 관찰 기준표\n### Ds-2 문제 상황\n- 그늘 지도\n### Ds-3 학습활동\n- 인터뷰'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'Ds', project: { artifacts: { 'Ds-1-1': { status: 'confirmed' }, 'Ds-1-2': { status: 'draft' }, 'T-1-1': { status: 'confirmed' } } } }))
  for (const kind of ['strengths', 'improvements', 'next', 'alignment', 'activities']) assert.ok(html.includes(`data-report-kind="${kind}"`))
  assert.doesNotMatch(html, /class="report-grid"|class="report-chip"/)
  assert.equal((html.match(/<article class="report-activity"/g) ?? []).length, 3)
  assert.match(html, /data-status="confirmed">확정/)
  assert.match(html, /data-status="draft">작성 중/)
  assert.match(html, /data-status="missing">산출물 없음/)
  assert.match(html, /aria-hidden="true">1<\/span>/)
  assert.match(html, /aria-hidden="true">2<\/span>/)
  assert.match(html, /class="report-standard">\[4사08-02\]/)
  assert.match(html, /<td data-short-cell="true" data-label="수" style="text-align:right;min-width:\d+ch"><span>3<\/span><\/td>/)
  assert.doesNotMatch(REPORT_DASHBOARD_CSS, /grid-template-columns|linear-gradient/)
  assert.match(REPORT_DASHBOARD_CSS, /max-width:540px/)
  assert.match(REPORT_DASHBOARD_CSS, /padding:7px 10px/)
})

test('041c: 실제 phosphor SVG와 화면 마크업·CSS를 그대로 인쇄하며 제목을 이스케이프한다', () => {
  const real = loadArtifactTsx('../src/components/modals/ReportMarkdown.tsx', { ...reportBindings, '@phosphor-icons/react': phosphorIcons })
  const content = '## 이 단계 핵심 요약\n학생들이 동네 자료를 근거로 제안했습니다.\n키워드: 동네 · 근거\n\n## 강점\n- **‘일’**로 정하고 1~3개 비교\n\n## 보완점\n- 질문 카드 준비'
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(real.ReportHero, { stage: 'A', project: null, content }),
    React.createElement(real.ReportMarkdown, { content })))
  assert.match(markup, /<svg[\s\S]*<(?:path|circle|rect)/)
  const document = buildReportPrintDocument(markup, '</title><script>침입</script> & 보고서')
  assert.equal(document.split('<body>')[1].split('</body>')[0], markup)
  assert.ok(document.includes(REPORT_DASHBOARD_CSS))
  assert.match(document, /<title>&lt;\/title&gt;&lt;script&gt;침입&lt;\/script&gt; &amp; 보고서<\/title>/)
  assert.match(document, /@page\{size:A4/)
  assert.match(document, /break-inside:avoid/)
  assert.match(document, /print-color-adjust:exact/)
  assert.match(document, /<strong>‘일’<\/strong>로/)
  assert.match(document, /1~3개/)
  assert.doesNotMatch(document, /material-symbols|fonts.googleapis|<script|>target<|>assignment</i)
})

test('041d: 인쇄는 DOM 복사·닫기 후 글꼴 준비를 기다리고 차단된 팝업을 조용히 종료한다', async () => {
  const calls = []
  let finishFonts
  const fonts = new Promise(resolve => { finishFonts = resolve })
  const win = { document: { querySelectorAll: () => [], fonts: { ready: fonts }, write: markup => calls.push(['write', markup]), close: () => calls.push(['document.close']) }, requestAnimationFrame: callback => callback(), print: () => calls.push(['print']), close: () => calls.push(['window.close']) }
  const module = loadArtifactTsx('../src/components/modals/printReport.ts', { './reportDashboardStyles': { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, reportStageColors }, window: { open: () => win } })
  module.printReport(staticReportDom('<div class="report-dashboard"><svg></svg>현재 화면</div>'), '인쇄')
  assert.equal(calls[0][0], 'write')
  assert.equal(calls[1][0], 'document.close')
  const loading = win.onload()
  assert.equal(calls.length, 2)
  finishFonts()
  await loading
  assert.deepEqual(calls[2], ['print'])
  assert.match(calls[0][1], /<svg><\/svg>현재 화면/)
  win.onafterprint()
  assert.deepEqual(calls[3], ['window.close'])
  const blocked = loadArtifactTsx('../src/components/modals/printReport.ts', { './reportDashboardStyles': { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, reportStageColors }, window: { open: () => null } })
  assert.doesNotThrow(() => blocked.printReport(staticReportDom('현재 화면'), '인쇄'))
})

test('041e: 옅은 단계색·강점/아이디어 아이콘의 글자 대비는 4.5:1 이상이다', () => {
  const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16))
  const luminance = values => values.map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }).reduce((total, value, i) => total + value * [0.2126, 0.7152, 0.0722][i], 0)
  const contrast = (a, b) => { const [dark, light] = [luminance(rgb(a)), luminance(rgb(b))].sort((a, b) => a - b); return (light + 0.05) / (dark + 0.05) }
  for (const tone of Object.values(REPORT_ICON_TONES)) assert.ok(contrast(tone.ink, tone.container) >= 4.5)
  for (const color of Object.values(STAGE_COLOR)) {
    const tones = reportStageColors(color.hex)
    assert.ok(contrast(tones.band, tones.container) >= 4.5, color.hex)
    assert.ok(contrast('#1A1C1E', tones.container) >= 4.5, color.hex)
    assert.ok(contrast('#43474E', tones.container) >= 4.5, color.hex)
  }
})

test('041f: 부록 원문은 항상 펼친 일반 섹션이며 본문 뒤에 원래 표·강조를 보존한다', () => {
  const content = '## 강점\n- 질문을 자기 말로 바꿨습니다.\n\n## 부록: 산출물 원문\n### 평가 설계 (Ds-1)\n\n| 기준 | 증거 |\n| --- | --- |\n| **자기 말 질문** | 3차시 [4사08-02] |'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content }))
  assert.doesNotMatch(html, /<details|<summary|펼치기|접기|report-appendix-toggle/)
  assert.match(html, /<\/section>\s*<section data-report-section="true" data-report-kind="appendix" class="report-section report-appendix"/)
  assert.match(html, /<strong><span>자기 말 질문<\/span><\/strong>/)
  assert.match(html, /<table\b/)
  assert.match(html, /\[4사08-02\]/)
  assert.match(html, /data-report-icon="Database"/)
  assert.doesNotMatch(REPORT_DASHBOARD_CSS, /report-appendix-(?:toggle|collapse|expand|action)/)
  const legacy = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: '## 부록 안내\n\n예전 보고서의 일반 섹션' }))
  assert.doesNotMatch(legacy, /<details/)
  assert.match(legacy, /예전 보고서의 일반 섹션/)
})

test('041g: PDF 부록도 펼쳐진 원문 그대로 새 페이지에서 인쇄하고 원래 화면은 건드리지 않는다', async () => {
  const markup = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: '## 다음 단계 제안\n1. 기록하기\n\n## 부록: 산출물 원문\n\n저장된 원문' }))
  let written
  let printed = false
  const win = { document: { fonts: { ready: Promise.resolve() }, write: html => { written = html }, close() {} }, requestAnimationFrame: callback => callback(), print: () => { printed = true }, close() {} }
  const module = loadArtifactTsx('../src/components/modals/printReport.ts', { './reportDashboardStyles': { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, reportStageColors }, window: { open: () => win } })
  const source = staticReportDom(markup)
  module.printReport(source, '부록 포함 보고서')
  await win.onload()
  assert.equal(printed, true)
  assert.equal(source.innerHTML, markup)
  assert.equal(written.split('<body>')[1].split('</body>')[0], markup)
  assert.match(written, /저장된 원문/)
  assert.doesNotMatch(written, /<details|<summary/)
  assert.match(written, /\.report-section\.report-appendix\{break-before:page;page-break-before:always;break-inside:auto/)
})

// ─── TASK-043: 산출물 원문 정규화 — 라벨 문단·성취기준 줄을 표로, 여러 줄 문단은 목록으로 ─────────
const task043 = await import('../src/lib/report/artifactToMarkdown.ts')
const herdrScenario = [
  '**제목**: 우리 동네 그늘지도와 그늘막 설치 제안',
  '',
  '**행1 (실제성)**: 여름날, 학교 주변을 걸어 보니 친구들뿐 아니라 어린 동생, 유모차를 끄는 보호자, 지팡이를 짚은 어르신들이 햇볕을 피해 쉴 곳을 찾고 있었다. 학교 놀이터의 미끄럼틀도 뜨거워져 점심시간에 이용하기 어려운 날이 있었다.',
  '구청에서는 학교 주변 두 곳에 그늘막을 더 설치하기 전에 어린이 주민의 의견을 받으려고 한다.',
  '',
  '**행2 (학습 내용+산출물)**: 학생들은 어린이 주민이자 학교·마을 환경 조사단이 되어 학교 놀이터와 주변 두 장소를 살펴본다.',
  '',
  '**행3 (청중+행위)**: 학생들은 완성한 학년군별 그늘지도, 위치 제안 자료, 주장 글과 디지털 포스터를 학교 구성원과 구청 담당자에게 전달하고 발표한다.',
  '',
  '**1-2학년군 하위 질문**: 우리 학교 놀이터와 주변에서 어디가 가장 뜨겁고, 그곳을 이용하는 사람에게 어떤 그늘이 필요할까?',
].join('\n')
const herdrAlignment = [
  '**1-2학년군 국어 [2국03-02]**: 놀이터와 학교 주변의 더위 경험과 그늘이 필요한 까닭을 그림과 함께 문장으로 표현하는 과정에서 평가한다.',
  '**1-2학년군 통합교과 [2바02-01]**: 학교와 마을에서 더위로 불편한 사람과 장소를 살펴보고 공동체를 위해 할 수 있는 작은 일을 찾아 실천하는 과정에서 평가한다.',
  '**3-4학년군 과학 [4과16-01]·[4과16-03]**: 기후변화와 인간 활동의 관계를 자료로 살펴보고 생활 속 기후변화 대응 방법을 찾고 공유하는 과정에서 평가한다.',
  '**5-6학년군 미술 [6미02-05]**: 기후 자료와 해결안의 내용을 디지털 매체와 포스터로 융합하여 표현하는 과정에서 평가한다.',
].join('\n')

test('43a: herdr Ds-2 문제상황 — 굵은 라벨 문단이 행 번호 없는 2열 표가 되고, 이어진 줄은 같은 칸에 붙는다', () => {
  const md = task043.normalizeArtifactText(herdrScenario)
  const lines = md.split('\n')
  assert.equal(lines[0], '| 구분 | 내용 |')
  assert.equal(lines[1], '| --- | --- |')
  assert.equal(lines[2], '| 제목 | 우리 동네 그늘지도와 그늘막 설치 제안 |')
  assert.match(lines[3], /^\| 실제성 \| 여름날, .*있었다\. 구청에서는 .*받으려고 한다\. \|$/)
  assert.match(lines[4], /^\| 학습 내용\+산출물 \| 학생들은 어린이 주민이자/)
  assert.match(lines[5], /^\| 청중\+행위 \| /)
  assert.match(lines[6], /^\| 1-2학년군 하위 질문 \| 우리 학교 놀이터/)
  assert.equal(lines.length, 7)
  assert.doesNotMatch(md, /행\d|\*\*/)
  assert.equal(task043.cleanRowLabel('행2 (학습 내용+산출물)'), '학습 내용+산출물')
  assert.equal(task043.cleanRowLabel('데이터 출처'), '데이터 출처')
})

test('43b: herdr 성취기준 연결 — 4열 표(학년군·교과·성취기준·평가 내용), 코드 먼저 꼴도 읽는다', () => {
  const md = task043.normalizeArtifactText(herdrAlignment)
  const lines = md.split('\n')
  assert.equal(lines[0], '| 학년군 | 교과 | 성취기준 | 평가 내용 |')
  assert.equal(lines[2], '| 1-2학년군 | 국어 | [2국03-02] | 놀이터와 학교 주변의 더위 경험과 그늘이 필요한 까닭을 그림과 함께 문장으로 표현하는 과정에서 평가한다. |')
  assert.match(lines[3], /^\| 1-2학년군 \| 통합교과 \| \[2바02-01\] \| /)
  assert.match(lines[4], /^\| 3-4학년군 \| 과학 \| \[4과16-01\]·\[4과16-03\] \| /)
  assert.equal(lines.length, 6)
  const codeFirst = task043.parseStandardsAlignmentLines('[2국03-02] (국어/중심): 문장으로 표현\n[4사08-02] (사회/연계): 위치 제안')
  assert.deepEqual(codeFirst, [
    { gradeBand: '1-2학년군', subject: '국어', standards: '[2국03-02]', content: '문장으로 표현' },
    { gradeBand: '3-4학년군', subject: '사회', standards: '[4사08-02]', content: '위치 제안' },
  ])
  assert.equal(task043.parseStandardsAlignmentLines('한 줄뿐인 설명'), null)
  assert.equal(task043.parseStandardsAlignmentLines(herdrAlignment.split('\n')[0]), null) // 한 줄은 표로 만들지 않음
})

test('43c: 표는 그대로, 여러 줄 문단은 줄마다 목록, 한 줄 문단·기존 목록은 그대로', () => {
  const table = '| a | b |\n| --- | --- |\n| 1 | 2 |'
  assert.equal(task043.normalizeArtifactText(table), table)
  assert.equal(task043.normalizeArtifactText('첫째 줄\n둘째 줄'), '- 첫째 줄\n- 둘째 줄')
  assert.equal(task043.normalizeArtifactText('한 줄 문단'), '한 줄 문단')
  assert.equal(task043.normalizeArtifactText('1. 하나\n2. 둘'), '1. 하나\n2. 둘')
  assert.equal(task043.normalizeArtifactText('**핵심 질문**: 왜 더울까?'), '**핵심 질문**: 왜 더울까?') // 라벨 1개는 표로 만들지 않음
  assert.equal(task043.normalizeArtifactText('**a|b**: 값|값\n**c**: d'), '| 구분 | 내용 |\n| --- | --- |\n| a\\|b | 값\\|값 |\n| c | d |')
})

test('43d: 보고서 부록 원문과 Ds-2 산출물 패널이 같은 정규화를 쓴다', () => {
  const originals = task039prompt.buildArtifactOriginals('Ds', { 'Ds-1-2': { content: { _schema: 'Ds-1-2', '문제상황': herdrScenario, '성취기준 연결': herdrAlignment } } })
  const ds2 = originals['Ds-1-2']
  assert.match(ds2, /\*\*문제상황\*\*\n\n\| 구분 \| 내용 \|\n\| --- \| --- \|\n\| 제목 \|/)
  assert.match(ds2, /\*\*성취기준 연결\*\*\n\n\| 학년군 \| 교과 \| 성취기준 \| 평가 내용 \|/)
  assert.doesNotMatch(ds2, /행1 \(실제성\)/)
  const renderer = fs.readFileSync(new URL('../src/components/artifacts/structured/Ds12Renderer.tsx', import.meta.url), 'utf8')
  assert.match(renderer, /\{normalizeArtifactText\(sel\.alignmentText\)\}/)
})

// ─── TASK-044: 보고서 관점 — 평가자가 아니라 설계 동료(요약·칭찬·제안형) ─────────
test('44a: 섹션 키·아이콘은 유지하고 제목만 긍정형으로, 예전 제목도 같은 섹션으로 인식한다', () => {
  const byKey = Object.fromEntries(task039sections.REPORT_SECTIONS.map(s => [s.key, s]))
  assert.equal(byKey.strengths.title, '잘 설계된 점')
  assert.equal(byKey.strengths.icon, 'ThumbsUp')
  assert.equal(byKey.improvements.title, '함께 다듬어 볼 아이디어')
  assert.equal(byKey.improvements.icon, 'Wrench')
  for (const [old, key] of [['강점', 'strengths'], ['보완점', 'improvements'], ['성취기준·평가 정렬', 'alignment'], ['팀 협력 구조 점검', 'alignment'], ['설계·실행 정렬', 'alignment']]) {
    assert.equal(task039sections.findReportSection(old)?.key, key, old)
  }
  assert.equal(task039sections.findReportSection('함께 다듬어 볼 아이디어')?.icon, 'Wrench')
})

test('44b: 프롬프트는 동료 페르소나·제안형 어조·금지 예와 바꾼 예를 쓰고, 점수·판정 표가 없다', () => {
  const prompt = task039prompt.buildAnalysisPrompt('Ds', { title: 'herdr', targetGradeGroup: '초1-6' }, { 'Ds-1-1': { content: { '평가 계획': 'x' } } })
  assert.match(prompt, /수업설계 동료입니다/)
  assert.match(prompt, /평가하거나 채점하는 사람이 아니라/)
  assert.match(prompt, /❌ 쓰지 말 것: "문제상황의 실제성은 강력하지만 학년군별 평가 근거를 확보해야 한다\."/)
  assert.match(prompt, /✅ 이렇게: "학년군마다 실제 동네 장면이 살아 있어요\./)
  assert.match(prompt, /'~하면 더 좋아질 수 있어요'/)
  const output = prompt.split('보고서만 출력하세요.')[1]
  assert.doesNotMatch(output, /점수|5점|충분 \/ 보완 필요 \/ 부족|종합|진단|격려가 아닌 판단/)
  const section = title => output.split(`\n## ${title}\n`).pop().split('\n## ')[0]
  assert.match(section('성취기준·평가 연결'), /^\n\| 연결이 잘 된 곳 \|[\s\S]*\n다음에 연결해 볼 곳:\n- /)
  assert.match(section('함께 다듬어 볼 아이디어'), /이유: \(한 구절\)/)
  assert.match(section('다음 단계 제안'), /^\n> \(다음 단계를 시작하는 팀을 응원하는 한 줄\)\n\n1\. \(바로 해 볼 일/)
  assert.match(section('잘 설계된 점'), /구체적 근거와 함께 칭찬/)
})

test('041h: 모든 섹션은 작은 tonal 아이콘·얇은 구분선만 쓰고 PDF도 같은 단일 열 스타일이다', () => {
  const content = REPORT_SECTIONS.map(section => `## ${section.title}\n\n### 활동 메모\n\n- 관찰 근거`).join('\n\n')
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'DI' }))
  const colors = reportStageColors(STAGE_COLOR.DI.hex)
  assert.ok(html.includes(`--report-stage-band:${colors.band};--report-stage-container:${colors.container}`))
  for (const section of REPORT_SECTIONS) assert.ok(html.includes(`data-report-kind="${section.key}"`))
  assert.match(REPORT_DASHBOARD_CSS, /\.report-section-icon\{[^}]*border-radius:50%;background:var\(--report-stage-container/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-section h2\{[^}]*border-bottom:1px[^}]*color:#1A1C1E/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-dashboard th\{[^}]*background:var\(--report-stage-container/)
  assert.doesNotMatch(REPORT_DASHBOARD_CSS, /linear-gradient|grid-template-columns|box-shadow/)
  assert.doesNotMatch(html, /report-chip|report-kpi/)
  const hero = renderToStaticMarkup(React.createElement(ReportHero, { stage: 'DI', project: null }))
  assert.ok(hero.includes(`background-color:${colors.container};color:${colors.band}`))
  assert.match(hero, /class="report-metrics"/)
  const pdf = buildReportPrintDocument(html, '단일 열 보고서')
  assert.ok(pdf.includes(REPORT_DASHBOARD_CSS))
  assert.match(pdf, /print-color-adjust:exact/)
})

test('041i: Ds-3 8열 표는 짧은 열의 실제 길이로 최소 폭을 정하고 PDF에서 머리글:값 카드가 된다', () => {
  const longText = '동네의 그늘이 있는 장소와 없는 장소를 비교하고 주민이 이용하는 시간과 이유를 기록한다.'
  const content = `## 활동별 산출물 및 분석\n\n| 순서 | 흐름 단계 | 차시 | 핵심/부가 | 담당 교과 | 활동명 | 학생 수행 | 기록 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 지역 조사 | 3차시 | 핵심 | 국어·통합교과 | 그늘 비교 | ${longText} | 관찰 지도 |\n| 2 | 자료 정리 | 4차시 | 부가 | 사회 | 인터뷰 | 질문 카드로 주민에게 묻고 이유를 자기 말로 설명한다. | https://example.com/verylongunbrokenresourceidentifierabcdefghijklmnopqrst |`
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'Ds' }))
  assert.match(html, /class="report-table-scroll report-table-wide"/)
  assert.match(html, /<table data-columns="8" style="min-width:\d+ch"/)
  assert.match(html, /<th scope="col" style="min-width:13ch">흐름 단계<\/th>/)
  assert.match(html, /<td data-short-cell="true" data-label="흐름 단계" style="min-width:13ch">/)
  const subjectWidth = html.match(/<td data-short-cell="true" data-label="담당 교과" style="min-width:(\d+)ch">/)
  assert.ok(subjectWidth)
  assert.ok(Number(subjectWidth[1]) >= 18)
  assert.match(html, /<td data-long-cell="true" data-label="학생 수행" style="min-width:24ch">/)
  assert.match(html, /class="report-long-english"/)
  assert.ok(html.includes(longText))
  assert.ok(html.includes('국어·통합교과'))
  assert.match(REPORT_DASHBOARD_CSS, /td\{word-break:keep-all;overflow-wrap:normal\}/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-long-english\{word-break:normal;overflow-wrap:anywhere\}/)
  assert.match(REPORT_DASHBOARD_CSS, /th\{[^}]*white-space:nowrap/)
  assert.match(REPORT_DASHBOARD_CSS, /td\[data-short-cell="true"\]\{white-space:nowrap\}/)
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide\{border:0;background:transparent\}/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-table-wide thead\{display:none\}/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-table-wide tbody tr\{display:block;/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-table-wide td:before\{content:attr\(data-label\);display:inline-block;white-space:nowrap/)
  assert.doesNotMatch(REPORT_DASHBOARD_CSS, /table-layout:fixed|white-space:normal!important/)
  const pdf = buildReportPrintDocument(html, '8열 활동 표')
  for (const label of ['순서', '흐름 단계', '담당 교과', '학생 수행']) assert.ok(pdf.includes(`data-label="${label}"`))
})

test('041j: 부록 원문의 2열·4열 표도 열 폭·성취기준 칩·단어 유지·같은 색 머리글을 사용한다', () => {
  const content = '## 부록: 산출물 원문\n\n### 문제 상황 설정 (Ds-2)\n\n| 구분 | 내용 |\n| --- | --- |\n| 실제성 | 주민이 이용하는 그늘의 위치를 사진과 지도로 확인하고 모두에게 필요한 장소를 제안한다. |\n\n| 학년군 | 교과 | 성취기준 | 평가 내용 |\n| --- | --- | --- | --- |\n| 3-4학년군 | 사회 | [4사08-02] 지역 문제 해결에 참여한다. | 주민 의견을 근거로 그늘막 위치를 제안한다. |'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'Ds' }))
  assert.equal((html.match(/<table\b/g) ?? []).length, 2)
  assert.match(html, /<table data-columns="2" style="min-width:\d+ch"/)
  assert.match(html, /<table data-columns="4" style="min-width:\d+ch"/)
  assert.match(html, /<td data-short-cell="true" data-label="구분" style="min-width:\d+ch">/)
  assert.match(html, /<td data-short-cell="true" data-label="교과" style="min-width:\d+ch">/)
  assert.match(html, /<span class="report-standard">\[4사08-02\]<\/span>/)
  assert.match(html, /<span class="whitespace-nowrap">3-4학년군<\/span>/)
  assert.match(html, /data-report-kind="appendix" class="report-section report-appendix"/)
  assert.doesNotMatch(html, /<details|<summary/)
  const pdf = buildReportPrintDocument(html, '원문 부록')
  assert.ok(pdf.includes('주민 의견을 근거로 그늘막 위치를 제안한다.'))
  assert.ok(pdf.includes('.report-dashboard th{position:sticky;top:0;z-index:1;background:var(--report-stage-container,#E8F0FE);'))
})

// ─── TASK-046: 성취수준 글자(A·B·C) 표기 되돌리기 — 코드만, 예전 데이터 호환 ─────────
test('46a: 저장 관문은 수준 글자가 있든 없든 목록 밖 코드만 지운다', () => {
  const allowed = new Set(['[2국03-02]', '[2바02-01]'])
  const plain = task038.stripDisallowedEvidenceCodes('표현함 (근거: [2국03-02], [2수04-02], [2바02-01])', allowed)
  assert.equal(plain.text, '표현함 (근거: [2국03-02], [2바02-01])')
  assert.deepEqual(plain.removed, ['[2수04-02]'])
  const legacy = task038.stripDisallowedEvidenceCodes('(근거: [2국03-02] B, [2수04-02] A)', allowed)
  assert.equal(legacy.text, '(근거: [2국03-02] B)')
  assert.equal(task038.stripDisallowedEvidenceCodes('(근거: [2수04-02])', allowed).text, '(근거: 확인 필요)')
})

test('46b: Ds-1-3 성취수준 안내·보고서 프롬프트는 수준 글자를 쓰지 않게 하고, 평가 기준 참고 지시는 남는다', async () => {
  const levels = await import('../src/lib/curriculum/achievementLevels.ts')
  const ds13 = levels.buildAchievementLevelContext('Ds-1-3', ['[2국03-02]'])
  assert.match(ds13, /"\(근거: \[코드\]\)"처럼 근거 코드만 적는다\(수준 글자 A·B·C는 붙이지 않는다\)/)
  assert.match(levels.buildAchievementLevelContext('Ds-1-1', ['[2국03-02]']), /루브릭의 상·중·하는 해당 성취기준의 A·B·C 원문에서 출발한다/)
  const report = task039prompt.buildAnalysisPrompt('Ds', { title: 'p', targetGradeGroup: '초1-2' }, {})
  assert.match(report, /코드 뒤에 A·B·C 같은 수준 글자를 붙이지 않는다/)
})

test('46c: 정렬 점검 — 예전 데이터에 수준 글자가 있어도 배지·범례·A 수준 안내를 보이지 않는다(데이터는 그대로)', () => {
  const withLevel = task031.buildAlignment(['[2국03-02]'], { '평가 계획': '| 확인 지점 | 평가 요소 |\n|---|---|\n| 결과물 | 표현함 (근거: [2국03-02] B) |' }, null)
  assert.equal(task031.hasLevelBadges(withLevel), true)
  const card = fs.readFileSync(new URL('../src/components/curriculum/AlignmentMatrixCard.tsx', import.meta.url), 'utf8')
  assert.deepEqual(withLevel.rows[0].evaluations[0].levels, ['B']) // 저장본 해석은 그대로
  assert.doesNotMatch(card, /LevelBadge|noALevel|showsLevels|A 수준을 겨냥한|코드 옆 A·B·C/)
})

// ─── TASK-045: 보고서 단순화 · 전체 폭 · 성취수준 표시 제거 ─────────
test('045a: 섹션·활동은 전체 폭이며 작은 제목·상태만 표시하고 콜아웃에 라벨·중첩 박스가 없다', () => {
  const content = '## 활동별 산출물 및 분석\n### Ds-1 평가 설계\n- 인터뷰 관찰표\n> 질문을 자기 말로 바꾸는지 살펴봐요.\n### Ds-2 문제 상황\n- 그늘 지도\n\n## 잘 설계된 점\n학생의 말이 기록됐어요.\n\n## 함께 다듬어 볼 아이디어\n첫 질문 카드를 준비해요.'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'Ds', project: { artifacts: { 'Ds-1-1': { status: 'confirmed' }, 'Ds-1-2': { status: 'draft' } } } }))
  assert.match(html, /<div class="report-activity-heading"><h3>Ds-1 평가 설계<\/h3><span class="report-status" data-status="confirmed">확정<\/span><\/div>/)
  assert.match(html, /data-status="draft">작성 중/)
  assert.equal((html.match(/<section data-report-section/g) ?? []).length, 3)
  assert.match(html, /class="report-section"/)
  assert.match(html, /data-report-icon="ThumbsUp"/)
  assert.match(html, /data-report-icon="Wrench"/)
  assert.match(html, /<aside role="note" aria-label="인사이트와 권고" class="report-callout">/)
  assert.doesNotMatch(html, /report-card|report-grid|report-chip|report-callout-label|인사이트 · 권고/)
  assert.doesNotMatch(REPORT_DASHBOARD_CSS, /grid-template-columns|display:grid|linear-gradient|box-shadow/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-section\{width:100%;[^}]*margin:28px 0 0/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-activity\{width:100%;min-width:0;margin:/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-callout\{[^}]*border-left:2px/)
  for (const text of ['인터뷰 관찰표', '그늘 지도', '첫 질문 카드를 준비해요.', '학생의 말이 기록됐어요.']) assert.ok(html.includes(text))
  const pdf = buildReportPrintDocument(html, '수업 보고서')
  assert.equal(pdf.split('<body>')[1].split('</body>')[0], html)
})

test('045b: 옅은 히어로에는 제목·한 줄 요약·날짜가 있고 KPI는 작은 지표 줄이다', () => {
  const content = '## 이 단계 핵심 요약\n동네의 목소리로 함께 수업을 설계했어요.\n키워드: 그늘 · 주민 · 인터뷰'
  const html = renderToStaticMarkup(React.createElement(ReportHero, { content, stage: 'A', project: { title: '동네 폭염', artifacts: { 'A-2-1': { status: 'confirmed', version: 2 } } }, generatedAt: 1700000000000 }))
  const colors = reportStageColors(STAGE_COLOR.A.hex)
  assert.ok(html.includes(`background-color:${colors.container};color:${colors.band}`))
  assert.match(html, /동네의 목소리로 함께 수업을 설계했어요./)
  assert.match(html, /생성일 ·/)
  assert.match(html, /class="report-metrics"/)
  assert.equal((html.match(/class="report-metric"/g) ?? []).length, 4)
  assert.match(html, /<dt>산출물<\/dt><dd>[\s\S]*?1<small>개/)
  assert.doesNotMatch(html, /linear-gradient|report-kpi|report-keywords|report-chip/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-metrics\{display:flex;flex-wrap:wrap;/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-metric dd\{[^}]*font-size:13px/)
})

test('045c: 성취기준 바로 뒤 A/B/C만 지우고 강조·설명·일반 A안·다른 텍스트는 보존한다', () => {
  const cases = [
    ['[2국03-02] B', '[2국03-02]'],
    ['2국03-02 A: 자기 말로 표현', '2국03-02: 자기 말로 표현'],
    ['**[4사08-02] C**', '**[4사08-02]**'],
    ['**[4사08-02]** **B**', '**[4사08-02]**'],
    ['*[4사08-02] B*', '*[4사08-02]*'],
    ['`[4사08-02] B`', '`[4사08-02]`'],
    ['| [2국03-02] A | [4사08-02] B | [6사02-01] C |', '| [2국03-02] | [4사08-02] | [6사02-01] |'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(cleanReportMarkdown(input), expected)
    assert.equal(cleanReportMarkdown(cleanReportMarkdown(input)), expected)
    const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: input }))
    assert.doesNotMatch(html, /\] [ABC](?:<|\s|$)/)
  }
  const ordinary = '모둠 A, A안과 B안 비교. [2국03-02] ABC 자료, [4사08-02] B안, [6사02-01]\nB 모둠.'
  assert.equal(cleanReportMarkdown(ordinary), ordinary)
})

test('045d: 두 모달의 MD 다운로드도 같은 표시 정리를 하고 HWPX·저장 원문은 그대로 유지한다', async () => {
  const original = '# 보고서\n\n| 학년군 | 기준 |\n| --- | --- |\n| 1-2학년군 | **[2국03-02] B** |'
  for (const name of ['StageAnalysisModal', 'StageReportsModal']) {
    let blob
    let clicked = false
    const project = { title: '동네 폭염' }
    const selectedReport = { content: original }
    const fn = loadArtifactTsx(`../src/components/modals/${name}.tsx`, {
      cleanReportMarkdown, markdown: original, selectedReport, selectedStage: 'Ds', stage: 'Ds', project,
      STAGE_LABELS: { Ds: '설계' }, Blob,
      URL: { createObjectURL: value => { blob = value; return 'blob:report' }, revokeObjectURL() {} },
      document: { createElement: () => ({ click() { clicked = true } }) },
    }, ['downloadMd']).downloadMd
    fn()
    assert.equal(clicked, true)
    assert.equal(await blob.text(), cleanReportMarkdown(original))
    assert.equal(selectedReport.content, original)
    const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: original, stage: 'Ds' }))
    const pdf = buildReportPrintDocument(html, '보고서')
    assert.match(pdf, /class="report-standard">\[2국03-02\]/)
    assert.doesNotMatch(pdf, /\] B|\*\*/)
  }
  const generated = fs.readFileSync(new URL('../src/components/modals/StageAnalysisModal.tsx', import.meta.url), 'utf8')
  const saved = fs.readFileSync(new URL('../src/components/modals/StageReportsModal.tsx', import.meta.url), 'utf8')
  assert.match(generated, /generateHwpx\(markdown,/)
  assert.match(saved, /generateHwpx\(displayContent,/)
})


// ─── TASK-047: PDF 스크롤 해제·전체 표·항상 펼친 부록 ─────────
test('047a: 인쇄 CSS는 스크롤·최대 높이·고정 머리글을 해제하고 표의 페이지 분할을 허용한다', () => {
  const rules = [...REPORT_PRINT_CSS.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), declarations: body.split(';').filter(Boolean).map(value => value.trim().split(/:(.*)/s).slice(0, 2)) }))
  const declarations = rules.flatMap(rule => rule.declarations)
  for (const [property, value] of declarations) {
    if (/^overflow(?:-[xy])?$/.test(property)) assert.equal(value, 'visible!important')
    if (property === 'max-height') assert.equal(value, 'none!important')
    if (property === 'position') assert.equal(value, 'static!important')
  }
  const universal = rules.find(rule => rule.selector === 'html,body,body *')
  assert.ok(universal)
  assert.deepEqual(universal.declarations, [
    ['max-height', 'none!important'], ['overflow', 'visible!important'],
    ['overflow-x', 'visible!important'], ['overflow-y', 'visible!important'],
  ])
  assert.match(REPORT_PRINT_CSS, /height:auto!important;min-height:0!important;contain:none!important/)
  assert.match(REPORT_PRINT_CSS, /\.report-section,\.report-body,\.report-activities,\.report-activity,\.report-table-scroll\{break-inside:auto;page-break-inside:auto\}/)
  assert.match(REPORT_PRINT_CSS, /\.report-dashboard thead\{display:table-header-group\}/)
  assert.match(REPORT_PRINT_CSS, /\.report-dashboard tr\{break-inside:avoid;page-break-inside:avoid\}/)
  assert.match(REPORT_PRINT_CSS, /\.report-dashboard th,\.report-dashboard td\{min-width:0!important/)
  assert.match(REPORT_PRINT_CSS, /\.report-dashboard pre\{white-space:pre-wrap;overflow-wrap:anywhere\}/)
  // 화면 표의 세로/가로 스크롤은 그대로 두고 PDF에서만 해제한다.
  assert.match(REPORT_DASHBOARD_CSS, /max-height:60vh;overflow:auto/)
  assert.ok(REPORT_DASHBOARD_CSS.endsWith(REPORT_PRINT_CSS + '\n'))
})

test('047b: 긴 일반 표와 부록 표의 모든 행은 인쇄 문서에 보존되고 부록 접힘 마크업이 없다', () => {
  const rows = Array.from({ length: 150 }, (_, index) => `| 행${String(index + 1).padStart(3, '0')} | 주민 인터뷰 기록 ${index + 1} |`).join('\n')
  const content = `## 활동별 산출물 및 분석\n### Ds-3 학습활동\n\n| 구분 | 기록 |\n| --- | --- |\n${rows}\n\n## 부록: 산출물 원문\n\n| 구분 | 내용 |\n| --- | --- |\n| 마지막 원문 | 빠짐없이 인쇄되어야 하는 내용 |`
  const markup = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'Ds' }))
  const pdf = buildReportPrintDocument(markup, '전체 기록')
  assert.equal(pdf.split('<body>')[1].split('</body>')[0], markup)
  for (let index = 1; index <= 150; index++) assert.ok(pdf.includes(`행${String(index).padStart(3, '0')}`))
  assert.equal((markup.match(/<tr>/g) ?? []).length, 153)
  assert.match(pdf, /마지막 원문/)
  assert.match(pdf, /빠짐없이 인쇄되어야 하는 내용/)
  assert.doesNotMatch(markup, /<details|<summary|펼치기|접기|class="report-table-scroll report-table-wide"/)
  assert.ok(pdf.includes(REPORT_PRINT_CSS))
})

test('047c: 6열 이상과 폭이 큰 소수 열 표는 A4 카드형으로 표시하며 모든 셀의 머리글·내용을 유지한다', () => {
  const wide = '| 순서 | 흐름 단계 | 차시 | 핵심/부가 | 담당 교과 | 활동명 | 학생 수행 | 기록 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n' + Array.from({ length: 30 }, (_, index) => `| ${index + 1} | 조사 | 3차시 | 핵심 | 사회 | 활동${index + 1} | 주민에게 질문하기 | 증거${index + 1} |`).join('\n')
  const longHeader = '| 첫째 항목의 자세한 내용과 연결된 근거 | 둘째 항목의 자세한 내용과 연결된 근거 | 셋째 항목의 자세한 내용과 연결된 근거 |\n| --- | --- | --- |\n| 첫 기록 | 둘째 기록 | 셋째 기록 |'
  const markup = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: `## 활동\n${wide}\n\n## 부록: 산출물 원문\n${longHeader}` }))
  const pdf = buildReportPrintDocument(markup, '넓은 표')
  assert.equal((markup.match(/class="report-table-scroll report-table-wide"/g) ?? []).length, 2)
  assert.equal((markup.match(/<td /g) ?? []).length, 243)
  for (let index = 1; index <= 30; index++) {
    assert.ok(pdf.includes(`활동${index}`))
    assert.ok(pdf.includes(`증거${index}`))
  }
  for (const label of ['순서', '흐름 단계', '담당 교과', '학생 수행']) assert.ok(pdf.includes(`data-label="${label}"`))
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide table,\.report-table-wide tbody\{display:block;width:100%\}/)
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide tbody tr\{[^}]*break-inside:avoid;page-break-inside:avoid/)
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide td:before\{content:attr\(data-label\)/)
})


// ─── TASK-047b: 미리보기 창도 스크롤 없이 · 인쇄 DOM 정리 ─────────
test('047d: 인쇄 창 전용 CSS는 media 밖에서 높이·스크롤·sticky를 풀고 넓은 표를 카드로 배치한다', () => {
  assert.doesNotMatch(REPORT_PRINT_WINDOW_CSS, /@media/)
  assert.match(REPORT_PRINT_WINDOW_CSS, /html,body,body \*\{max-height:none!important;overflow:visible!important/)
  assert.match(REPORT_PRINT_WINDOW_CSS, /html,body,body \*\{position:static!important\}/)
  assert.match(REPORT_PRINT_WINDOW_CSS, /\.report-table-scroll\{height:auto!important;max-height:none!important;overflow:visible!important\}/)
  assert.match(REPORT_PRINT_WINDOW_CSS, /\.report-dashboard th[^}]*position:static!important/)
  assert.match(REPORT_PRINT_WINDOW_CSS, /\.report-table-wide table,\.report-table-wide tbody\{display:block;width:100%\}/)
  const html = buildReportPrintDocument('<div class="report-table-scroll">모든 행</div>', '인쇄')
  assert.ok(html.includes(REPORT_PRINT_WINDOW_CSS))
  assert.ok(html.indexOf(REPORT_PRINT_WINDOW_CSS) > html.indexOf(REPORT_DASHBOARD_CSS))
})

test('047e: DOM 정리는 중첩 details·토글을 제거하고 제목·접힌 원문·표·SVG를 보존하며 원래 DOM은 유지한다', () => {
  const source = reportDom('div', {},
    reportDom('section', { class: 'report-appendix', 'data-report-kind': 'appendix' },
      reportDom('details', {},
        reportDom('summary', { 'aria-expanded': 'false' }, reportDom('h2', {}, '부록: 산출물 원문'), reportDom('span', { class: 'report-appendix-action' }, '펼치기/접기')),
        reportDom('button', { 'aria-expanded': 'false' }, '원문 펼치기'),
        reportDom('span', { role: 'button', 'aria-label': '접기' }, '접기'),
        reportDom('div', { class: 'report-body hidden md:hidden collapsed is-collapsed', hidden: '', 'aria-hidden': 'true', style: 'display:none!important;visibility:hidden;opacity:0;height:0px;max-height:0px;overflow:hidden' },
          reportDom('div', { 'aria-expanded': 'false' }, reportDom('p', {}, '반드시 보존할 원문')),
          reportDom('details', {}, reportDom('summary', {}, '추가 자료 ', reportDom('span', {}, '접기')), reportDom('p', { class: 'collapsed', style: 'display:none' }, '중첩된 기록')),
          reportDom('div', { class: 'report-table-scroll', style: 'max-height:60vh!important;overflow:auto;height:200px' },
            reportDom('table', {}, reportDom('thead', {}, reportDom('tr', {}, reportDom('th', { style: 'position:sticky;top:0' }, '성취기준'))), reportDom('tbody', {}, reportDom('tr', {}, reportDom('td', {}, '[4사08-02]'))))),
          reportDom('svg', { viewBox: '0 0 24 24' }, reportDom('path', { d: 'M 0 0 L 1 1' }))))),
    reportDom('p', { hidden: '', class: 'hidden' }, '부록 밖 숨김 상태는 유지'))
  const original = source.html
  const clean = cloneReportForPrint(source)
  assert.notEqual(clean, source)
  assert.equal(source.html, original)
  assert.doesNotMatch(clean.innerHTML, /<details|<summary|<button|aria-expanded|펼치기|접기/)
  assert.match(clean.innerHTML, /<h2[^>]*>부록: 산출물 원문<\/h2>/)
  for (const value of ['반드시 보존할 원문', '중첩된 기록', '[4사08-02]', '<svg', '<path']) assert.ok(clean.innerHTML.includes(value))
  const appendix = clean.querySelectorAll('.report-appendix')[0]
  assert.doesNotMatch(appendix.html, /class="[^"]*(?:hidden|collapsed)|aria-hidden| hidden=/)
  for (const element of [clean, ...clean.querySelectorAll('*')]) {
    for (const property of ['overflow', 'overflow-x', 'overflow-y', 'max-height']) assert.equal(element.style.getPropertyValue(property), '')
  }
  assert.match(clean.innerHTML, /<p hidden="" class="hidden"[^>]*>부록 밖 숨김 상태는 유지/)
})

test('047f: 인쇄 호출은 정리된 복제본을 쓰고 생성·저장 모달은 화면에서도 부록을 항상 펼친다', async () => {
  const source = reportDom('div', {}, reportDom('section', { class: 'report-appendix' }, reportDom('details', {}, reportDom('summary', {}, '부록 ', reportDom('button', {}, '펼치기')), reportDom('p', { class: 'hidden', hidden: '' }, '저장된 원문'))))
  const original = source.html
  let written, printed = false
  const win = { document: { fonts: { ready: Promise.resolve() }, write: html => { written = html }, close() {} }, requestAnimationFrame: callback => callback(), print: () => { printed = true }, close() {} }
  const module = loadArtifactTsx('../src/components/modals/printReport.ts', { './reportDashboardStyles': { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, reportStageColors }, window: { open: () => win } })
  module.printReport(source, '설계 분석 보고서')
  await win.onload()
  assert.equal(printed, true)
  assert.equal(source.html, original)
  assert.doesNotMatch(written, /<details|<summary|<button|펼치기|class="hidden"/)
  assert.match(written, /저장된 원문/)
  const markdown = '## 강점\n기존 본문\n\n## 부록: 산출물 원문\n### 평가 설계 (Ds-1)\n\n| 구분 | 내용 |\n| --- | --- |\n| 평가 내용 | 두 경로에서 보존할 원문 |'
  for (const [name, selected] of [['StageAnalysisModal', false], ['StageReportsModal', true]]) {
    const { html } = reportModalFixture(name, selected, false, markdown)
    assert.match(html, /data-report-kind="appendix" class="report-section report-appendix"/)
    assert.doesNotMatch(html, /<details|<summary|펼치기|접기/)
    assert.match(html, /두 경로에서 보존할 원문/)
  }
})


// ─── TASK-048: 파일 다운로드·행 경계 페이지 분할·버튼 상태 ─────────
const pdfTestPage = { widthMm: 100, heightMm: 100, marginMm: 0, captureWidthPx: 100, gapPx: 0 }

test('048a: PDF 파일명은 프로젝트·단계·보고서를 포함하며 경로 문자와 빈 이름을 정리한다', () => {
  assert.equal(reportPdfFilename('herdr', '설계'), 'herdr 설계 보고서.pdf')
  assert.equal(reportPdfFilename('동네/그늘: 조사', '개발·실행'), '동네 그늘 조사 개발·실행 보고서.pdf')
  assert.equal(reportPdfFilename('  ', ''), '프로젝트 단계 보고서.pdf')
  assert.equal(reportPdfFilename('팀\n이름', '분석'), '팀 이름 분석 보고서.pdf')
  assert.deepEqual(REPORT_PDF_PAGE, { widthMm: 210, heightMm: 297, marginMm: 12, captureWidthPx: 794, gapPx: 16 })
})

test('048b: 한 페이지에 들어가는 섹션은 나누지 않고 넘치면 다음 페이지·부록은 새 페이지로 보낸다', () => {
  const blocks = [{ height: 40 }, { height: 70 }, { height: 20 }, { height: 10, startNewPage: true }]
  const original = structuredClone(blocks)
  const slices = layoutReportPdf(blocks, pdfTestPage)
  assert.deepEqual(slices.map(slice => [slice.block, slice.page, slice.top, slice.height]), [[0,1,0,40], [1,2,0,70], [2,2,70,20], [3,3,0,10]])
  assert.deepEqual(blocks, original)
  assert.deepEqual(layoutReportPdf([{ height: 100 }, { height: 100 }], pdfTestPage).map(slice => slice.page), [1, 2])
  assert.deepEqual(layoutReportPdf([], pdfTestPage), [])
})

test('048c: 큰 섹션은 행 경계로만 나누고 반복 머리글 높이를 포함하며 큰 단일 행은 축소해 보존한다', () => {
  const slices = layoutReportPdf([{ height: 250, breakpoints: [30,80,130,180,230], headers: [{ start: 0, end: 30, tableEnd: 250 }] }], pdfTestPage)
  assert.deepEqual(slices.map(slice => [slice.start, slice.height, slice.header]), [[0,80,undefined], [80,50,0], [130,50,0], [180,70,0]])
  assert.ok(slices.every(slice => slice.scale === 1))
  const large = layoutReportPdf([{ height: 180, breakpoints: [180] }], pdfTestPage)
  assert.equal(large.length, 1)
  assert.equal(large[0].height, 180)
  assert.equal(large[0].scale, 100 / 180)
  const defaultSlices = layoutReportPdf([{ height: 3400, breakpoints: [400,800,1200,1600,2000,2400,2800,3200] }])
  const capacity = (297 - 24) * 794 / (210 - 24)
  assert.ok(defaultSlices.every(slice => slice.top + slice.height * slice.scale <= capacity + .001))
  assert.equal(defaultSlices.reduce((total, slice) => total + slice.height, 0), 3400)
  assert.throws(() => layoutReportPdf([{ height: NaN }]), /높이/)
  assert.throws(() => layoutReportPdf([], { marginMm: 200 }), /페이지/)
})

test('048d: 두 모달은 PDF 다운로드 주 버튼·인쇄·진행 상태를 제공하고 MD/HWPX를 유지한다', () => {
  for (const [name, selected] of [['StageAnalysisModal', false], ['StageReportsModal', true]]) {
    const { html, callbacks } = reportModalFixture(name, selected, false)
    assert.match(html, /PDF 다운로드/)
    assert.match(html, /인쇄/)
    assert.ok(callbacks.some(button => button.variant === 'filled' && button.children === 'PDF 다운로드'))
    assert.ok(callbacks.some(button => button.variant === 'tonal' && button.children === '인쇄'))
    assert.ok(callbacks.some(button => button.children === 'HWPX 베타'))
    const busy = reportModalFixture(name, selected, false, undefined, true)
    assert.match(busy.html, /만드는 중…/)
    assert.ok(busy.callbacks.some(button => button.children === '만드는 중…' && button.disabled && button['aria-busy']))
    assert.ok(busy.callbacks.some(button => button.children === '인쇄' && button.disabled))
  }
})

test('048e: 다운로드 실패는 오류를 알리고 인쇄로 대체하며 진행 상태를 해제한다', async () => {
  for (const name of ['StageAnalysisModal', 'StageReportsModal']) {
    const source = fs.readFileSync(new URL(`../src/components/modals/${name}.tsx`, import.meta.url), 'utf8')
    const sourceTree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const states = [], errors = []
    let printed = 0
    const download = loadChatFunction('downloadPdf', {
      contentRef: { current: {} }, pdfBusy: false, project: { title: 'herdr' }, stage: 'Ds', selectedStage: 'Ds', STAGE_LABELS: { Ds: '설계' },
      setPdfBusy: state => states.push(state), setPdfError: state => errors.push(state),
      downloadReportPdf: async () => { throw new Error('캡처 실패') }, handlePrint: () => { printed++ }, console: { error() {} },
    }, sourceTree)
    await download()
    assert.deepEqual(states, [true, false])
    assert.equal(errors[0], '')
    assert.match(errors[1], /실패.*인쇄/)
    assert.equal(printed, 1)
  }
})

test('048f: 라이브러리는 호출 때만 로드하고 페이지별 캡처·저장 후 임시 문서를 제거한다', async () => {
  const calls = []
  let captureError = false
  const body = reportDom('body', {},
    reportDom('div', { class: 'report-hero', 'data-height': '80' }, '요약'),
    reportDom('section', { class: 'report-section', 'data-top': '96', 'data-height': '1800' },
      reportDom('table', { 'data-top': '130', 'data-height': '1666' },
        reportDom('thead', { 'data-top': '130', 'data-height': '30' }, reportDom('tr', { 'data-top': '130', 'data-height': '30' }, reportDom('th', {}, '열'))),
        reportDom('tbody', {}, ...Array.from({ length: 8 }, (_, index) => reportDom('tr', { 'data-top': String(160 + index * 200), 'data-height': '200' }, reportDom('td', {}, `행${index + 1}`)))))))
  const doc = { body, fonts: { ready: Promise.resolve() }, defaultView: { HTMLElement: ReportDomElement } }
  body.document = doc
  const frame = { style: {}, contentDocument: doc, setAttribute() {}, remove: () => calls.push(['remove']) }
  class Pdf {
    constructor(options) { calls.push(['pdf', options]) }
    addPage() { calls.push(['page']) }
    addImage(canvas, format, x, y, width, height) { calls.push(['image', format, x, y, width, height]) }
    async save(filename) { calls.push(['save', filename]) }
  }
  const module = loadArtifactTsx('../src/components/modals/downloadReportPdf.ts', {
    './printReport': { buildReportPrintDocument, cloneReportForPrint },
    './reportPdfLayout': { layoutReportPdf, reportPdfFilename, REPORT_PDF_PAGE },
    'html2canvas-pro': { __esModule: true, default: async (element, options) => { if (captureError) throw new Error('캡처 실패'); calls.push(['capture', element.tagName, options]); return { width: 1588, height: options.height * 2 } } },
    jspdf: { jsPDF: Pdf }, setTimeout, clearTimeout,
    document: { createElement: () => frame, body: { appendChild: () => frame.onload() } },
  })
  assert.deepEqual(calls, [])
  await module.downloadReportPdf(staticReportDom('원문'), 'herdr', '설계')
  assert.deepEqual(calls.at(-2), ['save', 'herdr 설계 보고서.pdf'])
  assert.deepEqual(calls.at(-1), ['remove'])
  assert.ok(calls.some(call => call[0] === 'page'))
  assert.ok(calls.some(call => call[0] === 'capture' && call[1] === 'THEAD'))
  for (const call of calls.filter(call => call[0] === 'capture')) assert.equal(call[2].scale, 2)
  for (const call of calls.filter(call => call[0] === 'image')) assert.ok(call[3] + call[5] <= 285 + .001)
  assert.match(frame.srcdoc, /html,body,body \*\{position:static!important\}/)
  const source = fs.readFileSync(new URL('../src/components/modals/downloadReportPdf.ts', import.meta.url), 'utf8')
  assert.match(source, /import\('html2canvas-pro'\)/)
  assert.match(source, /import\('jspdf'\)/)
  assert.doesNotMatch(source, /import (?!type)[^\n]* from ['"](?:jspdf|html2canvas-pro)['"]/)
  captureError = true
  await assert.rejects(module.downloadReportPdf(staticReportDom('원문'), 'herdr', '설계'), /캡처 실패/)
  assert.deepEqual(calls.at(-1), ['remove'])
})

// ─── TASK-T1: 연수용 모드 1단계 — 판단·분류·AI 동작(코드로 보장) ─────────
const training = await import('../src/lib/training/trainingMode.ts')
const trainingPrompt = await import('../src/lib/prompts/training.ts')
const { STAGES: T_STAGES, ACTIVITY_META: T_META } = await import('../src/types/index.ts')
const T_ALL = T_STAGES.flatMap(s => s.activities)
const tProject = (trainingMode, mode = 'collaborative') => ({ title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: ['국어'], mode, isA23Completed: false, currentCycle: 1, ...(trainingMode ? { trainingMode } : {}) })

test('T1: 19개 활동 모두 정의, 섹션 키는 산출물 키와 같고 A/B/C·B 이유·도움 버튼이 있다', () => {
  assert.equal(Object.keys(training.TRAINING_ACTIVITIES).length, T_ALL.length)
  for (const code of T_ALL) {
    const def = training.TRAINING_ACTIVITIES[code]
    const keys = [...(T_META[code].recommendedSections ?? []), ...(T_META[code].requiredSections ?? [])].map(s => s.key)
    assert.ok(def.fields.length > 0, code)
    for (const field of def.fields) {
      assert.ok(keys.includes(field.key), `${code}:${field.key}`)
      assert.ok(['A', 'B', 'C'].includes(field.tier))
      assert.ok(field.label && !/[a-z]{3,}/.test(field.label.replace('Human-AI', '')), `${code} 라벨 한글`)
      if (field.tier === 'B') assert.ok(field.reason, `${code}:${field.key} 이유`)
    }
    assert.ok(def.help.length > 0 && def.help.every(h => h.label && h.prompt), code)
  }
  assert.deepEqual(training.TRAINING_CORE_ACTIVITIES, ['T-1-1', 'T-1-2', 'A-1-2', 'A-2-1', 'A-2-2'])
  for (const [code, deps] of Object.entries(training.TRAINING_DEPENDENCIES)) {
    for (const dep of deps) assert.ok(T_ALL.indexOf(dep.from) < T_ALL.indexOf(code), `${code} ← ${dep.from}`)
  }
})

test('T2: isTrainingActivity — 꺼짐·없음은 일반, coreFormal 기본 true면 핵심 5개 제외, false면 전부 약식(solo 포함)', () => {
  assert.equal(training.isTrainingActivity(tProject(), 'Ds-1-1'), false)
  assert.equal(training.isTrainingActivity(tProject({ enabled: false, coreFormal: true }), 'Ds-1-1'), false)
  assert.equal(training.isTrainingActivity(null, 'Ds-1-1'), false)
  const on = tProject({ enabled: true, coreFormal: true })
  assert.equal(training.isTrainingActivity(on, 'T-1-1'), false)
  assert.equal(training.isTrainingActivity(on, 'A-2-2'), false)
  assert.equal(training.isTrainingActivity(on, 'T-2-1'), true)
  assert.equal(training.isTrainingActivity({ trainingMode: { enabled: true } }, 'A-2-1'), false) // coreFormal 생략 = true
  const all = tProject({ enabled: true, coreFormal: false }, 'solo')
  assert.ok(T_ALL.every(code => training.isTrainingActivity(all, code)))
})

test('T3: trainingStatus — 비어 있는 A 칸만 missingRequired, 공백·빈 배열은 빈 칸', () => {
  const empty = training.trainingStatus('E-1-1', {})
  assert.deepEqual(empty.missingRequired.map(f => f.key), ['해석', '수정안'])
  assert.equal(empty.requiredTotal, 2)
  const partial = training.trainingStatus('Ds-1-2', { 문제상황: '그늘막 제안', '핵심 질문': '  ' })
  assert.deepEqual(partial.missingRequired, [])
  assert.deepEqual(partial.filled.map(f => f.key), ['문제상황'])
  assert.deepEqual(training.trainingStatus('T-2-1', { '역할 배분': [] }).missingRequired.map(f => f.key), ['역할 배분'])
  assert.deepEqual(training.trainingStatus('X-9-9', {}), { missingRequired: [], filled: [], requiredTotal: 0 })
})

test('T4: detectInterventionPreference — 개입 금지/해제 표현, 시간순·문장 안 마지막 표현 우선', () => {
  const d = training.detectInterventionPreference
  assert.equal(d([]), 'normal')
  for (const text of ['개입하지 마세요', '조언은 필요 없어요', '조언 필요 없어', '저장만 해 주세요', '그대로 저장해', '도와주지 마세요']) assert.equal(d([text]), 'quiet', text)
  for (const text of ['조언해 주세요', '도와주세요', '도와줘', '단계별로 같이 해요']) assert.equal(d([text]), 'normal', text)
  assert.equal(d(['개입하지 마세요', '이제 도와주세요']), 'normal')
  assert.equal(d(['도와주세요', '이번엔 저장만']), 'quiet')
  assert.equal(d(['아까는 조언해 달랬는데 이제 조언은 필요 없어요']), 'quiet')
  assert.equal(d(['저장만 하려다가 조언해 주세요']), 'normal')
  assert.equal(d(['개입하지 마세요', '표 내용 확인했어요']), 'quiet') // 관계없는 말은 유지
})

test('T5: 메시지 형식 — 양식 저장 알림·AI 도움·단계별 진행, 개입 금지 저장은 AI 없이 고정 응답', () => {
  const notice = training.formatTrainingSaveNotice('T-2-1')
  assert.equal(notice, '[연수 양식 저장: T-3 역할 배분]')
  assert.deepEqual(training.parseTrainingSaveNotice(`${notice} 조언은 필요 없어요`), { displayCode: 'T-3', label: '역할 배분' })
  assert.equal(training.parseTrainingSaveNotice('그냥 대화'), null)
  const help = training.formatTrainingHelpRequest(training.TRAINING_ACTIVITIES['Ds-1-1'].help[0])
  assert.match(help, /^\[AI 도움: 평가 표로 정리\] /)
  assert.deepEqual(training.parseTrainingHelpRequest(help)?.label, '평가 표로 정리')
  assert.equal(training.isStepByStepActive(['[단계별로 함께 진행]']), true)
  assert.equal(training.isStepByStepActive(['[단계별로 함께 진행]', '이제 직접 적을게요']), false)
  assert.equal(training.isStepByStepActive(['안녕하세요']), false)
  const on = tProject({ enabled: true, coreFormal: true })
  const q = training.shouldReplyTrainingQuietly
  assert.equal(q(on, 'T-2-1', `${notice} 조언은 필요 없어요`, []), true)
  assert.equal(q(on, 'T-2-1', notice, ['개입하지 마세요']), true)
  // TASK-T4: 교사가 개입 금지를 말했으면 알림의 체크 문구(' 조언해 주세요')와 무관하게 고정 응답
  assert.equal(q(on, 'T-2-1', `${notice} 조언해 주세요`, ['개입하지 마세요']), true)
  assert.equal(q(on, 'T-2-1', notice, []), false)
  assert.equal(q(on, 'T-2-1', '개입하지 마세요', []), false) // 저장 알림이 아니면 대상 아님
  assert.equal(q(on, 'T-1-1', `${notice} 조언은 필요 없어요`, []), false) // 핵심 절차는 일반 진행
  assert.equal(q(tProject(), 'T-2-1', `${notice} 조언은 필요 없어요`, []), false)
  assert.equal(training.TRAINING_QUIET_REPLY, '저장했습니다.')
})

test('T6: 연수용 활동 프롬프트 — 규칙·한글 칸 목록·의존 질문·도움 버튼, 영어 키·분류 기호 노출 금지 규칙', () => {
  const p = trainingPrompt.buildTrainingActivityPrompt('Ds-2-1')
  assert.match(p, /연수용 약식 진행 규칙 \[이 활동에 적용 — 아래 역할·말투·절차 규칙보다 우선\]/)
  assert.match(p, /필수 칸[\s\S]*- 도구 연결 \(활동·도구·담당\)/)
  assert.match(p, /한 번 묻기 칸[\s\S]*- 학생·AI·교사의 역할 경계 — 이유: /)
  assert.match(p, /생략 칸[\s\S]*- AI 점검/)
  assert.match(p, /Ds-3 학습활동 설계 산출물이 없으면 "도구가 필요한 학습 활동 이름"만 한 번 묻는다/)
  assert.match(p, /\[AI 도움: 도구 추천\]/)
  assert.match(p, /팀원 의견을 다시 묻거나/)
  assert.match(p, /영어 키·내부 키/)
  assert.match(p, /"\[AI 도움: 버튼이름\]"으로 시작하는 요청은 그 버튼이 말하는 한 가지 일만/)
  assert.doesNotMatch(p, /Human-AI Agency|활동별 자료 설계/) // 내부 키 대신 한글 라벨
})

test('T7: buildSystemPrompt — 연수용 활동에만 규칙 주입(일반 규칙보다 앞), 핵심 절차·단계별 진행은 일반, solo 와 함께 동작', () => {
  const on = tProject({ enabled: true, coreFormal: true })
  const trainingP = buildSystemPrompt('Ds', 'Ds-1-1', on, '팀+AI', undefined, null, '홍성용(팀장)', {}, undefined)
  assert.match(trainingP, /연수용 약식 진행 규칙/)
  assert.ok(trainingP.indexOf('연수용 약식 진행 규칙') < trainingP.indexOf('## 이 프로젝트 정보') || trainingP.indexOf('## 이 프로젝트 정보') < 0)
  const core = buildSystemPrompt('T', 'T-1-1', on, '팀+AI', undefined, null, undefined, {}, undefined)
  assert.doesNotMatch(core, /연수용 약식 진행 규칙/)
  const stepByStep = buildSystemPrompt('Ds', 'Ds-1-1', on, '팀+AI', undefined, null, undefined, {}, undefined, { trainingStepByStep: true })
  assert.doesNotMatch(stepByStep, /연수용 약식 진행 규칙/)
  const solo = buildSystemPrompt('Ds', 'Ds-1-1', tProject({ enabled: true, coreFormal: false }, 'solo'), '개인+AI', undefined, null, undefined, {}, undefined)
  assert.match(solo, /연수용 약식 진행 규칙/)
  assert.ok(solo.indexOf('연수용 약식 진행 규칙') > 0)
  const route = fs.readFileSync(new URL('../src/app/api/chat/stream/route.ts', import.meta.url), 'utf8')
  assert.match(route, /trainingStepByStep: isStepByStepActive\(messages\.filter\(m => m\.role === 'user'\)/)
})

// TASK-T9 이후 허용된 유일한 차이: 단계 종료 체크리스트의 팀 확인 칸 '□' → '☐' 와 그 형식 안내 한 줄.
function withChecklistFormat(text) {
  return text
    .replaceAll('| □ |', '| ☐ |')
    .replace('**팀 확인** 열: 교사팀에게 직접 확인을 요청 ("각 항목을 확인해 주세요").', '**팀 확인** 열: 교사팀에게 직접 확인을 요청 ("각 항목을 확인해 주세요").\n**팀 확인** 칸에는 \'☐\' 한 글자만 쓴다 — 선생님들이 화면에서 직접 눌러 체크한다(✅·□·설명 글 쓰지 않기).')
    .replace('아래 **축약 체크리스트**를 표로 출력한다:\n', '아래 **축약 체크리스트**를 표로 출력한다(확인 칸에는 \'☐\' 한 글자만 — 선생님이 화면에서 직접 체크):\n')
}

test('T8: 일반 프로젝트 프롬프트는 연수용 도입 전(태그 pre-training-mode-2026-10-04)과 한 글자도 같다', async t => {
  let source
  try {
    source = execFileSync('git', ['show', 'pre-training-mode-2026-10-04:src/lib/prompts/system.ts'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname })
  } catch {
    t.skip('태그 없음')
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcid-prompt-'))
  const file = path.join(dir, 'system.pre-training.ts')
  fs.writeFileSync(file, source)
  const before = await import(pathToFileURL(file).href)
  const artifacts = { 'A-2-1': { title: 'a', content: { 성취기준분석표: '[4국03-03]' }, status: 'confirmed' } }
  for (const mode of ['collaborative', 'solo']) {
    for (const trainingMode of [undefined, { enabled: false, coreFormal: true }]) {
      for (const stage of T_STAGES) {
        for (const code of stage.activities) {
          const args = [stage.code, code, tProject(trainingMode, mode), mode === 'solo' ? '개인+AI' : '팀+AI', '학습자 요약', null, '홍성용(팀장), 캔바1', artifacts, undefined]
          assert.equal(buildSystemPrompt(...args), withChecklistFormat(before.buildSystemPrompt(...args)), `${mode} ${code} ${JSON.stringify(trainingMode)}`)
        }
      }
    }
  }
  // 연수용이 켜져 있어도 핵심 절차 활동은 일반 프롬프트와 같다.
  const on = tProject({ enabled: true, coreFormal: true })
  for (const code of training.TRAINING_CORE_ACTIVITIES) {
    const stage = T_META[code].stage
    const args = [stage, code, on, '팀+AI', undefined, null, undefined, {}, undefined]
    assert.equal(buildSystemPrompt(...args), withChecklistFormat(before.buildSystemPrompt(...args)), code)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('T9: ChatPanel·저장 흐름 — 이벤트 수신, 개입 금지 저장은 AI 없이 고정 응답, 연수용 활동은 #28 확인 카드 생략', () => {
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /window\.addEventListener\(TRAINING_SEND_EVENT, onTrainingSend\)/)
  // AI 응답 중·불러오기 전에는 줄에 세웠다가 순서대로 보낸다(저장 알림 누락 방지).
  assert.match(panel, /if \(isLoading \|\| isAnalyzing \|\| !messagesLoaded\) return\n    const next = trainingQueueRef\.current\.shift\(\)/)
  assert.match(panel, /void sendMessageDirectly\(next\)\.finally\(\(\) => setTrainingQueueTick/)
  // 연수 막대는 연수용 활동에서만, 슬롯 자리에 마운트
  assert.match(panel, /TRAINING_BAR_SLOT[^\n]*\n      \{isTrainingActivity\(proj, currentActivity\) && \(\n        <TrainingModeBar/)
  assert.match(panel, /onSend=\{enqueueTrainingSend\}/)
  assert.match(panel, /onNext=\{nextCode => handleActivityAdvance\(nextCode\)\}/)
  const quiet = panel.slice(panel.indexOf('if (shouldReplyTrainingQuietly('), panel.indexOf('setIsLoading(true)', panel.indexOf('if (shouldReplyTrainingQuietly(')))
  assert.match(quiet, /content: TRAINING_QUIET_REPLY/)
  assert.match(quiet, /return\n/)
  assert.doesNotMatch(quiet, /streamFromAPI/)
  assert.match(panel, /trainingMode: proj\.trainingMode,/)
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  assert.match(projects, /if \(project\.mode === 'solo' \|\| project\.demoRun \|\| isTrainingActivity\(project, activityCode\)\) return/)
})

// ─── TASK-T2: 연수용 생성·설정·양식·채팅 막대 ───
const trainingUiState = await import('../src/components/training/trainingFormState.ts')
const trainingUi = await import('../src/lib/training/trainingMode.ts')
const trainingUiProject = { id: 'training-ui', title: '연수', mode: 'collaborative', createdBy: 'host', hostUid: 'host', currentStage: 'T', trainingMode: { enabled: true, coreFormal: true } }
const trainingUiButton = ({ children, icon, trailing, variant: _variant, size: _size, ...props }) => React.createElement('button', props, icon, children, trailing)
const trainingUiBindings = {
  ...trainingUi, ...trainingUiState, ACTIVITY_META, STAGES,
  SOLO_HIDDEN_ACTIVITIES: ['T-2-1', 'T-2-2', 'T-2-3', 'E-2-1'],
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  MD3Button: trainingUiButton, CheckCircle: () => null, ArrowRight: () => null, Question: () => null,
  StageAnalysisModal: () => null,
}
const { TrainingModeFields } = loadArtifactTsx('../src/components/training/TrainingModeFields.tsx', {}, ['TrainingModeFields'])
const { TrainingModeBar } = loadArtifactTsx('../src/components/training/TrainingModeBar.tsx', trainingUiBindings, ['TrainingModeBar'])
const { TrainingStepGuide } = loadArtifactTsx('../src/components/training/TrainingStepGuide.tsx', trainingUiBindings, ['TrainingStepGuide'])
const formTree = ts.createSourceFile('TrainingForm.tsx', fs.readFileSync(new URL('../src/components/training/TrainingForm.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const { TrainingForm } = loadArtifactTsx('../src/components/training/TrainingForm.tsx', { ...trainingUiBindings, TrainingFormEditor: () => null }, ['TrainingForm'])

test('T10: 생성 카드의 하위 핵심 절차 기본값·두 진행 방식 저장 연결', () => {
  const off = renderToStaticMarkup(React.createElement(TrainingModeFields, { value: { enabled: false, coreFormal: true }, onChange() {} }))
  assert.match(off, /연수용 모드/)
  assert.doesNotMatch(off, /핵심 절차는 정식으로 진행/)
  const on = renderToStaticMarkup(React.createElement(TrainingModeFields, { value: { enabled: true, coreFormal: true }, onChange() {} }))
  assert.equal((on.match(/checked=""/g) ?? []).length, 2)
  assert.match(on, /T-1·T-2·A-2·A-3·A-4/)
  const page = fs.readFileSync(new URL('../src/app/(app)/projects/new/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /useState\(\{ enabled: false, coreFormal: true \}\)/)
  assert.match(page, /\.\.\.\(trainingMode\.enabled \? \{ trainingMode \} : \{\}\)/)
  assert.ok(page.indexOf('<TrainingModeFields') > page.indexOf('팀 협력 설계'))
  assert.ok(page.indexOf('<TrainingModeFields') < page.indexOf('>학교급<'))
})

test('T11: 양식은 구조화·평문 기존 값을 불러오고 빈 칸 제외·다른 섹션 보존', () => {
  const old = { _schema: 'Ds-1-1', rubric: [{ checkpoint: '3-4학년 발표', element: '근거', criteria: '[4사08-02]' }], '성취기준 연결': '기존 근거' }
  const copy = structuredClone(old)
  const values = trainingUiState.trainingFormValues('Ds-1-1', old)
  assert.match(values['평가 계획'], /3-4학년 발표/)
  assert.doesNotMatch(values['평가 계획'], /\[object Object\]/)
  const saved = trainingUiState.buildTrainingFormContent('Ds-1-1', old, values)
  assert.equal(saved['성취기준 연결'], '기존 근거')
  assert.equal(saved['평가 계획'], values['평가 계획'])
  assert.equal(saved._schema, undefined)
  assert.equal(saved.rubric, undefined)
  assert.deepEqual(old, copy)
  const plain = { '팀 공통 비전': '기존 비전', '핵심 키워드': '공백 제거', '개인 비전': '삭제할 값', '추가 메모': '유지' }
  assert.deepEqual(trainingUiState.buildTrainingFormContent('T-1-1', plain, { '팀 공통 비전': ' 새 비전 ', '핵심 키워드': '  ', '개인 비전': '' }), { '팀 공통 비전': '새 비전', '추가 메모': '유지' })
  for (const code of Object.keys(trainingUi.TRAINING_ACTIVITIES)) assert.ok(Object.values(trainingUiState.trainingFormValues(code, {})).every(value => value === ''), code)
  assert.notEqual(trainingUiState.trainingAdviceKey('one'), trainingUiState.trainingAdviceKey('two'))
})

test('T12: 일반·핵심 정식 활동의 양식·연수 막대 미노출, 기존 안내는 유지', () => {
  for (const project of [{ ...trainingUiProject, trainingMode: undefined }, trainingUiProject]) {
    const code = project.trainingMode ? 'T-1-1' : 'Ds-1-1'
    const props = { project, activityCode: code, content: {}, loaded: true, isHost: true, busy: false, onNext() {}, onSend() {} }
    assert.equal(renderToStaticMarkup(React.createElement(TrainingForm, props)), '')
    assert.equal(renderToStaticMarkup(React.createElement(TrainingModeBar, props)), '')
    assert.equal(renderToStaticMarkup(React.createElement(TrainingStepGuide, { ...props, children: '기존 안내' })), '기존 안내')
  }
  const html = renderToStaticMarkup(React.createElement(TrainingStepGuide, { project: trainingUiProject, activityCode: 'Ds-1-1', children: '평가 설계 안내' }))
  assert.match(html, /<details/)
  assert.doesNotMatch(html, /<details[^>]*open/)
  assert.match(html, /정식 진행 스텝 보기/)
  const loading = renderToStaticMarkup(React.createElement(TrainingForm, { project: trainingUiProject, activityCode: 'Ds-1-1', content: {}, loaded: false }))
  assert.match(loading, /불러오는 중/)
  assert.match(loading, /button[^>]*disabled/)
  assert.doesNotMatch(loading, /textarea/)
})

function trainingUiElements(node, type, found = []) {
  if (!node || typeof node !== 'object') return found
  if (node.type === type) found.push(node)
  React.Children.forEach(node.props?.children, child => trainingUiElements(child, type, found))
  return found
}

test('T13: 막대 도움·필수 칸 상태·방장만 이동·마지막 보고서 연결', () => {
  const sent = [], moved = []
  const props = { project: trainingUiProject, activityCode: 'Ds-1-1', content: { '평가 계획': '계획' }, loaded: true, isHost: true, busy: false, onSend: text => sent.push(text), onNext: code => moved.push(code) }
  const element = TrainingModeBar(props)
  assert.match(renderToStaticMarkup(element), /필수 칸 1\/1/)
  const buttons = trainingUiElements(element, trainingUiButton)
  buttons[0].props.onClick()
  assert.equal(sent[0], trainingUi.formatTrainingHelpRequest(trainingUi.TRAINING_ACTIVITIES['Ds-1-1'].help[0]))
  buttons.at(-2).props.onClick()
  assert.equal(sent[1], trainingUi.TRAINING_STEP_BY_STEP)
  buttons.at(-1).props.onClick()
  assert.deepEqual(moved, ['Ds-1-2'])
  const memberNext = trainingUiElements(TrainingModeBar({ ...props, isHost: false }), trainingUiButton).at(-1)
  assert.equal(memberNext.props.disabled, true)
  memberNext.props.onClick()
  assert.deepEqual(moved, ['Ds-1-2'])
  for (const extra of [{ busy: true }, { loaded: false }]) assert.ok(trainingUiElements(TrainingModeBar({ ...props, ...extra }), trainingUiButton).every(button => button.props.disabled))
  let reports = 0
  const final = trainingUiElements(TrainingModeBar({ ...props, activityCode: 'E-2-1', onReport: () => reports++ }), trainingUiButton).at(-1)
  assert.equal(final.props.children, '보고서 작성하기')
  final.props.onClick()
  assert.equal(reports, 1)
})

test('T14: 방장 양식 직접 저장·팀원 제안·조언 체크에 따른 알림·쓰기 실패와 활동 전환 방어', async () => {
  async function run({ uid = 'host', advice = true, reject = false, changedActivity = false, unchanged = false, quiet = false } = {}) {
    const writes = [], notices = [], drafts = [], feedback = [], errors = [], adviceResets = []
    const project = { ...trainingUiProject, artifacts: unchanged ? { 'Ds-1-1': { title: '기존', version: 4, status: 'confirmed', content: { '평가 계획': '평가 표' } } } : {} }
    const latest = { project, currentActivity: 'Ds-1-1', viewingActivity: changedActivity ? 'Ds-1-2' : 'Ds-1-1', setCurrentArtifact: value => drafts.push(value) }
    const save = loadChatFunction('save', {
      ...trainingUiBindings, project, activityCode: 'Ds-1-1', user: { uid, displayName: '교사' }, saving: false, readOnly: false,
      draft: { values: { '평가 계획': '평가 표' } }, content: {}, advice, quiet,
      useProjectStore: { getState: () => latest }, artifactContentEquals,
      setSaving() {}, setError: value => errors.push(value), setFeedback: value => feedback.push(value), setDraft() {}, setOneSaveAdvice: value => adviceResets.push(value),
      setProjectArtifact: async (...args) => { if (reject) throw Error('저장 실패'); writes.push(['save', ...args]) },
      proposeArtifactToHost: async (...args) => writes.push(['propose', ...args]),
      requestTrainingChatSend: text => notices.push(text), Timestamp: { now: () => 123 },
    }, formTree)
    await save()
    return { writes, notices, drafts, feedback, errors, adviceResets }
  }
  const host = await run()
  assert.equal(host.writes[0][0], 'save')
  assert.equal(host.writes[0][3].status, 'in_review')
  assert.equal(host.writes[0][3].content['평가 계획'], '평가 표')
  assert.equal(host.drafts.length, 1)
  assert.equal(host.notices[0], trainingUi.formatTrainingSaveNotice('Ds-1-1') + ' 조언해 주세요')
  assert.equal((await run({ advice: false })).notices[0], trainingUi.formatTrainingSaveNotice('Ds-1-1') + ' 조언은 필요 없어요')
  const member = await run({ uid: 'member' })
  assert.equal(member.writes[0][0], 'propose')
  assert.equal(member.notices.length, 0)
  assert.match(member.feedback.at(-1), /방장에게/)
  const failed = await run({ reject: true })
  assert.equal(failed.notices.length, 0)
  assert.match(failed.errors.at(-1), /저장하지 못했습니다/)
  assert.equal((await run({ changedActivity: true })).writes.length, 0)
  const noop = await run({ unchanged: true })
  assert.equal(noop.writes.length, 0)
  assert.equal(noop.drafts[0].status, 'confirmed')
  assert.equal(noop.drafts[0].currentVersion, 4)
  const once = await run({ quiet: true })
  assert.equal(once.notices[0], trainingUi.formatTrainingSaveNotice('Ds-1-1') + trainingUi.TRAINING_ADVICE_ONCE)
  assert.deepEqual(once.adviceResets, [null])
  assert.equal((await run({ quiet: true, advice: false })).notices[0], trainingUi.formatTrainingSaveNotice('Ds-1-1') + trainingUi.TRAINING_ADVICE_OFF)
  assert.equal((await run({ quiet: true, reject: true })).adviceResets.length, 0)
})

test('T15: 방장 설정 저장은 두 체크·갱신 시각만 쓰며 팀원에게는 설정을 열지 않는다', async () => {
  const source = fs.readFileSync(new URL('../src/components/training/TrainingSettingsModal.tsx', import.meta.url), 'utf8')
  const sourceTree = ts.createSourceFile('TrainingSettingsModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const writes = [], errors = []
  let closed = 0
  const value = { enabled: true, coreFormal: false }
  const bindings = { isHost: true, saving: false, project: trainingUiProject, value, setSaving() {}, setError: error => errors.push(error), onClose: () => closed++, db: {}, doc: (_db, ...path) => path.join('/'), serverTimestamp: () => 'timestamp', updateDoc: async (...args) => writes.push(args) }
  await loadChatFunction('save', bindings, sourceTree)()
  assert.equal(writes[0][0], 'projects/training-ui')
  assert.equal(writes[0][1].trainingMode, value)
  assert.equal(writes[0][1].updatedAt, 'timestamp')
  assert.equal(closed, 1)
  await loadChatFunction('save', { ...bindings, isHost: false }, sourceTree)()
  assert.equal(writes.length, 1)
  await loadChatFunction('save', { ...bindings, updateDoc: async () => { throw Error('permission') } }, sourceTree)()
  assert.match(errors.at(-1), /저장하지 못했습니다/)
  assert.equal(closed, 1)
  const { TrainingSettingsModal } = loadArtifactTsx('../src/components/training/TrainingSettingsModal.tsx', {
    ...trainingUiBindings, useRef: () => ({ current: null }), useEffect() {}, useProjectStore: callback => callback({ userProfile: { uid: 'member' } }),
  }, ['TrainingSettingsModal'])
  assert.equal(TrainingSettingsModal({ project: trainingUiProject, onClose() {} }), null)
})

test('T16: AI 조언 설정은 프로젝트별로 보존되고 저장소 실패 시에도 같은 탭에서 바뀐다', () => {
  const stored = new Map(), snapshots = []
  let writesFail = false
  const { useTrainingAdvice } = loadArtifactTsx('../src/components/training/useTrainingAdvice.ts', {
    'react': { useSyncExternalStore: (_subscribe, client, server) => { snapshots.push({ client, server }); return client() } },
    './trainingFormState': trainingUiState,
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { if (writesFail) throw Error('quota'); stored.set(key, value) } },
  })
  const [first, change] = useTrainingAdvice('project-one')
  assert.equal(first, true)
  assert.equal(snapshots[0].server(), true)
  change(false)
  assert.equal(useTrainingAdvice('project-one')[0], false)
  assert.equal(useTrainingAdvice('project-two')[0], true)
  writesFail = true
  const [, changeTwo] = useTrainingAdvice('project-two')
  changeTwo(false)
  assert.equal(useTrainingAdvice('project-two')[0], false)
  changeTwo(true)
  assert.equal(useTrainingAdvice('project-two')[0], true)
})

// ─── TASK-T4: 연수용 운영 시험 결함 — 개입 금지 유지·고정 첫 안내·저장 알림 칩 ─────────
test('T10: 개입 선호는 교사가 직접 친 말만 본다 — 저장 알림·AI 도움·단계별 버튼은 상태를 바꾸지 않는다', () => {
  const notice = training.formatTrainingSaveNotice('T-2-1')
  assert.equal(training.isTrainingSystemText(`${notice} 조언해 주세요`), true)
  assert.equal(training.isTrainingSystemText('[AI 도움: 역할 표로 정리] 적은 역할을 표로 도와주세요'), true)
  assert.equal(training.isTrainingSystemText('[단계별로 함께 진행]'), true)
  assert.equal(training.isTrainingSystemText('[답장: "역할"]\n[AI 도움: 역할 표로 정리] 정리'), true)
  assert.equal(training.isTrainingSystemText('조언해 주세요'), false)
  const d = training.detectInterventionPreference
  const quietSaid = '이 활동은 이제 개입하지 마시고 그대로 저장만 해 주세요'
  assert.equal(d([quietSaid, `${notice} 조언해 주세요`]), 'quiet')
  assert.equal(d([quietSaid, '[AI 도움: 역할 표로 정리] 표로 정리해 도와주세요']), 'quiet')
  assert.equal(d([quietSaid, '[단계별로 함께 진행]']), 'quiet')
  assert.equal(d([quietSaid, '이제 조언해 주세요']), 'normal')
  // 운영 시험 재현(Cs19gfNMVxBGNEA6726z T-3): 개입 금지 → 체크 켠 양식 저장 → 고정 응답
  const on = tProject({ enabled: true, coreFormal: true })
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', `${notice} 조언해 주세요`, [quietSaid]), true)
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', `${notice} 조언해 주세요`, [quietSaid, '도와주세요']), false)
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', `${notice} 조언은 필요 없어요`, []), true) // 체크 해제 1회
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', `${notice} 조언은 필요 없어요`, ['안녕하세요']), true)
  // 체크 해제 저장은 다음 판단에 남지 않는다
  assert.equal(d([`${notice} 조언은 필요 없어요`]), 'normal')
})

test('T11: isTrainingQuiet — 그 활동의 사용자 메시지만 시간순으로', () => {
  const msgs = [
    { role: 'user', content: '개입하지 마세요', activityCode: 'T-2-1' },
    { role: 'assistant', content: '도와드릴게요', activityCode: 'T-2-1' },
    { role: 'user', content: '도와주세요', activityCode: 'T-2-2' },
    { role: 'user', content: `${training.formatTrainingSaveNotice('T-2-1')} 조언해 주세요`, activityCode: 'T-2-1' },
  ]
  assert.equal(training.isTrainingQuiet(msgs, 'T-2-1'), true)
  assert.equal(training.isTrainingQuiet(msgs, 'T-2-2'), false)
  assert.equal(training.isTrainingQuiet([...msgs, { role: 'user', content: '이제 단계별로 같이 해요', activityCode: 'T-2-1' }], 'T-2-1'), false)
})

test('T12: 연수용 첫 안내는 AI 없이 정의로 만든 짧은 고정 안내, 저장 알림은 칩 문구', () => {
  const w = training.buildTrainingWelcome('T-2-1')
  assert.match(w, /^\*\*T-3 역할 배분\*\* — 누가 무엇을 언제까지 맡을지 적어요\./)
  assert.match(w, /- 필수 칸: 역할 배분 \(누가·무엇을·언제까지\)/)
  assert.match(w, /- 도움이 필요하면 위 버튼: 역할 표로 정리/)
  assert.match(w, /토의한 결과를 오른쪽 양식에 옮겨 적고 저장하세요\.$/)
  assert.doesNotMatch(w, /오늘 함께할 순서|자신 있으신가요|\n\n\n/)
  assert.match(training.buildTrainingWelcome('A-2-2'), /- 있으면 좋은 칸: 탐구 질문 \(학생 언어\)/)
  assert.doesNotMatch(training.buildTrainingWelcome('T-2-1'), /있으면 좋은 칸/)
  for (const code of T_ALL) assert.ok(training.TRAINING_INTRO[code], code)
  assert.equal(training.trainingSaveNoticeChip('[연수 양식 저장: T-3 역할 배분] 조언해 주세요'), 'T-3 역할 배분 양식을 저장했어요')
  assert.equal(training.trainingSaveNoticeChip('일반 메시지'), null)
})

test('T13: ChatPanel — 연수용 환영 분기·저장 알림 칩·연수용 활동은 구조화 빌더를 건너뛰어 양식 원문 키 유지', () => {
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /let welcome = isTrainingActivity\(proj, currentActivity\)\n      \? buildTrainingWelcome\(currentActivity\)/)
  assert.match(panel, /const trainingChip = msg\.role === 'user' \? trainingMessageChip\(msg\.content, msg\.displayName\) : null/)
  assert.match(panel, /if \(isTrainingActivity\(proj, targetAct\)\) \{\n      \/\/ 원문 그대로 저장\n    \} else if \(targetAct === 'T-1-1'\)/)
  assert.match(panel, /if \(isTrainingActivity\(proj, targetActivity\)\) \{\n      \/\/ 원문 그대로 저장\n    \} else if \(targetActivity === 'T-1-1'\)/)
})

test('T14: 개입 금지 중 체크를 다시 켠 저장(" 이번 저장만 조언해 주세요")은 그 1회만 AI, 상태는 quiet 유지', () => {
  const on = tProject({ enabled: true, coreFormal: true })
  const notice = training.formatTrainingSaveNotice('T-2-1')
  const quietSaid = ['개입하지 마시고 그대로 저장만 해 주세요']
  assert.equal(training.TRAINING_ADVICE_ONCE, ' 이번 저장만 조언해 주세요')
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', notice + training.TRAINING_ADVICE_ONCE, quietSaid), false)
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', notice + training.TRAINING_ADVICE_ON, quietSaid), true)
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', notice + training.TRAINING_ADVICE_OFF, []), true)
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', notice + training.TRAINING_ADVICE_ON, []), false)
  const msgs = [...quietSaid, notice + training.TRAINING_ADVICE_ONCE].map(content => ({ role: 'user', content, activityCode: 'T-2-1' }))
  assert.equal(training.isTrainingQuiet(msgs, 'T-2-1'), true)
  // 그다음 저장은 다시 고정 응답
  assert.equal(training.shouldReplyTrainingQuietly(on, 'T-2-1', notice + training.TRAINING_ADVICE_ON, msgs.map(m => m.content)), true)
})

// ─── TASK-T6: 공동 편집 표 머리글 대비·활동 표시 번호 ───
function workspaceModalTrees() {
  const dir = new URL('../src/components/artifacts/', import.meta.url)
  return fs.readdirSync(dir).filter(file => file.endsWith('WorkspaceModal.tsx')).map(file => {
    const source = fs.readFileSync(new URL(file, dir), 'utf8')
    return { file, source, tree: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
  })
}

test('T6a: 모든 공동 편집 표의 주·보조·미리보기 머리글은 밝은 배경과 짙은 글자, 삭제·포커스 색을 쓴다', () => {
  let inputs = 0, headers = 0
  for (const { file, tree } of workspaceModalTrees()) {
    function visit(node, inHeader = false) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(tree) : ''
      const header = inHeader || tag === 'th' || tag === 'thead'
      if (header && ts.isJsxAttribute(node) && node.name.text === 'className' && node.initializer && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text
        assert.doesNotMatch(value, /text-white|bg-\[#1A73E8\]|border-\[#1557B0\]/, file)
        const elementTag = node.parent.parent.tagName?.getText(tree)
        if (elementTag === 'input') {
          inputs++
          for (const expected of ['text-[#202124]', 'font-semibold', 'placeholder:text-[#5F6368]', 'bg-transparent', 'hover:bg-black/5', 'focus:bg-white', 'focus:border-[#0B57D0]']) assert.ok(value.split(' ').includes(expected), `${file}: ${expected}`)
        } else if (elementTag === 'button') {
          assert.ok(value.includes('text-[#5F6368]'), file)
          assert.ok(value.includes('hover:text-[#C5221F]'), file)
        } else if (elementTag === 'th') {
          headers++
          if (value.includes('text-[')) assert.ok(value.includes('text-[#202124]'), file)
        }
      }
      ts.forEachChild(node, child => visit(child, header))
    }
    visit(tree)
  }
  assert.ok(inputs >= 20, '주·보조 표 입력 머리글을 모두 검사')
  assert.ok(headers >= 40, '미리보기·빈 머리칸 포함')
})

test('T6b: 머리글·placeholder·삭제 아이콘은 기본·hover·focus 배경에서 대비 4.5:1 이상이다', () => {
  const luminance = hex => {
    const rgb = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  for (const foreground of ['202124', '5F6368', 'C5221F']) {
    for (const background of ['F7F7F5', 'EBEBE9', 'FFFFFF']) assert.ok((luminance(background) + 0.05) / (luminance(foreground) + 0.05) >= 4.5, `${foreground}/${background}`)
  }
})

test('T6c: 공동 편집 창 배지는 내부 코드 대신 문서 표시 번호를 렌더하고 스키마는 내부 코드를 유지한다', () => {
  const expected = {
    TeamVision: ['T-1-1', 'T-1'], LessonDesignDirection: ['T-1-2', 'T-2'], RoleDistribution: ['T-2-1', 'T-3'], TeamRules: ['T-2-2', 'T-4'], TeamSchedule: ['T-2-3', 'T-5'],
    TopicSelection: ['A-1-2', 'A-2'], IntegratedGoal: ['A-2-2', 'A-4'], EvaluationPlan: ['Ds-1-1', 'Ds-1'], ProblemSituation: ['Ds-1-2', 'Ds-2'], LearningActivity: ['Ds-1-3', 'Ds-3'], SupportTool: ['Ds-2-1', 'Ds-4'], Scaffolding: ['Ds-2-2', 'Ds-5'],
  }
  for (const { file, source, tree } of workspaceModalTrees()) {
    const badge = expected[file.replace('WorkspaceModal.tsx', '')]
    if (!badge) continue // DI·E 공용 창에는 코드 배지가 없다.
    const [internal, displayed] = badge
    let rendered = 0
    function visit(node) {
      if (ts.isJsxText(node)) assert.doesNotMatch(node.text, /\b(?:T|A|Ds|DI|E)-\d-\d\b/, file)
      if (ts.isJsxExpression(node) && node.expression && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === 'displayActivityCode') {
        const code = node.expression.arguments[0]?.text
        const markup = renderToStaticMarkup(React.createElement('span', null, displayActivityCode(code)))
        assert.ok(!markup.includes(code) || displayActivityCode(code) === code, file)
        if (code === internal) { assert.equal(markup, `<span>${displayed}</span>`); rendered++ }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    assert.ok(rendered, `${file}: 배지 변환`)
    assert.ok(source.includes(`_schema: '${internal}'`) || source.includes(`_schema === '${internal}'`), `${file}: 저장 스키마 보존`)
  }
})

// ─── TASK-T5b: 기존 영어 머리글 문자열까지 한국어로 재표시 ───
test('T5b1: 운영 T-3의 구분선 없는 영어 표 문자열·마크다운 표·객체 배열은 모두 한국어로 표시한다', () => {
  const rows = [
    { deadline: '매주 화요일', teacherName: '홍성용', subject: '미입력', strengths: '미입력', role: '진행', responsibilities: '회의 진행' },
    { deadline: '금요일', teacherName: '잠만보', subject: '사회', strengths: '**미입력**', role: '자료', responsibilities: '지도 \\| 사진 공유' },
  ]
  const bare = serializeArtifactForPrompt(rows)
  const markdown = ['| deadline | teacherName | subject | strengths | role | responsibilities |', '| --- | --- | --- | --- | --- | --- |', ...bare.split('\n').slice(1).map(row => `| ${row} |`)].join('\n')
  for (const value of [bare, markdown, rows]) {
    const text = trainingUiState.trainingFormValues('T-2-1', { '역할 배분': value })['역할 배분']
    assert.match(text, /완료 시점/)
    assert.match(text, /교사명/)
    assert.match(text, /담당 교과/)
    assert.match(text, /팀 내 역할/)
    assert.match(text, /담당 업무/)
    assert.match(text, /매주 화요일/)
    assert.match(text, /홍성용/)
    assert.match(text, /사회/)
    assert.doesNotMatch(text, /deadline|teacherName|subject|strengths|responsibilities|미입력|강점·전문성/)
    const parsed = unified().use(remarkParse).use(REMARK_PLUGINS).parse(text)
    assert.equal(parsed.children[0].type, 'table')
    assert.equal(parsed.children[0].children[0].children.length, 5)
  }
  assert.equal(rows[0].strengths, '미입력')
})

test('T5b2: 다른 활동의 옛 영어 표 머리글도 교과별 한국어 열 이름으로 바꾸고 미입력 열은 생략한다', () => {
  const fixtures = [
    ['Ds-1-1', '평가 계획', [{ checkpoint: '발표', item: '근거', method: '관찰', timing: '3차시', actor: '미입력' }], ['확인 지점', '평가 요소', '평가 방법', '평가 시점']],
    ['Ds-1-3', '학습 활동', [{ order: '1', phase: '탐색', name: '지도 조사', description: '지역 비교', coreType: '핵심', subject: '사회', session: '1차시', operation: '미입력' }], ['순서', '흐름 단계', '활동명', '활동 설명', '핵심/부가', '담당 교과', '누적 차시']],
    ['Ds-1-2', '문제상황', [{ title: '우리 동네', authenticity: '폭염', contentProduct: '그늘 지도', audienceAction: '주민에게 제안' }], ['제목', '실제성', '학습 내용+산출물', '청중+행위']],
    ['A-2-1', '성취기준분석표', [{ gradeBand: '3-4', subject: '사회', coreIdea: '주민 참여', standard: '[4사08-02]', knowledgeUnderstanding: '지역 문제', processFunction: '조사', valueAttitude: '참여' }], ['학년군', '교과', '핵심 아이디어', '성취기준 코드+원문', '지식·이해', '과정·기능', '가치·태도']],
  ]
  for (const [code, section, rows, labels] of fixtures) {
    const text = trainingUiState.trainingFormValues(code, { [section]: serializeArtifactForPrompt(rows) })[section]
    for (const label of labels) assert.ok(text.includes(label), `${code}: ${label}`)
    assert.doesNotMatch(text, /checkpoint|item\s*\||method\s*\||actor\s*\||coreType|operation|authenticity|audienceAction|gradeBand|standard\s*\||미입력/, code)
  }
})

test('T5b3: 평문·한국어 작성 표·코드 블록은 원문을 보존하고 여러 영어 표의 주변 글은 유지한다', () => {
  for (const raw of ['홍성용: 사회·진행\n잠만보: 사회·자료 조사', 'deadline은 금요일이에요. 미입력 칸은 나중에 적을게요.', '| 교사명 | 역할 |\n| --- | --- |\n| 홍성용 | 미입력 |', '```text\nteacherName | role\n홍성용 | 진행\n```']) {
    assert.equal(trainingUiState.trainingFormValues('T-2-1', { '역할 배분': raw })['역할 배분'], raw)
  }
  const raw = '첫 표\n**teacherName** | `role`\n홍성용 | 진행\n\n두 번째 표\nteacherName | subject | strengths\n잠만보 | 사회 | 미입력\n\n원문 메모'
  const text = trainingUiState.trainingFormValues('T-2-1', { '역할 배분': raw })['역할 배분']
  assert.match(text, /^첫 표\n\| 교사명 \| 팀 내 역할 \|/)
  assert.match(text, /두 번째 표\n\| 교사명 \| 담당 교과 \|/)
  assert.match(text, /원문 메모$/)
  assert.doesNotMatch(text, /teacherName|strengths|미입력/)
})

test('T8a: 필수 칸이 없는 연수 막대는 0/0 상태를 생략하고 불러오는 중 안내는 유지한다', () => {
  const { TrainingModeBar: EmptyRequiredBar } = loadArtifactTsx('../src/components/training/TrainingModeBar.tsx', {
    ...trainingUiBindings,
    trainingStatus: () => ({ missingRequired: [], filled: 0, requiredTotal: 0 }),
  }, ['TrainingModeBar'])
  const props = { project: trainingUiProject, activityCode: 'T-2-1', loaded: true, isHost: true, busy: false, onSend: () => {}, onNext: () => {} }
  const html = renderToStaticMarkup(React.createElement(EmptyRequiredBar, props))
  assert.doesNotMatch(html, /필수 칸|0\/0|role="status"/)
  assert.match(html, /연수용 모드/)
  assert.match(renderToStaticMarkup(React.createElement(EmptyRequiredBar, { ...props, loaded: false })), /내용을 불러오는 중/)
})

// ─── TASK-T5: 한국어 양식 재표시·입력 원문·개입 금지 체크 ───
test('T20: 실제 T-3 역할 데이터는 한국어 표로 표시하고 미입력 칸·빈 열을 제외한다', () => {
  const content = { _schema: 'T-2-1', roles: [
    { deadline: '미입력', teacherName: '홍성용', subject: '사회', strengths: '미입력', role: '진행', responsibilities: '회의를 이끌어요' },
    { deadline: '', teacherName: '잠만보', subject: '사회', strengths: '-', role: '자료', responsibilities: '조사를 준비해요' },
    { teacherName: '미입력', subject: '미입력', strengths: '', role: '-', responsibilities: null },
  ] }
  const copy = structuredClone(content)
  const text = trainingUiState.trainingFormValues('T-2-1', content)['역할 배분']
  assert.equal(text.split('\n')[0], '| 교사명 | 담당 교과 | 팀 내 역할 | 담당 업무 |')
  assert.match(text, /\| 홍성용 \| 사회 \| 진행 \| 회의를 이끌어요 \|/)
  assert.equal(text.split('\n').length, 4)
  assert.doesNotMatch(text, /teacherName|deadline|strengths|responsibilities|미입력|강점·전문성|기한/)
  assert.deepEqual(content, copy)
  const raw = '홍성용: 사회·진행\n잠만보: 사회·자료 조사\n캔바1: 통합·기록'
  assert.equal(trainingUiState.trainingFormValues('T-2-1', { ...content, '역할 배분': raw })['역할 배분'], raw)
  const saved = trainingUiState.buildTrainingFormContent('T-2-1', content, { '역할 배분': raw })
  assert.equal(saved['역할 배분'], raw)
  assert.equal(trainingUiState.trainingFormValues('T-2-1', saved)['역할 배분'], raw)
})

test('T21: 19개 활동의 구조화 초기값은 영어 키 없이 한국어로 표시한다 — Ds 평가·활동·문제상황 포함', () => {
  const fixtures = {
    'T-1-1': { personalVisions: [{ teacherName: '교사', keywords: ['참여'], refinedVision: '공동 문제 해결' }], teamVision: '생활을 바꾸자', coreKeywords: ['참여'] },
    'T-1-2': { designPrinciples: [{ principle: '학생 질문으로 출발', rationale: '주도성' }] },
    'T-2-1': { roles: [{ teacherName: '교사', subject: '사회', role: '조사', deadline: '금요일' }] },
    'T-2-2': { rules: [{ category: '소통', name: '함께 확인', description: '차례대로 의견 내기' }] },
    'T-2-3': { schedule: [{ period: '10월', activity: '자료 개발', content: '지도를 준비', assignee: '교사' }] },
    'A-1-1': { '주제 선정 기준': [{ criterion: '학생 삶', description: '동네 경험' }] },
    'A-1-2': { selectedTopic: '동네 그늘', rationale: '기후위기', criteria: [{ criterion: '실제성', priority: '핵심' }] },
    'A-2-1': { rows: [{ gradeBand: '3-4학년군', subject: '사회', coreIdea: '시민 참여', standard: '[4사08-02]', knowledgeUnderstanding: '지역 문제', processFunction: '인터뷰', valueAttitude: '참여' }] },
    'A-2-2': { integratedGoal: '근거로 제안하기', subjectGoals: [{ subject: '사회', goal: '그늘을 제안' }] },
    'A-2-3': { commonProfile: [{ item: '선수지식', content: '지도 읽기' }], teacherNotes: [{ teacherName: '교사', note: '읽기 지원' }] },
    'Ds-1-1': { rubric: [{ checkpoint: '발표', item: '근거', method: '관찰', timing: '3차시', actor: '교사' }] },
    'Ds-1-2': { scenario: { title: '그늘을 제안해요', authenticity: '동네 폭염', contentProduct: '지도', audienceAction: '주민 설명회' }, drivingQuestion: '누구에게 그늘이 필요할까?' },
    'Ds-1-3': { activities: [{ order: '1', phase: '정보 탐색', name: '두 장소 비교하기', description: '온도를 비교', coreType: '핵심', subject: '사회', session: '1차시', operation: '태블릿' }] },
    'Ds-2-1': { materials: [{ activity: '지도 조사', name: '패들렛', purpose: '기록', sourceType: '탐색', owner: '교사', schedule: '금요일' }] },
    'Ds-2-2': { scaffolds: [{ targetActivity: '인터뷰', type: '질문 카드', content: '첫 질문', level: '전체', fadeOut: '2회차' }] },
    'DI-1-1': { '개발 자료 목록': [{ name: '지도 활동지', owner: '교사', schedule: '금요일' }] },
    'DI-2-1': { '주요 상황 기록': [{ timing: '3차시', note: '자기 말로 질문함' }] },
    'E-1-1': { '사실': { timing: '3차시', note: '질문을 함' }, '해석': { note: '주도성' }, '수정안': { note: '연습 추가' } },
    'E-2-1': { '협력 과정 성찰': { note: '서로 자료 공유' }, '팀 개선안': { note: '회의록 공동 작성' } },
  }
  const internalKeys = /teacherName|refinedVision|coreIdea|standard\s*\||knowledgeUnderstanding|processFunction|valueAttitude|checkpoint|method\s*\||timing\s*\||actor\s*\||authenticity|contentProduct|audienceAction|coreType|sourceType|targetActivity|fadeOut|\[object Object\]/
  assert.equal(Object.keys(fixtures).length, 19)
  for (const [code, content] of Object.entries(fixtures)) {
    const before = structuredClone(content)
    const values = trainingUiState.trainingFormValues(code, content)
    const text = Object.values(values).join('\n')
    assert.ok(text.length, code)
    assert.doesNotMatch(text, internalKeys, code)
    assert.deepEqual(content, before, code)
  }
  const evaluation = trainingUiState.trainingFormValues('Ds-1-1', fixtures['Ds-1-1'])['평가 계획']
  assert.match(evaluation, /\| 확인 지점 \| 평가 요소 \| 평가 방법 \| 평가 시점 \| 평가 주체 \|/)
  const activity = trainingUiState.trainingFormValues('Ds-1-3', fixtures['Ds-1-3'])['학습 활동']
  assert.match(activity, /\| 순서 \| 흐름 단계 \| 활동명 \| 활동 설명 \| 핵심\/부가 \| 담당 교과 \| 누적 차시 \| 차시 운영 \|/)
  const scenario = trainingUiState.trainingFormValues('Ds-1-2', fixtures['Ds-1-2'])['문제상황']
  assert.match(scenario, /\| 실제성 \| 동네 폭염 \|/)
  assert.match(scenario, /\| 청중\+행위 \| 주민 설명회 \|/)
})

test('T22: 개입 금지일 때 체크는 자동 해제되고 다시 켜도 프로젝트 기본 선호를 바꾸지 않는다', () => {
  let messages = [{ id: 'quiet-1', role: 'user', content: '개입하지 마세요', activityCode: 'T-2-1' }]
  const states = [], preferenceChanges = []
  let cursor = 0
  const { TrainingFormEditor } = loadArtifactTsx('../src/components/training/TrainingForm.tsx', {
    ...trainingUiBindings, displayActivityCode,
    useProjectStore: selector => selector({ userProfile: { uid: 'host' }, messages }),
    useTrainingAdvice: () => [true, value => preferenceChanges.push(value)],
    getDemoActivityContract: () => ({ steps: [] }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
  }, ['TrainingFormEditor'])
  const props = { project: trainingUiProject, activityCode: 'T-2-1', content: { '역할 배분': '교사: 사회' }, readOnly: false }
  const render = () => { cursor = 0; return TrainingFormEditor(props) }
  let element = render()
  let checkbox = trainingUiElements(element, 'input')[0]
  assert.equal(checkbox.props.checked, false)
  assert.equal(checkbox.props.disabled, false)
  assert.match(renderToStaticMarkup(element), /개입 금지 요청 중 — 조언하지 않아요/)
  checkbox.props.onChange({ target: { checked: true } })
  element = render()
  assert.equal(trainingUiElements(element, 'input')[0].props.checked, true)
  assert.match(renderToStaticMarkup(element), /이번 저장 1회만/)
  assert.equal(preferenceChanges.length, 0)
  // 새로운 금지 요청은 아직 저장하지 않은 1회 체크도 자동으로 끈다.
  messages = [...messages, { id: 'quiet-2', role: 'user', content: '그대로 저장만 해 주세요', activityCode: 'T-2-1' }]
  assert.equal(trainingUiElements(render(), 'input')[0].props.checked, false)
  messages = [...messages, { id: 'normal', role: 'user', content: '이제 조언해 주세요', activityCode: 'T-2-1' }]
  assert.equal(trainingUiElements(render(), 'input')[0].props.checked, true)
})

// ─── TASK-T7: 공동 편집 '저장하기' 후 이전 버전으로 돌아가던 결함 ─────────
function makeHookRunner() {
  const slots = []
  let index = 0
  let effects = []
  const fakeReact = {
    useState(init) {
      const k = index++
      if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init
      return [slots[k], value => { slots[k] = typeof value === 'function' ? value(slots[k]) : value }]
    },
    useRef(init) { const k = index++; if (!(k in slots)) slots[k] = { current: init }; return slots[k] },
    useCallback(fn, deps) {
      const k = index++
      const prev = slots[k]
      if (prev && prev.deps.every((d, j) => Object.is(d, deps[j]))) return prev.fn
      slots[k] = { fn, deps }
      return fn
    },
    useEffect(fn, deps) {
      const k = index++
      const prev = slots[k]
      const changed = !deps || !prev || deps.some((d, j) => !Object.is(d, prev.deps[j]))
      slots[k] = { deps }
      if (changed) effects.push(fn)
    },
  }
  return {
    fakeReact,
    render(hook, props) {
      index = 0
      effects = []
      const out = hook(props)
      for (const effect of effects) effect()
      return out
    },
  }
}
const t7Runner = makeHookRunner()
const t7Sync = loadArtifactTsx('../src/components/artifacts/useWorkspaceSync.ts', {
  react: t7Runner.fakeReact,
  setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (...args) => globalThis.clearTimeout(...args),
})
const t7Cell = (ws, key) => ws.rows.find(r => r.id === key.split(':')[0])?.cells[key.split(':')[1]]
const t7Preserve = (next, current, key) => {
  const [rowId, colId] = key.split(':')
  const mine = current.rows.find(r => r.id === rowId)?.cells?.[colId]
  if (mine === undefined) return next
  return { ...next, rows: next.rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: mine } } : r) }
}
const t7Ws = value => ({ rows: [{ id: 'r1', cells: { c1: value, c2: '근거' } }] })

test('T7a: 칸에서 나가도(blur) 옛 저장본으로 되돌아가지 않고, 저장 대기 중 도착한 옛 스냅숏도 새 입력을 덮지 않는다', async () => {
  let ws = t7Ws('옛 원칙')
  const setWorkspace = update => { ws = update(ws) }
  const saved1 = t7Ws('옛 원칙')
  const props = (incoming, editingKey) => ({ open: true, incoming, workspace: ws, setWorkspace, editingKey, preserve: t7Preserve })
  let sync = t7Runner.render(t7Sync.useWorkspaceSync, props(saved1, 'r1:c1'))
  ws = t7Ws('새 원칙') // 타이핑(로컬 즉시 반영)
  sync = t7Runner.render(t7Sync.useWorkspaceSync, props(saved1, 'r1:c1'))
  // blur: 칸 저장 시작 + editingKey 해제 → 예전에는 이 시점에 옛 저장본으로 되돌아갔다
  let resolvePatch
  const patchDone = sync.track({ type: 'update-cell', rowId: 'r1', columnId: 'c1', value: '새 원칙' }, new Promise(r => { resolvePatch = r }))
  sync = t7Runner.render(t7Sync.useWorkspaceSync, props(saved1, null))
  assert.equal(t7Cell(ws, 'r1:c1'), '새 원칙')
  // 저장 응답 전, 다른 사람의 옛 스냅숏 도착 → 대기 중 칸은 로컬 유지, 다른 칸은 원격 반영
  sync = t7Runner.render(t7Sync.useWorkspaceSync, props({ rows: [{ id: 'r1', cells: { c1: '옛 원칙', c2: '근거(팀원 수정)' } }] }, null))
  assert.equal(t7Cell(ws, 'r1:c1'), '새 원칙')
  assert.equal(t7Cell(ws, 'r1:c2'), '근거(팀원 수정)')
  // '저장하기': 대기 중인 칸 저장이 끝난 뒤의 최신 로컬 표로 통째 저장
  let latestResolved = false
  const latestPromise = sync.settledLatest().then(v => { latestResolved = true; return v })
  await new Promise(r => setTimeout(r, 0))
  assert.equal(latestResolved, false) // 칸 저장이 끝나기 전엔 통째 저장하지 않는다
  resolvePatch(t7Ws('새 원칙'))
  await patchDone
  t7Runner.render(t7Sync.useWorkspaceSync, props({ rows: [{ id: 'r1', cells: { c1: '옛 원칙', c2: '근거(팀원 수정)' } }] }, null))
  const latest = await latestPromise
  assert.equal(t7Cell(latest, 'r1:c1'), '새 원칙')
  assert.equal(t7Cell(latest, 'r1:c2'), '근거(팀원 수정)')
})

test('T7b: 저장 응답 반영(applySaved)도 편집 중인 다른 칸을 덮지 않고, 대기가 끝난 칸은 원격 값을 따른다', () => {
  let ws = t7Ws('편집 중 글자')
  const setWorkspace = update => { ws = update(ws) }
  const sync = t7Runner.render(t7Sync.useWorkspaceSync, { open: true, incoming: ws, workspace: ws, setWorkspace, editingKey: 'r1:c1', preserve: t7Preserve })
  sync.applySaved({ rows: [{ id: 'r1', cells: { c1: '옛 값', c2: '서버 근거' } }] })
  assert.equal(t7Cell(ws, 'r1:c1'), '편집 중 글자')
  assert.equal(t7Cell(ws, 'r1:c2'), '서버 근거')
  assert.equal(t7Sync.pendingKeyOfPatch({ type: 'update-cell', rowId: 'a', columnId: 'b' }), 'a:b')
  assert.equal(t7Sync.pendingKeyOfPatch({ type: 'add-row' }), null)
})

test('T7c: 범용 공동 편집 창 — 칸별 대기 저장(빠른 칸 이동에도 앞 칸 유지), 닫을 때 즉시 전송, 대기·전송 중 칸 보호', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent = []
  const queue = t7Sync.createDebouncedPatchQueue(async (patch, key) => { sent.push([key, patch.value]) }, 400)
  queue.schedule('main:r1:c1', { value: '첫 칸' })
  t.mock.timers.tick(100)
  queue.schedule('main:r2:c1', { value: '둘째 칸' }) // 400ms 안에 칸 이동 — 예전엔 첫 칸 저장이 취소됐다
  queue.schedule('main:r2:c1', { value: '둘째 칸 수정' })
  t.mock.timers.tick(400)
  await Promise.resolve()
  assert.deepEqual(sent, [['main:r1:c1', '첫 칸'], ['main:r2:c1', '둘째 칸 수정']])
  queue.schedule('main:r3:c1', { value: '닫기 직전' })
  await queue.flushAll() // 언마운트: 취소하지 않고 바로 보낸다
  assert.deepEqual(sent.at(-1), ['main:r3:c1', '닫기 직전'])
  assert.equal(queue.keys().length, 0)
  t.mock.timers.tick(1000)
  assert.equal(sent.length, 3) // 중복 전송 없음
  const local = { rows: [{ id: 'r1', cells: { c1: '새' } }], blocks: [{ id: 'b1', table: { columns: [], rows: [{ id: 'x', cells: { k: '로컬 표' } }] } }] }
  const remote = { rows: [{ id: 'r1', cells: { c1: '옛' } }], blocks: [{ id: 'b1', table: { columns: [], rows: [{ id: 'x', cells: { k: '옛 표' } }] } }] }
  const merged = t7Sync.mergeCoeditIncoming(remote, local, ['main:r1:c1', 'b1'])
  assert.equal(merged.rows[0].cells.c1, '새')
  assert.equal(merged.blocks[0].table.rows[0].cells.k, '로컬 표')
  assert.equal(t7Sync.mergeCoeditIncoming(remote, local, []).rows[0].cells.c1, '옛')
})

test('T7d: 12개 공동 편집 창이 공용 동기화를 쓰고, 칸 이동으로 동기화가 다시 돌지 않으며, 저장은 트랜잭션', () => {
  const dir = new URL('../src/components/artifacts/', import.meta.url)
  const modals = fs.readdirSync(dir).filter(f => f.endsWith('WorkspaceModal.tsx') && f !== 'CoeditWorkspaceModal.tsx')
  assert.equal(modals.length, 12)
  for (const file of modals) {
    const src = fs.readFileSync(new URL(file, dir), 'utf8')
    assert.doesNotMatch(src, /\}, \[artifactContent, editingKey, open, savedWorkspace\]\)/, file)
    assert.match(src, /const sync = useWorkspaceSync\(\{/, file)
    assert.doesNotMatch(src, /type: 'replace-all', workspace, updatedBy/, file) // 통째 저장은 최신 로컬 표로
    assert.match(src, /workspace: await sync\.settledLatest\(\)/, file)
    assert.doesNotMatch(src, /if \(saved\) setWorkspace\(normalizeWorkspace\(saved\)\)/, file)
  }
  const coedit = fs.readFileSync(new URL('CoeditWorkspaceModal.tsx', dir), 'utf8')
  assert.match(coedit, /useEffect\(\(\) => \(\) => \{ void cellQueue\.flushAll\(\) \}, \[cellQueue\]\)/)
  assert.doesNotMatch(coedit, /clearTimeout\(flushTimerRef/)
  // 저장은 트랜잭션이 아니라(2026-05-14 자기 충돌 지연 때문에 뺐음) 같은 필드 저장을 줄 세운다.
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const fns = [...projects.matchAll(/export async function (patch\w+Workspace)\([\s\S]*?\n\}\n/g)]
  assert.equal(fns.length, 12)
  for (const fn of fns) assert.match(fn[0], /return serializeWorkspaceSave\(projectId, '\w+Workspace', async \(\) => \{/, fn[1])
  assert.match(projects, /async function patchWorkspace\(projectId: string, patch: CoeditWorkspacePatch\)[\s\S]*?serializeWorkspaceSave\(projectId, field,/)
})

test('T7e: 같은 필드 저장은 순서대로 — 뒤 저장이 앞 저장 반영 전 문서를 읽어 앞 칸을 덮지 않는다', async () => {
  const { serializeWorkspaceSave } = await import('../src/lib/firebase/serializeSave.ts')
  let doc = { c1: '옛', c2: '옛' }
  const save = (key, value, delay) => serializeWorkspaceSave('p', 'teamRulesWorkspace', async () => {
    const read = { ...doc } // getDoc
    await new Promise(r => setTimeout(r, delay))
    doc = { ...read, [key]: value } // updateDoc(필드 통째)
    return doc
  })
  await Promise.all([save('c1', '새1', 20), save('c2', '새2', 0)])
  assert.deepEqual(doc, { c1: '새1', c2: '새2' })
  // 앞 저장이 실패해도 뒤 저장은 진행
  const failed = serializeWorkspaceSave('p', 'teamRulesWorkspace', async () => { throw new Error('x') })
  const after = save('c1', '다시', 0)
  await assert.rejects(failed)
  assert.deepEqual(await after, { c1: '다시', c2: '새2' })
  // 다른 필드는 기다리지 않는다
  let otherDone = false
  const slow = serializeWorkspaceSave('p', 'a', () => new Promise(r => setTimeout(r, 30)))
  await serializeWorkspaceSave('p', 'b', async () => { otherDone = true })
  assert.equal(otherDone, true)
  await slow
})

test('T15: 칸 분류는 원본 분류표(사용자 제공)와 같고, 19개 활동 모두 필수 칸이 1개 이상', () => {
  const byTier = (code, tier) => training.TRAINING_ACTIVITIES[code].fields.filter(f => f.tier === tier).map(f => f.key)
  const expectedA = {
    'T-1-1': ['팀 공통 비전', '개인 비전'], 'T-1-2': ['설계 방향'], 'T-2-1': ['역할 배분'], 'T-2-2': ['팀 규칙'], 'T-2-3': ['팀 일정'],
    'A-1-1': ['주제 선정 기준'], 'A-1-2': ['최종 선정 주제'], 'A-2-1': ['성취기준분석표'],
    'A-2-2': ['통합 수업목표', '공통 핵심 아이디어', '교과별 수업목표'], 'A-2-3': ['학습자 프로필'],
    'Ds-1-1': ['평가 계획'], 'Ds-1-2': ['문제상황'], 'Ds-1-3': ['학습 활동'], 'Ds-2-1': ['활동별 자료 설계'], 'Ds-2-2': ['스캐폴딩 계획'],
    'DI-1-1': ['개발 자료 목록'], 'DI-2-1': ['주요 상황 기록'], 'E-1-1': ['해석', '수정안'], 'E-2-1': ['협력 과정 성찰', '팀 개선안'],
  }
  const expectedB = { 'A-1-2': ['선정 근거'], 'A-2-2': ['탐구 질문'], 'Ds-2-1': ['Human-AI Agency'], 'E-1-1': ['사실'] }
  for (const code of T_ALL) {
    assert.deepEqual(byTier(code, 'A'), expectedA[code], `${code} 필수`)
    assert.deepEqual(byTier(code, 'B'), expectedB[code] ?? [], `${code} 한 번 묻기`)
    assert.ok(training.trainingStatus(code, {}).requiredTotal >= 1, code)
  }
  assert.equal(training.trainingStatus('T-2-3', {}).requiredTotal, 1) // 운영의 '필수 칸 0/0'
})

// ─── TASK-T9: AI 답변 속 체크리스트를 실제로 누를 수 있게 ─────────
const checklistLib = await import('../src/lib/chat/checklist.ts')
const tChecklistText = [
  '아래 체크리스트로 점검해 볼까요?',
  '',
  '| 단계 | 핵심 점검 항목 | AI 분석 | 팀 확인 |',
  '|------|-------------|--------|--------|',
  '| T-1 비전 | 비전이 한 문장인가? | ✅ | ☐ |',
  '| T-2 방향 | 원칙이 3개 이상인가? | ⚠️ (1개) | □ |',
  '| T-5 일정 | 일정 공유? | ☐ 확인 필요 | ☑ |',
  '',
  '- [ ] 회의록 공유',
  '- [x] 역할표 저장',
  '문장 속 [ ] 체크와 [링크](https://a.b) 는 다르게',
  '```',
  '| 코드 | ☐ |',
  '- [ ] 코드 안',
  '```',
  '`[ ]` 인라인 코드는 그대로',
].join('\n')

test('T16a: 체크박스 순번 — 표 칸의 단독 ☐·□·☑, 작업 목록, 문장 속 [ ]; 코드·설명 글 속 기호·링크는 제외', () => {
  const { markdown, count, defaults } = checklistLib.prepareChecklistMarkdown(tChecklistText)
  assert.equal(count, 6)
  assert.deepEqual([...defaults], [false, false, true, false, true, false])
  assert.match(markdown, /\| T-1 비전 \| 비전이 한 문장인가\? \| ✅ \| `⟦체크:0:0⟧` \|/) // AI 분석 칸의 ✅ 는 그대로
  assert.match(markdown, /\| T-2 방향 \| 원칙이 3개 이상인가\? \| ⚠️ \(1개\) \| `⟦체크:1:0⟧` \|/)
  assert.match(markdown, /\| ☐ 확인 필요 \| `⟦체크:2:1⟧` \|/) // 설명 글 속 ☐ 는 그대로
  assert.match(markdown, /- `⟦체크:3:0⟧` 회의록 공유\n- `⟦체크:4:1⟧` 역할표 저장/)
  assert.match(markdown, /문장 속 `⟦체크:5:0⟧` 체크와 \[링크\]\(https:\/\/a\.b\)/)
  assert.match(markdown, /```\n\| 코드 \| ☐ \|\n- \[ \] 코드 안\n```/)
  assert.match(markdown, /`\[ \]` 인라인 코드는 그대로/)
  // 같은 글이면 같은 순번(안정적)
  assert.equal(checklistLib.prepareChecklistMarkdown(tChecklistText).markdown, markdown)
  assert.deepEqual(checklistLib.parseChecklistMark('⟦체크:4:1⟧'), { index: 4, defaultChecked: true })
  assert.equal(checklistLib.parseChecklistMark('일반 코드'), null)
})

test('T16b: 저장 상태가 원문 기본값보다 우선하고, 모두 체크되면 안내', () => {
  const none = checklistLib.checklistProgress(tChecklistText, {})
  assert.deepEqual({ ...none }, { total: 6, checked: 2, allChecked: false })
  const state = Object.fromEntries([0, 1, 3, 5].map(i => [String(i), { checked: true, by: '캔바1' }]))
  assert.equal(checklistLib.checklistProgress(tChecklistText, state).allChecked, true)
  assert.equal(checklistLib.checklistProgress(tChecklistText, { ...state, 2: { checked: false, by: '홍성용' } }).allChecked, false) // 다시 누르면 해제
  assert.equal(checklistLib.checklistProgress('체크리스트 없음', {}).allChecked, false)
  assert.equal(checklistLib.CHECKLIST_ALL_DONE_NOTE, '모든 항목을 확인했어요. 다음 단계로 넘어갈 준비가 됐습니다.')
})

test('T16c: 상태 저장 경로 — 메시지 문서의 checklistState.순번 필드만, 레거시 메시지는 단계 경로', () => {
  assert.equal(checklistLib.messageDocPath('p1', { id: 'm1', activityCode: 'T-2-3' }, 'T'), 'projects/p1/conversations/T-2-3/messages/m1')
  assert.equal(checklistLib.messageDocPath('p1', { id: 'm1', activityCode: 'T-2-3', legacyPath: true }, 'T'), 'projects/p1/conversations/T/messages/m1')
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  assert.match(projects, /updateDoc\(doc\(db, path\), \{ \[`checklistState\.\$\{index\}`\]: \{ checked, by, at: serverTimestamp\(\) \} \}\)/)
  assert.match(projects, /\.map\(d => \(\{ id: d\.id, \.\.\.d\.data\(\), legacyPath: true \}\) as Message\)/)
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /replaceMessage\(msg\.id, msg\.content, \{ checklistState: \{ \.\.\.msg\.checklistState, \[String\(index\)\]: \{ checked, by \} \} \}\)/)
  assert.match(panel, /checklist=\{msg\.role === 'assistant' \? \{/)
})

test('T16d: 렌더 — 진짜 체크박스, 저장 상태·체크한 사람 이름, canEdit=false 면 읽기 전용', () => {
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(chatSource, /function ChecklistBox\(/)
  const { MarkdownContent } = loadArtifactTsx('../src/components/chat/ChatPanel.tsx', {
    'react-markdown': { __esModule: true, default: ReactMarkdown },
    REMARK_PLUGINS, ReactMarkdown, cn: (...c) => c.filter(Boolean).join(' '),
    markdownHeadingComponents: {}, HighlightedStrong: ({ children }) => React.createElement('strong', null, children),
    INTERNAL_ACTIVITY_CODE_RE: /$^/g, displayActivityCode: c => c, splitGuideLines: () => null,
    childrenToText: () => '', prepareChecklistMarkdown: checklistLib.prepareChecklistMarkdown, parseChecklistMark: checklistLib.parseChecklistMark,
  }, ['MarkdownContent', 'ChecklistBox'])
  const state = { 0: { checked: true, by: '캔바1' }, 4: { checked: false, by: '홍성용' } }
  const html = renderToStaticMarkup(React.createElement(MarkdownContent, { text: tChecklistText, checklist: { state, canEdit: true, onToggle() {} } }))
  const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map(m => m[0])
  assert.equal(boxes.length, 6)
  assert.deepEqual(boxes.map(b => b.includes('checked=""')), [true, false, true, false, false, false])
  assert.ok(boxes.every(b => !b.includes('disabled=""')))
  assert.match(html, /<span[^>]*>캔바1<\/span>/)
  assert.doesNotMatch(html, /홍성용/) // 해제한 칸은 이름 숨김
  assert.doesNotMatch(html, /⟦체크/)
  const readOnly = renderToStaticMarkup(React.createElement(MarkdownContent, { text: tChecklistText, checklist: { state, canEdit: false, onToggle() {} } }))
  assert.ok([...readOnly.matchAll(/<input type="checkbox"[^>]*>/g)].every(m => m[0].includes('disabled=""')))
  const plain = renderToStaticMarkup(React.createElement(MarkdownContent, { text: tChecklistText }))
  // 체크리스트 연결이 없으면 기존 렌더 그대로(표의 ☐ 는 글자, GFM 작업 목록은 원래처럼 누를 수 없는 표시)
  assert.match(plain, />☐<\/td>/)
  assert.ok([...plain.matchAll(/<input type="checkbox"[^>]*>/g)].every(m => m[0].includes('disabled=""')))
  assert.doesNotMatch(plain, /⟦체크/)
})

test('T16e: 프롬프트 — 단계 종료 체크리스트의 팀 확인 칸은 ☐ 한 글자(일반·solo·연수용)', () => {
  const project = { title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: [], mode: 'collaborative', isA23Completed: false, currentCycle: 1 }
  const team = buildSystemPrompt('T', 'T-2-3', project, '팀+AI', undefined, null, undefined, {}, undefined)
  assert.match(team, /\*\*팀 확인\*\* 칸에는 '☐' 한 글자만 쓴다/)
  assert.equal((team.match(/\| ☐ \|/g) ?? []).length, 13)
  assert.doesNotMatch(team, /\| □ \|/)
  const solo = buildSystemPrompt('T', 'T-2-3', { ...project, mode: 'solo' }, '개인+AI', undefined, null, undefined, {}, undefined)
  assert.match(solo, /확인 칸에는 '☐' 한 글자만/)
  assert.doesNotMatch(solo, /\| □ \|/)
  const training = buildSystemPrompt('T', 'T-2-3', { ...project, trainingMode: { enabled: true, coreFormal: true } }, '팀+AI', undefined, null, undefined, {}, undefined)
  assert.match(training, /연수용 약식 진행 규칙/)
  assert.match(training, /\*\*팀 확인\*\* 칸에는 '☐' 한 글자만 쓴다/)
})

// ─── TASK-T7b: '+ 행'·'+ 열' 회귀 — 비어 있는 서버 저장본에서 새 행·열이 사라지던 결함 ─────────
const { isBlankWorkspace: t7bIsBlank } = await import('../src/lib/coedit/workspaceBlank.ts')
function loadModalInternals(file) {
  const source = fs.readFileSync(new URL(`../src/components/artifacts/${file}`, import.meta.url), 'utf8')
    + '\nexports.__normalize = normalizeWorkspace; exports.__preserve = preserveEditingValue; exports.__emptyRow = emptyRow;'
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const stub = new Proxy(function () {}, { get: (_t, key) => key === '__esModule' ? true : key === Symbol.toPrimitive ? () => '' : stub, apply: () => stub, construct: () => stub })
  const real = { react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/coedit/workspaceBlank': { isBlankWorkspace: t7bIsBlank } }
  const context = { exports: {}, require: name => real[name] ?? stub, console, Math, Date, JSON, Object, Array, Set, Map, String, Number }
  vm.runInNewContext(compiled, context)
  return context.exports
}
const t7bModals = fs.readdirSync(new URL('../src/components/artifacts/', import.meta.url)).filter(f => f.endsWith('WorkspaceModal.tsx') && f !== 'CoeditWorkspaceModal.tsx')

function t7bFlow(m, { saved, artifact, structural }) {
  const runner = makeHookRunner()
  const hook = loadArtifactTsx('../src/components/artifacts/useWorkspaceSync.ts', { react: runner.fakeReact, setTimeout, clearTimeout })
  let ws = m.__normalize(saved, artifact)
  const setWorkspace = update => { ws = update(ws) }
  const props = (incoming, remote) => ({ open: true, incoming, workspace: ws, setWorkspace, editingKey: null, remoteBlank: t7bIsBlank(remote), preserve: (n, c, k) => m.__preserve(n, c, k, new Set()) })
  let sync = runner.render(hook.useWorkspaceSync, props(ws, saved))
  const { patch, next } = structural(ws)
  ws = next // commit: 로컬 즉시 반영
  const prepared = sync.prepare(patch, next)
  // 서버: replace-all 이면 화면 표 통째, 아니면 그 구조 변경만 서버 저장본에 적용
  const server = prepared.type === 'replace-all' ? JSON.parse(JSON.stringify(prepared.workspace)) : structural(m.__normalize(saved, artifact), saved).serverApply(saved)
  sync.track(prepared, Promise.resolve(server))
  // 저장 전 옛 스냅숏 → 저장 후 새 스냅숏 → 저장 응답 반영
  sync = runner.render(hook.useWorkspaceSync, props(m.__normalize(saved, artifact), saved))
  const afterStale = ws
  sync = runner.render(hook.useWorkspaceSync, props(m.__normalize(server, artifact), server))
  sync.applySaved(m.__normalize(server, artifact))
  return { prepared, afterStale, final: ws }
}

const addRow = ws => {
  const row = { id: 'new_row', cells: Object.fromEntries(ws.columns.map(c => [c.id, ''])), color: '#FFFFFF' }
  return { patch: { type: 'add-row', row, updatedBy: '홍성용' }, next: { ...ws, rows: [...ws.rows, row] }, serverApply: saved => ({ ...saved, rows: [...(saved?.rows ?? []), row] }) }
}
const addColumn = ws => {
  const column = { id: 'new_col', label: '새 열', color: '#E8F0FE' }
  return {
    patch: { type: 'add-column', column, updatedBy: '홍성용' },
    next: { ...ws, columns: [...ws.columns, column], rows: ws.rows.map(r => ({ ...r, cells: { ...r.cells, new_col: '' } })) },
    serverApply: saved => ({ ...saved, columns: [...(saved?.columns ?? []), column], rows: (saved?.rows ?? []).map(r => ({ ...r, cells: { ...r.cells, new_col: '' } })) }),
  }
}

test('T7b-1: 12개 공동 편집 창 — 빈 서버 저장본에서 + 행·+ 열 이 사라지지 않는다(연수용 양식 원문·빈 초안)', () => {
  assert.equal(t7bModals.length, 12)
  for (const file of t7bModals) {
    const m = loadModalInternals(file)
    for (const artifact of [undefined, { '역할 배분': '연수 양식 원문 문자열' }]) {
      const row = t7bFlow(m, { saved: undefined, artifact, structural: addRow })
      assert.equal(row.prepared.type, 'replace-all', `${file} 빈 서버면 통째 저장`)
      assert.ok(row.afterStale.rows.some(r => r.id === 'new_row'), `${file} 옛 스냅숏 뒤에도 새 행`)
      assert.ok(row.final.rows.some(r => r.id === 'new_row'), `${file} 저장 뒤에도 새 행`)
      const col = t7bFlow(m, { saved: undefined, artifact, structural: addColumn })
      assert.ok(col.final.columns.some(c => c.id === 'new_col'), `${file} 새 열`)
    }
  }
})

test('T7b-2: 일반 프로젝트(내용 있는 저장본) — + 행 은 add-row 그대로 보내고, 저장 전 옛 스냅숏이 와도 새 행 유지', () => {
  for (const file of t7bModals) {
    const m = loadModalInternals(file)
    const base = m.__normalize(undefined, undefined)
    const filledRow = { id: 'filled', cells: Object.fromEntries(base.columns.map(c => [c.id, '내용'])), color: '#FFFFFF' }
    const saved = { ...base, rows: [filledRow] }
    assert.equal(t7bIsBlank(saved), false, file)
    const row = t7bFlow(m, { saved, artifact: undefined, structural: addRow })
    assert.equal(row.prepared.type, 'add-row', file)
    assert.equal(row.afterStale.rows.map(r => r.id).join(','), 'filled,new_row', `${file} 옛 스냅숏`)
    assert.equal(row.final.rows.map(r => r.id).join(','), 'filled,new_row', `${file} 저장 뒤`)
  }
})

test('T7b-3: 산출물에서 채워 연 표(T-3 역할 배분) — 새 행과 기존 행이 함께 저장되고 남는다', () => {
  const m = loadModalInternals('RoleDistributionWorkspaceModal.tsx')
  const artifact = { _schema: 'T-2-1', roles: [{ teacherName: '홍성용', subject: '국어', strengths: '기록', role: '진행', responsibilities: '회의록', deadline: '10/9' }] }
  const row = t7bFlow(m, { saved: undefined, artifact, structural: addRow })
  assert.equal(row.prepared.type, 'replace-all')
  assert.equal(row.prepared.workspace.rows.length, 2)
  assert.equal(row.final.rows.length, 2)
  assert.equal(row.final.rows[0].cells.teacherName, '홍성용')
  assert.equal(row.final.rows[1].id, 'new_row')
})

test('T7b-4: 구조 변경 보호 — 반영 확인 전엔 지키고, 서버에 보이면 해제(삭제도 같은 규칙)', () => {
  const lib = loadArtifactTsx('../src/components/artifacts/useWorkspaceSync.ts', { react: makeHookRunner().fakeReact, setTimeout, clearTimeout })
  const cur = { columns: [{ id: 'a' }], rows: [{ id: 'r1', cells: { a: '1' } }, { id: 'r2', cells: { a: '' } }] }
  const stale = { columns: [{ id: 'a' }], rows: [{ id: 'r1', cells: { a: '1' } }, { id: 'gone', cells: { a: 'x' } }] }
  const { next, confirmed } = lib.applyStructuralChanges(stale, cur, ['row+:r2', 'row-:gone'])
  assert.equal(next.rows.map(r => r.id).join(','), 'r1,r2')
  assert.equal(confirmed.length, 0)
  const done = lib.applyStructuralChanges({ columns: [{ id: 'a' }], rows: [{ id: 'r1', cells: {} }, { id: 'r2', cells: {} }] }, cur, ['row+:r2', 'row-:gone'])
  assert.equal([...done.confirmed].sort().join(','), 'row+:r2,row-:gone')
  assert.equal(lib.structuralKeysOfPatch({ type: 'add-column', column: { id: 'c9' } }).join(','), 'col+:c9')
  assert.equal(lib.prepareWorkspacePatch({ type: 'update-cell' }, { rows: [] }, false).type, 'update-cell')
  assert.equal(lib.prepareWorkspacePatch({ type: 'update-cell', updatedBy: 'a' }, { rows: [] }, true).type, 'replace-all')
})

// ─── TASK-T4b: 연수용 첫 안내가 실제 이동 경로마다 나오는지 · 버튼 요청 칩 ─────────
function runWelcomeEffect({ project, currentActivity }) {
  let welcomeEffect
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes('showWelcomeMessage(welcome)')) welcomeEffect = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const source = ts.transpileModule(`exports.fn = ${welcomeEffect.getText(tree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  let shown = null
  const context = {
    exports: {}, project, proj: project, currentActivity, messagesLoaded: true, messages: [], messagesLoadedByFallback: false,
    userProfile: { uid: 'host' }, ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME, shouldCreateWelcomeMessage: () => true,
    isTrainingActivity: training.isTrainingActivity, buildTrainingWelcome: training.buildTrainingWelcome,
    showWelcomeMessage: text => { shown = text },
  }
  vm.runInNewContext(source, context)
  context.exports.fn()
  return shown
}

test('T17: 연수용 비핵심 활동은 어떤 경로로 들어가도 고정 첫 안내, 핵심·일반은 기존 환영', () => {
  const base = { started: true, hostUid: 'host', mode: 'collaborative', currentCycle: 1, artifacts: {} }
  const on = { ...base, trainingMode: { enabled: true, coreFormal: true } }
  for (const code of ['T-2-1', 'T-2-2', 'T-2-3', 'A-1-1', 'A-2-3', 'Ds-1-1', 'DI-2-1', 'E-2-1']) {
    const shown = runWelcomeEffect({ project: on, currentActivity: code })
    assert.equal(shown, training.buildTrainingWelcome(code), code)
    assert.doesNotMatch(shown, /오늘 함께할 순서/, code)
  }
  assert.equal(runWelcomeEffect({ project: on, currentActivity: 'T-1-2' }), ACTIVITY_WELCOME['T-1-2']) // 핵심 절차
  assert.equal(runWelcomeEffect({ project: base, currentActivity: 'T-2-2' }), ACTIVITY_WELCOME['T-2-2']) // 일반 프로젝트
  const soloAll = { ...base, mode: 'solo', trainingMode: { enabled: true, coreFormal: false } }
  assert.equal(runWelcomeEffect({ project: soloAll, currentActivity: 'T-1-1' }), training.buildTrainingWelcome('T-1-1'))
  // 이동 경로(사이드바·다음 활동·단계 이동 창·방장 동기화)는 모두 currentActivity 만 바꾸고, 환영은 이 effect 하나가 만든다.
  const sources = {
    sidebar: fs.readFileSync(new URL('../src/components/activity/ActivitySidebar.tsx', import.meta.url), 'utf8'),
    stageMove: fs.readFileSync(new URL('../src/components/modals/StageMoveModal.tsx', import.meta.url), 'utf8'),
    page: fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8'),
    chat: fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8'),
  }
  assert.match(sources.sidebar, /setCurrentActivity\(code\)/)
  assert.match(sources.stageMove, /setCurrentActivity\(firstActivity\)/)
  assert.match(sources.page, /setCurrentActivity\(project\.currentActivity\)/)
  assert.match(sources.chat, /setCurrentActivity\(nextActivity\)/)
  for (const [name, src] of Object.entries(sources)) {
    if (name !== 'chat') assert.doesNotMatch(src, /ACTIVITY_WELCOME|welcome-\$\{/, name)
  }
  assert.equal((sources.chat.match(/showWelcomeMessage\(/g) ?? []).length, 1 + 1) // 정의 1 + 호출 1
  assert.equal((sources.chat.match(/(?<!SOLO_)ACTIVITY_WELCOME\[currentActivity\]/g) ?? []).length, 1)
})

test('T18: AI 도움·단계별 진행 요청도 교사 말풍선 대신 작은 칩(저장 형식 그대로)', () => {
  const help = training.formatTrainingHelpRequest(training.TRAINING_ACTIVITIES['T-2-2'].help[0])
  assert.equal(training.trainingMessageChip(help, '홍성용'), 'AI 도움 요청 · 갈등 규칙 예시 · 홍성용')
  assert.equal(training.trainingMessageChip('[단계별로 함께 진행]', '홍성용'), '단계별 진행 요청 · 홍성용')
  assert.equal(training.trainingMessageChip(`${training.formatTrainingSaveNotice('T-2-1')} 조언해 주세요`, '캔바1'), 'T-3 역할 배분 양식을 저장했어요 · 캔바1')
  assert.equal(training.trainingMessageChip('[단계별로 함께 진행] 해 주세요'), null) // 교사가 직접 친 말은 말풍선
  assert.equal(training.trainingMessageChip('조언해 주세요', '홍성용'), null)
  assert.equal(training.trainingMessageChip('[답장: "규칙"]\n[AI 도움: 갈등 규칙 예시] 예시'), 'AI 도움 요청 · 갈등 규칙 예시')
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /data-testid=\{isSaveChip \? 'training-save-chip' : 'training-request-chip'\}/)
})

// ─── TASK-T4c: 환영 표시 보장·생성 타이밍·새 버전 감지 ─────────
test('T19a: 연수용 약식 활동의 환영 메시지는 저장 내용과 무관하게 고정 첫 안내로 그린다(저장 데이터 불변)', () => {
  const on = { trainingMode: { enabled: true, coreFormal: true } }
  const general = { id: 'welcome-1-A-1-1', role: 'assistant', content: ACTIVITY_WELCOME['A-1-1'], activityCode: 'A-1-1' }
  const before = structuredClone(general)
  assert.equal(training.displayedMessageContent(on, general, []), training.buildTrainingWelcome('A-1-1'))
  assert.deepEqual(general, before)
  assert.equal(training.displayedMessageContent({}, general, []), general.content) // 연수용 꺼짐
  assert.equal(training.displayedMessageContent(on, { ...general, id: 'welcome-1-T-1-2', activityCode: 'T-1-2' }, []), general.content) // 핵심 절차
  assert.equal(training.displayedMessageContent(on, general, ['[단계별로 함께 진행]']), general.content) // 단계별 진행 중
  assert.equal(training.displayedMessageContent(on, general, ['[단계별로 함께 진행]', '직접 적을게요']), training.buildTrainingWelcome('A-1-1'))
  assert.equal(training.displayedMessageContent(on, { ...general, id: 'abc' }, []), general.content) // 환영이 아닌 메시지
  assert.equal(training.displayedMessageContent(on, { ...general, role: 'user' }, []), general.content)
  assert.equal(training.displayedMessageContent({ trainingMode: { enabled: true, coreFormal: false } }, { ...general, id: 'welcome-1-T-1-1', activityCode: 'T-1-1' }, []), training.buildTrainingWelcome('T-1-1'))
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /content=\{displayedMessageContent\(proj, msg, trainingUserTexts\)\}/)
  // AI 에게 보내는 대화 기록도 같은 내용(일반 절차로 끌려가지 않게)
  assert.equal((panel.match(/content: displayedMessageContent\(proj, m, trainingUserTexts\)/g) ?? []).length, 2)
})

test('T19b: 생성 타이밍 — 환영 effect 는 프로젝트 스냅숏(started)을 받은 뒤에만 돌고, 그 스냅숏은 trainingMode 를 함께 담는다', () => {
  // started 없는(미도착) 프로젝트로는 환영을 만들지 않는다
  assert.equal(runWelcomeEffect({ project: { hostUid: 'host', mode: 'collaborative', currentCycle: 1, artifacts: {} }, currentActivity: 'A-1-1' }), null)
  // 스냅숏이 도착한 상태면 단계 이동 직후 첫 실행에서도 연수용 안내
  const snap = { started: true, hostUid: 'host', mode: 'collaborative', currentCycle: 1, artifacts: {}, currentStage: 'A', currentActivity: 'A-1-1', trainingMode: { enabled: true, coreFormal: true } }
  assert.equal(runWelcomeEffect({ project: snap, currentActivity: 'A-1-1' }), training.buildTrainingWelcome('A-1-1'))
  const projects = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  assert.match(projects, /callback\(\{ id: snap\.id, \.\.\.snap\.data\(\) \} as Project\)/) // 문서 전체(trainingMode 포함)
  const page = fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8')
  assert.equal((page.match(/setProject\(p\)/g) ?? []).length, 1) // 프로젝트는 스냅숏으로만 바뀐다(부분 객체로 덮지 않음)
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /useEffect\(\(\) => \{\n    if \(!project\?\.started\) return\n    if \(!messagesLoaded\) return/)
})

test('T19c: 새 버전 감지 — 빌드 도장이 서버와 다르면 작은 안내, 누르면 새로고침(자동 새로고침 없음)', async () => {
  const v = await import('../src/lib/version/buildVersion.ts')
  assert.equal(v.isNewBuildAvailable('2026-10-04T01', '2026-10-04T02'), true)
  assert.equal(v.isNewBuildAvailable('2026-10-04T01', '2026-10-04T01'), false)
  assert.equal(v.isNewBuildAvailable('', '2026-10-04T02'), false)
  assert.equal(v.isNewBuildAvailable('a', undefined), false)
  assert.equal(v.BUILD_CHECK_INTERVAL_MS, 300000)
  const config = fs.readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8')
  assert.match(config, /env: \{ NEXT_PUBLIC_BUILD_STAMP: BUILD_STAMP \}/)
  const route = fs.readFileSync(new URL('../src/app/api/version/route.ts', import.meta.url), 'utf8')
  assert.match(route, /'Cache-Control': 'no-store, max-age=0'/)
  assert.match(route, /export const dynamic = 'force-dynamic'/)
  const banner = fs.readFileSync(new URL('../src/components/layout/UpdateAvailableBanner.tsx', import.meta.url), 'utf8')
  assert.match(banner, /새 버전이 있어요 — 새로고침/)
  assert.match(banner, /onClick=\{\(\) => window\.location\.reload\(\)\}/)
  assert.equal((banner.match(/location\.reload/g) ?? []).length, 1)
  assert.match(banner, /window\.addEventListener\('focus', check\)/)
  const layout = fs.readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /<UpdateAvailableBanner \/>/)
})

// ─── TASK-T10: 교사 메시지 유실 — AI 답하는 중 Enter·저장 실패 ─────────
function t10Bindings(overrides = {}) {
  const calls = { enqueued: [], inputs: [], added: [], saved: [], errors: [], streamed: 0 }
  const bindings = {
    input: '아 생각해 보니 모둠에서 기준을 정해 왔어요. 직접 적을게요.', project: { id: 'p' }, proj: { id: 'p', currentCycle: 1 },
    sendBlockReason: null, isLoading: false, isTeamMode: false, isWaitingForChoice: false, replyTo: null,
    currentActivity: 'A-1-1', userProfile: { uid: 'host', displayName: '홍성용' }, messages: [], isHost: true, lastAIMsg: null,
    enqueueTrainingSend: text => calls.enqueued.push(text),
    setInput: value => calls.inputs.push(typeof value === 'function' ? value('') : value),
    setReplyTo() {}, setFlowNotice() {}, setPendingAdvance() {}, setPendingTeamDiscussion() {}, setIsIdle() {},
    setChatError: value => calls.errors.push(value), setFailedChatRequest() {}, hasDeferredDecision: () => false,
    generateMessageId: () => 'm1', Timestamp: { now: () => 1 },
    addMessage: m => calls.added.push(m), saveMessage: async (...args) => { calls.saved.push(args) },
    handleA21SheetArtifactRequest: () => false, closeOptionChoice: async () => {},
    setIsLoading() {}, clearStreamingText() {}, streamingAccumRef: { current: '' }, streamingFlushRef: { current: null },
    setStreamingState: async () => {}, clearStreamingState: async () => {}, setInterval: () => 1, clearInterval() {},
    streamFromAPI: async () => { calls.streamed++ }, console: { error() {}, warn() {} },
    displayedMessageContent: (_p, m) => m.content, trainingUserTexts: [],
    ...overrides,
  }
  return { bindings, calls }
}

test('T20a: AI 가 답하는 중 Enter — 버리지 않고 대기열에 넣고(보내는 중) 입력창을 비운다', async () => {
  const { bindings, calls } = t10Bindings({ isLoading: true })
  await loadChatFunction('handleSend', bindings)()
  assert.deepEqual(calls.enqueued, ['아 생각해 보니 모둠에서 기준을 정해 왔어요. 직접 적을게요.'])
  assert.deepEqual(calls.inputs, [''])
  assert.equal(calls.added.length, 0) // 대기열이 답 끝난 뒤 sendMessageDirectly 로 추가·저장
  assert.equal(calls.streamed, 0)
  // 준비 전(sendBlockReason)이면 입력을 그대로 둔다
  const blocked = t10Bindings({ sendBlockReason: 'loading' })
  await loadChatFunction('handleSend', blocked.bindings)()
  assert.equal(blocked.calls.inputs.length + blocked.calls.enqueued.length, 0)
  // 팀 채팅 중에는 AI 와 무관하게 바로 저장(기존 동작)
  const team = t10Bindings({ isLoading: true, isTeamMode: true })
  await loadChatFunction('handleSend', team.bindings)()
  assert.equal(team.calls.added.length, 1)
})

test('T20b: 저장 실패 시 알리고 입력한 글을 입력창에 되돌린다(조용히 사라지지 않음)', async () => {
  const { bindings, calls } = t10Bindings({ saveMessage: async () => { throw new Error('offline') } })
  await loadChatFunction('handleSend', bindings)()
  await new Promise(r => setTimeout(r, 0))
  assert.equal(calls.added.length, 1)
  assert.match(calls.errors.at(-1), /메시지를 저장하지 못했어요/)
  assert.equal(calls.inputs.at(-1), '아 생각해 보니 모둠에서 기준을 정해 왔어요. 직접 적을게요.')
})

test('T20c: 대기열은 화면에 보내는 중으로 보이고 답이 끝나면 순서대로 보낸다 · 직접 적을게요로 약식 복귀', () => {
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /queuedSends\.map\(\(text, index\) =>/)
  assert.match(panel, /보내는 중…/)
  assert.match(panel, /const next = trainingQueueRef\.current\.shift\(\)\n    if \(!next\) return\n    setQueuedSends\(\[\.\.\.trainingQueueRef\.current\]\)/)
  const texts = ['[단계별로 함께 진행]', '아 생각해 보니 모둠에서 기준을 정해 왔어요. 직접 적을게요.']
  assert.equal(training.isStepByStepActive(texts.slice(0, 1)), true)
  assert.equal(training.isStepByStepActive(texts), false) // 교사 문장 속 '직접 적을게요'로 약식 복귀
  const on = { title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: [], mode: 'collaborative', isA23Completed: false, currentCycle: 1, trainingMode: { enabled: true, coreFormal: true } }
  const back = buildSystemPrompt('A', 'A-1-1', on, '팀+AI', undefined, null, undefined, {}, undefined, { trainingStepByStep: training.isStepByStepActive(texts) })
  assert.match(back, /연수용 약식 진행 규칙/)
  const welcome = { id: 'welcome-1-A-1-1', role: 'assistant', content: '일반 환영', activityCode: 'A-1-1' }
  assert.equal(training.displayedMessageContent(on, welcome, texts), training.buildTrainingWelcome('A-1-1'))
})

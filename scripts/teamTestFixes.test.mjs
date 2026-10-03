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
import { serializeArtifactForPrompt } from '../src/lib/artifacts/serializeArtifactForPrompt.ts'
import { validateProblemStandards } from '../src/lib/problem-situation/validateStandards.ts'
import { withCurriculumReadCache, readOncePerCurriculumContext } from '../src/lib/curriculum/readCache.ts'
import { buildCurriculumContext, buildReplacementStandardsContext } from '../src/lib/curriculum/contextInject.ts'
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
    parseArtifactUpdates: text => ({ updates: [], cleanText: text }), parseHelpCard: text => ({ cleanText: text }),
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
      userProfile: { uid: 'host' }, ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME, shouldCreateWelcomeMessage,
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
  assert.match(projects, /if \(!ready\.activity \|\| !ready\.legacy\) return/)
  assert.match(projects, /if \(existing\.exists\(\)\) return false/)
  const chatSource = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(chatSource, /saveMessageIfAbsent\(proj\.id, currentActivity, \{/)
})

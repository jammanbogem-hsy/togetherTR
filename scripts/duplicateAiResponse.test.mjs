// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/duplicateAiResponse.test.mjs
// 2026-10-08 결함: 팀원이 채팅하니 AI 응답이 2개.
//  (가) 다른 선생님 질문에 AI 가 답하는 중(remote busy)에 보내면 내 클라이언트도 AI 를 불러 실제 2회 호출·저장
//  (나) 저장 ack 뒤 따로 '응답 중' 표시를 지워 다른 화면에 최종 답 + 진행 중 말풍선이 겹침(저장 실패면 3분 잔존)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as presenceThrottle from '../src/lib/coedit/presenceThrottle.ts'
import * as presenceOwner from '../src/lib/coedit/presenceOwner.ts'

const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function loadChatFunction(name, bindings) {
  let found
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit) }
  visit(tree)
  const source = ts.transpileModule(`exports.fn = ${found.getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {}, ...bindings }
  vm.runInNewContext(source, context)
  return context.exports.fn
}

// 공유 Firestore 흉내 — 메시지·스트리밍 상태
function sharedServer() { return { messages: [], streaming: new Map(), apiCalls: [], saves: [] } }
function client(server, uid, isHost, input, extra = {}) {
  const local = { isLoading: false, enqueued: [], notices: [], added: [], replaced: [] }
  const bindings = {
    input, project: { id: 'p' }, proj: { id: 'p', currentCycle: 1 }, sendBlockReason: null, pendingFiles: [], attaching: false, withAttachmentContext: content => content,
    get isLoading() { return local.isLoading }, isAnalyzing: false, isTeamMode: false, isWaitingForChoice: false, replyTo: null,
    currentActivity: 'A-2-2', userProfile: { uid, displayName: uid }, isHost, lastAIMsg: null,
    get messages() { return [...server.messages] },
    // 화면에서 계산하는 값과 같은 정의: 다른 사람 스트리밍이 있고 그 답이 아직 도착하지 않음
    get remoteBusy() {
      return [...server.streaming.entries()].some(([sender, state]) => sender !== uid && !server.messages.some(m => m.id === state.responseMessageId))
    },
    enqueueTrainingSend: text => local.enqueued.push(text), setInput() {}, setReplyTo() {}, setFlowNotice: text => local.notices.push(text),
    setPendingAdvance() {}, setPendingTeamDiscussion() {}, setIsIdle() {}, setChatError() {}, setFailedChatRequest() {}, hasDeferredDecision: () => false,
    generateMessageId: () => `${uid}-msg-${server.messages.length + server.apiCalls.length}`, Timestamp: { now: () => 1 },
    addMessage: m => local.added.push(m), replaceMessage: (...args) => local.replaced.push(args),
    saveMessage: async (_p, _a, m, id) => { server.messages.push({ ...m, id }) },
    saveAssistantMessageAndClearStreaming: async (_p, _a, m, id, sender) => {
      server.saves.push(id); server.messages.push({ ...m, id }); server.streaming.delete(sender); return id
    },
    handleA21SheetArtifactRequest: () => false, handleTrainingNextRequest: async () => false, closeOptionChoice: async () => {},
    setIsLoading: v => { local.isLoading = v }, clearStreamingText() {}, streamingAccumRef: { current: '' }, streamingFlushRef: { current: null },
    setStreamingState: async (_p, _a, text, sender, responseMessageId) => { server.streaming.set(sender, { text, responseMessageId }) },
    clearStreamingState: async (_p, _a, sender) => { server.streaming.delete(sender) },
    setInterval: () => 1, clearInterval() {}, console: { error() {}, warn() {}, log() {} },
    displayedMessageContent: (_p, m) => m.content, trainingUserTexts: [],
    classifyMemberCommand: () => ({ kind: 'none' }), setMemberCommand() {}, isMoveRequest: () => false, MOVE_NEEDS_RECORDER: '',
    ...extra,
  }
  bindings.chatDraft = { getSnapshot: () => ({ input: bindings.input }) }
  return { local, bindings }
}

test('(가) RED→GREEN: 다른 선생님 답이 진행 중이면 팀원 전송은 대기열로 가고 AI 는 한 번만 불린다', async () => {
  const server = sharedServer()
  let releaseA
  const A = client(server, 'host', true, 'A-4 목표 문장 다듬어 주세요', {
    streamFromAPI: async messages => { server.apiCalls.push({ uid: 'host', sees: messages.length }); await new Promise(r => { releaseA = r }) },
  })
  const B = client(server, 'member', false, '팀원 제안해 주세요', {
    streamFromAPI: async () => { server.apiCalls.push({ uid: 'member' }) },
  })
  const sendA = loadChatFunction('handleSend', A.bindings)()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(B.bindings.remoteBusy, true, 'B 화면: 다른 선생님 질문에 답하는 중')
  await loadChatFunction('handleSend', B.bindings)()
  assert.deepEqual(server.apiCalls.map(call => call.uid), ['host'], '고치기 전에는 [host, member] — AI 2회 호출')
  assert.deepEqual(B.local.enqueued, ['팀원 제안해 주세요'])
  assert.match(B.local.notices.at(-1), /다른 선생님 질문에 AI가 답하는 중/)
  releaseA(); await sendA
})

test('(가) 선택지·직접 전송(sendMessageDirectly)도 remote busy 면 대기열, 재시도는 그대로', async () => {
  const server = sharedServer()
  server.streaming.set('host', { text: '', responseMessageId: 'host-ans' })
  const B = client(server, 'member', false, '', { streamFromAPI: async () => { server.apiCalls.push({ uid: 'member' }) }, getRetryRequest: () => null })
  await loadChatFunction('sendMessageDirectly', B.bindings)('A안 선택')
  assert.equal(server.apiCalls.length, 0)
  assert.deepEqual(B.local.enqueued, ['A안 선택'])
  // 그 답이 이미 저장됐으면(remote 표시가 남아 있어도) 막지 않는다
  server.messages.push({ id: 'host-ans', role: 'assistant', content: '답' })
  assert.equal(B.bindings.remoteBusy, false)
})

test('(나) 저장할 답 id 를 미리 정해 스트리밍 상태에 싣고, 같은 id 로 저장하며 저장·표시 삭제를 한 번에 한다', async () => {
  const server = sharedServer()
  const A = client(server, 'host', true, '질문', {
    streamFromAPI: async (_messages, _chunk, onDone) => {
      assert.equal(server.streaming.get('host').responseMessageId, 'host-msg-1', '시작부터 저장될 id 공유')
      // onDone 은 많은 의존성을 쓰므로 여기서는 계약만 확인한다(id·교체 여부는 아래 소스 검사)
      void onDone
    },
  })
  await loadChatFunction('handleSend', A.bindings)()
  assert.match(chat, /const plannedAssistantMessageId = generateMessageId\(proj\.id, currentActivity\)\n[\s\S]{0,400}setStreamingState\(proj\.id, currentActivity, '', userProfile\.uid, plannedAssistantMessageId\)/)
  assert.match(chat, /const newMsgId = plannedAssistantMessageId\n\s*responseMessageId = newMsgId/, 'handleSend: 같은 id 로 저장')
  assert.match(chat, /const newMsgId = responseMessageId \?\? plannedAssistantMessageId/, 'sendMessageDirectly: 재시도는 기존 id(덮어쓰기 계약 유지)')
  assert.match(chat, /const plannedAssistantMessageId = responseMessageId \?\? generateMessageId\(proj\.id, currentActivity\)/)
  assert.match(chat, /const replacingResponse = !!responseMessageId/, '교체 여부 판정은 그대로')
  assert.doesNotMatch(chat, /\.then\(\(\) => clearStreamingState\(proj\.id, currentActivity/, '저장 뒤 따로 지우는 경로 제거')
  assert.equal((chat.match(/saveAssistantMessageAndClearStreaming\(proj\.id, currentActivity, \{/g) ?? []).length, 3, 'handleSend·sendMessageDirectly·토의 분석')
  assert.match(chat, /\.catch\(\(err\) => \{ console\.error\(err\); setChatError\('메시지 저장에 실패했습니다/, '저장 실패 안내 유지')
})

test('(나) 받는 쪽: 그 답이 이미 도착했으면 진행 중 본문·기다림 표시를 숨기고, 대기열도 그때 다시 흐른다', () => {
  assert.match(chat, /const remoteAnswered = !!remoteResponseMessageId && messages\.some\(m => m\.id === remoteResponseMessageId\)/)
  assert.match(chat, /\{!isLoading && isRemoteLoading && !remoteAnswered && !remoteStreamingText && <AIIdleBubble \/>\}/)
  assert.match(chat, /\{!isLoading && !remoteAnswered && remoteStreamingText && \(/)
  assert.match(chat, /setRemoteResponseMessageId\(active \? states\[0\]\.responseMessageId \?\? null : null\)/)
  assert.match(chat, /if \(isLoading \|\| isAnalyzing \|\| remoteBusy \|\| !messagesLoaded\) return/)
  assert.match(chat, /\}, \[isLoading, isAnalyzing, remoteBusy, messagesLoaded, trainingQueueTick\]\)/)
  assert.match(chat, /if \(\(isLoading \|\| remoteBusy\) && !isTeamMode && !isWaitingForChoice\)/, '팀 자유 토론은 그대로')
})

// ── projects.ts 실제 함수: 원자 저장·실패 시 정리 ──
function loadProjects(firestore) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {}, console, Date, setTimeout, clearTimeout, require: name => name === 'firebase/firestore' ? firestore : name === './config' ? { db: {}, auth: {} } : name === '@/lib/coedit/presenceThrottle' ? presenceThrottle : name === '@/lib/coedit/presenceOwner' ? presenceOwner : {} }
  vm.runInNewContext(compiled, context)
  return context.exports
}
function firestoreMock({ failCommit = false } = {}) {
  const log = []
  return {
    log,
    doc: (_db, path, id) => id ? `${path}/${id}` : path,
    serverTimestamp: () => 'SERVER_TS',
    setDoc: async (path, value) => log.push(['setDoc', path, value]),
    deleteDoc: async path => log.push(['deleteDoc', path]),
    writeBatch: () => {
      const ops = []
      return {
        set: (path, value) => ops.push(['set', path, value]),
        delete: path => ops.push(['delete', path]),
        commit: async () => { if (failCommit) throw new Error('offline'); log.push(['commit', ops]) },
      }
    },
  }
}

test('saveAssistantMessageAndClearStreaming: 메시지 저장과 요청자 본인 스트리밍 삭제가 한 커밋, saveMessage 와 같은 계약', async () => {
  const fs1 = firestoreMock()
  const projects = loadProjects(fs1)
  const id = await projects.saveAssistantMessageAndClearStreaming('p', 'A-2-2', { role: 'assistant', content: '답', cycleNumber: 1, actionCard: undefined }, 'host-msg-1', 'host')
  assert.equal(id, 'host-msg-1')
  assert.equal(fs1.log.length, 1, '한 번의 커밋')
  const [, ops] = fs1.log[0]
  assert.equal(JSON.stringify(ops[0]), JSON.stringify(['set', 'projects/p/conversations/A-2-2/messages/host-msg-1', { role: 'assistant', content: '답', cycleNumber: 1, createdAt: 'SERVER_TS' }]), '경로·undefined 제거·createdAt')
  assert.equal(JSON.stringify(ops[1]), JSON.stringify(['delete', 'projects/p/streamingState/A-2-2/users/host']), '요청자 본인 것만')
  const kept = loadProjects(firestoreMock())
  const fs2 = firestoreMock(); const p2 = loadProjects(fs2)
  await p2.saveAssistantMessageAndClearStreaming('p', 'A-2-2', { role: 'assistant', content: '재시도' }, 'old-id', 'host', 'ORIGINAL_TS')
  assert.equal(fs2.log[0][1][0][2].createdAt, 'ORIGINAL_TS', '재시도 덮어쓰기는 원래 시각 유지')
  assert.ok(kept)
})

test('saveAssistantMessageAndClearStreaming: 저장 실패해도 스트리밍 표시는 지우고 오류는 다시 던진다', async () => {
  const fs3 = firestoreMock({ failCommit: true })
  const projects = loadProjects(fs3)
  await assert.rejects(projects.saveAssistantMessageAndClearStreaming('p', 'A-2-2', { role: 'assistant', content: '답' }, 'id', 'host'), /offline/)
  assert.equal(JSON.stringify(fs3.log), JSON.stringify([['deleteDoc', 'projects/p/streamingState/A-2-2/users/host']]), '3분 좀비 방지')
})

test('setStreamingState: 저장될 답 id 를 선택적으로 싣는다', async () => {
  const fs4 = firestoreMock()
  const projects = loadProjects(fs4)
  await projects.setStreamingState('p', 'A-2-2', '부분', 'host', 'host-msg-1')
  await projects.setStreamingState('p', 'A-2-2', '부분', 'host')
  assert.equal(fs4.log[0][2].responseMessageId, 'host-msg-1')
  assert.equal(Object.hasOwn(fs4.log[1][2], 'responseMessageId'), false)
})

test('리뷰 보완: 다른 선생님 답 진행 중 재시도는 막고 안내, 재시도 상태는 그대로', async () => {
  const server = sharedServer()
  server.streaming.set('host', { text: '', responseMessageId: 'host-ans' })
  const failed = { activityCode: 'A-2-2', userId: 'member', messages: [{ role: 'user', content: '원래 질문' }], assistantMessageId: 'member-old' }
  let failedState = failed
  const B = client(server, 'member', false, '', {
    streamFromAPI: async () => { server.apiCalls.push({ uid: 'member' }) },
    getRetryRequest: () => failedState, setFailedChatRequest: value => { failedState = value },
  })
  await loadChatFunction('sendMessageDirectly', B.bindings)('원래 질문', true)
  assert.equal(server.apiCalls.length, 0, '동시 AI 재호출 없음')
  assert.match(B.local.notices.at(-1), /답이 끝난 뒤 다시 시도해 주세요/)
  assert.equal(failedState, failed, '재시도 상태 유지')
})

test('리뷰 보완: sendMessageDirectly 원자 저장 실패도 안내하고 같은 답 id 로 재시도할 수 있게 남긴다', () => {
  assert.match(chat, /\}, newMsgId, userProfile\?\.uid \?\? '', replacedCreatedAt\)\n\s*\.catch\(\(err\) => \{\n\s*console\.error\(err\)\n[\s\S]{0,120}setChatError\('메시지 저장에 실패했습니다[\s\S]{0,200}setFailedChatRequest\(\{ activityCode: currentActivity, userId: userProfile\?\.uid, messages: requestMessages, assistantMessageId: newMsgId \}\)/)
})

test('리뷰 보완: 팀 토의 분석(handleEndDiscussion)도 응답 중 알림·같은 id 원자 저장·오류 시 정리', () => {
  const start = chat.indexOf('async function handleEndDiscussion()')
  const body = chat.slice(start, chat.indexOf('const isTeamMode = ', start))
  assert.match(body, /const plannedAnalysisMessageId = generateMessageId\(proj\.id, currentActivity\)\n\s*if \(userProfile\?\.uid\) setStreamingState\(proj\.id, currentActivity, '', userProfile\.uid, plannedAnalysisMessageId\)/)
  assert.match(body, /const newMsgIdAnalysis = plannedAnalysisMessageId/)
  assert.match(body, /saveAssistantMessageAndClearStreaming\(proj\.id, currentActivity, \{[\s\S]{0,400}\}, newMsgIdAnalysis, userProfile\?\.uid \?\? ''\)\.catch\(\(err\) => \{/)
  assert.match(body, /setChatError\('팀 토의 분석 중 오류가 발생했습니다[\s\S]{0,80}clearStreamingText\(\)\n\s*if \(userProfile\?\.uid\) clearStreamingState\(proj\.id, currentActivity, userProfile\.uid\)/)
  assert.doesNotMatch(body, /saveMessage\(proj\.id/, '따로 저장하는 경로 없음')
})

// 실제 대기열 소비 effect 콜백을 꺼내 실행한다.
function loadQueueDrainEffect(bindings) {
  let found
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect') {
      const fn = node.arguments[0]
      if (fn && fn.getText(tree).includes('trainingQueueRef.current.shift()')) found = fn
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, '대기열 effect')
  const source = ts.transpileModule(`exports.fn = ${found.getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {}, ...bindings }
  vm.runInNewContext(source, context)
  return context.exports.fn
}

test('통합: A 답이 저장된 뒤 대기열이 B 메시지를 정확히 1번 보내고, B 요청에는 A 답이 들어 있다', async () => {
  const server = sharedServer()
  let releaseA
  const A = client(server, 'host', true, 'A-4 목표 문장 다듬어 주세요', {
    streamFromAPI: async () => { server.apiCalls.push({ uid: 'host' }); await new Promise(r => { releaseA = r }) },
  })
  const bRequests = []
  const queue = { current: [] }
  const B = client(server, 'member', false, '팀원 제안해 주세요', {
    streamFromAPI: async messages => { server.apiCalls.push({ uid: 'member' }); bRequests.push(messages.map(m => m.content)) },
    enqueueTrainingSend: text => queue.current.push(text),
    getRetryRequest: () => null, shouldReplyTrainingQuietly: () => false, isTrainingActivity: () => false,
  })
  const sendA = loadChatFunction('handleSend', A.bindings)()
  await new Promise(r => setTimeout(r, 5))
  await loadChatFunction('handleSend', B.bindings)()
  assert.deepEqual(queue.current, ['팀원 제안해 주세요'])
  // React 처럼 렌더마다 새 클로저 — 그 시점의 remoteBusy·isLoading 으로 함수를 다시 만든다
  const sendB = text => loadChatFunction('sendMessageDirectly', B.bindings)(text)
  let ticks = 0
  const drain = () => loadQueueDrainEffect({
    isLoading: B.local.isLoading, isAnalyzing: false, remoteBusy: B.bindings.remoteBusy, messagesLoaded: true,
    trainingQueueRef: queue, setQueuedSends() {}, sendMessageDirectly: text => sendB(text), setTrainingQueueTick: () => { ticks++ },
  })()
  // A 답이 아직이면 대기열은 흐르지 않는다
  drain(); await new Promise(r => setTimeout(r, 5))
  assert.equal(server.apiCalls.filter(c => c.uid === 'member').length, 0)
  // A 의 onDone 이 저장과 '응답 중' 표시 삭제를 한 번에(saveAssistantMessageAndClearStreaming) 했다고 둔다
  const plannedA = server.streaming.get('host').responseMessageId
  await A.bindings.saveAssistantMessageAndClearStreaming('p', 'A-2-2', { role: 'assistant', content: 'A 답: 목표 초안' }, plannedA, 'host')
  releaseA(); await sendA
  assert.equal(B.bindings.remoteBusy, false)
  drain(); await new Promise(r => setTimeout(r, 5))
  drain(); await new Promise(r => setTimeout(r, 5))   // 다시 깨워도 중복 전송 없음
  assert.equal(server.apiCalls.filter(c => c.uid === 'member').length, 1, 'B 정확히 1회')
  assert.ok(bRequests[0].includes('A 답: 목표 초안'), 'B 요청 맥락에 A 답 포함')
  assert.equal(bRequests[0].at(-1), '팀원 제안해 주세요')
  assert.deepEqual(queue.current, [])
})

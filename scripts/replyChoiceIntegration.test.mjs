import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { extractReplyChoices, REPLY_CHOICES_RULES } from '../src/lib/chat/replyChoices.ts'
import { buildSystemPrompt } from '../src/lib/prompts/system.ts'

const source = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function fn(name) {
  let found
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(tree); ts.forEachChild(node, visit) }
  visit(tree); assert.ok(found, name); return found
}
const question = '> **지금 할 일** 학생들이 최종 결과물로 **지역 인구 문제 해결 제안서**와 **실천 캠페인 자료** 중 어느 쪽을 만들면 좋을까요?'
function fixture(overrides = {}) {
  const message = { id: 'ai-current', role: 'assistant', activityCode: 'A-2-2', content: question }
  const sent = [], focused = [], input = { value: '작성 중인 의견', focus: arg => focused.push(arg), setSelectionRange: () => {} }
  const context = { sendBlockReason: null, isLoading: false, isAnalyzing: false, remoteBusy: false, isTeamMode: false, currentActivity: 'A-2-2', visibleMessages: [message], helpCardMap: {}, extractReplyChoices,
    sendMessageDirectly: async text => sent.push(text), setSlashQuery: () => {}, requestAnimationFrame: callback => callback(), document: { querySelector: () => input }, ...overrides }
  vm.runInNewContext(ts.transpileModule(`${fn('handleReplyChoice')}\n${fn('focusReplyInput')}\nthis.choose=handleReplyChoice;this.custom=focusReplyInput`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { context, message, sent, focused, input }
}
test('a reply choice sends only the offered answer and preserves the typed draft', async () => {
  const f = fixture()
  await f.context.choose(f.message, '지역 인구 문제 해결 제안서')
  assert.deepEqual(f.sent, ['지역 인구 문제 해결 제안서'])
  assert.equal(f.input.value, '작성 중인 의견')
  f.context.custom()
  assert.equal(f.focused.length, 1)
  assert.equal(f.sent.length, 1, 'custom input never sends a message')
  assert.equal(f.input.value, '작성 중인 의견')
})
test('stale, busy, blocked, wrong-activity and conflicting choices cannot send', async () => {
  for (const change of [{ sendBlockReason: '이동 중' }, { isLoading: true }, { isAnalyzing: true }, { remoteBusy: true }, { isTeamMode: true }, { currentActivity: 'T-1-1' }, { visibleMessages: [{ id: 'new-user', role: 'user' }] }, { helpCardMap: { 'ai-current': 'help' } }]) {
    const f = fixture(change); await f.context.choose(f.message, '실천 캠페인 자료'); assert.deepEqual(f.sent, [])
  }
  const f = fixture()
  await f.context.choose(f.message, '산출물에 저장')
  await f.context.choose({ ...f.message, actionCard: { primary: '저장' } }, '실천 캠페인 자료')
  assert.deepEqual(f.sent, [])
})
test('a reply choice never performs artifact confirmation or activity navigation', () => {
  assert.doesNotMatch(fn('handleReplyChoice'), /setProjectArtifact|advanceActivity|returnToActivity|closeOptionChoice|setInput/)
  assert.match(source, /msg\.id === latestReplyMessageId/)
  assert.match(source, /<ReplyChoices[^]*?onSelect=\{option => handleReplyChoiceStable\(msg, option\)\}/)
})
test('normal, training and solo prompts request clear alternatives without extra questions', () => {
  for (const mode of ['collaborative', 'solo']) for (const enabled of [true, false]) {
    const project = { title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: [], mode, currentCycle: 1, trainingMode: { enabled, coreFormal: false } }
    assert.ok(buildSystemPrompt('A', 'A-2-2', project, mode === 'solo' ? '개인+AI' : '팀+AI').includes(REPLY_CHOICES_RULES))
  }
})

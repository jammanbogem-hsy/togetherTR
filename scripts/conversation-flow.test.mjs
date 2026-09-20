import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/lib/activity/conversation-flow.ts', import.meta.url), 'utf8')
const context = { exports: {} }
vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
const { isDecisionDeferred, hasDeferredDecision, deferredResponse, discussionContributions } = context.exports

test('선택 거절 및 저장 거절은 보류로 처리한다', () => {
  for (const text of ['이번에는 선택하지 않겠습니다', '저장하지 않을게요', '결정은 나중에 할게요', '다시 논의하겠습니다']) assert.equal(isDecisionDeferred(text), true, text)
  assert.equal(isDecisionDeferred('A안을 선택하겠습니다'), false)
})
test('보류 후 자유 대화에서도 보류 유지, 명시적 결정 시 재개', () => {
  const msgs = [{ role: 'user', content: '선택하지 않겠습니다' }, { role: 'user', content: '학생 참여가 걱정돼요' }]
  assert.equal(hasDeferredDecision(msgs), true)
  assert.equal(hasDeferredDecision([...msgs, { role: 'user', content: '이제 저장해주세요' }]), false)
})
test('보류 응답의 반복 선택지와 변경 신호는 실행하지 않는다', () => {
  const result = deferredResponse('**A안:** "저장"\n**B안:** "유지"\n[ARTIFACT_UPDATE: 방향=새내용]\n[ACTIVITY_ADVANCE: T-2-1]')
  assert.doesNotMatch(result, /A안|B안|ARTIFACT_UPDATE|ACTIVITY_ADVANCE/)
  assert.match(result, /대화/)
  assert.equal(deferredResponse('참여를 더 이야기해 볼까요? [ARTIFACT_CONFIRM: T-1-1]'), '참여를 더 이야기해 볼까요?')
})
test('빈 토의와 AI 안내만 있는 토의는 분석하지 않는다', () => {
  const messages = [{ role: 'user', content: '이전 발언' }, { role: 'assistant', content: '회의 안내' }, { role: 'user', content: '  ' }]
  assert.equal(discussionContributions(messages, 1).length, 0)
  assert.equal(discussionContributions([...messages, { role: 'user', content: '새 의견' }], 1).length, 1)
})
test('채팅은 키워드 자동저장 없이 공통 전송 및 빈 토의 복귀를 사용한다', () => {
  const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(chat, /tryStructuredFallbackSave/)
  assert.match(chat, /discussionContributions\(messages, teamDiscussionStartIdx\)/)
  assert.match(chat, /await sendMessageDirectly\(`\$\{label\}/)
  assert.match(chat, /현재 활동을 유지합니다/)
})

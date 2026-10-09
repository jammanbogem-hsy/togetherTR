// Training "AI 도움" buttons: send the current record with the request, or say where to paste it.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/trainingHelpRecord.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { TRAINING_ACTIVITIES, TRAINING_PASTE_LABEL, parseTrainingHelpRequest, planTrainingHelp, trainingMessageChip } from '../src/lib/training/trainingMode.ts'
import { clearTrainingDraftText, getTrainingDraftText, setTrainingDraftText } from '../src/lib/training/recordDraftBridge.ts'
import { TRAINING_MODE_RULES } from '../src/lib/prompts/training.ts'

const action = TRAINING_ACTIVITIES['DI-2-1'].help[0]

test('a written record is sent with the help request and still shows as a small chip', () => {
  const plan = planTrainingHelp(action, '  2교시 모둠 토의에서 자료 해석이 엇갈림  ')
  assert.equal(plan.kind, 'send')
  assert.match(plan.text, /^\[AI 도움: 기록 정리\]/)
  assert.match(plan.text, /\[현재 활동 기록\]\n2교시 모둠 토의에서 자료 해석이 엇갈림$/)
  assert.equal(parseTrainingHelpRequest(plan.text)?.label, '기록 정리')
  assert.equal(trainingMessageChip(plan.text), 'AI 도움 요청 · 기록 정리')
})

test('very long records are clipped', () => {
  const plan = planTrainingHelp(action, 'ㄱ'.repeat(9000))
  assert.ok(plan.kind === 'send' && plan.text.length < 6200 && plan.text.endsWith('(이하 생략)'))
})

test('an empty record does not call the AI; it prefills the chat input and says where to paste', () => {
  const plan = planTrainingHelp(action, '   ')
  assert.equal(plan.kind, 'paste')
  assert.ok(plan.input.startsWith(action.prompt))
  assert.ok(plan.input.endsWith(`${TRAINING_PASTE_LABEL}\n`))
  assert.match(plan.notice, /아래 입력창/)
  assert.match(plan.notice, /실명/)
  assert.equal(parseTrainingHelpRequest(plan.input), null, 'pasted record must stay visible as a normal message')
})

test('draft bridge keeps the unsaved draft per project and activity', () => {
  setTrainingDraftText('p1', 'DI-2-1', '작성 중')
  assert.equal(getTrainingDraftText('p1', 'DI-2-1'), '작성 중')
  assert.equal(getTrainingDraftText('p2', 'DI-2-1'), undefined)
  clearTrainingDraftText('p1', 'DI-2-1')
  assert.equal(getTrainingDraftText('p1', 'DI-2-1'), undefined)
})

test('wiring: bar reads the draft first, form publishes it, chat prefills on empty record', () => {
  const bar = fs.readFileSync('src/components/training/TrainingModeBar.tsx', 'utf8')
  assert.match(bar, /getTrainingDraftText\(project\.id, activityCode\) \?\? trainingRecordText/)
  const form = fs.readFileSync('src/components/training/TrainingForm.tsx', 'utf8')
  assert.match(form, /setTrainingDraftText\(project\.id, activityCode, draft\.text\)/)
  const chat = fs.readFileSync('src/components/chat/ChatPanel.tsx', 'utf8')
  assert.match(chat, /onNeedRecord=\{\(input, notice\) => \{ setChatInputRequest\(input\); setFlowNotice\(notice\) \}\}/)
  assert.match(TRAINING_MODE_RULES, /\[현재 활동 기록\]/)
  assert.match(TRAINING_MODE_RULES, /붙여 넣을 곳을 꼭 말한다/)
})

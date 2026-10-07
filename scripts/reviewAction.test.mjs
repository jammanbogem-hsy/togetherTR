import { TRAINING_GUIDANCE_RULES } from '../src/lib/prompts/training.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { completeReviewAction, appendReviewDraft, isReviewAction, REVIEW_ACTION_RULES } from '../src/lib/chat/reviewAction.ts'
import { buildSystemPrompt } from '../src/lib/prompts/system.ts'

test('direct review and discussion requests get actionable buttons and activity-specific guidance', () => {
  for (const request of ['검토해 주세요.', '논의해 주세요.', '확인해 주세요.']) {
    const result = completeReviewAction(null, request, 'T-2-1')
    assert.equal(isReviewAction(result.card), true)
    assert.match(result.cleanText, /다음 단계에 필요한 것: 역할 배분 \(누가·무엇을·언제까지\)/)
  }
})
test('explicit next-step instructions are preserved, normal save proposals and exclusions stay unchanged', () => {
  const text = '검토해 주세요.\n다음 단계에 필요한 것: 담당자와 마감일을 확인해 주세요.'
  assert.equal(completeReviewAction(null, text, 'T-2-1').cleanText, text)
  const save = { card: { primary: '산출물에 저장', intent: '저장', skip: '나중에' }, cleanText: text }
  assert.equal(completeReviewAction(save, text, 'T-2-1'), save)
  for (const signal of ['ACTIVITY_ADVANCE', 'ACTIVITY_RETURN', 'HELP_CARD', 'TEAM_DISCUSSION_READY']) {
    assert.equal(completeReviewAction(null, `${text}\n[${signal}: T-2-3]`, 'T-2-1'), null)
  }
  for (const text of ['검토했습니다.', '> 검토해 주세요.', '```\n검토해 주세요.\n```']) assert.equal(completeReviewAction(null, text, 'T-2-1'), null)
})
test('extra-input draft is concrete, preserves existing text, and repeated clicks do not duplicate it', () => {
  const draft = appendReviewDraft('제가 적던 문장', '검토해 주세요.', 'T-2-3')
  assert.ok(draft.startsWith('제가 적던 문장\n\n'))
  assert.match(draft, /팀 일정표 \(기간·활동·내용·담당자\)/)
  assert.equal(appendReviewDraft(draft, '검토해 주세요.', 'T-2-3'), draft)
})
test('normal, training and solo prompts include the same review instruction and permission boundary', () => {
  for (const mode of ['collaborative', 'solo']) for (const enabled of [true, false]) {
    const p = { title: 't', schoolLevel: '초등', targetGradeGroup: '초3-4', targetSubjects: [], mode, currentCycle: 1, trainingMode: { enabled, coreFormal: false } }
    const prompt = buildSystemPrompt('T', 'T-2-1', p, mode === 'solo' ? '개인+AI' : '팀+AI')
    assert.ok(prompt.includes(REVIEW_ACTION_RULES))
    assert.match(prompt, /검토 의사만 전달하며/)
  }
})

 test('training guidance stays concise even in core activities; detailed opt-in and normal mode preserve their guidance', () => {
  const p = { title: 't', mode: 'collaborative', currentCycle: 1, trainingMode: { enabled: true, coreFormal: true } }
  for (const activity of ['T-1-1', 'A-1-2', 'A-2-2', 'Ds-1-1']) {
    const stage = activity.split('-')[0]
    const normal = buildSystemPrompt(stage, activity, { ...p, trainingMode: { enabled: false } }, '팀+AI')
    const training = buildSystemPrompt(stage, activity, p, '팀+AI')
    const detailed = buildSystemPrompt(stage, activity, p, '팀+AI', undefined, null, undefined, {}, undefined, { trainingStepByStep: true })
    assert.ok(training.endsWith(TRAINING_GUIDANCE_RULES))
    assert.ok(!normal.includes(TRAINING_GUIDANCE_RULES)); assert.ok(!detailed.includes(TRAINING_GUIDANCE_RULES))
  }
  assert.match(TRAINING_GUIDANCE_RULES, /완성할 결과/); assert.match(TRAINING_GUIDANCE_RULES, /이미 대화·산출물에 있는 답을 다시 묻지 않는다/)
})

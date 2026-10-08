import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrainingDraft, editTrainingDraft, syncTrainingDraft, loadSavedTrainingFields } from '../src/components/training/trainingFormState.ts'

test('AI 저장은 손대지 않은 칸과 입력 후 원래대로 비운 칸에 즉시 반영된다', () => {
  const code = 'T-2-2', incoming = { '팀 규칙': '차례대로 의견을 듣습니다.' }
  const initial = createTrainingDraft(code, {})
  const undone = editTrainingDraft(editTrainingDraft(initial, '팀 규칙', '임시 입력'), '팀 규칙', '')
  for (const draft of [initial, undone]) {
    const next = syncTrainingDraft(draft, code, incoming)
    assert.equal(next.values['팀 규칙'], incoming['팀 규칙'])
    assert.deepEqual(next.conflicts, [])
    assert.equal(next.dirty['팀 규칙'], undefined)
  }
})

test('작성 중인 글은 보존하고 새 저장값을 불러오면 충돌한 칸만 바뀐다', () => {
  const code = 'A-1-2'
  let draft = createTrainingDraft(code, { '최종 선정 주제': '기온 변화', '선정 근거': '생활과 연결' })
  draft = editTrainingDraft(draft, '최종 선정 주제', '직접 고치는 주제')
  draft = editTrainingDraft(draft, '선정 근거', '직접 고치는 근거')
  draft = syncTrainingDraft(draft, code, { '최종 선정 주제': 'AI가 저장한 주제', '선정 근거': '생활과 연결' })
  assert.equal(draft.values['최종 선정 주제'], '직접 고치는 주제')
  assert.deepEqual(draft.conflicts, ['최종 선정 주제'])
  const loaded = loadSavedTrainingFields(draft)
  assert.equal(loaded.values['최종 선정 주제'], 'AI가 저장한 주제')
  assert.equal(loaded.values['선정 근거'], '직접 고치는 근거')
  assert.equal(loaded.dirty['선정 근거'], true)
  assert.equal(loaded.dirty['최종 선정 주제'], false)
})

test('저장 응답이 입력과 같으면 수정 상태를 풀고 의도적으로 삭제한 미저장 글은 보호한다', () => {
  const code = 'T-2-2'
  const initial = createTrainingDraft(code, { '팀 규칙': '기존 규칙' })
  const edited = editTrainingDraft(initial, '팀 규칙', '새 규칙')
  const acknowledged = syncTrainingDraft(edited, code, { '팀 규칙': '새 규칙' })
  assert.equal(acknowledged.dirty['팀 규칙'], undefined)
  const cleared = syncTrainingDraft(editTrainingDraft(initial, '팀 규칙', ''), code, { '팀 규칙': '다른 저장값' })
  assert.equal(cleared.values['팀 규칙'], '')
  assert.deepEqual(cleared.conflicts, ['팀 규칙'])
})

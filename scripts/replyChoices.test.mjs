import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { extractReplyChoices, REPLY_CHOICES_RULES } from '../src/lib/chat/replyChoices.ts'

const screenshot = '> **지금 할 일** 학생들이 최종 결과물로 **지역 인구 문제 해결 제안서**와 **실천 캠페인 자료** 중 어느 쪽을 만들면 좋을까요?'
const expected = {
  question: '학생들이 최종 결과물로 지역 인구 문제 해결 제안서와 실천 캠페인 자료 중 어느 쪽을 만들면 좋을까요?',
  options: ['지역 인구 문제 해결 제안서', '실천 캠페인 자료'],
}

test('reply choices: screenshot 집중박스와 일반 말미 질문은 실제 두 대안을 정확히 추출', () => {
  assert.deepEqual(extractReplyChoices(screenshot), expected)
  assert.deepEqual(extractReplyChoices(screenshot.replace('**지금 할 일** ', '**지금 할 일**: ')), expected)
  assert.deepEqual(extractReplyChoices(screenshot.replace('> **지금 할 일** 학생들이', '> **지금 할 일**\n학생들이')), expected)
  assert.deepEqual(extractReplyChoices(`앞서 **핵심 연결점**을 살폈습니다.\n\n${screenshot.slice(2)}`), expected)
  assert.deepEqual(extractReplyChoices(`> 지금 할 일\n> 학생들이 최종 결과물로 **지역 인구 문제 해결 제안서**와 **실천 캠페인 자료** 중 어느 쪽을 만들면 좋을까요?`), expected)
  assert.deepEqual(extractReplyChoices(`> **지금 할 일**\n>\n> 학생들이 최종 결과물로 **지역 인구 문제 해결 제안서**와 **실천 캠페인 자료** 중 어느 쪽을 만들면 좋을까요?`), expected)
})

test('reply choices: 3·4옵션/또는·혹은/한글 조사/밑줄 굵게를 순서대로 읽으며 대안 추가 없음', () => {
  assert.deepEqual(extractReplyChoices('**영상** 또는 **포스터** 혹은 **제안서** 중 어떤 것을 선택할까요?'), { question: '영상 또는 포스터 혹은 제안서 중 어떤 것을 선택할까요?', options: ['영상', '포스터', '제안서'] })
  assert.deepEqual(extractReplyChoices('**지도**, **설문**, **인터뷰**, **포스터** 중 어느 것을 고를까요?').options, ['지도', '설문', '인터뷰', '포스터'])
  assert.deepEqual(extractReplyChoices('__자료 조사__ 또는 __주민 인터뷰__ 중 어떤 방식이 좋을까요?').options, ['자료 조사', '주민 인터뷰'])
})

test('reply choices: 일반 강조·서술·후속 질문·모호한 구분·중복·잘못된 개수는 null', () => {
  for (const text of [
    '**자료**와 **근거**를 함께 살펴봅니다.',
    '**학생**이 배워야 할 **목표** 중 어떤 부분이 중요한가요?',
    '**학생 참여**가 중요하며 **실제 자료**는 어떤 역할을 할까요?',
    '**자료 조사**와 **주민 인터뷰**가 있습니다. 의견을 주세요.',
    '**자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요? 기간도 정할까요?',
    '**자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?\n\n근거도 알려 주세요.',
    '**자료 조사**와 **주민 인터뷰**는 어떤 역할을 하나요?',
    '**자료 조사** 또는 **주민 인터뷰**는 어떤 뜻인가요?',
    '**자료 조사**와 **주민 인터뷰** 중 어떤 차이가 있나요?',
    '**자료 조사** **주민 인터뷰** 중 어떤 게 좋을까요?',
    '**자료 조사**와 **자료 조사** 중 어느 쪽이 좋을까요?',
    '**자료 조사** 중 어떤 방식이 좋을까요?',
    '**가**, **나**, **다**, **라**, **마** 중 어떤 것인가요?',
    '**대안1** 또는 **대안2** 중 어떤 것을 고를까요?',
    '### **자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
    '\\**자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
  ]) assert.equal(extractReplyChoices(text), null, text)
})

test('reply choices: 코드·인용 예시·A/B안·기존 신호는 충돌하므로 null', () => {
  for (const text of [
    `\`\`\`md\n${screenshot}\n\`\`\``,
    '`**자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?`',
    '> **자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
    '> 예시 질문:\n**자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
    '> **지금 할 일** 예: **자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
    '예시:\n\n**자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
    '예를 들어 **자료 조사**와 **주민 인터뷰** 중 어느 쪽이 좋을까요?',
    '**A안** 또는 **B안** 중 어느 쪽이 좋을까요?',
    '**a안** 또는 **b안** 중 어느 쪽이 좋을까요?',
    `[ACTION_CARD: primary=제안서]\n\n${screenshot}`,
    `[HELP_CARD: 도움]\n\n${screenshot}`,
    `[ARTIFACT_UPDATE: 내용=값]\n\n${screenshot}`,
    `[ACTIVITY_ADVANCE: A-2-1]\n\n${screenshot}`,
    `“${screenshot.slice(2)}”`,
  ]) assert.equal(extractReplyChoices(text), null, text)
})

test('reply choices: 저장·확정·동의·이동은 일반 답변 선택으로 만들지 않음', () => {
  for (const text of [
    '**저장** 또는 **수정** 중 어느 것을 선택할까요?',
    '**확정** 또는 **조정** 중 어느 것을 선택할까요?',
    '**동의**와 **보류** 중 어떤 것을 선택할까요?',
    '산출물을 **지금 반영** 혹은 **나중에 검토** 중 어떤 쪽으로 할까요?',
    '**A 활동** 또는 **B 활동** 중 어느 쪽으로 이동할까요?',
    '**지금** 또는 **나중에** 중 어떤 때 다음 단계로 넘어갈까요?',
    '**이대로 진행** 또는 **보완** 중 어느 것을 선택할까요?',
  ]) assert.equal(extractReplyChoices(text), null, text)
})

test('reply choices: 규칙은 2~4개 실제 대안·말미 한 질문·후속질문 금지·저장 동의와 구분', () => {
  assert.match(REPLY_CHOICES_RULES, /대안 2~4개/)
  assert.match(REPLY_CHOICES_RULES, /추가 질문을 붙이지 않고/)
  assert.match(REPLY_CHOICES_RULES, /저장·확정·이동 동의가 아니다/)
  assert.match(REPLY_CHOICES_RULES, /없는 대안/)
})

function elements(value, type) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(child => elements(child, type))
  return [...(value.type === type ? [value] : []), ...elements(value.props?.children, type)]
}
function fixture(callback, disabled = false) {
  const slots = []
  let index = 0, custom = 0
  const code = fs.readFileSync(new URL('../src/components/chat/ReplyChoices.tsx', import.meta.url), 'utf8')
  const context = { exports: {}, require(name) {
    if (name === 'react/jsx-runtime') return jsx
    if (name === 'react') return {
      useId() { index++; return 'reply-question' },
      useRef(value) { const i = index++; return slots[i] ??= { current: value } },
      useState(value) { const i = index++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = next }] },
    }
    throw new Error(name)
  } }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const props = { ...expected, disabled, onSelect: callback, onCustom: () => { custom++ } }
  function render() { index = 0; const outer = context.exports.ReplyChoices(props); return outer.type(outer.props) }
  return { render, get custom() { return custom }, buttons: () => elements(render(), 'button'), html: () => renderToStaticMarkup(render()), wrap: extra => context.exports.ReplyChoices({ ...props, ...extra }) }
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test('ReplyChoices: 정확한 옵션 콜백 한 번·pending 및 성공 이후 중복 잠금·직접 입력 송신 없음', async () => {
  const sent = []; let finish
  const f = fixture(option => { sent.push(option); return new Promise(resolve => { finish = resolve }) })
  const button = f.buttons()[1]
  button.props.onClick(); button.props.onClick()
  assert.deepEqual(sent, ['실천 캠페인 자료'])
  assert.equal(f.buttons().every(button => button.props.disabled), true)
  assert.match(f.html(), /aria-busy="true"/)
  finish(); await tick()
  f.buttons()[0].props.onClick()
  assert.equal(sent.length, 1)
  assert.match(f.html(), /선택한 답변: 실천 캠페인 자료/)
  const custom = fixture(option => sent.push(option))
  custom.buttons().at(-1).props.onClick()
  assert.equal(custom.custom, 1)
  assert.equal(sent.length, 1)
})

test('ReplyChoices: sync/async 실패는 alert·잠금 해제·재시도, disabled는 callback 모두 차단', async () => {
  for (const asyncFailure of [false, true]) {
    const sent = []; let fail = true
    const f = fixture(option => { sent.push(option); if (fail) { if (asyncFailure) return Promise.reject(new Error('failed')); throw new Error('failed') } })
    f.buttons()[0].props.onClick(); await tick()
    assert.match(f.html(), /role="alert"/)
    assert.equal(f.buttons().every(button => !button.props.disabled), true)
    fail = false
    f.buttons()[0].props.onClick(); await tick()
    assert.deepEqual(sent, ['지역 인구 문제 해결 제안서', '지역 인구 문제 해결 제안서'])
    assert.equal(f.buttons().every(button => button.props.disabled), true)
  }
  const sent = [], f = fixture(option => sent.push(option), true)
  f.buttons()[0].props.onClick(); f.buttons().at(-1).props.onClick(); await tick()
  assert.deepEqual(sent, [])
  assert.equal(f.custom, 0)
})

test('ReplyChoices: 모바일44px/16px·같은 강조·줄바꿈·질문 group·새 질문의 state key 계약', () => {
  const f = fixture(() => {})
  const buttons = f.buttons()
  for (const button of buttons) {
    assert.match(button.props.className, /min-h-11/)
    assert.match(button.props.className, /text-base/)
  }
  assert.equal(buttons[0].props.className, buttons[1].props.className)
  assert.match(f.html(), /flex-col.*sm:flex-row sm:flex-wrap/)
  assert.match(f.html(), /role="group" aria-labelledby="reply-question"/)
  assert.match(f.html(), /<p id="reply-question" class="sr-only">/)
  assert.notEqual(f.wrap({ question: '새 질문' }).key, f.wrap({}).key)
  assert.equal(f.wrap({ options: ['하나'] }), null)
})

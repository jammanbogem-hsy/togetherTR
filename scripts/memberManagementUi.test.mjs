import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { canManageMembers, canRemoveMember, memberRemovalError } from '../src/components/members/memberManagement.ts'
import { MEMBER_ADMIN_ERROR_COPY } from '../src/lib/project/memberAdmin.ts'

const project = { id: 'room', hostUid: 'host', createdBy: 'creator', memberUids: ['host', 'creator', 'member'], memberInfo: {} }
function loadUi(file, bindings = {}, react = React) {
  const code = fs.readFileSync(new URL(`../src/components/members/${file}.tsx`, import.meta.url), 'utf8')
  const context = { exports: {}, document: { body: {} }, require(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return jsxRuntime
    if (name === 'react-dom') return { createPortal: value => value }
    if (name === '@phosphor-icons/react') return { UserMinus: () => React.createElement('svg') }
    if (name === '@/components/ui/MD3Button') return { MD3Button: ({ children, disabled, onClick, ...props }) => React.createElement('button', { disabled, onClick, 'aria-label': props['aria-label'] }, children) }
    if (name === './memberManagement') return { canRemoveMember, memberRemovalError }
    if (name in bindings) return bindings[name]
    throw new Error(`Unexpected import ${name}`)
  } }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context.exports[file]
}

test('M2 UI: 데이터 권한과 같은 방장 판정·자신과 방장 보호·팀원과 데모 제외', () => {
  assert.equal(canManageMembers(project, 'host'), true)
  assert.equal(canManageMembers(project, 'creator'), true, '기존 데이터 권한의 createdBy 방장 판정 보존')
  for (const uid of ['member', undefined, '']) assert.equal(canManageMembers(project, uid), false)
  assert.equal(canRemoveMember(project, 'host', 'member'), true)
  assert.equal(canRemoveMember(project, 'host', 'host'), false)
  assert.equal(canRemoveMember(project, 'host', 'creator'), false)
  assert.equal(canRemoveMember(project, 'host', 'missing'), false)
  assert.equal(canRemoveMember({ ...project, demoRun: {} }, 'host', 'member'), false)
  const legacy = { createdBy: 'creator', memberUids: ['creator', 'member'], memberInfo: { creator: {}, member: {} } }
  assert.equal(canRemoveMember(legacy, 'creator', 'member'), true)
})

test('M2 UI: 채팅 확인 카드는 방장만 활성화·재입장 안내·처리 후 이름 칩을 제공한다', () => {
  const Card = loadUi('MemberRemovalCard')
  const props = { name: '김 선생', isHost: true, onRemove() {}, onCancel() {} }
  const render = extra => renderToStaticMarkup(React.createElement(Card, { ...props, ...extra }))
  const pending = render({})
  assert.match(pending, /남긴 대화와 산출물은 남아요/)
  assert.match(pending, /초대코드로 다시 들어올 수 있어요/)
  assert.doesNotMatch(pending, /disabled|되돌릴 수 없/)
  assert.equal((render({ isHost: false }).match(/disabled=""/g) ?? []).length, 2)
  assert.equal((render({ busy: true }).match(/disabled=""/g) ?? []).length, 2)
  const done = render({ state: 'removed' })
  assert.match(done, /김 선생 선생님이 방에서 나갔어요/)
  assert.doesNotMatch(done, /<button/)
  assert.match(render({ error: '다시 시도해 주세요' }), /role="alert"/)
})

test('M2 UI: 내보내기 확인 대화상자 이름·기록 보존·재입장 안내와 처리 중 잠금', () => {
  const Dialog = loadUi('MemberActionDialog')
  const props = { title: '잠만보 선생님을 내보낼까요?', confirmLabel: '내보내기', busy: true, onConfirm() {}, onClose() {}, children: [React.createElement('p', { key: 'a' }, '남긴 대화와 산출물은 남아요.'), React.createElement('p', { key: 'b' }, '초대코드로 다시 들어올 수 있어요.')] }
  const html = renderToStaticMarkup(React.createElement(Dialog, props))
  assert.match(html, /role="dialog".*aria-modal="true"/)
  assert.match(html, /잠만보 선생님/)
  assert.match(html, /초대코드로 다시 들어올 수/)
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2)
  assert.doesNotMatch(html, /되돌릴 수 없/)
})

test('M2 UI: 확인 전 API 호출 없음·확인 시 정확한 UID·중복 잠금·실패 후 재시도', async () => {
  const calls = [], slots = []
  let index = 0, rejectSave, fail = true
  const fakeReact = { ...React,
    useState(value) { const i = index++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
    useRef(value) { const i = index++; return slots[i] ??= { current: value } },
    useCallback(fn) { index++; return fn },
  }
  const Button = loadUi('MemberRemovalButton', {
    './MemberActionDialog': { MemberActionDialog: () => null },
    '@/lib/firebase/projects': { removeMember(...args) { calls.push(args); if (fail) return new Promise((_, reject) => { rejectSave = reject }); return Promise.resolve({ presenceCleanup: 'partial' }) } },
  }, fakeReact)
  const props = { project, userId: 'host', targetUid: 'member', name: '잠만보' }
  function render(extra = {}) { index = 0; return Button({ ...props, ...extra }) }
  const first = render()
  assert.equal(render({ userId: 'member' }), null)
  first.props.children[0].props.onClick()
  assert.equal(calls.length, 0)
  const dialog = render().props.children[1]
  const request = dialog.props.onConfirm()
  await dialog.props.onConfirm()
  assert.deepEqual(calls, [['room', 'host', 'member']])
  assert.equal(render().props.children[1].props.busy, true)
  rejectSave(new Error('not-host')); await request
  assert.equal(render().props.children[1].props.error, MEMBER_ADMIN_ERROR_COPY['not-host'])
  fail = false
  await render().props.children[1].props.onConfirm()
  assert.equal(calls.length, 2)
  assert.equal(render().props.children[1], false, 'presence cleanup partial도 내보내기 성공')
})

test('M2 UI: page는 멤버 버튼과 실제 모드 판정으로 연결하며 폐기한 전환 배너를 추가하지 않는다', () => {
  const page = fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /<MemberRemovalButton\s+project=\{project\}\s+userId=\{uid\}\s+targetUid=\{mUid\}\s+name=\{displayName\}/)
  assert.match(page, /isSoloProject\(project\)/)
  assert.doesNotMatch(page, /project\.mode\s*(?:===|!==)\s*'solo'|convertSoloToCollaborative|팀 설계로 전환/)
  for (const code of ['not-host', 'target-not-member', 'cannot-remove-self', 'cannot-remove-host']) assert.equal(memberRemovalError(new Error(code)), MEMBER_ADMIN_ERROR_COPY[code])
  assert.match(memberRemovalError(new Error('unknown')), /다시 시도/)
})

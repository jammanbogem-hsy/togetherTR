import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const items = [
  { id: 'reading', subject: '국어', course: '국어', area: '읽기', gradeBands: ['3-4학년군'], coreIdeas: ['  서로 다른\n 자료를\t비교하여 근거를 찾는다.  '], knowledge: ['글의 구조', '자료 출처'], functions: ['비교하기', '요약하기'], attitudes: [] },
  { id: 'society', subject: '사회', course: '사회', area: '지역사회', gradeBands: ['3-4학년군'], coreIdeas: ['지역사회 문제를 자료로 탐구하고 해결에 참여한다.'], knowledge: ['지역 자료'], functions: ['자료 조사'], attitudes: [] },
]
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function nodes(value, predicate) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(child => nodes(child, predicate))
  return [...(predicate(value) ? [value] : []), ...nodes(value.props?.filters, predicate), ...nodes(value.props?.children, predicate)]
}
function text(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).join('')
  return value?.props ? text(value.props.children) : ''
}
async function fixture(clipboard) {
  const file = new URL('../src/components/chat/CoreIdeaFinderModal.tsx', import.meta.url)
  const code = fs.readFileSync(file, 'utf8')
  const parsed = ts.createSourceFile('CoreIdeaFinderModal.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(parsed.parseDiagnostics.length, 0)
  const slots = [], effects = [], inserted = [], requested = []
  let index = 0, closed = 0
  const react = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
    useRef(value) { const i = index++; return slots[i] ??= { current: value } },
    useMemo(fn) { index++; return fn() },
    useEffect(fn, deps) { const i = index++; if (!slots[i]?.deps || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) { slots[i] = { deps }; effects.push(fn) } },
  }
  const context = { exports: {}, navigator: { clipboard }, fetch: async url => { requested.push(url); return { json: async () => ({ items }) } }, require(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return jsx
    if (name === '@phosphor-icons/react') return new Proxy({}, { get: () => () => React.createElement('svg') })
    if (name === './CurriculumFinderDialog') return { CurriculumFinderDialog: props => React.createElement('section', {}, props.filters, props.children, props.footer), FINDER_CHIP: 'chip', FINDER_ACTIVE: 'active', FINDER_INACTIVE: 'inactive' }
    if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') }
    throw new Error(name)
  } }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  function render() {
    index = 0
    const value = context.exports.CoreIdeaFinderModal({ open: true, onClose: () => { closed++ }, onInsert: value => inserted.push(value) })
    while (effects.length) effects.shift()()
    return value
  }
  render(); await tick()
  return { render, inserted, requested, get closed() { return closed },
    buttons(id) { return nodes(render(), value => value.type === 'button' && value.props['data-testid'] === id) },
    html() { return renderToStaticMarkup(render()) },
  }
}

test('core idea copy: 오른쪽 독립 버튼은 문장만 한 줄로 복사하고 채팅/닫기 호출 안 함, 성공 status', async () => {
  const copied = [], f = await fixture({ writeText: async value => copied.push(value) })
  const [copy] = f.buttons('core-idea-copy')
  assert.ok(copy, '실제 렌더된 복사 버튼')
  copy.props.onClick(); await tick()
  assert.deepEqual(copied, ['서로 다른 자료를 비교하여 근거를 찾는다.'])
  assert.deepEqual(f.inserted, [])
  assert.equal(f.closed, 0)
  assert.deepEqual(f.requested, ['/api/core-ideas'])
  assert.match(f.html(), /role="status" aria-live="polite"/)
  assert.match(f.html(), /핵심아이디어를 복사했어요/)
  assert.match(copy.props.className, /min-h-11 min-w-11/)
  assert.doesNotMatch(f.html(), /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/)
})

test('core idea copy: Clipboard reject/미지원은 alert, 삽입·닫기 없음, 실패 후 다시 복사 가능', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied') } }]) {
    const f = await fixture(clipboard)
    f.buttons('core-idea-copy')[0].props.onClick(); await tick()
    assert.match(f.html(), /role="alert" aria-live="assertive"/)
    assert.match(f.html(), /복사하지 못했어요/)
    assert.deepEqual(f.inserted, [])
    assert.equal(f.closed, 0)
    assert.equal(f.buttons('core-idea-copy')[0].props.disabled, false)
    f.buttons('core-idea-copy')[0].props.onClick(); await tick()
    assert.match(f.html(), /복사하지 못했어요/)
  }
})

test('core idea copy: Promise 완료 전 busy·중복 클릭 보호, 기존 채팅 삽입 형식은 메타 포함 그대로', async () => {
  let resolve, calls = 0
  const f = await fixture({ writeText: () => { calls++; return new Promise(done => { resolve = done }) } })
  const [copy] = f.buttons('core-idea-copy')
  copy.props.onClick(); copy.props.onClick()
  assert.equal(calls, 1)
  assert.equal(f.buttons('core-idea-copy')[0].props['aria-busy'], true)
  resolve(); await tick()
  f.buttons('core-idea-insert')[0].props.onClick()
  assert.deepEqual(f.inserted, ['[국어 · 읽기]\n핵심 아이디어:   서로 다른\n 자료를\t비교하여 근거를 찾는다.  \n지식·이해: 글의 구조, 자료 출처\n과정·기능: 비교하기, 요약하기'])
  assert.equal(f.closed, 1)
  assert.equal(calls, 1, '삽입은 복사를 추가로 호출하지 않음')
})

test('core idea copy: 검색/교과 토글·카드의 지식/기능 표시는 변경 전 의미 유지', async () => {
  const f = await fixture({ writeText: async () => {} })
  assert.equal(f.buttons('core-idea-copy').length, 2)
  let chip = nodes(f.render(), value => value.type === 'button' && text(value) === '사회')[0]
  chip.props.onClick()
  assert.equal(f.buttons('core-idea-copy').length, 1)
  assert.match(f.html(), /지역사회 문제/)
  chip = nodes(f.render(), value => value.type === 'button' && text(value) === '사회')[0]
  chip.props.onClick()
  const input = nodes(f.render(), value => value.type === 'input' && value.props['aria-label'] === '핵심아이디어 검색')[0]
  input.props.onChange({ target: { value: '글의 구조' } })
  assert.equal(f.buttons('core-idea-copy').length, 1)
  assert.match(f.html(), /지식·이해/)
  assert.match(f.html(), /자료 출처/)
  assert.match(f.html(), /과정·기능/)
  assert.match(f.html(), /요약하기/)
})

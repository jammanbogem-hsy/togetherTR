import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../src/lib/markdown/remarkPlugins.ts'
import * as table from '../src/lib/training/trainingTable.ts'
import { trainingFormText } from '../src/components/training/trainingFormText.ts'
import { trainingFormValues, buildTrainingFormContent } from '../src/components/training/trainingFormState.ts'
import { TRAINING_ACTIVITIES, trainingStatus } from '../src/lib/training/trainingMode.ts'

const schedule = '| 기간 | 활동 | 내용 | 담당자 |\n| --- | --- | --- | --- |\n| 10월 | 준비 | 자료 수집 | 김교사 |'
const columns = TRAINING_ACTIVITIES['T-2-3'].fields[0].tableColumns
function loadInput(react) {
  const source = fs.readFileSync(new URL('../src/components/training/TrainingFieldInput.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => ({ react, 'react/jsx-runtime': jsxRuntime, '@/lib/training/trainingTable': table })[name] })
  return exports.TrainingFieldInput
}
const Input = loadInput(React)
function elements(node, type, found = []) {
  if (!node || typeof node !== 'object') return found
  if (node.type === type) found.push(node)
  React.Children.forEach(node.props?.children, child => elements(child, type, found))
  return found
}
function editor(value, extra = {}) {
  const slots = [], emitted = []
  let index = 0, changed = false
  const Component = loadInput({ useState(initial) {
    const slot = index++
    if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
    return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; changed = true }]
  } })
  const props = { id: 'schedule', label: '팀 일정', value, columns, onChange(next) { emitted.push(next); props.value = next }, ...extra }
  const render = () => { let result; do { changed = false; index = 0; result = Component(props) } while (changed); return result }
  return { props, emitted, render }
}

test('V2: 일정 표를 인식하고 실제 머리글·정렬·행 내용을 유지한다', () => {
  assert.deepEqual(columns, ['기간', '활동', '내용', '담당자'])
  const parts = table.parseTrainingTables(schedule)
  assert.deepEqual(parts[0].headers, columns)
  assert.deepEqual(parts[0].rows[0].cells, ['10월', '준비', '자료 수집', '김교사'])
  assert.equal(table.serializeTrainingTables(parts), schedule)
  const aligned = '날짜 | 장소\n:--- | ---:\n월요일 | 학교'
  assert.equal(table.parseTrainingTables('| A | B |\n| - | :-: |\n| 내용 | 값 |')[0].kind, 'table')
  assert.equal(table.serializeTrainingTables(table.parseTrainingTables(aligned)), '| 날짜 | 장소 |\n| :--- | ---: |\n| 월요일 | 학교 |')
})

test('V2: 설명·여러 표·코드 블록은 보존하고 표가 아닌 값은 그대로 둔다', () => {
  const mixed = `사전 준비\n\n${schedule}\n\n추가 일정\n${schedule}\n\n마무리 메모`
  const parts = table.parseTrainingTables(mixed)
  assert.equal(parts.filter(part => part.kind === 'table').length, 2)
  assert.equal(table.serializeTrainingTables(parts), mixed)
  for (const text of ['회의 날짜는 월요일입니다.', 'A | B\n본문 | 내용', `\`\`\`markdown\n${schedule}\n\`\`\``, `~~~~\n${schedule}\n~~~~`]) {
    assert.ok(table.parseTrainingTables(text).every(part => part.kind === 'text'))
    assert.equal(table.serializeTrainingTables(table.parseTrainingTables(text)), text)
  }
  const malformed = '| 기간 | 활동 |\n| --- | --- |\n| 오늘 | 준비 | 지워지면 안 되는 내용 |'
  assert.equal(table.serializeTrainingTables(table.parseTrainingTables(malformed)), malformed)
  assert.equal(table.parseTrainingTables(malformed)[0].kind, 'text')
})

test('V2: 칸의 파이프·역슬래시·여러 줄은 저장 후 다시 열어도 같은 값이다', () => {
  const model = table.emptyTrainingTable(['기간', '내용'])
  model.rows[0].cells = ['A | B', 'C:\\자료\\\n첫 줄\n둘째 줄 | 확인\\|']
  const encoded = table.serializeTrainingTables([model])
  const parsed = table.parseTrainingTables(encoded)[0]
  assert.deepEqual(parsed.headers, model.headers)
  assert.deepEqual(parsed.rows[0].cells, model.rows[0].cells)
  assert.match(encoded, /&#10;/)
  const rendered = renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS }, encoded))
  assert.match(rendered, /<td>A \| B<\/td>/)
  assert.doesNotMatch(rendered, /&lt;br|&amp;#10;/)
  model.rows[0].cells = ['&amp; &#10; <br>', '<script>literal</script>']
  assert.deepEqual(table.parseTrainingTables(table.serializeTrainingTables([model]))[0].rows[0].cells, model.rows[0].cells)
  const short = table.parseTrainingTables('| A | B | C |\n| --- | --- | --- |\n| 내용 |')[0]
  assert.deepEqual(short.rows[0].cells, ['내용', '', ''])
})

test('V2: 기존 구조화 일정·공동 편집 columns/rows·행 배열을 한국어 표 문자열로 받는다', () => {
  const data = { schedule: [{ period: '10월', activity: '준비', content: '자료 수집', assignee: '김교사' }] }
  assert.equal(trainingFormValues('T-2-3', data)['팀 일정'], schedule)
  const workspace = { columns: columns.map((label, index) => ({ id: `c${index}`, label })), rows: [{ id: 'r1', cells: { c0: '10월', c1: '준비', c2: '자료 수집', c3: '김교사' } }] }
  assert.equal(trainingFormValues('T-2-3', { '팀 일정': workspace })['팀 일정'], schedule)
  assert.equal(trainingFormText({ headers: columns, rows: [['10월', '준비', '자료 수집', '김교사']] }, 'T-2-3'), schedule)
  const original = structuredClone(data)
  const saved = buildTrainingFormContent('T-2-3', { ...data, '별도 메모': '그대로' }, { '팀 일정': schedule })
  assert.equal(saved['팀 일정'], schedule)
  assert.equal(saved['별도 메모'], '그대로')
  assert.equal(saved.schedule, undefined)
  assert.deepEqual(data, original)
})

test('V2: 글 입력이 기본이고 표 전환·빈 행 추가만으로 필수 칸 완료 처리하지 않는다', () => {
  const form = editor('')
  let tree = form.render()
  assert.equal(elements(tree, 'textarea').length, 1)
  assert.equal(elements(tree, 'th').length, 0)
  assert.equal(elements(tree, 'button').find(button => button.props.children === '글로 입력').props['aria-pressed'], true)
  assert.equal(form.emitted.length, 0)
  elements(tree, 'button').find(button => button.props.children === '표로 입력').props.onClick()
  tree = form.render()
  assert.equal(elements(tree, 'th').length, columns.length + 1)
  assert.equal(form.emitted.length, 0)
  const add = elements(tree, 'button').find(button => button.props.children === '행 추가')
  add.props.onClick()
  assert.equal(elements(form.render(), 'tr').length, 3)
  assert.equal(form.props.value, '')
  assert.equal(trainingStatus('T-2-3', { '팀 일정': form.props.value }).missingRequired.length, 1)
})

test('V2: 칸 수정·행 추가/삭제가 같은 문자열로 저장되고 마지막 행 삭제 뒤 다시 입력할 수 있다', () => {
  const form = editor(schedule)
  elements(form.render(), 'button').find(button => button.props.children === '표로 입력').props.onClick()
  let tree = form.render()
  const originalKey = elements(tree, 'tr')[1].key
  elements(tree, 'textarea')[0].props.onChange({ target: { value: '11월' } })
  tree = form.render()
  assert.equal(elements(tree, 'tr')[1].key, originalKey)
  assert.match(form.props.value, /\| 11월 \| 준비 \| 자료 수집 \| 김교사 \|/)
  elements(tree, 'button').find(button => button.props.children === '행 추가').props.onClick()
  tree = form.render()
  assert.equal(elements(tree, 'tr').length, 3)
  elements(tree, 'button').find(button => button.props['aria-label']?.endsWith('1행 삭제')).props.onClick()
  tree = form.render()
  assert.equal(form.props.value, '')
  elements(tree, 'textarea')[0].props.onChange({ target: { value: '12월' } })
  assert.match(form.props.value, /12월/)
})

test('V2: 글/표 전환은 내용을 쓰거나 버리지 않고 외부 갱신은 새 값을 표시한다', () => {
  const form = editor(schedule)
  let tree = form.render()
  assert.equal(elements(tree, 'button').find(button => button.props.children === '글로 입력').props['aria-pressed'], true)
  assert.equal(elements(tree, 'textarea').length, 1)
  assert.equal(elements(tree, 'textarea')[0].props.value, schedule)
  assert.equal(form.emitted.length, 0)
  elements(tree, 'button').find(button => button.props.children === '표로 입력').props.onClick()
  form.props.value = schedule.replace('김교사', '이교사')
  tree = form.render()
  assert.equal(elements(tree, 'textarea')[3].props.value, '이교사')
  form.props.value = '그냥 메모'
  assert.equal(elements(form.render(), 'textarea').length, 1)
  assert.equal(elements(form.render(), 'textarea')[0].props.value, '그냥 메모')
})

test('V2: 표의 고정 머리글·모바일 한 열 카드와 읽기 전용 fieldset을 렌더한다', () => {
  const form = editor(schedule)
  elements(form.render(), 'button').find(button => button.props.children === '표로 입력').props.onClick()
  const html = renderToStaticMarkup(React.createElement('fieldset', { disabled: true }, form.render()))
  assert.match(html, /<fieldset disabled=""/)
  assert.match(html, /<thead class="sticky top-0/)
  assert.match(html, /sm:block/)
  assert.match(html, /sm:hidden/)
  assert.match(html, /aria-label="팀 일정 표 1 카드"/)
  assert.doesNotMatch(html, /&lt;script|\| --- \|/)
  assert.match(html, /1행 기간/)
  const plain = renderToStaticMarkup(React.createElement(Input, { id: 'text', label: '메모', value: '그냥 글', columns, onChange() {} }))
  assert.doesNotMatch(plain, /<table|행 추가/)
  assert.match(plain, /그냥 글<\/textarea>/)
})

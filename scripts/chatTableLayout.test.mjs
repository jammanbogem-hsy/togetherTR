import test from 'node:test'
import assert from 'node:assert/strict'
import { remarkShortColumns } from '../src/lib/markdown/tableColumnWidth.ts'

const cell = text => ({ type: 'tableCell', children: [{ type: 'text', value: text }] })
function layout(rows) {
  const table = { type: 'table', children: rows.map(row => ({ type: 'tableRow', children: row.map(cell) })) }
  remarkShortColumns()({ type: 'root', children: [table] }); return table.children.map(row => row.children.map(c => c.data.hProperties))
}
test('long rationale keeps readable width while symbol ratings permit heading wrapping', () => {
  const rows = layout([
    ['후보 주제', '학생 삶과의 연결성', '교과 연계성', '실현 가능성', '주요 근거'],
    ['기후변화', '○', '○', '△', '우리 생활과 환경에 미치는 영향을 살펴볼 수 있으나 탐구 문제를 더 좁혀야 함.'],
    ['10년간의 온도 변화 탐구', '△', '○', '○', '지역 기온 자료를 수집하고 그래프로 나타내어 변화와 원인을 설명함.'],
  ])
  assert.deepEqual(rows[0].map(c => c['data-column-layout']), ['short', 'rating', 'rating', 'rating', 'prose'])
  assert.equal(rows[1][4]['data-min-ch'], undefined)
})
test('multiline prose and long unbroken tokens remain prose; checklist markers remain short', () => {
  const rows = layout([['메모', '확인'], ['아주긴문자열'.repeat(30), '⟦체크:0:0⟧']])
  assert.equal(rows[1][0]['data-column-layout'], 'prose')
  assert.equal(rows[1][1]['data-column-layout'], 'short')
})

// DI·E 공동 편집 → 산출물 변환 회귀 테스트
// 실행: node --experimental-strip-types --test scripts/coeditSerialize.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { tableToMarkdown, columnToList, buildCollaborationAgreementRows } =
  await import('../src/lib/artifacts/coeditSerialize.ts')

const COLS = [
  { id: 'a', label: '대상 학습활동' },
  { id: 'b', label: '필요 자료' },
]

test('빈 표는 빈 문자열 — 산출물에 껍데기 표가 저장되지 않는다', () => {
  assert.equal(tableToMarkdown(COLS, []), '')
  assert.equal(tableToMarkdown(COLS, [{ id: 'r1', cells: { a: '', b: '  ' } }]), '')
})

test('내용이 있는 행만 마크다운 표로 직렬화된다', () => {
  const md = tableToMarkdown(COLS, [
    { id: 'r1', cells: { a: '데이터 해석', b: '활동지' } },
    { id: 'r2', cells: { a: '', b: '' } },
  ])
  assert.equal(md, [
    '| 대상 학습활동 | 필요 자료 |',
    '| --- | --- |',
    '| 데이터 해석 | 활동지 |',
  ].join('\n'))
})

test('셀 안의 개행·파이프가 표 구조를 깨뜨리지 않는다', () => {
  const md = tableToMarkdown(COLS, [
    { id: 'r1', cells: { a: '줄1\n줄2', b: 'A|B' } },
  ])
  const lines = md.split('\n')
  assert.equal(lines.length, 3, '행이 개행으로 쪼개지면 안 됨')
  assert.ok(lines[2].includes('줄1 줄2'))
  assert.ok(lines[2].includes('A/B'))
})

test('빈 셀은 하이픈으로 채워 열 수가 유지된다', () => {
  const md = tableToMarkdown(COLS, [{ id: 'r1', cells: { a: '활동' } }])
  assert.ok(md.endsWith('| 활동 | - |'))
})

test('columnToList — 채워진 값만 번호 목록으로', () => {
  const out = columnToList([
    { id: '1', cells: { question: '왜 그 지점에서 막혔나' } },
    { id: '2', cells: { question: '' } },
    { id: '3', cells: { question: '루브릭 표현이 추상적이었나' } },
  ], 'question')
  assert.equal(out, '1. 왜 그 지점에서 막혔나\n2. 루브릭 표현이 추상적이었나')
})

// ── E-2-1 T단계 합의 선주입 ────────────────────────────────
const ARTIFACTS = {
  'T-1-1': { content: { '팀 공통 비전': '마을 문제를 해결하는 능동적 시민' } },
  'T-2-3': { content: { '팀 일정': '7월 3주차 실행' } },
  'T-2-2': { content: { '팀 규칙': '회의는 40분 이내' } },
}

test('팀 모드: 합의 5행이 T단계 산출물에서 선주입된다', () => {
  const rows = buildCollaborationAgreementRows(ARTIFACTS, false)
  assert.equal(rows.length, 5)
  assert.ok(rows[0].cells.agreement.includes('마을 문제를 해결하는 능동적 시민'))
  assert.ok(rows[3].cells.agreement.includes('회의는 40분 이내'))
  // 산출물이 없는 항목은 빈칸이 아니라 '(산출물 없음)'으로 드러난다
  assert.ok(rows[1].cells.agreement.includes('산출물 없음'))
})

test('solo 모드: 숨김 활동을 뺀 비전·일정 2행만 생성된다', () => {
  const rows = buildCollaborationAgreementRows(ARTIFACTS, true)
  assert.equal(rows.length, 2)
  assert.ok(rows[0].cells.agreement.includes('팀 비전'))
  assert.ok(rows[1].cells.agreement.includes('팀 일정'))
})

test('산출물이 전혀 없어도 행 구조는 유지된다', () => {
  const rows = buildCollaborationAgreementRows(undefined, false)
  assert.equal(rows.length, 5)
  for (const r of rows) {
    assert.ok(r.cells.agreement.includes('산출물 없음'))
    assert.equal(r.cells.principle, '')
  }
})

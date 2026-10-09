// node --test --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/sheetDeleteResurrect.test.mjs
// 분석시트 휴지통 삭제 뒤 행이 되살아나는 문제와, A-1-2 맥락을 자동 채우기가 놓치는 문제의 회귀 검사.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { withoutDeletedRows, DELETE_RETRY_LIMIT } from '../src/components/chat/curriculum-sheet/deletedRows.ts'
import * as ctx from '../src/lib/curriculum/autofillContext.ts'

const SHEET = 'src/components/chat/CurriculumSheetModal.tsx'
const source = fs.readFileSync(new URL(`../${SHEET}`, import.meta.url), 'utf8')
const ast = ts.createSourceFile(SHEET, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function nodeText(predicate) {
  let found
  ;(function walk(node) { if (!found && predicate(node)) found = node; ts.forEachChild(node, walk) })(ast)
  assert.ok(found, 'node not found')
  return found.getText(ast)
}
const fnText = name => nodeText(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
const constText = name => nodeText(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)

test('withoutDeletedRows: 묘비가 있는 행만 빼고 원본 배열은 건드리지 않음', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(withoutDeletedRows(rows, new Map([['b', {}]])).map(r => r.id), ['a', 'c'])
  assert.deepEqual(withoutDeletedRows(rows, new Set()).map(r => r.id), ['a', 'b', 'c'])
  assert.equal(rows.length, 3)
  assert.ok(DELETE_RETRY_LIMIT >= 2)
})

test('removeRow: 대기 중인 칸·행 저장을 끊고 묘비를 세운 뒤 서버 삭제를 보냄', () => {
  const body = fnText('removeRow')
  const clearAt = body.indexOf('clearTimeout(patchTimersRef.current[key])')
  assert.ok(clearAt > 0, '타이머 정리 없음')
  assert.ok(body.includes('`__row__:${id}`') && body.includes('key.startsWith(`${id}:`)'))
  assert.ok(body.includes('pendingRowIdsRef.current.delete(id)'))
  assert.ok(body.includes('deletedRowIdsRef.current.set(id'))
  assert.ok(body.includes('deleteRowOnServer(id)'))
  assert.ok(clearAt < body.indexOf('setRows('), '저장 타이머를 화면 갱신보다 먼저 끊어야 함')
  assert.doesNotMatch(body, /saveStructuralPatch\(\{ type: 'delete-row'/, '재시도 없는 직접 삭제로 되돌리지 말 것')
})

test('늦게 온 서버 저장본·응답은 지운 행을 다시 끼워 넣지 않음', () => {
  assert.match(constText('mergeIncomingRows'), /withoutDeletedRows\(incomingRows, deletedRowIdsRef\.current\)/)
  // 편집 중이 아닐 때의 전체 교체 경로와 처음 열 때 경로도 묘비를 거른다.
  const filtered = source.match(/withoutDeletedRows\(savedRows, deletedRowIdsRef\.current\)/g) ?? []
  assert.ok(filtered.length >= 2, `전체 교체·초기 로드 경로 필터 ${filtered.length}개`)
})

test('지운 행의 행 upsert 타이머는 서버에 행을 다시 만들지 않음', () => {
  const body = constText('scheduleRowUpsert')
  assert.match(body, /if \(!fullRow \|\| deletedRowIdsRef\.current\.has\(rowId\)\)/)
})

test('삭제가 끝났는데 서버에 행이 남아 있으면 다시 지우고, 사라지면 묘비를 걷음', () => {
  const del = constText('deleteRowOnServer')
  assert.match(del, /tomb\.attempts >= DELETE_RETRY_LIMIT/)
  assert.match(del, /deletedRowIdsRef\.current\.delete\(id\)/, '끝내 실패하면 서버 상태를 다시 보여 줘야 함')
  assert.match(del, /type: 'delete-row'/)
  const reconcile = nodeText(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.getText(ast).includes('for (const [id, tomb] of [...deletedRowIdsRef.current])'))
  assert.match(reconcile, /if \(!serverIds\.has\(id\)\) deletedRowIdsRef\.current\.delete\(id\)/)
  assert.match(reconcile, /else void deleteRowOnServer\(id\)/)
  assert.match(reconcile, /if \(tomb\.inFlight\) continue/)
})

test('자동 채우기 주제: 공동 편집 창 저장본·"선정 주제" 키도 읽음', () => {
  assert.equal(ctx.resolveAutofillTopic({ manualWorkspace: { selectedTopic: '우리 동네 지도 만들기' } }), '우리 동네 지도 만들기')
  assert.equal(ctx.resolveAutofillTopic({ '선정 주제': '물의 여행' }), '물의 여행')
  assert.equal(ctx.resolveAutofillTopic({ selectedTopic: '', manualWorkspace: { selectedTopic: '  ' } }), '')
})

test('A-1-2 대화의 확정 주제 줄만 꺼내고 예시·긴 문장은 버림', () => {
  assert.equal(ctx.extractTopicFromChat([
    { role: 'assistant', content: '예시) 독서 경험 나누기' },
    { role: 'assistant', content: '정리합니다.\n- **최종 선정 주제**: 우리 고장 인구 변화 조사하기\n- 주제 유형: 혼합형' },
    { role: 'user', content: '좋아요' },
  ]), '우리 고장 인구 변화 조사하기')
  assert.equal(ctx.extractTopicFromChat([{ role: 'assistant', content: `최종 선정 주제: ${'아주 긴 문장 '.repeat(20)}` }]), '')
  assert.equal(ctx.extractTopicFromChat([{ role: 'assistant', content: '주제를 정해 볼까요?' }]), '')
  // 최신 확정이 이긴다.
  assert.equal(ctx.extractTopicFromChat([
    { role: 'assistant', content: '최종 선정 주제: 옛 주제' },
    { role: 'user', content: '선정 주제: 도시의 삶 탐구' },
  ]), '도시의 삶 탐구')
})

test('산출물에 주제가 없을 때만 대화 주제를 쓰고, 서버로 가는 a12Artifact 에도 실림', () => {
  const project = { id: 'p', targetSubjects: ['사회', '수학'], currentActivity: 'A-2-1', currentCycle: 1, artifacts: { 'A-1-2': { content: { '선정 근거': '지역 자료를 다룬다' } } } }
  const value = ctx.buildAutofillContext({ project, currentActivity: 'A-2-1', chatTopic: '도시의 인구와 교통' })
  assert.equal(value.topic, '도시의 인구와 교통')
  assert.equal(ctx.resolveAutofillTopic(value.a12Artifact), '도시의 인구와 교통')
  assert.match(value.chatContext, /\[최종 선정 주제\] 도시의 인구와 교통/)
  const saved = { ...project, artifacts: { 'A-1-2': { content: { '최종 선정 주제': '저장된 주제' } } } }
  assert.equal(ctx.buildAutofillContext({ project: saved, currentActivity: 'A-2-1', chatTopic: '대화 주제' }).topic, '저장된 주제')
})

test('워크스페이스: 저장된 주제가 없을 때만 A-1-2 대화를 한 번 읽어 맥락에 넘김', () => {
  const ws = fs.readFileSync(new URL('../src/components/chat/CurriculumWorkspaceModal.tsx', import.meta.url), 'utf8')
  assert.match(ws, /needsChatTopic = open && !!projectId && !!matchingProject && !resolveAutofillTopic\(/)
  assert.match(ws, /loadTopicFromA12Chat\(projectId\)\.then/)
  assert.match(ws, /chatTopic: needsChatTopic \? chatTopic : undefined/)
})

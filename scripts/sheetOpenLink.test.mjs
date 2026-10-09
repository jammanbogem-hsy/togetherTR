// node --test --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/sheetOpenLink.test.mjs
// 대시보드 분석맵 "시트로 보내기" 뒤 결과 안내와 "시트로 이동"(프로젝트 시트 바로 펼치기) 회귀 검사.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildSheetOpenHref,
  readSheetOpenRequest,
  sheetSentMessage,
  stripSheetOpenParams,
} from '../src/lib/curriculum/sheetOpenLink.ts'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('link round-trips the project and first new row', () => {
  const href = buildSheetOpenHref('p 1', 'cs_1_ab')
  assert.equal(href, '/projects/p%201?open=curriculum-sheet&row=cs_1_ab')
  assert.deepEqual(readSheetOpenRequest(href.slice(href.indexOf('?'))), { rowId: 'cs_1_ab' })
  assert.deepEqual(readSheetOpenRequest('?open=curriculum-sheet'), {})
  assert.equal(readSheetOpenRequest('?open=other&row=x'), null)
  assert.equal(readSheetOpenRequest(''), null)
})

test('strip removes only the open request params', () => {
  assert.equal(stripSheetOpenParams('https://a.app/projects/x?open=curriculum-sheet&row=r&tab=2#h'), '/projects/x?tab=2#h')
  assert.equal(stripSheetOpenParams('/projects/x?open=curriculum-sheet'), '/projects/x')
})

test('result message names the project and counts', () => {
  assert.match(sheetSentMessage('봄 수업', 3, 3), /‘봄 수업’ 프로젝트의 교육과정 분석 시트에 성취기준 3개를 넣었습니다/)
  assert.match(sheetSentMessage('봄 수업', 2, 5), /성취기준 5개를 2줄로 묶어 넣었습니다/)
  assert.match(sheetSentMessage('봄 수업', 0, 2), /넣을 성취기준이 없었습니다/)
})

test('send dialog asks to move to the sheet after adding', () => {
  const src = read('src/components/curriculum-map/SendToSheetDialog.tsx')
  assert.match(src, /교육과정 분석 시트로 이동하시겠습니까\?/)
  assert.match(src, /시트로 이동/)
  assert.match(src, /계속 찾기/)
  assert.match(src, /router\.push\(buildSheetOpenHref\(sent\.projectId, sent\.firstRowId\)\)/)
  assert.match(src, /setStatus\('done'\)/)
})

test('append returns the new row ids', () => {
  const src = read('src/lib/firebase/projects.ts')
  assert.match(src, /appendMapPicksToSheet\([\s\S]{0,200}Promise<\{ added: number; rowIds: string\[\] \}>/)
})

test('map view no longer relies on the easy-to-miss snackbar', () => {
  const src = read('src/components/curriculum-map/CurriculumMapView.tsx')
  assert.doesNotMatch(src, /showSnackbar|SNACKBAR_MS/)
})

test('project chat panel opens the sheet once from the link, locally only', () => {
  const src = read('src/components/chat/ChatPanel.tsx')
  const start = src.indexOf('const sheetOpenHandledRef')
  assert.ok(start > 0)
  const block = src.slice(start, start + 1200)
  assert.match(block, /readSheetOpenRequest\(window\.location\.search\)/)
  assert.match(block, /history\.replaceState\([\s\S]{0,80}stripSheetOpenParams/)
  assert.match(block, /setShowWorkspace\(true\)/)
  assert.match(block, /data-row-id/)
  assert.doesNotMatch(block, /setGraphOpen/)
})

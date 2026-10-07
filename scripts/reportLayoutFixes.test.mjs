// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/reportLayoutFixes.test.mjs
// 2026-10-07 보고서 2건: ① 부록의 넓은 표(행마다 세로 카드)가 경계 없이 일자로 이어짐 ② PDF 에서 소제목만 앞 페이지 끝에 남음
import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORT_PRINT_CSS } from '../src/components/modals/reportDashboardStyles.ts'
import { isLabelParagraph, keepHeadingsWithNext } from '../src/components/modals/downloadReportPdf.ts'
import { layoutReportPdf } from '../src/components/modals/reportPdfLayout.ts'

test('부록 카드: 행마다 테두리·왼쪽 띠, 첫 칸은 단계 색 머리 띠', () => {
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide tbody tr\{[^}]*border:1px solid var\(--report-stage-container[^}]*border-left:4px solid var\(--report-stage-band[^}]*border-radius:8px/)
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide td:first-child\{background:var\(--report-stage-container[^}]*font-weight:700/)
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide td\{[^}]*border:0!important/, '칸 사이 일자 줄 제거')
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide tbody tr\{[^}]*break-inside:avoid/, '카드는 페이지에서 쪼개지지 않음')
})

test('굵은 한 줄 문단은 소제목으로 본다', () => {
  assert.equal(isLabelParagraph('AI 점검', 'AI 점검'), true)
  assert.equal(isLabelParagraph('AI 점검 결과는 다음과 같다', 'AI 점검'), false)
  assert.equal(isLabelParagraph('', ''), false)
})

test('PDF: 소제목과 뒤따르는 첫 내용 사이에서는 나누지 않아 제목이 내용과 같은 페이지로 간다', () => {
  // 표 끝 300, 소제목 300~330, 빈칸 330~340(빈 문단), 본문 340~1200
  const breakpoints = [100, 200, 300, 330, 340, 1200]
  const kept = keepHeadingsWithNext(breakpoints, [{ start: 300, end: 1200 }])
  assert.deepEqual(kept, [100, 200, 300, 1200])
  const pageHeight = (297 - 24) * 794 / (210 - 24)
  const before = layoutReportPdf([{ height: 1300, breakpoints }])
  const after = layoutReportPdf([{ height: 1300, breakpoints: kept }])
  // 고치기 전: 첫 페이지가 소제목 아래(340)까지 들어가 제목만 남는다
  assert.ok(before[0].height >= 330 && before[0].height < pageHeight)
  assert.equal(before[1].start, 340)
  // 고친 뒤: 첫 페이지는 표 끝(300)에서 끝나고 소제목부터 다음 페이지
  assert.equal(after[0].height, 300)
  assert.equal(after[1].start, 300)
})

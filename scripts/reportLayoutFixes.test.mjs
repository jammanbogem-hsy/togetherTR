// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/reportLayoutFixes.test.mjs
// 2026-10-07 보고서 2건: ① 부록의 넓은 표(행마다 세로 카드)가 경계 없이 일자로 이어짐 ② PDF 에서 소제목만 앞 페이지 끝에 남음
import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORT_PRINT_CSS } from '../src/components/modals/reportDashboardStyles.ts'
import { isLabelParagraph, keepHeadingsWithNext } from '../src/components/modals/downloadReportPdf.ts'
import { layoutReportPdf } from '../src/components/modals/reportPdfLayout.ts'

test('부록 카드: 행마다 테두리·왼쪽 띠, 첫 칸은 단계 색 머리 띠', () => {
  assert.match(REPORT_PRINT_CSS, /\.report-table-wide tbody tr\{[^}]*border:1\.5px solid var\(--report-stage-line[^}]*border-left:4px solid var\(--report-stage-band[^}]*border-radius:8px/)
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

// ── 부록 위계(활동 제목 → 하위 항목 → 내용) ──
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../src/lib/markdown/remarkPlugins.ts'
import { cleanReportMarkdown } from '../src/lib/markdown/reportDisplay.ts'
import { REPORT_SECTIONS, findReportSection } from '../src/lib/report/reportSections.ts'
import { STAGES, displayActivityCode } from '../src/types/index.ts'
import { STAGE_COLOR } from '../src/lib/ui/stageColors.ts'
import { REPORT_DASHBOARD_CSS, reportStageColors } from '../src/components/modals/reportDashboardStyles.ts'

function loadTsx(relative, modules) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const context = { exports: {}, require: name => { if (!(name in modules)) throw new Error(`unmocked ${name}`); return modules[name] }, console }
  vm.runInNewContext(compiled, context)
  return context.exports
}
function loadReportMarkdown() {
  const icon = new Proxy({}, { get: (_, name) => props => React.createElement('svg', { ...props, 'data-icon': String(name) }) })
  const sectionIcon = loadTsx('../src/components/ui/ReportSectionIcon.tsx', { react: React, 'react/jsx-runtime': jsxRuntime, '@phosphor-icons/react': icon })
  const modules = {
    react: React, 'react/jsx-runtime': jsxRuntime, 'react-markdown': { __esModule: true, default: ReactMarkdown },
    '@/lib/markdown/remarkPlugins': { REMARK_PLUGINS }, '@/lib/markdown/reportDisplay': { cleanReportMarkdown },
    '@/components/ui/ReportSectionIcon': sectionIcon, '@/types': { STAGES, displayActivityCode },
    '@/lib/ui/stageColors': { STAGE_COLOR }, './reportDashboardStyles': { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS, reportStageColors },
    '@/lib/report/reportSections': { REPORT_SECTIONS, findReportSection }, '@phosphor-icons/react': icon,
  }
  return loadTsx('../src/components/modals/ReportMarkdown.tsx', modules)
}

test('부록: 활동 제목은 묶음 머리, 굵은 한 줄 하위 항목은 소제목으로 구분된다', () => {
  const { ReportMarkdown, isSubheadParagraph } = loadReportMarkdown()
  const markdown = '# 보고서\n\n## 부록: 산출물 원문\n\n### 공동 비전 설정 (T-1)\n\n**개인 비전**\n\n| 교사명 | 비전 |\n| --- | --- |\n| 홍 | 데이터 탐구 |\n\n**팀 공통 비전**\n\n학생들이 실생활 문제를 탐구한다.\n\n### 수업설계 방향 설정 (T-2)\n\n**설계 원칙**\n\n원칙 내용'
  const html = renderToStaticMarkup(React.createElement(ReportMarkdown, { content: markdown, stage: 'T' }))
  assert.equal((html.match(/class="report-activity"/g) ?? []).length, 2, '부록 활동마다 묶음')
  assert.match(html, /class="report-activity-heading"><h3><span class="report-activity-icon"><svg[^>]*data-icon="Eye"[^>]*><\/svg><\/span>공동 비전 설정 \(T-1\)<\/h3>/, '활동 제목 아이콘')
  assert.match(html, /<h3><span class="report-activity-icon"><svg[^>]*data-icon="Compass"/)
  assert.equal((html.match(/class="report-subhead"/g) ?? []).length, 3)
  assert.match(html, /<p class="report-subhead" data-icon="true"><svg[^>]*data-icon="Eye"[^>]*><\/svg><strong>개인 비전<\/strong><\/p>/, '하위 항목 아이콘')
  assert.match(html, /<p class="report-subhead" data-icon="true"><svg[^>]*data-icon="Compass"[^>]*><\/svg><strong>설계 원칙<\/strong>/)
  assert.doesNotMatch(html, /<p class="report-subhead">학생들이/, '일반 문단은 소제목이 아님')
  assert.equal(isSubheadParagraph({ children: [{ type: 'element', tagName: 'strong', children: [{ type: 'text', value: '핵심 키워드' }] }] }), true)
  assert.equal(isSubheadParagraph({ children: [{ type: 'element', tagName: 'strong', children: [{ type: 'text', value: '굵게' }] }, { type: 'text', value: ' 뒤 설명' }] }), false)
})

test('부록 위계 스타일: 활동 머리는 단계색 띠, 하위 내용은 들여쓰기, 소제목은 왼쪽 색 막대', () => {
  assert.match(REPORT_DASHBOARD_CSS, /\[data-report-kind="appendix"\] \.report-activity-heading\{background:var\(--report-stage-container[^}]*border-left:4px solid/)
  assert.match(REPORT_DASHBOARD_CSS, /\[data-report-kind="appendix"\] \.report-activity>:not\(\.report-activity-heading\)\{margin-left:14px\}/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-subhead:before\{content:''[^}]*background:var\(--report-stage-band/)
  assert.doesNotMatch(REPORT_DASHBOARD_CSS, /\.report-subhead\{[^}]*margin:/, '소제목 여백이 들여쓰기를 덮지 않음')
})

test('표 선은 1.5px·바탕보다 진한 선 색, 6열 표(T-3 역할 배분)는 다른 표와 같은 표 모양, 7열부터 카드', () => {
  assert.match(REPORT_DASHBOARD_CSS, /\.report-dashboard th,\.report-dashboard td\{[^}]*border-bottom:1\.5px solid var\(--report-stage-line/)
  assert.match(REPORT_DASHBOARD_CSS, /\.report-table-scroll\{[^}]*border:1\.5px solid var\(--report-stage-line/)
  const tones = reportStageColors('#1558D6')
  assert.ok(parseInt(tones.line.slice(1, 3), 16) < parseInt(tones.container.slice(1, 3), 16), '선 색이 바탕보다 진함')
  const { ReportMarkdown } = loadReportMarkdown()
  const row = cells => `| ${cells.join(' | ')} |`
  const six = ['교사명', '담당 교과', '강점', '팀 내 역할', '담당 업무', '완료 시점']
  const seven = [...six, '비고']
  const md = cols => `# 보고서\n\n## 부록: 산출물 원문\n\n### 역할 배분 (T-3)\n\n${row(cols)}\n${row(cols.map(() => '---'))}\n${row(cols.map(() => '짧음'))}`
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ReportMarkdown, { content: md(six), stage: 'T' })), /class="report-table-scroll report-table-wide"/)
  assert.match(renderToStaticMarkup(React.createElement(ReportMarkdown, { content: md(seven), stage: 'T' })), /class="report-table-scroll report-table-wide"/)
})

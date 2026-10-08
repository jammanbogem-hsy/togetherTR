import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import * as phosphorIcons from '@phosphor-icons/react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()
function load(file) {
  file = ['.tsx', '.ts', '/index.ts', ''].map(extension => file + extension).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
  if (cache.has(file)) return cache.get(file)
  const exports = {}
  cache.set(file, exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { exports, console, require: name => {
    if (name === '@phosphor-icons/react') return phosphorIcons
    if (name === 'react-markdown') return { __esModule: true, default: ReactMarkdown }
    if (name === '@/components/ontology/ProjectOntologyModal') return { PublicOntologySection: () => React.createElement('div', { 'data-public-structure': true }, '공개 구조') }
    if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2)))
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name))
    return require(name)
  } }, { filename: file })
  return exports
}
const { PublicReportViewer } = load(path.join(root, 'src/components/public/PublicReportViewer'))
const { ReportMarkdown } = load(path.join(root, 'src/components/modals/ReportMarkdown'))
const content = '# 저장된 보고서\n\n## 이 단계 핵심 요약\n\n자료를 근거로 문제를 해결합니다.\n\n## 한눈에 보기\n\n| 활동 | 산출물 |\n| --- | --- |\n| 공동 비전 | 작성됨 |\n\n## 부록: 산출물 원문\n\n### 공동 비전 설정 (T-1)\n\n**팀 공통 비전**\n\n실생활 문제를 탐구합니다.'
const report = { projectId: 'public', projectTitle: '공개 설계', schoolLevel: '초등학교', targetGradeGroup: '초3-4', targetSubjects: ['수학'], cycleCount: 1, memberCount: 2, publishedAt: 1, stageReports: { T: { content, savedAt: 1 } }, cumulativeReport: { content: '## 최종 설계\n\n공개된 최종 내용', savedAt: 1 } }

test('공개 보고서는 내부 보고서와 같은 본문·부록·표 렌더러를 사용한다', () => {
  const before = structuredClone(report)
  const html = renderToStaticMarkup(React.createElement(PublicReportViewer, { report }))
  const shared = renderToStaticMarkup(React.createElement(ReportMarkdown, { content, stage: 'T' }))
  assert.ok(html.includes(shared), '공개 단계 보고서의 HTML은 공용 렌더 결과와 동일하다')
  assert.match(html, /data-report-kind="appendix"/)
  assert.match(html, /class="report-table-scroll/)
  assert.match(html, /aria-label="최종 결과서"/)
  assert.match(html, /공개된 최종 내용/)
  assert.doesNotMatch(html, /data-status="(?:confirmed|draft|missing)"/, '공개 스냅샷에 없는 내부 산출물 상태를 만들지 않는다')
  assert.deepEqual(report, before)
})

test('공개 인쇄에는 저장된 모든 보고서와 구조를 유지하고 긴 섹션을 페이지에 나눌 수 있다', () => {
  const html = renderToStaticMarkup(React.createElement(PublicReportViewer, { report }))
  assert.equal((html.match(/class="mb-12 print-section"/g) ?? []).length, 3)
  assert.match(html, /\.public-report-viewer \.screen-only \{ display: none; \}/)
  assert.match(html, /\.public-report-viewer \.print-section \{ break-inside: auto; page-break-inside: auto; \}/)
  assert.match(html, /보고서 표/)
  assert.doesNotMatch(html, /산출물 확정하기|저장 버전/, '공개 뷰에 내부 편집·통계 동작을 추가하지 않는다')
})

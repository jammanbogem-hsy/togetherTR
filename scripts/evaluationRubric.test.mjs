// node --test --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/evaluationRubric.test.mjs
// 설계 단계(Ds-1~Ds-5) 평가 루브릭 — 표 모델, 한글 붙여넣기 HTML, HWPX, '평가 요소' 머리글, 패널 연결.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  RUBRIC_ACTIVITIES, RUBRIC_COLUMNS, isRubricActivity, normalizeRubricRows, renameLegacyRubricHeader,
  rubricToClipboardHtml, rubricToMarkdown, rubricToTsv,
} from '../src/lib/rubric/rubric.ts'
import { displayArtifactContent } from '../src/lib/artifacts/internalKeys.ts'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const row = (over = {}) => ({ id: 'r1', element: '지역 문제 이해', standard: '[4사10-02]', method: '탐구 기록지', timing: '문제 탐구 후', high: '구체적으로 설명함', mid: '설명함', low: '도움을 받아 말함', ...over })

test('rubric covers Ds-1 to Ds-5 with 평가 요소 first', () => {
  assert.deepEqual([...RUBRIC_ACTIVITIES], ['Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2'])
  assert.ok(isRubricActivity('Ds-2-2'))
  assert.ok(!isRubricActivity('A-2-1'))
  assert.equal(RUBRIC_COLUMNS[0].label, '평가 요소')
  assert.deepEqual(RUBRIC_COLUMNS.slice(-3).map(c => c.label), ['상', '중', '하'])
})

test('normalize drops blank rows and unknown keys, trims values', () => {
  const rows = normalizeRubricRows([{ element: ' 요소 ', evil: 'x', high: 3 }, { element: '' }, null])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].element, '요소')
  assert.equal(rows[0].high, '')
  assert.ok(rows[0].id)
  assert.equal('evil' in rows[0], false)
  assert.deepEqual(normalizeRubricRows('nope'), [])
})

test('markdown and TSV keep one row per rubric line and escape separators', () => {
  const md = rubricToMarkdown([row({ high: 'A | B\n둘째 줄' })])
  const lines = md.split('\n')
  assert.equal(lines[0], '| 평가 요소 | 근거 성취기준 | 평가 방법 | 평가 시점 | 상 | 중 | 하 |')
  assert.equal(lines.length, 3)
  assert.match(lines[2], /A ｜ B 둘째 줄/)
  const tsv = rubricToTsv([row({ low: 'a\tb' })]).split('\n')
  assert.equal(tsv[0].split('\t').length, 7)
  assert.equal(tsv[1].split('\t')[6], 'a b')
  assert.equal(rubricToMarkdown([]), '')
})

test('clipboard HTML is a bordered table Hangul can paste, with escaped text', () => {
  const html = rubricToClipboardHtml([row({ element: '<b>x</b> & y', high: '첫 줄\n둘째 줄' })], '평가 루브릭')
  assert.match(html, /<table style="border-collapse:collapse;/)
  assert.equal((html.match(/<th /g) ?? []).length, 7)
  assert.match(html, /border:1px solid #000000;/)
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; y/)
  assert.match(html, /첫 줄<br>둘째 줄/)
  assert.doesNotMatch(html, /<b>x<\/b>/)
})

test('legacy rubric header 평가 항목 is shown as 평가 요소 only in rubric tables', () => {
  const md = '| 평가 항목 | 근거 성취기준 | 상 | 중 | 하 |\n|---|---|---|---|---|\n| 평가 항목 정리 | x | a | b | c |\n\n| 평가 항목 | 방법 |\n|---|---|'
  const out = renameLegacyRubricHeader(md).split('\n')
  assert.equal(out[0], '| 평가 요소 | 근거 성취기준 | 상 | 중 | 하 |')
  assert.equal(out[2], '| 평가 항목 정리 | x | a | b | c |')
  assert.equal(out[4], '| 평가 항목 | 방법 |')
  const shown = displayArtifactContent({ 기록: md }, 'Ds-1-1').content.기록
  assert.match(shown, /^\| 평가 요소 \|/)
})

test('HWPX file from a rubric contains a table with the 평가 요소 header', async () => {
  const { generateHwpx } = await import('../src/lib/hwpx/generateHwpx.ts')
  const JSZip = (await import('jszip')).default
  const blob = await generateHwpx(`# 루브릭\n\n${rubricToMarkdown([row()])}\n`, '루브릭')
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const section = await zip.file('Contents/section0.xml').async('string')
  assert.match(section, /<hp:tbl /)
  assert.match(section, /평가 요소/)
  assert.match(section, /도움을 받아 말함/)
})

test('Ds-1 prompt asks for the 평가 요소 header', () => {
  const src = read('src/lib/prompts/system.ts')
  assert.match(src, /\| 평가 요소 \| 근거 성취기준 \| 평가 방법 \| 평가 시점 \| 상 \| 중 \| 하 \|/)
  assert.doesNotMatch(src, /\| 평가 항목 \| 근거 성취기준/)
})

test('suggest route grounds 상·중·하 in official achievement levels', () => {
  const src = read('src/app/api/rubric/suggest/route.ts')
  assert.match(src, /knownStandardCodesIn\(texts\)/)
  assert.match(src, /buildAchievementLevelContext\('Ds-1-1', levelCodes\)/)
  assert.match(src, /상↔A, 중↔B, 하↔C/)
  assert.match(src, /isRubricActivity\(body\?\.activityCode\)/)
})

test('artifact panel shows the rubric in team, empty, training and preview views', () => {
  const src = read('src/components/artifacts/ArtifactPanel.tsx')
  assert.equal((src.match(/\{rubricSection\}/g) ?? []).length, 3)
  assert.match(src, /\{rubricButton && <span className="ml-auto">\{rubricButton\}<\/span>\}/)
  assert.match(src, /\n {12}\{rubricButton\}\n/)
  assert.equal((src.match(/\{rubricEditor\}/g) ?? []).length, 2)
  assert.match(src, /<RubricBlock rows=\{modalRubricRows\}/)
  assert.match(src, /canEditRubric = rubricActivity && !!project && !observationOnly && !adminObserverView/)
  assert.match(src, /setActivityRubric\(project\.id, viewingActivity, rows/)
})

test('rubric is saved in its own member-writable field, not in artifacts', () => {
  const src = read('src/lib/firebase/projects.ts')
  assert.match(src, /const field = `evaluationRubrics\.\$\{activityCode\}`/)
  const rules = read('firestore.rules')
  assert.doesNotMatch(rules, /'evaluationRubrics'/)
})

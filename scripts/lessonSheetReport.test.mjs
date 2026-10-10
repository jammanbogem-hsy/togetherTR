// Trial report: '수업 실행 나눔 기록지' next to stage reports, with a format vote.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/lessonSheetReport.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildLessonSheetPrompt, hasLessonSheetSources, lessonSheetSources, LESSON_SHEET_EMPTY } from '../src/lib/report/lessonSheetPrompt.ts'
import { dashboardProject, summarizeDashboard } from '../src/lib/admin/dashboardModel.ts'

const artifacts = {
  'T-1-1': { title: '비전', content: { '팀 공통 비전': '주도적인 시민', _schema: 'x', manualWorkspace: { rows: [] } } },
  'Ds-1-1': { title: '평가', content: { '평가 계획': '| 요소 | 잘함 |' } },
  'E-1-1': { title: '성찰', content: {} },
}

test('prompt follows the training record sheet and only uses saved artifacts', () => {
  const prompt = buildLessonSheetPrompt({ project: { title: '지구촌 문제', targetGradeGroup: '초5-6', targetSubjects: ['사회', '도덕'] }, members: [{ name: '김교사', role: '기록 담당' }], artifacts })
  for (const heading of ['## 0. 팀 정보', '## 1. 수업 설계', '### 평가 루브릭', '### 학습활동 계획', '## 1-1. 다른 팀 피드백', '### 2-1. 우리 팀의 수업 성찰 KPT', '### 2-2. 우리 팀의 협력 성찰 KPT']) assert.ok(prompt.includes(heading), heading)
  assert.match(prompt, /\| 단계 \| 교수·학습 활동 \| 스캐폴딩 \| 자료·AI·디지털 도구 \| 시간 \|/)
  assert.match(prompt, /지어내지 말고/)
  assert.match(prompt, /김교사\(기록 담당\)/)
  const sources = lessonSheetSources(artifacts)
  assert.match(sources, /\[T-1\] /)
  assert.doesNotMatch(sources, /_schema|manualWorkspace/)
  assert.doesNotMatch(sources, /\[E-1\]/, 'empty artifacts are skipped')
  assert.equal(hasLessonSheetSources(artifacts), true)
  assert.equal(hasLessonSheetSources({ 'E-1-1': { title: '', content: {} } }), false)
  assert.equal(LESSON_SHEET_EMPTY, '(기록 없음)')
})

test('dashboard counts lesson sheets and format votes', () => {
  const now = Date.UTC(2026, 9, 10)
  const a = dashboardProject('a', { title: 'A', lessonSheetReport: { savedAt: now }, reportFormatVotes: { u1: 'sheet', u2: 'stage', u3: 'sheet', u4: 'bogus' } }, now)
  const b = dashboardProject('b', { title: 'B', reportFormatVotes: { u5: 'stage' } }, now)
  const summary = summarizeDashboard([a, b], now, { members: null, messages: null })
  assert.equal(summary.totals.lessonSheets, 1)
  assert.deepEqual(summary.totals.reportVotes, { stage: 2, sheet: 2 })
})

test('wiring: card on top of the stage report list, own modal, host-only generation, per-user vote', () => {
  const modal = fs.readFileSync('src/components/modals/StageReportsModal.tsx', 'utf8')
  assert.match(modal, /<LessonSheetCard onOpen=\{generate => setLessonSheet\(generate\)\} \/>\n\s+\{savedStages\.map/)
  const lib = fs.readFileSync('src/lib/report/lessonSheet.ts', 'utf8')
  assert.match(lib, /if \(!canGenerateStageReport\(project, callerUid\)\) throw/)
  assert.match(lib, /\[`reportFormatVotes\.\$\{uid\}`\]: current === format \? deleteField\(\) : format/)
  const route = fs.readFileSync('src/app/api/report/lesson-sheet/route.ts', 'utf8')
  assert.match(route, /resolveOpenAIModel\('utility'\)/)
})

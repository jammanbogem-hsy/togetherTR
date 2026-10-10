// Per-stage test reports: the training record sheet's structure applied to every stage, with a format vote.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/lessonSheetReport.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildStageTestReportPrompt, hasStageTestSources, TEST_REPORT_EMPTY } from '../src/lib/report/lessonSheetPrompt.ts'
import { dashboardProject, summarizeDashboard } from '../src/lib/admin/dashboardModel.ts'

const artifacts = {
  'T-1-1': { title: '비전', content: { '팀 공통 비전': '주도적인 시민', _schema: 'x', manualWorkspace: { rows: [] } } },
  'A-2-2': { title: '목표', content: { '통합 목표': '해결 방안을 제안한다' } },
  'Ds-1-1': { title: '평가', content: { '평가 계획': '| 요소 | 잘함 |' } },
  'E-1-1': { title: '성찰', content: {} },
}
const project = { title: '지구촌 문제', targetGradeGroup: '초5-6', targetSubjects: ['사회', '도덕'] }

test('every stage gets a record-sheet template: 항목/무엇을 쓰나 tables and a KPT block', () => {
  const expected = { T: ['## 0. 팀 정보', '## 2. 역할 배분', '팀준비 협력 KPT'], A: ['## 2. 교육과정 분석', '통합 학습 목표'], Ds: ['## 1. 평가 루브릭', '## 3. 학습활동 계획', '| 단계 | 교수·학습 활동 | 스캐폴딩 | 자료·AI·디지털 도구 | 시간 |'], DI: ['## 2. 수업 실행 기록', '| 시점 | 상황 | 학생 반응 | 증거 |'], E: ['우리 팀의 수업 성찰 KPT', '우리 팀의 협력 성찰 KPT', '## 4. 다음 주기'] }
  for (const [stage, headings] of Object.entries(expected)) {
    const prompt = buildStageTestReportPrompt({ stage, project, members: [{ name: '김교사', role: '기록 담당' }], artifacts })
    assert.ok(prompt.includes(`# ${{ T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가' }[stage]}(${stage}) 단계 기록지`), stage)
    assert.match(prompt, /\| 항목 \| (무엇을 쓰나 \| 작성|내용) \|/)
    assert.match(prompt, /\| K 유지할 것 \|/)
    for (const heading of headings) assert.ok(prompt.includes(heading), `${stage}: ${heading}`)
    assert.match(prompt, /지어내지 말고/)
  }
})

test('stage sources come first; earlier stages are context only; empty/internal content is skipped', () => {
  const ds = buildStageTestReportPrompt({ stage: 'Ds', project, members: [], artifacts })
  const [, own, context] = ds.split(/## 이 단계 산출물|## 앞 단계 참고/)
  assert.match(own, /\[Ds-1\] /)
  assert.doesNotMatch(own, /\[T-1\]/)
  assert.match(context, /\[T-1\] /)
  assert.match(context, /\[A-4\] /)
  assert.doesNotMatch(ds, /_schema|manualWorkspace/)
  assert.equal(hasStageTestSources('Ds', artifacts), true)
  assert.equal(hasStageTestSources('E', artifacts), false, 'empty E artifacts do not count')
  assert.equal(TEST_REPORT_EMPTY, '(기록 없음)')
})

test('dashboard counts test reports per stage and format votes', () => {
  const now = Date.UTC(2026, 9, 10)
  const a = dashboardProject('a', { title: 'A', testReports: { T: { savedAt: now }, Ds: { savedAt: now } }, reportFormatVotes: { u1: 'sheet', u2: 'stage', u3: 'sheet', u4: 'bogus' } }, now)
  const b = dashboardProject('b', { title: 'B', reportFormatVotes: { u5: 'stage' } }, now)
  const summary = summarizeDashboard([a, b], now, { members: null, messages: null })
  assert.equal(summary.totals.lessonSheets, 2)
  assert.deepEqual(summary.totals.reportVotes, { stage: 2, sheet: 2 })
})

test('wiring: test report row inside each stage card, own modal, host-only generation, per-user vote', () => {
  const modal = fs.readFileSync('src/components/modals/StageReportsModal.tsx', 'utf8')
  assert.match(modal, /<TestReportRow stage=\{stageInfo\.code\} onOpen=\{generate => setTestReport\(\{ stage: stageInfo\.code, generate \}\)\} \/>/)
  const lib = fs.readFileSync('src/lib/report/lessonSheet.ts', 'utf8')
  assert.match(lib, /if \(!canGenerateStageReport\(project, callerUid\)\) throw/)
  assert.match(lib, /\[`testReports\.\$\{stage\}`\]:/)
  assert.match(lib, /\[`reportFormatVotes\.\$\{uid\}`\]: current === format \? deleteField\(\) : format/)
  assert.match(fs.readFileSync('src/app/api/report/lesson-sheet/route.ts', 'utf8'), /STAGES\.some\(stage => stage\.code === body\.stage\)/)
})

// Regression tests for 성취기준 → 성취수준 → 학습활동 → 평가 alignment (src/lib/curriculum/alignment.ts).
// Run: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/alignment.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAlignment, levelsNearCode } from '../src/lib/curriculum/alignment.ts'

const ds11Structured = {
  _schema: 'Ds-1-1',
  rubric: [
    { checkpoint: '인터뷰 직후', item: '인터뷰 내용을 요약한다 ([4국01-01])', method: '기록지', timing: '과정', actor: '교사' },
    { checkpoint: '책자 발표', item: '효과와 문제를 분석한다 ([4사03-02])', method: '루브릭', timing: '결과', actor: '교사', high: '[4사03-02] A 원문' },
    { checkpoint: '모둠 활동', item: '역할을 맡아 진행 상황을 공유한다', method: '관찰', timing: '과정', actor: '동료' },
  ],
}
const ds13Structured = {
  _schema: 'Ds-1-3',
  activities: [
    { order: '1', phase: '정보 탐색', name: '이웃 인터뷰하기', description: '인터뷰를 듣고 요약한다. (근거: [4국01-01] B)', coreType: '핵심', subject: '국어', session: '1~2차시', operation: '' },
    { order: '2', phase: '분석', name: '자료 비교하기', description: '여러 자료로 효과와 문제를 도출한다. (근거: [4사03-02] A, [4국01-01] A)', coreType: '핵심', subject: '사회', session: '3차시', operation: '' },
  ],
}

test('levelsNearCode: reads A·B·C written right after the code', () => {
  assert.deepEqual(levelsNearCode('(근거: [4사03-02] A, [4국01-01] B)', '[4사03-02]'), ['A'])
  assert.deepEqual(levelsNearCode('[4사03-02]의 B 수준, 이후 [4사03-02] C', '[4사03-02]'), ['B', 'C'])
  assert.deepEqual(levelsNearCode('[4사03-02] Apple', '[4사03-02]'), [])
  assert.deepEqual(levelsNearCode('코드 없음', '[4사03-02]'), [])
})

test('buildAlignment: links rows by code mention and exposes gaps', () => {
  const result = buildAlignment(['[4사03-02]', '[4국01-01]', '[4수01-01]'], ds11Structured, ds13Structured)
  assert.equal(result.hasEvaluationArtifact, true)
  assert.equal(result.hasActivityArtifact, true)
  const [soc, kor, math] = result.rows
  assert.deepEqual(soc.activities, [{ label: '3차시 자료 비교하기', levels: ['A'] }])
  assert.equal(soc.evaluations.length, 1)
  assert.equal(soc.evaluations[0].label, '효과와 문제를 분석한다')
  assert.deepEqual(soc.evaluations[0].levels, ['A'])
  assert.deepEqual(kor.activities.map(a => a.levels), [['B'], ['A']])
  assert.deepEqual(math.activities, [])
  assert.deepEqual(math.evaluations, [])
})

test('buildAlignment: parses legacy markdown-table artifacts', () => {
  const ds11Legacy = { '평가 계획': '| 확인 지점 | 평가 요소 | 평가 방법 | 평가 시점 | 평가 주체 |\n|---|---|---|---|---|\n| 발표 | 효과 분석 ([4사03-02]) | 루브릭 | 결과 | 교사 |' }
  const ds13Legacy = { '학습 활동': '| 순서 | 흐름 단계 | 활동명 | 활동 설명 | 핵심/부가 | 담당 교과 | 누적 차시 | 차시 운영 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 분석 | 자료 비교하기 | 도출한다. (근거: [4사03-02] A) | 핵심 | 사회 | 3차시 | - |' }
  const [row] = buildAlignment(['[4사03-02]'], ds11Legacy, ds13Legacy).rows
  assert.deepEqual(row.evaluations, [{ label: '효과 분석', levels: [] }])
  assert.deepEqual(row.activities, [{ label: '3차시 자료 비교하기', levels: ['A'] }])
})

test('buildAlignment: missing artifacts are "not designed yet", not gaps', () => {
  const result = buildAlignment(['[4사03-02]'], undefined, null)
  assert.equal(result.hasEvaluationArtifact, false)
  assert.equal(result.hasActivityArtifact, false)
  assert.deepEqual(result.rows[0], { code: '[4사03-02]', evaluations: [], activities: [] })
})

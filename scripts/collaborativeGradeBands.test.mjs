// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/collaborativeGradeBands.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveAutofillGradeBands, includeTeamSubjects, setCenterInGradeBand, chooseBandCenters, mergeAutofillRows } from '../src/lib/curriculum/collaborativeBands.ts'
import { buildTeamGradeBandUpdate, needsMultiBandModeRepair } from '../src/lib/curriculum/teamGradeBandState.ts'
import { filterGraphToGradeBand, standardBelongsToBand } from '../src/lib/curriculum/graphGradeBands.ts'
import { loadGraph } from '../src/lib/curriculum/graphReader.ts'
import { buildA21DirectAnswer } from '../src/lib/curriculum/a21DirectAnswer.ts'
import { buildCurriculumContext } from '../src/lib/curriculum/contextInject.ts'
import { buildCurriculumSheetArtifactProposal, mergeGraphAgentExamplesIntoRows } from '../src/lib/curriculum/graphSheetBridge.ts'
import { parseA21Table } from '../src/lib/artifacts/schemas.ts'

const bands = ['1-2학년군', '3-4학년군', '5-6학년군']
test('empty sheet uses all confirmed team bands, regardless of the representative grade', () => {
  assert.deepEqual(resolveAutofillGradeBands({ subject: '국어', teamGradeBands: bands, defaultBand: '초5-6' }), bands)
  assert.deepEqual(resolveAutofillGradeBands({ subject: '국어', rowBands: ['초5-6'], teamGradeBands: bands, defaultBand: '초5-6' }), bands)
})
test('a one-row fill remains scoped to its explicitly requested band', () => {
  assert.deepEqual(resolveAutofillGradeBands({ subject: '국어', selectedBands: ['초3-4'], teamGradeBands: bands, defaultBand: '초5-6' }), ['3-4학년군'])
})
test('multi-band subjects follow actual availability and include integrated studies for low grades', () => {
  assert.deepEqual(includeTeamSubjects(['사회', '국어'], bands), ['사회', '국어', '통합교과'])
  assert.deepEqual(resolveAutofillGradeBands({ subject: '사회', teamGradeBands: bands }), bands.slice(1))
  assert.deepEqual(resolveAutofillGradeBands({ subject: '실과', teamGradeBands: bands }), ['5-6학년군'])
  assert.deepEqual(resolveAutofillGradeBands({ subject: '통합교과', teamGradeBands: bands }), ['1-2학년군'])
  assert.deepEqual(resolveAutofillGradeBands({ subject: '사회', selectedBands: ['1-2학년군'] }), [])
})
test('legacy single-band callers still work', () => {
  assert.deepEqual(resolveAutofillGradeBands({ subject: '국어', defaultBand: '초3-4' }), ['3-4학년군'])
  assert.deepEqual(includeTeamSubjects(['사회'], ['5-6학년군']), ['사회'])
})
test('recognition repairs an old single switch while preserving old row grade and contents', () => {
  const project = { targetGradeGroup: '초5-6', curriculumSheetGradeMode: 'single', curriculumSheet: [{ id: 'old', subject: '국어', standard: '[6국01-01]', description: '교사 작성 내용' }] }
  const updated = buildTeamGradeBandUpdate(project, bands)
  assert.equal(updated.curriculumSheetGradeMode, 'multi')
  assert.equal(updated.targetGradeGroup, '초1-2')
  assert.equal(updated.curriculumSheet[0].gradeBand, '5-6학년군')
  assert.equal(updated.curriculumSheet[0].description, '교사 작성 내용')
  assert.equal(needsMultiBandModeRepair({ ...project, teamGradeBands: bands }), true)
  assert.equal(needsMultiBandModeRepair(updated), false)
  assert.equal(buildTeamGradeBandUpdate(project, ['3-4학년군']).targetGradeGroup, '초3-4')
})

const rows = [
  { id: 'low', subject: '통합교과', gradeBand: bands[0], coreIdea: '우리의 생활', standard: '[2슬01-01]', isCenter: true },
  { id: 'high', subject: '사회', gradeBand: bands[2], coreIdea: '사회와 환경', standard: '[6사01-01]', isCenter: true },
  { id: 'high-kor', subject: '국어', gradeBand: bands[2], coreIdea: '의사소통', standard: '[6국01-01]', isCenter: false },
]
test('changing a high-grade center keeps the low-grade center; unchecking is scoped too', () => {
  const changed = setCenterInGradeBand(rows, 'high-kor', bands[2])
  assert.deepEqual(changed.filter(r => r.isCenter).map(r => r.id), ['low', 'high-kor'])
  assert.deepEqual(setCenterInGradeBand(changed, null, bands[2]).filter(r => r.isCenter).map(r => r.id), ['low'])
})
test('generated rows choose one center per band and respect each band’s previous choice', () => {
  const chosen = chooseBandCenters(rows.map(r => ({ ...r, isCenter: false })), [rows[0], { ...rows[2], isCenter: true }])
  assert.deepEqual(chosen.filter(r => r.isCenter).map(r => r.id), ['low', 'high-kor'])
})
test('adding missing grades does not replace teacher text or duplicate rows on retry', () => {
  const existing = [{ ...rows[1], description: '수정 금지 교사 설명', knowledge: '기존 내용' }]
  const incoming = [{ ...rows[1], id: 'generated', description: 'AI 설명', knowledge: 'AI 내용' }, rows[0]]
  const merged = mergeAutofillRows(existing, incoming)
  assert.equal(merged.find(r => r.id === 'high').description, '수정 금지 교사 설명')
  assert.equal(merged.find(r => r.id === 'high').knowledge, '기존 내용')
  assert.equal(merged.length, 2)
  assert.equal(mergeAutofillRows(merged, incoming).length, 2)
})
test('artifact round trip keeps both grade bands and each center', () => {
  const proposal = buildCurriculumSheetArtifactProposal(rows, { gradeMode: 'multi', gradeGroup: '초1-2' })
  const parsed = parseA21Table(proposal.sections['성취기준분석표'])
  assert.equal(parsed.filter(r => r.subject.includes('★중심')).length, 2)
  assert.match(proposal.sections['성취기준분석표'], /1-2학년군/)
  assert.match(proposal.sections['성취기준분석표'], /5-6학년군/)
})

const graph = loadGraph()
const high = graph.achievementStandards.find(s => s.code === '[6국01-01]')
const graphData = { centerNode: { id: high.id, label: high.code, subjectId: high.subject_id, text: high.text }, selectedStandards: [], agentNotes: [] }
test('graph filtering removes wrong-grade centers and their notes, including inconsistent metadata', () => {
  assert.equal(filterGraphToGradeBand(graphData, bands[0], graph.achievementStandards).centerNode, null)
  assert.equal(filterGraphToGradeBand(graphData, bands[2], graph.achievementStandards).centerNode.id, high.id)
  assert.equal(standardBelongsToBand({ code: '[6국01-01]', grade_band: '초1-2' }, bands[0]), false)
})
test('regression: [6국01-01] never appears in the low-grade answer or evidence block', () => {
  const messages = [{ role: 'user', content: '대화와 의사소통 주제의 성취기준과 핵심아이디어를 보여주세요' }]
  const answer = buildA21DirectAnswer({ activityCode: 'A-2-1', messages, gradeGroup: '초1-2', teamGradeBands: [bands[0], bands[2]], targetSubjects: ['국어'], graphSavedData: graphData })
  const context = buildCurriculumContext('A-2-1', messages, '초1-2', undefined, graphData, ['국어'], [bands[0], bands[2]])
  for (const value of [answer, context]) {
    const lowBlock = value.split('### 1-2학년군')[1].split('### 5-6학년군')[0]
    assert.equal(lowBlock.includes(high.code), false)
    assert.ok(value.split('### 5-6학년군')[1].includes(high.code))
  }
})
test('a graph center lesson example does not overwrite a different grade’s center', () => {
  const result = mergeGraphAgentExamplesIntoRows([{ ...rows[0], agentLessonExample: '저학년 수업' }], {
    ...graphData, selectedStandards: [{ id: 'other', label: '[6사01-01]', subjectId: 'sub_soc', text: '고학년 사회' }],
  })
  assert.equal(result.rows[0].agentLessonExample, '저학년 수업')
})

// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/internalKeys.test.mjs
// TASK-V1: 산출물 content 의 내부 키(manualWorkspace·'_' 접두)는 어디에도 섹션으로 나열하지 않는다.
// 연수 양식 저장은 _schema·구조화 별칭을 지우고 manualWorkspace 만 남겨 'MANUALWORKSPACE' 섹션으로 원본 JSON 이 보였다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { displayArtifactContent, isInternalArtifactKey, workspaceTableMarkdown, withoutInternalArtifactKeys } from '../src/lib/artifacts/internalKeys.ts'
import { serializeArtifactForPrompt } from '../src/lib/artifacts/serializeArtifactForPrompt.ts'
import { buildArtifactOriginals, buildOverviewTable } from '../src/lib/report/stageReportPrompt.ts'
import { buildSystemPrompt } from '../src/lib/prompts/system.ts'

// 운영 연수 시험 프로젝트 T-5 와 같은 모양: 양식 저장 뒤 _schema·schedule 은 지워지고 manualWorkspace 만 남음
const workspace = {
  columns: [{ id: 'period', label: '기간' }, { id: 'activity', label: '활동' }, { id: 'assignee', label: '담당' }],
  rows: [
    { id: 'r1', cells: { period: '10월 1주', activity: '주제 협의 | 결정', assignee: '홍' } },
    { id: 'r2', cells: { period: '', activity: '', assignee: '' } },
    { id: 'r3', cells: { period: '10월 2주', activity: '수업 실행\n기록', assignee: '김' } },
  ],
  blocks: [{ id: 'b1', type: 'paragraph', content: '메모' }],
  updatedAt: 1759000000000, updatedBy: 'host',
}
const trainingT23 = { '정기 회의': '매주 수요일', manualWorkspace: workspace, _schemaVersion: 'v1' }
const LEAK = /manualWorkspace|MANUALWORKSPACE|"blocks"|"rows"|"columns"|updatedBy|1759000000000/

test('내부 키 판정과 제거', () => {
  assert.equal(isInternalArtifactKey('manualWorkspace'), true)
  assert.equal(isInternalArtifactKey('_schema'), true)
  assert.equal(isInternalArtifactKey('팀 일정'), false)
  assert.deepEqual(Object.keys(withoutInternalArtifactKeys(trainingT23)), ['정기 회의'])
})

test('공동 편집 표 → 한국어 머리글 마크다운 표(빈 행 제외, | 와 줄바꿈 정리)', () => {
  assert.equal(workspaceTableMarkdown(workspace), [
    '| 기간 | 활동 | 담당 |', '| --- | --- | --- |',
    '| 10월 1주 | 주제 협의 \\| 결정 | 홍 |', '| 10월 2주 | 수업 실행 / 기록 | 김 |',
  ].join('\n'))
  assert.equal(workspaceTableMarkdown({ columns: workspace.columns, rows: [workspace.rows[1]] }), '')
  assert.equal(workspaceTableMarkdown(undefined), '')
})

test('표시용 content: 섹션이 비어 있을 때만 표로 채우고 저장값은 바꾸지 않는다', () => {
  const before = structuredClone(trainingT23)
  const shown = displayArtifactContent(trainingT23, 'T-2-3')
  assert.deepEqual(Object.keys(shown.content), ['정기 회의', '팀 일정'])
  assert.deepEqual(shown.derivedKeys, ['팀 일정'])
  assert.match(shown.content['팀 일정'], /\| 기간 \| 활동 \| 담당 \|/)
  assert.deepEqual(trainingT23, before)
  const filled = displayArtifactContent({ ...trainingT23, '팀 일정': '양식에 적은 일정' }, 'T-2-3')
  assert.equal(filled.content['팀 일정'], '양식에 적은 일정')
  assert.deepEqual(filled.derivedKeys, [])
  assert.deepEqual(Object.keys(displayArtifactContent(trainingT23, 'A-2-2').content), ['정기 회의', '공동 편집 표'])
  const structured = { _schema: 'T-2-3', schedule: [], manualWorkspace: workspace }
  assert.equal(displayArtifactContent(structured, 'T-2-3').content, structured, '구조화 산출물은 전용 렌더러가 다룬다')
})

function loadArtifactContent() {
  const source = fs.readFileSync(new URL('../src/components/artifacts/ArtifactPanel.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('ArtifactPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found, blocked
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'ArtifactContent') found = node
    if (ts.isVariableStatement(node) && node.getText(tree).startsWith('const DISPLAY_BLOCKED_KEYS')) blocked = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const compiled = ts.transpileModule(`${blocked.getText(tree)}\nexports.ArtifactContent = ${found.getText(tree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const sections = []
  const context = {
    exports: {}, require: name => { if (name === 'react/jsx-runtime') return jsxRuntime; throw new Error(name) },
    displayArtifactContent, isInternalArtifactKey, FileText: () => null,
    StructuredArtifactRenderer: () => React.createElement('div', null, 'structured'),
    ArtifactSection: props => { sections.push(props); return React.createElement('section', null, `${props.sectionKey}::${props.value}`) },
  }
  vm.runInNewContext(compiled, context)
  return { ArtifactContent: context.exports.ArtifactContent, sections }
}

test('산출물 패널·상세 모달 본문(ArtifactContent): MANUALWORKSPACE 섹션 대신 팀 일정 표, 표시용 섹션엔 삭제 없음', () => {
  const { ArtifactContent, sections } = loadArtifactContent()
  const html = renderToStaticMarkup(React.createElement(ArtifactContent, { content: trainingT23, activityCode: 'T-2-3', onDeleteSection: () => {} }))
  assert.doesNotMatch(html, LEAK)
  assert.deepEqual(sections.map(s => s.sectionKey), ['정기 회의', '팀 일정'])
  assert.equal(typeof sections[0].onDelete, 'function')
  assert.equal(sections[1].onDelete, undefined)
  assert.match(String(sections[1].value), /\| 10월 1주 \|/)
})

test('보고서 원문·개요·AI 입력에도 내부 데이터가 들어가지 않는다', () => {
  const originals = buildArtifactOriginals('T', { 'T-2-3': { content: trainingT23 } })
  assert.doesNotMatch(originals['T-2-3'], LEAK)
  assert.match(originals['T-2-3'], /팀 일정/)
  assert.match(originals['T-2-3'], /10월 2주/)
  assert.match(buildOverviewTable('T', { 'T-2-3': { content: trainingT23 } }), /팀 일정 결정|T-5/)
  assert.doesNotMatch(serializeArtifactForPrompt({ a: '1', manualWorkspace: workspace, _schema: 'x' }), LEAK)
  const prompt = buildSystemPrompt('T', 'T-2-3', { title: 't', schoolLevel: '초등', targetGradeGroup: '3-4학년군', targetSubjects: ['사회'], mode: 'collaborative', isA23Completed: false, currentCycle: 1 }, '팀+AI', undefined,
    { title: '팀 일정', content: trainingT23, status: 'in_review', version: 2 }, undefined,
    { 'T-2-2': { title: '팀 규칙', content: { '팀 규칙': '서로 존중', manualWorkspace: workspace }, status: 'confirmed' } })
  assert.doesNotMatch(prompt, LEAK)
  assert.match(prompt, /10월 1주/)
})

test('전수: src 에서 산출물 content 를 섹션으로 나열하는 곳은 내부 키 필터를 거친다', () => {
  const files = [
    'src/components/artifacts/ArtifactPanel.tsx', 'src/lib/report/stageReportPrompt.ts', 'src/app/api/analyze/cumulative/route.ts',
    'src/components/stage/StageBar.tsx', 'src/lib/artifacts/serializeArtifactForPrompt.ts', 'src/lib/curriculum/alignment.ts',
    'src/lib/ontology/projectOntology.ts', 'src/lib/prompts/system.ts', 'src/components/chat/ArtifactSaveProposal.tsx',
  ]
  for (const file of files) assert.match(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /isInternalArtifactKey/, file)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { STAGES, ACTIVITY_META } from '../src/types/index.ts'
import { isTrainingActivity } from '../src/lib/training/trainingMode.ts'

const source = fs.readFileSync(new URL('../src/components/artifacts/ArtifactPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ArtifactPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate, required = true) {
  let result
  function walk(node) { if (predicate(node)) result = node; ts.forEachChild(node, walk) }
  walk(tree); if (required) assert.ok(result); return result
}
const variable = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
const definition = name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree)
function execute(code, bindings) {
  const context = { exports: {}, ...bindings, require(name) { if (name === 'react/jsx-runtime') return jsx; throw new Error(name) } }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context
}
const artifacts = {
  'T-1-1': { title: '저장된 공동 비전', content: { '팀 공통 비전': '함께 살피기' }, version: 3, status: 'confirmed' },
  'T-2-3': { title: '저장된 팀 일정', content: { '팀 일정': '매주 화요일' }, version: 2, status: 'in_review' },
  'A-1-1': { title: '현재 기준', content: { '주제 선정 기준': '학생 삶과의 연결' }, version: 1, status: 'in_review' },
  'A-1-2': { title: '미래 활동', content: { '최종 선정 주제': '폭염' }, version: 1, status: 'confirmed' },
  'T-2-2': { title: '빈 이전 활동', content: {}, version: 1, status: 'in_review' },
  unknown: { title: '알 수 없는 활동', content: { note: '제외' } },
}

function panelFixture(training = true, current = 'A-1-1', stored = artifacts) {
  const project = { id: 'room', artifacts: stored, trainingMode: { enabled: training, coreFormal: false } }
  const select = variable('previousArtifacts').initializer.arguments[0]
  const rawList = find(node => ts.isJsxExpression(node) && node.expression?.getText(tree).includes('previousArtifacts.length > 0') && node.expression.getText(tree).includes('previousArtifacts.map'), false)
  const sharedList = find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'previousArtifactList', false)
  const sharedPreview = find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'artifactPreview', false)
  const trainingBranch = find(node => ts.isIfStatement(node) && node.expression.getText(tree) === 'project && isTrainingActivity(project, viewingActivity)')
  const setup = execute(`const ARTIFACT_RELATION_HINT = ${variable('ARTIFACT_RELATION_HINT').initializer.getText(tree)}; ${definition('computeArtifactRelation')}; exports.select = ${select.getText(tree)}`, {
    project, viewingActivity: current, ACTIVITY_META, orderedActivities: STAGES.flatMap(stage => stage.activities),
  })
  const previousArtifacts = setup.exports.select()
  let formContent
  const context = execute(`
    ${definition('openArtifactPreview')}
    ${definition('openPreviousArtifactPreview')}
    exports.render = () => {
      const previousArtifactList = ${sharedList?.initializer.getText(tree) ?? rawList.expression.getText(tree)};
      const artifactPreview = ${sharedPreview?.initializer.getText(tree) ?? '<ArtifactPreviewModal modal={previewModal} onClose={() => setPreviewModal(null)} />'};
      ${trainingBranch.getText(tree)}
      return <>{previousArtifactList}{artifactPreview}</>;
    };
  `, {
    project, viewingActivity: current, isTrainingActivity, previousArtifacts,
    RELATION_STYLE: execute(`exports.value = ${variable('RELATION_STYLE').initializer.getText(tree)}`, {}).exports.value,
    CheckCircle: () => null, cn: (...values) => values.filter(Boolean).join(' '), Stack: () => null, CaretLeft: () => null, ArrowsOut: () => null,
    firestoreArtifact: stored[current], displayContent: stored[current]?.content ?? {}, displayArtifact: null, hasContent: false,
    effectiveStatus: 'in_review', activityMeta: ACTIVITY_META[current], routeParams: { id: 'room' }, observationOnly: false,
    isHost: false, isConfirmed: false, isSaving: false, artifactError: '', previewModal: null,
    StatusBadge: () => null, MD3Button: ({ children }) => React.createElement('button', {}, children),
    TrainingForm: ({ content }) => { formContent = content; return React.createElement('textarea', { readOnly: true, defaultValue: content['주제 선정 기준'] ?? '' }) },
    ArtifactPreviewModal: ({ modal, onClose }) => modal ? React.createElement('aside', { 'aria-label': '산출물 미리보기' }, modal.title, React.createElement('button', { onClick: onClose }, '닫기')) : null,
    setPreviewModal(value) { context.previewModal = value },
  })
  function elements(value, type) {
    if (!value || typeof value !== 'object') return []
    if (Array.isArray(value)) return value.flatMap(child => elements(child, type))
    return [...(value.type === type ? [value] : []), ...elements(value.props?.children, type)]
  }
  return { previousArtifacts, context, elements, tree: () => context.exports.render(), html: () => renderToStaticMarkup(context.exports.render()), get formContent() { return formContent } }
}

test('A1 history: 일반 화면에는 있지만 연수 조기 return에서 누락되던 저장 목록을 같은 데이터로 표시', () => {
  const regular = panelFixture(false), training = panelFixture(true)
  assert.match(regular.html(), /저장된 산출물 \(이전 활동\)/)
  const html = training.html()
  assert.match(html, /저장된 산출물 \(이전 활동\)/)
  assert.match(html, /저장됨 2/)
  for (const label of ['공동 비전 설정', '팀 일정 결정']) assert.ok(html.includes(label), label)
  assert.equal(training.formContent, artifacts['A-1-1'].content, '현재 저장값은 양식에 원형 그대로 전달')
  assert.match(html, /학생 삶과의 연결/)
})

test('A1 history: 현재/미래/빈/알 수 없는 활동 제외와 최신 이전 활동 먼저 정렬은 일반·연수 동일', () => {
  for (const mode of [false, true]) {
    const f = panelFixture(mode)
    assert.deepEqual(Array.from(f.previousArtifacts, item => item.code), ['T-2-3', 'T-1-1'])
    const html = f.html()
    assert.ok(html.indexOf('팀 일정 결정') < html.indexOf('공동 비전 설정'))
    assert.doesNotMatch(html, /미래 활동|알 수 없는 활동|빈 이전 활동/)
  }
})

test('A1 history: 이전 카드 열기는 원래 제목·내용·버전·활동/단계·상태를 미리보기에 넘기고 닫기 가능', () => {
  for (const mode of [false, true]) {
    const f = panelFixture(mode)
    const button = f.elements(f.tree(), 'button').find(element => element.props.onClick)
    button.props.onClick()
    const modal = f.context.previewModal
    assert.equal(modal.title, artifacts['T-2-3'].title)
    assert.equal(modal.content, artifacts['T-2-3'].content)
    assert.equal(modal.activityCode, 'T-2-3')
    assert.equal(modal.stageCode, 'T')
    assert.equal(modal.status, 'in_review')
    assert.match(modal.subtitle, /버전 2/)
    assert.match(f.html(), /산출물 미리보기/)
    f.context.setPreviewModal(null)
    assert.doesNotMatch(f.html(), /산출물 미리보기/)
  }
})

test('A1 history: 다른 연수 활동도 같은 목록을 사용하며 저장 이력이 없으면 목록 없음·데이터 불변', () => {
  const before = structuredClone(artifacts)
  const other = panelFixture(true, 'Ds-1-1')
  assert.match(other.html(), /저장된 산출물 \(이전 활동\)/)
  assert.deepEqual(Array.from(other.previousArtifacts, item => item.code), ['A-1-2', 'A-1-1', 'T-2-3', 'T-1-1'])
  assert.doesNotMatch(panelFixture(true, 'A-1-1', {}).html(), /저장된 산출물 \(이전 활동\)/)
  assert.deepEqual(artifacts, before)
})

test('saved training record presents one save workflow with no separate confirmation or cancellation action', () => {
  const fixture = panelFixture(true)
  fixture.context.isHost = true
  fixture.context.hasContent = true
  fixture.context.displayArtifact = { title: '연수 기록' }
  fixture.context.handleConfirm = () => { throw new Error('Separate confirmation should not be presented') }
  fixture.context.handleRedraft = () => {}
  for (const status of ['in_review', 'confirmed']) {
    fixture.context.effectiveStatus = status
    fixture.context.isConfirmed = status === 'confirmed'
    const html = fixture.html()
    assert.match(html, /저장됨/)
    assert.doesNotMatch(html, /산출물 확정하기|확정 취소|재검토/)
    assert.ok(fixture.formContent)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as record from '../src/lib/training/trainingRecord.ts'
import * as mode from '../src/lib/training/trainingMode.ts'
import * as state from '../src/components/training/trainingFormState.ts'
import * as types from '../src/types/index.ts'
import { getDemoActivityContract } from '../src/lib/activity/demo-contracts.ts'
import { artifactContentEquals } from '../src/lib/chat/artifactSignalBatch.ts'
import { gateArtifactSave, previousSectionText } from '../src/lib/chat/artifactSaveGate.ts'
import { resolveAutofillTopic } from '../src/lib/curriculum/autofillContext.ts'

const code = 'Ds-2-2', K = record.TRAINING_RECORD_KEY
const legacy = { '스캐폴딩 계획': '자료 찾기를 어려워하는 학생에게 표 틀을 제공합니다.', '지원 방안 정리': '친구와 함께 연습합니다.', 'AI 점검': '스스로 하면 틀을 줄입니다.' }
const project = { id: 'p', hostUid: 'host', createdBy: 'host', mode: 'collaborative', trainingMode: { enabled: true, coreFormal: false }, artifacts: {} }
function component(path, bindings) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, require: name => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return jsx
    if (Object.hasOwn(bindings, name)) return bindings[name]
    throw Error(`Unmocked ${name}`)
  } })
  return exports
}
const { TrainingFieldInput } = component('../src/components/training/TrainingFieldInput.tsx', {})
const store = callback => callback({ userProfile: { uid: 'host', displayName: '교사' }, messages: [] })
const { TrainingForm } = component('../src/components/training/TrainingForm.tsx', {
  'firebase/firestore': {}, '@/types': types, '@/lib/training/trainingMode': mode, '@/lib/firebase/projects': {},
  '@/store/project': { useProjectStore: store }, '@/lib/chat/artifactSignalBatch': { artifactContentEquals },
  '@/lib/activity/demo-contracts': { getDemoActivityContract }, '@/components/ui/MD3Button': { MD3Button: ({ children }) => React.createElement('button', {}, children) },
  './trainingFormState': state, '@/lib/training/trainingRecord': record, './useTrainingAdvice': { useTrainingAdvice: () => [true, () => {}] }, './TrainingFieldInput': { TrainingFieldInput },
})

test('all training activities render exactly one large named textarea without required/optional field groups', () => {
  for (const activityCode of Object.keys(mode.TRAINING_ACTIVITIES)) {
    const html = renderToStaticMarkup(React.createElement(TrainingForm, { project, activityCode, content: {}, loaded: true }))
    assert.equal((html.match(/<textarea/g) ?? []).length, 1, activityCode)
    assert.match(html, /aria-label="활동 기록"/)
    assert.match(html, /rows="12"/)
    assert.doesNotMatch(html, /아직 비어 있는 필수 칸|선택 칸|role="group"/)
  }
})
test('old multi-field records and structured colleague names load into one text without losing content or metadata', () => {
  const previous = { ...legacy, _schema: code, manualWorkspace: { secret: 'hide' } }
  const text = record.trainingRecordText(code, previous)
  for (const value of Object.values(legacy)) assert.ok(text.includes(value))
  assert.doesNotMatch(text, /manualWorkspace|_schema|hide/)
  assert.deepEqual(record.buildTrainingRecordContent(code, previous, text), previous)
  const roles = record.trainingRecordText('T-2-1', { roles: [{ teacherName: '홍성용', subject: '사회', role: '회의 주최' }, { teacherName: '홍지안', subject: '국어', role: '자료 조사' }] })
  for (const text of ['홍성용', '홍지안', '회의 주최', '자료 조사']) assert.ok(roles.includes(text))
  assert.doesNotMatch(roles, /teacherName|\[object Object\]/)
})
test('free prose replaces old bodies, can be reopened exactly, and deleting a section does not resurrect it', () => {
  const prose = '자료 찾기 활동에 표 틀을 제공합니다.\n학생이 익숙해지면 틀을 줄입니다.'
  const saved = record.buildTrainingRecordContent(code, legacy, prose)
  assert.deepEqual(saved, { [K]: prose })
  assert.equal(record.trainingRecordText(code, saved), prose)
  const changed = record.trainingRecordText(code, legacy).replace(/\n\n## AI 점검[\s\S]*/, '')
  const removed = record.buildTrainingRecordContent(code, legacy, changed)
  assert.equal(removed['AI 점검'], undefined)
  assert.equal(removed['지원 방안 정리'], legacy['지원 방안 정리'])
  assert.equal(record.trainingRecordText(code, record.buildTrainingRecordContent(code, legacy, '  ')), '')
})
test('known section headings preserve topic resolver compatibility; fenced text and unfamiliar headings stay literal', () => {
  const previous = { selectedTopic: '지역 인구', rationale: '생활 연결', _schema: 'A-1-2' }
  const text = record.trainingRecordText('A-1-2', previous).replace('지역 인구', '기온 변화')
  const saved = record.buildTrainingRecordContent('A-1-2', previous, text)
  assert.equal(resolveAutofillTopic(saved), '기온 변화')
  assert.equal(saved['선정 근거'], '생활 연결')
  const literal = '메모\n```markdown\n## 최종 선정 주제\n코드 예시\n```\n## 내 생각\n그대로 유지'
  assert.equal(record.buildTrainingRecordContent('A-1-2', {}, literal)[K], literal)
})
test('AI full-record save replaces old sections and legacy partial updates preserve unrelated content', () => {
  const updated = record.mergeTrainingRecordUpdate(code, legacy, { [K]: '합의한 새 지원 계획' })
  assert.equal(record.trainingRecordText(code, updated), '합의한 새 지원 계획')
  assert.equal(updated['AI 점검'], undefined)
  const partial = record.mergeTrainingRecordUpdate(code, legacy, { '지원 방안 정리': '짝의 도움' })
  assert.equal(partial['스캐폴딩 계획'], legacy['스캐폴딩 계획'])
  assert.equal(partial['지원 방안 정리'], '짝의 도움')
})
test('AI updates sync untouched text, preserve local draft/intentional deletion, and acknowledge identical saves', () => {
  const initial = record.createTrainingRecordDraft(code, {})
  const fromAI = record.syncTrainingRecordDraft(initial, code, legacy)
  assert.equal(fromAI.text, record.trainingRecordText(code, legacy))
  const local = { ...fromAI, text: '작성 중인 전체 기록' }
  const incoming = record.syncTrainingRecordDraft(local, code, { [K]: 'AI 새 기록' })
  assert.equal(incoming.text, local.text)
  assert.equal(incoming.conflict, true)
  assert.equal(incoming.sourceText, 'AI 새 기록')
  assert.equal(record.syncTrainingRecordDraft({ ...local, text: '' }, code, legacy).text, '')
  const ack = record.syncTrainingRecordDraft(local, code, { [K]: local.text })
  assert.equal(ack.conflict, false)
  assert.equal(ack.text, ack.sourceText)
})
test('single-record AI saves retain evidence and dropped-row guards', () => {
  const table = '| 활동 | 지원 |\n|---|---|\n| 조사 | 자료 |\n| 발표 | 예시 |'
  const gated = gateArtifactSave({ currentActivity: 'Ds-1-3', updates: [{ sections: { [K]: '| 활동 | 지원 |\n|---|---|\n| 조사 | 자료 (근거: [4과01-01]) |' } }], confirmCodes: ['Ds-1-3'], allowedCodes: ['[4과02-01]'], recentUserTexts: ['표를 유지해 주세요'], previousSection: (activity, key) => previousSectionText({ '학습 활동': table }, activity, key) })
  assert.equal(gated.updates.length, 0)
  assert.equal(gated.confirmCodes.length, 0)
  assert.ok(gated.notices.some(text => text.includes('빠져')))
  const evidenceOnly = gateArtifactSave({ currentActivity: 'Ds-1-3', updates: [{ sections: { [K]: '조사하기 (근거: [4과01-01])' } }], confirmCodes: [], allowedCodes: ['[4과02-01]'], recentUserTexts: [], previousSection: () => '' })
  assert.doesNotMatch(evidenceOnly.updates[0].sections[K], /4과01-01/)
  assert.match(evidenceOnly.updates[0].sections[K], /확인 필요/)
})

function saveHarness({ fail = false, member = false } = {}) {
  const source = fs.readFileSync(new URL('../src/components/training/TrainingForm.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('TrainingForm.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fn
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'save') fn = n; ts.forEachChild(n, visit) }
  visit(tree)
  const writes = [], notices = [], errors = []
  let release
  const pending = new Promise(resolve => { release = resolve })
  const draft = { text: '홍성용: 회의 주최\n홍지안: 자료 조사' }
  const context = {
    ...record, ...state, ...mode, ACTIVITY_META: types.ACTIVITY_META, exports: {}, project, activityCode: code,
    content: legacy, draft, user: { uid: member ? 'member' : 'host', displayName: '교사' }, savingRef: { current: false }, readOnly: false, quiet: false, advice: true,
    useProjectStore: { getState: () => ({ project, viewingActivity: code, currentActivity: code, setCurrentArtifact() {} }) },
    setSaving() {}, setError: v => errors.push(v), setFeedback() {}, setDraft() {}, setOneSaveAdvice() {}, Timestamp: { now: () => 123 }, artifactContentEquals,
    setProjectArtifact: async (...args) => { writes.push(args); await pending; if (fail) throw Error('offline') },
    proposeArtifactToHost: async (...args) => { writes.push(args); await pending; if (fail) throw Error('offline') }, requestTrainingChatSend: v => notices.push(v),
  }
  vm.runInNewContext(ts.transpileModule(`exports.save=${fn.getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...context.exports, writes, notices, errors, draft, release }
}
test('actual save handler locks duplicate sends, awaits success and keeps whole text on failure/retry', async () => {
  for (const member of [false, true]) {
    const h = saveHarness({ member, fail: true })
    const pending = h.save()
    await h.save()
    assert.equal(h.writes.length, 1)
    assert.equal(h.notices.length, 0)
    h.release(); await pending
    assert.match(h.errors.at(-1), /入力|입력한 내용은 그대로/)
    assert.match(h.draft.text, /홍지안/)
    await h.save()
    assert.equal(h.writes.length, 2)
  }
  const h = saveHarness()
  const pending = h.save(); h.release(); await pending
  assert.equal(h.writes[0][2].content[K], h.draft.text)
  assert.equal(h.writes[0][2].content['AI 점검'], undefined)
  assert.equal(h.notices.length, 1)
})

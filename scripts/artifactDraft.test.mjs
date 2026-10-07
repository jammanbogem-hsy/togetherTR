// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/artifactDraft.test.mjs
// #S1 재현: T-1 산출물이 저장된 뒤 공동 편집을 열면 예전 초안(핵심 키워드 한 줄)만 보이고 팀 공통 비전·개인 비전 표가 없었다.
// 원인 ① 초안에 글자가 하나라도 있으면 산출물을 보지 않음 ② 연수 양식 산출물(_schema 없는 섹션 글)은 표로 읽지 못함.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as Y from 'yjs'
import * as artifactDraft from '../src/lib/coedit/artifactDraft.ts'
import { isBlankWorkspace } from '../src/lib/coedit/workspaceBlank.ts'
import { mergeWorkspaceTransaction, WORKSPACE_CRDT_FIELD } from '../src/lib/coedit/firestore-workspace.ts'

const { artifactSavedAt, decideArtifactDraft, fillBlankDraft, stabilizeRowIds, structuredArtifactContent, workspaceSignature } = artifactDraft

function loadNormalize(file) {
  const source = fs.readFileSync(new URL(`../src/components/artifacts/${file}`, import.meta.url), 'utf8') + '\nexports.__normalize = normalizeWorkspace;'
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const stub = new Proxy(function () {}, { get: (_t, key) => key === '__esModule' ? true : key === Symbol.toPrimitive ? () => '' : stub, apply: () => stub, construct: () => stub })
  const real = { react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/coedit/workspaceBlank': { isBlankWorkspace }, '@/lib/coedit/artifactDraft': artifactDraft }
  const context = { exports: {}, require: name => real[name] ?? stub, console, Math, Date, JSON, Object, Array, Set, Map, String, Number }
  vm.runInNewContext(compiled, context)
  return context.exports.__normalize
}
const plain = value => JSON.parse(JSON.stringify(value))
const normalizeT11 = loadNormalize('TeamVisionWorkspaceModal.tsx')

// 운영 보고와 같은 모양: 예전 공동 초안은 핵심 키워드 한 줄, 그 뒤 연수 양식으로 산출물 저장(섹션 글 + 옛 manualWorkspace)
const oldDraft = { columns: [], rows: [], teamVision: '', coreKeywords: ['협력'], blocks: [], updatedAt: 1000 }
const trainingArtifact = {
  title: '공동 비전 설정', status: 'in_review', version: 2, updatedAt: 5000,
  content: {
    '팀 공통 비전': '학생이 함께 묻고 탐구하며 삶과 연결하는 수업',
    '개인 비전': '| 교사명 | 담당 교과 | 개인 비전 키워드 | AI 정교화 비전 |\n| --- | --- | --- | --- |\n| 김민지 | 사회 | 탐구, 협력 | 학생이 스스로 질문하는 사회 수업 |\n| 이수진 | 과학 | 실험, 데이터 | 데이터로 근거를 세우는 과학 수업 |',
    '핵심 키워드': '협력, 탐구, 삶과 연결',
    manualWorkspace: { rows: [], coreKeywords: ['협력'], teamVision: '' },
  },
}

test('재현: 고치기 전 경로는 산출물을 버리고 옛 초안만 보여 준다', () => {
  const before = plain(normalizeT11(oldDraft, trainingArtifact.content))
  assert.equal(before.teamVision, '')
  assert.equal(before.rows.length, 0)
})

test('연수 양식 산출물(섹션 글)도 구조화해 표로 읽는다', () => {
  const structured = structuredArtifactContent('T-1-1', trainingArtifact.content)
  assert.equal(structured._schema, 'T-1-1')
  assert.equal(structured.manualWorkspace, undefined, '섹션 글 산출물의 옛 초안은 쓰지 않음')
  const ws = plain(normalizeT11(undefined, structured))
  assert.equal(ws.teamVision, '학생이 함께 묻고 탐구하며 삶과 연결하는 수업')
  assert.deepEqual(ws.rows.map(row => row.cells.teacherName), ['김민지', '이수진'])
  assert.match(ws.rows[0].cells.refinedVision, /스스로 질문/)
  assert.deepEqual(ws.coreKeywords, ['협력', '탐구', '삶과 연결'])
  // 초안이 비어 있으면 처음부터 산출물로 연다(이전에는 _schema 가 없어 빈 표였다)
  assert.equal(plain(normalizeT11(undefined, trainingArtifact.content)).rows.length, 0, '고치기 전: 섹션 글 산출물은 빈 표')
})

test('수정: 산출물이 더 새로우면 산출물 기준으로 바꾼다(T-1 사용자 시나리오)', () => {
  const draft = normalizeT11(oldDraft)
  const artifactWs = normalizeT11(undefined, structuredArtifactContent('T-1-1', trainingArtifact.content))
  const decision = decideArtifactDraft({ draft, artifactWorkspace: artifactWs, draftAt: oldDraft.updatedAt, artifactAt: artifactSavedAt(trainingArtifact) })
  assert.equal(decision.action, 'replace')
  assert.equal(decision.reason, 'artifact-newer')
  assert.equal(plain(decision.target).teamVision, '학생이 함께 묻고 탐구하며 삶과 연결하는 수업')
  assert.equal(plain(decision.target).rows.length, 2)
})

test('초안이 더 새로우면 초안을 지키고 빈 칸만 산출물로 채운다', () => {
  const draft = normalizeT11({ ...oldDraft, coreKeywords: ['새로 고친 키워드'], updatedAt: 9000 })
  const artifactWs = normalizeT11(undefined, structuredArtifactContent('T-1-1', trainingArtifact.content))
  const decision = decideArtifactDraft({ draft, artifactWorkspace: artifactWs, draftAt: 9000, artifactAt: 5000 })
  assert.equal(decision.action, 'fill')
  const target = plain(decision.target)
  assert.deepEqual(target.coreKeywords, ['새로 고친 키워드'], '초안에 쓴 글은 그대로')
  assert.equal(target.teamVision, '학생이 함께 묻고 탐구하며 삶과 연결하는 수업', '빈 비전은 채움')
  assert.equal(target.rows.length, 2, '내용 없는 표는 채움')
})

test('시각을 모르면 빈 칸만 채우고 산출물로 바꾸는 것은 고르게 남긴다, 같은 내용이면 아무것도 안 한다', () => {
  const draft = normalizeT11({ ...oldDraft, coreKeywords: ['다른 키워드'], updatedAt: undefined })
  const artifactWs = normalizeT11(undefined, structuredArtifactContent('T-1-1', trainingArtifact.content))
  const decision = decideArtifactDraft({ draft, artifactWorkspace: artifactWs, draftAt: undefined, artifactAt: undefined })
  assert.equal(decision.action, 'fill')
  assert.ok(decision.offer, '산출물 내용 불러오기 선택지')
  assert.equal(decideArtifactDraft({ draft: artifactWs, artifactWorkspace: { ...artifactWs, updatedAt: 1 }, draftAt: 1, artifactAt: 2 }).action, 'keep')
  assert.equal(decideArtifactDraft({ draft, artifactWorkspace: normalizeT11(undefined, undefined), draftAt: 1, artifactAt: 2 }).action, 'keep', '빈 산출물은 무시')
})

test('산출물 시각: updatedAt → confirmedAt → 이력 저장 시각', () => {
  assert.equal(artifactSavedAt({ updatedAt: 5, confirmedAt: 9 }), 5)
  assert.equal(artifactSavedAt({ confirmedAt: 9, versions: [{ savedAt: 3 }] }), 9)
  assert.equal(artifactSavedAt({ versions: [{ savedAt: 3 }, { savedAt: 7 }] }), 7)
  assert.equal(artifactSavedAt({}), undefined)
})

test('동시에 두 사람이 바꿔도 같은 행 id — CRDT 에서 행이 두 벌 생기지 않는다', () => {
  const a = stabilizeRowIds({ rows: [{ id: 'rand1', cells: { x: '1' } }] }, { rows: [] }, '5000')
  const b = stabilizeRowIds({ rows: [{ id: 'rand2', cells: { x: '1' } }] }, { rows: [] }, '5000')
  assert.deepEqual(a, b)
  const kept = stabilizeRowIds({ rows: [{ id: 'keep', cells: {} }] }, { rows: [{ id: 'keep' }] }, '1')
  assert.equal(kept.rows[0].id, 'keep')
})

test('12개 전용 창 모두: 산출물이 새로우면 산출물 표, 오래되면 초안 표를 지킨다', () => {
  const modals = { TeamVision: 'T-1-1', LessonDesignDirection: 'T-1-2', RoleDistribution: 'T-2-1', TeamRules: 'T-2-2', TeamSchedule: 'T-2-3', TopicSelection: 'A-1-2',
    IntegratedGoal: 'A-2-2', EvaluationPlan: 'Ds-1-1', ProblemSituation: 'Ds-1-2', LearningActivity: 'Ds-1-3', SupportTool: 'Ds-2-1', Scaffolding: 'Ds-2-2' }
  for (const [name, code] of Object.entries(modals)) {
    const normalize = loadNormalize(`${name}WorkspaceModal.tsx`)
    const empty = plain(normalize(undefined, undefined))
    const column = empty.columns?.[0]?.id ?? 'c1'
    const columns = empty.columns?.length ? empty.columns : [{ id: column, label: '내용' }]
    const draftRaw = { ...empty, columns, rows: [{ id: 'd1', cells: { [column]: '옛 초안 칸' } }], updatedAt: 1000 }
    const artifactWs = normalize(undefined, { _schema: code, manualWorkspace: { ...empty, columns, rows: [{ id: 'a1', cells: { [column]: '산출물 최신 칸' } }] } })
    const draft = normalize(draftRaw)
    const newer = decideArtifactDraft({ draft, artifactWorkspace: artifactWs, draftAt: 1000, artifactAt: 2000 })
    assert.equal(newer.action, 'replace', name)
    assert.match(workspaceSignature(newer.target), /산출물 최신 칸/, name)
    const older = decideArtifactDraft({ draft, artifactWorkspace: artifactWs, draftAt: 3000, artifactAt: 2000 })
    assert.notEqual(older.action, 'replace', name)
    assert.match(workspaceSignature(older.target), /옛 초안 칸/, name)
  }
})

test('12개 창 모두 공용 훅을 자기 활동·필드로 연결하고 배너를 그린다', () => {
  const expected = { TeamVision: ['T-1-1', 'teamVisionWorkspace'], LessonDesignDirection: ['T-1-2', 'lessonDesignDirectionWorkspace'], RoleDistribution: ['T-2-1', 'roleDistributionWorkspace'],
    TeamRules: ['T-2-2', 'teamRulesWorkspace'], TeamSchedule: ['T-2-3', 'teamScheduleWorkspace'], TopicSelection: ['A-1-2', 'topicSelectionWorkspace'], IntegratedGoal: ['A-2-2', 'integratedGoalWorkspace'],
    EvaluationPlan: ['Ds-1-1', 'evaluationPlanWorkspace'], ProblemSituation: ['Ds-1-2', 'problemSituationWorkspace'], LearningActivity: ['Ds-1-3', 'learningActivityWorkspace'],
    SupportTool: ['Ds-2-1', 'supportToolWorkspace'], Scaffolding: ['Ds-2-2', 'scaffoldingWorkspace'] }
  for (const [name, [code, field]] of Object.entries(expected)) {
    const source = fs.readFileSync(new URL(`../src/components/artifacts/${name}WorkspaceModal.tsx`, import.meta.url), 'utf8')
    assert.match(source, new RegExp(`useArtifactDraftSync\\(\\{\\s*open, projectId, activityCode: '${code}', workspaceField: '${field}'`), name)
    assert.match(source, /\{artifactDraft\.banner\}/, name)
    assert.doesNotMatch(source, /normalizeWorkspace\(savedWorkspace, artifactContent\)/, `${name}: 섹션 글 산출물을 구조화해 읽어야 함`)
  }
})

test('CRDT 저장본에 저장 시각을 남기고, 내용이 같으면 다시 쓰지 않는다', () => {
  const project = { currentCycle: 1, trainingMode: { enabled: true } }
  const options = { workspaceField: 'teamVisionWorkspace', initialWorkspace: normalizeT11(oldDraft) }
  const first = mergeWorkspaceTransaction(project, options, 1)
  const entry = first.updates[`${WORKSPACE_CRDT_FIELD}.teamVisionWorkspace`]
  assert.equal(typeof entry.savedAt, 'number')
  const stored = { ...project, [WORKSPACE_CRDT_FIELD]: { teamVisionWorkspace: entry }, teamVisionWorkspace: first.updates.teamVisionWorkspace }
  assert.deepEqual(mergeWorkspaceTransaction(stored, options, 1).updates, {})
  assert.ok(Y)
})

// ── 공용 훅 실제 실행(가짜 React 훅) ──
function loadHook(env) {
  const source = fs.readFileSync(new URL('../src/components/artifacts/useArtifactDraftSync.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const states = [], refs = [], deps = [], queue = []
  let si = 0, ri = 0, ei = 0
  const fakeReact = {
    useState: init => { const i = si++; if (!(i in states)) states[i] = typeof init === 'function' ? init() : init; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v }] },
    useRef: init => { const i = ri++; return refs[i] ??= { current: init } },
    useEffect: (fn, d) => { const i = ei++; const prev = deps[i]; if (!d || !prev || d.some((x, k) => !Object.is(x, prev[k]))) { deps[i] = d; queue.push(fn) } },
  }
  const modules = {
    react: fakeReact, 'react/jsx-runtime': jsxRuntime,
    '@/store/project': { useProjectStore: select => select({ project: env.project }) },
    '@/lib/firebase/projects': { backupWorkspaceDraft: async (...args) => { env.backups.push(args); if (env.backupFails) throw new Error('offline'); return 'saved' } },
    '@/lib/coedit/artifactDraft': artifactDraft, '@/lib/coedit/workspaceBlank': { isBlankWorkspace },
    '@/components/ui/MD3Button': { MD3Button: props => React.createElement('button', null, props.children) },
  }
  const context = { exports: {}, require: name => modules[name], console: { ...console, warn() {} }, setTimeout, clearTimeout, localStorage: undefined }
  vm.runInNewContext(compiled, context)
  return props => { si = ri = ei = 0; const out = context.exports.useArtifactDraftSync(props); for (const fn of queue.splice(0)) fn(); return out }
}
const settle = async t => { t.mock.timers.tick(1500); for (let i = 0; i < 20; i++) await Promise.resolve() }

function hookProps(env, overrides = {}) {
  const draft = normalizeT11(oldDraft)
  return {
    open: true, projectId: 'p', activityCode: 'T-1-1', workspaceField: 'teamVisionWorkspace', workspace: draft, incoming: draft,
    savedWorkspace: oldDraft, artifactContent: trainingArtifact.content, normalize: normalizeT11,
    realtime: { enabled: false, ready: true }, othersEditing: false, currentUid: 'host',
    apply: async next => { env.applied.push(plain(next)) }, ...overrides,
  }
}

test('훅: 혼자면 이전 초안을 보관한 뒤 산출물 기준으로 바꾼다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = { project: { artifacts: { 'T-1-1': trainingArtifact } }, backups: [], applied: [] }
  const render = loadHook(env)
  render(hookProps(env))
  await settle(t)
  assert.equal(env.backups.length, 1, '바꾸기 전 보관')
  assert.equal(env.backups[0][1], 'teamVisionWorkspace')
  assert.deepEqual(plain(env.backups[0][2]).coreKeywords, ['협력'])
  assert.equal(env.applied.length, 1)
  assert.equal(env.applied[0].teamVision, '학생이 함께 묻고 탐구하며 삶과 연결하는 수업')
  assert.equal(render(hookProps(env)).banner, null)
})

test('훅: 다른 선생님이 편집 중이면 덮지 않고 배너로 고르게 한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = { project: { artifacts: { 'T-1-1': trainingArtifact } }, backups: [], applied: [] }
  const render = loadHook(env)
  render(hookProps(env, { othersEditing: true }))
  await settle(t)
  assert.equal(env.applied.length, 0)
  assert.equal(env.backups.length, 0)
  const { banner } = render(hookProps(env, { othersEditing: true }))
  assert.ok(banner)
  assert.match(JSON.stringify(banner.props), /산출물 최신 내용 불러오기/)
})

test('훅: 이전 초안을 보관하지 못하면 바꾸지 않는다(손실 0)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = { project: { artifacts: { 'T-1-1': trainingArtifact } }, backups: [], applied: [], backupFails: true }
  const render = loadHook(env)
  render(hookProps(env))
  await settle(t)
  assert.equal(env.applied.length, 0)
  assert.match(JSON.stringify(render(hookProps(env)).banner.props), /보관하지 못해/)
})

test('훅: 실시간 표는 연결 준비 뒤 CRDT 저장 시각과 비교한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = { project: { artifacts: { 'T-1-1': trainingArtifact }, coeditWorkspaceCrdt: { teamVisionWorkspace: { savedAt: 9999 } } }, backups: [], applied: [] }
  const render = loadHook(env)
  render(hookProps(env, { realtime: { enabled: true, ready: false } }))
  await settle(t)
  assert.equal(env.applied.length, 0, '준비 전에는 판단하지 않음')
  render(hookProps(env, { realtime: { enabled: true, ready: true } }))
  await settle(t)
  assert.equal(env.backups.length, 0, 'CRDT 가 더 새로우면 덮지 않고 빈 칸만')
  assert.equal(env.applied.length, 1)
  assert.deepEqual(env.applied[0].coreKeywords, ['협력'], '초안 글 유지')
  assert.equal(env.applied[0].teamVision, '학생이 함께 묻고 탐구하며 삶과 연결하는 수업')
})

test('fillBlankDraft 는 초안에 쓴 칸을 바꾸지 않는다', () => {
  const filled = fillBlankDraft({ title: '내 제목', note: '', rows: [{ id: 'r', cells: { a: '내 칸' } }] }, { title: '산출물 제목', note: '산출물 메모', rows: [{ id: 'x', cells: { a: '산출물 칸' } }] })
  assert.deepEqual(filled, { title: '내 제목', note: '산출물 메모', rows: [{ id: 'r', cells: { a: '내 칸' } }] })
})

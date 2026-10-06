import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { STAGES, ACTIVITY_META } from '../src/types/index.ts'
import * as reportState from '../src/lib/report/stageReportState.ts'

const project = { id: 'room', title: '폭염', createdBy: 'host', currentStage: 'Ds', targetGradeGroup: '3-4', targetSubjects: ['사회'], artifacts: { 'T-1-1': { title: '비전', content: { 비전: '같이 찾기' }, updatedAt: 200 } }, stageReports: { T: { content: '기존 보고서', savedAt: 100 } } }
function source(file) { return fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') }
function load(file, bindings) {
  const context = { exports: {}, require(name) { if (name in bindings) return bindings[name]; throw new Error(`Unmocked ${name}`) } }
  vm.runInNewContext(ts.transpileModule(source(file), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context.exports
}
function streamed(events) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  let pos = 0
  return new Response(new ReadableStream({ pull(controller) {
    if (pos === bytes.length) { controller.close(); return }
    const end = Math.min(pos + 7, bytes.length); controller.enqueue(bytes.slice(pos, end)); pos = end
  } }))
}
function generatorFixture(events, override = {}) {
  const calls = [], texts = [], controller = new AbortController()
  const api = {
    async setAnalysisReport(...args) { calls.push(['analysis', ...args]) },
    async saveStageReport(...args) { calls.push(['save', ...args]) },
    ...override,
  }
  const code = ts.transpileModule(source('src/lib/report/generateStageReport.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { exports: {}, TextDecoder, fetch: async (_url, options) => { calls.push(['request', _url, JSON.parse(options.body), options.signal]); return streamed(events) }, require(name) {
    if (name === '@/types') return { STAGES, ACTIVITY_META }
    if (name === './stageReportState') return reportState
    if (name === '@/lib/firebase/projects') return api
    throw new Error(name)
  } }
  vm.runInNewContext(code, context)
  const args = { project, stage: 'T', callerUid: 'host', signal: controller.signal, onText: text => texts.push(text), onStreaming() {} }
  return { run: extra => context.exports.generateStageReport({ ...args, ...extra }), calls, texts, controller }
}

test('R1 report: 대상 단계 저장 산출물만 포함하고 다른 단계·전체 프로젝트 갱신은 변경 배지에 영향 없음', () => {
  assert.equal(reportState.stageHasArtifacts(project, 'T'), true)
  assert.equal(reportState.stageHasArtifacts(project, 'A'), false)
  assert.equal(reportState.stageReportChanged(project, 'T'), true)
  assert.equal(reportState.stageReportChanged({ ...project, updatedAt: 999, artifacts: { 'T-1-1': { updatedAt: 100 }, 'Ds-1-1': { updatedAt: 900 } } }, 'T'), false)
  const legacy = { artifacts: { 'T-1-1': { confirmedAt: 101, versions: [{ savedAt: 102 }] } }, stageReports: project.stageReports }
  assert.equal(reportState.stageArtifactLastSavedAt(legacy, 'T'), 102)
  assert.equal(reportState.stageReportChanged(legacy, 'T'), true)
  assert.equal(reportState.stageArtifactLastSavedAt({ artifacts: { 'T-1-1': { meta: { updatedAt: { seconds: 2, nanoseconds: 3e6 } } } } }, 'T'), 2003)
  assert.equal(reportState.reportTimestamp({ toMillis: () => 123 }), 123)
  assert.equal(reportState.stageReportChanged({ artifacts: {} }, 'T'), false)
})

test('R1 report: 스트림·UTF8 청크·done 이후 부록까지 기존 서버 경로로 처리한 후 한 번만 저장', async () => {
  const f = generatorFixture([{ type: 'text', text: '핵심 한 줄\n' }, { type: 'done' }, { type: 'text', text: '## 부록: 산출물 원문\n같이 찾기' }])
  const expected = '핵심 한 줄\n## 부록: 산출물 원문\n같이 찾기'
  assert.equal(await f.run(), expected)
  assert.deepEqual(f.texts, ['핵심 한 줄\n', expected])
  const request = f.calls.find(call => call[0] === 'request')
  assert.equal(request[1], '/api/analyze/stage')
  assert.equal(request[2].stage, 'T')
  assert.deepEqual(Object.keys(request[2].artifacts), ['T-1-1'])
  assert.equal(request[3], f.controller.signal)
  assert.deepEqual(f.calls.filter(call => call[0] === 'save'), [['save', 'room', 'T', expected, 'host']])
  assert.deepEqual(f.calls.at(-1), ['analysis', 'room', 'T', expected, false])
})

test('R1 report: 중간 SSE 오류·빈 응답·취소·저장 실패는 성공으로 처리하거나 기존 보고서를 덮어쓰지 않음', async () => {
  const failed = generatorFixture([{ type: 'text', text: '부분 답' }, { type: 'error', message: '분석 실패' }])
  await assert.rejects(failed.run(), /분석 실패/)
  assert.equal(failed.calls.some(call => call[0] === 'save'), false)
  const empty = generatorFixture([{ type: 'done' }])
  await assert.rejects(empty.run(), /비어/)
  assert.equal(empty.calls.some(call => call[0] === 'save'), false)
  const aborted = generatorFixture([{ type: 'text', text: '중간' }])
  await assert.rejects(aborted.run({ onText: () => aborted.controller.abort() }), /abort/i)
  assert.equal(aborted.calls.some(call => call[0] === 'save'), false)
  const saveError = generatorFixture([{ type: 'text', text: '완료 내용' }], { async saveStageReport() { throw new Error('저장 권한 오류') } })
  await assert.rejects(saveError.run(), /저장 권한 오류/)
  assert.equal(project.stageReports.T.content, '기존 보고서')
})

test('R1 report: 방장만 생성 요청하며 저장 promise가 끝나기 전에는 생성 완료가 아님', async () => {
  const denied = generatorFixture([{ type: 'text', text: '답' }])
  await assert.rejects(denied.run({ callerUid: 'member' }), /방장만/)
  assert.equal(denied.calls.length, 0)
  let resolveSave, completed = false
  const f = generatorFixture([{ type: 'text', text: '답' }], { saveStageReport() { return new Promise(resolve => { resolveSave = resolve }) } })
  const running = f.run().then(() => { completed = true })
  while (!resolveSave) await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false)
  resolveSave(); await running
  assert.equal(completed, true)
})

function reportsFixture(p = project, uid = 'host') {
  const states = [], callbacks = [], generationProps = []
  let index = 0
  const react = { ...React, useState(value) { const i = index++; states[i] ??= { value }; return [states[i].value, next => { states[i].value = next }] } }
  const { StageReportsModal } = load('src/components/modals/StageReportsModal.tsx', {
    react, 'react/jsx-runtime': jsx, '@/store/project': { useProjectStore: () => ({ project: p, userProfile: { uid } }) }, '@/types': { STAGES },
    '@/components/ui/MD3Button': { MD3Button: props => { callbacks.push(props); return React.createElement('button', { disabled: props.disabled, onClick: props.onClick }, props.children) } },
    './ReportMarkdown': { ReportHero: () => null, ReportMarkdown: () => null }, './printReport': {}, './downloadReportPdf': {}, '@/lib/markdown/reportDisplay': {},
    '@phosphor-icons/react': new Proxy({}, { get: () => () => null }), '@/lib/hwpx/generateHwpx': {},
    './StageAnalysisModal': { StageAnalysisModal: props => { generationProps.push(props); return React.createElement('div', {}, 'shared generator') } },
    '@/components/members/MemberActionDialog': { MemberActionDialog: props => { callbacks.push(props); return React.createElement('div', {}, props.children) } },
    '@/lib/report/stageReportState': reportState,
  })
  return { callbacks, generationProps, render() { index = 0; callbacks.length = 0; return renderToStaticMarkup(React.createElement(StageReportsModal, { onClose() {} })) } }
}

test('R1 report UI: 보고서 없는 저장 단계는 만들기·기존 단계는 변경 배지/강조·취소하면 생성 안 함', () => {
  const p = { ...project, artifacts: { ...project.artifacts, 'A-2-1': { content: {} } } }
  const f = reportsFixture(p)
  const html = f.render()
  assert.match(html, /보고서 만들기/)
  assert.match(html, /보고서 이후 산출물이 바뀌었어요/)
  const rerun = f.callbacks.find(props => props.children === '다시 생성')
  assert.equal(rerun.variant, 'filled')
  rerun.onClick(); assert.match(f.render(), /이전 보고서는 새 보고서로 바뀌어요/)
  f.callbacks.find(props => props.confirmLabel).onClose()
  f.render(); assert.equal(f.generationProps.length, 0)
  f.callbacks.find(props => props.children === '다시 생성').onClick(); f.render()
  f.callbacks.find(props => props.confirmLabel).onConfirm(); f.render()
  assert.equal(f.generationProps[0].reportStage, 'T', '현재 Ds가 아닌 지정 T로 생성')
  assert.equal(f.generationProps[0].forceGenerate, true)
  assert.equal(f.generationProps[0].isHost, true)
})

test('R1 report UI: 최초 생성은 보고서 없어도 열리고 팀원은 버튼 대신 방장 안내만 봄', () => {
  const p = { ...project, stageReports: {} }
  const host = reportsFixture(p)
  host.render(); host.callbacks.find(props => props.children === '보고서 만들기').onClick(); host.render()
  assert.equal(host.generationProps[0].reportStage, 'T')
  const member = reportsFixture(project, 'member')
  assert.match(member.render(), /방장이 다시 생성할 수 있어요/)
  assert.equal(member.callbacks.some(props => props.children === '다시 생성' || props.children === '보고서 만들기'), false)
  const blank = reportsFixture({ ...project, artifacts: {}, stageReports: {} })
  assert.match(blank.render(), /산출물을 저장하면/)
})

test('R1 report 연결: 생성 중복 없이 목록이 기존 모달을 재사용·과거 단계 보고서에서 단계 이동 없음', () => {
  const generated = source('src/components/modals/StageAnalysisModal.tsx')
  const saved = source('src/components/modals/StageReportsModal.tsx')
  assert.doesNotMatch(generated, /fetch\(|getReader\(|saveStageReport\(/)
  assert.match(generated, /generateStageReport\(/)
  assert.match(generated, /isHost && !reportStage && nextStage/)
  assert.match(saved, /<StageAnalysisModal[^>]*reportStage=\{generationStage\} forceGenerate/)
  assert.doesNotMatch(saved, /fetch\(|saveStageReport\(/)
  const page = source('src/app/(app)/projects/[id]/page.tsx')
  assert.doesNotMatch(page, /project\.stageReports && Object\.keys\(project\.stageReports\)\.length > 0/)
})

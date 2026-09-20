import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function loadObserver() {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/demo/observer.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports })
  return module.exports
}

test('demo projects remain observation-only in every run status; ordinary projects remain interactive', () => {
  const { isDemoObservationOnly } = loadObserver()
  for (const status of ['ready', 'running', 'paused', 'failed', 'completed']) {
    assert.equal(isDemoObservationOnly({ demoRun: { status } }), true)
  }
  assert.equal(isDemoObservationOnly({}), false)
  assert.equal(isDemoObservationOnly(null), false)
})

test('artifact download preserves full material text and explicitly labels simulation and consensus provenance', () => {
  const { demoArtifactMarkdown, demoArtifactApprovalLabel, safeDemoFilename } = loadObserver()
  const artifact = { title: '측우기 자료', status: 'confirmed', version: 2, confirmedBy: 'demo-teacher-team', content: { '학생 활동지': '이름: ____\n측정값: ____', '데이터': '날짜,강우량\n1일,12' } }
  const output = demoArtifactMarkdown('DI-1', artifact)
  assert.match(output, /시뮬레이션/)
  assert.match(output, /AI 교사팀 합의/)
  assert.match(output, /이름: ____\n측정값: ____/)
  assert.match(output, /날짜,강우량\n1일,12/)
  assert.equal(demoArtifactApprovalLabel(artifact), 'AI 교사팀 합의 · 시뮬레이션')
  assert.match(demoArtifactApprovalLabel({ ...artifact, confirmedBy: 'owner' }), /이전 엔진/)
  assert.equal(safeDemoFilename('../../<script>/자료'), '..-..--script--자료.md')
  const draft = demoArtifactMarkdown('DI-1', { ...artifact, status: 'in_review', demoReview: { approvedBy: [], round: 2, simulated: true } })
  assert.match(draft, /확정 전 · 개별 검토는 대화 기록 참조/)
  assert.doesNotMatch(draft, /동의한 교사 AI: 0명/)
})

test('tutorial turn details preserve the full intermediate draft and explicit review decision, not just spoken summaries', () => {
  const { demoTurnDetailMarkdown } = loadObserver()
  assert.equal(typeof demoTurnDetailMarkdown, 'function')
  const content = demoTurnDetailMarkdown({ artifact: { title: '수정 전 활동지', content: { '문항': '눈금 12와 15의 차이를 설명하세요.' } }, review: { decision: 'revise', reason: '단위 mm를 추가하세요.' }, references: [{ speakerId: 'teacher-2', quote: '단위를 함께 표시합시다.' }] })
  assert.match(content, /미확정/)
  assert.match(content, /눈금 12와 15의 차이를 설명하세요/)
  assert.match(content, /수정 요청/)
  assert.match(content, /단위 mm를 추가하세요/)
  assert.match(content, /단위를 함께 표시합시다/)
  assert.equal(demoTurnDetailMarkdown(undefined), '')
})

test('structured review displays every blocker field separately from non-blocking suggestions', () => {
  const { demoTurnDetailMarkdown } = loadObserver()
  const content = demoTurnDetailMarkdown({ review: {
    decision: 'revise', reason: '기존 원칙의 단위를 바로잡아야 합니다.',
    blockers: [{ criterionId: 'alignment', sectionKey: '설계 원칙', evidence: '강우량을 cm로 기록한다.', issue: '앞서 합의한 mm 단위와 다릅니다.', change: '강우량을 mm로 기록한다.' }],
    suggestions: ['후속 자료 개발 단계에서 기록지 예시를 추가해도 좋겠습니다.'],
  } })
  for (const expected of ['필수 수정', 'alignment', '설계 원칙', '강우량을 cm로 기록한다.', '앞서 합의한 mm 단위와 다릅니다.', '강우량을 mm로 기록한다.', '후속 제안', '필수 승인 조건 아님', '후속 자료 개발 단계에서 기록지 예시를 추가해도 좋겠습니다.']) assert.ok(content.includes(expected), expected)
  assert.ok(content.indexOf('필수 수정') < content.indexOf('후속 제안'))
  const approved = demoTurnDetailMarkdown({ review: { decision: 'approve', reason: '현재 활동의 필수 조건을 충족합니다.', blockers: [], suggestions: [] } })
  assert.match(approved, /필수 수정\n\n없음/)
  assert.match(approved, /후속 제안[^\n]*\n\n없음/)
  const legacy = demoTurnDetailMarkdown({ review: { decision: 'revise', reason: '이전 기록의 수정 요청입니다.' } })
  assert.match(legacy, /이전 기록의 수정 요청입니다/)
  assert.doesNotMatch(legacy, /필수 수정\n\n없음/, 'missing legacy blocker data must not imply there were no blockers')
})

test('demo uses a read-only conversation controller and the shared artifact panel', () => {
  const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  const artifact = fs.readFileSync(new URL('../src/components/artifacts/ArtifactPanel.tsx', import.meta.url), 'utf8')
  assert.match(chat, /isDemoObservationOnly\(project\)\s*\?\s*<DemoObserverChat/)
  assert.doesNotMatch(artifact, /<DemoArtifactPanel/)
  assert.match(artifact, /const isHost = !observationOnly/)
  assert.match(artifact, /disabled=\{isSaving \|\| !isHost\}/)
})

test('terminal quality and legacy-version errors require new setup rather than replaying the same cached rejection', () => {
  const filename = new URL('../src/app/(app)/demo/run/[id]/page.tsx', import.meta.url)
  const source = fs.readFileSync(filename, 'utf8')
  const parsed = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requiresNewSetupAfterError')
  assert.ok(fn, 'terminal error classification must be explicit')
  const module = { exports: {} }
  const code = ts.transpileModule(`${fn.getFullText(parsed)}\nexport { requiresNewSetupAfterError }`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports })
  const classify = module.exports.requiresNewSetupAfterError
  assert.equal(classify('T-1에서 2회 수정 후에도 교사 전원 승인이 이루어지지 않았습니다.'), true)
  assert.equal(classify('이전 버전 데모는 새 설정으로 실행해 주세요.'), true)
  assert.equal(classify('모델 호출 일시적 실패'), false)
  assert.equal(classify(null), false)
  assert.match(source, /status === 'failed'\) && !requiresNewSetup/)
  assert.match(source, /새 데모 설정/)
})

test('resuming a runner clears prior visible events before replaying durable journal turns', () => {
  const source = fs.readFileSync(new URL('../src/app/(app)/demo/run/[id]/page.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('const startRun = useCallback')
  const replay = source.indexOf('await runLiveMultiAgentDemo(', start)
  const reset = source.indexOf('setEvents([])', start)
  assert.ok(start >= 0 && replay > start)
  assert.ok(reset > start && reset < replay, 'reset old visible events before replay so deterministic journal event IDs cannot duplicate React keys')
})

test('rendered tutorial is read-only, shows simulated approval and material tables, never executes generated HTML', () => {
  const savedModule = { exports: {} }
  const config = { personas: [{ id: 'science', displayName: '과학 교사' }, { id: 'math', displayName: '수학 교사' }], lesson: { overview: '측우기' } }
  const project = { id: 'test', title: '측우기', demoRun: { status: 'completed', config }, artifacts: {
    'DI-1-1': { title: '자료 본문', status: 'confirmed', version: 2, confirmedBy: 'demo-teacher-team', content: {
      '학생 활동지': '| 측정값 | 근거 |\n|---|---|\n| 12 | 눈금 |\n\n키워드 3~5개, 설명 1~2문장\n\n<script>window.unwanted = true</script>',
    } },
  } }
  const mocks = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react-markdown': ReactMarkdown,
    'remark-gfm': remarkGfm,
    'firebase/firestore': {},
    '@/lib/firebase/config': {},
    '@/lib/firebase/projects': { watchMessages: () => { throw new Error('SSR must not subscribe or mutate') } },
    '@/store/project': { useProjectStore: selector => selector ? selector({ project }) : { project, viewingActivity: 'DI-1-1', setViewingActivity: () => {} } },
    '@/types': { STAGES: [{ activities: ['DI-1-1'] }], ACTIVITY_META: { 'DI-1-1': { label: '자료 개발' } }, displayActivityCode: () => 'DI-1' },
    '@/lib/demo/observer': loadObserver(),
    '@/lib/demo/engine/types': { parseDemoEngineConfig: value => value },
    '@/components/chat/ChatPanel': { MessageBubble: () => null },
    '@/components/chat/ChatPanelHeader': { ChatPanelHeader: () => null },
    '@/components/accessibility/FontScaleControl': { useChatFontScale: () => 1 },
    '@/lib/ui/stageColors': { STAGE_COLOR: {} },
  }
  const code = ts.transpileModule(`${fs.readFileSync(new URL('../src/components/demo/DemoObserverPanels.tsx', import.meta.url), 'utf8')}\nexport { DemoTurnDetails }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, { module: savedModule, exports: savedModule.exports, require: name => {
    if (name in mocks) return mocks[name]
    throw new Error(`Unmocked dependency ${name}`)
  } })
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(savedModule.exports.DemoProjectToolbar),
    React.createElement(savedModule.exports.DemoArtifactPanel)))
  assert.match(html, /사용자 관찰 전용/)
  assert.match(html, /AI 교사팀 합의/)
  assert.match(html, /전체 튜토리얼 내려받기/)
  assert.match(html, /자료 본문 내려받기/)
  assert.match(html, /<table>/)
  assert.match(html, /3~5개/)
  assert.doesNotMatch(html, /<del>/)
  assert.doesNotMatch(html, /<script|<textarea|type="submit"|>수동 확정<|내가 확정함/)
  const detailsHtml = renderToStaticMarkup(React.createElement(savedModule.exports.DemoTurnDetails, { message: { demoTurnResponse: { review: {
    decision: 'revise', reason: '단위 확인', blockers: [{ criterionId: 'alignment', sectionKey: '원칙', evidence: 'cm 단위', issue: '합의와 다름', change: 'mm로 수정' }], suggestions: ['다음 단계의 기록지 예시'],
  } } } }))
  for (const text of ['필수 수정 1개', '후속 제안 1개', 'alignment', '원칙', 'cm 단위', '합의와 다름', 'mm로 수정', '필수 승인 조건 아님', '다음 단계의 기록지 예시']) assert.ok(detailsHtml.includes(text), text)
  project.artifacts['DI-1-1'].status = 'in_review'
  project.artifacts['DI-1-1'].demoReview = { approvedBy: [], round: 2, simulated: true }
  const draftHtml = renderToStaticMarkup(React.createElement(savedModule.exports.DemoArtifactPanel))
  assert.match(draftHtml, /확정 전 · 개별 검토는 대화 기록 참조/)
  assert.doesNotMatch(draftHtml, /0명 동의/)
})

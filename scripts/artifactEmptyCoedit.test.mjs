// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/artifactEmptyCoedit.test.mjs
// 2026-10-08: 빈 산출물 화면 — 위·아래 폭·글자 크기 통일, '직접 입력하기' 대신 공동 편집으로 바로 함께 작성.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { COEDIT_ACTIVITIES, canOpenCoeditFromPanel } from '../src/lib/artifacts/coeditEntry.ts'

const panel = fs.readFileSync(new URL('../src/components/artifacts/ArtifactPanel.tsx', import.meta.url), 'utf8')
const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const store = fs.readFileSync(new URL('../src/store/project.ts', import.meta.url), 'utf8')

test('공동 편집 열기 조건: 진행 중 활동을 보고 있고 연수용이 아닐 때만', () => {
  assert.equal(canOpenCoeditFromPanel({ viewingActivity: 'A-1-2', currentActivity: 'A-1-2', trainingProject: false }), true)
  assert.equal(canOpenCoeditFromPanel({ viewingActivity: 'A-1-2', currentActivity: 'A-1-2', trainingProject: true }), false, '연수용은 연수 양식 유지')
  assert.equal(canOpenCoeditFromPanel({ viewingActivity: 'T-1-1', currentActivity: 'A-1-2', trainingProject: false }), false, '다른 활동을 보는 중')
  assert.equal(canOpenCoeditFromPanel({ viewingActivity: 'A-2-3', currentActivity: 'A-2-3', trainingProject: false }), false, '공동 편집 창이 없는 활동')
})

test('채팅의 공동 편집 버튼이 있는 활동은 모두 패널 요청으로도 열린다', () => {
  const buttons = [...chat.matchAll(/currentActivity === '([A-Za-z]+-\d-\d)' && !isTrainingProject\(proj\) && \(\s*<CoeditButton/g)].map(m => m[1])
  for (const code of buttons) {
    assert.ok(COEDIT_ACTIVITIES.includes(code), `${code} 목록에 없음`)
    assert.match(chat, new RegExp(`'${code}': \\(\\) => `), `${code} 수신부 연결`)
  }
  assert.ok(COEDIT_ACTIVITIES.includes('A-2-1'))
  assert.match(chat, /'A-2-1': \(\) => \{ setWorkspaceInitialView\('sheet'\); setShowWorkspace\(true\) \}/)
  assert.match(chat, /setCoeditOpenRequest\(null\)\n\s*if \(!project \|\| code !== currentActivity \|\| isTrainingProject\(project\)\) return/, '요청은 한 번만 소비, 연수용·다른 활동은 무시')
  assert.match(store, /coeditOpenRequest: null,\n\s*setCoeditOpenRequest: \(code\) => set\(\{ coeditOpenRequest: code \}\)/)
  assert.match(store, /chatInputRequest: null,\n\s*coeditOpenRequest: null,\n\s*\}\),/, '프로젝트 전환 시 초기화')
})

test('빈 산출물 화면: 공동 편집이 주 버튼, 직접 입력은 기록 담당 보조 링크, 폭·글자 크기는 아래 카드와 같게', () => {
  assert.match(panel, /onClick=\{\(\) => setCoeditOpenRequest\(viewingActivity\)\}[\s\S]{0,600}공동 편집으로 함께 작성하기/)
  assert.match(panel, /canCoeditHere \? '혼자 간단히 직접 입력하기' : 'AI가 저장 안 했나요\? 직접 입력하기'/)
  assert.match(panel, /<div className="flex flex-col items-center text-\[#9AA0A6\] gap-3 py-4">/, '좌우 안쪽 여백 없이 전체 폭')
  assert.match(panel, /<div className="w-full rounded-2xl border border-\[#DADCE0\] bg-white p-4">\n\s*<p className="text-\[12px\] font-bold/, '채울 내용 상자 = 아래 카드와 같은 모서리·여백·12px 제목')
  assert.match(panel, /'inline-flex items-center gap-1 text-\[12px\] font-semibold px-2\.5 py-1 rounded-full'/)
  assert.doesNotMatch(panel, /text-\[10px\] text-\[#9AA0A6\] mt-0\.5 leading-snug/, '10px 설명 제거')
})

// Exercise the actual request-consumer effect rather than only checking its source wiring.
import ts from 'typescript'
import vm from 'node:vm'
const chatTree = ts.createSourceFile('ChatPanel.tsx', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let consumeEffect
function findConsumer(node) {
  if (ts.isCallExpression(node) && node.expression.getText(chatTree) === 'useEffect'
    && node.arguments[0]?.getText(chatTree).includes('if (!coeditOpenRequest) return')) consumeEffect = node.arguments[0].getText(chatTree)
  ts.forEachChild(node, findConsumer)
}
findConsumer(chatTree)
function consume(code, current = code, training = false) {
  assert.ok(consumeEffect)
  const calls = []
  const context = { coeditOpenRequest: code, currentActivity: current, project: {}, isTrainingProject: () => training }
  for (const name of new Set(consumeEffect.match(/set[A-Z]\w+/g))) context[name] = value => calls.push([name, value])
  vm.runInNewContext(ts.transpileModule(`(${consumeEffect})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return calls
}
test('실제 effect는 17개 지원 활동에서 편집 창 하나만 열고 요청을 소비한다', () => {
  for (const code of COEDIT_ACTIVITIES) {
    const calls = consume(code)
    assert.deepEqual(calls[0], ['setCoeditOpenRequest', null])
    assert.equal(calls.filter(([name, value]) => /^setShow/.test(name) && value === true).length, 1, code)
  }
  assert.ok(consume('A-2-1').some(([name, value]) => name === 'setWorkspaceInitialView' && value === 'sheet'))
})
test('실제 effect는 연수용·지나간 활동 요청을 열지 않고 소비한다', () => {
  assert.deepEqual(consume('T-2-2', 'T-2-2', true), [['setCoeditOpenRequest', null]])
  assert.deepEqual(consume('T-2-2', 'A-1-1'), [['setCoeditOpenRequest', null]])
})

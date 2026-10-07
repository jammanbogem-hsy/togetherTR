// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/workshopEvidenceFixes.test.mjs
// 2026-10-07 사용자 보고 3건: ① 근거 코드 '허용 목록'에 A-4 목표의 성취기준이 없음 ② 문제상황 워크숍 확정이 저장으로 이어지지 않음
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { designStandardSources, extractStandardCodes } from '../src/lib/curriculum/standardCodes.ts'
import { gateEvidenceCodes } from '../src/lib/chat/evidenceCodeGate.ts'

test('근거 코드: A-4 통합 수업목표에 쓴 성취기준과 대괄호 없는 코드도 근거로 쓸 수 있다', () => {
  const artifacts = {
    'A-2-1': { content: { _schema: 'A-2-1', rows: [{ subject: '과학', standard: '[4과03-02] 식물의 생김새', coreIdea: '' }] } },
    'A-2-2': { content: { _schema: 'A-2-2', subjectGoals: [{ subject: '수학', goal: '자료를 꺾은선그래프로 나타낸다 (4수04-03)' }] } },
  }
  const codes = extractStandardCodes(designStandardSources(artifacts, [{ standard: '4도04-02 생태 감수성' }]).join('\n'))
  assert.deepEqual(codes.sort(), ['[4과03-02]', '[4도04-02]', '[4수04-03]'])
  const gated = gateEvidenceCodes([{ activityCode: 'Ds-1-1', sections: { '평가 계획': '| 그래프 | 수학 (근거: [4수04-03], [9수99-99]) |' } }], 'Ds-1-1', codes)
  assert.match(gated.updates[0].sections['평가 계획'], /\(근거: \[4수04-03\]\)/)
  assert.deepEqual(gated.removed, ['[9수99-99]'], '지어낸 코드는 여전히 지운다')
})

test('문제상황 워크숍: 기록 담당이 후보를 확정하면 바로 저장하고, 체크는 실제 확정값에서만 나온다', () => {
  const source = fs.readFileSync(new URL('../src/components/problem-situation/ProblemSituationDesigner.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /useState\(result\.recommended\?\.index \?\? 0\)\n\s*const openZoom/, '추천 후보를 미리 확정으로 표시하지 않음')
  assert.match(source, /const committedIndex = committedTitle \? candidates\.findIndex\(c => c\.title === committedTitle\) : -1/)
  assert.match(source, /return isLeader \? handleSave\(data\) : false/)
  assert.match(source, /onSelect=\{confirmScenario\}\s*\n\s*committedTitle=\{isLeader \? savedScenarioTitle : currentData\?\.scenario\.title\} canSave=\{isLeader\}/)
  assert.match(source, /await confirmScenarioRef\.current\(psData\)/, '채팅 확정도 바로 저장')
  assert.match(source, /문제 상황을 확정하고 저장했습니다/, '확정 신호만 온 답도 빈 말풍선이 아님')
})

test('다음 활동 요청: "다음" 한 단어도 이동 요청으로 보고, 고치기·저장 요청은 아니다', async () => {
  const { isMoveRequest, MOVE_NEEDS_RECORDER } = await import('../src/lib/chat/moveRequest.ts')
  for (const text of ['다음', '다음.', '다음요', '다음 활동으로 넘어가자', '넘어가 주세요', '다음 단계로 이동']) assert.equal(isMoveRequest(text), true, text)
  for (const text of ['다음 칸 고쳐 줘', '이전 활동으로 돌아가자', '저장하고 다음', '평가 기준 수정', '다음 활동을 설명해 주세요', '다음 단계로 넘어가지 마세요', '다음 단계는 무엇인가요?', '다음으로 넘어갈까요?', '']) assert.equal(isMoveRequest(text), false, text)
  assert.match(MOVE_NEEDS_RECORDER, /기록 담당만/)
  const panel = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /if \(!legacyIntent && !isMoveRequest\(userMessage\)\) return\n\s*if \(isHost\) handlePromptNextCommand\(\)\n\s*else addAssistantNotice\(MOVE_NEEDS_RECORDER\)/)
  assert.equal((panel.match(/else addAssistantNotice\(MOVE_NEEDS_RECORDER\)/g) ?? []).length, 3, '두 응답 경로 + 보조 판정 모두 비기록 담당에게 안내')
})

test('문제상황 확정 저장은 성공 응답 뒤에만 완료 표시; 실패와 중복 클릭은 초안을 보존', async () => {
  const ts = (await import('typescript')).default
  const vm = await import('node:vm')
  const source = fs.readFileSync(new URL('../src/components/problem-situation/ProblemSituationDesigner.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('designer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  function visit(n) { if (ts.isVariableDeclaration(n) && ['handleSave', 'confirmScenario'].includes(n.name.getText(tree))) declarations.set(n.name.getText(tree), 'const '+n.getText(tree)); ts.forEachChild(n, visit) } visit(tree)
  let resolve, reject, draft, savedTitle, error = '', calls = 0
  const ctx = vm.createContext({ currentData: null, isLeader: true, savingRef: { current: false }, setIsSaving() {}, setSaveError: v => {error=v}, setSavedScenarioTitle: v => {savedTitle=v}, setCurrentData: v => {draft=v}, onSave: () => { calls++; return new Promise((a,b)=>{resolve=a;reject=b}) }, console:{error(){}} })
  vm.runInContext(ts.transpileModule([...declarations.values()].join('\n')+'\nthis.run=confirmScenario', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx)
  const first = ctx.run({scenario:{title:'기온 탐구'}})
  assert.equal(savedTitle, undefined)
  assert.equal(await ctx.run({scenario:{title:'중복 후보'}}),false); assert.equal(draft.scenario.title,'기온 탐구');assert.equal(calls,1)
  reject(new Error('offline'));assert.equal(await first,false);assert.match(error,/저장하지 못/);assert.equal(savedTitle,undefined)
  const retry = ctx.run(draft);resolve();assert.equal(await retry,true);assert.equal(savedTitle,'기온 탐구');assert.equal(error,'')
})

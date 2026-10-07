import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { isTrainingNextRequest, nextTrainingActivity } from '../src/lib/training/navigation.ts'
import { isTrainingActivity } from '../src/lib/training/trainingMode.ts'
const training = { id: 'p', mode: 'collaborative', trainingMode: { enabled: true, coreFormal: true } }

test('explicit next requests are distinct from content, questions, and saving consent', () => {
  for (const text of ['다음', '다음!', '다음 단계', '다음 활동으로', '다음으로 넘어가 주세요', '다음 단계로 진행해주세요', '다음 활동으로 이동해 주세요']) assert.equal(isTrainingNextRequest(text), true, text)
  for (const text of ['네', '저장해주세요', '다음은 무엇인가요?', '다음 활동을 설명해주세요', '다음 단계로 넘어가지 마세요', '다음 수업의 온도 자료', '다음', '[연수 양식 저장: 다음]'].filter(t => t !== '다음')) assert.equal(isTrainingNextRequest(text), false, text)
})
test('every design activity resolves its next activity, including the DI boundary', () => {
  for (const [from, to] of [['Ds-1-1','Ds-1-2'],['Ds-1-2','Ds-1-3'],['Ds-1-3','Ds-2-1'],['Ds-2-1','Ds-2-2'],['Ds-2-2','DI-1-1']]) assert.equal(nextTrainingActivity(training, from), to)
  assert.equal(nextTrainingActivity(training, 'E-2-1'), undefined)
})
const source = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function fixture({ host = true, pending = null, project = training, activity = 'Ds-1-2' } = {}) {
  let fn; function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'handleTrainingNextRequest') fn = n; ts.forEachChild(n, visit) } visit(tree)
  const moved = [], notices = []
  const ctx = vm.createContext({ proj: project, currentActivity: activity, isHost: host, pendingArtifactSave: pending, isTrainingActivity, isTrainingNextRequest, nextTrainingActivity, setFlowNotice: text => notices.push(text), handleActivityAdvance: async code => moved.push(code) })
  vm.runInContext(ts.transpileModule(fn.getText(tree) + '\nthis.run=handleTrainingNextRequest', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx)
  return { run: ctx.run, moved, notices }
}
test('actual chat handler moves the recorder directly and explains member permissions without invoking AI', async () => {
  const host = fixture(); assert.equal(await host.run('다음'), true); assert.deepEqual(host.moved, ['Ds-1-3'])
  const member = fixture({ host: false }); assert.equal(await member.run('다음'), true); assert.deepEqual(member.moved, []); assert.match(member.notices[0], /기록 담당/)
  const pending = fixture({ pending: { activityCode: 'Ds-1-2' } }); await pending.run('다음'); assert.deepEqual(pending.moved, []); assert.match(pending.notices[0], /저장하지 않은 제안/)
})
test('normal and formal core activity behavior stays unchanged; both chat paths handle the command before AI', async () => {
  for (const options of [{ project: { ...training, trainingMode: { enabled: false } } }, { activity: 'A-2-2' }]) {
    const f = fixture(options); assert.equal(await f.run('다음'), false); assert.deepEqual(f.moved, [])
  }
  for (const [name, call] of [['handleSend', 'handleTrainingNextRequest(userMessage)'], ['sendMessageDirectly','handleTrainingNextRequest(text)']]) {
    let fn; function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) fn = n; ts.forEachChild(n, visit) } visit(tree)
    const text = fn.getText(tree); assert.ok(text.indexOf(call) > 0); assert.ok(text.indexOf(call) < text.indexOf('await streamFromAPI('))
  }
})

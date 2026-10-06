import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createChatDraft } from '../src/lib/chat/chatDraft.ts'
import { reconcileMessages } from '../src/lib/chat/reconcileMessages.ts'
import { useProjectStore } from '../src/store/project.ts'
import { navigateOptimistically } from '../src/lib/activity/optimisticNavigation.ts'

const pause = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return { promise, resolve, reject } }
function reset(id = 'perf') {
  useProjectStore.getState().resetProjectState()
  useProjectStore.getState().setProject({ id, currentActivity: 'T-1-1', currentStage: 'T', currentCycle: 1, cycleCount: 1 })
}

test('PERF: navigation paints before persistence, protects optimistic state from older snapshots, then acknowledges', async () => {
  reset(); const saved = deferred()
  const moving = navigateOptimistically({ projectId: 'perf', activity: 'A-1-1', persist: () => saved.promise })
  assert.equal(useProjectStore.getState().currentActivity, 'A-1-1')
  assert.equal(useProjectStore.getState().viewingActivity, 'A-1-1')
  useProjectStore.getState().setProject({ id: 'perf', currentActivity: 'T-1-1', currentStage: 'T', title: 'new title' })
  assert.equal(useProjectStore.getState().project.currentActivity, 'A-1-1')
  assert.equal(useProjectStore.getState().project.title, 'new title')
  saved.resolve(); assert.equal(await moving, true)
  assert.equal(useProjectStore.getState().pendingNavigation, null)
})

test('PERF: rapid navigation serializes writes and a failed newer move rolls back to the last successful destination', async () => {
  reset(); const first = deferred(), second = deferred(), calls = []
  const a = navigateOptimistically({ projectId: 'perf', activity: 'T-1-2', persist: () => { calls.push('a'); return first.promise } })
  const b = navigateOptimistically({ projectId: 'perf', activity: 'T-2-1', persist: () => { calls.push('b'); return second.promise } })
  assert.equal(useProjectStore.getState().currentActivity, 'T-2-1')
  await pause(); assert.deepEqual(calls, ['a'])
  first.resolve(); await a; await pause(); assert.deepEqual(calls, ['a','b'])
  assert.equal(useProjectStore.getState().currentActivity, 'T-2-1')
  second.reject(new Error('offline')); assert.equal(await b, false)
  assert.equal(useProjectStore.getState().currentActivity, 'T-1-2')
  assert.match(useProjectStore.getState().navigationError, /저장하지 못해/)
})

test('PERF: older failures cannot revert a newer selection; failures cannot change a different project', async () => {
  reset(); const first = deferred(), second = deferred()
  const a = navigateOptimistically({ projectId: 'perf', activity: 'T-1-2', persist: () => first.promise })
  const b = navigateOptimistically({ projectId: 'perf', activity: 'A-1-1', persist: () => second.promise })
  first.reject(new Error('first')); await a
  assert.equal(useProjectStore.getState().currentActivity, 'A-1-1')
  reset('another'); second.reject(new Error('second')); await b
  assert.equal(useProjectStore.getState().project.id, 'another')
  assert.equal(useProjectStore.getState().currentActivity, 'T-1-1')
  assert.equal(useProjectStore.getState().navigationError, null)
})

test('PERF: a failed cycle transition restores cycle metadata and activity together', async () => {
  reset(); const saved = deferred()
  const moving = navigateOptimistically({ projectId: 'perf', activity: 'A-1-1', patch: { currentCycle: 2, cycleCount: 2, isECompleted: true }, persist: () => saved.promise })
  assert.equal(useProjectStore.getState().project.currentCycle, 2)
  saved.reject(new Error('cycle')); await moving
  assert.equal(useProjectStore.getState().project.currentCycle, 1)
  assert.equal(useProjectStore.getState().currentActivity, 'T-1-1')
})

test('PERF: unchanged Firestore messages preserve list and row identity, changed checklist and reordered rows still update', () => {
  const a = { id: 'a', content: '안녕', checklistState: { x: true } }, b = { id: 'b', content: '반가워' }, before = [a,b]
  assert.equal(reconcileMessages(before, structuredClone(before)), before)
  const next = reconcileMessages(before, [{...a,checklistState:{x:false}}, {...b}])
  assert.notEqual(next[0],a); assert.equal(next[1],b)
  assert.deepEqual(reconcileMessages(before,[{...b},{...a}]),[b,a])
  assert.deepEqual(reconcileMessages(before,[{...a},{...a,content:'last'}]),[{...a,content:'last'}])
})

test('PERF: draft subscriptions receive input, slash selection and updater changes without notifying project/message store', () => {
  const draft = createChatDraft(); let drafts=0, projects=0
  const off=draft.subscribe(()=>drafts++), offProject=useProjectStore.subscribe(()=>projects++)
  draft.setInput('한'); draft.setInput(value=>value+'글'); draft.setInput('한글')
  draft.setSlashQuery('분'); draft.setSlashCmdIdx(1)
  assert.equal(drafts,4); assert.equal(projects,0)
  assert.deepEqual(draft.getSnapshot(),{input:'한글',slashQuery:'분',slashCmdIdx:1})
  off(); offProject()
})

test('PERF: stable callbacks use the latest committed render, rather than a stale closure', () => {
  const text=fs.readFileSync(new URL('../src/components/chat/ChatRenderBoundary.tsx',import.meta.url),'utf8')
  let reference, effect, savedCallback
  const React={memo:x=>x,useRef(value){return reference??={current:value}},useLayoutEffect(fn){effect=fn},useCallback(fn){return savedCallback??=fn}}
  const context={exports:{},require(name){if(name==='react')return React;if(name==='react/jsx-runtime')return {};if(name.includes('interactionMetrics'))return {};throw new Error(name)}}
  vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context)
  const first=context.exports.useStableCallback(()=>1);effect();assert.equal(first(),1)
  const second=context.exports.useStableCallback(()=>2);assert.equal(first,second);effect();assert.equal(first(),2)
})

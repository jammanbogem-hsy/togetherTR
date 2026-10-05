import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveWorkspacePresence } from '../src/components/artifacts/workspacePresence.ts'

test('R4 wiring: unresolved relative caret never uses its stale numeric offset or highlights a different item',()=>{
 const entry={uid:'B',cellKey:'block:p:check:0',caretPos:7,relativeCaret:'anchor'}
 const unresolved=resolveWorkspacePresence([entry],{enabled:true,resolveCaretLocation:()=>null})[0]
 assert.equal(unresolved.caretPos,undefined)
 assert.equal(unresolved.cellKey,'modal:idle')
 const resolved=resolveWorkspacePresence([entry],{enabled:true,resolveCaretLocation:()=>({fieldKey:'block:p:check:1',caretPos:9})})[0]
 assert.equal(resolved.cellKey,'block:p:check:1')
 assert.equal(resolved.caretPos,9)
 assert.equal(entry.caretPos,7)
 assert.equal(entry.cellKey,'block:p:check:0')
 assert.equal(resolveWorkspacePresence([entry],{enabled:false,resolveCaretLocation:()=>null})[0],entry)
})

test('R4 wiring: every workspace encodes relative anchors, preserves them in heartbeat, resolves on render and guards restored select',()=>{
 const names=['TeamVision','IntegratedGoal','RoleDistribution','TeamRules','TeamSchedule','TopicSelection','LearningActivity','Scaffolding','EvaluationPlan','LessonDesignDirection','ProblemSituation','SupportTool']
 for(const name of names){
  const src=fs.readFileSync(`src/components/artifacts/${name}WorkspaceModal.tsx`,'utf8')
  for(const term of ['realtime.encodeCaret(cellKey, caretPos)','relativeCaret: last.relativeCaret','interactionAt: last.interactionAt','resolveWorkspacePresence(receivedEditors, realtime)','shouldReportWorkspaceCaret(realtime)'])assert.ok(src.includes(term),`${name}: ${term}`)
 }
 const common=fs.readFileSync('src/components/artifacts/CoeditWorkspaceModal.tsx','utf8')
 for(const term of ['resolveWorkspacePresence(fresh, realtime)','realtime.fieldProps(cellKey)','encodeCaret(cellKey, caretPos)','shouldReportWorkspaceCaret','...lastPresenceRef.current'])assert.ok(common.includes(term),term)
})

// Team members can open earlier/later stages' activity records without moving the team.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/memberStageBrowse.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { browseActivityForStage, sidebarStage } from '../src/lib/activity/browse.ts'

test('picking a stage opens its last saved record, else its first activity; the team stage returns to the live activity', () => {
  const project = { artifacts: { 'T-1-1': {}, 'T-2-2': {}, 'A-1-2': {} } }
  assert.equal(browseActivityForStage('T', project, 'Ds-1-3'), 'T-2-2')
  assert.equal(browseActivityForStage('A', project, 'Ds-1-3'), 'A-1-2')
  assert.equal(browseActivityForStage('E', project, 'Ds-1-3'), 'E-1-1')
  assert.equal(browseActivityForStage('Ds', project, 'Ds-1-3'), 'Ds-1-3')
  assert.equal(browseActivityForStage('T', { artifacts: { 'T-2-2': {} } }, 'A-1-1', true), 'T-1-1', 'solo skips hidden activities (T-2-2 is hidden)')
})

test('members see the stage they browse; the host sees the team stage', () => {
  assert.equal(sidebarStage(false, false, 'T-1-2', 'Ds'), 'T')
  assert.equal(sidebarStage(true, false, 'T-1-2', 'Ds'), 'Ds')
  assert.equal(sidebarStage(true, true, 'A-1-1', 'Ds'), 'A')
})

test('wiring: sidebar stage chips for members only, stage bar browse for members, host still moves the team', () => {
  const sidebar = fs.readFileSync('src/components/activity/ActivitySidebar.tsx', 'utf8')
  assert.match(sidebar, /\{!isHost && !project\.demoRun && \(\n\s+<nav aria-label="다른 단계 기록 열람"/)
  assert.match(sidebar, /setViewingActivity\(browseActivityForStage\(stage\.code, project, currentActivity, isSolo\)\)/)
  const bar = fs.readFileSync('src/components/stage/StageBar.tsx', 'utf8')
  assert.match(bar, /else if \(isHost && stage\.code !== currentStage\) setPendingStageMove\(stage\.code\)\n\s+\/\/ .*\n\s+else if \(!isHost\) setViewingActivity\(browseActivityForStage/)
})

test('browsing members read that activity conversation; the live chat stays mounted underneath', () => {
  const chat = fs.readFileSync('src/components/chat/ChatPanel.tsx', 'utf8')
  assert.match(chat, /const browsing = !isHost && viewingActivity !== currentActivity/)
  assert.match(chat, /\{browsing && <BrowsingChat \/>\}\n\s+<div className=\{browsing \? 'hidden' : 'contents'\}><ChatPanelContent \/><\/div>/)
  const browse = fs.readFileSync('src/components/chat/BrowsingChat.tsx', 'utf8')
  assert.match(browse, /watchMessages\(project\.id, viewingActivity,/)
  assert.match(browse, /읽기 전용/)
  assert.doesNotMatch(browse, /saveMessage|textarea/)
})

// node --test --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/sidebarDoneBadge.test.mjs
// 사이드바 '완료' 배지가 진행 막대(isEffectivelyDone)와 같은 기준을 쓰는지 — 연수용 Ds-5 기록 없이 '완료'로 뜬 피드백(2026-10-10).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { displayActivityStatus, isEffectivelyDone } from '../src/lib/activity/completion.ts'

test('stored completed without a record is not shown as done', () => {
  assert.equal(displayActivityStatus('completed', false, true), 'in_progress')
  assert.equal(displayActivityStatus('completed', false, false), 'warning')
})

test('done always shows completed; other statuses pass through', () => {
  assert.equal(displayActivityStatus('in_progress', true, true), 'completed')
  assert.equal(displayActivityStatus('warning', true, false), 'completed')
  assert.equal(displayActivityStatus('warning', false, false), 'warning')
  assert.equal(displayActivityStatus('not_started', false, false), 'not_started')
  assert.equal(displayActivityStatus('active_return', false, true), 'active_return')
})

test('training activity marked completed with no record is not done', () => {
  const project = { trainingMode: { enabled: true } }
  assert.equal(isEffectivelyDone('Ds-2-2', { 'Ds-2-2': 'completed' }, {}, project), false)
})

test('sidebar badge goes through displayActivityStatus with the progress rule', () => {
  const src = fs.readFileSync(new URL('../src/components/activity/ActivitySidebar.tsx', import.meta.url), 'utf8')
  assert.match(src, /const effectiveStatus = displayActivityStatus\(status, done, isHostCurrent\)/)
  assert.match(src, /done=\{[^}]*isEffectivelyDone\(code\)\}/)
  assert.doesNotMatch(src, /artifactConfirmed/)
})

// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/collaborativeGradeArtifact.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
    source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  }
  return nextLoad(url, context)
} })
const { A21Renderer } = await import('../src/components/artifacts/structured/A21Renderer.tsx')
const { parseA21Table } = await import('../src/lib/artifacts/schemas.ts')
const { buildCurriculumSheetArtifactProposal } = await import('../src/lib/curriculum/graphSheetBridge.ts')
test('a grouped second-grade-band center is visible in the rendered artifact', () => {
  const proposal = buildCurriculumSheetArtifactProposal([
    { subject: '국어', gradeBand: '1-2학년군', coreIdea: '공통 핵심아이디어', standard: '[2국01-01]', isCenter: false },
    { subject: '국어', gradeBand: '3-4학년군', coreIdea: '공통 핵심아이디어', standard: '[4국01-01]', isCenter: true },
  ], { gradeMode: 'multi' })
  const rows = parseA21Table(proposal.sections['성취기준분석표'])
  assert.equal(rows[1].groupWithPrevious, true)
  const html = renderToStaticMarkup(React.createElement(A21Renderer, { data: { _schema: 'A-2-1', rows } }))
  assert.match(html, /3-4학년군 · ★ 중심/)
  assert.doesNotMatch(html, /1-2학년군 · ★ 중심/)
})

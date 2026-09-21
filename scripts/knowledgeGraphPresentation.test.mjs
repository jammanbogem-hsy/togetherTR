import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { graphEdgeSegment, graphEdgeAppearance } from '../src/components/knowledge-graph/graphPresentation.ts'
import { nodeRadius, RELATION_COLORS, SUBJECT_NAMES } from '../src/components/knowledge-graph/constants.ts'
import { SUBJECT_ICONS } from '../src/components/curriculum-map/subjectIcons.ts'

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
    source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  }
  return nextLoad(url, context)
} })
const { default: GraphCanvas } = await import('../src/components/knowledge-graph/GraphCanvas.tsx')
const edge = { id: 'a-b', source: 'a', target: 'b', relation: '문제-해결', weight: 0.7, method: 'manual' }
const analysis = { relationType: '문제-해결', score: 0.7, explanation: '두 교과의 문제 해결 활동 연결', source: 'claude' }

test('all subjects use curriculum-map glyphs included in the production font subset', () => {
  const layout = readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8')
  for (const subject of Object.keys(SUBJECT_NAMES)) {
    assert.ok(SUBJECT_ICONS[subject], subject)
    assert.ok(layout.includes(`'${SUBJECT_ICONS[subject]}'`), subject)
  }
})

test('low-similarity standards keep readable icons; legacy percent scores cannot inflate nodes', () => {
  assert.ok(nodeRadius('standard', 0) >= 22)
  assert.equal(nodeRadius('standard', 70), nodeRadius('standard', 0.7))
  for (const score of [NaN, Infinity, -Infinity, -1, 999]) {
    const radius = nodeRadius('standard', score)
    assert.ok(radius >= 22 && radius <= 30)
  }
})

test('links stop outside both node circles, including diagonal and reversed connections', () => {
  const a = { x: 10, y: 20 }, b = { x: 210, y: 260 }
  const line = graphEdgeSegment(a, b, 34, 22)
  assert.ok(Math.abs(Math.hypot(line.x1 - a.x, line.y1 - a.y) - 38) < 1e-8)
  assert.ok(Math.abs(Math.hypot(line.x2 - b.x, line.y2 - b.y) - 26) < 1e-8)
  const reverse = graphEdgeSegment(b, a, 22, 34)
  assert.equal(line.x1, reverse.x2)
  assert.equal(line.y1, reverse.y2)
  assert.equal(graphEdgeSegment(a, a, 34, 22), null)
  assert.equal(graphEdgeSegment(a, { x: 20, y: 20 }, 34, 22), null)
})

test('unanalyzed guesses stay gray and dashed even when a tentative relation type exists', () => {
  for (const pending of [undefined, { ...analysis, explanation: ' ' }]) {
    const appearance = graphEdgeAppearance(edge, pending, false, false)
    assert.equal(appearance.analyzed, false)
    assert.equal(appearance.color, '#94A3B8')
    assert.ok(appearance.dash)
    assert.equal(appearance.label, '관계 추정')
  }
})

test('all eight completed relation types use matching colors; strength is normalized', () => {
  for (const [relationType, color] of Object.entries(RELATION_COLORS)) {
    const appearance = graphEdgeAppearance(edge, { ...analysis, relationType }, false, false)
    assert.equal(appearance.color, color)
    assert.equal(appearance.label, relationType)
    assert.equal(appearance.dash, undefined)
  }
  const unit = graphEdgeAppearance(edge, analysis, false, false)
  const percent = graphEdgeAppearance(edge, { ...analysis, score: 70 }, false, false)
  assert.equal(unit.width, percent.width)
  assert.ok(unit.width > graphEdgeAppearance(edge, { ...analysis, score: 0.1 }, false, false).width)
  assert.equal(graphEdgeAppearance({ ...edge, explanation: '저장된 근거' }, undefined, false, false).analyzed, true)
})

test('hover and keyboard focus emphasize only adjacent links', () => {
  const normal = graphEdgeAppearance(edge, analysis, false, false)
  const adjacent = graphEdgeAppearance(edge, analysis, true, true)
  const other = graphEdgeAppearance(edge, analysis, true, false)
  assert.ok(adjacent.width > normal.width)
  assert.ok(adjacent.opacity > normal.opacity)
  assert.ok(other.opacity < normal.opacity)
})

test('initial canvas renders readable subject fallbacks and accessible satellite labels without arrow markers', () => {
  const nodes = [
    { id: 'a', type: 'standard', label: '[6사08-03]', subject_id: 'sub_soc', x: 350, y: 350, vx: 0, vy: 0, group: 'sub_soc' },
    { id: 'b', type: 'standard', label: '[6국02-04]', subject_id: 'sub_kor', similarityScore: 0.19, x: 650, y: 500, vx: 0, vy: 0, group: 'sub_kor' },
  ]
  const noop = () => {}
  const html = renderToStaticMarkup(React.createElement(GraphCanvas, {
    svgRef: { current: null }, nodesRef: { current: nodes }, svgWidth: 1000, svgHeight: 700,
    visibleNodes: nodes, visibleEdges: [edge], centerNodeId: 'a', popup: null, hoveredNodeId: null,
    claudeRelations: new Map([['a||b', analysis]]), chatMentionedCodes: [], pinnedStandards: [], recommendedCenterIds: new Map(),
    algoMode: 'hybrid', relFilter: 'all', onAlgoModeChange: noop, onRelFilterChange: noop, onNodeClick: noop,
    onRightClick: noop, onSetHoveredNodeId: noop, onSetTooltip: noop, onDragStart: noop, onDragEnd: noop,
  }))
  assert.match(html, /data-subject-icon="public"[^>]*>사회<\/text>/)
  assert.match(html, /data-subject-icon="menu_book"[^>]*>국어<\/text>/)
  assert.match(html, /aria-label="\[6국02-04\] \(국어\)"/)
  assert.match(html, />\[6국02-04\]<\/text>/)
  assert.doesNotMatch(html, /markerEnd|marker-end|<marker|>public<|>menu_book</)
  assert.match(html, /data-relation-state="analyzed"/)
})

// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/ontologyPresentation.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as icons from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../src/lib/markdown/remarkPlugins.ts'
import * as types from '../src/types/index.ts'
import * as colors from '../src/lib/ui/stageColors.ts'
import * as ontology from '../src/lib/ontology/projectOntology.ts'
import * as presentation from '../src/lib/ontology/graphPresentation.ts'
const { GRAPH_LAYOUT: L, presentOntology, ontologyEdgePath, visibleOntologyEdges, wrapActivityLabel, stagePalette } = presentation
const source = fs.readFileSync(new URL('../src/components/ontology/ProjectOntologyGraph.tsx', import.meta.url), 'utf8')
const bindings = {
  react: React, 'react/jsx-runtime': jsxRuntime, '@phosphor-icons/react': icons,
  '@/types': types, '@/lib/ui/stageColors': colors, '@/lib/ontology/projectOntology': ontology,
  '@/lib/ontology/graphPresentation': presentation,
}
const exports = {}
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, { exports, require: key => { assert.ok(bindings[key], key); return bindings[key] } })
const { ProjectOntologyGraph } = exports
const graph = ontology.buildProjectOntology({ currentActivity: 'Ds-1-1' })
const view = presentOntology(graph)
const map = new Map(view.nodes.map(node => [node.id, node]))

test('표시 좌표 변경은 19개 활동·교육 관계·산출물 데이터를 변경하지 않는다', () => {
  const original = structuredClone(graph)
  assert.equal(view.nodes.length, 19)
  assert.deepEqual(graph, original)
  view.nodes.forEach((node, index) => {
    const { x: _x, y: _y, ...data } = node
    const { x: _ox, y: _oy, ...before } = graph.nodes[index]
    assert.deepEqual(data, before)
    assert.ok(node.x - L.cardWidth / 2 > 0 && node.x + L.cardWidth / 2 < view.width)
    assert.ok(node.y + L.cardHeight / 2 < view.height - 58)
    const lines = wrapActivityLabel(node.label)
    assert.equal(lines.join(' ').replace(/\s/g, ''), node.label.replace(/\s/g, ''))
    assert.ok(lines.length <= 2, node.label)
  })
  assert.ok(L.cardWidth >= 220 && L.row - L.cardHeight >= 20)
  assert.deepEqual(wrapActivityLabel('학습자·맥락 분석 (앱 확장)'), ['학습자·맥락 분석', '(앱 확장)'])
})

test('기본 흐름·선택한 활동의 관계·전체 연결을 각각 표시하며 의미 관계는 보존한다', () => {
  const extra = { source: 'T-1-1', target: 'E-1-1', kind: 'concept', sharedKeywords: ['기후위기'] }
  const edges = [...graph.edges, extra]
  const basic = visibleOntologyEdges(edges, null, false)
  assert.ok(basic.every(edge => ['sequential', 'stage', 'cycle'].includes(edge.kind)))
  const focus = visibleOntologyEdges(edges, 'T-1-1', false)
  assert.ok(focus.includes(extra))
  assert.ok(focus.every(edge => basic.includes(edge) || edge.source === 'T-1-1' || edge.target === 'T-1-1'))
  assert.deepEqual(visibleOntologyEdges(edges, null, true), edges)
})

function pathSamples(path) {
  const tokens = path.match(/[MLCQ]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)
  const points = []
  let cursor = { x: 0, y: 0 }, index = 0
  const point = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) })
  while (index < tokens.length) {
    const command = tokens[index++]
    const start = cursor
    if (command === 'M') { cursor = point(); points.push(cursor); continue }
    const c1 = command === 'Q' || command === 'C' ? point() : null
    const c2 = command === 'C' ? point() : null
    const end = point()
    for (let i = 1; i <= 120; i++) {
      const t = i / 120, u = 1 - t
      const value = axis => command === 'L' ? u * start[axis] + t * end[axis]
        : command === 'Q' ? u*u*start[axis] + 2*u*t*c1[axis] + t*t*end[axis]
          : u*u*u*start[axis] + 3*u*u*t*c1[axis] + 3*u*t*t*c2[axis] + t*t*t*end[axis]
      points.push({ x: value('x'), y: value('y') })
    }
    cursor = end
  }
  return points
}

test('모든 종류의 연결은 다른 활동 카드 내부를 통과하지 않고 캔버스 안에 머문다', () => {
  const edges = [...graph.edges]
  for (const source of view.nodes) for (const target of view.nodes) {
    if (source.id !== target.id) edges.push({ source: source.id, target: target.id, kind: 'concept' })
  }
  for (const edge of edges) {
    const path = ontologyEdgePath(edge, map.get(edge.source), map.get(edge.target), view.height)
    assert.doesNotMatch(path, /NaN|Infinity|undefined/)
    for (const point of pathSamples(path)) {
      assert.ok(point.x >= 0 && point.x <= view.width && point.y >= 0 && point.y <= view.height, path)
      for (const node of view.nodes) {
        if (node.id === edge.source || node.id === edge.target) continue
        assert.ok(!(Math.abs(point.x - node.x) < L.cardWidth / 2 - 0.01 && Math.abs(point.y - node.y) < L.cardHeight / 2 - 0.01), `${edge.source}→${edge.target} crosses ${node.id}`)
      }
    }
  }
  const cycle = graph.edges.find(edge => edge.kind === 'cycle')
  assert.ok(pathSamples(ontologyEdgePath(cycle, map.get(cycle.source), map.get(cycle.target), view.height)).some(point => point.y === view.height - 30))
})

test('실제 SVG는 문서 번호·전체 활동명·공개 상태·키보드 버튼과 큰 글자를 렌더한다', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectOntologyGraph, { graph }))
  assert.equal((html.match(/role="button"/g) ?? []).length, 19)
  assert.equal((html.match(/data-edge-kind="concept"/g) ?? []).length, 0)
  assert.match(html, /T-1 공동 비전 설정/)
  assert.match(html, /A-4 핵심 아이디어 도출 및 통합 수업목표 진술/)
  assert.match(html, /aria-current="step"/)
  assert.match(html, /font-size="15"/)
  assert.match(html, new RegExp(`min-width:${view.width}px`))
  assert.match(html, /모든 연결 보기/)
  assert.doesNotMatch(html, /<animate|…/)
  assert.match(source, /event.key === 'Enter'/)
  assert.match(source, /event.key === 'ArrowRight'/)
  const publicGraph = ontology.buildProjectOntology({ stageReports: { T: {} } })
  const publicHtml = renderToStaticMarkup(React.createElement(ProjectOntologyGraph, { graph: publicGraph, publicMode: true }))
  assert.match(publicHtml, /보고서 있음/)
  assert.doesNotMatch(publicHtml, /aria-current="step"/)
  const focusedHtml = renderToStaticMarkup(React.createElement(ProjectOntologyGraph, { graph, selectedId: 'A-2-3' }))
  assert.match(focusedHtml, /data-edge-kind="guardrail"/)
  assert.match(focusedHtml, /aria-pressed="true"/)
})

test('여러 그래프의 SVG 화살표 ID가 충돌하지 않는다', () => {
  const html = renderToStaticMarkup(React.createElement('div', null,
    React.createElement(ProjectOntologyGraph, { graph }), React.createElement(ProjectOntologyGraph, { graph })))
  const ids = [...html.matchAll(/<marker id="([^"]+)"/g)].map(match => match[1])
  assert.equal(ids.length, 12)
  assert.equal(new Set(ids).size, ids.length)
})

test('단계 제목·카드 코드·톤 배경의 텍스트 대비가 4.5:1 이상이다', () => {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  for (const stage of types.STAGES) {
    const palette = stagePalette(stage.code)
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
    assert.ok(ratio(palette.text, palette.surface) >= 4.5, stage.code)
    assert.ok(ratio(palette.text, '#FFFFFF') >= 4.5, stage.code)
  }
})

// 브라우저 없이 실제 컴포넌트의 SVG를 오프라인 미리보기로 저장할 수 있다.
if (process.env.ONTOLOGY_PREVIEW_PATH) {
  const previewGraph = ontology.buildProjectOntology({
    artifacts: Object.fromEntries(graph.nodes.map(node => [node.id, { title: node.label, content: {} }])),
    currentActivity: 'Ds-1-1', activityStatuses: Object.fromEntries(graph.nodes.map(node => [node.id, 'completed'])),
  })
  const html = renderToStaticMarkup(React.createElement(ProjectOntologyGraph, { graph: previewGraph }))
  const svg = html.match(/<svg viewBox="0 0 [\s\S]*?<\/svg>/)[0]
  fs.writeFileSync(process.env.ONTOLOGY_PREVIEW_PATH, svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))
}


test('모달은 선택 전 빈 상세 창 없이 전체 폭이고 선택 후 상세·원문·문서 번호를 표시한다', () => {
  const source = fs.readFileSync(new URL('../src/components/ontology/ProjectOntologyModal.tsx', import.meta.url), 'utf8')
  const compile = selection => {
    const exports = {}
    const modalBindings = {
      ...bindings,
      react: { ...React, useEffect: () => {}, useEffectEvent: fn => fn,
        useState: initial => React.useState(initial === null ? selection : initial) },
      'react-dom': { createPortal: children => children },
      'react-markdown': { __esModule: true, default: ReactMarkdown },
      '@/lib/markdown/remarkPlugins': { REMARK_PLUGINS },
      './ProjectOntologyGraph': { ProjectOntologyGraph, OntologyLegend: () => null },
    }
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, { exports, document: { body: {} }, require: key => { assert.ok(modalBindings[key], key); return modalBindings[key] } })
    return exports.ProjectOntologyModal
  }
  const project = {
    title: '수업설계 팀', currentActivity: 'Ds-1-1',
    artifacts: { 'Ds-1-1': { title: '평가 계획', content: { '평가 계획': '**그늘 지도**를 확인한다.' } } },
  }
  const basic = renderToStaticMarkup(React.createElement(compile(null), { open: true, onClose: () => {}, project }))
  assert.match(basic, /role="dialog"/)
  assert.match(basic, /aria-modal="true"/)
  assert.doesNotMatch(basic, /<aside/)
  const selected = renderToStaticMarkup(React.createElement(compile('Ds-1-1'), { open: true, onClose: () => {}, project }))
  assert.match(selected, /<aside/)
  assert.match(selected, /선택한 활동 상세/)
  assert.match(selected, /<strong[^>]*>그늘 지도<\/strong>/)
  assert.match(selected, /이 활동으로 이동/)
  assert.match(selected, /선택 해제/)
  assert.match(selected, /2xl:w-\[380px\]/)
  assert.match(source, /event.key === 'Escape'/)
  assert.match(source, /previousFocus\?\.focus/)
})

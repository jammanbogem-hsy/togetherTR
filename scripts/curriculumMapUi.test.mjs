// Regression tests for src/components/curriculum-map/mapMath.ts
// Run: node --experimental-strip-types scripts/curriculumMapUi.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  EDGE_THRESHOLD_DEFAULT,
  MAX_SCALE,
  MIN_SCALE,
  MIN_SCREEN_RADIUS,
  RENDER_RADIUS_SCALE,
  NODE_R_BASE,
  centerOn,
  clamp,
  clampScale,
  computeBounds,
  degreeRankNorm,
  easeOutCubic,
  fitToView,
  initialViewScale,
  medianRadius,
  MIN_MEDIAN_NODE_PX,
  formatCount,
  groupResultsByBand,
  formatElapsed,
  formatScore,
  isEdgeVisible,
  isInSelectionSet,
  nextSelection,
  isNodeVisible,
  lerpTransform,
  pickNodeAt,
  sanitizeTransform,
  screenRadius,
  screenToWorld,
  worldRadius,
  drawWorldRadius,
  scaleLayoutPoint,
  NODE_PADDING,
  worldToScreen,
  zoomAtPoint,
} from '../src/components/curriculum-map/mapMath.ts'
import {
  LABEL_DETAIL_ZOOM,
  LABEL_FONT_PX,
  LABEL_FONT_PX_FOCUS,
  LABEL_GAP_PX,
  LABEL_ZOOM_THRESHOLD,
  boxIntersectsCircle,
  boxesIntersect,
  isForcedLabel,
  labelAnchorY,
  labelBox,
  labelFont,
  labelFontSize,
  labelText,
  placeLabels,
  shouldDrawLabel,
} from '../src/components/curriculum-map/labelMath.ts'
import {
  DIMMED_ALPHA,
  edgeAlpha,
  edgeDimFactor,
  edgeEmphasis,
  edgeWidth,
} from '../src/components/curriculum-map/edgeMath.ts'
import {
  contextChipLabel,
  formatStandard,
  isPicked,
  pickFromItem,
  pickFromNode,
  removeFromBasket,
  resolveInitialFilters,
  subjectNamesToIds,
  toggleBasket,
} from '../src/components/curriculum-map/basketMath.ts'
import {
  ALPHA_MIN,
  ALPHA_START,
  DEFAULT_PARAMS,
  REPULSION_MAX,
  alphaStep,
  collisionPush,
  createSimLinks,
  createSimNodes,
  gridKey,
  layoutSpread,
  simulationTick,
  springRestLength,
  subjectCentroids,
} from '../src/components/curriculum-map/forceMath.ts'
import {
  ICON_MIN_SCREEN_RADIUS,
  ICON_NODE_BUDGET,
  ICON_SIZE_RATIO,
  SUBJECT_ICONS,
  subjectIcon,
} from '../src/components/curriculum-map/subjectIcons.ts'

const VIEWPORT = { width: 1000, height: 800 }
/** 실제 에셋 뷰포트(1536 폭 노트북에서 패널 380 제외) */
const REAL_VIEWPORT = { width: 1156, height: 760 }

/** 실제 에셋이 있으면 그 노드를, 없으면 관측된 경계로 대체한다. */
function loadRealNodes() {
  const p = path.join(process.cwd(), 'public', 'curriculum_map.json')
  if (!fs.existsSync(p)) {
    return [
      { id: 'a', x: 60, y: 77, degree: 0 },
      { id: 'b', x: 1940, y: 1923, degree: 26 },
    ]
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')).nodes
}

function loadRealEdges() {
  const p = path.join(process.cwd(), 'public', 'curriculum_map.json')
  if (!fs.existsSync(p)) return [{ source: 'a', target: 'b', sim: 0.6 }]
  return JSON.parse(fs.readFileSync(p, 'utf8')).edges
}

test('clamp / clampScale: keeps values inside bounds and rejects NaN', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
  assert.equal(clamp(Number.NaN, 0.3, 0.8), 0.3)
  assert.equal(clamp(Infinity, 0, 10), 0) // 유한하지 않은 값도 하한으로
  assert.equal(clampScale(0.001), MIN_SCALE)
  assert.equal(clampScale(999), MAX_SCALE)
  assert.equal(clampScale(1.5), 1.5)
})

test('easeOutCubic: monotonic from 0 to 1 and clamped outside range', () => {
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  assert.equal(easeOutCubic(-3), 0)
  assert.equal(easeOutCubic(4), 1)
  assert.ok(easeOutCubic(0.5) > 0.5)
})

test('sanitizeTransform: NaN / Infinity / zero scale can never reach the renderer', () => {
  assert.deepEqual(sanitizeTransform({ x: Number.NaN, y: 5, scale: 2 }), { x: 0, y: 5, scale: 2 })
  assert.deepEqual(sanitizeTransform({ x: 1, y: Infinity, scale: 2 }), { x: 1, y: 0, scale: 2 })
  assert.equal(sanitizeTransform({ x: 0, y: 0, scale: 0 }).scale, MIN_SCALE)
  assert.equal(sanitizeTransform({ x: 0, y: 0, scale: Number.NaN }).scale, MIN_SCALE)
  assert.equal(sanitizeTransform({ x: 0, y: 0, scale: -4 }).scale, MIN_SCALE)
})

// ─── 실제 에셋으로 본 fit / center ─────────────────────────────────────────

test('fitToView: the real asset fits entirely inside the viewport', () => {
  const nodes = loadRealNodes()
  const t = fitToView(computeBounds(nodes), REAL_VIEWPORT)
  assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y))
  assert.ok(t.scale > MIN_SCALE && t.scale <= MAX_SCALE, `scale ${t.scale}`)
  let outside = 0
  for (const n of nodes) {
    const s = worldToScreen(n, t)
    if (s.x < 0 || s.y < 0 || s.x > REAL_VIEWPORT.width || s.y > REAL_VIEWPORT.height) outside += 1
  }
  assert.equal(outside, 0, `${outside} nodes fell outside the viewport`)
})

test('medianRadius: middle value, ignores junk, empty is zero', () => {
  assert.equal(medianRadius([10, 30, 20]), 20)
  assert.equal(medianRadius([5, Number.NaN, 0, -3, 7, 9]), 7)
  assert.equal(medianRadius([]), 0)
})

test('initialViewScale: boosts the fit but never lets the median node fall under 6 px', () => {
  // 작은 배율에서는 최소 픽셀 규칙이 이긴다
  const tiny = initialViewScale(0.1, 1.35, 20)
  assert.ok(tiny * 20 >= MIN_MEDIAN_NODE_PX - 1e-9, `median px ${(tiny * 20).toFixed(2)}`)
  // 이미 충분히 크면 가중치만 적용된다
  assert.ok(Math.abs(initialViewScale(1, 1.35, 100) - 1.35) < 1e-9)
  // 방어: 반지름 정보가 없으면 가중치만
  assert.ok(Math.abs(initialViewScale(0.5, 1.35, 0) - 0.675) < 1e-9)
  assert.ok(Math.abs(initialViewScale(0.5, Number.NaN, 20) - 0.5) < 1e-9)
})

test('initialViewScale: the real asset lands at or above the 6 px floor', () => {
  const nodes = loadRealNodes()
  const scaled = nodes.map(n => scaleLayoutPoint({ x: n.x, y: n.y }))
  const radii = nodes.map(n => drawWorldRadius(n.r ?? worldRadius()))
  const median = medianRadius(radii)
  const fit = fitToView(computeBounds(scaled), REAL_VIEWPORT)
  const scale = initialViewScale(fit.scale, 1.35, median)
  assert.ok(scale >= fit.scale, '첫 화면은 fit 보다 작아지지 않는다')
  assert.ok(median * scale >= MIN_MEDIAN_NODE_PX - 1e-9, `median px ${(median * scale).toFixed(2)}`)
})

test('fitToView: distinct asset coordinates stay distinct on screen', () => {
  const nodes = loadRealNodes()
  const t = fitToView(computeBounds(nodes), REAL_VIEWPORT)
  const seen = new Set(nodes.map(n => {
    const s = worldToScreen(n, t)
    return `${Math.round(s.x)},${Math.round(s.y)}`
  }))
  // 한 점으로 모이는 회귀를 잡는다 (버그 당시 seen.size === 1)
  assert.ok(seen.size > nodes.length * 0.5, `only ${seen.size} distinct screen positions for ${nodes.length} nodes`)
})

test('fitToView: centers the bounding box and fills the smaller axis', () => {
  const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 }
  const t = fitToView(bounds, VIEWPORT, 50)
  assert.ok(Math.abs(t.scale - 700 / 2000) < 1e-9)
  const center = worldToScreen({ x: 1000, y: 1000 }, t)
  assert.ok(Math.abs(center.x - 500) < 1e-9)
  assert.ok(Math.abs(center.y - 400) < 1e-9)
})

test('fitToView: degenerate inputs never produce NaN transforms', () => {
  assert.deepEqual(fitToView(null, VIEWPORT), { x: 0, y: 0, scale: 1 })
  assert.deepEqual(fitToView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 }), { x: 0, y: 0, scale: 1 })
  assert.deepEqual(fitToView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: Number.NaN, height: 100 }), { x: 0, y: 0, scale: 1 })
  const single = fitToView({ minX: 500, minY: 500, maxX: 500, maxY: 500 }, VIEWPORT)
  assert.equal(single.scale, 1)
  assert.deepEqual(worldToScreen({ x: 500, y: 500 }, single), { x: 500, y: 400 })
})

test('computeBounds: skips non-finite points, returns null when nothing usable', () => {
  assert.equal(computeBounds([]), null)
  assert.equal(computeBounds([{ x: Number.NaN, y: 1 }]), null)
  assert.deepEqual(
    computeBounds([{ x: 10, y: 40 }, { x: Number.NaN, y: 0 }, { x: -5, y: 100 }]),
    { minX: -5, minY: 40, maxX: 10, maxY: 100 },
  )
})

test('centerOn: puts a selected node in the viewport center with a finite transform', () => {
  const nodes = loadRealNodes()
  const target = nodes[Math.floor(nodes.length / 2)]
  const t = centerOn(target, REAL_VIEWPORT, 1.5)
  const s = worldToScreen(target, t)
  assert.ok(Math.abs(s.x - REAL_VIEWPORT.width / 2) < 1e-6)
  assert.ok(Math.abs(s.y - REAL_VIEWPORT.height / 2) < 1e-6)
  assert.equal(centerOn({ x: 0, y: 0 }, VIEWPORT, 99).scale, MAX_SCALE)
  assert.equal(centerOn({ x: 0, y: 0 }, VIEWPORT, 0).scale, MIN_SCALE)
})

test('worldToScreen / screenToWorld: round-trip is stable', () => {
  const t = { x: -120, y: 65, scale: 1.75 }
  const world = { x: 831, y: 412 }
  const back = screenToWorld(worldToScreen(world, t), t)
  assert.ok(Math.abs(back.x - world.x) < 1e-9)
  assert.ok(Math.abs(back.y - world.y) < 1e-9)
})

test('zoomAtPoint: the anchored screen pixel keeps its world coordinate', () => {
  const t = { x: 30, y: -40, scale: 0.9 }
  const anchor = { x: 640, y: 300 }
  const before = screenToWorld(anchor, t)
  const zoomed = zoomAtPoint(t, anchor, 1.4)
  const after = screenToWorld(anchor, zoomed)
  assert.ok(Math.abs(after.x - before.x) < 1e-9)
  assert.ok(Math.abs(after.y - before.y) < 1e-9)
  assert.ok(zoomed.scale > t.scale)
})

test('zoomAtPoint: clamps at the limits and survives a bad factor', () => {
  const t = { x: 0, y: 0, scale: MAX_SCALE }
  assert.equal(zoomAtPoint(t, { x: 100, y: 100 }, 3).scale, MAX_SCALE)
  assert.equal(zoomAtPoint(t, { x: 100, y: 100 }, Number.NaN).scale, MAX_SCALE)
  assert.equal(zoomAtPoint({ x: 0, y: 0, scale: MIN_SCALE }, { x: 0, y: 0 }, 0.1).scale, MIN_SCALE)
})

test('lerpTransform: interpolates, clamps progress, and stays finite', () => {
  const a = { x: 0, y: 0, scale: 1 }
  const b = { x: 100, y: 200, scale: 3 }
  assert.deepEqual(lerpTransform(a, b, 0), a)
  assert.deepEqual(lerpTransform(a, b, 1), b)
  assert.deepEqual(lerpTransform(a, b, 0.5), { x: 50, y: 100, scale: 2 })
  assert.deepEqual(lerpTransform(a, b, 5), b)
})

// ─── 월드 단위 반지름 ──────────────────────────────────────────────────────

test('degreeRankNorm: rank based, ties equal, spans 0..1', () => {
  const norms = degreeRankNorm([
    { id: 'a', degree: 0 },
    { id: 'b', degree: 5 },
    { id: 'c', degree: 5 },
    { id: 'd', degree: 20 },
  ])
  assert.equal(norms.get('a'), 0)
  assert.equal(norms.get('b'), norms.get('c')) // 동률은 같은 값
  assert.equal(norms.get('d'), 1)
  assert.ok(norms.get('b') > 0 && norms.get('b') < 1)
  assert.equal(degreeRankNorm([]).size, 0)
  assert.equal(degreeRankNorm([{ id: 'x', degree: 9 }]).get('x'), 0)
})

test('degreeRankNorm: real asset spans the full range without NaN', () => {
  const nodes = loadRealNodes()
  const norms = degreeRankNorm(nodes)
  const values = [...norms.values()]
  assert.equal(values.length, nodes.length)
  assert.ok(values.every(v => Number.isFinite(v) && v >= 0 && v <= 1))
  assert.equal(Math.min(...values), 0)
  assert.equal(Math.max(...values), 1)
})

test('worldRadius: one uniform size, same value as the builder NODE_RADIUS', () => {
  assert.equal(worldRadius(), NODE_R_BASE)
  assert.equal(NODE_R_BASE, 12)
})

test('drawWorldRadius / scaleLayoutPoint: K is applied to radius AND coordinates', () => {
  assert.ok(RENDER_RADIUS_SCALE > 1, '가독성 보정 배수가 1보다 커야 한다')
  assert.equal(drawWorldRadius(10), 10 * RENDER_RADIUS_SCALE)
  assert.equal(drawWorldRadius(10, 2), 20)
  assert.deepEqual(scaleLayoutPoint({ x: 100, y: 50 }), {
    x: 100 * RENDER_RADIUS_SCALE,
    y: 50 * RENDER_RADIUS_SCALE,
  })
  // 망가진 입력도 그릴 수 있는 값으로
  assert.ok(drawWorldRadius(Number.NaN) > 0)
  assert.ok(drawWorldRadius(0) > 0)
})

test('screenRadius: does NOT re-apply K (input is already a draw radius)', () => {
  // K 를 두 번 곱하면 원이 충돌 반지름보다 커져 확대 시 겹쳐 보인다 (실제 결함)
  assert.equal(screenRadius(8, 1), 8)
  assert.equal(screenRadius(8, 2), 16)
  assert.equal(screenRadius(drawWorldRadius(8), 1), 8 * RENDER_RADIUS_SCALE)
  assert.equal(screenRadius(8, 0.001), MIN_SCREEN_RADIUS)
  assert.equal(screenRadius(Number.NaN, 1), MIN_SCREEN_RADIUS)
  assert.ok(screenRadius(26, 3) > screenRadius(8, 3))
})

test('edgeWidth: 1.2 to 2.5 px by similarity', () => {
  assert.equal(edgeWidth(0), 1.2)
  assert.equal(edgeWidth(1), 2.5)
  assert.ok(edgeWidth(0.5) > edgeWidth(0.2))
  assert.equal(edgeWidth(5), 2.5)
  assert.equal(edgeWidth(Number.NaN), 1.2)
})

test('edgeEmphasis: selection NEVER emphasizes an asset edge, loading or ready', () => {
  const edge = { source: 'sel', target: 'other' }
  // 판정 대기 중에도 선택 노드의 엣지는 배경선이다 (잠정 회색 선을 그리지 않는다)
  assert.equal(edgeEmphasis(edge, { focusId: null, selectedId: 'sel', relatedPending: true }), 'background')
  // 판정 완료 후에도 배경선. 색 있는 관계선만 선택 노드에서 나간다.
  assert.equal(edgeEmphasis(edge, { focusId: null, selectedId: 'sel', relatedPending: false }), 'background')
  assert.equal(edgeEmphasis(edge, { focusId: null, selectedId: null, relatedPending: false }), 'background')
})

test('edgeEmphasis: only hover darkens an asset edge, from either endpoint', () => {
  const ctx = { focusId: 'h', selectedId: 'sel', relatedPending: false }
  assert.equal(edgeEmphasis({ source: 'h', target: 'x' }, ctx), 'hover')
  assert.equal(edgeEmphasis({ source: 'x', target: 'h' }, ctx), 'hover')
  // 호버 대상과 무관하면 선택 노드에 붙어 있어도 배경선
  assert.equal(edgeEmphasis({ source: 'sel', target: 'x' }, ctx), 'background')
})

test('edgeDimFactor: one factor applies to every background edge', () => {
  assert.equal(edgeDimFactor({ focusId: null, searchActive: false, selectedId: null }), 1)
  assert.equal(edgeDimFactor({ focusId: null, searchActive: false, selectedId: 'a' }), 0.4)
  assert.equal(edgeDimFactor({ focusId: null, searchActive: true, selectedId: null }), 0.45)
  assert.equal(edgeDimFactor({ focusId: 'h', searchActive: true, selectedId: 'a' }), DIMMED_ALPHA)
})

test('edgeAlpha: rises with similarity, capped for legibility', () => {
  assert.ok(edgeAlpha(0.3) < edgeAlpha(0.9))
  assert.ok(edgeAlpha(1) <= 0.4)
  assert.ok(edgeAlpha(0) >= 0.06)
  assert.ok(edgeAlpha(1) > DIMMED_ALPHA * 0.5)
})

// ─── 가시성 · 라벨 ─────────────────────────────────────────────────────────

test('isNodeVisible: subject and band filters are subtractive', () => {
  const node = { subjectId: 'sub_sci', band: '5-6학년군' }
  assert.equal(isNodeVisible(node, { hiddenSubjectIds: [], hiddenBands: [] }), true)
  assert.equal(isNodeVisible(node, { hiddenSubjectIds: ['sub_sci'], hiddenBands: [] }), false)
  assert.equal(isNodeVisible(node, { hiddenSubjectIds: [], hiddenBands: ['5-6학년군'] }), false)
  assert.equal(isNodeVisible(node, { hiddenSubjectIds: ['sub_kor'], hiddenBands: ['3-4학년군'] }), true)
})

test('isEdgeVisible: needs both endpoints visible and sim above threshold', () => {
  const visible = new Set(['a', 'b'])
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.7 }, EDGE_THRESHOLD_DEFAULT, visible), true)
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.4 }, EDGE_THRESHOLD_DEFAULT, visible), false)
  assert.equal(isEdgeVisible({ source: 'a', target: 'z', sim: 0.99 }, EDGE_THRESHOLD_DEFAULT, visible), false)
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.5 }, 0.5, visible), true)
})

test('isEdgeVisible: selected node keeps its edges regardless of threshold', () => {
  const visible = new Set(['a', 'b'])
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.1 }, 0.8, visible, 'a'), true)
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.1 }, 0.8, visible, 'b'), true)
  assert.equal(isEdgeVisible({ source: 'a', target: 'z', sim: 0.1 }, 0.8, visible, 'a'), false)
})

test('shouldDrawLabel / isForcedLabel: zoom cutoff plus forced overrides', () => {
  const base = { scale: 0.6, alwaysLabels: false, isResult: false, isSelected: false, isHovered: false }
  assert.equal(shouldDrawLabel(base), false)
  assert.equal(isForcedLabel(base), false)
  assert.equal(shouldDrawLabel({ ...base, scale: LABEL_ZOOM_THRESHOLD }), true)
  assert.equal(shouldDrawLabel({ ...base, scale: LABEL_ZOOM_THRESHOLD - 0.01 }), false)
  assert.equal(shouldDrawLabel({ ...base, alwaysLabels: true }), true)
  for (const key of ['isResult', 'isSelected', 'isHovered', 'isNeighbor']) {
    assert.equal(shouldDrawLabel({ ...base, [key]: true }), true, key)
    assert.equal(isForcedLabel({ ...base, [key]: true }), true, key)
  }
  // alwaysLabels 는 강제 라벨이 아니다 (가림 검사를 받는다)
  assert.equal(isForcedLabel({ ...base, alwaysLabels: true }), false)
})

test('isInSelectionSet: provisional asset neighbours are REPLACED by the Jev set', () => {
  const neighbors = new Set(['n1', 'n2'])
  const jev = new Set(['j1', 'n1'])
  const pending = { selectedId: 's', relatedPending: true, selectedNeighbors: neighbors, relatedIds: jev }
  const ready = { ...pending, relatedPending: false }

  // 판정 전: 선택 노드 + 에셋 이웃이 밝다
  assert.equal(isInSelectionSet('s', pending), true)
  assert.equal(isInSelectionSet('n1', pending), true)
  assert.equal(isInSelectionSet('n2', pending), true)
  assert.equal(isInSelectionSet('j1', pending), false)

  // 판정 후: Jev 집합으로 교체 — 잠정에만 있던 n2 는 다시 흐려진다
  assert.equal(isInSelectionSet('s', ready), true)
  assert.equal(isInSelectionSet('j1', ready), true)
  assert.equal(isInSelectionSet('n1', ready), true)
  assert.equal(isInSelectionSet('n2', ready), false)

  // 선택이 없으면 아무도 강조되지 않는다
  assert.equal(isInSelectionSet('n1', { ...ready, selectedId: null }), false)
})

test('nextSelection: clicking the same node clears, a different node switches', () => {
  assert.equal(nextSelection('a', 'a'), null) // 재클릭 = 해제
  assert.equal(nextSelection('b', 'a'), 'b')  // 다른 노드 = 전환
  assert.equal(nextSelection('a', null), 'a')
  assert.equal(nextSelection(null, 'a'), null) // 빈 공간 = 해제
  assert.equal(nextSelection(null, null), null)
})

test('labelText: code alone until the detail zoom, then code + text head', () => {
  const text = '일상생활에서 힘과 관련된 현상에 흥미를 갖고 관찰할 수 있다.'
  assert.equal(labelText('[4과01-01]', text, 1), '[4과01-01]')
  assert.equal(labelText('[4과01-01]', text, LABEL_DETAIL_ZOOM - 0.01), '[4과01-01]')
  const detailed = labelText('[4과01-01]', text, LABEL_DETAIL_ZOOM)
  assert.ok(detailed.startsWith('[4과01-01] '))
  assert.ok(detailed.length > '[4과01-01]'.length)
  assert.equal(labelText('[4과01-01]', '', 4), '[4과01-01]')
})

test('labelFontSize: constant CSS pixels, never scaled by zoom or dpr', () => {
  // 회귀 방지: 배율·dpr 을 곱하면 HiDPI 에서 글자가 2배로 보였다
  assert.equal(labelFontSize({ focused: false }), 14)
  assert.equal(labelFontSize({ focused: true }), 15)
  for (const viewScale of [0.15, 1, 2.5, 6]) {
    for (const devicePixelRatio of [1, 2, 3]) {
      assert.equal(labelFontSize({ focused: false, viewScale, devicePixelRatio }), LABEL_FONT_PX)
      assert.equal(labelFontSize({ focused: true, viewScale, devicePixelRatio }), LABEL_FONT_PX_FOCUS)
    }
  }
})

test('labelFont: real family names only, no CSS variables', () => {
  const font = labelFont(14)
  assert.ok(font.includes('14px'))
  assert.ok(font.includes('Noto Sans KR'))
  // 캔버스는 var(--x) 를 해석하지 못해 대입이 무시되고 직전 폰트가 남는다
  assert.ok(!font.includes('var('), 'ctx.font 에 CSS 변수를 넣으면 안 된다')
  assert.ok(font.startsWith('500 '), '굵기 500')
})

test('labelAnchorY: label sits below the node, never on it', () => {
  assert.equal(labelAnchorY(100, 10), 100 + 10 + LABEL_GAP_PX)
  // 노드 아래쪽(원의 밑면)보다 더 아래여야 아이콘을 덮지 않는다
  assert.ok(labelAnchorY(100, 10) > 100 + 10)
  assert.ok(labelAnchorY(0, 2.5) > 2.5)
})

test('labelBox: box hangs below the anchor and is centered on the node', () => {
  const box = labelBox(200, 50, 60, 14)
  assert.ok(Math.abs((box.x0 + box.x1) / 2 - 200) < 1e-9, '가로 중앙 정렬')
  assert.ok(box.y0 >= 50 - 2 && box.y1 > 50 + 14, '앵커 아래로 뻗는다')
  assert.ok(box.x1 - box.x0 >= 60, '측정 폭을 담는다')
})

test('boxIntersectsCircle: blocks labels that would cover a highlighted node', () => {
  const box = { x0: 0, y0: 0, x1: 20, y1: 12 }
  assert.equal(boxIntersectsCircle(box, { x: 10, y: 6, r: 3 }), true) // 안쪽
  assert.equal(boxIntersectsCircle(box, { x: 25, y: 6, r: 8 }), true) // 살짝 겹침
  assert.equal(boxIntersectsCircle(box, { x: 60, y: 6, r: 8 }), false)
  assert.equal(boxIntersectsCircle(box, { x: 10, y: 40, r: 5 }), false)
})

test('placeLabels: blockers reject labels over highlighted circles', () => {
  const box = { x0: 0, y0: 0, x1: 20, y1: 12 }
  const cand = [{ id: 'a', box, priority: 1, forced: false }]
  assert.equal(placeLabels(cand, []).has('a'), true)
  assert.equal(placeLabels(cand, [{ x: 10, y: 6, r: 4 }]).has('a'), false)
  // 강제 라벨은 원과 겹쳐도 그린다 (사용자가 지목한 노드)
  const forced = [{ id: 'a', box, priority: 1, forced: true }]
  assert.equal(placeLabels(forced, [{ x: 10, y: 6, r: 4 }]).has('a'), true)
})

test('boxesIntersect: touching edges do not count as overlap', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 }
  assert.equal(boxesIntersect(a, { x0: 5, y0: 5, x1: 15, y1: 15 }), true)
  assert.equal(boxesIntersect(a, { x0: 10, y0: 0, x1: 20, y1: 10 }), false)
  assert.equal(boxesIntersect(a, { x0: 0, y0: 10, x1: 10, y1: 20 }), false)
  assert.equal(boxesIntersect(a, { x0: 20, y0: 20, x1: 30, y1: 30 }), false)
})

test('placeLabels: overlapping labels are dropped, highest priority wins', () => {
  const box = (x) => ({ x0: x, y0: 0, x1: x + 20, y1: 12 })
  const kept = placeLabels([
    { id: 'low', box: box(0), priority: 0.1, forced: false },
    { id: 'high', box: box(5), priority: 0.9, forced: false },
    { id: 'clear', box: box(100), priority: 0.2, forced: false },
  ])
  assert.ok(kept.has('high'))
  assert.ok(!kept.has('low'), 'overlapping lower-priority label must be skipped')
  assert.ok(kept.has('clear'))
})

test('placeLabels: forced labels always draw and still reserve space', () => {
  const box = (x) => ({ x0: x, y0: 0, x1: x + 20, y1: 12 })
  const kept = placeLabels([
    { id: 'plain', box: box(0), priority: 1, forced: false },
    { id: 'selected', box: box(2), priority: 0, forced: true },
  ])
  assert.ok(kept.has('selected'))
  assert.ok(!kept.has('plain'))
  // 강제 라벨이 여러 개면 모두 그린다 (겹쳐도 사용자가 지목한 것들)
  const both = placeLabels([
    { id: 'a', box: box(0), priority: 0, forced: true },
    { id: 'b', box: box(1), priority: 0, forced: true },
  ])
  assert.equal(both.size, 2)
  assert.equal(placeLabels([]).size, 0)
})


// ─── 힘 레이아웃 (forceMath) ───────────────────────────────────────────────

function simParams(overrides = {}) {
  return {
    ...DEFAULT_PARAMS,
    alpha: 0.35,
    center: { x: 0, y: 0 },
    subjectCentroids: new Map(),
    ...overrides,
  }
}

test('createSimNodes: seeds exactly on the asset coordinates', () => {
  // 정착 연출을 대체한 보증: 시뮬레이션은 에셋 좌표에서 시작하므로
  // 물리를 꺼도 (또는 첫 프레임에도) 배치가 에셋과 동일하다.
  const asset = [
    { id: 'a', subjectId: 'sub_kor', x: 60, y: 77, r: 8 },
    { id: 'b', subjectId: 'sub_sci', x: 3109, y: 3081, r: 26 },
  ]
  const sim = createSimNodes(asset, id => (id === 'a' ? 8 : 26))
  assert.equal(sim[0].x, 60)
  assert.equal(sim[0].y, 77)
  assert.equal(sim[1].x, 3109)
  assert.equal(sim[1].y, 3081)
  assert.deepEqual([sim[0].homeX, sim[0].homeY], [60, 77])
  assert.deepEqual([sim[0].vx, sim[0].vy], [0, 0])
  assert.equal(sim[0].fx, null)
  // 에셋 객체는 변형되지 않는다
  assert.deepEqual(asset[0], { id: 'a', subjectId: 'sub_kor', x: 60, y: 77, r: 8 })
})

test('simulationTick: one tick on the real asset keeps every position finite', () => {
  const nodes = loadRealNodes()
  const sim = createSimNodes(nodes, () => 12)
  const index = new Map(sim.map((n, i) => [n.id, i]))
  const edges = loadRealEdges()
  const links = createSimLinks(edges, index, sim, layoutSpread(3049))
  assert.ok(links.length > 0, 'links should be built from the asset edges')
  simulationTick(sim, links, simParams({ center: { x: 1584, y: 1584 } }))
  for (const n of sim) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} went non-finite`)
    assert.ok(Number.isFinite(n.vx) && Number.isFinite(n.vy), `${n.id} velocity went non-finite`)
  }
})

test('simulationTick: recovers a node whose coordinates are already broken', () => {
  const sim = createSimNodes(
    [{ id: 'a', subjectId: 's', x: 100, y: 100 }, { id: 'b', subjectId: 's', x: 200, y: 200 }],
    () => 10,
  )
  sim[0].x = Number.NaN
  sim[0].vx = Infinity
  simulationTick(sim, [], simParams())
  assert.ok(Number.isFinite(sim[0].x) && Number.isFinite(sim[0].y))
  assert.equal(sim[0].x, 100) // homeX 로 복구
})

test('simulationTick: pinned nodes stay exactly where they were dropped', () => {
  const sim = createSimNodes(
    [{ id: 'a', subjectId: 's', x: 0, y: 0 }, { id: 'b', subjectId: 's', x: 30, y: 0 }],
    () => 10,
  )
  sim[0].fx = 500
  sim[0].fy = 250
  for (let i = 0; i < 5; i++) simulationTick(sim, [], simParams())
  assert.equal(sim[0].x, 500)
  assert.equal(sim[0].y, 250)
  assert.notEqual(sim[1].x, 30) // 고정되지 않은 쪽은 밀려난다
})

test('collisionPush: separates two overlapping nodes to exactly r + r + pad', () => {
  const a = { x: 0, y: 0, r: 10 }
  const b = { x: 6, y: 0, r: 10 }
  const push = collisionPush(a, b, 6)
  assert.ok(push, 'overlapping pair must produce a push')
  const ax = a.x + push.dx
  const bx = b.x - push.dx
  const ay = a.y + push.dy
  const by = b.y - push.dy
  assert.ok(Math.abs(Math.hypot(ax - bx, ay - by) - 26) < 1e-9, 'gap must equal r + r + pad')
  // 충분히 떨어져 있으면 밀지 않는다
  assert.equal(collisionPush({ x: 0, y: 0, r: 5 }, { x: 100, y: 0, r: 5 }, 6), null)
})

test('collisionPush: identical positions still separate deterministically', () => {
  const push = collisionPush({ x: 7, y: 7, r: 8 }, { x: 7, y: 7, r: 8 }, 6)
  assert.ok(push)
  assert.ok(Number.isFinite(push.dx) && Number.isFinite(push.dy))
  assert.ok(Math.hypot(push.dx, push.dy) > 0)
})

test('simulationTick: collision resolves overlap inside the grid pass', () => {
  const sim = createSimNodes(
    [{ id: 'a', subjectId: 's', x: 0, y: 0 }, { id: 'b', subjectId: 's', x: 4, y: 0 }],
    () => 10,
  )
  const before = Math.hypot(sim[0].x - sim[1].x, sim[0].y - sim[1].y)
  simulationTick(sim, [], simParams())
  const after = Math.hypot(sim[0].x - sim[1].x, sim[0].y - sim[1].y)
  assert.ok(after > before, `overlap must open up (${before} -> ${after})`)
  assert.ok(after >= 26 - 1e-6, `must reach r + r + pad, got ${after}`)
})

test('simulationTick: coincident nodes separate without blowing up', () => {
  // 반발력에 상한이 없으면 1/d² 가 폭주해 좌표가 수십만 단위로 튄다.
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, subjectId: 's', x: 100, y: 100 }))
  const sim = createSimNodes(many, () => 12)
  for (let i = 0; i < 120; i++) simulationTick(sim, [], simParams())
  assert.ok(sim.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)), 'positions must stay finite')
  const spread = Math.max(...sim.map(n => Math.hypot(n.x - 100, n.y - 100)))
  assert.ok(spread > 12, '겹친 노드는 벌어져야 한다')
  assert.ok(spread < 5000, `배치가 폭주하면 안 된다 (spread ${spread.toFixed(0)})`)
  assert.ok(REPULSION_MAX > 0 && REPULSION_MAX <= 50)
})

test('simulationTick: the real asset stays near its seeded layout', () => {
  // 에셋의 겹침 없는 배치를 크게 흔들면 사용자가 알던 군집이 사라진다.
  const nodes = loadRealNodes()
  const sim = createSimNodes(nodes, id => nodes.find(n => n.id === id)?.r ?? 12)
  const index = new Map(sim.map((n, i) => [n.id, i]))
  const links = createSimLinks(loadRealEdges(), index, sim, layoutSpread(3049))
  const params = simParams({ center: { x: 1584, y: 1584 } })
  let alpha = ALPHA_START
  for (let i = 0; i < 300; i++) {
    alpha = alphaStep(alpha)
    params.alpha = alpha
    simulationTick(sim, links, params)
  }
  const drifts = sim.map(n => Math.hypot(n.x - n.homeX, n.y - n.homeY))
  const avg = drifts.reduce((a, b) => a + b, 0) / drifts.length
  assert.ok(avg < 400, `평균 이동이 너무 크면 군집이 깨진다 (avg ${avg.toFixed(0)})`)
  assert.ok(sim.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)))
  // 충돌 처리 덕에 최종 상태에는 겹침이 남지 않는다
  let overlaps = 0
  for (let i = 0; i < sim.length; i++) {
    for (let j = i + 1; j < sim.length; j++) {
      if (Math.hypot(sim[i].x - sim[j].x, sim[i].y - sim[j].y) < sim[i].r + sim[j].r) overlaps++
    }
  }
  assert.equal(overlaps, 0, `${overlaps} overlapping pairs remain`)
})

test('K-scaled seed of the real asset has zero overlapping pairs', () => {
  // 그리는 반지름(r * K)과 시드 좌표(x,y * K)에 같은 K 를 써야 빌더가 보장한
  // 겹침 없는 배치가 유지된다. 반지름에만 K 를 곱하면 확대 시 원이 겹친다.
  const nodes = loadRealNodes()
  const scaled = nodes.map(n => ({
    id: n.id,
    r: drawWorldRadius(n.r ?? worldRadius()),
    ...scaleLayoutPoint({ x: n.x, y: n.y }),
  }))
  let violations = 0
  let tightest = Infinity
  for (let i = 0; i < scaled.length; i++) {
    for (let j = i + 1; j < scaled.length; j++) {
      const a = scaled[i]
      const b = scaled[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r)
      if (gap < tightest) tightest = gap
      if (gap < 0) violations++
    }
  }
  assert.equal(violations, 0, `${violations} pairs overlap at the K-scaled seed (tightest ${tightest.toFixed(2)})`)
  assert.ok(tightest > 0, `tightest gap ${tightest.toFixed(2)} must stay positive`)
})

test('K-scaled seed keeps the collision pad, so the first tick has nothing to fix', () => {
  const nodes = loadRealNodes()
  const sim = createSimNodes(
    nodes.map(n => ({ ...n, ...scaleLayoutPoint({ x: n.x, y: n.y }) })),
    id => drawWorldRadius(nodes.find(n => n.id === id)?.r ?? worldRadius()),
  )
  let padViolations = 0
  for (let i = 0; i < sim.length; i++) {
    for (let j = i + 1; j < sim.length; j++) {
      const d = Math.hypot(sim[i].x - sim[j].x, sim[i].y - sim[j].y)
      if (d < sim[i].r + sim[j].r + NODE_PADDING) padViolations++
    }
  }
  // 에셋이 padding 8 로 배치되고 좌표가 K 배 늘어나므로 여유가 더 커진다
  assert.equal(padViolations, 0, `${padViolations} pairs inside the collision pad`)
})

test('alphaStep: decays toward the target but holds at ALPHA_MIN forever', () => {
  let alpha = ALPHA_START
  for (let i = 0; i < 20; i++) alpha = alphaStep(alpha)
  assert.ok(alpha < ALPHA_START, 'alpha should decay')
  // 수천 스텝을 돌려도 ALPHA_MIN 아래로 내려가지 않아 미세한 움직임이 남는다
  for (let i = 0; i < 20000; i++) alpha = alphaStep(alpha)
  assert.equal(alpha, ALPHA_MIN)
  assert.ok(ALPHA_MIN > 0, '완전히 멈추면 Obsidian 식 상시 움직임이 사라진다')
  assert.equal(alphaStep(Number.NaN), ALPHA_MIN)
})

test('springRestLength: blends the asset distance 70/30 toward the sim target', () => {
  const spread = layoutSpread(3049)
  const near = springRestLength(200, 0.95, spread)
  const far = springRestLength(200, 0.3, spread)
  assert.ok(far > near, '유사도가 낮을수록 더 멀리 앉는다')
  // 에셋 거리가 70% 이므로 결과는 에셋 거리에 가깝다
  assert.ok(near > 200 * 0.7 && near < 200 * 0.7 + 200)
  assert.ok(Number.isFinite(springRestLength(Number.NaN, Number.NaN, Number.NaN)))
  assert.equal(layoutSpread(2000), 1)
  assert.equal(layoutSpread(0), 1)
  assert.equal(layoutSpread(Number.NaN), 1)
})

test('subjectCentroids: averages each subject and ignores unknown ids', () => {
  const c = subjectCentroids([
    { subjectId: 'a', x: 0, y: 0 },
    { subjectId: 'a', x: 10, y: 20 },
    { subjectId: 'b', x: 5, y: 5 },
  ])
  assert.deepEqual(c.get('a'), { x: 5, y: 10 })
  assert.deepEqual(c.get('b'), { x: 5, y: 5 })
  assert.equal(c.get('missing'), undefined)
  assert.equal(subjectCentroids([]).size, 0)
})

test('gridKey: neighbouring cells differ, same cell matches', () => {
  const size = 150
  assert.equal(gridKey(10, 10, size), gridKey(140, 140, size))
  assert.notEqual(gridKey(10, 10, size), gridKey(160, 10, size))
  assert.notEqual(gridKey(10, 10, size), gridKey(10, 160, size))
  // 음수 좌표도 안전하게 담긴다
  assert.notEqual(gridKey(-200, 0, size), gridKey(200, 0, size))
  assert.ok(Number.isFinite(gridKey(Number.NaN, 0, size)))
})

// ─── 교과 아이콘 ──────────────────────────────────────────────────────────

test('subjectIcon: maps all 12 subjects, empty for unknown', () => {
  assert.equal(Object.keys(SUBJECT_ICONS).length, 12)
  assert.equal(subjectIcon('sub_kor'), 'menu_book')
  assert.equal(subjectIcon('sub_math'), 'calculate')
  assert.equal(subjectIcon('sub_extra'), 'explore')
  // 모르는 교과는 빈 문자열 → 호출부가 그리기를 건너뛴다 (리거처 이름 노출 방지)
  assert.equal(subjectIcon('sub_nope'), '')
  assert.equal(subjectIcon(undefined), '')
  assert.equal(subjectIcon(''), '')
})

test('subjectIcon: the real asset has an icon for every subject it uses', () => {
  const p = path.join(process.cwd(), 'public', 'curriculum_map.json')
  if (!fs.existsSync(p)) return
  const asset = JSON.parse(fs.readFileSync(p, 'utf8'))
  const missing = asset.subjects.filter(s => !subjectIcon(s.id)).map(s => `${s.id}(${s.name})`)
  assert.deepEqual(missing, [], `subjects without an icon: ${missing.join(', ')}`)
})

test('every subject icon name is in the layout icon_names subset', () => {
  // 서브셋에 없는 이름은 폰트에 글리프가 없어 리거처 이름이 글자로 그려진다.
  const layout = fs.readFileSync(path.join(process.cwd(), 'src/app/layout.tsx'), 'utf8')
  const start = layout.indexOf('icon_names')
  const end = layout.indexOf('].sort()')
  assert.ok(start > 0 && end > start, 'icon_names 배열을 찾지 못했다')
  const subset = layout.slice(start, end)
  const missing = Object.values(SUBJECT_ICONS).filter(name => !subset.includes(`'${name}'`))
  assert.deepEqual(missing, [], `missing from the subset: ${missing.join(', ')}`)
})

test('icon thresholds: only legible sizes, with a per-frame budget', () => {
  assert.ok(ICON_MIN_SCREEN_RADIUS >= 8, '너무 작으면 아이콘이 뭉개진다')
  assert.ok(ICON_SIZE_RATIO > 1 && ICON_SIZE_RATIO < 1.5)
  assert.ok(ICON_NODE_BUDGET > 0 && ICON_NODE_BUDGET <= 1000)
  // 아이콘은 반지름에 비례하되 노드를 넘치지 않는 범위
  assert.ok(ICON_MIN_SCREEN_RADIUS * ICON_SIZE_RATIO >= 9)
})

// ─── 담기 · 시트 연동 ──────────────────────────────────────────────────────

const SUBJECTS = [
  { id: 'sub_soc', name: '사회', color: '#D97706' },
  { id: 'sub_int', name: '통합교과', color: '#0D9488' },
  { id: 'sub_kor', name: '국어', color: '#7C3AED' },
]

test('subjectNamesToIds: sheet names map to asset ids, unknown names dropped, no dupes', () => {
  assert.deepEqual(subjectNamesToIds(['사회', '통합교과'], SUBJECTS), ['sub_soc', 'sub_int'])
  assert.deepEqual(subjectNamesToIds([' 사회 ', '사회', '없는교과'], SUBJECTS), ['sub_soc'])
  assert.deepEqual(subjectNamesToIds([], SUBJECTS), [])
  assert.deepEqual(subjectNamesToIds(['국어'], []), [])
})

test('formatStandard: "[code] text", never double-bracketed', () => {
  assert.equal(formatStandard('[4과01-01]', '힘을 관찰한다.'), '[4과01-01] 힘을 관찰한다.')
  assert.equal(formatStandard('4과01-01', '힘을 관찰한다.'), '[4과01-01] 힘을 관찰한다.')
  assert.equal(formatStandard('[4과01-01]', ''), '[4과01-01]')
  assert.equal(formatStandard(' 4과01-01 ', ' 본문 '), '[4과01-01] 본문')
})

const NODE = {
  id: 'sub_soc_6사01-01', code: '[6사01-01]', subjectId: 'sub_soc', subject: '사회',
  band: '5-6학년군', area: '지리 인식', coreIdeaId: 'ci', coreIdea: '위치는 관계로 이해한다',
  text: '우리나라의 위치를 설명한다.', x: 0, y: 0, degree: 3,
}

test('pickFromNode: builds the sheet contract from an asset node', () => {
  const pick = pickFromNode(NODE)
  assert.deepEqual(pick, {
    id: 'sub_soc_6사01-01',
    code: '[6사01-01]',
    text: '우리나라의 위치를 설명한다.',
    standard: '[6사01-01] 우리나라의 위치를 설명한다.',
    subject: '사회',
    subjectId: 'sub_soc',
    band: '5-6학년군',
    area: '지리 인식',
    coreIdea: '위치는 관계로 이해한다',
  })
  assert.equal(pick.contentCoreIdea, undefined)
})

test('pickFromItem: uses the asset node when available, else the item alone', () => {
  const item = { id: 'x', code: '[4과10-02]', text: 't', subject: '과학', subjectId: 'sub_sci', band: '3-4학년군', area: '물질' }
  const fromItem = pickFromItem(item, null)
  assert.equal(fromItem.standard, '[4과10-02] t')
  assert.equal(fromItem.coreIdea, '') // 응답에는 핵심 아이디어가 없다
  const fromNode = pickFromItem(item, NODE)
  assert.equal(fromNode.coreIdea, '위치는 관계로 이해한다') // 노드가 있으면 보충
})

test('toggleBasket / removeFromBasket / isPicked: pure, order-preserving, immutable', () => {
  const a = pickFromNode(NODE)
  const b = pickFromNode({ ...NODE, id: 'b', code: '[6사01-02]' })
  const empty = []
  const one = toggleBasket(empty, a)
  assert.deepEqual(one.map(p => p.id), [a.id])
  assert.deepEqual(empty, [], '원본 배열은 바뀌지 않는다')
  const two = toggleBasket(one, b)
  assert.deepEqual(two.map(p => p.id), [a.id, b.id])
  // 다시 토글하면 빠진다 (순서 유지)
  assert.deepEqual(toggleBasket(two, a).map(p => p.id), [b.id])
  assert.deepEqual(removeFromBasket(two, b.id).map(p => p.id), [a.id])
  assert.equal(isPicked(two, a.id), true)
  assert.equal(isPicked(two, 'nope'), false)
})

test('contextChipLabel: joins present parts with a middle dot', () => {
  assert.equal(contextChipLabel({ subject: '사회', gradeBand: '5-6학년군', coreIdea: '지리 인식' }), '사회 · 5-6학년군 · 지리 인식')
  assert.equal(contextChipLabel({ subject: '사회', coreIdea: '' }), '사회')
  assert.equal(contextChipLabel({}), '')
})

const ASSET = { subjects: SUBJECTS, bands: ['1-2학년군', '3-4학년군', '5-6학년군'] }
const BASE = { hiddenSubjectIds: [], hiddenBands: [], edgeThreshold: 0.5, alwaysLabels: false, physics: true, layout: 'grid' }

test('resolveInitialFilters: given lists are the only ones on; absent means all on', () => {
  const r = resolveInitialFilters({ initialSubjects: ['사회'], initialBands: ['5-6학년군'] }, ASSET, BASE)
  assert.deepEqual(r.hiddenSubjectIds.sort(), ['sub_int', 'sub_kor'])
  assert.deepEqual(r.hiddenBands.sort(), ['1-2학년군', '3-4학년군'])
  const allOn = resolveInitialFilters({}, ASSET, BASE)
  assert.deepEqual(allOn.hiddenSubjectIds, [])
  assert.deepEqual(allOn.hiddenBands, [])
})

test('resolveInitialFilters: a previous open must not leak into the next one', () => {
  // 실제 결함: 사회 줄에서 열었던 필터가 남아, 맥락 없는 다음 열기에서도 사회만 켜져 있었다
  const leaked = { ...BASE, hiddenSubjectIds: ['sub_int', 'sub_kor'], hiddenBands: ['1-2학년군', '3-4학년군'] }
  const r = resolveInitialFilters({}, ASSET, leaked)
  assert.deepEqual(r.hiddenSubjectIds, [], '교과는 전부 켜져야 한다')
  assert.deepEqual(r.hiddenBands, [], '학년군도 전부 켜져야 한다')
  // 그 외 설정(선 굵기·라벨·움직임)은 그대로 둔다
  assert.equal(r.edgeThreshold, 0.5)
  assert.equal(r.physics, true)
})

test('resolveInitialFilters: unknown names or bands fall back to all on', () => {
  const r = resolveInitialFilters({ initialSubjects: ['없는교과'], initialBands: ['7-8학년군'] }, ASSET, BASE)
  assert.deepEqual(r.hiddenSubjectIds, [])
  assert.deepEqual(r.hiddenBands, [])
  // 일부만 알면 아는 것만 켠다
  const partial = resolveInitialFilters({ initialSubjects: ['사회', '없는교과'] }, ASSET, BASE)
  assert.deepEqual(partial.hiddenSubjectIds.sort(), ['sub_int', 'sub_kor'])
})

test('every icon the map components render is in the layout subset', () => {
  // 컴포넌트에 아이콘을 추가하면 여기와 layout.tsx 둘 다 갱신해야 한다.
  const used = [
    'add', 'add_task', 'arrow_back', 'check', 'close', 'expand_less', 'expand_more',
    'fit_screen', 'hub', 'radio_button_checked', 'radio_button_unchecked', 'remove',
    'right_panel_close', 'right_panel_open', 'search', 'send', 'table_chart',
  ]
  const layout = fs.readFileSync(path.join(process.cwd(), 'src/app/layout.tsx'), 'utf8')
  const subset = layout.slice(layout.indexOf('icon_names'), layout.indexOf('].sort()'))
  const missing = used.filter(name => !subset.includes(`'${name}'`))
  assert.deepEqual(missing, [], `missing from the subset: ${missing.join(', ')}`)
})

// ─── 히트 테스트 · 포맷 ────────────────────────────────────────────────────

test('pickNodeAt: hits inside radius + slack, prefers the closest node', () => {
  const t = { x: 0, y: 0, scale: 1 }
  const nodes = [
    { id: 'near', x: 100, y: 100, r: 6 },
    { id: 'far', x: 104, y: 100, r: 20 },
  ]
  assert.equal(pickNodeAt({ x: 100, y: 100 }, nodes, t), 'near')
  assert.equal(pickNodeAt({ x: 300, y: 300 }, nodes, t), null)
  assert.equal(pickNodeAt({ x: 100, y: 109 }, [nodes[0]], t), 'near')
  assert.equal(pickNodeAt({ x: 100, y: 112 }, [nodes[0]], t), null)
})

test('pickNodeAt: hit radius is in screen pixels and survives a bad transform', () => {
  const nodes = [{ id: 'n', x: 1000, y: 1000, r: 5 }]
  const zoomed = { x: -1500, y: -1200, scale: 2 }
  const screen = worldToScreen({ x: 1000, y: 1000 }, zoomed)
  assert.equal(pickNodeAt(screen, nodes, zoomed), 'n')
  assert.equal(pickNodeAt({ x: screen.x + 30, y: screen.y }, nodes, zoomed), null)
  // NaN 변환이 들어와도 예외 없이 처리
  assert.doesNotThrow(() => pickNodeAt({ x: 0, y: 0 }, nodes, { x: Number.NaN, y: 0, scale: 0 }))
})

test('groupResultsByBand: groups in the given band order, flags empty bands', () => {
  const bands = ['1-2학년군', '3-4학년군', '5-6학년군']
  const results = [
    { id: 'a', band: '5-6학년군' },
    { id: 'b', band: '1-2학년군' },
    { id: 'c', band: '5-6학년군' },
  ]
  const { groups, emptyBands } = groupResultsByBand(results, bands)
  assert.deepEqual(groups.map(g => g.band), ['1-2학년군', '5-6학년군'])
  assert.deepEqual(groups[0].items.map(i => i.id), ['b'])
  assert.deepEqual(groups[1].items.map(i => i.id), ['a', 'c'])
  assert.deepEqual(emptyBands, ['3-4학년군'])
})

test('groupResultsByBand: prefers the backend byBand and emptyBands when present', () => {
  const bands = ['1-2학년군', '3-4학년군']
  const results = [{ id: 'x', band: '1-2학년군' }]
  const byBand = { '1-2학년군': [{ id: 'server', band: '1-2학년군' }] }
  const { groups, emptyBands } = groupResultsByBand(results, bands, byBand, ['3-4학년군'])
  assert.deepEqual(groups[0].items.map(i => i.id), ['server'])
  assert.deepEqual(emptyBands, ['3-4학년군'])
})

test('groupResultsByBand: results outside the checked bands are still shown', () => {
  const { groups, emptyBands } = groupResultsByBand(
    [{ id: 'a', band: '3-4학년군' }],
    ['5-6학년군'],
  )
  assert.deepEqual(groups.map(g => g.band), ['3-4학년군'])
  assert.deepEqual(emptyBands, ['5-6학년군'])
  assert.deepEqual(groupResultsByBand([], []), { groups: [], emptyBands: [] })
})

test('formatElapsed / formatScore / formatCount: Korean-facing display strings', () => {
  assert.equal(formatElapsed(420), '420ms')
  assert.equal(formatElapsed(1540), '1.5초')
  assert.equal(formatElapsed(-1), '-')
  assert.equal(formatElapsed(Number.NaN), '-')
  assert.equal(formatScore(0.873), '87%')
  assert.equal(formatScore(2), '100%')
  assert.equal(formatScore(-1), '0%')
  assert.equal(formatCount(3376), '3,376')
  assert.equal(formatCount(627), '627')
})

// Regression tests for src/components/curriculum-map/mapMath.ts
// Run: node --experimental-strip-types --test scripts/curriculumMapUi.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIMMED_ALPHA,
  EDGE_THRESHOLD_DEFAULT,
  LABEL_ZOOM_THRESHOLD,
  MAX_SCALE,
  MIN_SCALE,
  centerOn,
  clamp,
  clampScale,
  computeBounds,
  easeOutCubic,
  edgeAlpha,
  fitToView,
  formatElapsed,
  formatScore,
  isEdgeVisible,
  isNodeVisible,
  lerpTransform,
  pickNodeAt,
  radiusForDegree,
  radiusForScore,
  screenToWorld,
  settlePosition,
  shouldDrawLabel,
  worldToScreen,
  zoomAtPoint,
} from '../src/components/curriculum-map/mapMath.ts'

const VIEWPORT = { width: 1000, height: 800 }

test('clamp / clampScale: keeps values inside bounds and rejects NaN', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
  assert.equal(clamp(Number.NaN, 0.3, 0.8), 0.3)
  assert.equal(clampScale(0.001), MIN_SCALE)
  assert.equal(clampScale(999), MAX_SCALE)
  assert.equal(clampScale(1.5), 1.5)
})

test('easeOutCubic: monotonic from 0 to 1 and clamped outside range', () => {
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  assert.equal(easeOutCubic(-3), 0)
  assert.equal(easeOutCubic(4), 1)
  assert.ok(easeOutCubic(0.5) > 0.5) // ease-out front-loads progress
})

test('computeBounds: returns null for empty input, tight box otherwise', () => {
  assert.equal(computeBounds([]), null)
  assert.deepEqual(
    computeBounds([{ x: 10, y: 40 }, { x: -5, y: 100 }, { x: 60, y: 0 }]),
    { minX: -5, minY: 0, maxX: 60, maxY: 100 },
  )
})

test('fitToView: centers the bounding box and fills the smaller axis', () => {
  const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 }
  const t = fitToView(bounds, VIEWPORT, 50)
  // 정사각 범위 → 짧은 축(높이 800 - 패딩 100 = 700) 기준
  assert.ok(Math.abs(t.scale - 700 / 2000) < 1e-9)
  const center = worldToScreen({ x: 1000, y: 1000 }, t)
  assert.ok(Math.abs(center.x - 500) < 1e-9)
  assert.ok(Math.abs(center.y - 400) < 1e-9)
})

test('fitToView: degenerate inputs never produce NaN transforms', () => {
  assert.deepEqual(fitToView(null, VIEWPORT), { x: 0, y: 0, scale: 1 })
  assert.deepEqual(fitToView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 }), { x: 0, y: 0, scale: 1 })
  // 노드 1개 (범위 0) → 배율 1, 중앙 정렬
  const single = fitToView({ minX: 500, minY: 500, maxX: 500, maxY: 500 }, VIEWPORT)
  assert.equal(single.scale, 1)
  assert.deepEqual(worldToScreen({ x: 500, y: 500 }, single), { x: 500, y: 400 })
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
  const worldBefore = screenToWorld(anchor, t)
  const zoomed = zoomAtPoint(t, anchor, 1.4)
  const worldAfter = screenToWorld(anchor, zoomed)
  assert.ok(Math.abs(worldAfter.x - worldBefore.x) < 1e-9)
  assert.ok(Math.abs(worldAfter.y - worldBefore.y) < 1e-9)
  assert.ok(zoomed.scale > t.scale)
})

test('zoomAtPoint: respects scale limits without drifting the anchor', () => {
  const t = { x: 0, y: 0, scale: MAX_SCALE }
  const anchor = { x: 100, y: 100 }
  const zoomed = zoomAtPoint(t, anchor, 3)
  assert.equal(zoomed.scale, MAX_SCALE)
  assert.deepEqual(zoomed, t)
})

test('centerOn: puts the target node in the viewport center', () => {
  const t = centerOn({ x: 1500, y: 200 }, VIEWPORT, 2)
  assert.deepEqual(worldToScreen({ x: 1500, y: 200 }, t), { x: 500, y: 400 })
  assert.equal(centerOn({ x: 0, y: 0 }, VIEWPORT, 99).scale, MAX_SCALE)
})

test('lerpTransform: interpolates and clamps progress', () => {
  const a = { x: 0, y: 0, scale: 1 }
  const b = { x: 100, y: 200, scale: 3 }
  assert.deepEqual(lerpTransform(a, b, 0), a)
  assert.deepEqual(lerpTransform(a, b, 1), b)
  assert.deepEqual(lerpTransform(a, b, 0.5), { x: 50, y: 100, scale: 2 })
  assert.deepEqual(lerpTransform(a, b, 5), b)
})

test('settlePosition: ends exactly on the precomputed coordinate', () => {
  const node = { x: 400, y: 900 }
  const center = { x: 1000, y: 1000 }
  assert.deepEqual(settlePosition(node, center, 1), node)
  assert.deepEqual(settlePosition(node, center, 0), center)
  const mid = settlePosition(node, center, 0.5)
  assert.ok(mid.x > node.x && mid.x < center.x)
  assert.ok(mid.y > node.y && mid.y < center.y)
})

test('radiusForDegree: stays within 3-10px and grows with degree', () => {
  assert.equal(radiusForDegree(0, 20), 3)
  assert.equal(radiusForDegree(20, 20), 10)
  assert.ok(radiusForDegree(5, 20) < radiusForDegree(15, 20))
  // maxDegree 0 (엣지 없는 에셋) 에서도 유한값
  assert.ok(Number.isFinite(radiusForDegree(0, 0)))
  assert.equal(radiusForDegree(50, 20), 10) // 이상치도 상한 고정
})

test('radiusForScore: search results are never smaller than a plain node', () => {
  assert.equal(radiusForScore(0), 5)
  assert.equal(radiusForScore(1), 13)
  assert.ok(radiusForScore(0.2) < radiusForScore(0.9))
  assert.equal(radiusForScore(4), 13)
})

test('edgeAlpha: rises with similarity, capped for legibility', () => {
  assert.ok(edgeAlpha(0.3) < edgeAlpha(0.9))
  assert.ok(edgeAlpha(1) <= 0.4)
  assert.ok(edgeAlpha(0) >= 0.06)
  assert.ok(edgeAlpha(1) > DIMMED_ALPHA * 0.5)
})

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
  // 임계값 경계는 포함
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.5 }, 0.5, visible), true)
})

test('isEdgeVisible: selected node keeps its edges regardless of threshold', () => {
  const visible = new Set(['a', 'b'])
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.1 }, 0.8, visible, 'a'), true)
  assert.equal(isEdgeVisible({ source: 'a', target: 'b', sim: 0.1 }, 0.8, visible, 'b'), true)
  // 선택 노드가 필터로 숨겨졌다면 예외를 적용하지 않는다
  assert.equal(isEdgeVisible({ source: 'a', target: 'z', sim: 0.1 }, 0.8, visible, 'a'), false)
})

test('shouldDrawLabel: zoom threshold plus result/selected/hover overrides', () => {
  const base = { scale: 0.6, alwaysLabels: false, isResult: false, isSelected: false, isHovered: false }
  assert.equal(shouldDrawLabel(base), false)
  assert.equal(shouldDrawLabel({ ...base, scale: LABEL_ZOOM_THRESHOLD }), true)
  assert.equal(shouldDrawLabel({ ...base, scale: LABEL_ZOOM_THRESHOLD - 0.01 }), false)
  assert.equal(shouldDrawLabel({ ...base, alwaysLabels: true }), true)
  assert.equal(shouldDrawLabel({ ...base, isResult: true }), true)
  assert.equal(shouldDrawLabel({ ...base, isSelected: true }), true)
  assert.equal(shouldDrawLabel({ ...base, isHovered: true }), true)
  assert.equal(shouldDrawLabel({ ...base, isNeighbor: true }), true)
  assert.equal(shouldDrawLabel({ ...base, isNeighbor: false }), false)
})

test('pickNodeAt: hits inside radius + slack, prefers the closest node', () => {
  const t = { x: 0, y: 0, scale: 1 }
  const nodes = [
    { id: 'near', x: 100, y: 100, r: 6 },
    { id: 'far', x: 104, y: 100, r: 20 },
  ]
  assert.equal(pickNodeAt({ x: 100, y: 100 }, nodes, t), 'near')
  assert.equal(pickNodeAt({ x: 300, y: 300 }, nodes, t), null)
  // 여유 반경(기본 4px) 안쪽은 잡힌다
  assert.equal(pickNodeAt({ x: 100, y: 109 }, [nodes[0]], t), 'near')
  assert.equal(pickNodeAt({ x: 100, y: 112 }, [nodes[0]], t), null)
})

test('pickNodeAt: hit radius is in screen pixels, so zoom does not break picking', () => {
  const nodes = [{ id: 'n', x: 1000, y: 1000, r: 5 }]
  const zoomed = { x: -1500, y: -1200, scale: 2 }
  const screen = worldToScreen({ x: 1000, y: 1000 }, zoomed)
  assert.equal(pickNodeAt(screen, nodes, zoomed), 'n')
  assert.equal(pickNodeAt({ x: screen.x + 30, y: screen.y }, nodes, zoomed), null)
})

test('formatElapsed / formatScore: Korean-facing display strings', () => {
  assert.equal(formatElapsed(420), '420ms')
  assert.equal(formatElapsed(1540), '1.5초')
  assert.equal(formatElapsed(-1), '-')
  assert.equal(formatElapsed(Number.NaN), '-')
  assert.equal(formatScore(0.873), '87%')
  assert.equal(formatScore(2), '100%')
  assert.equal(formatScore(-1), '0%')
})

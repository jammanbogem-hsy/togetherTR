// Regression tests for src/components/curriculum-map/mapMath.ts
// Run: node --experimental-strip-types scripts/curriculumMapUi.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DIMMED_ALPHA,
  EDGE_THRESHOLD_DEFAULT,
  LABEL_DETAIL_ZOOM,
  LABEL_ZOOM_THRESHOLD,
  MAX_SCALE,
  MIN_SCALE,
  MIN_SCREEN_RADIUS,
  NODE_R_BASE,
  NODE_R_RANGE,
  SETTLE_DURATION_MS,
  SETTLE_MAX_PULL,
  boxesIntersect,
  centerOn,
  clamp,
  clampScale,
  computeBounds,
  degreeRankNorm,
  easeOutCubic,
  edgeAlpha,
  fitToView,
  formatCount,
  formatElapsed,
  formatScore,
  isEdgeVisible,
  isForcedLabel,
  isNodeVisible,
  labelText,
  lerpTransform,
  pickNodeAt,
  placeLabels,
  sanitizeTransform,
  screenRadius,
  screenToWorld,
  settlePosition,
  settleProgress,
  shouldDrawLabel,
  worldRadius,
  worldRadiusForScore,
  worldToScreen,
  zoomAtPoint,
} from '../src/components/curriculum-map/mapMath.ts'

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

// ─── 붕괴 회귀 방지 ────────────────────────────────────────────────────────

test('settlePosition: progress 1 returns the asset coordinate exactly', () => {
  for (const node of [{ x: 60, y: 77 }, { x: 1940, y: 1923 }, { x: 747.27, y: 511.59 }]) {
    assert.deepEqual(settlePosition(node, { x: 1000, y: 1000 }, 1), node)
    assert.deepEqual(settlePosition(node, { x: 1000, y: 1000 }, 3), node)
  }
})

test('settlePosition: a frozen animation never collapses the map to one point', () => {
  // 라이브 버그: 진행도가 0 에 얼어붙어 627개 노드가 한 점에 그려졌다.
  // 이제 오프셋은 가산이고 최대 SETTLE_MAX_PULL 만큼만 당긴다.
  const center = { x: 1000, y: 1000 }
  const a = settlePosition({ x: 60, y: 77 }, center, 0)
  const b = settlePosition({ x: 1940, y: 1923 }, center, 0)
  assert.notDeepEqual(a, b)
  const spread = Math.hypot(b.x - a.x, b.y - a.y)
  const original = Math.hypot(1940 - 60, 1923 - 77)
  // 최악의 경우에도 원래 퍼짐의 (1 - pull) 이상은 유지한다
  assert.ok(spread >= original * (1 - SETTLE_MAX_PULL) - 1e-9, `spread ${spread} of ${original}`)
  assert.ok(SETTLE_MAX_PULL < 0.5)
})

test('settlePosition: pull decays monotonically toward the asset position', () => {
  const node = { x: 400, y: 900 }
  const center = { x: 1000, y: 1000 }
  const d = p => Math.hypot(settlePosition(node, center, p).x - node.x, settlePosition(node, center, p).y - node.y)
  assert.ok(d(0) > d(0.5))
  assert.ok(d(0.5) > d(0.9))
  assert.equal(d(1), 0)
})

test('settleProgress: derived from the clock, clamped, and self-terminating', () => {
  assert.equal(settleProgress(null, 1234), 1) // reduced-motion: 연출 없음
  assert.equal(settleProgress(1000, 1000), 0)
  assert.equal(settleProgress(1000, 1000 + SETTLE_DURATION_MS / 2), 0.5)
  assert.equal(settleProgress(1000, 1000 + SETTLE_DURATION_MS), 1)
  assert.equal(settleProgress(1000, 1000 + SETTLE_DURATION_MS * 99), 1)
  assert.equal(settleProgress(1000, 500), 0) // 시계가 뒤로 가도 음수가 안 된다
  assert.equal(settleProgress(Number.NaN, 5000), 1)
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

test('worldRadius: 8..26 in world units, matching the layout formula', () => {
  assert.equal(worldRadius(0), NODE_R_BASE)
  assert.equal(worldRadius(1), NODE_R_BASE + NODE_R_RANGE)
  assert.equal(worldRadius(0.5), NODE_R_BASE + NODE_R_RANGE / 2)
  assert.equal(worldRadius(-1), NODE_R_BASE)
  assert.equal(worldRadius(9), NODE_R_BASE + NODE_R_RANGE)
  assert.ok(worldRadiusForScore(1) > worldRadiusForScore(0))
})

test('screenRadius: scales with zoom but never drops below the click floor', () => {
  assert.equal(screenRadius(8, 1), 8)
  assert.equal(screenRadius(8, 2), 16)
  assert.equal(screenRadius(10, 0.25), 2.5)
  assert.equal(screenRadius(8, 0.001), MIN_SCREEN_RADIUS) // 배율 하한이 걸려도 최소 반지름 보장
  assert.equal(screenRadius(Number.NaN, 1), MIN_SCREEN_RADIUS)
  assert.ok(screenRadius(26, 3) > screenRadius(8, 3)) // 차수 차이가 배율과 무관하게 유지
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

test('labelText: code alone until the detail zoom, then code + text head', () => {
  const text = '일상생활에서 힘과 관련된 현상에 흥미를 갖고 관찰할 수 있다.'
  assert.equal(labelText('[4과01-01]', text, 1), '[4과01-01]')
  assert.equal(labelText('[4과01-01]', text, LABEL_DETAIL_ZOOM - 0.01), '[4과01-01]')
  const detailed = labelText('[4과01-01]', text, LABEL_DETAIL_ZOOM)
  assert.ok(detailed.startsWith('[4과01-01] '))
  assert.ok(detailed.length > '[4과01-01]'.length)
  assert.equal(labelText('[4과01-01]', '', 4), '[4과01-01]')
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

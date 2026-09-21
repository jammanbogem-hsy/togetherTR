// Unit tests for src/lib/curriculum/curriculumMap.ts (pure helpers only).
//
// curriculumMap.ts reuses the subject palette from '@/components/knowledge-graph/constants',
// so raw Node needs the repo's alias hooks to resolve '@/...' imports:
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/curriculumMap.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COLLISION_SAFETY_GAP,
  LAYOUT_SIZE,
  MIN_NODE_GAP,
  NODE_MIN_RADIUS,
  NODE_RADIUS_RANGE,
  SIMILAR_EDGE_MIN_SIM,
  TARGET_NN_RADIUS_FACTOR,
  blendJevAndSim,
  buildUndirectedEdges,
  clamp01,
  cosineSim,
  buildRelationReason,
  buildSearchReason,
  displayKeywords,
  edgeKey,
  fitToSquare,
  formatLinkEvidence,
  inspectOverlaps,
  layoutCurriculumMap,
  levelForScore,
  matchedQueryTerms,
  meanNearestNeighbourDistance,
  normalizeKeywordTerms,
  mulberry32,
  nodeRadii,
  normalizeLayout,
  normalizeRelationType,
  resolveCandidateSource,
  resolveCollisions,
  sharedKeywordTerms,
  runForceLayout,
  springRestLength,
  standardBandLabel,
  subjectDisplayColor,
  subjectDisplayName,
  truncateSentence,
  unionCandidates,
} from '../src/lib/curriculum/curriculumMap.ts'

// ─── cosineSim ──────────────────────────────────────────────────────────────

test('cosineSim: identical vectors are 1, orthogonal are 0, opposite are -1', () => {
  assert.equal(cosineSim([1, 0, 0], [1, 0, 0]), 1)
  assert.equal(cosineSim([1, 0], [0, 1]), 0)
  assert.equal(cosineSim([1, 0], [-1, 0]), -1)
})

test('cosineSim: ignores magnitude (direction only)', () => {
  assert.ok(Math.abs(cosineSim([3, 4], [30, 40]) - 1) < 1e-12)
})

test('cosineSim: zero vector yields 0 instead of NaN', () => {
  assert.equal(cosineSim([0, 0], [1, 1]), 0)
  assert.equal(cosineSim([], []), 0)
})

test('cosineSim: compares only the shared prefix when lengths differ', () => {
  // Defensive: a truncated cached embedding must not produce NaN.
  assert.equal(cosineSim([1, 0, 0], [1, 0]), 1)
})

// ─── score blending and level mapping ───────────────────────────────────────

test('blendJevAndSim: weights Jev 0.7 and cosine 0.3', () => {
  assert.equal(blendJevAndSim(1, 1), 1)
  assert.equal(blendJevAndSim(0, 0), 0)
  assert.ok(Math.abs(blendJevAndSim(1, 0) - 0.7) < 1e-12)
  assert.ok(Math.abs(blendJevAndSim(0, 1) - 0.3) < 1e-12)
  assert.ok(Math.abs(blendJevAndSim(2 / 3, 0.5) - (0.7 * (2 / 3) + 0.15)) < 1e-12)
})

test('blendJevAndSim: clamps out-of-range inputs into 0..1', () => {
  assert.equal(blendJevAndSim(3, 5), 1)
  assert.equal(blendJevAndSim(-1, -1), 0)
  assert.equal(blendJevAndSim(Number.NaN, Number.NaN), 0)
})

test('levelForScore: Jev Score/3 boundaries land on the intended labels', () => {
  assert.equal(levelForScore(0), '무관')
  assert.equal(levelForScore(1 / 3), '약함')
  assert.equal(levelForScore(2 / 3), '관련')
  assert.equal(levelForScore(1), '핵심')
})

test('levelForScore: quarter-width thresholds are inclusive at the lower bound', () => {
  assert.equal(levelForScore(0.249), '무관')
  assert.equal(levelForScore(0.25), '약함')
  assert.equal(levelForScore(0.5), '관련')
  assert.equal(levelForScore(0.75), '핵심')
})

test('clamp01: finite clamp, NaN becomes 0', () => {
  assert.equal(clamp01(0.5), 0.5)
  assert.equal(clamp01(-2), 0)
  assert.equal(clamp01(2), 1)
  assert.equal(clamp01(Number.NaN), 0)
  assert.equal(clamp01(Infinity), 0)
})

// ─── text / subject helpers ─────────────────────────────────────────────────

test('truncateSentence: keeps short text and collapses whitespace', () => {
  assert.equal(truncateSentence('  힘과  운동 ', 120), '힘과 운동')
  assert.equal(truncateSentence(null, 10), '')
  assert.equal(truncateSentence(undefined, 10), '')
})

test('truncateSentence: cuts on a word boundary and appends an ellipsis', () => {
  const out = truncateSentence('가나다 라마바 사아자 차카타 파하', 12)
  assert.ok(out.length <= 12, out)
  assert.ok(out.endsWith('…'))
  assert.ok(!out.includes('  '))
})

test('subjectDisplayName: short names win over the graph long names', () => {
  // The graph calls these '사회과' and '바른 생활·슬기로운 생활·즐거운 생활'.
  assert.equal(subjectDisplayName('sub_soc', '사회과'), '사회')
  assert.equal(subjectDisplayName('sub_int', '바른 생활·슬기로운 생활·즐거운 생활'), '통합교과')
  assert.equal(subjectDisplayName('sub_unknown', '알수없음'), '알수없음')
  assert.equal(subjectDisplayName('sub_unknown'), 'sub_unknown')
})

test('subjectDisplayColor: known ids get their palette color, unknown get the default', () => {
  assert.equal(subjectDisplayColor('sub_sci'), '#059669')
  assert.equal(subjectDisplayColor('sub_nope'), '#6B7280')
})

test('standardBandLabel: graph bands become canonical labels', () => {
  assert.equal(standardBandLabel({ grade_band: '초3-4' }), '3-4학년군')
  assert.equal(standardBandLabel({ grade_band: '초1-2' }), '1-2학년군')
  assert.equal(standardBandLabel({ grade_band: '초5-6' }), '5-6학년군')
  // Non-elementary / unparseable falls back to the raw value rather than ''.
  assert.equal(standardBandLabel({ grade_band: '중1-3' }), '중1-3')
})

test('normalizeRelationType: legacy 의미-연결 maps onto the criteria key', () => {
  assert.equal(normalizeRelationType('의미-연결'), '의미연결')
  assert.equal(normalizeRelationType('내용-표현'), '내용-표현')
  assert.equal(normalizeRelationType('도구-활용'), '도구-활용')
  assert.equal(normalizeRelationType(null), '의미연결')
  assert.equal(normalizeRelationType('없는유형'), '의미연결')
})

// ─── undirected edge merge ──────────────────────────────────────────────────

test('edgeKey: both directions collapse to one key', () => {
  assert.equal(edgeKey('a', 'b'), edgeKey('b', 'a'))
  assert.notEqual(edgeKey('a', 'b'), edgeKey('a', 'c'))
})

test('buildUndirectedEdges: reciprocal similar pairs collapse and keep the max sim', () => {
  const edges = buildUndirectedEdges([
    { source: 'a', target: 'b', sim: 0.5, kind: 'similar' },
    { source: 'b', target: 'a', sim: 0.61, kind: 'similar' },
  ])
  assert.equal(edges.length, 1)
  assert.equal(edges[0].source, 'a')
  assert.equal(edges[0].target, 'b')
  assert.equal(edges[0].sim, 0.61)
  assert.equal(edges[0].kind, 'similar')
  assert.equal(edges[0].relation, undefined)
})

test('buildUndirectedEdges: similar + cross on the same pair becomes both and keeps the relation', () => {
  const edges = buildUndirectedEdges([
    { source: 'a', target: 'b', sim: 0.52, kind: 'similar' },
    { source: 'b', target: 'a', sim: 0.41, kind: 'cross', relation: '내용-표현' },
  ])
  assert.equal(edges.length, 1)
  assert.equal(edges[0].kind, 'both')
  assert.equal(edges[0].sim, 0.52)
  assert.equal(edges[0].relation, '내용-표현')
})

test('buildUndirectedEdges: drops self-loops and clamps sim', () => {
  const edges = buildUndirectedEdges([
    { source: 'a', target: 'a', sim: 1, kind: 'similar' },
    { source: 'a', target: 'b', sim: 1.4, kind: 'cross', relation: '도구-활용' },
    { source: '', target: 'b', sim: 0.9, kind: 'similar' },
  ])
  assert.equal(edges.length, 1)
  assert.equal(edges[0].sim, 1)
})

test('SIMILAR_EDGE_MIN_SIM: the documented 0.45 cutoff', () => {
  assert.equal(SIMILAR_EDGE_MIN_SIM, 0.45)
})

// ─── candidate union / dedupe ───────────────────────────────────────────────

test('resolveCandidateSource: cross alone vs cross plus similarity', () => {
  assert.equal(resolveCandidateSource(['cross']), 'cross')
  assert.equal(resolveCandidateSource(['similar', 'cross']), 'mixed')
  assert.equal(resolveCandidateSource(['cross', 'embedding']), 'mixed')
  assert.equal(resolveCandidateSource(['similar']), 'similar')
  assert.equal(resolveCandidateSource(['similar', 'embedding']), 'similar')
  assert.equal(resolveCandidateSource(['embedding']), 'embedding')
})

test('unionCandidates: dedupes by id, keeps max sim, merges origins', () => {
  const out = unionCandidates([
    { id: 'x', origin: 'similar', sim: 0.5 },
    { id: 'x', origin: 'embedding', sim: 0.62 },
    { id: 'y', origin: 'embedding', sim: 0.58 },
  ], 10)
  assert.equal(out.length, 2)
  const x = out.find(c => c.id === 'x')
  assert.equal(x.sim, 0.62)
  assert.deepEqual(x.origins, ['similar', 'embedding'])
  assert.equal(x.source, 'similar')
})

test('unionCandidates: cross-linked candidates survive the cap ahead of higher-sim ones', () => {
  const out = unionCandidates([
    { id: 'hi1', origin: 'embedding', sim: 0.9 },
    { id: 'hi2', origin: 'embedding', sim: 0.88 },
    { id: 'linked', origin: 'cross', sim: 0.31, relation: '현상-가치' },
  ], 2)
  assert.deepEqual(out.map(c => c.id), ['linked', 'hi1'])
  assert.equal(out[0].relation, '현상-가치')
  assert.equal(out[0].source, 'cross')
})

test('unionCandidates: deterministic tie-break by id and empty/zero cap handling', () => {
  const tied = [
    { id: 'b', origin: 'similar', sim: 0.5 },
    { id: 'a', origin: 'similar', sim: 0.5 },
  ]
  assert.deepEqual(unionCandidates(tied, 5).map(c => c.id), ['a', 'b'])
  assert.deepEqual(unionCandidates(tied, 0), [])
  assert.deepEqual(unionCandidates([], 5), [])
  assert.deepEqual(unionCandidates([{ id: '', origin: 'similar', sim: 1 }], 5), [])
})

// ─── layout primitives ─────────────────────────────────────────────────────

test('springRestLength: identical standards sit at 40, the 0.45 cutoff near 183', () => {
  assert.equal(springRestLength(1), 40)
  assert.equal(springRestLength(0), 300)
  assert.ok(Math.abs(springRestLength(0.45) - 183) < 0.5)
  // Out-of-range input is clamped, never negative.
  assert.equal(springRestLength(2), 40)
  assert.equal(springRestLength(-1), 300)
})

test('mulberry32: same seed replays the same sequence, different seeds diverge', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  const c = mulberry32(43)
  const seqA = [a(), a(), a()]
  assert.deepEqual(seqA, [b(), b(), b()])
  assert.notDeepEqual(seqA, [c(), c(), c()])
  assert.ok(seqA.every(v => v >= 0 && v < 1))
})

test('normalizeLayout: fits inside the square with the margin respected', () => {
  const out = normalizeLayout([
    { x: -500, y: -500 },
    { x: 1500, y: 300 },
    { x: 0, y: 0 },
  ], { size: 2000, margin: 60 })
  for (const p of out) {
    assert.ok(p.x >= 60 - 1e-6 && p.x <= 1940 + 1e-6, `x out of range: ${p.x}`)
    assert.ok(p.y >= 60 - 1e-6 && p.y <= 1940 + 1e-6, `y out of range: ${p.y}`)
  }
  // Widest axis is scaled to exactly fill the inner box.
  const xs = out.map(p => p.x)
  assert.ok(Math.abs(Math.min(...xs) - 60) < 0.05)
  assert.ok(Math.abs(Math.max(...xs) - 1940) < 0.05)
})

test('normalizeLayout: uniform scale preserves aspect ratio and centers the short axis', () => {
  const out = normalizeLayout([
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ], { size: 1000, margin: 0 })
  const dx = out[1].x - out[0].x
  const dy = out[1].y - out[0].y
  assert.ok(Math.abs(dx / dy - 2) < 1e-6, `aspect changed: ${dx}/${dy}`)
  // The y span (half the x span) is centered, so it does not start at 0.
  assert.ok(out[0].y > 0)
})

test('normalizeLayout: degenerate input goes to the centre instead of NaN', () => {
  assert.deepEqual(normalizeLayout([{ x: 7, y: 7 }], { size: 1000, margin: 50 }), [{ x: 500, y: 500 }])
  assert.deepEqual(
    normalizeLayout([{ x: 1, y: 1 }, { x: 1, y: 1 }], { size: 800, margin: 10 }),
    [{ x: 400, y: 400 }, { x: 400, y: 400 }],
  )
  assert.deepEqual(normalizeLayout([]), [])
})

// ─── force layout ──────────────────────────────────────────────────────────

const LAYOUT_NODES = [
  { id: 'k1', subjectId: 'sub_kor' },
  { id: 'k2', subjectId: 'sub_kor' },
  { id: 'k3', subjectId: 'sub_kor' },
  { id: 'm1', subjectId: 'sub_math' },
  { id: 'm2', subjectId: 'sub_math' },
  { id: 'm3', subjectId: 'sub_math' },
  { id: 'lonely', subjectId: 'sub_mus' },
]
const LAYOUT_EDGES = [
  { source: 'k1', target: 'k2', sim: 0.95 },
  { source: 'k2', target: 'k3', sim: 0.95 },
  { source: 'm1', target: 'm2', sim: 0.95 },
  { source: 'm2', target: 'm3', sim: 0.95 },
  { source: 'k1', target: 'm1', sim: 0.46 },
]

test('runForceLayout: every node gets a finite position inside the square', () => {
  const out = runForceLayout(LAYOUT_NODES, LAYOUT_EDGES, { iterations: 120 })
  assert.equal(out.size, LAYOUT_NODES.length)
  for (const node of LAYOUT_NODES) {
    const p = out.get(node.id)
    assert.ok(p, `missing position for ${node.id}`)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `non-finite position for ${node.id}`)
    assert.ok(p.x >= 0 && p.x <= LAYOUT_SIZE && p.y >= 0 && p.y <= LAYOUT_SIZE)
  }
})

test('runForceLayout: an edgeless node is still positioned (no NaN, no drop)', () => {
  const out = runForceLayout(LAYOUT_NODES, LAYOUT_EDGES, { iterations: 120 })
  const lonely = out.get('lonely')
  assert.ok(lonely)
  assert.ok(Number.isFinite(lonely.x) && Number.isFinite(lonely.y))
})

test('runForceLayout: deterministic for the same seed, different for another seed', () => {
  const a = runForceLayout(LAYOUT_NODES, LAYOUT_EDGES, { iterations: 120, seed: 7 })
  const b = runForceLayout(LAYOUT_NODES, LAYOUT_EDGES, { iterations: 120, seed: 7 })
  const c = runForceLayout(LAYOUT_NODES, LAYOUT_EDGES, { iterations: 120, seed: 8 })
  for (const node of LAYOUT_NODES) {
    assert.deepEqual(a.get(node.id), b.get(node.id), `seed 7 not reproducible for ${node.id}`)
  }
  assert.notDeepEqual(
    LAYOUT_NODES.map(n => a.get(n.id)),
    LAYOUT_NODES.map(n => c.get(n.id)),
  )
})

test('runForceLayout: same-subject nodes end up closer than cross-subject nodes', () => {
  const out = runForceLayout(LAYOUT_NODES, LAYOUT_EDGES, { iterations: 300 })
  const dist = (a, b) => Math.hypot(out.get(a).x - out.get(b).x, out.get(a).y - out.get(b).y)
  const intra = (dist('k1', 'k2') + dist('k2', 'k3') + dist('m1', 'm2') + dist('m2', 'm3')) / 4
  const inter = (dist('k1', 'm3') + dist('k3', 'm1') + dist('k2', 'm2')) / 3
  assert.ok(intra < inter, `subjects did not cluster: intra ${intra.toFixed(1)} vs inter ${inter.toFixed(1)}`)
})

test('runForceLayout: a highly similar edge ends shorter than a weakly similar one', () => {
  const nodes = [
    { id: 'a', subjectId: 's1' },
    { id: 'b', subjectId: 's1' },
    { id: 'c', subjectId: 's1' },
  ]
  const out = runForceLayout(nodes, [
    { source: 'a', target: 'b', sim: 0.98 },
    { source: 'a', target: 'c', sim: 0.45 },
  ], { iterations: 400 })
  const dist = (x, y) => Math.hypot(out.get(x).x - out.get(y).x, out.get(x).y - out.get(y).y)
  assert.ok(dist('a', 'b') < dist('a', 'c'), `rest length ignored: ab ${dist('a', 'b')} ac ${dist('a', 'c')}`)
})

test('runForceLayout: empty input returns an empty map', () => {
  assert.equal(runForceLayout([], []).size, 0)
})

test('runForceLayout: ignores edges whose endpoints are not nodes', () => {
  const out = runForceLayout(
    [{ id: 'a', subjectId: 's' }, { id: 'b', subjectId: 's' }],
    [{ source: 'a', target: 'ghost', sim: 0.9 }, { source: 'a', target: 'b', sim: 0.9 }],
    { iterations: 50 },
  )
  assert.equal(out.size, 2)
  for (const id of ['a', 'b']) {
    const p = out.get(id)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
  }
})

// ─── node radii ────────────────────────────────────────────────────────────

test('nodeRadii: r = 8 + 18 x degree rank, spanning the full range', () => {
  const radii = nodeRadii([
    { id: 'lo', degree: 0 },
    { id: 'mid', degree: 5 },
    { id: 'hi', degree: 40 },
  ])
  assert.equal(radii.get('lo'), NODE_MIN_RADIUS)
  assert.equal(radii.get('hi'), NODE_MIN_RADIUS + NODE_RADIUS_RANGE)
  assert.equal(radii.get('mid'), 17)
})

test('nodeRadii: uses rank not raw degree, so one hub does not flatten the rest', () => {
  // Raw-degree normalization would give the three low nodes r ~= 8.0-8.4.
  const radii = nodeRadii([
    { id: 'a', degree: 1 },
    { id: 'b', degree: 2 },
    { id: 'c', degree: 3 },
    { id: 'hub', degree: 900 },
  ])
  assert.equal(radii.get('a'), 8)
  assert.equal(radii.get('b'), 14)
  assert.equal(radii.get('c'), 20)
  assert.equal(radii.get('hub'), 26)
})

test('nodeRadii: equal degrees get equal radii (tie midpoint)', () => {
  const radii = nodeRadii([
    { id: 'a', degree: 4 },
    { id: 'b', degree: 4 },
    { id: 'c', degree: 9 },
  ])
  assert.equal(radii.get('a'), radii.get('b'))
  assert.ok(radii.get('c') > radii.get('a'))
})

test('nodeRadii: rounded to one decimal, empty and single input handled', () => {
  const many = nodeRadii(Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, degree: i })))
  for (const r of many.values()) assert.equal(r, Math.round(r * 10) / 10)
  assert.equal(nodeRadii([]).size, 0)
  assert.equal(nodeRadii([{ id: 'only', degree: 3 }]).get('only'), 17)
})

// ─── overlap inspection ────────────────────────────────────────────────────

test('inspectOverlaps: counts pairs closer than r_i + r_j + minGap', () => {
  const points = [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 200, y: 0 }]
  const radii = [10, 10, 10]
  // 0-1 are 25 apart but need 10+10+8 = 28 -> one violation.
  const report = inspectOverlaps(points, radii, 8)
  assert.equal(report.violations, 1)
  assert.equal(report.minGap, 5)
})

test('inspectOverlaps: exact boundary separation is not a violation', () => {
  const report = inspectOverlaps([{ x: 0, y: 0 }, { x: 28, y: 0 }], [10, 10], 8)
  assert.equal(report.violations, 0)
  assert.equal(report.minGap, 8)
})

// ─── collision resolution ─────────────────────────────────────────────────

/** Deterministic clustered fixture: three tight clumps with mixed radii. */
function collisionFixture() {
  const rand = mulberry32(99)
  const points = []
  const radii = []
  for (const centre of [{ x: 100, y: 100 }, { x: 140, y: 120 }, { x: 600, y: 600 }]) {
    for (let i = 0; i < 12; i++) {
      points.push({ x: centre.x + (rand() - 0.5) * 30, y: centre.y + (rand() - 0.5) * 30 })
      radii.push(8 + Math.round(rand() * 18))
    }
  }
  return { points, radii }
}

test('resolveCollisions: a heavily overlapping fixture ends with zero violations', () => {
  const { points, radii } = collisionFixture()
  const before = inspectOverlaps(points, radii, MIN_NODE_GAP)
  assert.ok(before.violations > 50, `fixture should start overlapping, got ${before.violations}`)
  assert.ok(before.minGap < 0, 'fixture circles should start intersecting')

  const result = resolveCollisions(points, radii, { minGap: MIN_NODE_GAP })
  const after = inspectOverlaps(result.points, radii, MIN_NODE_GAP)
  assert.equal(after.violations, 0, `still overlapping after ${result.passes} passes`)
  assert.ok(after.minGap >= MIN_NODE_GAP - 1e-6, `min gap ${after.minGap} below contract`)
  assert.equal(result.violations, 0)
  assert.ok(result.passes > 1 && result.passes <= 120)
})

test('resolveCollisions: deterministic for identical input', () => {
  const a = resolveCollisions(collisionFixture().points, collisionFixture().radii, { minGap: MIN_NODE_GAP })
  const b = resolveCollisions(collisionFixture().points, collisionFixture().radii, { minGap: MIN_NODE_GAP })
  assert.deepEqual(a.points, b.points)
  assert.equal(a.passes, b.passes)
})

test('resolveCollisions: already-separated input is left untouched in one pass', () => {
  const points = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 0, y: 500 }]
  const radii = [10, 10, 10]
  const result = resolveCollisions(points, radii, { minGap: MIN_NODE_GAP })
  assert.equal(result.passes, 1)
  assert.equal(result.violations, 0)
  assert.deepEqual(result.points, points)
})

test('resolveCollisions: coincident nodes are pushed apart deterministically', () => {
  const points = [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }]
  const radii = [10, 10, 10]
  const first = resolveCollisions(points, radii, { minGap: MIN_NODE_GAP })
  const second = resolveCollisions(points, radii, { minGap: MIN_NODE_GAP })
  assert.equal(inspectOverlaps(first.points, radii, MIN_NODE_GAP).violations, 0)
  assert.deepEqual(first.points, second.points)
})

test('resolveCollisions: fewer than two nodes is a no-op', () => {
  assert.deepEqual(resolveCollisions([], []).points, [])
  const one = resolveCollisions([{ x: 3, y: 4 }], [10])
  assert.deepEqual(one.points, [{ x: 3, y: 4 }])
  assert.equal(one.violations, 0)
})

// ─── fitToSquare ───────────────────────────────────────────────────────────

test('fitToSquare: grows a small layout to fill the square', () => {
  const fit = fitToSquare([{ x: 0, y: 0 }, { x: 100, y: 100 }], { size: 2000, margin: 60 })
  assert.ok(fit.scale > 1)
  assert.equal(fit.extent, 2000)
  assert.ok(Math.abs(fit.points[0].x - 60) < 0.2)
  assert.ok(Math.abs(fit.points[1].x - 1940) < 0.2)
})

test('fitToSquare: never shrinks — it enlarges the square instead', () => {
  // A 5000-unit span would need scale 0.376 to fit 2000; that would undo the
  // gaps the collision pass just created, so the square grows instead.
  const fit = fitToSquare([{ x: 0, y: 0 }, { x: 5000, y: 5000 }], { size: 2000, margin: 60 })
  assert.equal(fit.scale, 1)
  assert.equal(fit.extent, 5120)
  const span = fit.points[1].x - fit.points[0].x
  assert.ok(Math.abs(span - 5000) < 0.2, `span changed: ${span}`)
})

test('fitToSquare: enlarging preserves every pairwise gap', () => {
  const { points, radii } = collisionFixture()
  const resolved = resolveCollisions(points, radii, { minGap: MIN_NODE_GAP })
  const fit = fitToSquare(resolved.points, { size: 2000, margin: 60 })
  assert.equal(inspectOverlaps(fit.points, radii, MIN_NODE_GAP).violations, 0)
})

test('fitToSquare: degenerate and empty input', () => {
  assert.deepEqual(fitToSquare([], { size: 900 }), { points: [], extent: 900, scale: 1 })
  const same = fitToSquare([{ x: 5, y: 5 }, { x: 5, y: 5 }], { size: 800, margin: 10 })
  assert.deepEqual(same.points, [{ x: 400, y: 400 }, { x: 400, y: 400 }])
})

// ─── full layout pipeline ──────────────────────────────────────────────────

test('layoutCurriculumMap: output is overlap-free and every node has a radius', () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    id: `n${i}`,
    subjectId: `s${i % 4}`,
    degree: i % 11,
  }))
  const edges = nodes.slice(1).map((node, i) => ({ source: nodes[i].id, target: node.id, sim: 0.5 + (i % 5) * 0.1 }))
  const result = layoutCurriculumMap(nodes, edges, { iterations: 150, seed: 5 })

  assert.equal(result.positions.size, nodes.length)
  assert.equal(result.radii.size, nodes.length)
  assert.equal(result.stats.violations, 0)
  assert.ok(result.stats.minGap >= MIN_NODE_GAP - 1e-6, `min gap ${result.stats.minGap}`)

  const points = nodes.map(node => result.positions.get(node.id))
  const radii = nodes.map(node => result.radii.get(node.id))
  assert.equal(inspectOverlaps(points, radii, MIN_NODE_GAP).violations, 0)
  for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
})

test('layoutCurriculumMap: spreads toward the target nearest-neighbour distance', () => {
  const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, subjectId: 's', degree: i % 7 }))
  const result = layoutCurriculumMap(nodes, [], { iterations: 120, seed: 11 })
  const points = nodes.map(node => result.positions.get(node.id))
  const target = result.stats.meanRadius * TARGET_NN_RADIUS_FACTOR
  // Collision resolution only pushes further apart, so the floor is the target.
  assert.ok(
    meanNearestNeighbourDistance(points) >= target * 0.9,
    `mean NN ${result.stats.meanNearestNeighbour} far below target ${target}`,
  )
})

test('layoutCurriculumMap: deterministic for the same seed', () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, subjectId: `s${i % 3}`, degree: i % 5 }))
  const edges = [{ source: 'n0', target: 'n1', sim: 0.9 }, { source: 'n2', target: 'n3', sim: 0.5 }]
  const a = layoutCurriculumMap(nodes, edges, { iterations: 80, seed: 3 })
  const b = layoutCurriculumMap(nodes, edges, { iterations: 80, seed: 3 })
  for (const node of nodes) assert.deepEqual(a.positions.get(node.id), b.positions.get(node.id))
  assert.deepEqual(a.stats, b.stats)
})

test('layoutCurriculumMap: keeps subjects as soft clusters after collision resolution', () => {
  const nodes = []
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 15; i++) nodes.push({ id: `s${s}n${i}`, subjectId: `s${s}`, degree: i % 6 })
  }
  const edges = []
  for (let s = 0; s < 3; s++) {
    for (let i = 1; i < 15; i++) edges.push({ source: `s${s}n${i - 1}`, target: `s${s}n${i}`, sim: 0.9 })
  }
  const { positions } = layoutCurriculumMap(nodes, edges, { iterations: 300, seed: 21 })
  let intra = 0, intraN = 0, inter = 0, interN = 0
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i].id)
      const b = positions.get(nodes[j].id)
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (nodes[i].subjectId === nodes[j].subjectId) { intra += d; intraN++ } else { inter += d; interN++ }
    }
  }
  assert.ok(inter / interN > intra / intraN, 'subjects stopped clustering after collision resolution')
})

test('COLLISION_SAFETY_GAP: leaves headroom above the contract for coordinate rounding', () => {
  assert.ok(COLLISION_SAFETY_GAP > 0.15, 'must exceed the worst 1-decimal rounding error')
  assert.equal(MIN_NODE_GAP, 8)
})

// ─── keyword normalization ─────────────────────────────────────────────────

test('normalizeKeywordTerms: keeps the phrase and its word parts', () => {
  const terms = normalizeKeywordTerms(['상태 변화'])
  assert.ok(terms.includes('상태 변화'))
  assert.ok(terms.includes('상태'))
  assert.ok(terms.includes('변화'))
})

test('normalizeKeywordTerms: drops machine-extraction noise fragments', () => {
  // These are real entries from the graph's keywords arrays.
  const terms = normalizeKeywordTerms(['수 있', '있음', '밀거나 당길 때 나타', '갖고 물체'])
  assert.ok(!terms.includes('수 있'), JSON.stringify(terms))
  assert.ok(!terms.includes('있음'))
  assert.ok(!terms.some(t => t.includes('나타')))
  assert.ok(!terms.includes('갖고'))
  // The content word inside the fragment survives.
  assert.ok(terms.includes('물체'))
})

test('normalizeKeywordTerms: strips a leading conjugated verb from a phrase', () => {
  const terms = normalizeKeywordTerms(['알고 기후변화', '가지고 기후변화'])
  assert.ok(terms.includes('기후변화'))
  assert.ok(!terms.some(t => t.startsWith('알고') || t.startsWith('가지고')))
})

test('normalizeKeywordTerms: keeps nouns that merely look like verb forms', () => {
  // '사고' and '기후' must not be mistaken for conjugated verbs.
  const terms = normalizeKeywordTerms(['사고', '기후', '지구'])
  assert.deepEqual(terms.sort(), ['기후', '사고', '지구'])
})

test('normalizeKeywordTerms: drops generic stopwords and single characters', () => {
  const terms = normalizeKeywordTerms(['이용', '활동', '관련', '물', '무게'])
  assert.deepEqual(terms, ['무게'])
})

test('normalizeKeywordTerms: strips trailing particles when 2+ chars remain', () => {
  assert.ok(normalizeKeywordTerms(['무게를']).includes('무게'))
  // '물의' would become the single char '물', so the original is kept.
  assert.ok(normalizeKeywordTerms(['물의']).includes('물의'))
})

test('normalizeKeywordTerms: empty and nullish input', () => {
  assert.deepEqual(normalizeKeywordTerms([]), [])
  assert.deepEqual(normalizeKeywordTerms([null, undefined, '', '   ']), [])
})

test('displayKeywords: caps the list and folds nested stems', () => {
  const out = displayKeywords(['상태 변화', '상태', '물의', '장치'], 8)
  // '상태' is contained in '상태 변화', so it is folded away.
  assert.ok(out.includes('상태 변화'))
  assert.ok(!out.includes('상태'))
  assert.ok(out.length <= 8)
  assert.equal(displayKeywords(['가', '나', '다'], 8).length, 0)
  assert.equal(displayKeywords(Array.from({ length: 30 }, (_, i) => `키워드${i}`), 8).length, 8)
})

// ─── shared keywords ──────────────────────────────────────────────────────

test('sharedKeywordTerms: two standards meet on a shared stem', () => {
  // The brief's example: '물의 상태' and '상태 변화' must share '상태'.
  const shared = sharedKeywordTerms(['물의 상태'], ['상태 변화'])
  assert.ok(shared.includes('상태'), JSON.stringify(shared))
})

test('sharedKeywordTerms: matches a 2+ char stem inside a longer word', () => {
  const shared = sharedKeywordTerms(['상태변화'], ['상태'])
  assert.deepEqual(shared, ['상태'])
})

test('sharedKeywordTerms: no overlap yields an empty list', () => {
  assert.deepEqual(sharedKeywordTerms(['무게', '저울'], ['분수', '소수']), [])
  assert.deepEqual(sharedKeywordTerms([], ['무게']), [])
  assert.deepEqual(sharedKeywordTerms(['무게'], []), [])
})

test('sharedKeywordTerms: noise fragments never become shared evidence', () => {
  // Both standards contain '수 있' but that is not a reason they are related.
  assert.deepEqual(sharedKeywordTerms(['수 있', '무게'], ['수 있', '분수']), [])
})

test('sharedKeywordTerms: caps the result and is deterministic', () => {
  const a = ['가가', '나나', '다다', '라라', '마마', '바바', '사사', '아아']
  const shared = sharedKeywordTerms(a, a, 6)
  assert.equal(shared.length, 6)
  assert.deepEqual(shared, sharedKeywordTerms(a, a, 6))
})

// ─── matched query terms ──────────────────────────────────────────────────

test('matchedQueryTerms: matches against keywords and against the text', () => {
  const matched = matchedQueryTerms('물의 상태 변화', ['상태 변화'], '물이 얼 때의 현상을 관찰한다')
  assert.ok(matched.includes('상태 변화') || matched.includes('상태'))
  assert.ok(matched.includes('변화') || matched.includes('상태 변화'))
})

test('matchedQueryTerms: unrelated query returns nothing', () => {
  assert.deepEqual(matchedQueryTerms('분수의 덧셈', ['무게', '저울'], '물체의 무게를 비교한다'), [])
})

test('matchedQueryTerms: drops stopwords and single characters from the query', () => {
  const matched = matchedQueryTerms('이용 활동 물', ['이용', '활동'], '물을 이용한 활동')
  assert.deepEqual(matched, [])
})

test('matchedQueryTerms: caps and handles an empty query', () => {
  assert.deepEqual(matchedQueryTerms('', ['무게'], '무게'), [])
  assert.ok(matchedQueryTerms('가가 나나 다다 라라 마마 바바 사사', [], '가가 나나 다다 라라 마마 바바 사사').length <= 6)
})

// ─── link evidence ────────────────────────────────────────────────────────

test('formatLinkEvidence: renders relation, shared keywords and weight', () => {
  const out = formatLinkEvidence({
    relation_edu: '내용-표현',
    method: 'hybrid_embedding70_tfidf30',
    weight: 0.4888,
    evidence: { shared_keywords: ['생활', '건강'], shared_functions: [], shared_knowledge: [], similarity_score: 0.4888 },
  })
  assert.ok(out.startsWith('내용-표현'), out)
  assert.ok(out.includes('공통 키워드 생활·건강'), out)
  assert.ok(out.includes('가중치 0.49'), out)
})

test('formatLinkEvidence: legacy 의미-연결 is normalized and empty evidence is tolerated', () => {
  assert.ok(formatLinkEvidence({ relation_edu: '의미-연결', weight: 0.3 }).startsWith('의미연결'))
  const bare = formatLinkEvidence({})
  assert.equal(bare, '의미연결')
})

// ─── reason assembly ──────────────────────────────────────────────────────

const BASE_REASON = {
  linkEvidence: '',
  sameCoreIdea: false,
  sameArea: false,
  coreIdeaArea: '지구와 우주',
  sharedKeywords: [],
  sim: 0.61,
}

test('buildRelationReason: cross link evidence leads', () => {
  const reason = buildRelationReason({
    ...BASE_REASON,
    linkEvidence: '내용-표현 · 공통 키워드 생활·건강',
    sharedKeywords: ['생활'],
  })
  assert.ok(reason.startsWith('교육과정 연계 링크: 내용-표현'), reason)
  assert.ok(reason.includes('공통 키워드: 생활'), reason)
})

test('buildRelationReason: same core idea outranks shared keywords', () => {
  const reason = buildRelationReason({ ...BASE_REASON, sameCoreIdea: true, sharedKeywords: ['물', '상태'] })
  assert.ok(reason.startsWith('같은 핵심아이디어(지구와 우주)'), reason)
  assert.ok(reason.includes('공통 키워드: 물, 상태'))
})

test('buildRelationReason: same area only when the core idea differs', () => {
  const reason = buildRelationReason({ ...BASE_REASON, sameArea: true })
  assert.ok(reason.startsWith('같은 영역(지구와 우주)'), reason)
  assert.ok(!reason.includes('핵심아이디어'))
})

test('buildRelationReason: shared keywords alone', () => {
  const reason = buildRelationReason({ ...BASE_REASON, sharedKeywords: ['물', '상태', '변화'] })
  assert.equal(reason, '공통 키워드: 물, 상태, 변화')
})

test('buildRelationReason: similarity-only fallback reports the Jev verdict', () => {
  const reason = buildRelationReason({ ...BASE_REASON, jevScore: 0.75 })
  assert.equal(reason, '의미 유사도 0.61 (Jev 판정 핵심 0.75)')
})

test('buildRelationReason: never empty, even with no evidence and no Jev score', () => {
  const reason = buildRelationReason({ ...BASE_REASON, sim: 0 })
  assert.ok(reason.length > 0)
  assert.equal(reason, '의미 유사도 0.00')
})

test('buildSearchReason: matched query terms lead, scores follow', () => {
  const reason = buildSearchReason({ matchedTerms: ['물', '환경'], sim: 0.39, jevScore: 1 })
  assert.ok(reason.startsWith('질의어 일치: 물, 환경'), reason)
  assert.ok(reason.includes('Jev 판정 핵심 1.00'), reason)
  assert.ok(reason.includes('의미 유사도 0.39'), reason)
})

test('buildSearchReason: never empty without matches or a Jev score', () => {
  assert.equal(buildSearchReason({ matchedTerms: [], sim: 0.42 }), '의미 유사도 0.42')
})

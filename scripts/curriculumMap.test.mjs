// Unit tests for src/lib/curriculum/curriculumMap.ts (pure helpers only).
//
// curriculumMap.ts reuses the subject palette from '@/components/knowledge-graph/constants',
// so raw Node needs the repo's alias hooks to resolve '@/...' imports:
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/curriculumMap.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAYOUT_SIZE,
  SIMILAR_EDGE_MIN_SIM,
  blendJevAndSim,
  buildUndirectedEdges,
  clamp01,
  cosineSim,
  edgeKey,
  levelForScore,
  mulberry32,
  normalizeLayout,
  normalizeRelationType,
  resolveCandidateSource,
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

// 2026-10-01 "융합 찾기" — 핵심 추천 점수, 후보 선별, 융합 그래프 배치 회귀 테스트
// 실행: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/curriculumMapFusion.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { rankFusionHubs, selectFusionCandidates, FUSION_AFFINITY_MIN } from '../src/lib/curriculum/fusion.ts'
import { computeFusionLayout } from '../src/components/curriculum-map/fusionLayout.ts'

const item = (id, subjectId, band, topic) => ({ id, subjectId, band, topic })
const never = () => false

test('hub: a standard that bridges more subjects beats a slightly more on-topic loner', () => {
  const pool = [
    item('sci', 'sci', '5-6', 0.99),
    item('mor', 'mor', '5-6', 0.95),
    item('prac', 'prac', '5-6', 0.7),
    item('soc', 'soc', '5-6', 0.6),
    item('kor', 'kor', '5-6', 0.5),
  ]
  // mor 는 실과·사회·국어와 가깝고, sci 는 아무와도 가깝지 않다
  const near = new Set(['mor|prac', 'mor|soc', 'kor|mor'])
  const affinity = (a, b) => (near.has([a, b].sort().join('|')) ? 0.5 : 0.2)
  const hubs = rankFusionHubs(pool, affinity, never)
  assert.equal(hubs[0].id, 'mor')
  assert.deepEqual(hubs[0].partnerSubjectIds, ['kor', 'prac', 'soc'])
  assert.equal(hubs[0].hubScore, Math.round((0.6 * 0.95 + 0.4) * 1000) / 1000)
})

test('hub: partners must share the grade band and be another subject', () => {
  const pool = [item('a', 'sci', '3-4', 0.9), item('b', 'soc', '5-6', 0.9), item('c', 'sci', '3-4', 0.9)]
  const hubs = rankFusionHubs(pool, () => 0.9, never)
  for (const h of hubs) assert.deepEqual(h.partnerIds, [])
})

test('hub: curriculum cross links count even when cosine is low; weak topic partners are dropped', () => {
  const pool = [item('a', 'sci', '5-6', 0.9), item('b', 'soc', '5-6', 0.4), item('c', 'art', '5-6', 0.1)]
  const linked = (x, y) => [x, y].sort().join('|') === 'a|b' || [x, y].sort().join('|') === 'a|c'
  const [hub] = rankFusionHubs(pool, () => 0, linked)
  assert.equal(hub.id, 'a')
  assert.deepEqual(hub.partnerIds, ['b'], 'c 는 주제 관련도 0.1 이라 짝이 아니다')
})

test('hub: only on-topic standards can be hubs; deterministic for any input order', () => {
  const pool = [item('x', 'sci', '5-6', 0.4), item('y', 'soc', '5-6', 0.8), item('z', 'kor', '5-6', 0.8)]
  const a = rankFusionHubs(pool, () => FUSION_AFFINITY_MIN, never)
  const b = rankFusionHubs([...pool].reverse(), () => FUSION_AFFINITY_MIN, never)
  assert.ok(!a.some(h => h.id === 'x'))
  assert.deepEqual(a, b)
})

test('candidates: same band, other subject, priority cross > topic > embedding, merged by id', () => {
  const center = { id: 'c', subjectId: 'sci', band: '5-6' }
  const out = selectFusionCandidates(center, [
    { id: 'e1', subjectId: 'soc', band: '5-6', origin: 'embedding', sim: 0.9 },
    { id: 't1', subjectId: 'kor', band: '5-6', origin: 'topic', sim: 0.3 },
    { id: 'x1', subjectId: 'prac', band: '5-6', origin: 'cross', sim: 0.2, relation: '개념-적용' },
    { id: 'e1', subjectId: 'soc', band: '5-6', origin: 'topic', sim: 0.1 },
    { id: 'same', subjectId: 'sci', band: '5-6', origin: 'cross', sim: 1 },
    { id: 'other', subjectId: 'soc', band: '3-4', origin: 'cross', sim: 1 },
    { id: 'c', subjectId: 'soc', band: '5-6', origin: 'cross', sim: 1 },
  ], 10)
  assert.deepEqual(out.map(o => o.id), ['x1', 'e1', 't1'])
  assert.equal(out.find(o => o.id === 'e1').origin, 'topic')
  assert.equal(out.find(o => o.id === 'e1').sim, 0.9)
})

test('layout: same subject shares one sector, stronger sits closer, nothing at the centre', () => {
  const items = [
    { id: 'p1', subjectId: 'prac', strength: 0.9 },
    { id: 'p2', subjectId: 'prac', strength: 0.4 },
    { id: 's1', subjectId: 'soc', strength: 0.8 },
    { id: 'k1', subjectId: 'kor', strength: 0.6 },
  ]
  const { positions, sectors } = computeFusionLayout(items, ['kor', 'soc', 'prac'], 100, 300)
  assert.deepEqual(sectors.map(s => s.subjectId), ['kor', 'soc', 'prac'])
  const dist = id => Math.hypot(positions.get(id).x, positions.get(id).y)
  assert.ok(dist('p1') < dist('p2'), '강한 연결이 더 가깝다')
  for (const id of positions.keys()) assert.ok(dist(id) >= 100 - 1e-9 && dist(id) <= 300 + 1e-9)
  const angle = id => Math.atan2(positions.get(id).y, positions.get(id).x)
  const prac = sectors.find(s => s.subjectId === 'prac')
  for (const id of ['p1', 'p2']) {
    let a = angle(id)
    while (a < prac.start) a += Math.PI * 2
    assert.ok(a <= prac.end + 1e-9, `${id} 는 실과 부채꼴 안`)
  }
})

test('layout: twenty partners never overlap at radius 14 on a 120..300 ring', () => {
  const subjects = ['kor', 'soc', 'sci', 'art', 'prac']
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, subjectId: subjects[i % 5], strength: (i % 7) / 7 }))
  const { positions } = computeFusionLayout(items, subjects, 120, 300)
  const pts = [...positions.values()]
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 28, `겹침 ${i},${j}`)
    }
  }
})

test('layout: equal-strength items in one sector each get their own slot (no stacking)', () => {
  for (const n of [2, 3, 4, 5]) {
    const items = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, subjectId: 'soc', strength: 0.8 }))
    const { positions } = computeFusionLayout([...items, { id: 'k', subjectId: 'kor', strength: 0.8 }], ['kor', 'soc'], 150, 300, 0.5)
    const pts = [...positions.values()]
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 30, `n=${n} 겹침 ${i},${j}`)
      }
    }
  }
})

test('layout: strength floor stretches the visible range across the whole ring', () => {
  const items = [{ id: 'a', subjectId: 'kor', strength: 0.5 }, { id: 'b', subjectId: 'soc', strength: 1 }]
  const { positions, sectors } = computeFusionLayout(items, ['kor', 'soc'], 100, 300, 0.5)
  assert.equal(Math.round(Math.hypot(positions.get('a').x, positions.get('a').y)), 300)
  assert.equal(Math.round(Math.hypot(positions.get('b').x, positions.get('b').y)), 100)
  assert.equal(Math.round(sectors.find(s => s.subjectId === 'kor').outerRadius), 300)
})

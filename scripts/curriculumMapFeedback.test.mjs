// 2026-09-23 교사 피드백 대응 회귀 테스트
//  1. 원 크기 통일  2. 정렬 배치(거리 = 문서 속성)  3. 성취수준 A·B·C 반영
// 실행: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/curriculumMapFeedback.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  GRID_PITCH_X,
  GRID_PITCH_Y,
  compareStandardCodes,
  computeGridLayout,
  scaleGridGuides,
} from '../src/components/curriculum-map/gridLayout.ts'
import {
  NODE_RADIUS,
  achievementLevelCodeKey,
  buildStandardDocument,
  keywordHit,
  pickStandardLevels,
} from '../src/lib/curriculum/curriculumMap.ts'

const SUBJECTS = [{ id: 'kor', name: '국어' }, { id: 'sci', name: '과학' }]
const BANDS = ['1-2학년군', '3-4학년군', '5-6학년군']

function node(id, code, subjectId, band, area) {
  return { id, code, subjectId, band, area }
}

// ─── 정렬 배치 ─────────────────────────────────────────────────────────────

test('grid: rows follow subject order, columns follow band order', () => {
  const nodes = [
    node('s1', '[4과01-01]', 'sci', '3-4학년군', '물질'),
    node('k1', '[2국01-01]', 'kor', '1-2학년군', '듣기'),
    node('k2', '[6국01-01]', 'kor', '5-6학년군', '듣기'),
  ]
  const { positions, guides } = computeGridLayout(nodes, SUBJECTS, BANDS)
  assert.deepEqual(guides.rows.map(r => r.subjectId), ['kor', 'sci'])
  assert.ok(positions.get('k1').y < positions.get('s1').y, '국어 행이 과학 행보다 위')
  assert.ok(positions.get('k1').x < positions.get('s1').x && positions.get('s1').x < positions.get('k2').x, '학년군 순서대로 왼쪽→오른쪽')
  const col = band => guides.columns.find(c => c.band === band)
  for (const [id, band] of [['k1', '1-2학년군'], ['s1', '3-4학년군'], ['k2', '5-6학년군']]) {
    const p = positions.get(id)
    assert.ok(p.x >= col(band).x0 && p.x <= col(band).x1, `${id} 는 ${band} 열 안`)
  }
})

test('grid: inside a cell, codes are in natural order and areas are grouped', () => {
  const nodes = [
    node('c', '[4과01-10]', 'sci', '3-4학년군', '물질'),
    node('a', '[4과01-02]', 'sci', '3-4학년군', '물질'),
    node('z', '[4과02-01]', 'sci', '3-4학년군', '생명'),
  ]
  const { positions, guides } = computeGridLayout(nodes, SUBJECTS, BANDS)
  assert.ok(positions.get('a').x < positions.get('c').x, '01-02 가 01-10 보다 앞(숫자 비교)')
  assert.ok(positions.get('z').y > positions.get('a').y, '다른 영역은 아래 묶음')
  assert.deepEqual(guides.areas.map(a => a.area), ['물질', '생명'])
})

test('grid: same input in any order gives the same positions (determinism)', () => {
  const nodes = Array.from({ length: 30 }, (_, i) =>
    node(`n${i}`, `[4과0${1 + (i % 3)}-${String(i).padStart(2, '0')}]`, i % 2 ? 'sci' : 'kor', BANDS[i % 3], `영역${i % 3}`))
  const a = computeGridLayout(nodes, SUBJECTS, BANDS)
  const b = computeGridLayout([...nodes].reverse(), SUBJECTS, BANDS)
  for (const n of nodes) assert.deepEqual(a.positions.get(n.id), b.positions.get(n.id))
})

test('grid: no two nodes are closer than one pitch (uniform circles never overlap)', () => {
  const nodes = Array.from({ length: 60 }, (_, i) =>
    node(`n${i}`, `[6과${String(1 + (i % 4)).padStart(2, '0')}-${String(i).padStart(2, '0')}]`, 'sci', '5-6학년군', `영역${i % 4}`))
  const { positions } = computeGridLayout(nodes, SUBJECTS, BANDS)
  const pts = [...positions.values()]
  let min = Infinity
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
  }
  assert.ok(min >= Math.min(GRID_PITCH_X, GRID_PITCH_Y), `최소 간격 ${min}`)
  assert.ok(min >= 2 * NODE_RADIUS + 8, '반지름 12 원 두 개 + 여백')
})

test('grid: unknown subject/band values are appended, never dropped', () => {
  const nodes = [node('x', '[창체-1]', 'extra', '1-2학년군', ''), node('y', '[9국01-01]', 'kor', '7-9학년군', '')]
  const { positions, guides } = computeGridLayout(nodes, SUBJECTS, BANDS)
  assert.equal(positions.size, 2)
  assert.ok(guides.rows.some(r => r.subjectId === 'extra'))
  assert.ok(guides.columns.some(c => c.band === '7-9학년군'))
})

test('grid: scaleGridGuides multiplies every coordinate by K', () => {
  const { guides } = computeGridLayout([node('k1', '[2국01-01]', 'kor', '1-2학년군', '듣기')], SUBJECTS, BANDS)
  const scaled = scaleGridGuides(guides, 2)
  assert.equal(scaled.columns[1].x0, guides.columns[1].x0 * 2)
  assert.equal(scaled.rows[0].y1, guides.rows[0].y1 * 2)
  assert.equal(scaled.areas[0].x, guides.areas[0].x * 2)
})

test('compareStandardCodes: numeric-aware', () => {
  const sorted = [{ code: '[4수01-10]', id: 'b' }, { code: '[4수01-02]', id: 'a' }].sort(compareStandardCodes)
  assert.deepEqual(sorted.map(s => s.id), ['a', 'b'])
})

test('grid on the real asset: every node placed, zero overlaps, rows = subjects present', () => {
  const asset = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/curriculum_map.json'), 'utf8'))
  const { positions, guides } = computeGridLayout(asset.nodes, asset.subjects, asset.bands)
  assert.equal(positions.size, asset.nodes.length)
  const pts = [...positions.values()]
  const need = 2 * NODE_RADIUS + 8
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= need, 'overlap')
    }
  }
  assert.equal(guides.rows.length, new Set(asset.nodes.map(n => n.subjectId)).size)
})

// ─── 원 크기 · 성취수준 에셋 계약 ─────────────────────────────────────────

test('asset: every node has the same radius', () => {
  const asset = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/curriculum_map.json'), 'utf8'))
  assert.deepEqual([...new Set(asset.nodes.map(n => n.r))], [NODE_RADIUS])
})

test('asset: every subject standard (except 창체) carries A·B·C levels', () => {
  const asset = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/curriculum_map.json'), 'utf8'))
  const missing = asset.nodes.filter(n => n.subjectId !== 'sub_extra' && !(n.levels?.A && n.levels?.B && n.levels?.C))
  assert.deepEqual(missing.map(n => n.code), [])
  const sample = asset.nodes.find(n => n.code === '[6과06-02]')
  assert.match(sample.levels.A, /이슬/)
})

// ─── 성취수준 헬퍼 ─────────────────────────────────────────────────────────

test('achievementLevelCodeKey / pickStandardLevels: code-only matching, half entries rejected', () => {
  assert.equal(achievementLevelCodeKey('4사01-01'), '[4사01-01]')
  assert.equal(achievementLevelCodeKey(' [4사01-01] '), '[4사01-01]')
  const file = {
    '[4사01-01]': { A: ' a ', B: 'b', C: 'c', band: '3-4학년군', subject: '사회' },
    '[4사01-02]': { A: 'a', B: '', C: 'c' },
    '[4사08-01]': { A: 'a', B: 'b', C: 'c', inferred: true },
  }
  assert.deepEqual(pickStandardLevels(file, '4사01-01'), { A: 'a', B: 'b', C: 'c' })
  assert.equal(pickStandardLevels(file, '[4사01-02]'), null)
  assert.equal(pickStandardLevels(file, '[9국01-01]'), null)
  assert.equal(pickStandardLevels(file, '[4사08-01]').inferred, true)
})

test('keywordHit: a token found only in the levels is a hit labelled 성취수준', () => {
  const std = { text: '이슬, 안개, 구름을 관찰한다.', keywords: [], area: '지구와 우주' }
  const levels = { A: '발생 실험을 통해 공통점과 차이점을 설명할 수 있다.', B: '설명한다', C: '말한다' }
  assert.equal(keywordHit(std, '', ['실험']), null)
  assert.deepEqual(keywordHit(std, '', ['실험'], levels), { terms: ['실험'], fields: ['성취수준'] })
  // 문장에도 있으면 문장이 먼저 근거가 된다
  assert.deepEqual(keywordHit(std, '', ['이슬'], { ...levels, A: '이슬 실험' }).fields, ['성취기준 문장', '성취수준'])
})

test('buildStandardDocument: includes the A level only', () => {
  const doc = buildStandardDocument({
    subject: '과학', area: '지구와 우주', band: '5-6학년군', coreIdea: '', code: '[6과06-02]', text: '이슬을 관찰한다.',
    levels: { A: 'A 원문', B: 'B 원문', C: 'C 원문' },
  })
  assert.match(doc, /성취수준 A: A 원문/)
  assert.doesNotMatch(doc, /B 원문|C 원문/)
  assert.doesNotMatch(buildStandardDocument({ subject: '과학', area: '', band: '', coreIdea: '', code: '', text: 't' }), /성취수준/)
})

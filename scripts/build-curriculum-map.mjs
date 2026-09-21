// 교육과정 분석맵 정적 에셋 생성기 → public/curriculum_map.json
//
// 입력: public/elementary_knowledge_graph.json (loadGraph 로 초등 전용 정화 적용)
// 출력: 노드 627개(교과·학년군·영역·핵심아이디어 첫 문장·좌표·차수)
//       + 무방향 간선(임베딩 이웃 ≥0.45, 교과 간 링크)
//
// 좌표는 Node 안에서 결정적 force layout 으로 미리 계산한다(브라우저에서 매번
// 시뮬레이션하지 않도록). 시드가 고정이라 같은 입력이면 항상 같은 파일이 나온다.
//
// 실행: npm run build:curriculum-map
import fs from 'node:fs'
import path from 'node:path'
import { loadGraph } from '@/lib/curriculum/graphReader'
import { SUBJECT_NAMES } from '@/components/knowledge-graph/constants'
import {
  LAYOUT_MARGIN,
  LAYOUT_SIZE,
  MAP_BANDS,
  SIMILAR_EDGE_MIN_SIM,
  buildUndirectedEdges,
  coreIdeaSentence,
  normalizeRelationType,
  runForceLayout,
  standardBandLabel,
  subjectDisplayColor,
  subjectDisplayName,
} from '@/lib/curriculum/curriculumMap'

const OUT_PATH = path.join(process.cwd(), 'public', 'curriculum_map.json')
const ASSET_VERSION = 1
const LAYOUT_ITERATIONS = 400
const LAYOUT_SEED = 20260921

function fail(message) {
  console.error(`[build-curriculum-map] ${message}`)
  process.exit(1)
}

const startedAt = performance.now()
const graph = loadGraph()
if (!graph) fail('elementary_knowledge_graph.json 을 찾을 수 없습니다.')
if (!Array.isArray(graph.achievementStandards) || graph.achievementStandards.length === 0) {
  fail('achievementStandards 가 비어 있습니다.')
}

// ─── 노드 ───────────────────────────────────────────────────────────────────

const standardById = new Map(graph.achievementStandards.map(std => [std.id, std]))

const nodes = graph.achievementStandards.map(std => ({
  id: std.id,
  code: std.code ?? '',
  subjectId: std.subject_id ?? '',
  subject: subjectDisplayName(std.subject_id, graph.subjects.find(s => s.id === std.subject_id)?.name_ko),
  band: standardBandLabel(std),
  area: std.area ?? '',
  coreIdeaId: std.core_idea_id ?? '',
  coreIdea: coreIdeaSentence(std, graph),
  text: std.text ?? '',
  x: 0,
  y: 0,
  degree: 0,
}))

// ─── 간선 ───────────────────────────────────────────────────────────────────

const edgeInputs = []
let droppedSimilar = 0
let droppedCross = 0

for (const entry of graph.search_index ?? []) {
  if (!standardById.has(entry.id)) continue
  for (const neighbour of entry.top_similar ?? []) {
    if (neighbour.score < SIMILAR_EDGE_MIN_SIM) {
      droppedSimilar += 1
      continue
    }
    if (!standardById.has(neighbour.id)) {
      droppedSimilar += 1
      continue
    }
    edgeInputs.push({ source: entry.id, target: neighbour.id, sim: neighbour.score, kind: 'similar' })
  }
}

for (const link of graph.links_cross_subject ?? []) {
  if (!standardById.has(link.source_id) || !standardById.has(link.target_id)) {
    droppedCross += 1
    continue
  }
  edgeInputs.push({
    source: link.source_id,
    target: link.target_id,
    sim: link.weight ?? 0,
    kind: 'cross',
    relation: normalizeRelationType(link.relation_edu ?? link.relation),
  })
}

const edges = buildUndirectedEdges(edgeInputs)
  // 파일이 매번 같은 순서로 나오도록 정렬(diff 가능한 에셋).
  .sort((a, b) => (a.source === b.source ? (a.target < b.target ? -1 : 1) : a.source < b.source ? -1 : 1))
  .map(edge => ({ ...edge, sim: Math.round(edge.sim * 10000) / 10000 }))

const degreeById = new Map()
for (const edge of edges) {
  degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1)
  degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1)
}
for (const node of nodes) node.degree = degreeById.get(node.id) ?? 0

// ─── 좌표 ───────────────────────────────────────────────────────────────────

const layoutStartedAt = performance.now()
const positions = runForceLayout(
  nodes.map(node => ({ id: node.id, subjectId: node.subjectId })),
  edges.map(edge => ({ source: edge.source, target: edge.target, sim: edge.sim })),
  { size: LAYOUT_SIZE, margin: LAYOUT_MARGIN, iterations: LAYOUT_ITERATIONS, seed: LAYOUT_SEED },
)
const layoutMs = Math.round(performance.now() - layoutStartedAt)
for (const node of nodes) {
  const point = positions.get(node.id)
  if (!point) fail(`좌표 누락: ${node.id}`)
  node.x = point.x
  node.y = point.y
}

// ─── 교과 목록 (범례 순서 = constants.ts 의 교과 나열 순서) ─────────────────

const legendOrder = Object.keys(SUBJECT_NAMES)
const presentSubjectIds = [...new Set(nodes.map(node => node.subjectId))]
const subjects = presentSubjectIds
  .sort((a, b) => {
    const ia = legendOrder.indexOf(a)
    const ib = legendOrder.indexOf(b)
    return (ia === -1 ? legendOrder.length : ia) - (ib === -1 ? legendOrder.length : ib)
  })
  .map(id => ({
    id,
    name: subjectDisplayName(id, graph.subjects.find(s => s.id === id)?.name_ko),
    color: subjectDisplayColor(id),
  }))

// ─── 쓰기 ───────────────────────────────────────────────────────────────────

const asset = {
  version: ASSET_VERSION,
  builtAt: new Date().toISOString(),
  subjects,
  bands: MAP_BANDS,
  nodes,
  edges,
}

fs.writeFileSync(OUT_PATH, JSON.stringify(asset), 'utf-8')
const bytes = fs.statSync(OUT_PATH).size
const totalMs = Math.round(performance.now() - startedAt)

// ─── 리포트 ─────────────────────────────────────────────────────────────────

const kindCounts = edges.reduce((acc, edge) => {
  acc[edge.kind] = (acc[edge.kind] ?? 0) + 1
  return acc
}, {})
const isolated = nodes.filter(node => node.degree === 0)

// 교과 응집도: 같은 교과 쌍 평균거리 vs 다른 교과 쌍 평균거리(표본 추출).
let intraSum = 0
let intraN = 0
let interSum = 0
let interN = 0
for (let i = 0; i < nodes.length; i += 1) {
  for (let j = i + 1; j < nodes.length; j += 1) {
    const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
    if (nodes[i].subjectId === nodes[j].subjectId) {
      intraSum += d
      intraN += 1
    } else {
      interSum += d
      interN += 1
    }
  }
}
const meanEdgeLen = edges.length === 0
  ? 0
  : edges.reduce((sum, edge) => {
    const a = nodes.find(node => node.id === edge.source)
    const b = nodes.find(node => node.id === edge.target)
    return sum + Math.hypot(a.x - b.x, a.y - b.y)
  }, 0) / edges.length

console.log('[build-curriculum-map] 완료')
console.log(`  출력      : ${path.relative(process.cwd(), OUT_PATH)} (${(bytes / 1024).toFixed(1)} KB / 한도 1536 KB)`)
console.log(`  노드      : ${nodes.length} (고립 ${isolated.length}) · 교과 ${subjects.length} · 학년군 ${asset.bands.length}`)
console.log(`  간선      : ${edges.length} (similar ${kindCounts.similar ?? 0} · cross ${kindCounts.cross ?? 0} · both ${kindCounts.both ?? 0})`)
console.log(`  제외      : similar 후보 ${droppedSimilar} (<${SIMILAR_EDGE_MIN_SIM} 또는 노드 없음) · cross ${droppedCross}`)
console.log(`  배치      : ${LAYOUT_ITERATIONS}회 반복 ${layoutMs}ms · 교과내 평균거리 ${(intraSum / Math.max(1, intraN)).toFixed(0)} vs 교과간 ${(interSum / Math.max(1, interN)).toFixed(0)} · 간선 평균길이 ${meanEdgeLen.toFixed(0)}`)
console.log(`  총 소요   : ${totalMs}ms`)

if (bytes > 1536 * 1024) fail(`에셋이 1.5MB 한도를 넘었습니다 (${(bytes / 1024).toFixed(1)} KB).`)

// 교육과정 분석맵 정적 에셋 생성기 → public/curriculum_map.json
//
// 입력: public/elementary_knowledge_graph.json (loadGraph 로 초등 전용 정화 적용)
// 출력: 노드 627개(교과·학년군·영역·핵심아이디어 첫 문장·좌표 x·y·반지름 r·차수)
//       + 대표 키워드 keywords(최대 8, 호버 툴팁용)
//       + 공식 성취수준 levels{A,B,C}(public/achievement-levels.json, 코드로만 매칭)
//       + 무방향 간선(임베딩 이웃 ≥0.45, 교과 간 링크)
//
// 좌표는 Node 안에서 결정적으로 미리 계산한다(브라우저에서 매번 시뮬레이션하지
// 않도록). 시드가 고정이라 같은 입력이면 항상 같은 파일이 나온다.
//
// 배치 4단계(layoutCurriculumMap): 힘 시뮬레이션 → 평균 최근접거리를 평균
// 반지름의 3배로 벌림 → 충돌 해소 → 정사각형 맞춤. 겹침 없음이 보장된다
// (모든 쌍에서 dist ≥ r_i + r_j + 8). 넘칠 때는 좌표를 줄이는 대신 정사각형을
// 키운다 — 축소하면 벌려 놓은 간격이 되돌아가 겹침이 되살아난다.
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
  MIN_NODE_GAP,
  SIMILAR_EDGE_MIN_SIM,
  buildUndirectedEdges,
  coreIdeaSentence,
  displayKeywords,
  layoutCurriculumMap,
  normalizeRelationType,
  pickStandardLevels,
  standardBandLabel,
  subjectDisplayColor,
  subjectDisplayName,
} from '@/lib/curriculum/curriculumMap'

const OUT_PATH = path.join(process.cwd(), 'public', 'curriculum_map.json')
// 성취수준 원문 — scripts/extract-achievement-levels.mjs 가 만든다. 서버(검색·관련 API)도
// 이 에셋의 levels 를 읽으므로(loadStandardLevelsById) 없으면 빌드를 멈춘다.
const LEVELS_PATH = path.join(process.cwd(), 'public', 'achievement-levels.json')
const ASSET_VERSION = 1
const LAYOUT_ITERATIONS = 400
const LAYOUT_SEED = 20260921
// 충돌 패스 상한. 덩어리 중심은 감쇠 Jacobi 로 천천히 풀려서 120패스로는
// 18쌍이 남았다(231 → 18). 400패스에서 0으로 수렴하며 비용은 수백 ms 다.
const MAX_COLLISION_PASSES = 400

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

if (!fs.existsSync(LEVELS_PATH)) fail(`성취수준 파일이 없습니다: ${path.relative(process.cwd(), LEVELS_PATH)} (scripts/extract-achievement-levels.mjs)`)
const levelFile = JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf-8'))
const levelStandards = levelFile.standards ?? {}

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
  keywords: displayKeywords(std.keywords ?? [], 8),
  ...(() => {
    const levels = pickStandardLevels(levelStandards, std.code ?? '')
    return levels ? { levels } : {}
  })(),
  x: 0,
  y: 0,
  r: 0,
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
const { positions, radii, stats } = layoutCurriculumMap(
  nodes.map(node => ({ id: node.id, subjectId: node.subjectId, degree: node.degree })),
  edges.map(edge => ({ source: edge.source, target: edge.target, sim: edge.sim })),
  {
    size: LAYOUT_SIZE,
    margin: LAYOUT_MARGIN,
    iterations: LAYOUT_ITERATIONS,
    seed: LAYOUT_SEED,
    minGap: MIN_NODE_GAP,
    maxCollisionPasses: MAX_COLLISION_PASSES,
  },
)
const layoutMs = Math.round(performance.now() - layoutStartedAt)
for (const node of nodes) {
  const point = positions.get(node.id)
  const radius = radii.get(node.id)
  if (!point || radius === undefined) fail(`좌표/반지름 누락: ${node.id}`)
  node.x = point.x
  node.y = point.y
  node.r = radius
}
// 겹침 없음은 이 에셋의 계약이다. 위반이 남으면 파일을 쓰지 않는다.
if (stats.violations > 0) {
  fail(`겹침 ${stats.violations}쌍이 남았습니다 (패스 ${stats.collisionPasses}/${MAX_COLLISION_PASSES}). MAX_COLLISION_PASSES 를 올리세요.`)
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
const nodeById = new Map(nodes.map(node => [node.id, node]))
const meanEdgeLen = edges.length === 0
  ? 0
  : edges.reduce((sum, edge) => {
    const a = nodeById.get(edge.source)
    const b = nodeById.get(edge.target)
    return sum + Math.hypot(a.x - b.x, a.y - b.y)
  }, 0) / edges.length
const radiusValues = nodes.map(node => node.r)

console.log('[build-curriculum-map] 완료')
console.log(`  출력      : ${path.relative(process.cwd(), OUT_PATH)} (${(bytes / 1024).toFixed(1)} KB / 한도 1536 KB)`)
console.log(`  노드      : ${nodes.length} (고립 ${isolated.length}) · 교과 ${subjects.length} · 학년군 ${asset.bands.length}`)
console.log(`  간선      : ${edges.length} (similar ${kindCounts.similar ?? 0} · cross ${kindCounts.cross ?? 0} · both ${kindCounts.both ?? 0})`)
console.log(`  제외      : similar 후보 ${droppedSimilar} (<${SIMILAR_EDGE_MIN_SIM} 또는 노드 없음) · cross ${droppedCross}`)
console.log(`  반지름    : ${Math.min(...radiusValues).toFixed(1)}~${Math.max(...radiusValues).toFixed(1)} · 평균 ${stats.meanRadius}`)
const withLevels = nodes.filter(node => node.levels)
const missingLevels = nodes.filter(node => !node.levels && node.subjectId !== 'sub_extra')
console.log(`  성취수준  : ${withLevels.length}/${nodes.length} 노드 (창체 제외 누락 ${missingLevels.length}${missingLevels.length ? `: ${missingLevels.slice(0, 5).map(node => node.code).join(', ')}` : ''})`)
console.log(`  키워드    : 평균 ${(nodes.reduce((sum, node) => sum + node.keywords.length, 0) / nodes.length).toFixed(1)}개/노드 · 빈 노드 ${nodes.filter(node => node.keywords.length === 0).length}`)
console.log(`  좌표계    : extent ${stats.extent} (요청 ${LAYOUT_SIZE}, 여백 ${LAYOUT_MARGIN}) · 벌림배율 ${stats.spreadScale} (확대 재시도 ${stats.growthAttempts}회) · 맞춤배율 ${stats.scale.toFixed(3)}`)
console.log(`  겹침      : 위반 ${stats.violations}쌍 · 최소 간격 ${stats.minGap} (요구 ${MIN_NODE_GAP}) · 충돌 패스 ${stats.collisionPasses}/${MAX_COLLISION_PASSES}`)
console.log(`  간격      : 평균 최근접거리 ${stats.meanNearestNeighbour} (목표 ${(stats.meanRadius * 3).toFixed(1)} = 평균반지름×3) · 간선 평균길이 ${meanEdgeLen.toFixed(0)}`)
console.log(`  응집      : 교과내 평균거리 ${(intraSum / Math.max(1, intraN)).toFixed(0)} vs 교과간 ${(interSum / Math.max(1, interN)).toFixed(0)} (비 ${((interSum / interN) / (intraSum / intraN)).toFixed(2)})`)
console.log(`  배치 시간 : ${LAYOUT_ITERATIONS}회 시뮬 ${stats.forceMs}ms + 충돌 ${stats.collisionMs}ms = ${layoutMs}ms`)
console.log(`  총 소요   : ${totalMs}ms`)

// 창체는 성취수준 문서 대상이 아니다. 그 밖의 교과에서 빠지면 코드 매칭이 깨진 것이다.
if (missingLevels.length > 0) fail(`성취수준이 없는 교과 성취기준 ${missingLevels.length}개 — 코드 매칭을 확인하세요.`)
if (bytes > 1536 * 1024) fail(`에셋이 1.5MB 한도를 넘었습니다 (${(bytes / 1024).toFixed(1)} KB).`)

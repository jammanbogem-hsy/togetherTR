/**
 * 교육과정 분석맵(standalone hub map) 공용 헬퍼.
 *
 * 두 종류를 한 파일에 모았다.
 *
 *  1. 순수 함수 — 코사인 유사도, 점수 혼합, 관련도 등급, 무방향 간선 병합,
 *     후보 합집합, 결정적 force layout 과 좌표 정규화.
 *     `scripts/build-curriculum-map.mjs`(에셋 생성)와 `/api/curriculum-map/*`
 *     라우트가 같은 규칙을 쓰도록 하기 위함이며, 파일시스템·네트워크에 의존하지
 *     않으므로 `scripts/curriculumMap.test.mjs` 가 그대로 단위 테스트한다.
 *
 *  2. 서버 전용 로더 — 성취기준 임베딩(public/embeddings_cache.json)과 질의
 *     임베딩 캐시. graphReader 의 `loadEmbeddings` 는 export 되지 않아(모듈 내부
 *     전용) 같은 후보 경로 규칙을 여기서 최소 복제한다.
 *
 * 교과 색·이름은 `src/components/knowledge-graph/constants.ts` 를 단일 출처로
 * 재사용한다(팔레트를 복제하면 지식 그래프 화면과 색이 갈라진다).
 */

import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { SUBJECT_COLORS, SUBJECT_NAMES } from '@/components/knowledge-graph/constants'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType } from '@/lib/knowledge-graph/domain'
import { CANONICAL_GRADE_BANDS, toCanonicalGradeBand } from '@/lib/curriculum/curriculumFilters'
import type { CurriculumStandard, KnowledgeGraph } from '@/lib/curriculum/graphReader'

// ─── 에셋 타입 (public/curriculum_map.json) ─────────────────────────────────

export interface CurriculumMapSubject {
  id: string
  name: string
  color: string
}

export interface CurriculumMapNode {
  id: string
  code: string
  subjectId: string
  subject: string
  band: string
  area: string
  coreIdeaId: string
  /** 핵심아이디어 그룹의 첫 문장(120자 이내). */
  coreIdea: string
  text: string
  x: number
  y: number
  degree: number
}

/** 'similar' = 임베딩 이웃, 'cross' = 교과 간 링크, 'both' = 둘 다. */
export type CurriculumMapEdgeKind = 'similar' | 'cross' | 'both'

export interface CurriculumMapEdge {
  source: string
  target: string
  /** 0~1. similar 는 코사인, cross 는 링크 weight, both 는 둘 중 큰 값. */
  sim: number
  kind: CurriculumMapEdgeKind
  /** cross/both 에만 있음. RELATION_TYPE_CRITERIA 의 키. */
  relation?: string
}

export interface CurriculumMapAsset {
  version: number
  builtAt: string
  subjects: CurriculumMapSubject[]
  bands: string[]
  nodes: CurriculumMapNode[]
  edges: CurriculumMapEdge[]
}

// ─── 상수 ───────────────────────────────────────────────────────────────────

/** search_index.top_similar 중 간선으로 남길 최소 코사인. */
export const SIMILAR_EDGE_MIN_SIM = 0.45

/** 에셋 좌표계: 0..LAYOUT_SIZE 정사각형, 테두리 여백 LAYOUT_MARGIN. */
export const LAYOUT_SIZE = 2000
export const LAYOUT_MARGIN = 60

/** 핵심아이디어 문장 최대 길이(노드 툴팁용). */
export const CORE_IDEA_MAX_CHARS = 120

/** Jev Score 0~3 의 4단계 관련도 레이블. 낮은 쪽부터. */
export const RELEVANCE_LEVELS = ['무관', '약함', '관련', '핵심'] as const
export type RelevanceLevel = (typeof RELEVANCE_LEVELS)[number]

export const MAP_BANDS: string[] = [...CANONICAL_GRADE_BANDS]

// ─── 순수 헬퍼: 점수 ────────────────────────────────────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** 코사인 유사도. 길이가 다르면 짧은 쪽까지만 본다(방어적). */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Jev 관련도(0~1)와 임베딩 코사인(0~1)을 7:3 으로 섞는다.
 * Jev 가 "이 주제의 성취기준인가"를 판정하고 임베딩은 동점 처리용 보조 신호다.
 */
export function blendJevAndSim(jev: number, sim: number): number {
  return clamp01(0.7 * clamp01(jev) + 0.3 * clamp01(sim))
}

/**
 * 0~1 점수를 4단계 레이블로. Jev Score(0~3)를 3으로 나눈 값이 그대로 경계에
 * 떨어지도록 1/4 폭으로 자른다(0→무관, 1/3→약함, 2/3→관련, 1→핵심).
 */
export function levelForScore(value: number): RelevanceLevel {
  const v = clamp01(value)
  if (v >= 0.75) return '핵심'
  if (v >= 0.5) return '관련'
  if (v >= 0.25) return '약함'
  return '무관'
}

/** 문장을 max 자 이내로 자르되 어절 경계를 지킨다. */
export function truncateSentence(text: string | undefined | null, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const body = lastSpace >= Math.floor(max * 0.6) ? cut.slice(0, lastSpace) : cut
  return `${body.trim()}…`
}

// ─── 순수 헬퍼: 교과 ────────────────────────────────────────────────────────

/**
 * 교과 표시 이름. 지식 그래프의 name_ko 는 '사회과', '바른 생활·슬기로운
 * 생활·즐거운 생활' 처럼 길어서 화면용으로는 constants.ts 의 짧은 이름을 쓴다.
 */
export function subjectDisplayName(subjectId: string, fallback?: string): string {
  return SUBJECT_NAMES[subjectId] ?? fallback ?? subjectId
}

export function subjectDisplayColor(subjectId: string): string {
  return SUBJECT_COLORS[subjectId] ?? SUBJECT_COLORS.default
}

/** 성취기준의 학년군을 정규 레이블('3-4학년군')로. 변환 실패 시 원문 유지. */
export function standardBandLabel(std: Pick<CurriculumStandard, 'grade_band'>): string {
  return toCanonicalGradeBand(std.grade_band) || (std.grade_band ?? '')
}

// ─── 순수 헬퍼: 무방향 간선 병합 ────────────────────────────────────────────

export interface EdgeInput {
  source: string
  target: string
  sim: number
  kind: 'similar' | 'cross'
  relation?: string
}

/** 무방향 간선의 정규 키. 두 방향이 같은 키로 모이게 정렬한다. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * 방향 있는 간선 후보들을 무방향으로 중복 제거한다.
 *  - 같은 쌍이 similar·cross 양쪽에서 오면 kind 'both'
 *  - sim 은 최대값
 *  - relation 은 먼저 관측된 값을 유지(cross 만 relation 을 갖는다)
 * 자기 자신으로 가는 간선은 버린다.
 */
export function buildUndirectedEdges(inputs: readonly EdgeInput[]): CurriculumMapEdge[] {
  const byKey = new Map<string, CurriculumMapEdge>()
  for (const input of inputs) {
    if (!input.source || !input.target || input.source === input.target) continue
    const [source, target] = input.source < input.target
      ? [input.source, input.target]
      : [input.target, input.source]
    const key = edgeKey(source, target)
    const sim = clamp01(input.sim)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        source,
        target,
        sim,
        kind: input.kind,
        ...(input.relation ? { relation: input.relation } : {}),
      })
      continue
    }
    existing.sim = Math.max(existing.sim, sim)
    if (existing.kind !== input.kind) existing.kind = 'both'
    if (!existing.relation && input.relation) existing.relation = input.relation
  }
  return [...byKey.values()]
}

/** 교과 간 링크의 relation_edu('의미-연결')를 관계 유형 키('의미연결')로. */
export function normalizeRelationType(value?: string | null): string {
  return normalizeGraphRelationType(value) ?? DEFAULT_GRAPH_RELATION_TYPE
}

// ─── 순수 헬퍼: 관련 성취기준 후보 합집합 ───────────────────────────────────

export type CandidateOrigin = 'similar' | 'cross' | 'embedding'
export type CandidateSource = CandidateOrigin | 'mixed'

export interface CandidateInput {
  id: string
  origin: CandidateOrigin
  sim: number
  relation?: string
}

export interface UnionedCandidate {
  id: string
  sim: number
  origins: CandidateOrigin[]
  source: CandidateSource
  relation?: string
}

/**
 * 후보 출처 레이블.
 *  - 'cross'    : 교육과정 교과 간 링크만
 *  - 'mixed'    : 교과 간 링크 + 유사도(사전 이웃 또는 실시간 코사인)
 *  - 'similar'  : 사전 계산된 임베딩 이웃(search_index)
 *  - 'embedding': 실시간 코사인으로만 올라온 후보
 */
export function resolveCandidateSource(origins: readonly CandidateOrigin[]): CandidateSource {
  const hasCross = origins.includes('cross')
  if (hasCross) return origins.length > 1 ? 'mixed' : 'cross'
  if (origins.includes('similar')) return 'similar'
  return 'embedding'
}

const ORIGIN_ORDER: CandidateOrigin[] = ['similar', 'cross', 'embedding']

/**
 * 후보를 id 로 합치고 cap 개로 줄인다.
 * 정렬: 교과 간 링크가 있는 후보 우선(교육과정이 직접 연결한 쌍은 버리지 않음)
 * → sim 내림차순 → id(결정성).
 */
export function unionCandidates(inputs: readonly CandidateInput[], cap: number): UnionedCandidate[] {
  const byId = new Map<string, { id: string; sim: number; origins: Set<CandidateOrigin>; relation?: string }>()
  for (const input of inputs) {
    if (!input.id) continue
    const existing = byId.get(input.id)
    if (!existing) {
      byId.set(input.id, {
        id: input.id,
        sim: clamp01(input.sim),
        origins: new Set([input.origin]),
        relation: input.relation,
      })
      continue
    }
    existing.sim = Math.max(existing.sim, clamp01(input.sim))
    existing.origins.add(input.origin)
    if (!existing.relation && input.relation) existing.relation = input.relation
  }
  return [...byId.values()]
    .map(entry => {
      const origins = ORIGIN_ORDER.filter(origin => entry.origins.has(origin))
      return {
        id: entry.id,
        sim: entry.sim,
        origins,
        source: resolveCandidateSource(origins),
        ...(entry.relation ? { relation: entry.relation } : {}),
      }
    })
    .sort((a, b) => {
      const crossA = a.origins.includes('cross') ? 1 : 0
      const crossB = b.origins.includes('cross') ? 1 : 0
      if (crossA !== crossB) return crossB - crossA
      if (b.sim !== a.sim) return b.sim - a.sim
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, Math.max(0, cap))
}

// ─── 순수 헬퍼: 결정적 force layout ─────────────────────────────────────────

/** 간선의 자연 길이. 유사할수록 가깝게(0.45→~183, 1.0→40). */
export function springRestLength(sim: number): number {
  return 40 + (1 - clamp01(sim)) * 260
}

/** mulberry32 — 시드 고정 의사난수(같은 입력 → 같은 좌표). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Point {
  x: number
  y: number
}

/**
 * 좌표를 0..size 정사각형 안으로 균일 축척(종횡비 유지)해 옮기고 가운데 정렬한다.
 * 점이 하나거나 모두 같은 자리면 정중앙에 둔다.
 */
export function normalizeLayout(
  points: readonly Point[],
  options: { size?: number; margin?: number } = {},
): Point[] {
  const size = options.size ?? LAYOUT_SIZE
  const margin = options.margin ?? LAYOUT_MARGIN
  if (points.length === 0) return []
  const inner = Math.max(1, size - margin * 2)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  const span = Math.max(spanX, spanY)
  if (!Number.isFinite(span) || span <= 0) {
    return points.map(() => ({ x: size / 2, y: size / 2 }))
  }
  const scale = inner / span
  // 균일 축척 후 남는 축을 가운데로 밀어 정사각형 안에 중심 정렬한다.
  const offsetX = margin + (inner - spanX * scale) / 2
  const offsetY = margin + (inner - spanY * scale) / 2
  return points.map(p => ({
    x: Math.round(((p.x - minX) * scale + offsetX) * 100) / 100,
    y: Math.round(((p.y - minY) * scale + offsetY) * 100) / 100,
  }))
}

export interface LayoutNodeInput {
  id: string
  subjectId: string
}

export interface LayoutEdgeInput {
  source: string
  target: string
  sim: number
}

export interface LayoutOptions {
  size?: number
  margin?: number
  iterations?: number
  seed?: number
}

/**
 * Fruchterman-Reingold 계열 force layout.
 *
 *  - 반발력: 모든 노드 쌍에 k²/d (k = sqrt(area / n))
 *  - 인장력: 간선마다 자연 길이 springRestLength(sim) 쪽으로 당기는 선형 스프링
 *  - 교과 응집: 같은 교과 무게중심 쪽으로 약한 인장(교과가 느슨한 덩어리를 이루게)
 *  - 중심 중력: 간선 없는 노드가 무한히 밀려나가지 않게 아주 약하게
 *  - 냉각: 반복마다 최대 이동량(temperature)을 기하급수로 줄임
 *
 * 시드 고정 초기 배치 + 결정적 순회이므로 같은 입력이면 항상 같은 좌표가 나온다.
 */
export function runForceLayout(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  options: LayoutOptions = {},
): Map<string, Point> {
  const size = options.size ?? LAYOUT_SIZE
  const margin = options.margin ?? LAYOUT_MARGIN
  const iterations = options.iterations ?? 400
  const rand = mulberry32(options.seed ?? 20260921)
  const n = nodes.length
  const result = new Map<string, Point>()
  if (n === 0) return result

  const indexById = new Map<string, number>()
  nodes.forEach((node, i) => indexById.set(node.id, i))

  // 교과 앵커: 교과 id 를 정렬해 원주에 고정 배치(결정적).
  const subjectIds = [...new Set(nodes.map(node => node.subjectId || 'default'))].sort()
  const anchors = new Map<string, Point>()
  const center = size / 2
  const ringRadius = size * 0.32
  subjectIds.forEach((subjectId, i) => {
    const angle = (2 * Math.PI * i) / subjectIds.length
    anchors.set(subjectId, {
      x: center + ringRadius * Math.cos(angle),
      y: center + ringRadius * Math.sin(angle),
    })
  })

  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const dxs = new Float64Array(n)
  const dys = new Float64Array(n)
  const subjectIdx = new Int32Array(n)
  const subjectPos = new Map<string, number>()
  subjectIds.forEach((subjectId, i) => subjectPos.set(subjectId, i))

  const jitter = size * 0.12
  nodes.forEach((node, i) => {
    const anchor = anchors.get(node.subjectId || 'default')!
    xs[i] = anchor.x + (rand() - 0.5) * jitter
    ys[i] = anchor.y + (rand() - 0.5) * jitter
    subjectIdx[i] = subjectPos.get(node.subjectId || 'default') ?? 0
  })

  // 간선을 평면 배열로 (source idx, target idx, rest length)
  const edgeA: number[] = []
  const edgeB: number[] = []
  const edgeLen: number[] = []
  for (const edge of edges) {
    const a = indexById.get(edge.source)
    const b = indexById.get(edge.target)
    if (a === undefined || b === undefined || a === b) continue
    edgeA.push(a)
    edgeB.push(b)
    edgeLen.push(springRestLength(edge.sim))
  }
  const edgeCount = edgeA.length

  const subjectCount = subjectIds.length
  const subjectSumX = new Float64Array(subjectCount)
  const subjectSumY = new Float64Array(subjectCount)
  const subjectN = new Float64Array(subjectCount)
  for (let i = 0; i < n; i++) subjectN[subjectIdx[i]] += 1

  const k = Math.sqrt((size * size) / n)
  // 반발 계수 2k² — 627노드 실측에서 k² 는 14px 안에 이웃이 있는 노드가 127개,
  // 2k² 는 49개였고 교과 응집비(교과간/교과내 평균거리 2.16)와 sim-길이 상관
  // (-0.50)은 그대로였다. 3k² 이상은 최근접 거리 최악값이 되레 나빠졌다.
  const repulsion = 2 * k * k
  const ATTRACT = 0.25
  const SUBJECT_PULL = 0.02
  const GRAVITY = 0.006
  const MIN_DIST = 1
  let temp = size * 0.06
  const cooling = Math.exp(Math.log(0.5 / temp) / Math.max(1, iterations))

  for (let iter = 0; iter < iterations; iter++) {
    dxs.fill(0)
    dys.fill(0)
    subjectSumX.fill(0)
    subjectSumY.fill(0)
    for (let i = 0; i < n; i++) {
      subjectSumX[subjectIdx[i]] += xs[i]
      subjectSumY[subjectIdx[i]] += ys[i]
    }

    // 반발력 (i<j 한 번만 계산해 양쪽에 반영)
    for (let i = 0; i < n; i++) {
      const xi = xs[i]
      const yi = ys[i]
      for (let j = i + 1; j < n; j++) {
        let dx = xi - xs[j]
        let dy = yi - ys[j]
        let d2 = dx * dx + dy * dy
        if (d2 === 0) {
          // 완전히 겹친 경우 결정적으로 살짝 떼어놓는다.
          dx = ((i % 7) - 3) * 0.01 + 0.001
          dy = ((j % 5) - 2) * 0.01 + 0.001
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const force = repulsion / Math.max(MIN_DIST, d)
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        dxs[i] += fx
        dys[i] += fy
        dxs[j] -= fx
        dys[j] -= fy
      }
    }

    // 인장력 (자연 길이 스프링)
    for (let e = 0; e < edgeCount; e++) {
      const i = edgeA[e]
      const j = edgeB[e]
      const dx = xs[j] - xs[i]
      const dy = ys[j] - ys[i]
      const d = Math.sqrt(dx * dx + dy * dy) || MIN_DIST
      const force = ATTRACT * (d - edgeLen[e])
      const fx = (dx / d) * force
      const fy = (dy / d) * force
      dxs[i] += fx
      dys[i] += fy
      dxs[j] -= fx
      dys[j] -= fy
    }

    // 교과 무게중심 인장 + 중심 중력
    for (let i = 0; i < n; i++) {
      const s = subjectIdx[i]
      const cx = subjectSumX[s] / subjectN[s]
      const cy = subjectSumY[s] / subjectN[s]
      dxs[i] += (cx - xs[i]) * SUBJECT_PULL
      dys[i] += (cy - ys[i]) * SUBJECT_PULL
      dxs[i] += (center - xs[i]) * GRAVITY
      dys[i] += (center - ys[i]) * GRAVITY
    }

    // 냉각된 최대 이동량으로 제한
    for (let i = 0; i < n; i++) {
      const dx = dxs[i]
      const dy = dys[i]
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 1e-9) continue
      const step = Math.min(len, temp)
      xs[i] += (dx / len) * step
      ys[i] += (dy / len) * step
    }
    temp *= cooling
  }

  const normalized = normalizeLayout(
    Array.from({ length: n }, (_, i) => ({ x: xs[i], y: ys[i] })),
    { size, margin },
  )
  nodes.forEach((node, i) => result.set(node.id, normalized[i]))
  return result
}

// ─── 서버 전용: 임베딩 로더 ─────────────────────────────────────────────────

let _standardEmbeddings: Record<string, number[]> | null = null

/** 성취기준 임베딩(id → 1536차원). graphReader 와 같은 후보 경로 규칙. */
export function loadStandardEmbeddings(): Record<string, number[]> {
  if (_standardEmbeddings) return _standardEmbeddings
  const candidates = [
    path.join(process.cwd(), 'public/embeddings_cache.json'),
    path.join(process.cwd(), 'data/embeddings_cache.json'),
    path.join(process.cwd(), '../교육과정/curri/output/embeddings_cache.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _standardEmbeddings = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, number[]>
        return _standardEmbeddings
      }
    } catch {
      /* 다음 후보 경로로 */
    }
  }
  _standardEmbeddings = {}
  return _standardEmbeddings
}

const _queryEmbeddingCache = new Map<string, number[]>()
const QUERY_EMBEDDING_CACHE_MAX = 200

/**
 * 질의 임베딩 — 같은 문장은 프로세스 메모리에서 재사용한다(검색이 키워드 단위로
 * 반복 호출되므로 OpenAI 왕복을 대부분 없앤다). 키 없음·실패 시 null.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const key = text.trim()
  if (!key) return null
  const cached = _queryEmbeddingCache.get(key)
  if (cached) return cached
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const resp = await client.embeddings.create({ input: key, model: 'text-embedding-3-small' })
    const vector = resp.data[0]?.embedding ?? null
    if (!vector) return null
    if (_queryEmbeddingCache.size >= QUERY_EMBEDDING_CACHE_MAX) {
      const oldest = _queryEmbeddingCache.keys().next().value
      if (oldest !== undefined) _queryEmbeddingCache.delete(oldest)
    }
    _queryEmbeddingCache.set(key, vector)
    return vector
  } catch (error) {
    console.error('[curriculum-map] query embedding failed', {
      query: key.slice(0, 40),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ─── 서버 전용: 그래프 조회 ─────────────────────────────────────────────────

/** 라우트 응답의 공통 성취기준 요약. */
export interface StandardSummary {
  id: string
  code: string
  subject: string
  subjectId: string
  band: string
  area: string
  text: string
}

export function toStandardSummary(std: CurriculumStandard, graph: KnowledgeGraph): StandardSummary {
  const graphName = graph.subjects.find(s => s.id === std.subject_id)?.name_ko
  return {
    id: std.id,
    code: std.code,
    subject: subjectDisplayName(std.subject_id, graphName),
    subjectId: std.subject_id,
    band: standardBandLabel(std),
    area: std.area ?? '',
    text: std.text ?? '',
  }
}

/** 성취기준이 속한 핵심아이디어 그룹의 첫 문장(120자 이내). */
export function coreIdeaSentence(std: CurriculumStandard, graph: KnowledgeGraph): string {
  if (!std.core_idea_id) return ''
  const group = graph.coreIdeas.find(ci => ci.id === std.core_idea_id)
  return truncateSentence(group?.ideas?.[0] ?? '', CORE_IDEA_MAX_CHARS)
}

/**
 * 요청 필터 적용. subjects 는 교과 id, bands 는 정규 학년군 레이블.
 * 빈 배열/미지정은 "전체"로 취급한다.
 */
export function filterStandards(
  standards: readonly CurriculumStandard[],
  filters: { subjects?: readonly string[]; bands?: readonly string[] },
): CurriculumStandard[] {
  const subjects = new Set((filters.subjects ?? []).filter(Boolean))
  const bands = new Set(
    (filters.bands ?? [])
      .map(band => toCanonicalGradeBand(band) || band)
      .filter(Boolean) as string[],
  )
  return standards.filter(std => {
    if (subjects.size > 0 && !subjects.has(std.subject_id)) return false
    if (bands.size > 0 && !bands.has(standardBandLabel(std))) return false
    return true
  })
}

// ─── 서버 전용: 마감 시한 ───────────────────────────────────────────────────

/**
 * Jev 판정에 상한 시간을 둔다. systemOne 은 30초 타임아웃 + 재시도 2회라
 * 최악의 경우 90초까지 늘어날 수 있어 UX 목표(2~2.5초)를 지키려면 라우트가
 * 직접 끊어야 한다. 시한을 넘기면 null → 호출자가 임베딩 경로로 폴백한다.
 * (judgeRelations/judgeTopicRelevance 는 내부에서 예외를 잡아 null 을 돌려주므로
 * 버려진 프라미스가 unhandled rejection 이 되지 않는다.)
 */
export async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      console.error('[curriculum-map] judge deadline exceeded', { label, ms })
      resolve(null)
    }, ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

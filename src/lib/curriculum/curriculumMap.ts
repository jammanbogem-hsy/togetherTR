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
  /** 호버 툴팁용 대표 키워드(최대 8개, 기계 추출 잡음 제거). */
  keywords: string[]
  x: number
  y: number
  /** 월드 단위 반지름. degree 순위(원값 아님)로 8~26. 겹침 없음이 보장된다. */
  r: number
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

/** 노드 반지름(월드 단위): 8 + 18 · degree순위(0~1). */
export const NODE_MIN_RADIUS = 8
export const NODE_RADIUS_RANGE = 18

/** 두 노드 사이에 최소로 남겨야 하는 빈 간격. dist ≥ r_i + r_j + MIN_NODE_GAP. */
export const MIN_NODE_GAP = 8

/** 목표 평균 최근접거리 = 평균 반지름 × 이 배수(덩어리가 읽히도록 벌린다). */
export const TARGET_NN_RADIUS_FACTOR = 3

/** 충돌이 수렴하지 않을 때 전체를 키우는 배율과 재시도 한도. */
export const LAYOUT_GROWTH_STEP = 1.25
export const MAX_LAYOUT_GROWTH_ATTEMPTS = 10

/**
 * 충돌 해소는 계약(MIN_NODE_GAP)보다 이만큼 더 벌려 놓는다.
 * 밀어내기는 필요 거리에 "정확히" 맞춰 멈추므로 뒤따르는 좌표 반올림(소수 1자리)
 * 만으로도 경계에 놓인 쌍이 계약 아래로 내려갔다(scale 2에서 0쌍 → 반올림 후 99쌍).
 */
export const COLLISION_SAFETY_GAP = 0.5

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

// ─── 순수 헬퍼: 관련 근거(evidence) ─────────────────────────────────────────

/**
 * 근거로 보여주면 안 되는 키워드.
 *
 * 그래프의 keywords 는 성취기준 문장에서 기계 추출한 것이라 '수 있', '갖고 물체',
 * '밀거나 당길 때 나타' 같은 조각이 섞여 있다. "왜 연결됐나"를 설명하는 자리에
 * 이런 조각을 내놓으면 근거가 더 불분명해 보이므로(이 기능이 고치려는 바로 그
 * 문제) 기능어·조각을 걸러낸다. 내용어는 남긴다.
 */
const KEYWORD_NOISE_RE = /(수\s*있|할\s*수|있음|있는|하는|나타|보고|갖고|통해|위해|대해|따라|관하)/
const KEYWORD_STOPWORDS = new Set([
  '이용', '활동', '관련', '흥미', '필요함', '알고', '여러', '가지', '다양', '각각',
  '방법', '경우', '내용', '모습', '자신', '우리', '사람', '생각', '이해', '표현',
  '비교', '설명', '조사', '탐구', '확인', '제시', '사용', '구성', '중요',
])

/** 어절 끝 조사를 떼되 2자 미만으로 줄어들면 원형을 유지한다. */
const TRAILING_PARTICLE_RE = /(의|을|를|이|가|은|는|에|로|와|과|도|만|서|부터|까지)$/

/**
 * 활용된 동사 어절('알고', '가지고', '실천할'). 어간 목록 + 어미로만 매칭하므로
 * '사고', '기후' 같은 명사를 잘못 걸러내지 않는다. 추출 키워드는 '알고 기후변화'
 * 처럼 동사가 앞에 붙어 오는 경우가 많아 앞머리에서 떼어낸다.
 */
const VERB_FRAGMENT_RE = /^(알|갖|가지|하|되|보|찾|만들|살펴보|내보|이용|활용|통|대|위|비교|설명|조사|탐구|확인|수행|사용|실천|표현|파악|이해|관찰|측정|분류|구분|제작|발표|감상)(고|면|며|여|서|아|어|워|자|니|기|는|한|할|해|했|됨|됩|하여|하고|하면|한다)$/

function stripParticle(token: string): string {
  const stripped = token.replace(TRAILING_PARTICLE_RE, '')
  return stripped.length >= 2 ? stripped : token
}

function isUsefulTerm(token: string): boolean {
  if (token.length < 2) return false
  if (KEYWORD_STOPWORDS.has(token)) return false
  if (KEYWORD_NOISE_RE.test(token)) return false
  if (VERB_FRAGMENT_RE.test(token)) return false
  return true
}

/** 구(句)의 앞머리에 붙은 동사 어절을 떼어낸다: '알고 기후변화' → '기후변화'. */
function stripLeadingVerbs(phrase: string): string {
  const parts = phrase.split(' ')
  let start = 0
  while (start < parts.length - 1 && VERB_FRAGMENT_RE.test(parts[start])) start += 1
  return parts.slice(start).join(' ')
}

/**
 * 키워드 목록을 비교 가능한 내용어 집합으로 만든다.
 * 키워드 전체와 공백으로 쪼갠 어절을 모두 후보로 넣어 '물의 상태' 와 '상태 변화'
 * 가 '상태' 로 만나게 한다.
 */
export function normalizeKeywordTerms(keywords: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const raw of keywords ?? []) {
    const normalized = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (!normalized) continue
    const phrase = stripLeadingVerbs(normalized)
    const candidates = [phrase, ...phrase.split(' ')]
    for (const candidate of candidates) {
      const term = stripParticle(candidate)
      if (isUsefulTerm(term)) out.add(term)
    }
  }
  return [...out]
}

/** 더 긴 공통어에 포함된 짧은 공통어는 중복이므로 버린다. 길이 내림차순 정렬. */
function dedupeNestedTerms(terms: readonly string[], cap: number): string[] {
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  const kept: string[] = []
  for (const term of sorted) {
    if (kept.some(existing => existing.includes(term))) continue
    kept.push(term)
    if (kept.length >= cap) break
  }
  return kept
}

/**
 * 두 성취기준의 공통 키워드(어간 기준). 완전 일치와 2자 이상 부분 문자열 포함을
 * 모두 인정하므로 '상태변화' 와 '상태' 도 '상태' 로 만난다.
 */
export function sharedKeywordTerms(
  a: readonly (string | null | undefined)[],
  b: readonly (string | null | undefined)[],
  cap = 6,
): string[] {
  const termsA = normalizeKeywordTerms(a)
  const termsB = normalizeKeywordTerms(b)
  if (termsA.length === 0 || termsB.length === 0) return []
  const setB = new Set(termsB)
  const shared: string[] = []
  for (const term of termsA) {
    if (setB.has(term)) {
      shared.push(term)
      continue
    }
    // 부분 문자열 포함 — 겹치는 쪽(짧은 어간)을 공통어로 삼는다.
    for (const other of termsB) {
      if (term.includes(other) && other.length >= 2) shared.push(other)
      else if (other.includes(term) && term.length >= 2) shared.push(term)
    }
  }
  return dedupeNestedTerms(shared, cap)
}

/**
 * 화면에 보여줄 대표 키워드. 기계 추출 잡음·기능어를 걸러내고 더 긴 말에 포함된
 * 짧은 어간을 접어 중복을 없앤다(에셋의 node.keywords, 호버 툴팁용).
 */
export function displayKeywords(keywords: readonly (string | null | undefined)[], cap = 8): string[] {
  return dedupeNestedTerms(normalizeKeywordTerms(keywords), cap)
}

/** 질의어 중 이 성취기준에 실제로 걸린 낱말. 키워드·본문 양쪽을 본다. */
export function matchedQueryTerms(
  query: string,
  keywords: readonly (string | null | undefined)[],
  text: string,
  cap = 6,
): string[] {
  const terms = normalizeKeywordTerms(query.split(/[\s,·]+/))
  if (terms.length === 0) return []
  const standardTerms = normalizeKeywordTerms(keywords)
  const haystack = (text ?? '').toLowerCase()
  const matched = terms.filter(term =>
    standardTerms.some(other => other === term || other.includes(term) || term.includes(other))
    || haystack.includes(term),
  )
  return dedupeNestedTerms(matched, cap)
}

/** 교과 간 링크의 근거를 한 줄로. 링크가 없으면 호출자가 '' 을 쓴다. */
export function formatLinkEvidence(link: {
  relation_edu?: string
  relation?: string
  method?: string
  weight?: number
  evidence?: {
    shared_keywords?: string[]
    shared_functions?: string[]
    shared_knowledge?: string[]
    similarity_score?: number
  }
}): string {
  const parts: string[] = []
  const relation = normalizeRelationType(link.relation_edu ?? link.relation)
  parts.push(relation)
  const evidence = link.evidence ?? {}
  const pushList = (label: string, items?: string[]) => {
    const cleaned = (items ?? []).map(item => item.trim()).filter(Boolean).slice(0, 4)
    if (cleaned.length > 0) parts.push(`${label} ${cleaned.join('·')}`)
  }
  pushList('공통 키워드', evidence.shared_keywords)
  pushList('공통 과정·기능', evidence.shared_functions)
  pushList('공통 지식', evidence.shared_knowledge)
  const weight = link.weight ?? evidence.similarity_score
  if (typeof weight === 'number' && Number.isFinite(weight)) {
    parts.push(`가중치 ${weight.toFixed(2)}`)
  }
  return parts.join(' · ')
}

export interface RelationReasonInput {
  linkEvidence: string
  sameCoreIdea: boolean
  sameArea: boolean
  coreIdeaArea: string
  sharedKeywords: readonly string[]
  sim: number
  /** Jev 관련도 0~1. 없으면 undefined. */
  jevScore?: number
}

/**
 * "왜 연결됐는가"를 한 줄로. 우선순위: 교차 링크 근거 → 같은 핵심아이디어/영역
 * → 공통 키워드 → 유사도만. 가장 강한 근거를 앞에 세우고 보조 근거를 덧붙이며,
 * 아무 근거가 없어도 유사도는 항상 있으므로 빈 문자열이 되지 않는다.
 */
export function buildRelationReason(input: RelationReasonInput): string {
  const parts: string[] = []
  if (input.linkEvidence) parts.push(`교육과정 연계 링크: ${input.linkEvidence}`)
  if (input.sameCoreIdea) parts.push(`같은 핵심아이디어(${input.coreIdeaArea || '동일 영역'})`)
  else if (input.sameArea) parts.push(`같은 영역(${input.coreIdeaArea || '동일 영역'})`)
  if (input.sharedKeywords.length > 0) parts.push(`공통 키워드: ${input.sharedKeywords.join(', ')}`)
  if (parts.length === 0) {
    const sim = `의미 유사도 ${input.sim.toFixed(2)}`
    parts.push(
      typeof input.jevScore === 'number'
        ? `${sim} (Jev 판정 ${levelForScore(input.jevScore)} ${input.jevScore.toFixed(2)})`
        : sim,
    )
  }
  return parts.join(' · ')
}

export interface SearchReasonInput {
  matchedTerms: readonly string[]
  sim: number
  jevScore?: number
}

/** 검색 결과의 근거. 걸린 질의어를 앞세우고 판정·유사도 수치를 덧붙인다. */
export function buildSearchReason(input: SearchReasonInput): string {
  const parts: string[] = []
  if (input.matchedTerms.length > 0) parts.push(`질의어 일치: ${input.matchedTerms.join(', ')}`)
  parts.push(
    typeof input.jevScore === 'number'
      ? `Jev 판정 ${levelForScore(input.jevScore)} ${input.jevScore.toFixed(2)} · 의미 유사도 ${input.sim.toFixed(2)}`
      : `의미 유사도 ${input.sim.toFixed(2)}`,
  )
  return parts.join(' · ')
}

// ─── 순수 헬퍼: 반지름 · 충돌 해소 · 맞춤 ───────────────────────────────────

/**
 * degree 순위를 0~1 로 정규화해 반지름을 준다: r = 8 + 18 · degreeNorm.
 *
 * 원 degree 가 아니라 순위를 쓴다. 차수 분포가 한쪽으로 몰려 있어(대부분 한 자리,
 * 소수가 20 이상) 원값을 그대로 정규화하면 허브 몇 개만 커지고 나머지가 전부
 * 최소 크기로 깔린다. 동점은 백분위 순위(같은 degree = 같은 반지름)로 묶어
 * 같은 차수의 노드가 이유 없이 다른 크기로 보이지 않게 한다.
 */
export function nodeRadii(nodes: readonly { id: string; degree: number }[]): Map<string, number> {
  const radii = new Map<string, number>()
  const n = nodes.length
  if (n === 0) return radii
  if (n === 1) {
    radii.set(nodes[0].id, round1(NODE_MIN_RADIUS + NODE_RADIUS_RANGE / 2))
    return radii
  }
  // degree → (더 작은 노드 수, 같은 노드 수)
  const sorted = [...nodes].map(node => node.degree).sort((a, b) => a - b)
  const lessThan = new Map<number, number>()
  const equalTo = new Map<number, number>()
  for (let i = 0; i < sorted.length; i++) {
    const degree = sorted[i]
    if (!lessThan.has(degree)) lessThan.set(degree, i)
    equalTo.set(degree, (equalTo.get(degree) ?? 0) + 1)
  }
  for (const node of nodes) {
    const less = lessThan.get(node.degree) ?? 0
    const equal = equalTo.get(node.degree) ?? 1
    // 백분위 순위: 동점 구간의 중앙을 쓴다.
    const degreeNorm = clamp01((less + (equal - 1) / 2) / (n - 1))
    radii.set(node.id, round1(NODE_MIN_RADIUS + NODE_RADIUS_RANGE * degreeNorm))
  }
  return radii
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 평균 최근접거리. 벌림 배율을 정할 때와 리포트에 쓴다. */
export function meanNearestNeighbourDistance(points: readonly Point[]): number {
  const n = points.length
  if (n < 2) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    let best = Infinity
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      if (d < best) best = d
    }
    sum += best
  }
  return sum / n
}

export interface OverlapReport {
  /** dist < r_i + r_j + minGap 인 쌍의 수. 0 이어야 한다. */
  violations: number
  /** 가장 좁은 (dist − r_i − r_j). 음수면 원이 겹친 것. */
  minGap: number
}

/** 겹침 검사. O(n²) 지만 627노드 빌드에서 수십 ms 다. */
export function inspectOverlaps(
  points: readonly Point[],
  radii: readonly number[],
  minGap: number = MIN_NODE_GAP,
): OverlapReport {
  let violations = 0
  let worst = Infinity
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      const gap = d - radii[i] - radii[j]
      if (gap < worst) worst = gap
      // 부동소수 오차로 경계에서 위반 판정되지 않게 아주 작은 허용치를 둔다.
      if (gap < minGap - 1e-6) violations += 1
    }
  }
  return { violations, minGap: Number.isFinite(worst) ? worst : Infinity }
}

export interface CollisionResult {
  points: Point[]
  /** 실제로 돈 패스 수. */
  passes: number
  /** 남은 위반 쌍 수. */
  violations: number
}

/**
 * 겹친 노드를 서로 밀어내 dist ≥ r_i + r_j + minGap 을 만든다.
 *
 * 공간 격자(cell = 최대 필요거리)로 3×3 이웃만 검사하므로 패스당 O(n)에 가깝다.
 * Jacobi 방식(변위를 모아 한 번에 적용)이라 순회 순서와 무관하게 결정적이다.
 * 변위는 접촉 평균이 아니라 감쇠(damping)를 곱한 합을 쓴다 — 덩어리 중심처럼
 * 접촉이 10개씩 걸리는 노드를 평균으로 밀면 필요량의 1/10 만 움직여 120패스로도
 * 수렴하지 않았다. 위반이 0 이 되면 즉시 멈춘다.
 */
export function resolveCollisions(
  points: readonly Point[],
  radii: readonly number[],
  options: { minGap?: number; maxPasses?: number; damping?: number } = {},
): CollisionResult {
  const minGap = options.minGap ?? MIN_NODE_GAP
  const maxPasses = options.maxPasses ?? 120
  // 감쇠 1.0(필요량 전부 이동)이 실측에서 가장 빨랐다. 627노드 scale 1.6 에서
  // 0.5 는 400패스, 1.0 은 같은 품질에 159ms·잔여 진동 없음.
  const damping = options.damping ?? 1
  const n = points.length
  const xs = Float64Array.from(points.map(p => p.x))
  const ys = Float64Array.from(points.map(p => p.y))
  if (n < 2) {
    return { points: points.map(p => ({ ...p })), passes: 0, violations: 0 }
  }

  const maxRadius = radii.reduce((max, r) => (r > max ? r : max), 0)
  const cellSize = Math.max(1, 2 * maxRadius + minGap)
  const dxs = new Float64Array(n)
  const dys = new Float64Array(n)
  const contacts = new Int32Array(n)
  const grid = new Map<string, number[]>()

  let passes = 0
  let violations = 0
  for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1
    dxs.fill(0)
    dys.fill(0)
    contacts.fill(0)
    grid.clear()
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(xs[i] / cellSize)},${Math.floor(ys[i] / cellSize)}`
      const bucket = grid.get(key)
      if (bucket) bucket.push(i)
      else grid.set(key, [i])
    }

    violations = 0
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(xs[i] / cellSize)
      const cy = Math.floor(ys[i] / cellSize)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(`${cx + ox},${cy + oy}`)
          if (!bucket) continue
          for (const j of bucket) {
            if (j <= i) continue // 각 쌍 한 번만
            const required = radii[i] + radii[j] + minGap
            let dx = xs[j] - xs[i]
            let dy = ys[j] - ys[i]
            let d = Math.hypot(dx, dy)
            if (d >= required - 1e-9) continue
            violations += 1
            if (d < 1e-9) {
              // 완전히 겹친 쌍은 인덱스로 결정적인 방향을 준다.
              const angle = ((i * 31 + j * 17) % 360) * (Math.PI / 180)
              dx = Math.cos(angle)
              dy = Math.sin(angle)
              d = 1
            }
            const push = (required - d) / 2
            const ux = dx / d
            const uy = dy / d
            dxs[i] -= ux * push
            dys[i] -= uy * push
            dxs[j] += ux * push
            dys[j] += uy * push
            contacts[i] += 1
            contacts[j] += 1
          }
        }
      }
    }
    if (violations === 0) break
    for (let i = 0; i < n; i++) {
      if (contacts[i] === 0) continue
      xs[i] += dxs[i] * damping
      ys[i] += dys[i] * damping
    }
  }

  return {
    points: Array.from({ length: n }, (_, i) => ({ x: xs[i], y: ys[i] })),
    passes,
    violations,
  }
}

export interface FitResult {
  points: Point[]
  /** 최종 정사각형 한 변(월드 단위). size 보다 커질 수 있다. */
  extent: number
  /** 적용된 배율. 1 미만으로는 절대 줄이지 않는다. */
  scale: number
}

/**
 * 0..size 정사각형에 맞춘다. 단 축소는 하지 않는다.
 *
 * 축소 정규화(scale < 1)는 충돌 해소로 벌려 놓은 간격을 그대로 되돌려 겹침을
 * 되살린다. 그래서 들어가지 않을 때는 줄이는 대신 정사각형을 키운다
 * (프론트엔드가 bounds 에 맞춰 보므로 extent 가 2000 을 넘어도 된다).
 * 확대(scale > 1)는 간격을 늘리기만 하므로 안전하다.
 */
export function fitToSquare(
  points: readonly Point[],
  options: { size?: number; margin?: number } = {},
): FitResult {
  const size = options.size ?? LAYOUT_SIZE
  const margin = options.margin ?? LAYOUT_MARGIN
  if (points.length === 0) return { points: [], extent: size, scale: 1 }
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
  const inner = Math.max(1, size - margin * 2)
  if (!Number.isFinite(span) || span <= 0) {
    return { points: points.map(() => ({ x: size / 2, y: size / 2 })), extent: size, scale: 1 }
  }
  const scale = Math.max(1, inner / span)
  const scaledSpan = span * scale
  const extent = Math.max(size, scaledSpan + margin * 2)
  const offsetX = (extent - spanX * scale) / 2
  const offsetY = (extent - spanY * scale) / 2
  return {
    points: points.map(p => ({
      x: round1((p.x - minX) * scale + offsetX),
      y: round1((p.y - minY) * scale + offsetY),
    })),
    extent: round1(extent),
    scale,
  }
}

// ─── 순수 헬퍼: 전체 배치 파이프라인 ───────────────────────────────────────

export interface MapLayoutNode {
  id: string
  subjectId: string
  degree: number
}

export interface MapLayoutStats {
  extent: number
  scale: number
  /** 벌림 배율 × 확대 재시도 배율. */
  spreadScale: number
  /** 충돌 수렴을 위해 추가로 확대한 횟수. */
  growthAttempts: number
  meanRadius: number
  meanNearestNeighbour: number
  minGap: number
  violations: number
  collisionPasses: number
  forceMs: number
  collisionMs: number
}

export interface MapLayoutResult {
  positions: Map<string, Point>
  radii: Map<string, number>
  stats: MapLayoutStats
}

/**
 * 스프링·반발·교과 응집 시뮬레이션 → 반지름 기준 벌림 → 충돌 해소 → 정사각형 맞춤.
 *
 * 1단계는 0..size 로 정규화된 좌표를 쓴다. 시뮬레이션 원좌표의 자연 축척은
 * 입력 규모에 따라 달라지고(627노드에서 한 변 약 17000) 반지름은 월드 단위
 * 고정값이라, 정규화된 기준 축척 위에서만 "반지름의 3배" 같은 목표가 뜻을 갖는다.
 *
 * 벌림 단계가 있어야 충돌 해소가 "겨우 안 겹치는" 빽빽한 그림을 만들지 않는다.
 * 평균 최근접거리를 평균 반지름의 TARGET_NN_RADIUS_FACTOR 배로 올려놓고 밀어낸다.
 * 벌림·충돌 이후에는 절대 축소하지 않는다(fitToSquare 가 정사각형을 키운다).
 */
export function layoutCurriculumMap(
  nodes: readonly MapLayoutNode[],
  edges: readonly LayoutEdgeInput[],
  options: LayoutOptions & { minGap?: number; maxCollisionPasses?: number; targetNnFactor?: number } = {},
): MapLayoutResult {
  const size = options.size ?? LAYOUT_SIZE
  const margin = options.margin ?? LAYOUT_MARGIN
  const minGap = options.minGap ?? MIN_NODE_GAP
  const targetNnFactor = options.targetNnFactor ?? TARGET_NN_RADIUS_FACTOR

  const radii = nodeRadii(nodes)
  const radiusList = nodes.map(node => radii.get(node.id) ?? NODE_MIN_RADIUS)
  const meanRadius = radiusList.length === 0
    ? 0
    : radiusList.reduce((sum, r) => sum + r, 0) / radiusList.length

  // 1. 힘 기반 시뮬레이션 (0..size 기준 축척으로 정규화된 좌표)
  const forceStartedAt = performance.now()
  const simulated = runForceLayout(nodes, edges, options)
  const forceMs = Math.round(performance.now() - forceStartedAt)
  let points = nodes.map(node => simulated.get(node.id) ?? { x: 0, y: 0 })

  // 2. 평균 최근접거리를 목표치까지 균일 확대 (겹침만 줄어든다)
  const targetNn = meanRadius * targetNnFactor
  const currentNn = meanNearestNeighbourDistance(points)
  const spreadScale = currentNn > 0 ? Math.max(1, targetNn / currentNn) : 1
  if (spreadScale > 1) {
    points = points.map(p => ({ x: p.x * spreadScale, y: p.y * spreadScale }))
  }

  // 3~4. 충돌 해소 → 정사각형 맞춤 → 검증. 계약(겹침 0)을 못 맞추면 전체를
  // 균일 확대해 밀도를 낮추고 다시 시도한다.
  //
  // 지역적 밀어내기만으로는 덩어리 중심의 밀도가 기하학적으로 불가능할 때
  // 두더지잡기가 된다(벌림 없이 시작하면 400패스 후에도 800쌍 잔존). 균일 확대는
  // 상대 구조·교과 응집을 그대로 두고 밀도만 낮추므로 반드시 수렴하며,
  // 시드가 같으면 확대 횟수까지 같아 결정적이다.
  //
  // 검증은 반드시 "최종 출력"(맞춤·반올림까지 끝난 좌표)에 대고 계약 간격으로 한다.
  // 밀어내기 단계의 자체 카운터는 안전 여유를 포함한 더 엄한 기준이라 그대로 쓰면
  // 계약을 이미 만족한 배치를 불필요하게 확대한다.
  const collisionStartedAt = performance.now()
  let growthScale = 1
  let collided = resolveCollisions(points, radiusList, {
    minGap: minGap + COLLISION_SAFETY_GAP,
    maxPasses: options.maxCollisionPasses,
  })
  let fitted = fitToSquare(collided.points, { size, margin })
  let overlaps = inspectOverlaps(fitted.points, radiusList, minGap)
  for (let attempt = 0; attempt < MAX_LAYOUT_GROWTH_ATTEMPTS && overlaps.violations > 0; attempt++) {
    growthScale *= LAYOUT_GROWTH_STEP
    const grown = points.map(p => ({ x: p.x * growthScale, y: p.y * growthScale }))
    collided = resolveCollisions(grown, radiusList, {
      minGap: minGap + COLLISION_SAFETY_GAP,
      maxPasses: options.maxCollisionPasses,
    })
    fitted = fitToSquare(collided.points, { size, margin })
    overlaps = inspectOverlaps(fitted.points, radiusList, minGap)
  }
  const collisionMs = Math.round(performance.now() - collisionStartedAt)

  const positions = new Map<string, Point>()
  nodes.forEach((node, i) => positions.set(node.id, fitted.points[i]))

  return {
    positions,
    radii,
    stats: {
      extent: fitted.extent,
      scale: fitted.scale,
      spreadScale: Math.round(spreadScale * growthScale * 1000) / 1000,
      growthAttempts: Math.round(Math.log(growthScale) / Math.log(LAYOUT_GROWTH_STEP)),
      meanRadius: round1(meanRadius),
      meanNearestNeighbour: round1(meanNearestNeighbourDistance(fitted.points)),
      minGap: round1(overlaps.minGap),
      violations: overlaps.violations,
      collisionPasses: collided.passes,
      forceMs,
      collisionMs,
    },
  }
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

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
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'
import { generationParams, isReasoningModel, resolveOpenAIModel } from '@/lib/llm/openai'
import { jevJudgeEnabled, judgeTopicRelevance } from '@/lib/curriculum/jevJudge'
import { SUBJECT_COLORS, SUBJECT_NAMES } from '@/components/knowledge-graph/constants'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType } from '@/lib/knowledge-graph/domain'
import {
  CANONICAL_GRADE_BANDS,
  filterContentItemsByGrade,
  toCanonicalGradeBand,
} from '@/lib/curriculum/curriculumFilters'
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

/**
 * 노드 반지름(월드 단위) — 모든 성취기준이 같은 크기다.
 *
 * 2026-09-23 교사 피드백: "성취기준 원의 크기가 다른데 그럴 필요가 없다".
 * 예전에는 8 + 18 · 연결 차수 순위였는데, 차수는 "비슷한 성취기준이 많다"는 뜻일 뿐
 * 중요도가 아니다. 크기가 다르면 큰 원을 핵심 성취기준으로 오독하므로 통일했다.
 */
export const NODE_RADIUS = 12

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
        ? `${sim} (AI 판정 ${levelForScore(input.jevScore)} ${input.jevScore.toFixed(2)})`
        : sim,
    )
  }
  return parts.join(' · ')
}

export interface SearchReasonInput {
  matchedTerms: readonly string[]
  sim: number
  jevScore?: number
  /** 이 성취기준을 끌어올린 확장어(짧은 질의 확장 시). */
  matchedExpansion?: string
  /** 글자 그대로 걸린 자리와 토큰. */
  keywordHit?: KeywordHit | null
}

/** Jev 우선 정렬의 동점 허용폭 — 이 안에서는 임베딩 유사도로 가른다. */
export const JEV_TIE_BREAK_EPSILON = 0.02

/**
 * Jev 점수 우선 비교자. 차이가 JEV_TIE_BREAK_EPSILON 이내면 동점으로 보고
 * 임베딩 유사도로 가른다(Jev 는 0.1 단위로 뭉치는 경향이 있어 동점이 흔하다).
 */
export function compareJevFirst(
  a: { score: number; sim: number; id: string },
  b: { score: number; sim: number; id: string },
): number {
  if (Math.abs(a.score - b.score) > JEV_TIE_BREAK_EPSILON) return b.score - a.score
  if (b.sim !== a.sim) return b.sim - a.sim
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 검색 결과의 근거. 걸린 질의어·확장어를 앞세우고 판정·유사도 수치를 덧붙인다. */
export function buildSearchReason(input: SearchReasonInput): string {
  const parts: string[] = []
  const hit = input.keywordHit
  if (hit && hit.terms.length > 0) {
    parts.push(`${hit.fields[0]}에 '${hit.terms.join("', '")}' 포함`)
  } else if (input.matchedTerms.length > 0) {
    parts.push(`질의어 일치: ${input.matchedTerms.join(', ')}`)
  }
  if (input.matchedExpansion) parts.push(`확장어 '${input.matchedExpansion}' 로 연결`)
  parts.push(
    typeof input.jevScore === 'number'
      ? `AI 판정 ${levelForScore(input.jevScore)} ${input.jevScore.toFixed(2)} · 의미 유사도 ${input.sim.toFixed(2)}`
      : `의미 유사도 ${input.sim.toFixed(2)}`,
  )
  return parts.join(' · ')
}

// ─── 순수 헬퍼: 성취수준(A·B·C) ─────────────────────────────────────────────

/**
 * 성취기준 하나의 공식 성취수준 원문. 출처는 교육부·한국교육과정평가원
 * 「2022 개정 교육과정에 따른 성취수준」(초등 3권, scripts/extract-achievement-levels.mjs).
 * 빌더가 public/curriculum_map.json 노드마다 실어 두고, 서버·화면이 같은 값을 읽는다.
 */
export interface StandardLevels {
  A: string
  B: string
  C: string
  /** 원문에 A·B·C 글자가 없어 서술 순서로 배정한 경우 */
  inferred?: boolean
}

export const ACHIEVEMENT_LEVEL_KEYS = ['A', 'B', 'C'] as const
export type AchievementLevelKey = (typeof ACHIEVEMENT_LEVEL_KEYS)[number]

/** '4사01-01' · '[4사01-01]' → '[4사01-01]' (성취수준 파일의 키 형식). */
export function achievementLevelCodeKey(code: string): string {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('[') ? trimmed : `[${trimmed}]`
}

/**
 * 성취수준 파일에서 코드 하나의 수준을 꺼낸다. 매칭은 코드로만 한다 — 교과명·영역명은
 * 문서마다 달라 신뢰하지 않는다. A·B·C 중 하나라도 비면 null(반쪽 수준은 보여 주지 않는다).
 */
export function pickStandardLevels(
  standards: Record<string, Partial<StandardLevels> | undefined>,
  code: string,
): StandardLevels | null {
  const entry = standards[achievementLevelCodeKey(code)]
  if (!entry) return null
  const A = (entry.A ?? '').trim()
  const B = (entry.B ?? '').trim()
  const C = (entry.C ?? '').trim()
  if (!A || !B || !C) return null
  return entry.inferred ? { A, B, C, inferred: true } : { A, B, C }
}

// 수준 연계 라벨("A 수준에서 연계" 등)은 두 번 시험하고 뺐다(2026-09-23 실측).
//  - A·B·C·none 중 하나를 고르게 하면 중심 6개 중 4개에서 관련 10개가 전부 'B'.
//  - 수준별 Score 세 번으로 바꾸면 A·B·C 점수가 쌍마다 함께 움직였다(예: 0.88/0.90/0.82).
// A·B·C 원문은 "정확하게"·"부분적으로" 같은 정도 표현만 달라 수준별 판정이 쌍의 전체
// 관련도를 되풀이할 뿐이다. 그래서 수준은 관계 판정의 근거로만 넘기고(standardBlock),
// 화면에는 두 성취기준의 원문을 나란히 보여 교사가 직접 비교하게 한다.

// ─── 순수 헬퍼: v2 임베딩 문서 ──────────────────────────────────────────────

/** v2 문서에 넣는 내용체계 요소 상한. */
export const DOC_KNOWLEDGE_LIMIT = 8
export const DOC_FUNCTION_LIMIT = 6
export const DOC_KEYWORD_LIMIT = 8

const BAND_PREFIX_STRIP_RE = /^\d+-\d+학년군:\s*/

/** '3-4학년군: 무게' → '무게'. 문서에는 학년군을 머리글에 한 번만 쓴다. */
function stripBandPrefix(item: string): string {
  return item.replace(BAND_PREFIX_STRIP_RE, '').trim()
}

function pickBandItems(items: readonly string[] | undefined, band: string, limit: number): string[] {
  const filtered = filterContentItemsByGrade([...(items ?? [])], band)
  const out: string[] = []
  for (const item of filtered) {
    const cleaned = stripBandPrefix(item)
    if (cleaned && !out.includes(cleaned)) out.push(cleaned)
    if (out.length >= limit) break
  }
  return out
}

export interface StandardDocumentInput {
  subject: string
  area: string
  band: string
  coreIdea: string
  code: string
  text: string
  /** 내용체계 원문(학년군 접두사 포함). 해당 학년군만 골라 쓴다. */
  knowledge?: readonly string[]
  functions?: readonly string[]
  /** 그래프 원본 키워드. 잡음을 걸러 쓴다. */
  keywords?: readonly string[]
  /** 공식 성취수준. 문서에는 A 원문만 넣는다(아래 buildStandardDocument 참고). */
  levels?: StandardLevels | null
}

/**
 * 성취기준 하나를 "수업 설계용 문서"로 펼친다(v2 임베딩 입력).
 *
 * 왜: v1 은 성취기준 문장만 임베딩했다. 문장에 없는 낱말로 찾으면('이슬' 은
 * [6과06-02] 문장에 있지만 '응결'·'물의 순환' 은 없다) 코사인이 거의 무의미해져
 * 교과 무관 성취기준과 점수 차가 사라졌다. 교과·영역·학년군·핵심아이디어·
 * 내용체계 요소·키워드를 함께 넣으면 같은 주제 영역의 성취기준이 뭉치고
 * 교과가 다른 것과는 벌어진다.
 *
 * 순서·상한이 고정이라 같은 입력이면 항상 같은 문서가 나온다(재빌드 결정성).
 */
export function buildStandardDocument(input: StandardDocumentInput): string {
  const lines: string[] = []
  const header = [
    input.subject ? `교과 ${input.subject}` : '',
    input.area ? `영역 ${input.area}` : '',
    input.band ? `학년군 ${input.band}` : '',
  ].filter(Boolean).join(' · ')
  if (header) lines.push(header)
  if (input.coreIdea) lines.push(`핵심아이디어: ${input.coreIdea.replace(/\s+/g, ' ').trim()}`)
  const code = input.code ? `${input.code} ` : ''
  if (input.text) lines.push(`성취기준: ${code}${input.text.replace(/\s+/g, ' ').trim()}`)

  const knowledge = pickBandItems(input.knowledge, input.band, DOC_KNOWLEDGE_LIMIT)
  if (knowledge.length > 0) lines.push(`지식·이해: ${knowledge.join(', ')}`)
  const functions = pickBandItems(input.functions, input.band, DOC_FUNCTION_LIMIT)
  if (functions.length > 0) lines.push(`과정·기능: ${functions.join(', ')}`)
  const keywords = displayKeywords(input.keywords ?? [], DOC_KEYWORD_LIMIT)
  if (keywords.length > 0) lines.push(`키워드: ${keywords.join(', ')}`)
  // 성취수준은 A 원문 하나만 넣는다. B·C 는 A 와 같은 내용어에 정도 부사
  // ("부분적으로", "도움을 받아")만 바뀐 문장이라 세 개를 다 넣으면 문서가 길어져
  // 짧은 질의 신호만 희석된다. 수준 낱말의 글자 일치는 keywordHit 이 A·B·C 전부 본다.
  const levelA = input.levels?.A?.replace(/\s+/g, ' ').trim()
  if (levelA) lines.push(`성취수준 A: ${levelA}`)

  return lines.join('\n')
}

// ─── 순수 헬퍼: 짧은 질의 확장 판정 ────────────────────────────────────────

/** 이보다 짧거나 어절이 이 수 이하면 확장 대상. */
export const SHORT_QUERY_MAX_CHARS = 8
export const SHORT_QUERY_MAX_TOKENS = 2
export const QUERY_EXPANSION_LIMIT = 6

/**
 * '이슬' 처럼 짧은 질의는 임베딩 신호가 약해 교과 무관 성취기준과 점수 차가
 * 거의 없다. 이런 질의만 교육과정 낱말로 확장한다(긴 주제문은 이미 충분하다).
 */
export function isShortQuery(query: string): boolean {
  const normalized = (query ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  const tokens = normalized.split(' ').filter(Boolean)
  return normalized.replace(/\s/g, '').length < SHORT_QUERY_MAX_CHARS
    || tokens.length <= SHORT_QUERY_MAX_TOKENS
}

/**
 * 확장어 정리: 원 질의와 같은 말·중복·빈 문자열을 버리고 상한까지 자른다.
 * 모델이 문장이나 설명을 돌려줄 때를 대비해 낱말 길이도 제한한다.
 */
export function sanitizeExpansionTerms(
  terms: readonly unknown[],
  query: string,
  limit = QUERY_EXPANSION_LIMIT,
): string[] {
  const seen = new Set([query.replace(/\s+/g, ' ').trim().toLowerCase()])
  const out: string[] = []
  for (const raw of terms ?? []) {
    if (typeof raw !== 'string') continue
    const term = raw.replace(/\s+/g, ' ').trim()
    if (!term || term.length > 20) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
    if (out.length >= limit) break
  }
  return out
}

/**
 * 확장 질의의 유사도: 원 질의와 확장어를 "각각" 임베딩해 최댓값을 쓴다.
 *
 * 실측(2026-09-21, "이슬" + 응결·수증기·물의 상태 변화·날씨·기온 변화·구름):
 *  - 한 문장으로 합쳐 임베딩(blob): 상위 10에 영어 3건이 3~5위로 올라옴. 확장어가
 *    평균되어 질의의 방향이 흐려진다.
 *  - 0.6·질의 + 0.4·확장어최대: 영어·수학이 7위 이내로 올라옴.
 *  - 각각 임베딩 후 최댓값: 상위 10이 전부 과학·통합교과, 물의 상태 변화
 *    성취기준([4과10-01/02/03])이 상위로 올라옴. → 이 방식을 채택.
 *
 * 최댓값을 만든 낱말도 함께 돌려주어 근거(reason)에 적는다.
 */
export function expandedQuerySimilarity(
  standardVector: readonly number[],
  queryVector: readonly number[],
  expansionVectors: readonly { term: string; vector: readonly number[] }[],
): { sim: number; matchedTerm?: string } {
  let best = cosineSim(queryVector, standardVector)
  let matchedTerm: string | undefined
  for (const expansion of expansionVectors) {
    const sim = cosineSim(expansion.vector, standardVector)
    if (sim > best) {
      best = sim
      matchedTerm = expansion.term
    }
  }
  return { sim: clamp01(best), ...(matchedTerm ? { matchedTerm } : {}) }
}

/** 후보 하한의 절대 최솟값과 최고점 대비 비율. */
export const SIM_FLOOR_ABSOLUTE = 0.22
export const SIM_FLOOR_RATIO = 0.45

/**
 * 후보 풀에 넣을 최소 유사도.
 *
 * 왜: "이슬" 검색에서 정답은 0.468, 그 다음이 0.200(영어·음악)이었다. 상위 40 을
 * 그냥 자르면 0.2 대 잡음이 목록을 채운다(Jev 는 전부 약함으로 맞게 판정했지만
 * 자리를 차지한다). 절대 하한만 쓰면 점수대가 낮은 질의에서 전부 걸러지고, 비율만
 * 쓰면 점수대가 높은 질의에서 너무 많이 남아 둘을 함께 쓴다.
 * 실측 통과 건수 — 이슬 1건, 분수의 덧셈 67건, 우리 마을의 물과 환경 50건, 기후변화 40건.
 */
export function similarityFloor(topSim: number): number {
  return Math.max(SIM_FLOOR_ABSOLUTE, clamp01(topSim) * SIM_FLOOR_RATIO)
}

// ─── 순수 헬퍼: 키워드 적중 보장 · 후보 병합 · 학년군 균형 ──────────────────

/** 검색 토큰의 최소 길이. 1자 토큰은 아무 성취기준에나 걸린다. */
export const SEARCH_TOKEN_MIN_CHARS = 2

/**
 * 키워드 적중 검사에 쓸 토큰. normalizeKeywordTerms 와 달리 불용어를 지우지
 * 않는다 — 사용자가 '이용' 을 찾았다면 그 낱말이 든 성취기준을 보여줘야 한다.
 * 조사만 떼고 2자 이상만 남긴다.
 */
export function searchTokens(query: string, expansions: readonly string[] = []): string[] {
  const out: string[] = []
  const push = (raw: string) => {
    const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!normalized) return
    for (const candidate of [normalized, ...normalized.split(' ')]) {
      const token = stripParticle(candidate)
      if (token.length >= SEARCH_TOKEN_MIN_CHARS && !out.includes(token)) out.push(token)
    }
  }
  push(query)
  for (const expansion of expansions) push(expansion)
  return out
}

/**
 * 질의 속 성취기준 코드. 대괄호·띄어쓰기가 빠져도('6사12-02', '6사 12-02') 같은 코드로 보고
 * 항상 '[6사12-02]' 형태로 돌려준다. rest 는 코드를 뺀 나머지 질의다.
 *
 * 왜: 검색은 의미(임베딩)로만 순위를 매겨 '[6사12-02]' 는 우연히 맞고 '6사12-02' 는
 * 수학 성취기준이 먼저 나왔다(2026-10-09 교사 피드백). 코드는 글자 그대로 찾아야 한다.
 */
const QUERY_CODE_RE = /\[?\s*(\d)\s*([가-힣]{1,3})\s*(\d{2})\s*[-–‐]\s*(\d{2})\s*\]?/g

export function parseCodeQuery(query: string): { codes: string[]; rest: string } {
  const codes: string[] = []
  const rest = query.replace(QUERY_CODE_RE, (_match, grade: string, subject: string, unit: string, item: string) => {
    const code = `[${grade}${subject}${unit}-${item}]`
    if (!codes.includes(code)) codes.push(code)
    return ' '
  })
  return { codes, rest: rest.replace(/[\s,·、;/]+/g, ' ').trim() }
}

/** 코드가 정확히 같은 성취기준(대괄호 유무 무시), 질의에 적은 순서대로. */
export function findStandardsByCode<T extends { code: string }>(standards: readonly T[], codes: readonly string[]): T[] {
  const bare = (code: string) => code.replace(/[\[\]\s]/g, '')
  const out: T[] = []
  for (const code of codes) {
    const match = standards.find(std => bare(std.code) === bare(code))
    if (match && !out.includes(match)) out.push(match)
  }
  return out
}

export interface KeywordHit {
  /** 실제로 걸린 토큰. */
  terms: string[]
  /** 걸린 자리: '성취기준 문장' | '키워드' | '영역' | '핵심아이디어' | '성취수준'. */
  fields: string[]
}

const HIT_FIELD_LABELS = {
  text: '성취기준 문장',
  keywords: '키워드',
  area: '영역',
  coreIdea: '핵심아이디어',
  levels: '성취수준',
} as const

/**
 * 성취기준이 질의 토큰을 "글자로" 포함하는지. 임베딩이 놓치더라도 이 경로로
 * 반드시 후보에 들어간다('이슬' → [6과06-02] 은 문장에 그 글자가 있다).
 */
export function keywordHit(
  standard: { text?: string; keywords?: readonly string[]; area?: string },
  coreIdea: string,
  tokens: readonly string[],
  levels?: StandardLevels | null,
): KeywordHit | null {
  if (tokens.length === 0) return null
  const haystacks: Array<[keyof typeof HIT_FIELD_LABELS, string]> = [
    ['text', (standard.text ?? '').toLowerCase()],
    ['keywords', (standard.keywords ?? []).join(' ').toLowerCase()],
    ['area', (standard.area ?? '').toLowerCase()],
    ['coreIdea', (coreIdea ?? '').toLowerCase()],
    // 성취수준은 마지막 — 같은 토큰이 문장에도 있으면 '성취기준 문장' 이 근거로 앞선다.
    ['levels', levels ? `${levels.A} ${levels.B} ${levels.C}`.toLowerCase() : ''],
  ]
  const terms: string[] = []
  const fields: string[] = []
  for (const token of tokens) {
    for (const [field, haystack] of haystacks) {
      if (!haystack || !haystack.includes(token)) continue
      if (!terms.includes(token)) terms.push(token)
      const label = HIT_FIELD_LABELS[field]
      if (!fields.includes(label)) fields.push(label)
    }
  }
  return terms.length > 0 ? { terms, fields } : null
}

export type SearchCandidateSource = 'keyword' | 'embedding' | 'both'

export interface PoolEntry {
  id: string
  source: SearchCandidateSource
}

/**
 * 후보 풀 병합. 키워드 적중은 절대 버리지 않고, 남는 자리를 임베딩 순서대로
 * 채운다. 상한을 넘으면 임베딩 전용 후보부터 잘린다.
 *
 * 왜: 임베딩 상위 N 만 쓰면 짧은 질의에서 정답이 N 밖으로 밀릴 수 있고, 반대로
 * 키워드만 쓰면 다른 낱말로 표현된 같은 주제를 놓친다. Jev 가 최종 순위를
 * 정하므로 풀은 재현율(recall) 쪽으로 넉넉히 잡는다.
 */
export function mergeSearchPool(params: {
  embeddingIds: readonly string[]
  keywordIds: readonly string[]
  cap: number
}): PoolEntry[] {
  const keyword = new Set(params.keywordIds)
  const embedding = new Set(params.embeddingIds)
  const cap = Math.max(0, params.cap)
  const out: PoolEntry[] = []
  const seen = new Set<string>()

  // 1) 키워드 적중 먼저 — 임베딩 전용 후보보다 항상 우선한다.
  //    흔한 토큰('환경')은 적중이 상한을 넘을 수 있어 상한 자체는 지키고,
  //    호출자가 유사도 내림차순으로 넘겨 준 순서 덕에 좋은 것부터 남는다.
  for (const id of params.keywordIds) {
    if (out.length >= cap) break
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, source: embedding.has(id) ? 'both' : 'keyword' })
  }
  // 2) 남는 자리를 임베딩 순서대로
  for (const id of params.embeddingIds) {
    if (out.length >= cap) break
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, source: keyword.has(id) ? 'both' : 'embedding' })
  }
  return out
}

/** 배열을 size 개씩 자른다(Jev fan-out 분할). */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [[...items]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─── 순수 헬퍼: 학년군 균형 ─────────────────────────────────────────────────

export const DEFAULT_PER_BAND = 4
export const MAX_PER_BAND = 8

export interface BandBalanceResult<T> {
  /** 학년군 → 관련 이상 항목(최대 perBand). */
  byBand: Record<string, T[]>
  /** 관련 항목이 하나도 없는 학년군. */
  emptyBands: string[]
  /** byBand 에 뽑힌 항목을 학년군 순서대로 펼친 것(중복 없음). */
  picks: T[]
}

/**
 * 학년군별로 고르게 뽑는다.
 *
 * 왜: 점수 순서만 쓰면 한 학년군(보통 1-2학년군 통합교과)이 목록을 독점해
 * 교사가 고른 다른 학년군이 화면에서 사라졌다. 학년군마다 상위 perBand 개를
 * 먼저 확보하고, 남는 자리를 전체 점수 순으로 채운다.
 */
export function balanceByBand<T extends { band: string }>(
  items: readonly T[],
  bands: readonly string[],
  perBand: number = DEFAULT_PER_BAND,
): BandBalanceResult<T> {
  // 0·음수·NaN 같은 잘못된 값은 1로 깎지 않고 기본값으로 되돌린다
  // (resolvePerBand 와 같은 규칙 — 호출 경로가 달라도 동작이 같아야 한다).
  const requested = Math.floor(perBand)
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_PER_BAND, requested)
    : DEFAULT_PER_BAND
  const byBand: Record<string, T[]> = {}
  const emptyBands: string[] = []
  const picks: T[] = []
  for (const band of bands) {
    const inBand = items.filter(item => item.band === band).slice(0, limit)
    byBand[band] = inBand
    if (inBand.length === 0) emptyBands.push(band)
    for (const item of inBand) if (!picks.includes(item)) picks.push(item)
  }
  return { byBand, emptyBands, picks }
}

/** 요청의 perBand 값을 1~8 로 정규화. */
export function resolvePerBand(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PER_BAND
  return Math.min(MAX_PER_BAND, n)
}

// ─── 순수 헬퍼: 반지름 · 충돌 해소 · 맞춤 ───────────────────────────────────

/**
 * 노드마다 반지름을 준다 — 전부 NODE_RADIUS(균일).
 *
 * 크기로 차수를 표현하지 않는다(NODE_RADIUS 머리말 참고). 연결 개수는 패널·툴팁에
 * 글자로 보여 준다. 반환형을 Map 으로 유지해 레이아웃·충돌 코드가 노드별 반지름을
 * 그대로 받는다.
 */
export function nodeRadii(nodes: readonly { id: string }[]): Map<string, number> {
  return new Map(nodes.map(node => [node.id, NODE_RADIUS]))
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
  const radiusList = nodes.map(node => radii.get(node.id) ?? NODE_RADIUS)
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

/** v2 문서 임베딩(public/embeddings_v2.json). 없으면 null. */
export interface StandardDocumentEmbeddings {
  model: string
  builtAt: string
  docs: Record<string, { vector: number[]; text: string }>
}

let _v2Embeddings: StandardDocumentEmbeddings | null | undefined

export function loadDocumentEmbeddings(): StandardDocumentEmbeddings | null {
  if (_v2Embeddings !== undefined) return _v2Embeddings
  // public/ 에 둔다 — data/** 는 Firebase 함수 번들에 들어가지 않는다
  // (scripts/sync-runtime-assets.mjs 머리말의 실측 기록).
  const candidate = path.join(process.cwd(), 'public/embeddings_v2.json')
  try {
    if (fs.existsSync(candidate)) {
      _v2Embeddings = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as StandardDocumentEmbeddings
      return _v2Embeddings
    }
  } catch (error) {
    console.error('[curriculum-map] embeddings_v2 load failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  _v2Embeddings = null
  return _v2Embeddings
}

let _levelsById: Map<string, StandardLevels> | undefined

/**
 * 성취기준 id → 공식 성취수준. 빌더가 public/curriculum_map.json 노드에 실어 둔 값을 읽는다
 * (화면과 서버가 같은 원문을 쓰게 하려고 별도 파일을 다시 읽지 않는다).
 * 파일이 없거나 깨지면 빈 Map — 수준 없이도 검색·관계 판정은 동작하지만 로그는 남긴다.
 */
export function loadStandardLevelsById(): Map<string, StandardLevels> {
  if (_levelsById) return _levelsById
  const file = path.join(process.cwd(), 'public/curriculum_map.json')
  const out = new Map<string, StandardLevels>()
  try {
    const asset = JSON.parse(fs.readFileSync(file, 'utf-8')) as { nodes?: Array<{ id: string; levels?: StandardLevels }> }
    for (const node of asset.nodes ?? []) {
      if (node.levels?.A && node.levels.B && node.levels.C) out.set(node.id, node.levels)
    }
  } catch (error) {
    console.error('[curriculum-map] achievement levels load failed', {
      file,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  _levelsById = out
  return out
}

export type EmbeddingSource = 'v1' | 'v2'

/**
 * 검색·관련에 쓸 임베딩 세트. 기본 v2(수업 설계 문서).
 *
 * 주의 — v2 는 "순위"가 아니라 "후보 수집"에 쓸 때만 낫다. 실측 마진
 * (정답 최고점 − 오답 최고점, 질의→성취기준 코사인만으로 순위를 매길 때):
 *   "이슬"        v1 0.271 → v2 0.029
 *   "분수의 덧셈"   v1 0.317 → v2 0.116
 * 문서가 길어(평균 385자) 짧은 질의 신호가 희석되기 때문이고, 과정·기능을 빼도
 * 회복되지 않았다(0.041 / 0.106). 즉 v2 코사인을 그대로 점수로 쓰면 안 된다.
 *
 * 지금 구조에서는 순위를 Jev 가 정하고 임베딩은 재현율만 담당하므로, 같은 교과·
 * 영역의 주제 이웃을 넓게 끌어오는 v2 의 성질이 오히려 맞다. 글자 적중 보장이
 * 정확한 낱말 일치를 따로 담보한다. CURRICULUM_EMBEDDINGS=v1 로 되돌릴 수 있다.
 */
export function embeddingSource(): EmbeddingSource {
  return process.env.CURRICULUM_EMBEDDINGS === 'v1' ? 'v1' : 'v2'
}

/** 활성 소스의 성취기준 벡터 표. v2 를 골랐는데 파일이 없으면 v1 으로 내려간다. */
let _v2VectorTable: Record<string, number[]> | null = null

export interface VectorTables {
  /** 후보를 모으는 데 쓰는 벡터(기본 v2). */
  poolSource: EmbeddingSource
  poolVectors: Record<string, number[]>
  /** 화면에 보이는 sim 과 동점 처리에 쓰는 벡터(항상 v1 우선). */
  displaySource: EmbeddingSource
  displayVectors: Record<string, number[]>
}

/**
 * 후보 수집용 벡터와 표시용 벡터를 갈라 준다.
 *
 * 왜: v2 는 같은 교과·영역 이웃을 0.93~0.96 로 뭉쳐 놓아 "의미 유사도" 로
 * 보여줄 수도, 동점을 가를 수도 없다(같은 영역이면 전부 같은 값). 반대로 v1 은
 * 순위 신호로는 짧은 질의에서 약하지만 값의 분포가 살아 있어 표시·동점 처리에
 * 맞다. 그래서 풀은 v2, 화면 숫자는 v1 으로 쓴다. v1 이 없으면 표시도 풀 벡터를
 * 쓰되 displaySource 로 그 사실을 알린다.
 */
export function resolveVectorTables(): VectorTables {
  const pool = resolveStandardVectors()
  const legacy = loadStandardEmbeddings()
  const hasLegacy = Object.keys(legacy).length > 0
  return {
    poolSource: pool.source,
    poolVectors: pool.vectors,
    displaySource: hasLegacy ? 'v1' : pool.source,
    displayVectors: hasLegacy ? legacy : pool.vectors,
  }
}

export function resolveStandardVectors(): { source: EmbeddingSource; vectors: Record<string, number[]> } {
  if (embeddingSource() === 'v2') {
    const v2 = loadDocumentEmbeddings()
    if (v2 && Object.keys(v2.docs).length > 0) {
      if (!_v2VectorTable) {
        const vectors: Record<string, number[]> = {}
        for (const [id, doc] of Object.entries(v2.docs)) vectors[id] = doc.vector
        _v2VectorTable = vectors
      }
      return { source: 'v2', vectors: _v2VectorTable }
    }
    console.error('[curriculum-map] embeddings_v2.json unavailable; falling back to v1 (run npm run build:curriculum-embeddings)')
  }
  return { source: 'v1', vectors: loadStandardEmbeddings() }
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

/**
 * 여러 문장을 한 번의 호출로 임베딩한다(질의 + 확장어). 개별 문장은 질의 캐시를
 * 공유하므로 재검색 때 호출이 사라진다. 실패 시 null.
 */
export async function embedTexts(texts: readonly string[]): Promise<number[][] | null> {
  const keys = texts.map(text => text.trim()).filter(Boolean)
  if (keys.length === 0) return []
  const missing = keys.filter(key => !_queryEmbeddingCache.has(key))
  if (missing.length > 0) {
    if (!process.env.OPENAI_API_KEY) return null
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const resp = await client.embeddings.create({ input: [...missing], model: 'text-embedding-3-small' })
      missing.forEach((key, index) => {
        const vector = resp.data[index]?.embedding
        if (!vector) return
        if (_queryEmbeddingCache.size >= QUERY_EMBEDDING_CACHE_MAX) {
          const oldest = _queryEmbeddingCache.keys().next().value
          if (oldest !== undefined) _queryEmbeddingCache.delete(oldest)
        }
        _queryEmbeddingCache.set(key, vector)
      })
    } catch (error) {
      console.error('[curriculum-map] batch embedding failed', {
        count: missing.length,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
  const out: number[][] = []
  for (const key of keys) {
    const vector = _queryEmbeddingCache.get(key)
    if (!vector) return null
    out.push(vector)
  }
  return out
}

// ─── 서버 전용: 짧은 질의 확장 ──────────────────────────────────────────────

const _expansionCache = new Map<string, string[]>()
const EXPANSION_CACHE_MAX = 200

const EXPANSION_SYSTEM_PROMPT = [
  '너는 2022 개정 초등 교육과정 검색 도우미다.',
  '사용자가 입력한 짧은 낱말과 같은 수업에서 함께 다뤄지는 초등 교육과정 낱말을 최대 6개 제시하라.',
  '교과서에 실제로 나오는 개념·현상·활동 낱말만 쓴다. 설명이나 문장, 중복, 입력과 같은 낱말은 넣지 않는다.',
  '출력은 JSON 하나: {"terms": ["낱말1", "낱말2"]}',
].join(' ')

/**
 * 확장에 쓸 모델.
 *
 * 확장은 낱말 6개를 뽑는 가벼운 일인데 OPENAI_UTILITY_MODEL 이 추론 모델이면
 * (현재 gpt-5.6-luna) 실측 1.6~3.1초로 검색 예산을 먹는다. 실측 비교:
 *   gpt-4o-mini 1136ms · gpt-4o 1530ms · gpt-5.6-luna 1645ms (모두 낱말 품질은 쓸 만)
 * 그래서 보조 모델이 추론 계열이면 비추론 최속 모델로 내려간다. 키워드 적중
 * 보장이 있어 확장은 재현율 보너스일 뿐이므로 품질보다 속도를 택했다.
 * CURRICULUM_EXPANSION_MODEL 로 덮어쓸 수 있다.
 */
export function expansionModel(): string {
  const override = process.env.CURRICULUM_EXPANSION_MODEL?.trim()
  if (override) return override
  const utility = resolveOpenAIModel('utility')
  return isReasoningModel(utility) ? 'gpt-4o-mini' : utility
}

/**
 * 짧은 질의를 교육과정 낱말로 확장한다(보조 모델 1회 호출).
 *
 * '이슬' 두 글자는 임베딩 신호가 약해 교과 무관 성취기준과 점수 차가 거의 없다.
 * 확장어를 각각 임베딩해 최댓값을 쓰면('응결', '물의 상태 변화') 같은 주제의
 * 성취기준까지 끌어올 수 있다(expandedQuerySimilarity 참고).
 * 실패·시한 초과 시 빈 배열 → 호출자는 원 질의만 쓴다.
 */
export async function expandShortQuery(query: string, deadlineMs = 1_200): Promise<string[]> {
  const key = (query ?? '').replace(/\s+/g, ' ').trim()
  if (!key) return []
  const cached = _expansionCache.get(key)
  if (cached) return cached
  if (!process.env.OPENAI_API_KEY) return []

  const model = expansionModel()
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  // race 에서 버려진 프라미스가 나중에 reject 해도 unhandled 가 되지 않게 미리 잡는다.
  // generationParams 는 모델 계열별 파라미터를 Record 로 돌려주므로 비스트리밍
  // 파라미터 타입으로 좁혀 준다(any 없이 SDK 오버로드를 고정).
  const body = {
    ...generationParams(model, { maxTokens: 200, temperature: 0, json: true, effort: 'fastest' }),
    messages: [
      { role: 'system', content: EXPANSION_SYSTEM_PROMPT },
      { role: 'user', content: key },
    ],
  } as ChatCompletionCreateParamsNonStreaming
  const request = client.chat.completions
    .create(body)
    .catch((error: unknown) => {
      console.error('[curriculum-map] query expansion failed', {
        query: key.slice(0, 40),
        model,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })

  // 시한을 넘겨 버려진 응답도 도착하면 캐시에 넣는다. 그러지 않으면 같은 질의를
  // 다시 검색할 때마다 매번 호출하고 매번 시한을 넘긴다(실측: 첫 호출 1.4초 초과
  // → 두 번째 호출에서야 우연히 통과). 늦게 온 결과는 다음 검색이 곧바로 쓴다.
  const cacheTerms = (terms: string[]) => {
    if (_expansionCache.size >= EXPANSION_CACHE_MAX) {
      const oldest = _expansionCache.keys().next().value
      if (oldest !== undefined) _expansionCache.delete(oldest)
    }
    _expansionCache.set(key, terms)
  }
  const parseTerms = (response: Awaited<typeof request>): string[] | null => {
    if (!response) return null
    try {
      const content = response.choices?.[0]?.message?.content ?? '{}'
      const parsed = JSON.parse(content) as { terms?: unknown }
      return sanitizeExpansionTerms(Array.isArray(parsed.terms) ? parsed.terms : [], key)
    } catch (error) {
      console.error('[curriculum-map] query expansion parse failed', {
        query: key.slice(0, 40),
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
  void request.then(late => {
    if (_expansionCache.has(key)) return
    const terms = parseTerms(late)
    if (terms && terms.length > 0) cacheTerms(terms)
  })

  const response = await withDeadline(request, deadlineMs, 'expand')
  const terms = parseTerms(response)
  if (!terms) return []
  cacheTerms(terms)
  return terms
}

// ─── 서버 전용: Jev 주제 관련도 (분할 병렬) ─────────────────────────────────

/** 한 번의 fan-out 에 넣는 질문 수. 30문항이 실측 0.6~0.7초였다. */
export const JEV_CHUNK_SIZE = 30

export interface ChunkedJudgement {
  scores: Record<string, number>
  /** 성공한 조각 수 / 전체 조각 수. */
  chunks: { ok: number; total: number }
  elapsedMs: number
}

/**
 * 후보 전체를 조각으로 나눠 병렬로 Jev 판정한다.
 *
 * 왜 분할하는가: 후보 풀을 120까지 넓히면 한 번의 fan-out 에 120문항이 되어
 * 요청 토큰 한도(64k)와 지연이 모두 커진다. 30문항씩 4회를 나란히 보내면
 * 벽시계는 한 번 호출과 비슷하게 유지된다.
 *
 * 조각 하나가 실패해도 나머지 점수는 쓴다(부분 성공). 전부 실패하면 scores 가
 * 비고 호출자는 임베딩 전용 경로로 내려간다.
 */
export async function judgeTopicRelevanceChunked(
  theme: string,
  gradeGroup: string | undefined,
  standards: readonly { id: string; code: string; subject: string; text: string; levelA?: string }[],
  options: { chunkSize?: number; deadlineMs?: number } = {},
): Promise<ChunkedJudgement | null> {
  if (!jevJudgeEnabled() || standards.length === 0) return null
  const chunkSize = options.chunkSize ?? JEV_CHUNK_SIZE
  const deadlineMs = options.deadlineMs ?? 6_000
  const chunks = chunkArray(standards, chunkSize)
  const startedAt = performance.now()

  const settled = await Promise.all(
    chunks.map(chunk => withDeadline(judgeTopicRelevance(theme, gradeGroup, [...chunk]), deadlineMs, 'search-chunk')),
  )
  const scores: Record<string, number> = {}
  let ok = 0
  for (const result of settled) {
    if (!result) continue
    ok += 1
    Object.assign(scores, result.scores)
  }
  return {
    scores,
    chunks: { ok, total: chunks.length },
    elapsedMs: Math.round(performance.now() - startedAt),
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

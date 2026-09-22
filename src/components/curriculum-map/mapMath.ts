// 교육과정 분석맵 — 순수 계산 헬퍼.
// 캔버스 렌더러/패널에서 쓰는 모든 좌표·가시성·크기 규칙의 단일 기준(SSOT).
// 외부 의존성이 없어야 한다 (node --experimental-strip-types 로 단독 테스트).

import type { MapEdge, MapFilters, MapNode } from './types'

export interface ViewTransform {
  x: number
  y: number
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const MIN_SCALE = 0.15
export const MAX_SCALE = 6
export const FIT_PADDING = 56
export const EDGE_THRESHOLD_MIN = 0.3
export const EDGE_THRESHOLD_MAX = 0.8
export const EDGE_THRESHOLD_DEFAULT = 0.5

// 노드 반지름은 월드 단위 — 백엔드 레이아웃의 겹침 방지 계산과 같은 공식을 쓴다.
export const NODE_R_BASE = 8
export const NODE_R_RANGE = 18
export const NODE_PADDING = 8
/** 축소해도 클릭할 수 있는 최소 화면 반지름 */
export const MIN_SCREEN_RADIUS = 2.5
/**
 * 가독성 배수 K. 반지름과 좌표에 **함께** 적용해야 한다.
 * 반지름만 키우면 빌더가 만든 겹침 없는 배치가 무너진다(확대하면 원이 겹쳐 보임).
 * 그래서 K 는 (1) 그리는 반지름, (2) 충돌 반지름, (3) 시드 좌표에 모두 곱한다.
 */
export const RENDER_RADIUS_SCALE = 1.6


export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clampScale(scale: number): number {
  return clamp(scale, MIN_SCALE, MAX_SCALE)
}

export function easeOutCubic(p: number): number {
  const t = clamp(p, 0, 1)
  return 1 - Math.pow(1 - t, 3)
}

/**
 * 변환값 방어 — NaN·Infinity·0 배율이 한 번이라도 섞이면 이후 모든 좌표가
 * 무효해지므로(화면이 비거나 한 점으로 모임) 그리기·입력 직전에 정상화한다.
 */
export function sanitizeTransform(t: ViewTransform): ViewTransform {
  return {
    x: Number.isFinite(t.x) ? t.x : 0,
    y: Number.isFinite(t.y) ? t.y : 0,
    scale: clampScale(t.scale),
  }
}

// ─── 좌표 변환 ────────────────────────────────────────────────────────────

export function computeBounds(points: readonly Point[]): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let seen = 0
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    seen += 1
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (seen === 0) return null
  return { minX, minY, maxX, maxY }
}

/**
 * 주어진 좌표 묶음이 뷰포트에 꽉 차도록 변환을 계산.
 * 노드가 하나뿐이거나 폭이 0이면 배율 1로 중앙 정렬한다.
 */
export function fitToView(
  bounds: Bounds | null,
  viewport: Viewport,
  padding: number = FIT_PADDING,
): ViewTransform {
  if (!bounds || !(viewport.width > 0) || !(viewport.height > 0)) {
    return { x: 0, y: 0, scale: 1 }
  }
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const usableW = Math.max(1, viewport.width - padding * 2)
  const usableH = Math.max(1, viewport.height - padding * 2)
  const rawScale = spanX <= 0 || spanY <= 0
    ? 1
    : Math.min(usableW / spanX, usableH / spanY)
  const scale = clampScale(rawScale)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return sanitizeTransform({
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    scale,
  })
}

/** 첫 화면에서 중앙값 노드가 가져야 할 최소 반지름(px) */
export const MIN_MEDIAN_NODE_PX = 6

/**
 * 첫 화면 배율. fit 에 가중치를 곱하되, 중앙값 노드가 MIN_MEDIAN_NODE_PX 보다
 * 작아지지 않도록 끌어올린다. K 는 좌표·반지름에 함께 곱해 배율 불변이므로
 * "화면에서 크게 보이게" 하는 손잡이는 이 배율뿐이다.
 */
export function initialViewScale(
  fitScale: number,
  boost: number,
  medianWorldRadius: number,
  minNodePx: number = MIN_MEDIAN_NODE_PX,
): number {
  const base = clampScale(fitScale) * (Number.isFinite(boost) && boost > 0 ? boost : 1)
  if (!Number.isFinite(medianWorldRadius) || medianWorldRadius <= 0) return clampScale(base)
  return clampScale(Math.max(base, minNodePx / medianWorldRadius))
}

/** 중앙값 반지름 — 초기 배율 계산에 쓴다. */
export function medianRadius(radii: readonly number[]): number {
  const usable = radii.filter(r => Number.isFinite(r) && r > 0).sort((a, b) => a - b)
  if (usable.length === 0) return 0
  return usable[Math.floor(usable.length / 2)]
}

export function worldToScreen(p: Point, t: ViewTransform): Point {
  return { x: t.x + p.x * t.scale, y: t.y + p.y * t.scale }
}

export function screenToWorld(p: Point, t: ViewTransform): Point {
  return { x: (p.x - t.x) / t.scale, y: (p.y - t.y) / t.scale }
}

/** 커서(또는 핀치 중심) 고정 줌 — 화면상 해당 지점의 월드 좌표가 유지된다. */
export function zoomAtPoint(t: ViewTransform, anchor: Point, factor: number): ViewTransform {
  const safe = sanitizeTransform(t)
  const nextScale = clampScale(safe.scale * (Number.isFinite(factor) ? factor : 1))
  const ratio = nextScale / safe.scale
  return sanitizeTransform({
    x: anchor.x - (anchor.x - safe.x) * ratio,
    y: anchor.y - (anchor.y - safe.y) * ratio,
    scale: nextScale,
  })
}

/** 특정 월드 좌표를 뷰포트 중앙으로 보내는 변환. */
export function centerOn(target: Point, viewport: Viewport, scale: number): ViewTransform {
  const s = clampScale(scale)
  return sanitizeTransform({
    x: viewport.width / 2 - target.x * s,
    y: viewport.height / 2 - target.y * s,
    scale: s,
  })
}

export function lerpTransform(from: ViewTransform, to: ViewTransform, p: number): ViewTransform {
  const e = clamp(p, 0, 1)
  return sanitizeTransform({
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    scale: from.scale + (to.scale - from.scale) * e,
  })
}

// ─── 크기 규칙 (월드 단위) ────────────────────────────────────────────────

/**
 * 차수 순위를 0..1 로 정규화. 값이 아니라 순위를 쓰므로 차수 분포가 치우쳐도
 * 크기 차이가 고르게 드러난다. 동률은 같은 값을 받는다.
 */
export function degreeRankNorm(nodes: readonly { id: string; degree: number }[]): Map<string, number> {
  const result = new Map<string, number>()
  const total = nodes.length
  if (total === 0) return result
  if (total === 1) {
    result.set(nodes[0].id, 0)
    return result
  }
  const sorted = [...nodes].map(n => n.degree).sort((a, b) => a - b)
  // 자기보다 낮은 차수의 노드 수 / (전체 - 1)
  const lowerCount = new Map<number, number>()
  for (let i = 0; i < sorted.length; i++) {
    if (!lowerCount.has(sorted[i])) lowerCount.set(sorted[i], i)
  }
  for (const n of nodes) {
    result.set(n.id, clamp((lowerCount.get(n.degree) ?? 0) / (total - 1), 0, 1))
  }
  return result
}

/** 월드 단위 노드 반지름 — 백엔드 레이아웃의 겹침 방지 공식과 동일. */
export function worldRadius(degreeNorm: number): number {
  return NODE_R_BASE + NODE_R_RANGE * clamp(degreeNorm, 0, 1)
}

/**
 * 그리기·충돌에 함께 쓰는 월드 반지름. 선택·검색 강조로 이 값을 키우면 안 된다
 * (강조는 링·후광·라벨 굵기로 표현한다).
 */
export function drawWorldRadius(baseRadius: number, k: number = RENDER_RADIUS_SCALE): number {
  const r = baseRadius * k
  return Number.isFinite(r) && r > 0 ? r : NODE_R_BASE * k
}

/** 시드 좌표도 같은 K 로 늘려 겹침 없는 배치를 유지한다. */
export function scaleLayoutPoint(p: Point, k: number = RENDER_RADIUS_SCALE): Point {
  return { x: p.x * k, y: p.y * k }
}

/**
 * 월드 반지름을 화면 픽셀로. 여기서 K 를 또 곱하지 않는다 —
 * 입력은 이미 drawWorldRadius 를 거친 값이어야 하고, 그래야 충돌과 일치한다.
 */
export function screenRadius(worldR: number, scale: number): number {
  const r = worldR * clampScale(scale)
  return Number.isFinite(r) ? Math.max(MIN_SCREEN_RADIUS, r) : MIN_SCREEN_RADIUS
}


// ─── 가시성 규칙 ──────────────────────────────────────────────────────────

export function isNodeVisible(
  node: Pick<MapNode, 'subjectId' | 'band'>,
  filters: Pick<MapFilters, 'hiddenSubjectIds' | 'hiddenBands'>,
): boolean {
  if (filters.hiddenSubjectIds.includes(node.subjectId)) return false
  if (filters.hiddenBands.includes(node.band)) return false
  return true
}

/**
 * 엣지 표시 여부. 양쪽 노드가 보이고 임계값을 넘어야 한다.
 * 선택 노드에 붙은 엣지는 임계값을 무시한다 — 선택이 막다른 길이 되지 않도록.
 */
export function isEdgeVisible(
  edge: Pick<MapEdge, 'source' | 'target' | 'sim'>,
  threshold: number,
  visibleIds: ReadonlySet<string>,
  selectedId?: string | null,
): boolean {
  if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return false
  if (selectedId && (edge.source === selectedId || edge.target === selectedId)) return true
  return edge.sim >= threshold
}

// ─── 선택 집합 규칙 ──────────────────────────────────────────────────────

export interface SelectionSetContext {
  selectedId: string | null
  /** /related 응답 대기 중 */
  relatedPending: boolean
  /** 선택 노드의 에셋 이웃 — 잠정 집합 */
  selectedNeighbors: ReadonlySet<string>
  /** Jev 관련 판정 결과 id */
  relatedIds: ReadonlySet<string>
}

/**
 * 선택 모드에서 밝게 둘 노드인지. 판정 전에는 에셋 이웃(잠정)을 쓰고,
 * 응답이 오면 Jev 집합으로 **교체**한다 — 잠정에만 있던 노드는 다시 흐려진다.
 */
export function isInSelectionSet(id: string, ctx: SelectionSetContext): boolean {
  if (!ctx.selectedId) return false
  if (id === ctx.selectedId) return true
  return ctx.relatedPending ? ctx.selectedNeighbors.has(id) : ctx.relatedIds.has(id)
}

/** 캔버스 클릭의 다음 선택 상태 — 같은 노드를 다시 누르면 해제. */
export function nextSelection(clickedId: string | null, currentId: string | null): string | null {
  if (clickedId === null) return null
  return clickedId === currentId ? null : clickedId
}

/** 화면 좌표에서 가장 가까운 노드 찾기 — 반지름 + 여유 4px 이내만 채택 */
export function pickNodeAt(
  screen: Point,
  nodes: readonly { id: string; x: number; y: number; r: number }[],
  t: ViewTransform,
  slack = 4,
): string | null {
  const safe = sanitizeTransform(t)
  let bestId: string | null = null
  let bestDist = Infinity
  for (const n of nodes) {
    const s = worldToScreen(n, safe)
    const dx = s.x - screen.x
    const dy = s.y - screen.y
    const d2 = dx * dx + dy * dy
    const hit = n.r + slack
    if (d2 <= hit * hit && d2 < bestDist) {
      bestDist = d2
      bestId = n.id
    }
  }
  return bestId
}

// ─── 학년군별 결과 묶기 ────────────────────────────────────────────────────

export interface BandGroup<T> {
  band: string
  items: T[]
}

export interface BandGroupResult<T> {
  groups: BandGroup<T>[]
  emptyBands: string[]
}

/**
 * 검색 결과를 체크된 학년군 순서(1-2 → 3-4 → 5-6)로 묶는다.
 * 백엔드가 byBand 를 주면 그대로 쓰고, 없으면 각 항목의 band 로 클라이언트에서 묶는다.
 * 결과가 없는 학년군은 emptyBands 로 따로 알린다.
 */
export function groupResultsByBand<T extends { band: string }>(
  results: readonly T[],
  bands: readonly string[],
  byBand?: Record<string, T[]>,
  emptyBands?: readonly string[],
): BandGroupResult<T> {
  const groups: BandGroup<T>[] = []
  const empty: string[] = []
  for (const band of bands) {
    const items = byBand?.[band] ?? results.filter(r => r.band === band)
    if (items.length > 0) groups.push({ band, items })
    else empty.push(band)
  }
  // 체크된 학년군 목록 밖의 결과도 버리지 않는다 (필터와 응답이 어긋난 경우)
  const covered = new Set(bands)
  const leftover = results.filter(r => !covered.has(r.band))
  for (const band of [...new Set(leftover.map(r => r.band))]) {
    groups.push({ band, items: leftover.filter(r => r.band === band) })
  }
  return { groups, emptyBands: emptyBands ? [...emptyBands] : empty }
}

// ─── 표시 포맷 ────────────────────────────────────────────────────────────

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}초`
}

export function formatScore(score: number): string {
  return `${Math.round(clamp(score, 0, 1) * 100)}%`
}

export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR')
}

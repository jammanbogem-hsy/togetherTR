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
/** 이 배율 이상이면 (가림 검사를 거쳐) 모든 노드 라벨을 그린다 */
export const LABEL_ZOOM_THRESHOLD = 1.2
/** 로드 시 자리 잡는 이징 길이(ms) */
export const SETTLE_DURATION_MS = 1000
/**
 * 정착 연출이 노드를 중심으로 끌어당기는 최대 비율.
 * 1.0 이면 progress 0 에서 모든 노드가 한 점으로 붕괴한다 — 연출이 어떤 이유로든
 * 멈추면 지도가 못 쓰게 되므로, 최악의 경우에도 배치가 읽히도록 상한을 둔다.
 */
export const SETTLE_MAX_PULL = 0.12
export const FIT_PADDING = 56
export const EDGE_THRESHOLD_MIN = 0.3
export const EDGE_THRESHOLD_MAX = 0.8
export const EDGE_THRESHOLD_DEFAULT = 0.5
/** 검색 모드에서 결과 아닌 노드의 알파 */
export const DIMMED_ALPHA = 0.15

// 노드 반지름은 월드 단위 — 백엔드 레이아웃의 겹침 방지 계산과 같은 공식을 쓴다.
export const NODE_R_BASE = 8
export const NODE_R_RANGE = 18
export const NODE_PADDING = 8
/** 축소해도 클릭할 수 있는 최소 화면 반지름 */
export const MIN_SCREEN_RADIUS = 2.5

export const LABEL_FONT_PX = 13
export const LABEL_FONT_PX_SMALL = 12
/** 이 배율 이상에서 코드 + 본문 앞부분을 함께 보여 준다 */
export const LABEL_DETAIL_ZOOM = 2
export const LABEL_DETAIL_CHARS = 18

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

/**
 * 로드 직후의 정착 연출. 에셋 좌표에 **가산되는** 오프셋만 적용하며,
 * progress 1 이면 에셋 좌표를 그대로(정확히) 돌려준다.
 * 연출이 중단돼도 최대 SETTLE_MAX_PULL 만큼만 당겨지므로 배치가 무너지지 않는다.
 */
export function settlePosition(node: Point, center: Point, progress: number): Point {
  const e = easeOutCubic(progress)
  if (e >= 1) return { x: node.x, y: node.y }
  const pull = (1 - e) * SETTLE_MAX_PULL
  return {
    x: node.x + (center.x - node.x) * pull,
    y: node.y + (center.y - node.y) * pull,
  }
}

/** 정착 진행도를 시계로부터 계산 — 리렌더·선택·검색에 영향받지 않는다. */
export function settleProgress(startedAt: number | null, now: number): number {
  if (startedAt === null || !Number.isFinite(startedAt)) return 1
  if (SETTLE_DURATION_MS <= 0) return 1
  return clamp((now - startedAt) / SETTLE_DURATION_MS, 0, 1)
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

/** 검색 결과는 점수에 비례해 조금 더 크게 (월드 단위). */
export function worldRadiusForScore(score: number): number {
  return NODE_R_BASE + 4 + (NODE_R_RANGE + 6) * clamp(score, 0, 1)
}

/** 월드 반지름을 화면 픽셀로 — 축소해도 최소 크기는 보장한다. */
export function screenRadius(worldR: number, scale: number): number {
  const r = worldR * clampScale(scale)
  return Number.isFinite(r) ? Math.max(MIN_SCREEN_RADIUS, r) : MIN_SCREEN_RADIUS
}

export function edgeAlpha(sim: number): number {
  return clamp(0.06 + clamp(sim, 0, 1) * 0.34, 0.06, 0.4)
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

export interface LabelContext {
  scale: number
  alwaysLabels: boolean
  isResult: boolean
  isSelected: boolean
  isHovered: boolean
  /** 선택 노드의 이웃 — 관련 성취기준을 바로 읽히게 한다 */
  isNeighbor?: boolean
}

/** 항상 보여야 하는 라벨(선택·결과·호버·이웃)은 가림 검사에서도 우선한다. */
export function isForcedLabel(ctx: LabelContext): boolean {
  return ctx.isSelected || ctx.isHovered || ctx.isResult || ctx.isNeighbor === true
}

export function shouldDrawLabel(ctx: LabelContext): boolean {
  if (isForcedLabel(ctx)) return true
  if (ctx.alwaysLabels) return true
  return ctx.scale >= LABEL_ZOOM_THRESHOLD
}

/** 배율이 충분하면 코드 뒤에 본문 앞부분을 붙인다. */
export function labelText(code: string, text: string, scale: number): string {
  if (scale < LABEL_DETAIL_ZOOM || !text) return code
  const head = text.slice(0, LABEL_DETAIL_CHARS).trim()
  if (!head) return code
  return `${code} ${head}${text.length > LABEL_DETAIL_CHARS ? '…' : ''}`
}

// ─── 라벨 가림(occlusion) 처리 ────────────────────────────────────────────

export interface LabelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function boxesIntersect(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

export interface LabelCandidate {
  id: string
  box: LabelBox
  /** 높을수록 먼저 자리를 차지한다 */
  priority: number
  /** 선택·결과·호버처럼 반드시 그려야 하는 라벨 */
  forced: boolean
}

/**
 * 탐욕적 가림 제거 — 우선순위가 높은 라벨부터 배치하고, 이미 놓인 라벨과
 * 겹치는 라벨은 건너뛴다. 강제 라벨은 겹쳐도 그리되 자리는 차지한다.
 */
export function placeLabels(candidates: readonly LabelCandidate[]): Set<string> {
  const ordered = [...candidates].sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1
    return b.priority - a.priority
  })
  const accepted: LabelBox[] = []
  const ids = new Set<string>()
  for (const c of ordered) {
    if (c.forced) {
      accepted.push(c.box)
      ids.add(c.id)
      continue
    }
    if (accepted.some(box => boxesIntersect(box, c.box))) continue
    accepted.push(c.box)
    ids.add(c.id)
  }
  return ids
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

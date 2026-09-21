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
/** 이 배율 이상이면 모든 노드 라벨을 그린다 */
export const LABEL_ZOOM_THRESHOLD = 1.2
/** 로드 시 자리 잡는 이징 길이(ms) */
export const SETTLE_DURATION_MS = 1000
export const FIT_PADDING = 56
export const EDGE_THRESHOLD_MIN = 0.3
export const EDGE_THRESHOLD_MAX = 0.8
export const EDGE_THRESHOLD_DEFAULT = 0.5
/** 검색 모드에서 결과 아닌 노드의 알파 */
export const DIMMED_ALPHA = 0.15

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clampScale(scale: number): number {
  return clamp(scale, MIN_SCALE, MAX_SCALE)
}

export function easeOutCubic(p: number): number {
  const t = clamp(p, 0, 1)
  return 1 - Math.pow(1 - t, 3)
}

// ─── 좌표 변환 ────────────────────────────────────────────────────────────

export function computeBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
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
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) {
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
  return {
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    scale,
  }
}

export function worldToScreen(p: Point, t: ViewTransform): Point {
  return { x: t.x + p.x * t.scale, y: t.y + p.y * t.scale }
}

export function screenToWorld(p: Point, t: ViewTransform): Point {
  return { x: (p.x - t.x) / t.scale, y: (p.y - t.y) / t.scale }
}

/** 커서(또는 핀치 중심) 고정 줌 — 화면상 해당 지점의 월드 좌표가 유지된다. */
export function zoomAtPoint(t: ViewTransform, anchor: Point, factor: number): ViewTransform {
  const nextScale = clampScale(t.scale * factor)
  const ratio = nextScale / t.scale
  return {
    x: anchor.x - (anchor.x - t.x) * ratio,
    y: anchor.y - (anchor.y - t.y) * ratio,
    scale: nextScale,
  }
}

/** 특정 월드 좌표를 뷰포트 중앙으로 보내는 변환 (배율 유지 또는 지정). */
export function centerOn(target: Point, viewport: Viewport, scale: number): ViewTransform {
  const s = clampScale(scale)
  return {
    x: viewport.width / 2 - target.x * s,
    y: viewport.height / 2 - target.y * s,
    scale: s,
  }
}

export function lerpTransform(from: ViewTransform, to: ViewTransform, p: number): ViewTransform {
  const e = clamp(p, 0, 1)
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    scale: from.scale + (to.scale - from.scale) * e,
  }
}

/**
 * 로드 직후 1초 동안 중심에서 제자리로 퍼지는 연출 좌표.
 * progress 1 이면 원래 좌표를 그대로 반환하므로 연출 종료 후 오차가 없다.
 */
export function settlePosition(node: Point, center: Point, progress: number): Point {
  const e = easeOutCubic(progress)
  if (e >= 1) return { x: node.x, y: node.y }
  return {
    x: center.x + (node.x - center.x) * e,
    y: center.y + (node.y - center.y) * e,
  }
}

// ─── 크기 규칙 ────────────────────────────────────────────────────────────

/** 연결 차수 기반 반지름 3~10px */
export function radiusForDegree(degree: number, maxDegree: number): number {
  const safeMax = maxDegree > 0 ? maxDegree : 1
  const ratio = clamp(degree / safeMax, 0, 1)
  return 3 + Math.sqrt(ratio) * 7
}

/** 검색 결과 반지름 — 점수(0..1)에 비례하되 항상 눈에 띄게 */
export function radiusForScore(score: number): number {
  return 5 + clamp(score, 0, 1) * 8
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

export function shouldDrawLabel(ctx: LabelContext): boolean {
  if (ctx.alwaysLabels) return true
  if (ctx.isSelected || ctx.isHovered || ctx.isResult) return true
  if (ctx.isNeighbor === true) return true
  return ctx.scale >= LABEL_ZOOM_THRESHOLD
}

/** 화면 좌표에서 가장 가까운 노드 찾기 — 반지름 + 여유 4px 이내만 채택 */
export function pickNodeAt(
  screen: Point,
  nodes: readonly { id: string; x: number; y: number; r: number }[],
  t: ViewTransform,
  slack = 4,
): string | null {
  let bestId: string | null = null
  let bestDist = Infinity
  for (const n of nodes) {
    const s = worldToScreen(n, t)
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

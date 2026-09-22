// 교육과정 분석맵 — 캔버스 그리기 루틴.
// React 와 분리해 두어 컴포넌트는 상태·입력만 다루고, 여기서는 순수하게 그린다.
//
// 연결선 규칙(중요): 색이 있는 관계선은 /related 가 돌려준 Jev 관계뿐이다.
// 에셋 엣지(유사도 이웃·교과 간 링크)는 항상 흐린 회색 배경이며 관계색을 쓰지 않는다.

import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import {
  isInSelectionSet,
  screenRadius,
  worldToScreen,
  type Point,
  type ViewTransform,
} from './mapMath'
import {
  LABEL_HALO_PX,
  LABEL_ZOOM_THRESHOLD,
  isForcedLabel,
  labelAnchorY,
  labelBox,
  labelFont,
  labelFontSize,
  labelText,
  placeLabels,
  shouldDrawLabel,
  type LabelCandidate,
} from './labelMath'
import {
  DIMMED_ALPHA,
  edgeAlpha,
  edgeDimFactor,
  edgeEmphasis,
  edgeWidth,
} from './edgeMath'
import type { SimNode } from './forceMath'
import {
  ICON_FONT_FAMILY,
  ICON_MIN_SCREEN_RADIUS,
  ICON_NODE_BUDGET,
  ICON_SIZE_RATIO,
  subjectIcon,
} from './subjectIcons'
import type { MapEdge, MapNode } from './types'

const FALLBACK_COLOR = '#94A3B8'
const BASE_EDGE_COLOR = '#C4C7C5'
const CANVAS_BG = '#F8FAFD'
const CULL_MARGIN_PX = 64
const FOCUS_EDGE_WIDTH = 3
const GHOST_ALPHA = 0.6

export interface RelatedMeta {
  relationType: string
  strength: number
  reason?: string
}

export interface DrawMapParams {
  width: number
  height: number
  view: ViewTransform
  /** 레이아웃 공간(에셋 좌표 × K)의 노드 — 고스트 포함 */
  nodes: readonly MapNode[]
  edges: readonly MapEdge[]
  sim: Map<string, SimNode>
  /** 필터에 가려졌지만 관련 항목이라 점선으로 보여 주는 노드 */
  ghostIds: ReadonlySet<string>
  subjectColors: Record<string, string>
  degreeNorms: Map<string, number>
  radiusOf: (node: MapNode) => number
  scoreById: Map<string, number>
  searchActive: boolean
  selectedId: string | null
  focusId: string | null
  focusNeighbors: ReadonlySet<string>
  relatedMeta: Map<string, RelatedMeta>
  /**
   * 선택 노드의 에셋 이웃(유사도·교과 간). /related 응답 전까지 이 집합을
   * 잠정 선택으로 밝게 보여 주고, 응답이 오면 Jev 집합으로 교체한다.
   */
  selectedNeighbors: ReadonlySet<string>
  /** /related 응답 대기 중 — 잠정 집합을 쓰고 관계색은 그리지 않는다 */
  relatedPending: boolean
  alwaysLabels: boolean
  /** 아이콘 폰트가 준비됐는지 — 아니면 원만 그린다 */
  iconFontReady: boolean
}

export interface DrawMapResult {
  /** 히트 테스트용 — 월드 좌표와 화면 반지름 */
  hits: { id: string; x: number; y: number; r: number }[]
}

export function drawMap(ctx: CanvasRenderingContext2D, p: DrawMapParams): DrawMapResult {
  const { width, height, view: t, nodes, edges, sim, ghostIds, relatedMeta } = p

  ctx.fillStyle = CANVAS_BG
  ctx.fillRect(0, 0, width, height)

  // 0) 좌표·반지름 선계산 (히트 테스트와 같은 값)
  const screenById = new Map<string, Point>()
  const radiusById = new Map<string, number>()
  const hits: DrawMapResult['hits'] = []
  let iconCandidates = 0
  for (const n of nodes) {
    const s = sim.get(n.id)
    const world = { x: s?.x ?? n.x, y: s?.y ?? n.y }
    const screen = worldToScreen(world, t)
    screenById.set(n.id, screen)
    const r = screenRadius(s?.r ?? p.radiusOf(n), t.scale)
    radiusById.set(n.id, r)
    hits.push({ id: n.id, x: world.x, y: world.y, r })
    if (
      r >= ICON_MIN_SCREEN_RADIUS &&
      screen.x >= 0 && screen.y >= 0 && screen.x <= width && screen.y <= height
    ) iconCandidates += 1
  }
  // 축소 상태에서 수백 개의 리거처를 그리면 프레임이 무너지므로 예산을 둔다
  const drawIcons = p.iconFontReady && iconCandidates <= ICON_NODE_BUDGET

  /** 선택 모드에서 밝게 둘 집합 — 응답 전엔 잠정(에셋 이웃), 후엔 Jev 관련 */
  const relatedIds = new Set(relatedMeta.keys())
  const inSelectionSet = (id: string): boolean =>
    isInSelectionSet(id, {
      selectedId: p.selectedId,
      relatedPending: p.relatedPending,
      selectedNeighbors: p.selectedNeighbors,
      relatedIds,
    })

  const nodeAlpha = (id: string): number => {
    if (ghostIds.has(id)) return GHOST_ALPHA
    if (p.focusId) return id === p.focusId || p.focusNeighbors.has(id) ? 1 : DIMMED_ALPHA
    if (p.searchActive) return p.scoreById.has(id) || id === p.selectedId ? 1 : DIMMED_ALPHA
    if (p.selectedId) return inSelectionSet(id) ? 1 : DIMMED_ALPHA
    return 1
  }

  // 1) 에셋 엣지 — 흐린 배경 (굵기·알파 구간별로 묶어 stroke)
  const buckets = new Map<string, Path2D>()
  const focusEdges: MapEdge[] = []
  // 선택은 배경선을 진하게 만들지 않는다 — 호버만 강조한다 (edgeMath 참고)
  const emphasisCtx = {
    focusId: p.focusId,
    selectedId: p.selectedId,
    relatedPending: p.relatedPending,
  }
  const dim = edgeDimFactor({
    focusId: p.focusId,
    searchActive: p.searchActive,
    selectedId: p.selectedId,
  })
  for (const e of edges) {
    const a = screenById.get(e.source)
    const b = screenById.get(e.target)
    if (!a || !b) continue
    if (edgeEmphasis(e, emphasisCtx) === 'hover') {
      focusEdges.push(e)
      continue
    }
    const alpha = Math.round(edgeAlpha(e.sim) * dim * 40) / 40
    const w = Math.round(edgeWidth(e.sim) * 2) / 2
    const key = `${alpha}|${w}`
    let path = buckets.get(key)
    if (!path) {
      path = new Path2D()
      buckets.set(key, path)
    }
    path.moveTo(a.x, a.y)
    path.lineTo(b.x, b.y)
  }
  ctx.strokeStyle = BASE_EDGE_COLOR
  for (const [key, path] of buckets) {
    const [alpha, w] = key.split('|')
    ctx.globalAlpha = Number(alpha)
    ctx.lineWidth = Number(w)
    ctx.stroke(path)
  }

  // 2) 호버 이웃 = 유사도 이웃. 호버 중에만 회색으로 진하게 한다.
  //    (선택 상태에서는 어떤 에셋 엣지도 진해지지 않는다)
  ctx.strokeStyle = '#747775'
  ctx.globalAlpha = 0.8
  ctx.lineWidth = FOCUS_EDGE_WIDTH
  for (const e of focusEdges) {
    const a = screenById.get(e.source)
    const b = screenById.get(e.target)
    if (!a || !b) continue
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // 3) Jev 관계선 — 선택 노드 ↔ /related 결과만. 색=유형, 굵기=강도.
  const from = p.selectedId ? screenById.get(p.selectedId) : null
  if (from) {
    for (const [id, meta] of relatedMeta) {
      const to = screenById.get(id)
      if (!to) continue
      ctx.strokeStyle = RELATION_COLORS[meta.relationType] ?? FALLBACK_COLOR
      ctx.globalAlpha = id === p.focusId ? 0.95 : 0.85
      ctx.lineWidth = id === p.focusId ? FOCUS_EDGE_WIDTH : Math.max(1.5, 1.5 + meta.strength * 2)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
  }

  // 4) 노드 — 강조는 링으로만 (반지름을 키우면 겹침이 생긴다)
  for (const n of nodes) {
    const s = screenById.get(n.id)
    if (!s) continue
    if (
      s.x < -CULL_MARGIN_PX || s.y < -CULL_MARGIN_PX ||
      s.x > width + CULL_MARGIN_PX || s.y > height + CULL_MARGIN_PX
    ) continue
    const r = radiusById.get(n.id) ?? 4
    const color = p.subjectColors[n.subjectId] ?? FALLBACK_COLOR
    const isGhost = ghostIds.has(n.id)
    ctx.globalAlpha = nodeAlpha(n.id)
    if (isGhost) {
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // 교과 아이콘 — 노드와 같은 알파(고스트는 60%)로 흰색 리거처를 얹는다
    if (drawIcons && r >= ICON_MIN_SCREEN_RADIUS) {
      const glyph = subjectIcon(n.subjectId)
      if (glyph) {
        ctx.font = `${Math.round(r * ICON_SIZE_RATIO)}px ${ICON_FONT_FAMILY}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = isGhost ? color : '#FFFFFF'
        ctx.fillText(glyph, s.x, s.y)
      }
    }
    const isSelected = n.id === p.selectedId
    const isResult = p.searchActive && p.scoreById.has(n.id)
    if (isSelected || n.id === p.focusId || isResult) {
      ctx.globalAlpha = 1
      ctx.setLineDash([])
      ctx.lineWidth = isSelected ? 3 : 2
      ctx.strokeStyle = isSelected ? '#1F1F1F' : isResult ? color : '#444746'
      ctx.beginPath()
      ctx.arc(s.x, s.y, r + (isSelected ? 5 : 3.5), 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // 5) 라벨 — 탐욕적 가림 제거
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  const candidates: LabelCandidate[] = []
  const plan = new Map<string, { label: string; font: number; node: MapNode }>()
  for (const n of nodes) {
    const s = screenById.get(n.id)
    if (!s) continue
    if (s.x < 0 || s.y < 0 || s.x > width || s.y > height) continue
    const isGhost = ghostIds.has(n.id)
    const isResult = p.searchActive && p.scoreById.has(n.id)
    const isSelected = n.id === p.selectedId
    const isHovered = n.id === p.focusId
    const isRelated = p.selectedId !== null && inSelectionSet(n.id)
    const isNeighbor = p.focusId !== null ? p.focusNeighbors.has(n.id) : isRelated
    const labelCtx = { scale: t.scale, alwaysLabels: p.alwaysLabels, isResult, isSelected, isHovered, isNeighbor }
    // 가려진 관련 노드는 왜 점선인지 알 수 있게 라벨을 항상 붙인다
    if (!isGhost) {
      if (!shouldDrawLabel(labelCtx)) continue
      if (p.focusId && !isHovered && !isNeighbor && !isSelected) continue
      if (p.searchActive && !isResult && !isSelected && t.scale < LABEL_ZOOM_THRESHOLD) continue
    }
    // 크기는 CSS 픽셀 고정 — 배율이나 dpr 을 곱하지 않는다
    const font = labelFontSize({ focused: isSelected || isResult || isHovered || isRelated })
    const label = labelText(n.code, n.text, t.scale)
    ctx.font = labelFont(font)
    const w = ctx.measureText(label).width
    const r = radiusById.get(n.id) ?? 4
    const y = labelAnchorY(s.y, r)
    plan.set(n.id, { label, font, node: n })
    candidates.push({
      id: n.id,
      forced: isGhost || isForcedLabel(labelCtx),
      priority: p.degreeNorms.get(n.id) ?? 0,
      box: labelBox(s.x, y, w, font),
    })
  }
  // 강조 노드의 원 위에는 라벨을 얹지 않는다
  const blockers: { x: number; y: number; r: number }[] = []
  for (const id of [p.selectedId, p.focusId]) {
    if (!id) continue
    const s = screenById.get(id)
    if (s) blockers.push({ x: s.x, y: s.y, r: radiusById.get(id) ?? 4 })
  }
  const drawable = placeLabels(candidates, blockers)
  ctx.lineWidth = LABEL_HALO_PX
  ctx.textBaseline = 'top'
  for (const c of candidates) {
    if (!drawable.has(c.id)) continue
    const s = screenById.get(c.id)
    const entry = plan.get(c.id)
    if (!s || !entry) continue
    ctx.globalAlpha = ghostIds.has(c.id) ? GHOST_ALPHA : 1
    ctx.font = labelFont(entry.font)
    const y = labelAnchorY(s.y, radiusById.get(c.id) ?? 4)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.strokeText(entry.label, s.x, y)
    ctx.fillStyle = p.subjectColors[entry.node.subjectId] ?? '#444746'
    ctx.fillText(entry.label, s.x, y)
  }

  // 긴 관계 근거는 MapTooltip과 분석 패널에서만 표시한다.
  // 선의 중간에도 그리면 툴팁 뒤에 같은 문장이 겹치고 캔버스 밖으로 잘린다.

  ctx.globalAlpha = 1
  return { hits }
}

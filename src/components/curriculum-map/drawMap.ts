// 교육과정 분석맵 — 캔버스 그리기 루틴.
// React 와 분리해 두어 컴포넌트는 상태·입력만 다루고, 여기서는 순수하게 그린다.
//
// 연결선 규칙(중요): 색이 있는 관계선은 /related 가 돌려준 Jev 관계뿐이다.
// 에셋 엣지(유사도 이웃·교과 간 링크)는 항상 흐린 회색 배경이며 관계색을 쓰지 않는다.

import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import {
  RENDER_RADIUS_SCALE,
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
import { GRID_AREA_LABEL_HEIGHT, type GridGuides } from './gridLayout'
import type { ConstellationGuides } from './constellationLayout'
import { drawConstellationHubs, drawConstellationStructure, drawLocalRings } from './drawConstellation'
import { CANVAS_PALETTES, readableOn, type CanvasTheme } from './mapTheme'
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
  /**
   * 정렬 배치의 안내선(레이아웃 공간, K 적용 완료). 있으면 칸·교과·학년군·영역 머리글을
   * 그리고, 배경 유사도 선은 생략한다 — 정렬 배치에서 거리는 관계를 뜻하지 않으므로
   * 격자를 가로지르는 수천 개의 선은 잡음일 뿐이다. 호버·관계선은 그대로 그린다.
   */
  guides?: GridGuides | null
  /** 성좌 배치의 구조 요소(레이아웃 공간). 있으면 허브·가지·고리를 그리고 배경 유사도 선은 생략 */
  constellation?: ConstellationGuides | null
  /**
   * 선택 시 로컬 그래프. targets 의 노드는 progress(0..1)만큼 제자리 → 로컬 자리로 옮겨 그린다.
   * 히트 테스트도 같은 좌표를 쓰므로 옮겨진 자리를 누르면 된다.
   */
  local?: {
    center: Point
    targets: Map<string, Point>
    progress: number
    rings: ReadonlyArray<{ radius: number; label: string }>
  } | null
  theme?: CanvasTheme
}

const GUIDE_CELL_FILL = '#FFFFFF'
const GUIDE_CELL_STROKE = '#E1E3E1'
const GUIDE_HEADER_COLOR = '#1F1F1F'
const GUIDE_AREA_COLOR = '#5E5E5E'
const GUIDE_HEADER_PX = 15
/** 학년군 머리글이 올라갈 수 있는 가장 위 y — 도구 막대를 피한다 */
const GUIDE_HEADER_MIN_Y = 76
const GUIDE_AREA_PX = 12
/** 영역 라벨 줄이 화면에서 이 높이(px) 이상일 때만 영역 이름을 그린다 */
const GUIDE_AREA_MIN_LINE_PX = 15

/** 정렬 배치에서 선이 휘는 정도 — 거리의 비율, 상한 px */
const ARC_BEND_RATIO = 0.18
const ARC_BEND_MAX_PX = 120

/**
 * 두 점을 잇는다. 정렬 배치에서는 같은 줄의 관계선이 한 직선 위에 겹치고 사이의 원을
 * 관통하므로, 거리에 비례해 휘는 호로 그린다(길이가 다른 선이 서로 다른 높이로 갈라진다).
 */
function traceLink(ctx: CanvasRenderingContext2D, a: Point, b: Point, curved: boolean): void {
  ctx.moveTo(a.x, a.y)
  if (!curved) {
    ctx.lineTo(b.x, b.y)
    return
  }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d === 0) return
  const bend = Math.min(ARC_BEND_MAX_PX, d * ARC_BEND_RATIO)
  // 방향과 무관하게 같은 쪽(화면 위쪽 성분)으로 휜다 — 왕복 선이 같은 호가 되게
  let nx = -dy / d
  let ny = dx / d
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx
    ny = -ny
  }
  ctx.quadraticCurveTo((a.x + b.x) / 2 + nx * bend, (a.y + b.y) / 2 + ny * bend, b.x, b.y)
}

/** 0..1 부드러운 가감속 */
function easeInOut(x: number): number {
  const v = Math.min(1, Math.max(0, x))
  return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2
}

/** 머리글 뒤 반투명 알약 — 원 위에 겹쳐도 글자가 읽히게 한다. (x, top) = 글자 왼쪽 위 */
function headerPill(ctx: CanvasRenderingContext2D, x: number, top: number, textWidth: number): void {
  const padX = 8
  const padY = 4
  ctx.save()
  ctx.fillStyle = 'rgba(248,250,253,0.92)'
  ctx.beginPath()
  const w = textWidth + padX * 2
  const h = GUIDE_HEADER_PX + padY * 2
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x - padX, top - padY, w, h, h / 2)
  else ctx.rect(x - padX, top - padY, w, h)
  ctx.fill()
  ctx.restore()
}

/** 정렬 배치 안내선 — 칸 배경, 영역 라벨, 묶음마다 달라붙는(sticky) 교과·학년군 머리글. */
function drawGridGuides(
  ctx: CanvasRenderingContext2D,
  guides: GridGuides,
  t: ViewTransform,
  width: number,
  height: number,
  subjectColors: Record<string, string>,
): void {
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.lineWidth = 1
  for (const c of guides.cells) {
    const a = worldToScreen({ x: c.x0, y: c.y0 }, t)
    const b = worldToScreen({ x: c.x1, y: c.y1 }, t)
    if (b.x < 0 || b.y < 0 || a.x > width || a.y > height) continue
    ctx.fillStyle = GUIDE_CELL_FILL
    ctx.strokeStyle = GUIDE_CELL_STROKE
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, Math.min(12, (b.x - a.x) / 20))
    else ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.fill()
    ctx.stroke()
  }

  // 영역 이름 — 확대했을 때만 (축소 상태에선 글자가 칸을 덮는다)
  // 안내선은 이미 K 배가 적용된 레이아웃 공간이다
  const areaLinePx = GRID_AREA_LABEL_HEIGHT * RENDER_RADIUS_SCALE * t.scale
  if (areaLinePx >= GUIDE_AREA_MIN_LINE_PX) {
    ctx.font = `500 ${GUIDE_AREA_PX}px system-ui, -apple-system, 'Noto Sans KR', sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = GUIDE_AREA_COLOR
    for (const a of guides.areas) {
      const s = worldToScreen({ x: a.x, y: a.y }, t)
      if (s.x > width || s.y > height || s.y < -20 || s.x < -400) continue
      ctx.fillText(a.area, s.x, s.y + 4)
    }
  }

  // 학년군 머리글 — 묶음마다 표 윗변에 붙되, 위로 스크롤되면 화면 맨 위에 머문다
  // (그 묶음이 화면 위로 다 지나가면 감춘다)
  ctx.font = `600 ${GUIDE_HEADER_PX}px system-ui, -apple-system, 'Noto Sans KR', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  ctx.lineWidth = LABEL_HALO_PX
  for (const col of guides.columns) {
    const a = worldToScreen({ x: col.x0, y: col.y0 }, t)
    const b = worldToScreen({ x: col.x1, y: col.y1 }, t)
    if (b.x < 0 || a.x > width || a.y > height) continue
    // 캔버스 왼쪽 위 도구 막대(높이 약 56px) 아래에 머문다
    const colY = Math.max(GUIDE_HEADER_MIN_Y, a.y - 30)
    if (colY > b.y - 40) continue
    const x = Math.min(Math.max((a.x + b.x) / 2, a.x + 40), b.x - 40)
    headerPill(ctx, x - ctx.measureText(col.band).width / 2, colY, ctx.measureText(col.band).width)
    ctx.fillStyle = GUIDE_HEADER_COLOR
    ctx.fillText(col.band, x, colY)
  }

  // 교과 머리글 — 묶음 왼변에 붙되, 왼쪽으로 스크롤되면 화면 왼쪽에 머문다
  // (그 묶음이 화면 왼쪽으로 다 지나가면 감춘다)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const row of guides.rows) {
    const a = worldToScreen({ x: row.x0, y: row.y0 }, t)
    const b = worldToScreen({ x: row.x1, y: row.y1 }, t)
    if (b.y < 0 || a.y > height || b.x < 0 || a.x - 12 > width) continue
    const label = row.label
    const w = ctx.measureText(label).width
    const x = Math.max(10 + w, a.x - 12)
    if (x > b.x - 40) continue
    // 행의 화면에 보이는 구간 안에서 가운데 — 긴 행도 머리글이 화면 밖으로 나가지 않는다
    const visTop = Math.max(a.y + 14, GUIDE_HEADER_MIN_Y + 30)
    const visBottom = Math.min(b.y - 14, height - 40)
    const y = visTop > visBottom ? (a.y + b.y) / 2 : Math.min(Math.max((a.y + b.y) / 2, visTop), visBottom)
    headerPill(ctx, x - w, y - GUIDE_HEADER_PX / 2, w)
    ctx.fillStyle = subjectColors[row.subjectId] ?? GUIDE_HEADER_COLOR
    ctx.fillText(label, x, y)
  }
}

export interface DrawMapResult {
  /** 히트 테스트용 — 월드 좌표와 화면 반지름 */
  hits: { id: string; x: number; y: number; r: number }[]
}

export function drawMap(ctx: CanvasRenderingContext2D, p: DrawMapParams): DrawMapResult {
  const { width, height, view: t, nodes, edges, sim, ghostIds, relatedMeta } = p

  const theme: CanvasTheme = p.theme ?? 'light'
  const palette = CANVAS_PALETTES[theme]
  ctx.fillStyle = theme === 'light' ? CANVAS_BG : palette.bg
  ctx.fillRect(0, 0, width, height)
  if (p.guides) drawGridGuides(ctx, p.guides, t, width, height, p.subjectColors)
  const local = p.local && p.local.progress > 0 ? p.local : null
  const localEase = local ? easeInOut(local.progress) : 0

  // 0) 좌표·반지름 선계산 (히트 테스트와 같은 값)
  const screenById = new Map<string, Point>()
  const radiusById = new Map<string, number>()
  const hits: DrawMapResult['hits'] = []
  let iconCandidates = 0
  for (const n of nodes) {
    const s = sim.get(n.id)
    let world = { x: s?.x ?? n.x, y: s?.y ?? n.y }
    const target = local?.targets.get(n.id)
    if (target) {
      world = { x: world.x + (target.x - world.x) * localEase, y: world.y + (target.y - world.y) * localEase }
    }
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

  const constellationCtx = p.constellation
    ? {
      guides: p.constellation, t, width, height, theme, palette,
      subjectColors: p.subjectColors, screenById, fade: localEase,
    }
    : null
  if (constellationCtx) drawConstellationStructure(ctx, constellationCtx)

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
    if (local && !(id === p.selectedId || local.targets.has(id))) return DIMMED_ALPHA * (1 - 0.6 * localEase)
    if (local && id !== p.focusId && (id === p.selectedId || local.targets.has(id)) && !p.focusId) return 1
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
    if (p.guides || p.constellation) continue
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
  ctx.strokeStyle = theme === 'light' ? BASE_EDGE_COLOR : palette.edge
  for (const [key, path] of buckets) {
    const [alpha, w] = key.split('|')
    ctx.globalAlpha = Number(alpha)
    ctx.lineWidth = Number(w)
    ctx.stroke(path)
  }

  const curved = Boolean(p.guides)

  // 2) 호버 이웃 = 유사도 이웃. 호버 중에만 회색으로 진하게 한다.
  //    (선택 상태에서는 어떤 에셋 엣지도 진해지지 않는다)
  ctx.strokeStyle = palette.focusEdge
  ctx.globalAlpha = 0.8
  ctx.lineWidth = FOCUS_EDGE_WIDTH
  for (const e of focusEdges) {
    const a = screenById.get(e.source)
    const b = screenById.get(e.target)
    if (!a || !b) continue
    ctx.beginPath()
    traceLink(ctx, a, b, curved)
    ctx.stroke()
  }

  // 3) Jev 관계선 — 선택 노드 ↔ /related 결과만. 색=유형, 굵기=강도.
  const drawRelationLines = (): void => {
  const from = p.selectedId ? screenById.get(p.selectedId) : null
  if (from) {
    for (const [id, meta] of relatedMeta) {
      const to = screenById.get(id)
      if (!to) continue
      ctx.strokeStyle = RELATION_COLORS[meta.relationType] ?? FALLBACK_COLOR
      ctx.globalAlpha = id === p.focusId ? 0.95 : 0.85
      ctx.lineWidth = id === p.focusId ? FOCUS_EDGE_WIDTH : Math.max(1.5, 1.5 + meta.strength * 2)
      ctx.beginPath()
      traceLink(ctx, from, to, curved)
      ctx.stroke()
    }
  }
  }

  // 4) 노드 — 강조는 링으로만 (반지름을 키우면 겹침이 생긴다)
  const drawNode = (n: MapNode): void => {
    const s = screenById.get(n.id)
    if (!s) return
    if (
      s.x < -CULL_MARGIN_PX || s.y < -CULL_MARGIN_PX ||
      s.x > width + CULL_MARGIN_PX || s.y > height + CULL_MARGIN_PX
    ) return
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
      const glowing = palette.glow && (
        n.id === p.selectedId || relatedMeta.has(n.id) || (p.searchActive && p.scoreById.has(n.id))
      )
      if (glowing) {
        ctx.shadowColor = color
        ctx.shadowBlur = 16
      }
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (glowing) ctx.shadowBlur = 0
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
    if ((isSelected || n.id === p.focusId || isResult) && (!local || inLens(n.id) || n.id === p.focusId)) {
      ctx.globalAlpha = 1
      ctx.setLineDash([])
      ctx.lineWidth = isSelected ? 3 : 2
      ctx.strokeStyle = isSelected ? palette.selectRing : isResult ? color : palette.focusEdge
      ctx.beginPath()
      ctx.arc(s.x, s.y, r + (isSelected ? 5 : 3.5), 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  // 로컬 그래프가 켜지면 둘레에 모인 노드와 중심은 '렌즈' 위에 따로 그린다
  const inLens = (id: string): boolean => Boolean(local && (id === p.selectedId || local.targets.has(id)))
  for (const n of nodes) if (!inLens(n.id)) drawNode(n)

  if (constellationCtx) drawConstellationHubs(ctx, constellationCtx)

  if (local) {
    // 렌즈: 로컬 그래프 뒤를 바탕색 원판으로 덮어 배경 지도와 섞이지 않게 한다
    const c = worldToScreen(local.center, t)
    const outer = (local.rings.length > 0 ? Math.max(...local.rings.map(r => r.radius)) : 0) * t.scale
    const lensR = outer + 120 * t.scale
    const grad = ctx.createRadialGradient(c.x, c.y, outer * 0.6, c.x, c.y, lensR)
    grad.addColorStop(0, palette.bg)
    grad.addColorStop(0.8, palette.bg)
    grad.addColorStop(1, palette.bgTransparent)
    ctx.globalAlpha = 0.94 * localEase
    ctx.fillStyle = theme === 'light' ? CANVAS_BG : grad
    ctx.beginPath()
    ctx.arc(c.x, c.y, lensR, 0, Math.PI * 2)
    ctx.fill()
    drawLocalRings(ctx, c, local.rings.map(r => ({ radiusPx: r.radius * t.scale, label: r.label })), palette, localEase)
    drawRelationLines()
    for (const n of nodes) if (inLens(n.id)) drawNode(n)
  } else {
    drawRelationLines()
    for (const n of nodes) if (inLens(n.id)) drawNode(n)
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
      if (p.searchActive && !isResult && !isSelected && !(local && isRelated) && t.scale < LABEL_ZOOM_THRESHOLD) continue
      // 로컬 그래프 밖의 라벨은 렌즈와 겹치므로 그리지 않는다
      if (local && !isSelected && !local.targets.has(n.id)) continue
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
      forced: isGhost || isForcedLabel(labelCtx) || Boolean(local?.targets.has(n.id)),
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
    ctx.strokeStyle = palette.labelHalo
    ctx.strokeText(entry.label, s.x, y)
    ctx.fillStyle = readableOn(theme, p.subjectColors[entry.node.subjectId] ?? palette.labelInk)
    ctx.fillText(entry.label, s.x, y)
  }

  // 긴 관계 근거는 MapTooltip과 분석 패널에서만 표시한다.
  // 선의 중간에도 그리면 툴팁 뒤에 같은 문장이 겹치고 캔버스 밖으로 잘린다.

  ctx.globalAlpha = 1
  return { hits }
}

// 교육과정 분석맵 — 성좌 배치의 구조 요소(교과 허브·영역 허브·가지·학년군 고리)와
// 선택 시 로컬 그래프 눈금 고리를 그린다. 좌표는 모두 레이아웃 공간(K 적용 완료).

import { worldToScreen, type Point, type ViewTransform } from './mapMath'
import { LABEL_FONT_FAMILY } from './labelMath'
import type { ConstellationGuides } from './constellationLayout'
import { readableOn, type CanvasPalette, type CanvasTheme } from './mapTheme'

const HUB_FONT_PX = 15
const AREA_FONT_PX = 12
const RING_FONT_PX = 11
/** 영역 이름을 그리기 시작하는 화면 배율(레이아웃 공간 기준) */
const AREA_LABEL_MIN_SCALE = 0.32
const RING_LABEL_MIN_SCALE = 0.45

export interface ConstellationDrawContext {
  guides: ConstellationGuides
  t: ViewTransform
  width: number
  height: number
  theme: CanvasTheme
  palette: CanvasPalette
  subjectColors: Record<string, string>
  /** 지금 화면에 그려지는 성취기준의 화면 좌표(필터에 가려진 것은 없다) */
  screenById: Map<string, Point>
  /** 0..1 — 로컬 그래프가 켜질수록 구조 요소를 흐리게 */
  fade: number
}

function offscreen(p: Point, r: number, width: number, height: number): boolean {
  return p.x + r < 0 || p.y + r < 0 || p.x - r > width || p.y - r > height
}

/** 구조 요소를 노드보다 먼저(아래에) 그린다. */
export function drawConstellationStructure(ctx: CanvasRenderingContext2D, c: ConstellationDrawContext): void {
  const { guides, t, width, height, palette, subjectColors, screenById } = c
  const dim = 1 - 0.85 * c.fade
  const visibleSubjects = new Set<string>()
  for (const b of guides.branches) if (screenById.has(b.id)) visibleSubjects.add(b.subjectId)

  ctx.save()
  // 1) 학년군 고리 — 허브 중심 동심원(점선)
  ctx.setLineDash([3, 5])
  ctx.lineWidth = 1
  for (const ring of guides.rings) {
    if (!visibleSubjects.has(ring.subjectId)) continue
    const center = worldToScreen({ x: ring.cx, y: ring.cy }, t)
    const r = ring.r * t.scale
    if (offscreen(center, r, width, height)) continue
    ctx.globalAlpha = palette.ringAlpha * dim
    ctx.strokeStyle = subjectColors[ring.subjectId] ?? palette.guideInk
    ctx.beginPath()
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 2) 가지 — 교과 허브 → 영역 허브 → 성취기준
  const areaHubByKey = new Map(guides.areaHubs.map(h => [`${h.subjectId}\u0000${h.area}`, h]))
  const hubBySubject = new Map(guides.hubs.map(h => [h.subjectId, h]))
  ctx.lineWidth = 1
  for (const [subjectId, hub] of hubBySubject) {
    if (!visibleSubjects.has(subjectId)) continue
    const color = subjectColors[subjectId] ?? palette.guideInk
    const hs = worldToScreen(hub, t)
    if (offscreen(hs, hub.extent * t.scale, width, height)) continue
    ctx.strokeStyle = color
    ctx.globalAlpha = palette.branchAlpha * 1.6 * dim
    ctx.beginPath()
    for (const ah of guides.areaHubs) {
      if (ah.subjectId !== subjectId) continue
      const as = worldToScreen(ah, t)
      ctx.moveTo(hs.x, hs.y)
      ctx.lineTo(as.x, as.y)
    }
    ctx.stroke()
    ctx.globalAlpha = palette.branchAlpha * dim
    ctx.beginPath()
    for (const b of guides.branches) {
      if (b.subjectId !== subjectId) continue
      const target = screenById.get(b.id)
      const ah = areaHubByKey.get(`${subjectId}\u0000${b.area}`)
      if (!target || !ah) continue
      const as = worldToScreen(ah, t)
      ctx.moveTo(as.x, as.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()
  }

  // 3) 영역 허브 점 + 이름
  const showArea = t.scale >= AREA_LABEL_MIN_SCALE
  ctx.font = `500 ${AREA_FONT_PX}px ${LABEL_FONT_FAMILY}`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const ah of guides.areaHubs) {
    if (!visibleSubjects.has(ah.subjectId)) continue
    const s = worldToScreen(ah, t)
    if (offscreen(s, 80, width, height)) continue
    const color = subjectColors[ah.subjectId] ?? palette.guideInk
    ctx.globalAlpha = 0.9 * dim
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(s.x, s.y, Math.max(2.5, 6 * t.scale), 0, Math.PI * 2)
    ctx.fill()
    if (!showArea) continue
    // 꽃잎 방향 바깥쪽으로 글자를 붙인다
    const right = Math.cos(ah.angle) >= 0
    ctx.textAlign = right ? 'left' : 'right'
    const x = s.x + (right ? 8 : -8)
    ctx.lineWidth = 3
    ctx.strokeStyle = palette.labelHalo
    ctx.strokeText(ah.area, x, s.y)
    ctx.fillStyle = readableOn(c.theme, color)
    ctx.fillText(ah.area, x, s.y)
  }

  // 4) 학년군 고리 이름 — 고리 꼭대기
  if (t.scale >= RING_LABEL_MIN_SCALE) {
    ctx.font = `500 ${RING_FONT_PX}px ${LABEL_FONT_FAMILY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (const ring of guides.rings) {
      if (!visibleSubjects.has(ring.subjectId)) continue
      const top = worldToScreen({ x: ring.cx, y: ring.cy - ring.r }, t)
      if (offscreen(top, 40, width, height)) continue
      ctx.globalAlpha = 0.85 * dim
      ctx.lineWidth = 3
      ctx.strokeStyle = palette.labelHalo
      ctx.strokeText(ring.band, top.x, top.y - 2)
      ctx.fillStyle = palette.guideInk
      ctx.fillText(ring.band, top.x, top.y - 2)
    }
  }
  ctx.restore()
}

/** 교과 허브 — 노드 위에 그린다(이름이 늘 보이게). */
export function drawConstellationHubs(ctx: CanvasRenderingContext2D, c: ConstellationDrawContext): void {
  const { guides, t, width, height, palette, subjectColors, screenById } = c
  const visibleSubjects = new Set<string>()
  for (const b of guides.branches) if (screenById.has(b.id)) visibleSubjects.add(b.subjectId)
  const dim = 1 - 0.7 * c.fade
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const hub of guides.hubs) {
    if (!visibleSubjects.has(hub.subjectId)) continue
    const s = worldToScreen(hub, t)
    const r = Math.max(6, hub.r * t.scale)
    if (offscreen(s, r + 60, width, height)) continue
    const color = subjectColors[hub.subjectId] ?? palette.guideInk
    ctx.globalAlpha = dim
    if (palette.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = 24
    }
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    const font = Math.max(13, Math.min(22, HUB_FONT_PX + r * 0.15))
    ctx.font = `700 ${font}px ${LABEL_FONT_FAMILY}`
    const y = s.y + r + font * 0.9
    ctx.lineWidth = 4
    ctx.strokeStyle = palette.labelHalo
    ctx.strokeText(hub.label, s.x, y)
    ctx.fillStyle = readableOn(c.theme, color)
    ctx.fillText(hub.label, s.x, y)
  }
  ctx.restore()
}

/** 로컬 그래프 눈금 고리 — 중심에서의 거리 = 관계 강도. */
export function drawLocalRings(
  ctx: CanvasRenderingContext2D,
  center: Point,
  rings: ReadonlyArray<{ radiusPx: number; label: string }>,
  palette: CanvasPalette,
  alpha: number,
): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.setLineDash([2, 6])
  ctx.lineWidth = 1
  ctx.font = `500 ${RING_FONT_PX}px ${LABEL_FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const ring of rings) {
    ctx.globalAlpha = 0.45 * alpha
    ctx.strokeStyle = palette.guideInk
    ctx.beginPath()
    ctx.arc(center.x, center.y, ring.radiusPx, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.9 * alpha
    ctx.fillStyle = palette.guideInk
    ctx.fillText(ring.label, center.x, center.y - ring.radiusPx + 9)
  }
  ctx.restore()
}

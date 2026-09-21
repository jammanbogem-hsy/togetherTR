'use client'

// 교육과정 분석맵 캔버스 — 사전 계산된 좌표를 그리는 경량 2D 렌더러.
//
// 좌표 원칙: 노드의 월드 좌표는 항상 에셋의 x,y 다. 정착 연출은 그 위에 가산되는
// 오프셋일 뿐이고 진행도는 시계(performance.now)에서 직접 계산하므로, 리렌더나
// 선택·검색·필터 변경이 연출을 되돌리거나 멈춰 세울 수 없다. 진행도가 1 이면
// settlePosition 은 에셋 좌표를 그대로 돌려준다.

import { useEffect, useMemo, useRef } from 'react'
import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import {
  DIMMED_ALPHA,
  LABEL_FONT_PX,
  LABEL_ZOOM_THRESHOLD,
  degreeRankNorm,
  edgeAlpha,
  isForcedLabel,
  labelText,
  placeLabels,
  sanitizeTransform,
  screenRadius,
  settlePosition,
  settleProgress,
  shouldDrawLabel,
  worldRadius,
  worldRadiusForScore,
  worldToScreen,
  type LabelCandidate,
  type Point,
} from './mapMath'
import { useMapViewport, type HitNode } from './useMapViewport'
import type { MapEdge, MapNode } from './types'

const FALLBACK_COLOR = '#94A3B8'
const BASE_EDGE_COLOR = '#C4C7C5'
const CANVAS_BG = '#F8FAFD'
const LABEL_FONT_STACK = 'var(--font-noto), system-ui, -apple-system, sans-serif'
const CULL_MARGIN_PX = 48

export interface CurriculumMapCanvasProps {
  nodes: MapNode[]
  edges: MapEdge[]
  subjectColors: Record<string, string>
  scoreById: Map<string, number>
  searchActive: boolean
  selectedId: string | null
  neighborIds: Set<string>
  alwaysLabels: boolean
  onSelect: (id: string | null) => void
  focusRequest: { id: string; nonce: number } | null
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="m3-state flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-[var(--md-on-surface-variant)] hover:text-[var(--md-primary)]"
    >
      <span className="material-symbols-rounded block h-[20px] w-[20px] overflow-hidden text-[20px] leading-[20px]">
        {icon}
      </span>
    </button>
  )
}

export default function CurriculumMapCanvas({
  nodes,
  edges,
  subjectColors,
  scoreById,
  searchActive,
  selectedId,
  neighborIds,
  alwaysLabels,
  onSelect,
  focusRequest,
}: CurriculumMapCanvasProps): React.ReactElement {
  const drawRef = useRef(0)
  const settleStartRef = useRef<number | null>(null)
  const settleArmedRef = useRef(false)

  const nodeMap = useMemo(() => {
    const map = new Map<string, MapNode>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  const degreeNorms = useMemo(() => degreeRankNorm(nodes), [nodes])

  const vp = useMapViewport({ nodes, onSelect, focusRequest })
  const { canvasRef, wrapRef, size, view, worldCenter, hoverId, setHitNodes } = vp

  // 정착 연출 시작 시각을 한 번만 잡는다 (reduced-motion 이면 연출 없음)
  useEffect(() => {
    if (settleArmedRef.current || nodes.length === 0) return
    settleArmedRef.current = true
    settleStartRef.current = prefersReducedMotion() ? null : performance.now()
  }, [nodes.length])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return
    cancelAnimationFrame(drawRef.current)

    const frame = (): void => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const t = sanitizeTransform(view)
      const progress = settleProgress(settleStartRef.current, performance.now())

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(size.width * dpr)) canvas.width = Math.round(size.width * dpr)
      if (canvas.height !== Math.round(size.height * dpr)) canvas.height = Math.round(size.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = CANVAS_BG
      ctx.fillRect(0, 0, size.width, size.height)

      // 0) 화면 좌표 + 반지름 선계산 (히트 테스트와 동일한 값)
      const screenById = new Map<string, Point>()
      const radiusById = new Map<string, number>()
      const hits: HitNode[] = []
      for (const n of nodes) {
        const pos = settlePosition(n, worldCenter, progress)
        screenById.set(n.id, worldToScreen(pos, t))
        const base = n.r ?? worldRadius(degreeNorms.get(n.id) ?? 0)
        const isResult = scoreById.has(n.id)
        const worldR = searchActive && isResult
          ? Math.max(base, worldRadiusForScore(scoreById.get(n.id) ?? 0))
          : base
        const r = screenRadius(worldR, t.scale)
        radiusById.set(n.id, r)
        hits.push({ id: n.id, x: pos.x, y: pos.y, r })
      }
      setHitNodes(hits)

      // 1) 일반 엣지 — 알파 구간별로 묶어 한 번에 stroke
      const buckets = new Map<number, Path2D>()
      const highlighted: MapEdge[] = []
      for (const e of edges) {
        const a = screenById.get(e.source)
        const b = screenById.get(e.target)
        if (!a || !b) continue
        if (selectedId && (e.source === selectedId || e.target === selectedId)) {
          highlighted.push(e)
          continue
        }
        const alpha = edgeAlpha(e.sim) * (searchActive ? 0.45 : 1) * (selectedId ? 0.4 : 1)
        const key = Math.max(1, Math.round(alpha * 20))
        let path = buckets.get(key)
        if (!path) {
          path = new Path2D()
          buckets.set(key, path)
        }
        path.moveTo(a.x, a.y)
        path.lineTo(b.x, b.y)
      }
      ctx.lineWidth = 1
      ctx.strokeStyle = BASE_EDGE_COLOR
      for (const [key, path] of buckets) {
        ctx.globalAlpha = key / 20
        ctx.stroke(path)
      }

      // 2) 선택 노드의 엣지 — 관계 유형 색으로 강조
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.85
      for (const e of highlighted) {
        const a = screenById.get(e.source)
        const b = screenById.get(e.target)
        if (!a || !b) continue
        ctx.strokeStyle = (e.relation && RELATION_COLORS[e.relation]) || FALLBACK_COLOR
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      // 3) 노드
      for (const n of nodes) {
        const s = screenById.get(n.id)
        if (!s) continue
        if (
          s.x < -CULL_MARGIN_PX || s.y < -CULL_MARGIN_PX ||
          s.x > size.width + CULL_MARGIN_PX || s.y > size.height + CULL_MARGIN_PX
        ) continue
        const r = radiusById.get(n.id) ?? 4
        const isResult = scoreById.has(n.id)
        const isSelected = n.id === selectedId
        const isNeighbor = neighborIds.has(n.id)
        let alpha = 1
        if (searchActive && !isResult && !isSelected) alpha = DIMMED_ALPHA
        else if (selectedId && !searchActive && !isSelected && !isNeighbor) alpha = 0.32
        ctx.globalAlpha = alpha
        ctx.fillStyle = subjectColors[n.subjectId] ?? FALLBACK_COLOR
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fill()
        if (isSelected || n.id === hoverId) {
          ctx.globalAlpha = 1
          ctx.lineWidth = isSelected ? 3 : 2
          ctx.strokeStyle = isSelected ? '#1F1F1F' : '#444746'
          ctx.beginPath()
          ctx.arc(s.x, s.y, r + (isSelected ? 4 : 2.5), 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // 4) 라벨 — 탐욕적 가림 제거로 절대 쌓이지 않게 한다
      ctx.font = `600 ${LABEL_FONT_PX}px ${LABEL_FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.lineJoin = 'round'
      const candidates: LabelCandidate[] = []
      const textById = new Map<string, string>()
      for (const n of nodes) {
        const s = screenById.get(n.id)
        if (!s) continue
        if (s.x < 0 || s.y < 0 || s.x > size.width || s.y > size.height) continue
        const isResult = searchActive && scoreById.has(n.id)
        const isSelected = n.id === selectedId
        const ctxLabel = {
          scale: t.scale,
          alwaysLabels,
          isResult,
          isSelected,
          isHovered: n.id === hoverId,
          isNeighbor: selectedId !== null && neighborIds.has(n.id),
        }
        if (!shouldDrawLabel(ctxLabel)) continue
        // 검색 중 흐려진 노드는 확대 전까지 라벨로 화면을 덮지 않게 한다
        if (searchActive && !isResult && !isSelected && t.scale < LABEL_ZOOM_THRESHOLD) continue
        const label = labelText(n.code, n.text, t.scale)
        const w = ctx.measureText(label).width
        const y = s.y - (radiusById.get(n.id) ?? 4) - 4
        textById.set(n.id, label)
        candidates.push({
          id: n.id,
          forced: isForcedLabel(ctxLabel),
          priority: degreeNorms.get(n.id) ?? 0,
          box: { x0: s.x - w / 2 - 3, y0: y - LABEL_FONT_PX - 2, x1: s.x + w / 2 + 3, y1: y + 3 },
        })
      }
      const drawable = placeLabels(candidates)
      ctx.globalAlpha = 1
      ctx.lineWidth = 3
      for (const c of candidates) {
        if (!drawable.has(c.id)) continue
        const n = nodeMap.get(c.id)
        const s = screenById.get(c.id)
        const label = textById.get(c.id)
        if (!n || !s || !label) continue
        const y = s.y - (radiusById.get(c.id) ?? 4) - 4
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.strokeText(label, s.x, y)
        ctx.fillStyle = subjectColors[n.subjectId] ?? '#444746'
        ctx.fillText(label, s.x, y)
      }
      ctx.globalAlpha = 1

      // 정착 연출이 끝나지 않았으면 스스로 다음 프레임을 예약한다 (자기 종료)
      if (progress < 1) drawRef.current = requestAnimationFrame(frame)
    }

    drawRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(drawRef.current)
  }, [
    canvasRef, setHitNodes, nodes, nodeMap, degreeNorms, edges, view, size, worldCenter,
    hoverId, selectedId, neighborIds, scoreById, searchActive, alwaysLabels, subjectColors,
  ])

  const hoverNode = hoverId ? nodeMap.get(hoverId) ?? null : null

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[var(--md-surface-container-low)]">
      <canvas
        ref={canvasRef}
        className="block touch-none"
        style={{
          width: size.width,
          height: size.height,
          cursor: vp.dragging ? 'grabbing' : hoverId ? 'pointer' : 'grab',
        }}
        {...vp.pointerProps}
      />

      {/* 뷰 조작 — M3 아이콘 버튼 그룹 */}
      <div
        className="absolute left-4 top-4 flex w-max items-center gap-1 rounded-full border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-1.5 py-1"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)' }}
      >
        <IconButton icon="fit_screen" label="전체 보기" onClick={vp.fitAll} />
        <IconButton icon="add" label="확대" onClick={() => vp.zoomBy(1.25)} />
        <IconButton icon="remove" label="축소" onClick={() => vp.zoomBy(0.8)} />
        <span className="shrink-0 px-1.5 text-[12px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
          {Math.round(view.scale * 100)}%
        </span>
      </div>

      {/* 호버 툴팁 */}
      {hoverNode && vp.hoverScreen && (
        <div
          className="pointer-events-none absolute z-10 max-w-[320px] rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-4 py-3"
          style={{
            left: Math.min(Math.max(8, vp.hoverScreen.x + 16), Math.max(8, size.width - 332)),
            top: Math.min(Math.max(8, vp.hoverScreen.y + 16), Math.max(8, size.height - 132)),
            boxShadow: '0 2px 6px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.1)',
          }}
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg px-2 py-0.5 text-[12px] font-medium text-white"
              style={{ backgroundColor: subjectColors[hoverNode.subjectId] ?? '#747775' }}
            >
              {hoverNode.subject}
            </span>
            <span className="text-[14px] font-medium text-[var(--md-on-surface)]">{hoverNode.code}</span>
            <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{hoverNode.band}</span>
          </div>
          <p className="text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{hoverNode.text}</p>
        </div>
      )}
    </div>
  )
}

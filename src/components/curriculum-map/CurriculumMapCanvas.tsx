'use client'

// 교육과정 분석맵 캔버스 — 사전 계산된 좌표를 그리는 경량 2D 렌더러.
// 지속 시뮬레이션 없음: 로드 시 1초 이징으로 자리만 잡고, 상태 변경 시에만 재렌더한다.
// 카메라·입력은 useMapViewport 가 담당하고 이 컴포넌트는 그리기에만 집중한다.

import { useEffect, useMemo, useRef } from 'react'
import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import {
  DIMMED_ALPHA,
  LABEL_ZOOM_THRESHOLD,
  edgeAlpha,
  radiusForDegree,
  radiusForScore,
  settlePosition,
  shouldDrawLabel,
  worldToScreen,
  type Point,
} from './mapMath'
import { useMapViewport, type HitNode } from './useMapViewport'
import type { MapEdge, MapNode } from './types'

const FALLBACK_COLOR = '#94A3B8'
const BASE_EDGE_COLOR = '#CBD5E1'
const CANVAS_BG = '#FBFCFE'
const LABEL_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif'
/** 화면 밖 노드를 건너뛸 여유 폭 */
const CULL_MARGIN_PX = 40

export interface CurriculumMapCanvasProps {
  nodes: MapNode[]
  edges: MapEdge[]
  subjectColors: Record<string, string>
  maxDegree: number
  scoreById: Map<string, number>
  searchActive: boolean
  selectedId: string | null
  neighborIds: Set<string>
  alwaysLabels: boolean
  onSelect: (id: string | null) => void
  focusRequest: { id: string; nonce: number } | null
}

export default function CurriculumMapCanvas({
  nodes,
  edges,
  subjectColors,
  maxDegree,
  scoreById,
  searchActive,
  selectedId,
  neighborIds,
  alwaysLabels,
  onSelect,
  focusRequest,
}: CurriculumMapCanvasProps): React.ReactElement {
  const drawRef = useRef(0)

  const nodeMap = useMemo(() => {
    const map = new Map<string, MapNode>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  const vp = useMapViewport({ nodes, onSelect, focusRequest })
  const { canvasRef, wrapRef, size, view, settle, worldCenter, hoverId, setHitNodes } = vp

  // ── 렌더 (상태 변경 시 1프레임만) ───────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return
    cancelAnimationFrame(drawRef.current)

    drawRef.current = requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(size.width * dpr)) canvas.width = Math.round(size.width * dpr)
      if (canvas.height !== Math.round(size.height * dpr)) canvas.height = Math.round(size.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = CANVAS_BG
      ctx.fillRect(0, 0, size.width, size.height)

      // 0) 화면 좌표 + 반지름 선계산 (히트 테스트와 같은 값을 쓴다)
      const screenById = new Map<string, Point>()
      const radiusById = new Map<string, number>()
      const hits: HitNode[] = []
      for (const n of nodes) {
        const pos = settlePosition(n, worldCenter, settle)
        screenById.set(n.id, worldToScreen(pos, view))
        const r = searchActive && scoreById.has(n.id)
          ? radiusForScore(scoreById.get(n.id) ?? 0)
          : radiusForDegree(n.degree, maxDegree)
        radiusById.set(n.id, r)
        hits.push({ id: n.id, x: pos.x, y: pos.y, r })
      }
      setHitNodes(hits)

      // 1) 일반 엣지 — 알파 구간별로 묶어 한 번에 stroke (3천여 개 대응)
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
      ctx.lineWidth = 1.8
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
          ctx.lineWidth = isSelected ? 2.5 : 1.5
          ctx.strokeStyle = isSelected ? '#202124' : '#5F6368'
          ctx.beginPath()
          ctx.arc(s.x, s.y, r + (isSelected ? 3.5 : 2), 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // 4) 라벨 — 교과 색 텍스트 + 흰 외곽선
      ctx.font = `700 ${view.scale >= 2.4 ? 12 : 11}px ${LABEL_FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3
      for (const n of nodes) {
        const s = screenById.get(n.id)
        if (!s) continue
        if (s.x < 0 || s.y < 0 || s.x > size.width || s.y > size.height) continue
        const isResult = scoreById.has(n.id)
        const isSelected = n.id === selectedId
        const show = shouldDrawLabel({
          scale: view.scale,
          alwaysLabels,
          isResult: searchActive && isResult,
          isSelected,
          isHovered: n.id === hoverId,
          isNeighbor: selectedId !== null && neighborIds.has(n.id),
        })
        if (!show) continue
        // 검색 중 흐려진 노드는 확대해도 라벨로 화면을 덮지 않게 한다
        if (searchActive && !isResult && !isSelected && view.scale < LABEL_ZOOM_THRESHOLD) continue
        const y = s.y - (radiusById.get(n.id) ?? 4) - 3
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(255,255,255,0.94)'
        ctx.strokeText(n.code, s.x, y)
        ctx.fillStyle = subjectColors[n.subjectId] ?? '#5F6368'
        ctx.fillText(n.code, s.x, y)
      }
      ctx.globalAlpha = 1
    })

    return () => cancelAnimationFrame(drawRef.current)
  }, [
    canvasRef, setHitNodes, nodes, edges, view, size, settle, worldCenter, hoverId, selectedId,
    neighborIds, scoreById, searchActive, alwaysLabels, subjectColors, maxDegree,
  ])

  const hoverNode = hoverId ? nodeMap.get(hoverId) ?? null : null

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#FBFCFE]">
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

      {/* 뷰 조작 */}
      <div className="absolute left-3 top-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={vp.fitAll}
          className="rounded-lg border border-[#DADCE0] bg-white/95 px-3 py-1.5 text-[12px] font-bold text-[#5F6368] shadow-sm transition-colors hover:border-[#1A73E8] hover:text-[#1A73E8]"
        >
          전체 보기
        </button>
        <button
          type="button"
          onClick={() => vp.zoomBy(1.25)}
          className="h-8 w-8 rounded-lg border border-[#DADCE0] bg-white/95 text-[15px] font-bold text-[#5F6368] shadow-sm transition-colors hover:border-[#1A73E8] hover:text-[#1A73E8]"
          aria-label="확대"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => vp.zoomBy(0.8)}
          className="h-8 w-8 rounded-lg border border-[#DADCE0] bg-white/95 text-[15px] font-bold text-[#5F6368] shadow-sm transition-colors hover:border-[#1A73E8] hover:text-[#1A73E8]"
          aria-label="축소"
        >
          −
        </button>
        <span className="ml-1 text-[11px] font-semibold tabular-nums text-[#9AA0A6]">
          {Math.round(view.scale * 100)}%
        </span>
      </div>

      {/* 호버 툴팁 */}
      {hoverNode && vp.hoverScreen && (
        <div
          className="pointer-events-none absolute z-10 max-w-[300px] rounded-xl border border-[#E8EAED] bg-white/97 px-3 py-2 shadow-lg"
          style={{
            left: Math.min(Math.max(8, vp.hoverScreen.x + 14), Math.max(8, size.width - 312)),
            top: Math.min(Math.max(8, vp.hoverScreen.y + 14), Math.max(8, size.height - 120)),
          }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: subjectColors[hoverNode.subjectId] ?? '#9AA0A6' }}
            />
            <span className="text-[12px] font-extrabold text-[#202124]">{hoverNode.code}</span>
            <span className="text-[11px] font-semibold text-[#5F6368]">{hoverNode.subject}</span>
            <span className="text-[10px] font-semibold text-[#9AA0A6]">{hoverNode.band}</span>
          </div>
          <p className="text-[12px] leading-snug text-[#3C4043]">{hoverNode.text}</p>
        </div>
      )}
    </div>
  )
}

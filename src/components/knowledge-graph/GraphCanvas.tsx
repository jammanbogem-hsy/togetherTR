'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GNode, GEdge, GraphRelationAnalysis, GraphPinnedStandard, GraphRelationFilter } from './types'
import {
  RELATION_COLORS, subjectColor, subjectName, normCode, nodeRadius, nodeImportance,
  edgeColor, edgeRelationLabel, hasCompletedRelationAnalysis,
  getRelationDisplayState, getRelationStatusMeta, buildFallbackRelationExplanation,
} from './constants'
import { DEFAULT_GRAPH_RELATION_TYPE } from '@/lib/knowledge-graph/domain'

interface GraphCanvasProps {
  svgRef: React.RefObject<SVGSVGElement | null>
  nodesRef: React.MutableRefObject<GNode[]>
  svgWidth: number
  svgHeight: number
  height?: number
  visibleNodes: GNode[]
  visibleEdges: GEdge[]
  centerNodeId: string | null
  popup: GNode | null
  claudeRelations: Map<string, GraphRelationAnalysis>
  chatMentionedCodes: Array<{ code: string; addedBy: string }>
  pinnedStandards: GraphPinnedStandard[]
  recommendedCenterIds: Map<string, string>
  hoveredNodeId: string | null
  algoMode: 'keyword' | 'semantic' | 'hybrid'
  relFilter: GraphRelationFilter
  onAlgoModeChange: (mode: 'keyword' | 'semantic' | 'hybrid') => void
  onRelFilterChange: (filter: GraphRelationFilter) => void
  onNodeClick: (node: GNode) => void
  onRightClick: (e: React.MouseEvent, nodeId: string) => void
  onSetHoveredNodeId: (id: string | null) => void
  onSetTooltip: (t: { nodeId: string; x: number; y: number } | null) => void
  onDragStart: (e: React.MouseEvent, nodeId: string) => void
  onDragEnd: () => void
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const LABEL_ALL_SCALE = 1.05        // 이 배율 이상이면 모든 라벨 표시
const LABEL_IMPORTANCE_MIN = 0.72   // 저배율에서 라벨을 남길 최소 중요도
const FIT_PADDING = 90
const FIT_DURATION = 460
const CLICK_MOVE_THRESHOLD = 5      // 이 픽셀 이하 이동은 클릭으로 간주 (드래그와 구분)

interface ViewTransform { x: number; y: number; scale: number }

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function GraphCanvas({
  svgRef, nodesRef, svgWidth, svgHeight, height,
  visibleNodes, visibleEdges, centerNodeId, popup, hoveredNodeId: hoveredNodeIdProp,
  claudeRelations, chatMentionedCodes, pinnedStandards, recommendedCenterIds,
  algoMode, relFilter,
  onAlgoModeChange, onRelFilterChange,
  onNodeClick, onRightClick, onSetHoveredNodeId, onSetTooltip, onDragStart, onDragEnd,
}: GraphCanvasProps) {
  const [viewTransform, setViewTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)

  // 이벤트 핸들러에서 최신 transform을 읽기 위한 ref (렌더 중 쓰지 않음 — 커밋 후 동기화)
  const viewRef = useRef(viewTransform)
  useEffect(() => { viewRef.current = viewTransform }, [viewTransform])

  // 포인터/제스처 상태
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  // 노드 클릭/드래그 판별: pointerdown 위치를 기록하고, 임계값 초과 이동 시에만 드래그로 승격
  const nodeGestureRef = useRef<{ nodeId: string; pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  // 드래그 종료 직후 뒤따르는 합성 click이 팝업을 여는 것을 차단 (중복/오작동 활성화 방지)
  const suppressClickRef = useRef(false)
  const panStartRef = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null)
  const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number; tx: number; ty: number } | null>(null)
  const fitRafRef = useRef<number>(0)

  useEffect(() => () => cancelAnimationFrame(fitRafRef.current), [])

  // ── 사전 계산: id→노드 맵 + 1홉 인접 (매 렌더 .find 제거) ──────────────
  const nodeById = useMemo(() => {
    const m = new Map<string, GNode>()
    for (const n of visibleNodes) m.set(n.id, n)
    return m
  }, [visibleNodes])

  // 강조 대상: 마우스 hover(부모 제어) 또는 키보드 focus 노드의 1홉 이웃
  const focusId = hoveredNodeIdProp ?? focusedNodeId
  const emphasis = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const e of visibleEdges) {
      if (e.source === focusId) set.add(e.target)
      if (e.target === focusId) set.add(e.source)
    }
    return set
  }, [focusId, visibleEdges])

  // ── 화면 좌표 변환 유틸 ────────────────────────────────────────────────
  const toScreen = useCallback((gx: number, gy: number) => {
    const vt = viewRef.current
    const rect = svgRef.current?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return { x: left + vt.x + gx * vt.scale, y: top + vt.y + gy * vt.scale }
  }, [svgRef])

  const toGraph = useCallback((clientX: number, clientY: number) => {
    const vt = viewRef.current
    const rect = svgRef.current?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return { x: (clientX - left - vt.x) / vt.scale, y: (clientY - top - vt.y) / vt.scale }
  }, [svgRef])

  // ── 마우스 휠 줌 (커서 기준) ───────────────────────────────────────────
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89
      setViewTransform(vt => {
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vt.scale * zoomFactor))
        const ratio = newScale / vt.scale
        return { x: mouseX - (mouseX - vt.x) * ratio, y: mouseY - (mouseY - vt.y) * ratio, scale: newScale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [svgRef])

  // ── 애니메이션 fit-to-view (reduced-motion이면 즉시 점프) ───────────────
  const animateTransformTo = useCallback((target: ViewTransform) => {
    cancelAnimationFrame(fitRafRef.current)
    if (prefersReducedMotion()) { setViewTransform(target); return }
    const start = { ...viewRef.current }
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / FIT_DURATION)
      const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setViewTransform({
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        scale: start.scale + (target.scale - start.scale) * e,
      })
      if (p < 1) fitRafRef.current = requestAnimationFrame(step)
    }
    fitRafRef.current = requestAnimationFrame(step)
  }, [])

  const fitToView = useCallback(() => {
    if (visibleNodes.length === 0) { animateTransformTo({ x: 0, y: 0, scale: 1 }); return }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of visibleNodes) {
      const r = nodeRadius(n.type, n.similarityScore, n.id === centerNodeId)
      minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r)
      minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r)
    }
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
      Math.min((svgWidth - 2 * FIT_PADDING) / bw, (svgHeight - 2 * FIT_PADDING) / bh)))
    const bcx = (minX + maxX) / 2
    const bcy = (minY + maxY) / 2
    animateTransformTo({ scale, x: svgWidth / 2 - bcx * scale, y: svgHeight / 2 - bcy * scale })
  }, [visibleNodes, centerNodeId, svgWidth, svgHeight, animateTransformTo])

  const zoomBy = useCallback((factor: number) => {
    cancelAnimationFrame(fitRafRef.current)
    setViewTransform(vt => {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vt.scale * factor))
      const cx = svgWidth / 2, cy = svgHeight / 2
      return { x: cx - (cx - vt.x) * s / vt.scale, y: cy - (cy - vt.y) * s / vt.scale, scale: s }
    })
  }, [svgWidth, svgHeight])

  // ── 노드 포인터 다운 (클릭 후보로 시작 — 드래그 확정 전까지 캡처/고정 지연) ──
  // 주의: 여기서 setPointerCapture를 즉시 호출하면 뒤따르는 click 이벤트가 SVG(캡처 대상)로
  // 재타깃되어 노드 <g>의 onClick이 발화되지 않는다(팝업이 열리지 않는 회귀의 근본 원인).
  // 따라서 이동이 임계값을 넘어 '드래그'로 확정될 때(onPointerMove)에만 캡처·고정·재가열한다.
  const onNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.stopPropagation()
    suppressClickRef.current = false
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    nodeGestureRef.current = { nodeId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false }
    setDragging(nodeId)
    onDragStart(e as unknown as React.MouseEvent, nodeId)
  }, [onDragStart])

  // ── 배경 포인터 다운 (팬/핀치 시작) ────────────────────────────────────
  const onBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    cancelAnimationFrame(fitRafRef.current)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    svgRef.current?.setPointerCapture?.(e.pointerId)

    if (pointersRef.current.size === 2) {
      // 핀치 줌 시작
      const pts = [...pointersRef.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const vt = viewRef.current
      pinchRef.current = { dist, scale: vt.scale, midX, midY, tx: vt.x, ty: vt.y }
      panStartRef.current = null
    } else {
      const vt = viewRef.current
      panStartRef.current = { mx: e.clientX, my: e.clientY, vx: vt.x, vy: vt.y }
    }
  }, [svgRef])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // 노드 제스처: 임계값 초과 이동 시에만 드래그로 승격 (그 전에는 클릭 후보로 유지)
    const gesture = nodeGestureRef.current
    if (gesture) {
      if (!gesture.moved) {
        if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) <= CLICK_MOVE_THRESHOLD) {
          return // 아직 클릭 후보 — 노드를 움직이지 않는다
        }
        gesture.moved = true
        svgRef.current?.setPointerCapture?.(gesture.pointerId) // 드래그 확정 → 포인터 캡처(화면 밖 추적)
        onDragEnd() // 드래그 시작 재가열 — 이웃이 실시간으로 반응
      }
      const node = nodesRef.current.find(n => n.id === gesture.nodeId)
      if (node) {
        const g = toGraph(e.clientX, e.clientY)
        node.fx = g.x; node.fy = g.y; node.x = g.x; node.y = g.y
      }
      return
    }

    // 핀치 줌
    const pinch = pinchRef.current
    if (pinch && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
      const rect = svgRef.current?.getBoundingClientRect()
      const left = rect?.left ?? 0
      const top = rect?.top ?? 0
      const anchorX = pinch.midX - left
      const anchorY = pinch.midY - top
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.scale * (dist / pinch.dist)))
      const ratio = newScale / pinch.scale
      setViewTransform({
        x: anchorX - (anchorX - pinch.tx) * ratio,
        y: anchorY - (anchorY - pinch.ty) * ratio,
        scale: newScale,
      })
      return
    }

    // 팬
    const panStart = panStartRef.current
    if (panStart) {
      const dx = e.clientX - panStart.mx
      const dy = e.clientY - panStart.my
      setViewTransform(vt => ({ ...vt, x: panStart.vx + dx, y: panStart.vy + dy }))
    }
  }, [nodesRef, svgRef, toGraph, onDragEnd])

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    svgRef.current?.releasePointerCapture?.(e.pointerId)

    const gesture = nodeGestureRef.current
    if (gesture && gesture.pointerId === e.pointerId) {
      if (gesture.moved) {
        // 실제 드래그 종료 — 고정 해제 후 정착. 뒤따르는 합성 click은 팝업을 열지 않도록 억제.
        const node = nodesRef.current.find(n => n.id === gesture.nodeId)
        if (node) { node.fx = undefined; node.fy = undefined }
        suppressClickRef.current = true
        onDragEnd() // 놓은 뒤 안정 정착
      }
      // 임계값 이내면 드래그가 아니므로 노드 <g>의 native click이 그대로 팝업을 연다(캡처 미적용).
      nodeGestureRef.current = null
      setDragging(null)
    }
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) panStartRef.current = null
  }, [nodesRef, onDragEnd, svgRef])

  // ── 노드 hover → 툴팁 (팬/줌 반영한 화면 좌표) ─────────────────────────
  const showTooltip = useCallback((node: GNode) => {
    onSetHoveredNodeId(node.id)
    const r = nodeRadius(node.type, node.similarityScore, node.id === centerNodeId)
    const s = toScreen(node.x, node.y)
    onSetTooltip({ nodeId: node.id, x: s.x, y: s.y - r * viewRef.current.scale - 8 })
  }, [onSetHoveredNodeId, onSetTooltip, centerNodeId, toScreen])

  // 키보드 우클릭(컨텍스트 메뉴) 대체
  const openContextViaKeyboard = useCallback((node: GNode) => {
    const s = toScreen(node.x, node.y)
    onRightClick({
      preventDefault() {}, stopPropagation() {}, clientX: s.x, clientY: s.y,
    } as unknown as React.MouseEvent, node.id)
  }, [onRightClick, toScreen])

  const scale = viewTransform.scale

  return (
    <>
      {/* 상단 컨트롤: 검색 방식 + 관계 필터 */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-auto">
        <div className="flex items-center gap-1 bg-white/85 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 p-1">
          <span className="text-[12px] font-semibold text-gray-400 px-2">검색 방식</span>
          {([
            { key: 'keyword', label: '키워드', desc: '키워드 기반 검색' },
            { key: 'semantic', label: '의미망', desc: '개념·맥락 기반 임베딩 검색' },
            { key: 'hybrid', label: '통합', desc: '의미망 + 키워드 통합' },
          ] as const).map(({ key, label, desc }) => (
            <button key={key} title={desc} onClick={() => onAlgoModeChange(key)}
              aria-pressed={algoMode === key}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all ${algoMode === key ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white/85 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 p-1 flex-wrap">
          <span className="text-[12px] font-semibold text-gray-400 px-2">관계</span>
          {([
            { key: 'all', label: '전체', color: '#111827' },
            { key: '의미연결', label: '의미', color: '#7C3AED' },
            { key: '도구-활용', label: '도구', color: '#EF4444' },
            { key: '현상-가치', label: '가치', color: '#F97316' },
            { key: '내용-표현', label: '표현', color: '#22C55E' },
            { key: '개념-적용', label: '적용', color: '#0EA5E9' },
            { key: '문제-해결', label: '해결', color: '#D946EF' },
            { key: '탐구-실천', label: '실천', color: '#84CC16' },
            { key: '원인-결과', label: '인과', color: '#F59E0B' },
          ] as { key: GraphRelationFilter; label: string; color: string }[]).map(({ key, label, color }) => (
            <button key={key} onClick={() => onRelFilterChange(key)}
              aria-pressed={relFilter === key}
              className={`px-2 py-1 rounded-lg text-[11.5px] font-semibold transition-all ${relFilter === key ? 'text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
              style={relFilter === key ? { backgroundColor: color } : { color }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* 우측 상단 에이전트 추천 멘트 */}
      <AgentHintPanel
        centerNodeId={centerNodeId}
        visibleNodes={visibleNodes}
        visibleEdges={visibleEdges}
        claudeRelations={claudeRelations}
      />

      {/* SVG */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ width: svgWidth, height: height ?? '100%', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        role="application"
        aria-label={`지식 그래프. 성취기준 ${visibleNodes.length}개, 관계 ${visibleEdges.length}개.${centerNodeId ? ' 중심 성취기준이 설정되어 있습니다.' : ' 노드를 우클릭하여 중심을 설정하세요.'}`}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <defs>
          {[
            { id: 'arrow', fill: '#94A3B8' },
            { id: 'arrow-purple', fill: '#7C3AED' },
            { id: 'arrow-blue', fill: '#2563EB' },
            { id: 'arrow-red', fill: '#EF4444' },
            { id: 'arrow-orange', fill: '#F97316' },
            { id: 'arrow-green', fill: '#22C55E' },
          ].map(({ id, fill }) => (
            <marker key={id} id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
            </marker>
          ))}
        </defs>

        <g transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.scale})`}>
          {/* 엣지 (곡선 · 저투명도 · 가중치 반영 · 1홉 강조) */}
          <g>
            {visibleEdges.map(edge => {
              const src = nodeById.get(edge.source)
              const tgt = nodeById.get(edge.target)
              if (!src || !tgt) return null

              const isManual = edge.method === 'manual'
              const isCross = isManual || edge.method.includes('tfidf') || edge.method.includes('hybrid')
              const color = edgeColor(edge.method, edge.relation)
              const markerSuffix = isManual
                ? edge.relation === '도구-활용' ? '-red' : edge.relation === '현상-가치' ? '-orange' : edge.relation === '내용-표현' ? '-green' : '-purple'
                : isCross ? '-purple' : edge.method === 'rule_based' ? '-blue' : ''
              const markerId = `arrow${markerSuffix}`

              const srcIsCenter = src.id === centerNodeId
              const tgtIsCenter = tgt.id === centerNodeId
              const isCenterEdge = srcIsCenter || tgtIsCenter
              const touchesFocus = focusId ? (edge.source === focusId || edge.target === focusId) : false
              const dimmed = !!emphasis && !touchesFocus

              // 강조/일반 상태별 투명도
              const baseOpacity = isManual ? (isCenterEdge ? 0.5 : 0.3) : isCross ? 0.36 : 0.2
              const opacity = dimmed ? 0.05 : touchesFocus ? 0.85 : baseOpacity

              // 가중치 반영 두께
              const w = Math.max(0, Math.min(1, edge.weight))
              const strokeW = (isManual && edge.relation === DEFAULT_GRAPH_RELATION_TYPE)
                ? 1
                : Math.max(0.8, 0.8 + w * 2.4) + (touchesFocus ? 1 : 0)

              const showArrow = touchesFocus || (!emphasis && isCenterEdge)
              const showLabel = (touchesFocus || (!emphasis && isCenterEdge)) && scale > 0.55

              const dx = tgt.x - src.x
              const dy = tgt.y - src.y
              const dist = Math.sqrt(dx * dx + dy * dy) || 1
              const srcR = nodeRadius(src.type, src.similarityScore, srcIsCenter) + 2
              const tgtR = nodeRadius(tgt.type, tgt.similarityScore, tgtIsCenter) + (showArrow ? 9 : 3)
              const x1 = src.x + (dx / dist) * srcR
              const y1 = src.y + (dy / dist) * srcR
              const x2 = tgt.x - (dx / dist) * tgtR
              const y2 = tgt.y - (dy / dist) * tgtR

              const mx = (x1 + x2) / 2
              const my = (y1 + y2) / 2
              const curvature = isManual ? 0.16 : 0.13
              const perpX = -dy / dist * dist * curvature
              const perpY = dx / dist * dist * curvature
              const cpX = mx + perpX
              const cpY = my + perpY
              const labelX = 0.25 * x1 + 0.5 * cpX + 0.25 * x2
              const labelY = 0.25 * y1 + 0.5 * cpY + 0.25 * y2
              const labelText = edgeRelationLabel(edge)
              const charW = 7.9

              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1},${y1} Q ${cpX},${cpY} ${x2},${y2}`}
                    fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
                    strokeOpacity={opacity}
                    markerEnd={showArrow ? `url(#${markerId})` : undefined}
                    strokeDasharray={(!isManual && !isCross) ? '4,4' : undefined}
                  />
                  {showLabel && labelText && (
                    <g transform={`translate(${labelX},${labelY})`}>
                      <rect x={-labelText.length * charW / 2 - 6} y={-10} width={labelText.length * charW + 12} height={20} rx={10} fill="rgba(255,255,255,0.92)" stroke="rgba(226,232,240,0.9)" />
                      <text textAnchor="middle" dy={4} fontSize={12} fontWeight="600" fill={color} style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'system-ui, sans-serif' }}>
                        {labelText}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
          </g>

          {/* 노드 (작은 위성 + 뚜렷한 중심 · 부드러운 halo · 라벨 정리) */}
          <g>
            {visibleNodes.map(node => {
              const isCenter = node.id === centerNodeId
              const r = nodeRadius(node.type, node.similarityScore, isCenter)
              const color = subjectColor(node.subject_id)
              const sName = subjectName(node.subject_id)
              const isPopup = popup?.id === node.id
              const isHovered = node.id === hoveredNodeIdProp
              const isFocused = node.id === focusedNodeId
              const importance = nodeImportance(node, isCenter)
              const chatMatch = chatMentionedCodes.find(c => normCode(c.code) === normCode(node.label))
              const pin = pinnedStandards.find(p => p.stdId === node.id)
                ?? (chatMatch ? { stdId: node.id, addedBy: chatMatch.addedBy, source: 'chat' as const } : undefined)

              const dimmed = !!emphasis && !emphasis.has(node.id) && !isCenter
              const nodeOpacity = dimmed ? 0.22 : 1
              const showLabel = isCenter || isFocused || (emphasis?.has(node.id) ?? false)
                || scale >= LABEL_ALL_SCALE || importance >= LABEL_IMPORTANCE_MIN

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  style={{ cursor: 'pointer', opacity: nodeOpacity, transition: 'opacity 140ms ease', outline: 'none' }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label}${sName ? ` (${sName})` : ''}${isCenter ? ', 중심 성취기준' : ''}`}
                  onPointerDown={e => onNodePointerDown(e, node.id)}
                  onPointerEnter={e => { if (e.pointerType !== 'touch') showTooltip(node) }}
                  onPointerLeave={() => { onSetHoveredNodeId(null); onSetTooltip(null) }}
                  onClick={() => {
                    // 드래그 종료 직후의 합성 click은 무시 (중복/오작동 활성화 방지)
                    if (suppressClickRef.current) { suppressClickRef.current = false; return }
                    onSetTooltip(null); onNodeClick(node)
                  }}
                  onContextMenu={e => onRightClick(e, node.id)}
                  onFocus={() => { setFocusedNodeId(node.id); showTooltip(node) }}
                  onBlur={() => { setFocusedNodeId(prev => (prev === node.id ? null : prev)); onSetTooltip(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetTooltip(null); onNodeClick(node) }
                    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openContextViaKeyboard(node) }
                  }}
                >
                  {/* 부드러운 halo */}
                  {isCenter && <circle r={r + 20} fill={color} opacity={0.06} />}
                  {isCenter && <circle r={r + 11} fill={color} opacity={0.1} />}
                  {(isHovered || isFocused) && !isCenter && <circle r={r + 9} fill={color} opacity={0.12} />}

                  {/* 상태 링 */}
                  {isCenter && <circle r={r + 6} fill="none" stroke="#D97706" strokeWidth={2.5} strokeOpacity={0.85} />}
                  {isCenter && <circle r={r + 4} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.5} />}
                  {isFocused && <circle r={r + 7} fill="none" stroke="#111827" strokeWidth={2} strokeDasharray="3,3" strokeOpacity={0.7} />}
                  {isHovered && !isCenter && !isFocused && <circle r={r + 6} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.55} />}
                  {isPopup && <circle r={r + 8} fill="none" stroke="#111827" strokeWidth={2} strokeOpacity={0.55} />}
                  {pin && !isCenter && <circle r={r + 5} fill="none" stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="4,3" strokeOpacity={0.7} />}

                  {/* 본체 */}
                  <circle
                    r={r}
                    fill={color}
                    fillOpacity={isCenter ? 0.97 : 0.9}
                    stroke="#ffffff"
                    strokeWidth={isCenter ? 2 : 1.5}
                    strokeOpacity={0.92}
                  />

                  {/* 라벨 (노드 하단, 흰색 외곽선으로 가독성 확보) */}
                  {showLabel && (() => {
                    const label = node.label
                    const fontSize = isCenter ? 13 : 10.5
                    return (
                      <text
                        y={r + (isCenter ? 15 : 12)}
                        textAnchor="middle"
                        fontSize={fontSize}
                        fontWeight={isCenter ? 700 : 600}
                        fill="#1F2937"
                        stroke="#ffffff"
                        strokeWidth={3}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                        style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'system-ui, sans-serif' }}
                      >
                        {label}
                      </text>
                    )
                  })()}
                  {isCenter && sName && (
                    <text y={r + 30} textAnchor="middle" fontSize={11} fontWeight="500" fill="#6B7280" stroke="#ffffff" strokeWidth={2.5} paintOrder="stroke" strokeLinejoin="round" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                      ({sName})
                    </text>
                  )}

                  {/* 시트 핀 배지 */}
                  {pin && (
                    <g transform={`translate(${r + 2}, ${-(r + 2)})`}>
                      <circle r={7} fill="white" stroke="#CBD5E1" />
                      <text textAnchor="middle" dy={3} fontSize={9} fontWeight="700" fill="#64748B" style={{ userSelect: 'none', pointerEvents: 'none' }}>시</text>
                    </g>
                  )}

                  {/* 추천 배지 (중심 미설정 시) */}
                  {!centerNodeId && recommendedCenterIds.has(node.id) && (
                    <g transform={`translate(0, ${-(r + 14)})`}>
                      {(() => {
                        const recommender = recommendedCenterIds.get(node.id) ?? '팀원'
                        const label = `${recommender.slice(0, 6)} 추천`
                        const wBadge = label.length * 6.9 + 12
                        return (
                          <>
                            <rect x={-wBadge / 2} y={-10} width={wBadge} height={20} rx={10} fill="#F59E0B" fillOpacity={0.95} />
                            <text textAnchor="middle" dy={4} fontSize={10} fontWeight="700" fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>{label}</text>
                          </>
                        )
                      })()}
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {/* 줌 컨트롤 */}
      <div className="absolute bottom-16 right-4 z-20 flex flex-col items-center gap-1 pointer-events-auto" role="group" aria-label="그래프 확대·축소 컨트롤">
        <button
          onClick={() => zoomBy(1.2)}
          aria-label="확대"
          className="w-10 h-10 rounded-full bg-white border border-gray-200 shadow text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold leading-none" title="확대"
        >+</button>
        <button
          onClick={fitToView}
          aria-label="화면에 맞추기"
          className="w-10 h-10 rounded-full bg-white border border-gray-200 shadow text-gray-500 hover:bg-gray-50 flex items-center justify-center text-[12px] font-bold leading-none" title="화면 맞춤"
        >⊙</button>
        <button
          onClick={() => zoomBy(0.83)}
          aria-label="축소"
          className="w-10 h-10 rounded-full bg-white border border-gray-200 shadow text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold leading-none" title="축소"
        >−</button>
      </div>
    </>
  )
}

// ── 에이전트 추천 멘트 (우측 상단) ──────────────────────────────────────

function AgentHintPanel({
  centerNodeId, visibleNodes, visibleEdges, claudeRelations,
}: {
  centerNodeId: string | null
  visibleNodes: GNode[]
  visibleEdges: GEdge[]
  claudeRelations: Map<string, GraphRelationAnalysis>
}) {
  const [showModal, setShowModal] = React.useState(false)

  if (!centerNodeId) return null
  const centerNode = visibleNodes.find(n => n.id === centerNodeId)
  if (!centerNode) return null

  const edgesFromCenter = visibleEdges.filter(e => e.source === centerNodeId || e.target === centerNodeId)
  const relCounts: Record<string, number> = {}
  edgesFromCenter.forEach(e => { relCounts[e.relation] = (relCounts[e.relation] ?? 0) + 1 })
  const topRel = Object.entries(relCounts).sort((a, b) => b[1] - a[1])[0]
  const topRelLabel = topRel ? topRel[0] : null
  const topRelColor = topRelLabel ? RELATION_COLORS[topRelLabel] : '#7C3AED'

  const connectedStds = visibleEdges
    .filter(e => e.source === centerNodeId || e.target === centerNodeId)
    .map(e => {
      const otherId = e.source === centerNodeId ? e.target : e.source
      const node = visibleNodes.find(n => n.id === otherId && n.type === 'standard' && n.id !== centerNodeId)
      return { node, edge: e }
    })
    .filter(({ node }) => !!node)
    .sort((a, b) => (b.node?.similarityScore ?? 0) - (a.node?.similarityScore ?? 0)) as { node: GNode; edge: GEdge }[]

  const connectedSubjectNames = [...new Set(connectedStds.map(({ node }) => subjectName(node.subject_id)))]
  const analyzedConnectedCount = connectedStds.filter(({ node }) => {
    const k = [centerNodeId, node.id].sort().join('||')
    return hasCompletedRelationAnalysis(claudeRelations.get(k))
  }).length

  const centerTopic = centerNode.keywords?.slice(0, 2).join('·') || centerNode.area || ''

  const bestClaudeNote = connectedStds
    .map(({ node }) => { const k = [centerNodeId, node.id].sort().join('||'); return claudeRelations.get(k) })
    .filter(r => r?.source === 'claude' && r.teachingNote)
    .sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0))[0]

  const buildHint = (rel: string | null): string => {
    const subjs = connectedSubjectNames.join('·')
    const topic = centerTopic ? `'${centerTopic}' 주제를 ` : ''
    switch (rel) {
      case '내용-표현':
        return `${topic}탐구한 뒤, ${subjs || '다른 교과'} 활동(토론·보고서·시각 작품 등)으로 창의적으로 표현하는 프로젝트 수업을 설계해보세요.`
      case '도구-활용':
        return `${subjs || '수학·실과'}의 도구와 방법을 활용하여 ${topic ? topic + '심화' : '탐구를 심화'}하는 융합 수업을 설계해보세요.`
      case '현상-가치':
        return `${topic ? topic + '탐구하고' : '현상을 탐구한 뒤'} ${subjs || '도덕·사회'} 관점에서 가치를 성찰하는 토론 수업을 추천합니다.`
      default:
        return `'${centerTopic || centerNode.label}' 개념을 중심으로 ${subjs || '여러 교과'}를 연결하는 주제 중심 수업을 설계해보세요.`
    }
  }
  const hint = bestClaudeNote?.teachingNote ?? buildHint(topRelLabel)

  // 각 연결 노드의 상세 정보를 재사용하기 위해 미리 계산
  const stdDetails = connectedStds.map(({ node }) => {
    const ck = [centerNodeId, node.id].sort().join('||')
    const cr = claudeRelations.get(ck)
    const crColor = cr ? RELATION_COLORS[cr.relationType] : topRelColor
    const explanation = hasCompletedRelationAnalysis(cr)
      ? (cr.explanation?.trim() || buildFallbackRelationExplanation(centerNode, node, cr.relationType))
      : ''
    const ideas = cr?.ideas && cr.ideas.length > 0 ? cr.ideas : undefined
    const teachingNote = cr?.teachingNote
    const relationStatus = getRelationStatusMeta(getRelationDisplayState(cr))
    return { node, cr, crColor, explanation, ideas, teachingNote, relationStatus }
  })

  return (
    <>
      {/* 연결 요약 카드 */}
      <div className="absolute top-4 right-4 z-10 w-[236px] pointer-events-auto">
        <button
          onClick={() => setShowModal(true)}
          className="w-full text-left bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-200 px-4 py-3 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-gray-700">연결 구조</span>
            <span className="text-[12px] font-semibold text-gray-400">자세히 보기</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <div className="rounded-xl bg-gray-50 px-2 py-1.5">
              <p className="text-[11px] text-gray-400">중심</p>
              <p className="mt-0.5 font-mono text-[12px] font-bold truncate" style={{ color: subjectColor(centerNode.subject_id) }}>{centerNode.label}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-2 py-1.5">
              <p className="text-[11px] text-gray-400">연결</p>
              <p className="mt-0.5 text-[13px] font-bold text-gray-700">{connectedStds.length}개</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-2 py-1.5">
              <p className="text-[11px] text-gray-400">분석</p>
              <p className="mt-0.5 text-[13px] font-bold text-gray-700">{analyzedConnectedCount}개</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {topRelLabel && <span className="h-2 w-2 rounded-full" style={{ background: topRelColor }} />}
            <p className="min-w-0 flex-1 truncate text-[12px] text-gray-500">{topRelLabel || '관계'} 중심으로 수업 예시를 만들 수 있습니다.</p>
          </div>
        </button>
      </div>

      {/* 전체 모달 */}
      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
            style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="px-6 py-4 bg-gradient-to-r from-[#7B1FA2] to-[#9C27B0] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base font-bold text-white">{analyzedConnectedCount > 0 ? 'Agent 추천 상세' : '연결 제안 상세'}</span>
                  {topRelLabel && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">{topRelLabel}</span>}
                </div>
                <div className="flex items-center gap-1.5 text-white/70 text-sm">
                  <span>중심:</span>
                  <span className="font-mono font-bold text-white">{centerNode.label}</span>
                  <span>({subjectName(centerNode.subject_id)})</span>
                  <span>· 연결 {stdDetails.length}개</span>
                </div>
              </div>
              <button className="text-white/60 hover:text-white text-2xl leading-none" onClick={() => setShowModal(false)}>×</button>
            </div>

            {/* 본문 스크롤 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* 전체 수업 제안 */}
              <div className="rounded-xl bg-[#F3E5F5]/60 border border-[#CE93D8]/50 px-4 py-3">
                <p className="text-sm font-bold text-[#7B1FA2] mb-1.5">{bestClaudeNote?.source === 'claude' ? 'Agent 수업 제안' : '융합 수업 방향'}</p>
                <p className="text-base text-gray-700 leading-relaxed whitespace-pre-wrap">{hint}</p>
              </div>

              {/* 개별 연결 카드 */}
              {stdDetails.map(({ node, cr, crColor, explanation, ideas, teachingNote, relationStatus }) => (
                <div key={node.id} className="rounded-xl border p-4" style={{ borderColor: subjectColor(node.subject_id) + '40', background: subjectColor(node.subject_id) + '06' }}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-mono font-bold text-base" style={{ color: subjectColor(node.subject_id) }}>{node.label}</span>
                    <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded" style={{ background: subjectColor(node.subject_id) + '20', color: subjectColor(node.subject_id) }}>{subjectName(node.subject_id)}</span>
                    {cr && <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: crColor, background: (crColor ?? '#999') + '18' }}>{cr.relationType}</span>}
                    <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                    {node.similarityScore !== undefined && <span className="text-[12px] text-gray-400 ml-auto">{Math.round(node.similarityScore * 100)}%</span>}
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed mb-3">{node.text}</p>

                  {/* 수업 아이디어 */}
                  {ideas && ideas.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[12px] font-semibold text-[#7B1FA2] mb-1.5 uppercase tracking-wide">수업 아이디어</p>
                      <ul className="space-y-1.5 list-none">
                        {ideas.map((idea, i) => (
                          <li key={i} className="flex gap-2 text-base">
                            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ background: i === 0 ? '#9E9E9E' : '#7B1FA2' }}>
                              {i === 0 ? '보' : '창'}
                            </span>
                            <span className="flex-1 text-gray-700 leading-relaxed">{idea}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 수업 제안 */}
                  {teachingNote && (
                    <div className="border-t pt-2" style={{ borderColor: subjectColor(node.subject_id) + '30' }}>
                      <p className="text-[12px] font-semibold text-[#7B1FA2] mb-1 uppercase tracking-wide">수업 제안 · 융합 구조</p>
                      <p className="text-base text-gray-700 leading-relaxed whitespace-pre-wrap">{teachingNote}</p>
                    </div>
                  )}

                  {/* 관계 근거 */}
                  {explanation && (
                    <div className="mt-2 pt-1.5 border-t border-gray-100">
                      <p className="text-[11px] text-gray-400 leading-relaxed">{explanation}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

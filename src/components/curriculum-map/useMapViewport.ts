'use client'

// 분석맵 뷰포트 훅 — 크기 관찰, 팬/줌, 히트 테스트 기반 호버·선택.
// 렌더링(그리기)은 CurriculumMapCanvas 가, 카메라·입력은 이 훅이 담당한다.
//
// 주의: 정착 연출(settle)의 진행도를 이 훅의 state 로 두면 안 된다. 예전 구현은
// rAF 루프를 effect 가 소유했는데, ResizeObserver 가 매번 새 size 객체를 넣어
// deps 가 흔들리면 cleanup 이 루프를 취소하고 fittedRef 가 재시작을 막아
// 진행도가 0 에서 얼어붙었다(= 모든 노드가 한 점에 그려짐). 진행도는 캔버스가
// 시계(performance.now)에서 직접 계산한다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FIT_PADDING,
  centerOn,
  computeBounds,
  easeOutCubic,
  fitToView,
  initialViewScale,
  lerpTransform,
  pickNodeAt,
  sanitizeTransform,
  screenToWorld,
  zoomAtPoint,
  type Point,
  type ViewTransform,
} from './mapMath'

const FIT_DURATION_MS = 520
/** 이 픽셀 이상 움직이면 클릭이 아니라 드래그로 본다 */
const DRAG_SLOP_PX = 3

export interface ViewportNode {
  id: string
  x: number
  y: number
}

/** 히트 테스트 대상 — 캔버스가 마지막 렌더에서 쓴 월드 좌표와 반지름 */
export interface HitNode extends Point {
  id: string
  r: number
}

export interface MapViewportOptions {
  nodes: readonly ViewportNode[]
  onSelect: (id: string | null) => void
  /** nonce 가 바뀔 때마다 해당 노드를 화면 중앙으로 */
  focusRequest: { id: string; nonce: number } | null
  /** 노드를 끌 때 월드 좌표를 전달 (힘 레이아웃이 고정핀으로 받는다) */
  onNodeDrag?: (id: string, worldX: number, worldY: number) => void
  /** 끌기 종료 — 고정핀 해제 */
  onNodeDragEnd?: (id: string) => void
  /** 노드 끌기 허용 (움직임이 꺼져 있어도 위치 이동은 허용) */
  nodeDragEnabled?: boolean
  /** 첫 화면에만 적용하는 배율 가중 — 작아서 안 읽히는 문제 보정 */
  initialZoomBoost?: number
  /** 현재(물리로 움직인) 좌표 조회 — 포커스 이동을 실제 위치에 맞춘다 */
  positionOf?: (id: string) => Point | null
  /** 중앙값 노드 반지름(월드) — 첫 화면에서 너무 작아지지 않게 하는 기준 */
  medianWorldRadius?: number
}

export interface MapViewport {
  wrapRef: React.RefObject<HTMLDivElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  size: { width: number; height: number }
  view: ViewTransform
  worldCenter: Point
  dragging: boolean
  hoverId: string | null
  hoverScreen: Point | null
  fitAll: () => void
  zoomBy: (factor: number) => void
  /** 캔버스가 매 렌더 끝에 호출 — 호버·클릭 판정의 기준이 된다 */
  setHitNodes: (list: HitNode[]) => void
  pointerProps: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
    onPointerLeave: () => void
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useMapViewport({
  nodes,
  onSelect,
  focusRequest,
  onNodeDrag,
  onNodeDragEnd,
  nodeDragEnabled = true,
  initialZoomBoost = 1.35,
  positionOf,
  medianWorldRadius = 0,
}: MapViewportOptions): MapViewport {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverScreen, setHoverScreen] = useState<Point | null>(null)
  const clearHover = useCallback(() => {
    setHoverId(null)
    setHoverScreen(null)
  }, [])

  const viewRef = useRef(view)
  const hitNodesRef = useRef<HitNode[]>([])
  const animRef = useRef(0)
  const pointersRef = useRef(new Map<number, Point>())
  const panOriginRef = useRef<{ pointer: Point; view: ViewTransform } | null>(null)
  const pinchRef = useRef<{ dist: number } | null>(null)
  const movedRef = useRef(false)
  const fittedRef = useRef(false)
  /** 노드를 끌고 있는 중이면 그 id — 이때 화면 팬은 하지 않는다 */
  const dragNodeRef = useRef<string | null>(null)
  const dragStartRef = useRef<Point | null>(null)

  // 렌더 중 ref 를 쓰지 않도록 커밋 후에 동기화한다
  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    positionOfRef.current = positionOf
  }, [positionOf])

  const positionOfRef = useRef(positionOf)

  const setHitNodes = useCallback((list: HitNode[]) => {
    hitNodesRef.current = list
  }, [])

  const hitTest = useCallback(
    (screen: Point) => pickNodeAt(screen, hitNodesRef.current, viewRef.current),
    [],
  )

  const bounds = useMemo(() => computeBounds(nodes), [nodes])
  const worldCenter = useMemo<Point>(
    () => (bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : { x: 1000, y: 1000 }),
    [bounds],
  )
  const positionById = useMemo(() => {
    const map = new Map<string, Point>()
    for (const n of nodes) map.set(n.id, { x: n.x, y: n.y })
    return map
  }, [nodes])

  // ── 카메라 애니메이션 ──────────────────────────────────────────────────
  const animateTo = useCallback((target: ViewTransform) => {
    clearHover()
    cancelAnimationFrame(animRef.current)
    if (prefersReducedMotion()) {
      setView(target)
      return
    }
    const start = { ...viewRef.current }
    const t0 = performance.now()
    const step = (now: number): void => {
      const p = Math.min(1, (now - t0) / FIT_DURATION_MS)
      setView(lerpTransform(start, target, easeOutCubic(p)))
      if (p < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
  }, [clearHover])

  const fitAll = useCallback(() => {
    if (size.width === 0 || size.height === 0) return
    animateTo(fitToView(bounds, size, FIT_PADDING))
  }, [animateTo, bounds, size])

  const zoomBy = useCallback((factor: number) => {
    clearHover()
    setView(v => zoomAtPoint(v, { x: size.width / 2, y: size.height / 2 }, factor))
  }, [clearHover, size.height, size.width])

  // ── 크기 관찰 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = (): void => {
      const rect = el.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      // 값이 같으면 이전 객체를 그대로 반환 — 참조가 바뀌면 이 훅을 쓰는 쪽의
      // effect 들이 불필요하게 재실행된다(과거 정착 연출이 취소된 원인).
      setSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── 최초 로드: 전체 보기 ────────────────────────────────────────────────
  // 애니메이션을 걸지 않는다. 여기서 rAF 루프를 돌리면 deps 변화로 취소될 수 있고,
  // 그 경우 화면이 중간 상태에서 멈춘다. 정착 연출은 캔버스가 시계로 처리한다.
  useEffect(() => {
    if (fittedRef.current || nodes.length === 0 || size.width === 0 || size.height === 0) return
    fittedRef.current = true
    const fit = fitToView(bounds, size, FIT_PADDING)
    // 첫 화면은 조금 당겨서 보여 준다 ('전체 보기' 버튼은 정확한 fit 유지)
    const target = initialViewScale(fit.scale, initialZoomBoost, medianWorldRadius)
    setView(zoomAtPoint(fit, { x: size.width / 2, y: size.height / 2 }, target / fit.scale))
  }, [bounds, initialZoomBoost, medianWorldRadius, nodes.length, size.width, size.height, size])

  // ── 외부 포커스 요청 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!focusRequest) return
    // 물리로 움직였을 수 있으므로 시드가 아니라 현재 좌표를 쓴다
    const pos = positionOfRef.current?.(focusRequest.id) ?? positionById.get(focusRequest.id)
    if (!pos || size.width === 0) return
    animateTo(centerOn(pos, size, Math.max(viewRef.current.scale, 1.5)))
  // nonce 가 바뀔 때만 카메라를 움직인다 (같은 노드 재클릭도 재중앙 정렬)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce])

  // ── 휠 줌 (커서 고정) ──────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      clearHover()
      const rect = el.getBoundingClientRect()
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      // 트랙패드 핀치는 ctrlKey 가 붙은 wheel 로 들어온다
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.02 : 0.0018))
      cancelAnimationFrame(animRef.current)
      setView(v => zoomAtPoint(v, anchor, factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [clearHover])

  // ── 포인터: 드래그 이동 + 2점 핀치 + 클릭 선택 ──────────────────────────
  const localPoint = useCallback((e: React.PointerEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Panning/pinching also moves the map away from the previous hover anchor.
    clearHover()
    const p = localPoint(e)
    pointersRef.current.set(e.pointerId, p)
    movedRef.current = false
    canvasRef.current?.setPointerCapture(e.pointerId)
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) }
      panOriginRef.current = null
      return
    }
    // 노드를 집었으면 노드를 끈다 (배경을 집었으면 화면을 끈다)
    const hitId = hitTest(p)
    if (hitId && nodeDragEnabled) {
      dragNodeRef.current = hitId
      dragStartRef.current = p
      panOriginRef.current = null
      setDragging(true)
      return
    }
    panOriginRef.current = { pointer: p, view: { ...viewRef.current } }
    setDragging(true)
  }, [clearHover, hitTest, localPoint, nodeDragEnabled])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = localPoint(e)
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p)

    // 핀치 줌 — 두 포인터의 중간점을 고정
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchRef.current.dist > 0 && dist > 0) {
        const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const factor = dist / pinchRef.current.dist
        setView(v => zoomAtPoint(v, anchor, factor))
      }
      pinchRef.current = { dist }
      movedRef.current = true
      return
    }

    const dragId = dragNodeRef.current
    if (dragId) {
      // 임계값을 넘기 전에는 클릭으로 남겨 두어 '클릭=선택'이 유지된다
      const start = dragStartRef.current
      if (start && Math.hypot(p.x - start.x, p.y - start.y) > DRAG_SLOP_PX) movedRef.current = true
      if (movedRef.current) {
        const world = screenToWorld(p, viewRef.current)
        onNodeDrag?.(dragId, world.x, world.y)
      }
      return
    }

    const origin = panOriginRef.current
    if (origin) {
      const dx = p.x - origin.pointer.x
      const dy = p.y - origin.pointer.y
      if (Math.abs(dx) > DRAG_SLOP_PX || Math.abs(dy) > DRAG_SLOP_PX) movedRef.current = true
      cancelAnimationFrame(animRef.current)
      setView(sanitizeTransform({ x: origin.view.x + dx, y: origin.view.y + dy, scale: origin.view.scale }))
      return
    }

    // 버튼을 누르지 않은 이동 → 호버 판정
    const id = hitTest(p)
    setHoverId(id)
    setHoverScreen(id ? p : null)
  }, [hitTest, localPoint, onNodeDrag])

  const endPointer = useCallback((e: React.PointerEvent) => {
    const p = localPoint(e)
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    const wasPanning = panOriginRef.current !== null
    const draggedId = dragNodeRef.current
    panOriginRef.current = null
    dragNodeRef.current = null
    dragStartRef.current = null
    setDragging(false)
    // 놓은 자리를 기준으로 호버를 다시 판정한다. 이걸 빼면 끌기 후 포인터가
    // 노드 밖에 있어도 hoverId 가 남아 화면 전체가 15%로 흐려진 채 멈춘다.
    const released = hitTest(p)
    setHoverId(released)
    setHoverScreen(released ? p : null)

    if (draggedId) {
      // 거의 움직이지 않았으면 클릭으로 보고 선택, 움직였으면 고정핀 해제
      if (movedRef.current) onNodeDragEnd?.(draggedId)
      else onSelect(draggedId)
      return
    }
    // 움직이지 않았다면 클릭 = 선택 (빈 공간 클릭은 선택 해제)
    if (wasPanning && !movedRef.current) onSelect(released)
  }, [hitTest, localPoint, onNodeDragEnd, onSelect])

  useEffect(() => () => cancelAnimationFrame(animRef.current), [])

  return {
    wrapRef,
    canvasRef,
    size,
    view,
    worldCenter,
    dragging,
    hoverId,
    hoverScreen,
    fitAll,
    zoomBy,
    setHitNodes,
    pointerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onPointerLeave: clearHover,
    },
  }
}

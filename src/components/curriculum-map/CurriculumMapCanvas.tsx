'use client'

// 교육과정 분석맵 캔버스 — 상태·입력을 다루고 그리기는 drawMap 에 위임한다.
//
// 좌표계: 에셋 좌표 × K(가독성 배수)를 "레이아웃 공간"으로 쓴다. 반지름에도 같은 K 를
// 곱하므로 빌더가 보장한 겹침 없는 배치가 확대해도 유지된다. K 를 반지름에만 곱하면
// 원이 서로 겹쳐 보인다(실제 결함이었다).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RENDER_RADIUS_SCALE,
  degreeRankNorm,
  drawWorldRadius,
  medianRadius,
  sanitizeTransform,
  worldRadius,
  type Point,
} from './mapMath'
import { REHEAT_CHANGE } from './forceMath'
import { drawMap, type RelatedMeta } from './drawMap'
import { useForceLayout } from './useForceLayout'
import { useMapViewport } from './useMapViewport'
import { scaleGridGuides, type GridGuides } from './gridLayout'
import MapTooltip from './MapTooltip'
import { ICON_FONT_SPEC } from './subjectIcons'
import type { MapEdge, MapLayoutMode, MapNode } from './types'

export type { RelatedMeta }

export interface CurriculumMapCanvasProps {
  nodes: MapNode[]
  /** 필터에 가려졌지만 선택 노드의 관련 항목이라 점선으로 보여 줄 노드 */
  ghostNodes: MapNode[]
  edges: MapEdge[]
  subjectColors: Record<string, string>
  scoreById: Map<string, number>
  searchActive: boolean
  selectedId: string | null
  alwaysLabels: boolean
  physicsEnabled: boolean
  /** /related 결과. 비어 있으면(로딩 중 포함) 관계선을 그리지 않는다 */
  relatedMeta: Map<string, RelatedMeta>
  /** /related 응답 대기 중 — 에셋 이웃을 잠정 선택으로 보여 준다 */
  relatedPending: boolean
  externalHoverId: string | null
  onSelect: (id: string | null) => void
  onClearSelection: () => void
  focusRequest: { id: string; nonce: number } | null
  /** 현재 배치 방식 — 'grid' 면 guides 를 그리고 끌어 옮기기를 막는다 */
  layoutMode: MapLayoutMode
  onLayoutChange: (mode: MapLayoutMode) => void
  /** 정렬 배치 안내선(에셋 좌표). 유사도 지도에서는 null */
  guides: GridGuides | null
}

const LAYOUT_OPTIONS: Array<{ mode: MapLayoutMode; label: string; title: string }> = [
  { mode: 'grid', label: '정렬', title: '교과 × 학년군 × 영역 순서로 정렬 — 위치는 문서 속성만으로 정해집니다' },
  { mode: 'similarity', label: '유사도', title: '문장 의미가 비슷할수록 가깝게 — 거리는 근사치입니다' },
]

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
  ghostNodes,
  edges,
  subjectColors,
  scoreById,
  searchActive,
  selectedId,
  alwaysLabels,
  physicsEnabled,
  relatedMeta,
  relatedPending,
  externalHoverId,
  onSelect,
  onClearSelection,
  focusRequest,
  layoutMode,
  onLayoutChange,
  guides,
}: CurriculumMapCanvasProps): React.ReactElement {
  const isGrid = layoutMode === 'grid'
  const drawRef = useRef<() => void>(() => {})
  const onTick = useCallback(() => drawRef.current(), [])
  // 아이콘 폰트가 준비될 때까지는 원만 그린다 (준비되면 상태 변경으로 재렌더)
  const [iconFontReady, setIconFontReady] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    document.fonts
      .load(ICON_FONT_SPEC)
      .then(faces => {
        if (!cancelled && faces.length > 0) setIconFontReady(true)
      })
      .catch(() => {
        // 폰트를 못 받으면 원만 그린다 — 리거처 이름이 글자로 보이는 것보다 낫다
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 에셋 좌표 × K = 레이아웃 공간. 반지름과 같은 배수라 겹침이 생기지 않는다.
  const layoutNodes = useMemo<MapNode[]>(
    () => [...nodes, ...ghostNodes].map(n => ({
      ...n,
      x: n.x * RENDER_RADIUS_SCALE,
      y: n.y * RENDER_RADIUS_SCALE,
    })),
    [nodes, ghostNodes],
  )
  const ghostIds = useMemo(() => new Set(ghostNodes.map(n => n.id)), [ghostNodes])
  // 안내선도 노드 좌표와 같은 K 를 곱한다
  const layoutGuides = useMemo(
    () => (guides ? scaleGridGuides(guides, RENDER_RADIUS_SCALE) : null),
    [guides],
  )

  const nodeMap = useMemo(() => {
    const map = new Map<string, MapNode>()
    for (const n of layoutNodes) map.set(n.id, n)
    return map
  }, [layoutNodes])

  const degreeNorms = useMemo(() => degreeRankNorm(layoutNodes), [layoutNodes])

  // 그리기와 충돌이 같은 반지름을 쓴다 (선택·결과 강조로 키우지 않는다)
  const radiusOf = useCallback(
    (node: MapNode) => drawWorldRadius(node.r ?? worldRadius()),
    [],
  )

  const medianWorldRadius = useMemo(
    () => medianRadius(layoutNodes.map(radiusOf)),
    [layoutNodes, radiusOf],
  )

  const force = useForceLayout({ nodes: layoutNodes, edges, radiusOf, enabled: physicsEnabled, onTick })
  const { nodeMapRef, reheat, pinNode, unpinNode } = force

  const positionOf = useCallback((id: string): Point | null => {
    const sim = nodeMapRef.current.get(id)
    return sim ? { x: sim.x, y: sim.y } : null
  }, [nodeMapRef])

  const vp = useMapViewport({
    nodes: layoutNodes,
    onSelect,
    focusRequest,
    // 정렬 배치에서는 자리가 곧 의미라 끌어 옮기지 않는다
    onNodeDrag: isGrid ? undefined : pinNode,
    onNodeDragEnd: isGrid ? undefined : unpinNode,
    positionOf,
    medianWorldRadius,
    initialFit: isGrid ? 'width-top' : 'all',
  })
  const { canvasRef, wrapRef, size, view, hoverId, setHitNodes } = vp

  useEffect(() => {
    reheat(REHEAT_CHANGE)
  }, [reheat, selectedId, searchActive])

  // 호버 강조는 에셋 엣지(유사도 이웃)를 쓴다 — Jev 관계와 구분해 표시한다
  const focusId = hoverId ?? externalHoverId
  const focusNeighbors = useMemo(() => {
    const set = new Set<string>()
    if (!focusId) return set
    for (const e of edges) {
      if (e.source === focusId) set.add(e.target)
      else if (e.target === focusId) set.add(e.source)
    }
    return set
  }, [edges, focusId])

  // 선택 노드의 에셋 이웃 — /related 응답 전까지의 잠정 선택 집합
  const selectedNeighbors = useMemo(() => {
    const set = new Set<string>()
    if (!selectedId) return set
    for (const e of edges) {
      if (e.source === selectedId) set.add(e.target)
      else if (e.target === selectedId) set.add(e.source)
    }
    return set
  }, [edges, selectedId])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(size.width * dpr)) canvas.width = Math.round(size.width * dpr)
    if (canvas.height !== Math.round(size.height * dpr)) canvas.height = Math.round(size.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { hits } = drawMap(ctx, {
      width: size.width,
      height: size.height,
      view: sanitizeTransform(view),
      nodes: layoutNodes,
      edges,
      sim: nodeMapRef.current,
      ghostIds,
      subjectColors,
      degreeNorms,
      radiusOf,
      scoreById,
      searchActive,
      selectedId,
      focusId,
      focusNeighbors,
      relatedMeta,
      selectedNeighbors,
      relatedPending,
      alwaysLabels,
      iconFontReady,
      guides: layoutGuides,
    })
    setHitNodes(hits)
  }, [
    canvasRef, setHitNodes, nodeMapRef, layoutNodes, ghostIds, degreeNorms, radiusOf, edges,
    view, size, focusId, focusNeighbors, selectedId, selectedNeighbors, relatedPending,
    scoreById, searchActive, alwaysLabels, subjectColors, relatedMeta, iconFontReady, layoutGuides,
  ])

  // 물리 루프와 상태 변경이 같은 draw 를 부른다
  useEffect(() => {
    drawRef.current = draw
    draw()
  }, [draw])

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

      <div
        className="absolute left-4 top-4 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-1 rounded-[24px] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-1.5 py-1"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)' }}
      >
        <IconButton icon="fit_screen" label="전체 보기" onClick={vp.fitAll} />
        <IconButton icon="add" label="확대" onClick={() => vp.zoomBy(1.25)} />
        <IconButton icon="remove" label="축소" onClick={() => vp.zoomBy(0.8)} />
        <span className="shrink-0 px-1.5 text-[13px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
          {Math.round(view.scale * 100)}%
        </span>
        <div
          role="radiogroup"
          aria-label="배치 방식"
          className="ml-1 flex shrink-0 items-center rounded-full bg-[var(--md-surface-container-high)] p-0.5"
        >
          {LAYOUT_OPTIONS.map(option => (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={layoutMode === option.mode}
              title={option.title}
              onClick={() => onLayoutChange(option.mode)}
              className={`m3-state h-9 rounded-full px-3 text-[13px] font-medium ${
                layoutMode === option.mode
                  ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
                  : 'text-[var(--md-on-surface-variant)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {selectedId && (
          <button
            type="button"
            onClick={onClearSelection}
            className="m3-state ml-0.5 flex h-10 shrink-0 items-center gap-1 rounded-full bg-[var(--md-secondary-container)] px-3 text-[14px] font-medium text-[var(--md-on-secondary-container)]"
          >
            <span className="material-symbols-rounded block h-[18px] w-[18px] overflow-hidden text-[18px] leading-[18px]">
              close
            </span>
            선택 해제
          </button>
        )}
      </div>

      <p
        className="pointer-events-none absolute bottom-3 left-4 max-w-[calc(100%-2rem)] rounded-lg bg-[var(--md-surface)]/90 px-3 py-1.5 text-[12px] leading-[1.5] text-[var(--md-on-surface-variant)]"
      >
        {isGrid
          ? '정렬 배치: 행 = 교과, 열 = 학년군, 칸 안 = 영역·코드 순서. 가깝다고 관련 있는 것은 아닙니다 — 관계는 성취기준을 눌러 색 선과 패널로 확인하세요.'
          : '유사도 지도: 문장 의미가 비슷할수록 가깝게 놓았지만 거리는 근사치입니다. 정확한 관계는 성취기준을 눌러 확인하세요.'}
      </p>

      {hoverNode && vp.hoverScreen && (
        <MapTooltip
          node={hoverNode}
          color={subjectColors[hoverNode.subjectId] ?? '#747775'}
          anchor={vp.hoverScreen}
          viewport={size}
          relation={hoverNode.id === selectedId ? undefined : relatedMeta.get(hoverNode.id)}
          similarityNeighbor={focusNeighbors.size > 0 && !relatedMeta.has(hoverNode.id)}
          ghost={ghostIds.has(hoverNode.id)}
        />
      )}
    </div>
  )
}

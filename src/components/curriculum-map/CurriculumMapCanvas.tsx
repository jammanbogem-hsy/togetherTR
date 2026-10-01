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
import {
  LOCAL_MIN_RADIUS,
  LOCAL_RADIUS_RANGE,
  LOCAL_RINGS,
  computeLocalLayout,
  localRadiusForStrength,
  scaleConstellationGuides,
  type ConstellationGuides,
} from './constellationLayout'
import { CANVAS_PALETTES, type CanvasTheme } from './mapTheme'
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
  /** 표 배치 안내선(에셋 좌표). 다른 배치에서는 null */
  guides: GridGuides | null
  /** 성좌 배치 구조 요소(에셋 좌표). 다른 배치에서는 null */
  constellation: ConstellationGuides | null
  canvasTheme: CanvasTheme
  onCanvasThemeChange: (theme: CanvasTheme) => void
}

const LAYOUT_OPTIONS: Array<{ mode: MapLayoutMode; label: string; title: string }> = [
  { mode: 'constellation', label: '성좌', title: '교과 허브 둘레에 영역 방향으로 — 허브에서 멀수록 높은 학년군' },
  { mode: 'grid', label: '표', title: '교과 × 학년군 × 영역 순서로 정렬한 표' },
  { mode: 'similarity', label: '유사도', title: '문장 의미가 비슷할수록 가깝게 — 거리는 근사치입니다' },
]

const LEGENDS: Record<MapLayoutMode, string> = {
  constellation: '성좌: 큰 점 = 교과, 방향 = 영역, 교과에서 멀수록 높은 학년군(점선 고리). 성취기준을 누르면 관련 성취기준이 둘레로 모이고, 가까울수록 관계가 강합니다.',
  grid: '표: 교과 묶음(국수과사·도미음체·영실통합)을 나란히, 행 = 교과, 열 = 학년군, 칸 안 = 영역·코드 순서. 관계는 성취기준을 눌러 색 선과 패널로 확인하세요.',
  similarity: '유사도 지도: 문장 의미가 비슷할수록 가깝게 놓았지만 거리는 근사치입니다. 정확한 관계는 성취기준을 눌러 확인하세요.',
}

/** 로컬 그래프로 모이고 흩어지는 시간(ms) */
const LOCAL_TRANSITION_MS = 480

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
  constellation,
  canvasTheme,
  onCanvasThemeChange,
}: CurriculumMapCanvasProps): React.ReactElement {
  const isGrid = layoutMode === 'grid'
  const isConstellation = layoutMode === 'constellation'
  const palette = CANVAS_PALETTES[canvasTheme]
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
  const layoutConstellation = useMemo(
    () => (constellation ? scaleConstellationGuides(constellation, RENDER_RADIUS_SCALE) : null),
    [constellation],
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
    // 표·성좌 배치에서는 자리가 곧 의미라 끌어 옮기지 않는다
    onNodeDrag: layoutMode === 'similarity' ? pinNode : undefined,
    onNodeDragEnd: layoutMode === 'similarity' ? unpinNode : undefined,
    positionOf,
    medianWorldRadius,
    initialFit: isGrid ? 'width-top' : isConstellation ? 'exact' : 'all',
  })
  const { canvasRef, wrapRef, size, view, hoverId, setHitNodes, flyTo } = vp

  // ── 로컬 그래프(성좌 배치에서 선택 + 관련 판정 완료) ───────────────────
  const localActive = isConstellation && Boolean(selectedId) && !relatedPending && relatedMeta.size > 0
  const localLayout = useMemo(() => {
    if (!localActive || !selectedId) return null
    const c = nodeMap.get(selectedId)
    if (!c) return null
    const center = { x: c.x, y: c.y }
    const related = [...relatedMeta.entries()]
      .filter(([id]) => id !== selectedId)
      .map(([id, m]) => ({ id, relationType: m.relationType, strength: m.strength }))
    return { center, targets: computeLocalLayout(center, related, RENDER_RADIUS_SCALE) }
  }, [localActive, nodeMap, relatedMeta, selectedId])
  // 흩어질 때도 마지막 자리에서 제자리로 돌아가야 하므로 마지막 배치를 기억한다
  const lastLocalRef = useRef<typeof localLayout>(null)
  if (localLayout) lastLocalRef.current = localLayout
  const localProgressRef = useRef(0)
  const localRings = useMemo(
    () => LOCAL_RINGS.map(r => ({
      radius: localRadiusForStrength(r.strength) * RENDER_RADIUS_SCALE,
      label: `안쪽 ${r.label} (${r.strength.toFixed(2)}↑)`,
    })),
    [],
  )

  useEffect(() => {
    const target = localLayout ? 1 : 0
    const from = localLayout ? 0 : localProgressRef.current
    if (from === target) return
    let raf = 0
    const started = performance.now()
    const step = (): void => {
      const p = Math.min(1, (performance.now() - started) / LOCAL_TRANSITION_MS)
      localProgressRef.current = from + (target - from) * p
      drawRef.current()
      if (p < 1) raf = requestAnimationFrame(step)
      else if (target === 0) lastLocalRef.current = null
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [localLayout])

  // 로컬 그래프가 열리면 카메라를 그 둘레에 맞춘다
  useEffect(() => {
    if (!localLayout || size.width === 0) return
    const outer = (LOCAL_MIN_RADIUS + LOCAL_RADIUS_RANGE + 40) * RENDER_RADIUS_SCALE
    const scale = (Math.min(size.width, size.height) * 0.46) / outer
    flyTo(localLayout.center, scale)
  // 선택·판정이 바뀔 때만 이동한다(창 크기 변화로 다시 날지 않게)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localLayout])

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
      constellation: layoutConstellation,
      local: lastLocalRef.current
        ? { ...lastLocalRef.current, progress: localProgressRef.current, rings: localRings }
        : null,
      theme: canvasTheme,
    })
    setHitNodes(hits)
  }, [
    canvasRef, setHitNodes, nodeMapRef, layoutNodes, ghostIds, degreeNorms, radiusOf, edges,
    view, size, focusId, focusNeighbors, selectedId, selectedNeighbors, relatedPending,
    scoreById, searchActive, alwaysLabels, subjectColors, relatedMeta, iconFontReady, layoutGuides,
    layoutConstellation, localRings, canvasTheme,
  ])

  // 물리 루프와 상태 변경이 같은 draw 를 부른다
  useEffect(() => {
    drawRef.current = draw
    draw()
  }, [draw])

  const hoverNode = hoverId ? nodeMap.get(hoverId) ?? null : null

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" style={{ backgroundColor: palette.bg }}>
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
        <IconButton
          icon={canvasTheme === 'dark' ? 'light_mode' : 'dark_mode'}
          label={canvasTheme === 'dark' ? '밝은 캔버스' : '어두운 캔버스'}
          onClick={() => onCanvasThemeChange(canvasTheme === 'dark' ? 'light' : 'dark')}
        />
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
        className="pointer-events-none absolute bottom-3 left-4 max-w-[min(720px,calc(100%-2rem))] rounded-lg px-3 py-1.5 text-[12px] leading-[1.5]"
        style={{
          backgroundColor: canvasTheme === 'dark' ? 'rgba(33,36,43,0.85)' : 'rgba(255,255,255,0.9)',
          color: palette.guideInk,
        }}
      >
        {LEGENDS[layoutMode]}
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

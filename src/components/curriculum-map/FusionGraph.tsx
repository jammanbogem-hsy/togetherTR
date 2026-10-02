'use client'

// 교육과정 분석맵 — 융합 묶음 그래프(옵시디언 그래프 보기 느낌, 밝은 바탕).
// 핵심 성취기준 하나를 가운데 고정하고, 같은 학년군 다른 교과의 융합 짝을 힘 배치로 둘레에 모은다.
//  - 핵심↔짝 선: 색 = 융합 방식, 굵기·길이 = 엮기 자연스러움(강할수록 굵고 가깝다)
//  - 짝↔짝 선: 지도 에셋의 교과 간 링크·유사도 이웃(옅은 회색) — 짝끼리도 그물처럼 이어진다
//  - 노드는 끌어 옮길 수 있고(놓으면 다시 자리를 찾는다), 올리면 이웃만 밝게 남는다.
// ✕ 를 누르면 겹층이 사라지고 아래에 그대로 있던 원래 지도로 돌아간다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import { RELATION_TYPE_HINTS } from './MapFusionBits'
import {
  FUSION_ALPHA_MIN,
  FUSION_ALPHA_START,
  computeFusionLayout,
  fusionAlphaStep,
  fusionForceTick,
  type FusionForceLink,
  type FusionForceNode,
} from './fusionLayout'
import type { FusionState } from './useCurriculumMap'
import type { MapEdge, MapNode } from './types'

/** 이 강도 미만은 '약한 연결' — 기본으로 숨긴다 */
export const FUSION_STRONG_MIN = 0.5
const FALLBACK = '#94A3B8'
const BG = '#FBFBFC'
const INK = '#1F2328'
const MUTED = '#5F6672'
const EDGE = '#C3C8D0'
const GOLD = '#E3A400'
const NODE_R = 13
const HUB_R = 26
/** 끌기를 놓았을 때 다시 데우는 정도 */
const REHEAT = 0.5

export interface FusionGraphProps {
  fusion: FusionState
  hubNode: MapNode | null
  nodeById: Map<string, MapNode>
  /** 짝끼리의 연결선(에셋의 교과 간 링크·유사도 이웃) */
  edges: readonly MapEdge[]
  subjectColors: Record<string, string>
  subjectOrder: readonly string[]
  subjectNames: Record<string, string>
  showWeak: boolean
  onShowWeakChange: (value: boolean) => void
  focusedId: string | null
  onFocus: (id: string | null) => void
  onClose: () => void
  onRetry: () => void
}

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(cx + Math.cos(a) * radius).toFixed(1)},${(cy + Math.sin(a) * radius).toFixed(1)}`)
  }
  return pts.join(' ')
}

const HUB_ID = '__hub__'

export default function FusionGraph({
  fusion,
  hubNode,
  nodeById,
  edges,
  subjectColors,
  subjectOrder,
  subjectNames,
  showWeak,
  onShowWeakChange,
  focusedId,
  onFocus,
  onClose,
  onRetry,
}: FusionGraphProps): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  // 시뮬레이션 좌표는 ref 에 두고, 그릴 때만 frame 상태로 다시 렌더한다
  const simRef = useRef<{ nodes: FusionForceNode[]; links: FusionForceLink[]; alpha: number } | null>(null)
  const [frame, setFrame] = useState(0)
  const dragRef = useRef<{ index: number; pointerId: number; moved: boolean } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = (): void => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const strongCount = fusion.items.filter(i => i.strength >= FUSION_STRONG_MIN).length
  const weakCount = fusion.items.length - strongCount
  // 강한 연결이 너무 적으면(3개 미만) 약한 것도 함께 보여 준다 — 빈 그래프보다 낫다
  const effectiveShowWeak = showWeak || strongCount < 3
  const shown = useMemo(
    () => fusion.items.filter(i => effectiveShowWeak || i.strength >= FUSION_STRONG_MIN),
    [effectiveShowWeak, fusion.items],
  )
  const floor = effectiveShowWeak ? 0 : FUSION_STRONG_MIN

  const bound = Math.max(150, Math.min(size.w, size.h) / 2 - 64)
  const rMin = Math.max(HUB_R + NODE_R + 50, bound * 0.36)
  const rMax = bound * 0.92

  const shownIds = useMemo(() => new Set(shown.map(i => i.id)), [shown])
  const peerEdges = useMemo(
    () => edges.filter(e => e.source !== e.target && shownIds.has(e.source) && shownIds.has(e.target)),
    [edges, shownIds],
  )

  // ── 시뮬레이션 시작: 부채꼴 자리(교과별 방향, 강도별 거리)를 출발점으로 ──
  const itemsKey = `${shown.map(i => i.id).join(',')}|${Math.round(bound)}`
  useEffect(() => {
    const seed = computeFusionLayout(
      shown.map(i => ({ id: i.id, subjectId: i.subjectId, strength: i.strength })),
      subjectOrder,
      rMin,
      rMax,
      floor,
    )
    const span = Math.max(1e-6, 1 - floor)
    const nodes: FusionForceNode[] = [
      { id: HUB_ID, x: 0, y: 0, vx: 0, vy: 0, fixed: true },
      ...shown.map(i => {
        const p = seed.positions.get(i.id) ?? { x: 0, y: 0 }
        return { id: i.id, x: p.x, y: p.y, vx: 0, vy: 0, fixed: false, homeX: p.x, homeY: p.y }
      }),
    ]
    const indexById = new Map(nodes.map((n, idx) => [n.id, idx]))
    const links: FusionForceLink[] = shown.map(i => {
      const norm = Math.min(1, Math.max(0, (i.strength - floor) / span))
      return { a: 0, b: indexById.get(i.id)!, rest: rMin + (1 - norm) * (rMax - rMin), k: 0.25 + norm * 0.45 }
    })
    for (const e of peerEdges) {
      const a = indexById.get(e.source)
      const b = indexById.get(e.target)
      if (a === undefined || b === undefined) continue
      links.push({ a, b, rest: Math.max(90, rMin * 0.8), k: 0.12 + e.sim * 0.2 })
    }
    simRef.current = { nodes, links, alpha: FUSION_ALPHA_START }
    setFrame(f => f + 1)
  // 항목 묶음·화면 크기가 바뀔 때만 새로 시작한다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey])

  // ── 시뮬레이션 루프 ──
  useEffect(() => {
    let raf = 0
    const step = (): void => {
      const sim = simRef.current
      if (sim && (sim.alpha > FUSION_ALPHA_MIN || dragRef.current)) {
        // 숨김 탭에서는 rAF 가 멈추므로 한 번에 여러 틱을 돌려 따라잡을 필요는 없다
        for (let k = 0; k < 2; k++) {
          fusionForceTick(sim.nodes, sim.links, Math.max(sim.alpha, dragRef.current ? 0.3 : 0), { collide: NODE_R * 2 + 26, bound })
          sim.alpha = fusionAlphaStep(sim.alpha)
        }
        setFrame(f => (f + 1) % 1_000_000)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [bound])

  // 숨김 탭으로 열린 경우(rAF 정지) 화면이 출발점에 머물러도 겹치지 않게, 처음 한 번 동기 정착
  useEffect(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') return
    const sim = simRef.current
    if (!sim) return
    while (sim.alpha > FUSION_ALPHA_MIN) {
      fusionForceTick(sim.nodes, sim.links, sim.alpha, { collide: NODE_R * 2 + 26, bound })
      sim.alpha = fusionAlphaStep(sim.alpha)
    }
    setFrame(f => f + 1)
  }, [bound, itemsKey])

  // ── 끌기 ──
  const toLocal = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
  }, [])

  const onNodePointerDown = (e: React.PointerEvent, id: string): void => {
    const sim = simRef.current
    if (!sim) return
    const index = sim.nodes.findIndex(n => n.id === id)
    if (index <= 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { index, pointerId: e.pointerId, moved: false }
    sim.nodes[index].fixed = true
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    const sim = simRef.current
    if (!drag || !sim || drag.pointerId !== e.pointerId) return
    const p = toLocal(e.clientX, e.clientY)
    const r = Math.hypot(p.x, p.y)
    const k = r > bound ? bound / r : 1
    const node = sim.nodes[drag.index]
    if (Math.hypot(node.x - p.x * k, node.y - p.y * k) > 2) drag.moved = true
    node.x = p.x * k
    node.y = p.y * k
    sim.alpha = Math.max(sim.alpha, 0.3)
  }
  const endDrag = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    const sim = simRef.current
    if (!drag || !sim || drag.pointerId !== e.pointerId) return
    const node = sim.nodes[drag.index]
    node.fixed = false
    sim.alpha = Math.max(sim.alpha, REHEAT)
    dragRef.current = null
    // 끌지 않고 눌렀다 뗀 것은 선택
    if (!drag.moved) onFocus(focusedId === node.id ? null : node.id)
  }

  // ── 그릴 좌표 ──
  void frame
  const pos = new Map<string, { x: number; y: number }>()
  for (const n of simRef.current?.nodes ?? []) pos.set(n.id, { x: n.x, y: n.y })
  const posOf = (id: string): { x: number; y: number } => pos.get(id) ?? { x: 0, y: 0 }

  const activeId = hoverId ?? focusedId
  const neighborIds = useMemo(() => {
    if (!activeId) return null
    const set = new Set<string>([activeId])
    for (const e of peerEdges) {
      if (e.source === activeId) set.add(e.target)
      if (e.target === activeId) set.add(e.source)
    }
    return set
  }, [activeId, peerEdges])
  const isLit = (id: string): boolean => !neighborIds || neighborIds.has(id)

  const relationsPresent = [...new Set(shown.map(i => i.relationType))]
  const hoverItem = hoverId ? fusion.items.find(i => i.id === hoverId) ?? null : null
  const hubColor = hubNode ? subjectColors[hubNode.subjectId] ?? GOLD : GOLD

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-20 overflow-hidden"
      style={{ background: BG, backgroundImage: 'radial-gradient(#E4E7EC 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      role="dialog"
      aria-label="융합 묶음 그래프"
    >
      {/* 머리글 */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[min(560px,calc(100%-180px))]">
        <div className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: INK }}>
          <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden>
            <polygon points={starPoints(0, 0, 9)} fill={GOLD} />
          </svg>
          융합 묶음{fusion.query ? ` · ‘${fusion.query}’` : ''}
        </div>
        {hubNode && (
          <p className="mt-1 text-[13px] leading-[1.5]" style={{ color: MUTED }}>
            중심 {hubNode.code} {hubNode.subject} · {hubNode.band} — 같은 학년군의 다른 교과 중 이 주제로 함께 엮을 수 있는 성취기준.
            노드를 끌어 옮길 수 있습니다.
          </p>
        )}
      </div>

      {/* 원래 지도로 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 items-center gap-1.5 rounded-full border border-[#D5D9E0] bg-white px-4 text-[14px] font-medium shadow-sm transition-colors hover:bg-[#F1F3F6]"
        style={{ color: INK }}
        aria-label="융합 보기 닫고 원래 지도로"
        title="원래 지도로 (Esc)"
      >
        <span className="material-symbols-rounded text-[20px] leading-none">close</span>
        원래 지도로
      </button>

      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        onClick={() => onFocus(null)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* 짝끼리의 연결 — 옅은 회색 그물 */}
        {peerEdges.map(e => {
          const a = posOf(e.source)
          const b = posOf(e.target)
          const lit = activeId !== null && (e.source === activeId || e.target === activeId)
          return (
            <line
              key={`${e.source}-${e.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={lit ? '#7A828F' : EDGE}
              strokeOpacity={activeId && !lit ? 0.35 : 0.9}
              strokeWidth={lit ? 1.6 : 1}
            />
          )
        })}

        {/* 핵심 → 짝: 색 = 융합 방식, 굵기 = 강도 */}
        {shown.map(item => {
          const p = posOf(item.id)
          const color = RELATION_COLORS[item.relationType] ?? FALLBACK
          const weak = item.strength < FUSION_STRONG_MIN
          const lit = activeId === item.id
          return (
            <g key={`edge-${item.id}`} style={{ opacity: activeId && !lit ? 0.22 : 1 }}>
              <line
                x1={0}
                y1={0}
                x2={p.x}
                y2={p.y}
                stroke={color}
                strokeOpacity={weak ? 0.5 : 0.75}
                strokeWidth={1 + item.strength * 2.6 + (lit ? 1 : 0)}
                strokeDasharray={weak ? '5 5' : undefined}
              />
              {lit && (
                <g transform={`translate(${p.x * 0.5},${p.y * 0.5})`}>
                  <rect x={-item.relationType.length * 6.5 - 8} y={-11} width={item.relationType.length * 13 + 16} height={22} rx={11} fill="#FFFFFF" stroke={color} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600} fill={color}>
                    {item.relationType}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* 짝 노드 */}
        {shown.map(item => {
          const p = posOf(item.id)
          const color = subjectColors[item.subjectId] ?? FALLBACK
          const weak = item.strength < FUSION_STRONG_MIN
          const active = activeId === item.id
          return (
            <g
              key={item.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: dragRef.current ? 'grabbing' : 'grab', opacity: isLit(item.id) ? 1 : 0.3 }}
              onPointerEnter={() => setHoverId(item.id)}
              onPointerLeave={() => setHoverId(h => (h === item.id ? null : h))}
              onPointerDown={e => onNodePointerDown(e, item.id)}
              onClick={e => e.stopPropagation()}
            >
              {active && <circle r={NODE_R + 8} fill={color} opacity={0.18} />}
              <circle
                r={NODE_R}
                fill={color}
                fillOpacity={weak ? 0.55 : 1}
                stroke="#FFFFFF"
                strokeWidth={2.5}
                strokeDasharray={weak ? '3 3' : undefined}
              />
              <text
                y={NODE_R + 15}
                textAnchor="middle"
                fontSize={12.5}
                fontWeight={active ? 700 : 600}
                fill={color}
                stroke={BG}
                strokeWidth={4}
                paintOrder="stroke"
              >
                {item.code}
              </text>
              {active && (
                <text y={NODE_R + 30} textAnchor="middle" fontSize={11.5} fill={MUTED} stroke={BG} strokeWidth={4} paintOrder="stroke">
                  {subjectNames[item.subjectId] ?? item.subject}
                </text>
              )}
            </g>
          )
        })}

        {/* 중심(핵심) */}
        {hubNode && (
          <g style={{ opacity: activeId ? 0.95 : 1 }}>
            <circle r={HUB_R + 14} fill={GOLD} opacity={0.14} />
            <circle r={HUB_R + 6} fill="none" stroke={GOLD} strokeWidth={3} />
            <circle r={HUB_R} fill={hubColor} stroke="#FFFFFF" strokeWidth={2.5} />
            <polygon points={starPoints(0, 0, 13)} fill="#FFD54A" stroke="#8A5A00" strokeWidth={1.2} />
            <text y={HUB_R + 26} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK} stroke={BG} strokeWidth={5} paintOrder="stroke">
              {hubNode.code} {hubNode.subject}
            </text>
          </g>
        )}
      </svg>

      {/* 호버 설명 */}
      {hoverItem && (
        <div
          className="pointer-events-none absolute bottom-16 left-1/2 z-10 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-[#D5D9E0] bg-white px-4 py-3 shadow-md"
          style={{ color: INK }}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            <span style={{ color: subjectColors[hoverItem.subjectId] ?? MUTED }}>
              {hoverItem.code} {hoverItem.subject}
            </span>
            <span
              className="rounded-md px-1.5 py-0.5 text-[12px]"
              style={{ color: RELATION_COLORS[hoverItem.relationType] ?? FALLBACK, border: `1px solid ${RELATION_COLORS[hoverItem.relationType] ?? FALLBACK}` }}
            >
              {hoverItem.relationType}
            </span>
            <span style={{ color: MUTED }}>엮기 {Math.round(hoverItem.strength * 100)}%</span>
          </div>
          <p className="text-[13.5px] leading-[1.5]">{nodeById.get(hoverItem.id)?.text ?? hoverItem.text}</p>
          {RELATION_TYPE_HINTS[hoverItem.relationType] && (
            <p className="mt-1 text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>
              {RELATION_TYPE_HINTS[hoverItem.relationType]}
            </p>
          )}
        </div>
      )}

      {/* 범례 · 약한 연결 토글 */}
      <div
        className="absolute bottom-4 left-16 z-10 flex max-w-[calc(100%-80px)] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[#E1E4E9] bg-white/90 px-3 py-2 text-[12px] backdrop-blur"
        style={{ color: MUTED }}
      >
        <span style={{ color: INK }}>가까울수록·굵을수록 엮기 자연스러움 · 회색 선 = 짝끼리의 연결</span>
        {relationsPresent.map(rel => (
          <span key={rel} className="inline-flex items-center gap-1.5" title={RELATION_TYPE_HINTS[rel]}>
            <span className="inline-block h-[3px] w-4 rounded" style={{ background: RELATION_COLORS[rel] ?? FALLBACK }} />
            {rel}
          </span>
        ))}
        {weakCount > 0 && strongCount >= 3 && (
          <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5" style={{ color: INK }}>
            <input type="checkbox" checked={showWeak} onChange={e => onShowWeakChange(e.target.checked)} className="accent-[#E3A400]" />
            약한 연결 {weakCount}개도 보기
          </label>
        )}
      </div>

      {/* 상태 */}
      {fusion.status === 'loading' && (
        <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <div className="rounded-full border border-[#E1E4E9] bg-white px-4 py-2 text-[13px] shadow-sm" style={{ color: INK }}>
            이 주제로 함께 엮을 수 있는 성취기준을 판정하는 중…
          </div>
        </div>
      )}
      {fusion.status === 'error' && (
        <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-[#E1E4E9] bg-white px-4 py-2 text-[13px]" style={{ color: INK }}>
            {fusion.error}
            <button type="button" onClick={onRetry} className="underline">다시 시도</button>
          </div>
        </div>
      )}
      {fusion.status === 'ready' && fusion.items.length === 0 && (
        <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <div className="rounded-full border border-[#E1E4E9] bg-white px-4 py-2 text-[13px]" style={{ color: INK }}>
            같은 학년군에서 함께 엮을 다른 교과 성취기준을 찾지 못했습니다.
          </div>
        </div>
      )}
    </div>
  )
}

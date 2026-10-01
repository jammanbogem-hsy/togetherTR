'use client'

// 교육과정 분석맵 — 융합 그래프(옵시디언 그래프 보기 느낌의 SVG 겹층).
// 핵심 성취기준 하나를 가운데 두고, 같은 학년군 다른 교과의 융합 짝만 둘레에 모은다.
// 방향 = 교과(부채꼴), 거리 = 엮기 자연스러움(가까울수록 강함), 선 색 = 융합 방식.
// ✕ 를 누르면 겹층이 사라지고 아래에 그대로 있던 원래 지도로 돌아간다.

import { useEffect, useMemo, useRef, useState } from 'react'
import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import { RELATION_TYPE_HINTS } from './MapFusionBits'
import { computeFusionLayout } from './fusionLayout'
import { readableOn } from './mapTheme'
import type { FusionState } from './useCurriculumMap'
import type { MapEdge, MapNode } from './types'

/** 이 강도 미만은 '약한 연결' — 기본으로 숨긴다 */
export const FUSION_STRONG_MIN = 0.5
const FALLBACK = '#94A3B8'
const BG = '#15171C'
const INK = '#E6E8EC'
const MUTED = '#9AA0AC'
const GOLD = '#F5B301'
const NODE_R = 15
const HUB_R = 30

export interface FusionGraphProps {
  fusion: FusionState
  hubNode: MapNode | null
  nodeById: Map<string, MapNode>
  /** 짝끼리의 옅은 연결선(에셋의 교과 간 링크·유사도 이웃) */
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
  const [size, setSize] = useState({ w: 800, h: 600 })
  // 펼침 연출이 끝난 항목 묶음 — 묶음이 바뀌면(새 판정·약한 연결 토글) 다시 가운데에서 펼친다
  const [settledKey, setSettledKey] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

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

  const rMax = Math.max(140, Math.min(size.w, size.h) / 2 - 78)
  const rMin = Math.max(HUB_R + NODE_R + 60, rMax * 0.42)
  const layout = useMemo(
    () => computeFusionLayout(
      shown.map(i => ({ id: i.id, subjectId: i.subjectId, strength: i.strength })),
      subjectOrder,
      rMin,
      rMax,
      effectiveShowWeak ? 0 : FUSION_STRONG_MIN,
    ),
    [effectiveShowWeak, rMax, rMin, shown, subjectOrder],
  )

  // 들어올 때 가운데에서 퍼져 나가는 연출 — 새 판정 결과마다 한 번
  const itemsKey = shown.map(i => i.id).join(',')
  const settled = settledKey === itemsKey
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettledKey(itemsKey))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [itemsKey])

  const shownIds = useMemo(() => new Set(shown.map(i => i.id)), [shown])
  const peerEdges = useMemo(
    () => edges.filter(e => e.source !== e.target && shownIds.has(e.source) && shownIds.has(e.target)),
    [edges, shownIds],
  )
  const relationsPresent = useMemo(
    () => [...new Set(shown.map(i => i.relationType))],
    [shown],
  )

  const activeId = hoverId ?? focusedId
  const posOf = (id: string): { x: number; y: number } => layout.positions.get(id) ?? { x: 0, y: 0 }
  const hoverItem = hoverId ? fusion.items.find(i => i.id === hoverId) ?? null : null

  const hubColor = hubNode ? subjectColors[hubNode.subjectId] ?? GOLD : GOLD
  // 짝 층 전체를 가운데에서 펼친다(SVG 선 좌표는 CSS 전환이 안 되므로 층 단위 배율로)
  const spread: React.CSSProperties = {
    transform: settled ? 'scale(1)' : 'scale(0.05)',
    opacity: settled ? 1 : 0,
    transition: 'transform 650ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease-out',
  }

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-20 overflow-hidden"
      style={{ background: `radial-gradient(circle at 50% 50%, #1E2129 0%, ${BG} 70%)` }}
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
            중심 {hubNode.code} {hubNode.subject} · {hubNode.band} — 같은 학년군의 다른 교과 중 이 주제로 함께 엮을 수 있는 성취기준
          </p>
        )}
      </div>

      {/* 원래 지도로 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[14px] font-medium backdrop-blur transition-colors hover:bg-white/20"
        style={{ color: INK }}
        aria-label="융합 보기 닫고 원래 지도로"
        title="원래 지도로 (Esc)"
      >
        <span className="material-symbols-rounded text-[20px] leading-none">close</span>
        원래 지도로
      </button>

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        onClick={() => onFocus(null)}
      >
        {/* 거리 안내 고리 */}
        {[rMin, (rMin + rMax) / 2, rMax].map((r, i) => (
          <circle key={r} r={r} fill="none" stroke="#FFFFFF" strokeOpacity={0.06 + (2 - i) * 0.02} strokeDasharray="2 6" />
        ))}

        {/* 교과 부채꼴 이름 */}
        {settled && layout.sectors.map(sector => {
          const r = sector.outerRadius + 52
          const x = Math.cos(sector.angle) * r
          const y = Math.sin(sector.angle) * r
          const color = readableOn('dark', subjectColors[sector.subjectId] ?? MUTED)
          return (
            <text
              key={sector.subjectId}
              x={x}
              y={y}
              textAnchor={Math.abs(Math.cos(sector.angle)) < 0.3 ? 'middle' : Math.cos(sector.angle) > 0 ? 'start' : 'end'}
              dominantBaseline="middle"
              fontSize={14}
              fontWeight={700}
              fill={color}
            >
              {subjectNames[sector.subjectId] ?? sector.subjectId} {sector.count}
            </text>
          )
        })}

        <g style={spread}>
        {/* 짝끼리의 옅은 연결 */}
        {peerEdges.map(e => {
          const a = posOf(e.source)
          const b = posOf(e.target)
          return (
            <line
              key={`${e.source}-${e.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#FFFFFF"
              strokeOpacity={activeId && (activeId === e.source || activeId === e.target) ? 0.35 : 0.08}
              strokeWidth={1}
            />
          )
        })}

        {/* 중심 → 짝 선: 색 = 융합 방식, 굵기 = 강도 */}
        {shown.map(item => {
          const p = posOf(item.id)
          const color = RELATION_COLORS[item.relationType] ?? FALLBACK
          const weak = item.strength < FUSION_STRONG_MIN
          const dim = activeId !== null && activeId !== item.id
          return (
            <g key={`edge-${item.id}`} style={{ opacity: dim ? 0.18 : 1, transition: 'opacity 150ms' }}>
              <line
                x1={0}
                y1={0}
                x2={p.x}
                y2={p.y}
                stroke={color}
                strokeOpacity={weak ? 0.45 : 0.85}
                strokeWidth={1.2 + item.strength * 3.2}
                strokeDasharray={weak ? '5 5' : undefined}
              />
              {!weak && (
                <g transform={`translate(${p.x * 0.6},${p.y * 0.6})`}>
                  <rect x={-item.relationType.length * 6.5 - 8} y={-10} width={item.relationType.length * 13 + 16} height={20} rx={10} fill={BG} stroke={color} strokeOpacity={0.7} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={600} fill={color}>
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
          const dim = activeId !== null && !active
          return (
            <g
              key={item.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: 'pointer', opacity: dim ? 0.45 : 1 }}
              onMouseEnter={() => setHoverId(item.id)}
              onMouseLeave={() => setHoverId(h => (h === item.id ? null : h))}
              onClick={e => {
                e.stopPropagation()
                onFocus(focusedId === item.id ? null : item.id)
              }}
            >
              {active && <circle r={NODE_R + 9} fill={color} opacity={0.25} />}
              <circle r={NODE_R} fill={color} fillOpacity={weak ? 0.45 : 1} stroke={active ? '#FFFFFF' : BG} strokeWidth={active ? 2.5 : 2} strokeDasharray={weak ? '3 3' : undefined} />
              <text y={NODE_R + 15} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={readableOn('dark', color)} stroke={BG} strokeWidth={4} paintOrder="stroke">
                {item.code}
              </text>
            </g>
          )
        })}

        </g>

        {/* 중심(핵심) */}
        {hubNode && (
          <g>
            <circle r={HUB_R + 16} fill={GOLD} opacity={0.12} />
            <circle r={HUB_R + 7} fill="none" stroke={GOLD} strokeWidth={3} />
            <circle r={HUB_R} fill={hubColor} stroke={BG} strokeWidth={2} />
            <polygon points={starPoints(0, 0, 15)} fill={GOLD} stroke="#8A5A00" strokeWidth={1.2} />
            <text y={HUB_R + 26} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK} stroke={BG} strokeWidth={5} paintOrder="stroke">
              {hubNode.code} {hubNode.subject}
            </text>
          </g>
        )}
      </svg>

      {/* 호버 설명 */}
      {hoverItem && (
        <div
          className="pointer-events-none absolute bottom-16 left-1/2 z-10 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-xl px-4 py-3"
          style={{ background: 'rgba(30,33,41,0.96)', border: '1px solid rgba(255,255,255,0.12)', color: INK }}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            <span style={{ color: readableOn('dark', subjectColors[hoverItem.subjectId] ?? MUTED) }}>
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
      <div className="absolute bottom-4 left-16 z-10 flex max-w-[calc(100%-32px)] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-black/30 px-3 py-2 text-[12px] backdrop-blur" style={{ color: MUTED }}>
        <span style={{ color: INK }}>가까울수록·굵을수록 엮기 자연스러움</span>
        {relationsPresent.map(rel => (
          <span key={rel} className="inline-flex items-center gap-1.5" title={RELATION_TYPE_HINTS[rel]}>
            <span className="inline-block h-[3px] w-4 rounded" style={{ background: RELATION_COLORS[rel] ?? FALLBACK }} />
            {rel}
          </span>
        ))}
        {weakCount > 0 && strongCount >= 3 && (
          <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5" style={{ color: INK }}>
            <input type="checkbox" checked={showWeak} onChange={e => onShowWeakChange(e.target.checked)} className="accent-[#F5B301]" />
            약한 연결 {weakCount}개도 보기
          </label>
        )}
      </div>

      {/* 상태 */}
      {fusion.status === 'loading' && (
        <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <div className="rounded-full bg-black/40 px-4 py-2 text-[13px] backdrop-blur" style={{ color: INK }}>
            이 주제로 함께 엮을 수 있는 성취기준을 판정하는 중…
          </div>
        </div>
      )}
      {fusion.status === 'error' && (
        <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <div className="flex items-center gap-3 rounded-xl bg-black/50 px-4 py-2 text-[13px]" style={{ color: INK }}>
            {fusion.error}
            <button type="button" onClick={onRetry} className="underline">다시 시도</button>
          </div>
        </div>
      )}
      {fusion.status === 'ready' && fusion.items.length === 0 && (
        <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <div className="rounded-full bg-black/40 px-4 py-2 text-[13px]" style={{ color: INK }}>
            같은 학년군에서 함께 엮을 다른 교과 성취기준을 찾지 못했습니다.
          </div>
        </div>
      )}
    </div>
  )
}

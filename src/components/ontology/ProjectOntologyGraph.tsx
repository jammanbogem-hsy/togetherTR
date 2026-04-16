'use client'

/**
 * 프로젝트 온톨로지 SVG 그래프.
 *
 * 레이아웃: 5단계 가로 컬럼(T·A·Ds·DI·E) × 활동 세로 슬롯.
 * 노드: 원 + 활동 코드 + 라벨.  채워짐(완료)·테두리(미진행)·halo pulse(현재).
 * 엣지: 순차(얇은 회색) / 단계 전환(진회색) / 가드레일(보라 점선) /
 *        백워드(주황 점선) / 주기 순환(금색 하단 곡선).
 * 인터랙션: onNodeClick 콜백 (있을 때만 cursor pointer).
 */

import { useMemo, useState } from 'react'
import { STAGES } from '@/types'
import { STAGE_COLOR, STAGE_LABELS } from '@/lib/ui/stageColors'
import {
  ONTOLOGY_LAYOUT,
  EDGE_STYLE,
  type OntologyNode,
  type OntologyEdge,
  type OntologyGraph,
} from '@/lib/ontology/projectOntology'

const L = ONTOLOGY_LAYOUT

function edgePath(e: OntologyEdge, src: OntologyNode, dst: OntologyNode): string {
  const R = L.NODE_RADIUS
  if (e.kind === 'concept') {
    // 개념 연결 — 두 노드 중심을 잇는 부드러운 곡선 (stage 차이 크면 더 휘게)
    const dx = dst.x - src.x
    const dy = dst.y - src.y
    const mx = (src.x + dst.x) / 2
    const my = (src.y + dst.y) / 2
    // 직교 오프셋 (절대값 기준)
    const bulge = Math.max(18, Math.min(Math.sqrt(dx * dx + dy * dy) * 0.12, 60))
    return `M ${src.x} ${src.y} Q ${mx + bulge * 0.3} ${my - bulge}, ${dst.x} ${dst.y}`
  }
  if (e.kind === 'sequential') {
    // 같은 컬럼 상하 직선 (노드 경계에서 노드 경계까지)
    return `M ${src.x} ${src.y + R} L ${dst.x} ${dst.y - R}`
  }
  if (e.kind === 'stage') {
    // 단계 전환 — 헤더 라인 수준에서 bezier 곡선 (노드 y 차이 보정)
    const midX = (src.x + dst.x) / 2
    const topY = Math.min(src.y, dst.y) - 48
    return `M ${src.x + R * 0.9} ${src.y - R * 0.3}
            C ${midX} ${topY}, ${midX} ${topY}, ${dst.x - R * 0.9} ${dst.y - R * 0.3}`
  }
  if (e.kind === 'guardrail') {
    // A-2-3 → 각 Ds 활동: 우측으로 나가서 수평 좌측으로 들어감 (위쪽 우회)
    const topY = Math.min(src.y, dst.y) - 42
    return `M ${src.x + R} ${src.y}
            C ${src.x + L.COL_WIDTH * 0.5} ${topY}, ${dst.x - L.COL_WIDTH * 0.5} ${topY},
              ${dst.x - R} ${dst.y}`
  }
  if (e.kind === 'backward') {
    // Ds-1-1 → 이후 Ds 활동: 컬럼 내부이나 직선이 아닌 우측 호로 구분
    const offset = 42
    return `M ${src.x + R * 0.3} ${src.y + R * 0.3}
            C ${src.x + offset} ${src.y + offset}, ${dst.x + offset} ${dst.y - offset},
              ${dst.x + R * 0.3} ${dst.y - R * 0.3}`
  }
  if (e.kind === 'cycle') {
    // E-2-1 → T-1-1: 하단 대형 곡선으로 프로젝트 전체를 감싸는 순환
    const arcY = Math.max(src.y, dst.y) + 68
    return `M ${src.x} ${src.y + R}
            C ${src.x} ${arcY}, ${dst.x} ${arcY}, ${dst.x} ${dst.y + R}`
  }
  return ''
}

export function ProjectOntologyGraph({
  graph,
  onNodeClick,
  publicMode = false,
  className,
}: {
  graph: OntologyGraph
  onNodeClick?: (n: OntologyNode) => void
  publicMode?: boolean
  className?: string
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)

  const nodeMap = useMemo(() => {
    const m = new Map<string, OntologyNode>()
    for (const n of graph.nodes) m.set(n.id, n)
    return m
  }, [graph.nodes])

  // hover 시 연결된 엣지·노드를 강조하기 위한 세트
  const highlightedEdges = useMemo(() => {
    if (!hoverId) return new Set<string>()
    const s = new Set<string>()
    for (const e of graph.edges) {
      if (e.source === hoverId || e.target === hoverId) s.add(`${e.source}->${e.target}`)
    }
    return s
  }, [hoverId, graph.edges])

  const highlightedNodes = useMemo(() => {
    if (!hoverId) return new Set<string>()
    const s = new Set<string>([hoverId])
    for (const e of graph.edges) {
      if (e.source === hoverId) s.add(e.target)
      if (e.target === hoverId) s.add(e.source)
    }
    return s
  }, [hoverId, graph.edges])

  return (
    <svg
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="프로젝트 온톨로지 그래프"
    >
      {/* 마커: 화살표 */}
      <defs>
        {Object.entries(EDGE_STYLE).map(([kind, s]) => (
          <marker
            key={kind}
            id={`arrow-${kind}`}
            viewBox="0 0 10 10"
            refX={8}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
          </marker>
        ))}
      </defs>

      {/* 단계 헤더 */}
      {STAGES.map((s, idx) => {
        const c = STAGE_COLOR[s.code]
        const xCenter = L.COL_START + idx * L.COL_WIDTH
        return (
          <g key={s.code}>
            <rect
              x={xCenter - 56}
              y={L.HEADER_Y - 14}
              width={112}
              height={32}
              rx={16}
              fill={c.hex}
            />
            <text
              x={xCenter}
              y={L.HEADER_Y + 6}
              textAnchor="middle"
              fill="white"
              fontWeight={800}
              fontSize={13}
              style={{ letterSpacing: '-0.02em' }}
            >
              {STAGE_LABELS[s.code]}
            </text>
          </g>
        )
      })}

      {/* 엣지 (노드보다 아래). concept 엣지는 특히 낮은 z로 두어 주요 엣지 가리지 않게 */}
      {/* 1) 먼저 concept 엣지 (뒤에 깔림) */}
      {graph.edges.filter(e => e.kind === 'concept').map((e, i) => {
        const src = nodeMap.get(e.source)
        const dst = nodeMap.get(e.target)
        if (!src || !dst) return null
        const style = EDGE_STYLE[e.kind]
        const isHl = highlightedEdges.has(`${e.source}->${e.target}`)
        const baseOpacity = 0.35
        const boost = (e.strength ?? 2) * 0.3  // 공유 키워드 많을수록 진하게
        return (
          <path
            key={`concept-${e.source}-${e.target}-${i}`}
            d={edgePath(e, src, dst)}
            stroke={style.color}
            strokeWidth={isHl ? style.width + 1.5 : style.width + Math.min(boost, 1.5)}
            strokeDasharray="3 3"
            fill="none"
            opacity={hoverId ? (isHl ? 0.95 : 0.08) : baseOpacity}
            style={{ transition: 'opacity 180ms, stroke-width 180ms' }}
          >
            <title>{`공유 키워드: ${e.sharedKeywords?.join(', ') ?? ''}`}</title>
          </path>
        )
      })}
      {/* 2) 기존 절차·가드레일·백워드·순환 엣지 (위에 덮기) */}
      {graph.edges.filter(e => e.kind !== 'concept').map((e, i) => {
        const src = nodeMap.get(e.source)
        const dst = nodeMap.get(e.target)
        if (!src || !dst) return null
        const style = EDGE_STYLE[e.kind]
        const isHl = highlightedEdges.has(`${e.source}->${e.target}`)
        const baseOpacity = e.kind === 'sequential' ? 0.5 : 0.75
        return (
          <path
            key={`${e.source}-${e.target}-${i}`}
            d={edgePath(e, src, dst)}
            stroke={style.color}
            strokeWidth={isHl ? style.width + 1 : style.width}
            strokeDasharray={style.dashed ? '5 4' : undefined}
            fill="none"
            opacity={hoverId ? (isHl ? 1 : 0.15) : baseOpacity}
            markerEnd={e.kind !== 'sequential' ? `url(#arrow-${e.kind})` : undefined}
            style={{ transition: 'opacity 180ms, stroke-width 180ms' }}
          />
        )
      })}

      {/* 노드 */}
      {graph.nodes.map(n => {
        const c = STAGE_COLOR[n.stage]
        const filled = n.isDone || n.hasArtifact || (publicMode && n.hasStageReport)
        const dimmed = hoverId !== null && !highlightedNodes.has(n.id)
        const opacity = dimmed ? 0.25 : 1
        return (
          <g
            key={n.id}
            transform={`translate(${n.x}, ${n.y})`}
            style={{
              cursor: onNodeClick ? 'pointer' : 'default',
              transition: 'opacity 180ms',
              opacity,
            }}
            onMouseEnter={() => setHoverId(n.id)}
            onMouseLeave={() => setHoverId(h => h === n.id ? null : h)}
            onClick={() => onNodeClick?.(n)}
          >
            {/* 현재 활성 노드 halo pulse (SVG SMIL — CSS로 scale 어려워 animate 사용) */}
            {n.isCurrent && (
              <>
                <circle r={L.NODE_RADIUS + 4} fill="none" stroke={c.hex} strokeWidth={2}>
                  <animate
                    attributeName="r"
                    values={`${L.NODE_RADIUS + 2};${L.NODE_RADIUS + 10};${L.NODE_RADIUS + 2}`}
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.15;0.65;0.15"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                </circle>
              </>
            )}
            {/* 본체 원 */}
            <circle
              r={L.NODE_RADIUS}
              fill={filled ? c.hex : 'white'}
              stroke={c.hex}
              strokeWidth={3}
            />
            {/* 활동 코드 */}
            <text
              textAnchor="middle"
              y={4}
              fill={filled ? 'white' : c.hex}
              fontSize={10}
              fontWeight={800}
              style={{ pointerEvents: 'none' }}
            >
              {n.id}
            </text>
            {/* 뱃지: 가드레일 소스(A-2-3) / 백워드 시작(Ds-1-1) */}
            {n.isGuardrailSource && (
              <g transform={`translate(${L.NODE_RADIUS * 0.75}, ${-L.NODE_RADIUS * 0.75})`}>
                <circle r={7} fill="#7B1FA2" />
                <text textAnchor="middle" y={3} fill="white" fontSize={8} fontWeight={800} style={{ pointerEvents: 'none' }}>G</text>
              </g>
            )}
            {n.isBackwardFirst && (
              <g transform={`translate(${L.NODE_RADIUS * 0.75}, ${-L.NODE_RADIUS * 0.75})`}>
                <circle r={7} fill="#E65100" />
                <text textAnchor="middle" y={3} fill="white" fontSize={8} fontWeight={800} style={{ pointerEvents: 'none' }}>B</text>
              </g>
            )}
            {/* 라벨 (노드 아래) */}
            <text
              textAnchor="middle"
              y={L.NODE_RADIUS + 14}
              fill="#3C4043"
              fontSize={10}
              fontWeight={n.isCurrent ? 700 : 500}
              style={{ pointerEvents: 'none' }}
            >
              {truncate(n.label, 9)}
            </text>
            {/* 핵심 개념 개수 배지 — 숫자만 간결히. 자세한 해시태그는 드로어에서 확인. */}
            {n.keywords && n.keywords.length > 0 && (
              <g transform={`translate(0, ${L.NODE_RADIUS + 28})`}>
                <text
                  textAnchor="middle"
                  y={0}
                  fill="#5F6368"
                  fontSize={9}
                  fontWeight={600}
                  style={{ pointerEvents: 'none' }}
                >
                  # {n.keywords.length} 핵심어
                </text>
              </g>
            )}
            {/* 호버 시 전체 라벨 + 키워드 툴팁 — <title> 활용 */}
            <title>{`${n.id} · ${n.label}${n.isDone ? ' (완료)' : n.hasArtifact ? ' (진행 중)' : ''}${n.keywords && n.keywords.length > 0 ? `\n#${n.keywords.slice(0, 5).join(' #')}` : ''}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

// 범례 컴포넌트 — 그래프 외부에 배치해 해석 가이드
export function OntologyLegend({ publicMode = false }: { publicMode?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[11px] text-[#5F6368]">
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 h-4 rounded-full bg-[#1A73E8]" />
        <span>완료된 활동</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 h-4 rounded-full bg-white border-[2px] border-[#1A73E8]" />
        <span>미진행 활동</span>
      </div>
      {!publicMode && (
        <div className="flex items-center gap-2">
          <span className="relative inline-block w-4 h-4 rounded-full bg-[#1A73E8]">
            <span className="absolute inset-[-3px] rounded-full border-2 border-[#1A73E8] opacity-50 animate-ping" />
          </span>
          <span>현재 활동</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#7B1FA2] text-white text-[8px] font-extrabold">G</span>
        <span>가드레일 소스 (A-2-3)</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#E65100] text-white text-[8px] font-extrabold">B</span>
        <span>백워드 시작 (Ds-1-1)</span>
      </div>
      <div className="flex items-center gap-2">
        <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#5F6368" strokeWidth={2.5} /></svg>
        <span>단계 전환</span>
      </div>
      <div className="flex items-center gap-2">
        <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#7B1FA2" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
        <span>가드레일</span>
      </div>
      <div className="flex items-center gap-2">
        <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#E65100" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
        <span>백워드</span>
      </div>
      <div className="flex items-center gap-2">
        <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#F9AB00" strokeWidth={2.5} /></svg>
        <span>주기 순환</span>
      </div>
      <div className="flex items-center gap-2">
        <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#00897B" strokeWidth={1.5} strokeDasharray="3 3" /></svg>
        <span>공유 키워드 (실내용 기반)</span>
      </div>
    </div>
  )
}

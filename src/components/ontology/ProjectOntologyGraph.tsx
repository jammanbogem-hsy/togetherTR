'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { ArrowsClockwise, CheckCircle, Graph as GraphIcon } from '@phosphor-icons/react'
import { STAGES, displayActivityCode, type ActivityCode } from '@/types'
import { STAGE_LABELS } from '@/lib/ui/stageColors'
import { EDGE_STYLE, type OntologyGraph, type OntologyNode } from '@/lib/ontology/projectOntology'
import {
  GRAPH_LAYOUT as L, ontologyEdgePath, presentOntology, stagePalette, visibleOntologyEdges, wrapActivityLabel,
} from '@/lib/ontology/graphPresentation'

/** 크게 읽는 활동 카드 + 단계 사이 여백을 따라 흐르는 연결선. */
export function ProjectOntologyGraph({
  graph, onNodeClick, publicMode = false, selectedId, className,
}: {
  graph: OntologyGraph
  onNodeClick?: (n: OntologyNode) => void
  publicMode?: boolean
  selectedId?: ActivityCode | null
  className?: string
}) {
  const markerId = useId().replace(/:/g, '')
  const [hoverId, setHoverId] = useState<ActivityCode | null>(null)
  const [localSelection, setLocalSelection] = useState<ActivityCode | null>(null)
  const [showAll, setShowAll] = useState(false)
  const refs = useRef(new Map<ActivityCode, SVGGElement>())
  const view = useMemo(() => presentOntology(graph), [graph])
  const nodes = useMemo(() => new Map(view.nodes.map(node => [node.id, node])), [view.nodes])
  const selection = selectedId === undefined ? localSelection : selectedId
  const focusedId = hoverId ?? selection
  const related = new Set<ActivityCode>()
  if (focusedId) {
    related.add(focusedId)
    for (const edge of graph.edges) {
      if (edge.source === focusedId) related.add(edge.target)
      if (edge.target === focusedId) related.add(edge.source)
    }
  }
  const edges = visibleOntologyEdges(graph.edges, focusedId, showAll)
  const selected = focusedId ? nodes.get(focusedId) : null
  const edgeColor = (kind: string, color: string) => kind === 'sequential' ? EDGE_STYLE.stage.color : kind === 'cycle' ? stagePalette('DI').text : color

  function choose(node: OntologyNode) {
    setLocalSelection(node.id)
    // 좌표를 제외한 원래 노드 데이터를 전달한다.
    onNodeClick?.(graph.nodes.find(original => original.id === node.id) ?? node)
  }

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-relaxed text-[#5F6368]" aria-live="polite">
          {selected ? `${displayActivityCode(selected.id)} · ${selected.label}의 연결을 보고 있습니다.` : '활동을 선택하면 연결된 개념과 설계 기준을 확인할 수 있습니다.'}
        </p>
        <button type="button" aria-pressed={showAll} onClick={() => setShowAll(value => !value)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#E8F0FE] px-4 text-sm font-semibold text-[#1558D6] hover:bg-[#D2E3FC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]">
          <GraphIcon size={18} aria-hidden="true" />{showAll ? '기본 흐름 보기' : '모든 연결 보기'}
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label="수업설계 구조도, 좁은 화면에서는 가로로 탐색하세요">
        <svg viewBox={`0 0 ${view.width} ${view.height}`} width={view.width} height={view.height}
          style={{ width: '100%', minWidth: view.width, height: 'auto', display: 'block', fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif" }}
          aria-label="5단계 활동과 교육적 연결" role="group">
          <defs>
            {Object.entries(EDGE_STYLE).map(([kind, style]) => (
              <marker key={kind} id={`${markerId}-${kind}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto">
                <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={edgeColor(kind, style.color)} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            ))}
          </defs>
          <rect width={view.width} height={view.height} fill="white" aria-hidden="true" />
          {STAGES.map((stage, index) => {
            const palette = stagePalette(stage.code)
            const x = L.firstColumn + index * L.column
            return (
              <g key={stage.code} aria-hidden="true">
                <rect x={x - L.cardWidth / 2 - 10} y={100} width={L.cardWidth + 20} height={view.height - 168} rx={24} fill={palette.surface} fillOpacity={0.48} />
                <rect x={x - L.cardWidth / 2} y={L.headerY} width={L.cardWidth} height={L.headerHeight} rx={20} fill={palette.surface} />
                <circle cx={x - 86} cy={54} r={16} fill={palette.text} />
                <text x={x - 86} y={59} textAnchor="middle" fontSize={14} fontWeight={700} fill="white">{index + 1}</text>
                <text x={x - 60} y={51} fontSize={18} fontWeight={750} fill={palette.text}>{STAGE_LABELS[stage.code]}</text>
                <text x={x - 60} y={70} fontSize={12} fill="#5F6368">{stage.activities.length}개 활동</text>
              </g>
            )
          })}
          {edges.map((edge, index) => {
            const source = nodes.get(edge.source), target = nodes.get(edge.target)
            if (!source || !target) return null
            const style = EDGE_STYLE[edge.kind]
            const highlighted = focusedId === edge.source || focusedId === edge.target
            return (
              <path key={`${edge.kind}-${edge.source}-${edge.target}-${index}`}
                data-edge-kind={edge.kind} data-source={edge.source} data-target={edge.target}
                d={ontologyEdgePath(edge, source, target, view.height)} fill="none"
                stroke={edgeColor(edge.kind, style.color)} strokeWidth={highlighted ? 2.5 : edge.kind === 'stage' ? 1.8 : 1.5}
                strokeDasharray={style.dashed ? '5 6' : undefined} strokeLinecap="round" strokeLinejoin="round"
                opacity={focusedId ? highlighted ? 0.95 : 0.18 : 0.8}
                markerEnd={`url(#${markerId}-${edge.kind})`}>
                <title>{`${displayActivityCode(edge.source)} → ${displayActivityCode(edge.target)} · ${edge.kind === 'concept' ? `공유 개념: ${edge.sharedKeywords?.join(', ') ?? ''}` : style.label.replace(/A-2-3/g, 'A-5').replace(/Ds-1-1/g, 'Ds-1')}`}</title>
              </path>
            )
          })}
          <text x={view.width / 2} y={view.height - 10} textAnchor="middle" fontSize={13} fill="#5F6368">성찰을 다음 수업설계로 연결</text>
          {view.nodes.map(node => {
            const palette = stagePalette(node.stage)
            const chosen = selection === node.id
            const active = !publicMode && node.isCurrent
            const filled = node.isDone || node.hasArtifact || (publicMode && node.hasStageReport)
            const status = active ? '현재 활동' : node.isDone ? '완료' : node.hasArtifact ? '산출물 저장' : publicMode && node.hasStageReport ? '보고서 있음' : '미진행'
            const labelLines = wrapActivityLabel(node.label)
            return (
              <g key={node.id} ref={element => { if (element) refs.current.set(node.id, element); else refs.current.delete(node.id) }}
                transform={`translate(${node.x - L.cardWidth / 2}, ${node.y - L.cardHeight / 2})`}
                tabIndex={0} role="button" aria-pressed={chosen} aria-current={active ? 'step' : undefined}
                aria-label={`${displayActivityCode(node.id)} ${node.label}, ${status}, 연결과 상세 보기`}
                style={{ cursor: 'pointer' }}
                className="outline-none"
                onMouseEnter={() => setHoverId(node.id)} onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(node.id)} onBlur={() => setHoverId(null)}
                onClick={() => choose(node)} onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node); return }
                  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                  const slot = node.slot + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)
                  if (!step && slot === node.slot) return
                  event.preventDefault()
                  const candidates = view.nodes.filter(candidate => candidate.stageIdx === node.stageIdx + step)
                  const next = step ? candidates.reduce<OntologyNode | undefined>((best, candidate) => !best || Math.abs(candidate.slot - slot) < Math.abs(best.slot - slot) ? candidate : best, undefined) : candidates.find(candidate => candidate.slot === slot)
                  if (next) { refs.current.get(next.id)?.focus(); refs.current.get(next.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
                }}>
                {(chosen || active || hoverId === node.id) && <rect x={-4} y={-4} width={L.cardWidth + 8} height={L.cardHeight + 8} rx={20} fill="none" stroke={palette.accent} strokeWidth={2} />}
                <rect width={L.cardWidth} height={L.cardHeight} rx={16} fill="white" stroke={filled || related.has(node.id) ? palette.border : '#DADCE0'} />
                <rect x={16} y={13} width={54} height={23} rx={8} fill={palette.surface} />
                <text x={43} y={29} textAnchor="middle" fontSize={13} fontWeight={750} fill={palette.text}>{displayActivityCode(node.id)}</text>
                {active && <text x={L.cardWidth - 16} y={29} textAnchor="end" fontSize={12} fontWeight={700} fill={palette.text}>진행 중</text>}
                {labelLines.map((line, index) => <text key={index} x={16} y={54 + index * 19} fontSize={15} fontWeight={650} fill="#202124">{line}</text>)}
                <circle cx={20} cy={90} r={3} fill={filled || active ? palette.accent : '#9AA0A6'} />
                <text x={29} y={94} fontSize={12} fill="#5F6368">{status}</text>
                <text x={L.cardWidth - 16} y={94} textAnchor="end" fontSize={12} fill={palette.text}>
                  {node.isGuardrailSource ? '학습자 기준' : node.isBackwardFirst ? '평가 출발점' : node.keywords?.length ? `핵심어 ${node.keywords.length}` : ''}
                </text>
                <title>{`${displayActivityCode(node.id)} · ${node.label}${node.keywords?.length ? `\n${node.keywords.join(' · ')}` : ''}`}</title>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export function OntologyLegend({ publicMode = false }: { publicMode?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#5F6368]">
      <span className="inline-flex items-center gap-2"><CheckCircle size={18} className="text-[#1558D6]" aria-hidden="true" />{publicMode ? '활동·단계 보고서 상태' : '카드 아래에서 활동 상태 확인'}</span>
      <span className="inline-flex items-center gap-2"><svg width={26} height={10} aria-hidden="true"><path d="M 1 5 H 24" stroke="#5F6368" strokeWidth={2} /></svg>활동 진행 흐름</span>
      <span className="inline-flex items-center gap-2"><svg width={26} height={10} aria-hidden="true"><path d="M 1 5 H 24" stroke="#7B1FA2" strokeWidth={2} strokeDasharray="4 4" /></svg>선택한 활동의 참조·공유 개념</span>
      <span className="inline-flex items-center gap-2"><ArrowsClockwise size={18} className="text-[#BF360C]" aria-hidden="true" />다음 설계 주기</span>
    </div>
  )
}

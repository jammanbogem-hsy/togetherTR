'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GNode, GEdge, GraphRelationAnalysis, GraphPinnedStandard, GraphRelationFilter } from './types'
import {
  RELATION_COLORS, subjectColor, subjectName, normCode, nodeRadius,
  edgeColor, edgeRelationLabel, hasCompletedRelationAnalysis,
  getRelationDisplayState, getRelationStatusMeta, classifyRelation,
  buildFallbackRelationExplanation, buildFallbackTeachingHint,
  normalizedEdgeWeight,
} from './constants'
import { DEFAULT_GRAPH_RELATION_TYPE } from '@/lib/knowledge-graph/domain'

interface GraphCanvasProps {
  svgRef: React.RefObject<SVGSVGElement | null>
  graphAreaRef: React.RefObject<HTMLDivElement | null>
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
  finalScoreMap: Map<string, number>
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

export default function GraphCanvas({
  svgRef, graphAreaRef, nodesRef, svgWidth, svgHeight, height,
  visibleNodes, visibleEdges, centerNodeId, popup, hoveredNodeId: hoveredNodeIdProp,
  claudeRelations, chatMentionedCodes, pinnedStandards, recommendedCenterIds,
  finalScoreMap, algoMode, relFilter,
  onAlgoModeChange, onRelFilterChange,
  onNodeClick, onRightClick, onSetHoveredNodeId, onSetTooltip, onDragStart, onDragEnd,
}: GraphCanvasProps) {
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState<string | null>(null)
  const panStartRef = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null)

  // 키워드 변경 시 뷰 리셋
  useEffect(() => {
    setViewTransform({ x: 0, y: 0, scale: 1 })
  }, [visibleNodes.length === 0])

  // 마우스 휠 줌
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
        const newScale = Math.max(0.25, Math.min(4, vt.scale * zoomFactor))
        const ratio = newScale / vt.scale
        return { x: mouseX - (mouseX - vt.x) * ratio, y: mouseY - (mouseY - vt.y) * ratio, scale: newScale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [svgRef])

  const onMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    setDragging(nodeId)
    const node = nodesRef.current.find(n => n.id === nodeId)
    if (node) { node.fx = node.x; node.fy = node.y }
    onDragStart(e, nodeId)
  }, [nodesRef, onDragStart])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect()
      const node = nodesRef.current.find(n => n.id === dragging)
      if (node) {
        node.fx = (e.clientX - rect.left - viewTransform.x) / viewTransform.scale
        node.fy = (e.clientY - rect.top - viewTransform.y) / viewTransform.scale
        node.x = node.fx
        node.y = node.fy
      }
    }
    const panStart = panStartRef.current
    if (!dragging && panStart) {
      const dx = e.clientX - panStart.mx
      const dy = e.clientY - panStart.my
      setViewTransform(vt => ({ ...vt, x: panStart.vx + dx, y: panStart.vy + dy }))
    }
  }, [dragging, svgRef, nodesRef, viewTransform])

  const onMouseUp = useCallback(() => {
    if (dragging) {
      const node = nodesRef.current.find(n => n.id === dragging)
      if (node) { node.fx = undefined; node.fy = undefined }
      setDragging(null)
      onDragEnd() // Force 시뮬레이션 재시작
    }
    panStartRef.current = null
  }, [dragging, nodesRef, onDragEnd])

  return (
    <>
      {/* 상단 컨트롤: 알고리즘 선택 + 관계 필터 */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 pointer-events-auto">
        <div className="flex items-center gap-0.5 bg-white/90 backdrop-blur-sm rounded-xl shadow-md border border-gray-200 p-1">
          <span className="text-[9px] font-bold text-gray-400 px-1.5">검색</span>
          {([
            { key: 'keyword', label: '키워드', desc: '채팅 AI와 동일한 알고리즘' },
            { key: 'semantic', label: '의미망', desc: '개념·맥락 기반 임베딩 검색' },
            { key: 'hybrid', label: '하이브리드', desc: '의미망 + 키워드 통합' },
          ] as const).map(({ key, label, desc }) => (
            <button key={key} title={desc} onClick={() => onAlgoModeChange(key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${algoMode === key ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            >
              {label}
              {key === 'keyword' && <span className="ml-1 text-[8px] opacity-60">(=채팅)</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 bg-white/90 backdrop-blur-sm rounded-xl shadow-md border border-gray-200 p-1 flex-wrap">
          <span className="text-[9px] font-bold text-gray-400 px-1.5">관계</span>
          {([
            { key: 'all', label: '전체망', color: '#374151' },
            { key: '의미연결', label: '🔗 의미연결', color: '#7C3AED' },
            { key: '도구-활용', label: '🛠 도구-활용', color: '#EF4444' },
            { key: '현상-가치', label: '⚖️ 현상-가치', color: '#F97316' },
            { key: '내용-표현', label: '🎨 내용-표현', color: '#22C55E' },
            { key: '개념-적용', label: '💡 개념-적용', color: '#0EA5E9' },
            { key: '문제-해결', label: '🧩 문제-해결', color: '#D946EF' },
            { key: '탐구-실천', label: '🌱 탐구-실천', color: '#84CC16' },
            { key: '원인-결과', label: '➡️ 원인-결과', color: '#F59E0B' },
          ] as { key: GraphRelationFilter; label: string; color: string }[]).map(({ key, label, color }) => (
            <button key={key} onClick={() => onRelFilterChange(key)}
              className={`px-2 py-1 rounded-lg text-[9.5px] font-semibold transition-all ${relFilter === key ? 'text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
              style={relFilter === key ? { backgroundColor: color } : undefined}
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
        style={{ width: svgWidth, height: height ?? '100%', cursor: panStartRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={e => {
          if (e.button !== 0) return
          panStartRef.current = { mx: e.clientX, my: e.clientY, vx: viewTransform.x, vy: viewTransform.y }
        }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
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
          {/* 엣지 */}
          <g>
            {visibleEdges.map(edge => {
              const src = visibleNodes.find(n => n.id === edge.source)
              const tgt = visibleNodes.find(n => n.id === edge.target)
              if (!src || !tgt) return null

              const isManual = edge.method === 'manual'
              const isCross = isManual || edge.method.includes('tfidf') || edge.method.includes('hybrid')
              const color = edgeColor(edge.method, edge.relation)
              const markerSuffix = isManual
                ? edge.relation === '도구-활용' ? '-red' : edge.relation === '현상-가치' ? '-orange' : edge.relation === '내용-표현' ? '-green' : '-purple'
                : isCross ? '-purple' : edge.method === 'rule_based' ? '-blue' : ''
              const markerId = `arrow${markerSuffix}`
              const strokeW = isManual
                ? (edge.relation !== DEFAULT_GRAPH_RELATION_TYPE ? 3 : 1.5)
                : isCross ? Math.max(1.5, edge.weight * 3) : 1.2

              const dx = tgt.x - src.x
              const dy = tgt.y - src.y
              const dist = Math.sqrt(dx * dx + dy * dy) || 1
              const srcIsCenter = src.id === centerNodeId
              const tgtIsCenter = tgt.id === centerNodeId
              const srcR = nodeRadius(src.type, src.similarityScore, srcIsCenter) + 2
              const tgtR = nodeRadius(tgt.type, tgt.similarityScore, tgtIsCenter) + 10
              const x1 = src.x + (dx / dist) * srcR
              const y1 = src.y + (dy / dist) * srcR
              const x2 = tgt.x - (dx / dist) * tgtR
              const y2 = tgt.y - (dy / dist) * tgtR

              const mx = (x1 + x2) / 2
              const my = (y1 + y2) / 2
              const curvature = isManual ? 0.25 : 0.20
              const perpX = -dy / dist * dist * curvature
              const perpY = dx / dist * dist * curvature
              const cpX = mx + perpX
              const cpY = my + perpY
              const labelX = 0.25 * x1 + 0.5 * cpX + 0.25 * x2
              const labelY = 0.25 * y1 + 0.5 * cpY + 0.25 * y2
              const labelText = edgeRelationLabel(edge)
              const charW = 6.6

              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1},${y1} Q ${cpX},${cpY} ${x2},${y2}`}
                    fill="none" stroke={color} strokeWidth={strokeW}
                    strokeOpacity={isCross ? 0.85 : 0.4}
                    markerEnd={`url(#${markerId})`}
                    strokeDasharray={(!isManual && !isCross) ? '4,3' : undefined}
                  />
                  {(isCross || isManual) && labelText && (
                    <g transform={`translate(${labelX},${labelY})`}>
                      <rect x={-labelText.length * charW / 2 - 5} y={-8} width={labelText.length * charW + 10} height={15} rx={4} fill="rgba(255,255,255,0.92)" />
                      <text textAnchor="middle" dy={4} fontSize={11} fontWeight="600" fill={color} style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'system-ui, sans-serif' }}>
                        {labelText}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
          </g>

          {/* 노드 */}
          <g>
            {visibleNodes.map((node, idx) => {
              const isCenter = node.id === centerNodeId
              const r = nodeRadius(node.type, node.similarityScore, isCenter)
              const color = subjectColor(node.subject_id)
              const sName = subjectName(node.subject_id)
              const delay = (idx * 0.18).toFixed(2) + 's'
              const isPopup = popup?.id === node.id
              const isHovered = node.id === hoveredNodeIdProp
              const fscore = finalScoreMap.get(node.id)
              const simPct = !isCenter && fscore && fscore > 0.01 ? `${Math.round(fscore * 100)}%` : null
              const chatMatch = chatMentionedCodes.find(c => normCode(c.code) === normCode(node.label))
              const pin = pinnedStandards.find(p => p.stdId === node.id)
                ?? (chatMatch ? { stdId: node.id, addedBy: chatMatch.addedBy, source: 'chat' as const } : undefined)

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={e => onMouseDown(e, node.id)}
                  onMouseEnter={() => {
                    onSetHoveredNodeId(node.id)
                    const rect = svgRef.current?.getBoundingClientRect()
                    if (rect) {
                      const r2 = nodeRadius(node.type, node.similarityScore, node.id === centerNodeId)
                      onSetTooltip({ nodeId: node.id, x: rect.left + node.x, y: rect.top + node.y - r2 - 8 })
                    }
                  }}
                  onMouseLeave={() => { onSetHoveredNodeId(null); onSetTooltip(null) }}
                  onClick={() => { onSetTooltip(null); onNodeClick(node) }}
                  onContextMenu={e => onRightClick(e, node.id)}
                >
                  {isCenter
                    ? <circle r={r + 8} fill="none" stroke="#F59E0B" strokeWidth={4} strokeOpacity={0.9} />
                    : <circle className="kg-rainbow-ring" r={r + 6} style={{ animationDelay: delay }} />
                  }
                  {isHovered && !isCenter && <circle r={r + 4} fill="none" stroke="white" strokeWidth={2} strokeOpacity={0.7} />}
                  {isPopup && <circle r={r + 10} fill="none" stroke="#1D4ED8" strokeWidth={2.5} strokeOpacity={0.7} />}
                  {pin && !isCenter && <circle r={r + 4} fill="none" stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="4,2" strokeOpacity={0.7} />}
                  <circle r={isCenter ? r + 4 : r} fill={color} fillOpacity={isCenter ? 1 : 0.9} />
                  {(() => {
                    const label = node.label
                    const baseFontSize = isCenter ? 13 : 11
                    const fontSize = label.length > 10 ? Math.max(8, baseFontSize - (label.length - 10) * 0.6) : baseFontSize
                    const yPos = isCenter ? -12 : -8
                    return <text y={yPos} textAnchor="middle" fontSize={fontSize} fontWeight="700" fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>{label}</text>
                  })()}
                  <text y={isCenter ? 5 : 6} textAnchor="middle" fontSize={isCenter ? 11 : 9} fontWeight="500" fill="rgba(255,255,255,0.85)" style={{ userSelect: 'none', pointerEvents: 'none' }}>({sName})</text>
                  {simPct && <text y={20} textAnchor="middle" fontSize={9} fontWeight="700" fill="rgba(255,255,255,0.75)" style={{ userSelect: 'none', pointerEvents: 'none' }}>{simPct}</text>}
                  {pin && (
                    <g transform={`translate(0, ${r + 10})`}>
                      <rect x={-pin.addedBy.length * 3 - 6} y={-6} width={pin.addedBy.length * 6 + 12} height={12} rx={6} fill="#7C3AED" fillOpacity={0.9} />
                      <text textAnchor="middle" dy={4} fontSize={8} fontWeight="600" fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {pin.source === 'chat' ? '💬 ' : '+ '}{pin.addedBy.slice(0, 8)}
                      </text>
                    </g>
                  )}
                  {!centerNodeId && recommendedCenterIds.has(node.id) && (
                    <g transform={`translate(0, ${-(r + 14)})`}>
                      {(() => {
                        const recommender = recommendedCenterIds.get(node.id) ?? '팀원'
                        const label = `✋ ${recommender.slice(0, 6)}`
                        const w = label.length * 5.5 + 10
                        return (
                          <>
                            <rect x={-w / 2} y={-8} width={w} height={16} rx={8} fill="#F59E0B" fillOpacity={0.95} />
                            <text textAnchor="middle" dy={5} fontSize={8} fontWeight="700" fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>{label}</text>
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

      {/* 줌 버튼 */}
      <div className="absolute bottom-16 right-4 z-20 flex flex-col items-center gap-1 pointer-events-auto">
        <button
          onClick={() => setViewTransform(vt => { const s = Math.min(4, vt.scale * 1.2); return { x: svgWidth / 2 - (svgWidth / 2 - vt.x) * s / vt.scale, y: svgHeight / 2 - (svgHeight / 2 - vt.y) * s / vt.scale, scale: s } })}
          className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold leading-none" title="확대"
        >+</button>
        <button
          onClick={() => setViewTransform({ x: 0, y: 0, scale: 1 })}
          className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow text-gray-500 hover:bg-gray-50 flex items-center justify-center text-[10px] font-bold leading-none" title="화면 맞춤"
        >⊙</button>
        <button
          onClick={() => setViewTransform(vt => { const s = Math.max(0.25, vt.scale * 0.83); return { x: svgWidth / 2 - (svgWidth / 2 - vt.x) * s / vt.scale, y: svgHeight / 2 - (svgHeight / 2 - vt.y) * s / vt.scale, scale: s } })}
          className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold leading-none" title="축소"
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

  const [showModal, setShowModal] = React.useState(false)

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
      {/* 미니 카드 (클릭 시 모달 열기) */}
      <div className="absolute top-3 right-3 z-10 max-w-[280px] pointer-events-auto">
        <button
          onClick={() => setShowModal(true)}
          className="w-full text-left bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#CE93D8] px-3 py-2.5 space-y-2 hover:border-[#7B1FA2] hover:shadow-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-[#7B1FA2] bg-[#F3E5F5] px-1.5 py-0.5 rounded-full">
              {analyzedConnectedCount > 0 ? 'Agent 추천' : '연결 제안'}
            </span>
            {topRelLabel && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: topRelColor }}>{topRelLabel}</span>}
            <span className="ml-auto text-[8px] text-gray-300 group-hover:text-[#7B1FA2] transition-colors">클릭하여 상세 보기 →</span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-gray-400 shrink-0">중심</span>
              <span className="font-mono font-bold text-[10px] leading-none" style={{ color: subjectColor(centerNode.subject_id) }}>{centerNode.label}</span>
              <span className="text-[8px] text-gray-400">({subjectName(centerNode.subject_id)})</span>
            </div>
            {stdDetails.length > 0 && (
              <div className="pl-3 border-l-2 border-dashed space-y-1" style={{ borderColor: topRelColor }}>
                {stdDetails.slice(0, 4).map(({ node, cr, crColor, explanation, relationStatus }) => (
                  <div key={node.id}>
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-semibold text-[9px] leading-none" style={{ color: subjectColor(node.subject_id) }}>{node.label}</span>
                      <span className="text-[8px] text-gray-400">({subjectName(node.subject_id)})</span>
                      {cr && <span className="text-[7px] font-semibold px-0.5 rounded ml-0.5" style={{ color: crColor, background: (crColor ?? '#999') + '18' }}>{cr.relationType}</span>}
                      <span className={`text-[7px] font-semibold px-0.5 rounded ml-0.5 ${relationStatus.className}`}>{relationStatus.label}</span>
                      {node.similarityScore !== undefined && <span className="text-[7px] text-gray-300 ml-auto">{Math.round(node.similarityScore * 100)}%</span>}
                    </div>
                    {explanation && <p className="text-[7px] text-gray-400 leading-snug mt-0.5 line-clamp-1">{explanation}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[#F3E5F5] pt-1.5">
            {analyzedConnectedCount === 0 && <span className="text-[7px] text-gray-400 mb-0.5 block">교과 역할 기반 추정 관계입니다. AI 분석 후 구체화됩니다.</span>}
            {bestClaudeNote?.source === 'claude' && <span className="text-[7px] font-bold text-[#7B1FA2] mb-0.5 block">Agent 수업 제안</span>}
            <p className="text-[8px] text-gray-600 leading-[1.5] line-clamp-2">{hint}</p>
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
                  <span className="text-sm font-bold text-white">{analyzedConnectedCount > 0 ? 'Agent 추천 상세' : '연결 제안 상세'}</span>
                  {topRelLabel && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">{topRelLabel}</span>}
                </div>
                <div className="flex items-center gap-1.5 text-white/70 text-xs">
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
                <p className="text-xs font-bold text-[#7B1FA2] mb-1.5">{bestClaudeNote?.source === 'claude' ? 'Agent 수업 제안' : '융합 수업 방향'}</p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{hint}</p>
              </div>

              {/* 개별 연결 카드 */}
              {stdDetails.map(({ node, cr, crColor, explanation, ideas, teachingNote, relationStatus }) => (
                <div key={node.id} className="rounded-xl border p-4" style={{ borderColor: subjectColor(node.subject_id) + '40', background: subjectColor(node.subject_id) + '06' }}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-mono font-bold text-sm" style={{ color: subjectColor(node.subject_id) }}>{node.label}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: subjectColor(node.subject_id) + '20', color: subjectColor(node.subject_id) }}>{subjectName(node.subject_id)}</span>
                    {cr && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: crColor, background: (crColor ?? '#999') + '18' }}>{cr.relationType}</span>}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                    {node.similarityScore !== undefined && <span className="text-[10px] text-gray-400 ml-auto">{Math.round(node.similarityScore * 100)}%</span>}
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed mb-3">{node.text}</p>

                  {/* 수업 아이디어 */}
                  {ideas && ideas.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-semibold text-[#7B1FA2] mb-1.5 uppercase tracking-wide">수업 아이디어</p>
                      <ul className="space-y-1.5 list-none">
                        {ideas.map((idea, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: i === 0 ? '#9E9E9E' : '#7B1FA2' }}>
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
                      <p className="text-[10px] font-semibold text-[#7B1FA2] mb-1 uppercase tracking-wide">수업 제안 · 융합 구조</p>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{teachingNote}</p>
                    </div>
                  )}

                  {/* 관계 근거 */}
                  {explanation && (
                    <div className="mt-2 pt-1.5 border-t border-gray-100">
                      <p className="text-[9px] text-gray-400 leading-relaxed">{explanation}</p>
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

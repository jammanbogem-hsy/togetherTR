'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { GNode, GraphRelationAnalysis, GraphPinnedStandard, RecommendedStandard } from './types'
import {
  SUBJECT_NAMES, RELATION_COLORS, subjectColor, subjectName, normCode,
  classifyRelation, hasCompletedRelationAnalysis, getRelationDisplayState, getRelationStatusMeta,
  buildFallbackRelationExplanation, buildFallbackTeachingHint,
} from './constants'

interface LeftPanelProps {
  loading: boolean
  claudeLoading: boolean
  centerNodeId: string | null
  isLeader: boolean
  rawNodes: GNode[]
  visibleIds: Set<string>
  checkedStandards: Set<string>
  recommendedStandards: RecommendedStandard[]
  claudeRelations: Map<string, GraphRelationAnalysis>
  recommendedCenterIds: Map<string, string>
  pinnedStandards: GraphPinnedStandard[]
  subjectsWithResults: Set<string>
  svgWidth: number
  svgHeight: number
  keyword: string
  gradeGroup?: string
  algoMode: 'keyword' | 'semantic' | 'hybrid'
  currentUserName?: string
  selectedCardId: string | null
  onSetSelectedCardId: (id: string | null) => void
  onApplyCenterNode: (nodeId: string) => void
  applyCheckedStandards: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  onPinChange?: (pins: GraphPinnedStandard[]) => void
  onAddNode: (node: GNode) => void
  onShowStandardsBrowser: () => void
}

export default function LeftPanel({
  loading, claudeLoading, centerNodeId, isLeader,
  rawNodes, visibleIds, checkedStandards,
  recommendedStandards, claudeRelations, recommendedCenterIds,
  pinnedStandards, subjectsWithResults,
  svgWidth, svgHeight, keyword, gradeGroup, algoMode, currentUserName,
  selectedCardId, onSetSelectedCardId,
  onApplyCenterNode, applyCheckedStandards, onPinChange, onAddNode, onShowStandardsBrowser,
}: LeftPanelProps) {
  // ── 교과 필터 ──────────────────────────────────────────────────────────
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  const [subjectExtraNodes, setSubjectExtraNodes] = useState<Record<string, GNode[]>>({})
  const [subjectExtraLoading, setSubjectExtraLoading] = useState<string | null>(null)

  // ── 성취기준 추가 검색 ──────────────────────────────────────────────────
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState<GNode[]>([])
  const [addLoading, setAddLoading] = useState(false)
  const addDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current)
    if (!addQuery.trim()) { setAddResults([]); return }
    addDebounceRef.current = setTimeout(() => {
      const q = normCode(addQuery)
      const inRaw = rawNodes.filter(n =>
        n.type === 'standard' && !checkedStandards.has(n.id) &&
        (normCode(n.label).includes(q) || (n.text ?? '').includes(addQuery))
      )
      if (inRaw.length > 0) { setAddResults(inRaw.slice(0, 6)); return }
      setAddLoading(true)
      const p = new URLSearchParams({ keyword: addQuery, topK: '8', focused: 'true', algorithm: algoMode })
      if (gradeGroup) p.set('gradeGroup', gradeGroup)
      fetch(`/api/knowledge-graph?${p}`)
        .then(r => r.json())
        .then(d => {
          if (d.nodes) {
            const already = new Set(rawNodes.map(n => n.id))
            setAddResults((d.nodes as GNode[]).filter(n => n.type === 'standard' && !already.has(n.id)).slice(0, 6))
          }
        })
        .catch(() => {})
        .finally(() => setAddLoading(false))
    }, 300)
    return () => { if (addDebounceRef.current) clearTimeout(addDebounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addQuery, gradeGroup, algoMode])

  // 교과 필터된 추천 목록
  const filteredStandards = subjectFilter
    ? (() => {
        const extraForFilter = subjectExtraNodes[subjectFilter] ?? []
        const existingIds = new Set(rawNodes.map(n => n.id))
        const allNodes = [...rawNodes]
        for (const n of extraForFilter) {
          if (!existingIds.has(n.id)) allNodes.push(n)
        }
        return recommendedStandards.filter(({ node }) => node.subject_id === subjectFilter)
      })()
    : recommendedStandards

  return (
    <div className="w-[286px] shrink-0 border-r border-gray-200 flex flex-col bg-white overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-200 bg-white">
        <div className="text-[14px] font-bold text-gray-800 mb-0.5">연결 노드</div>
        <p className="text-[12px] text-gray-400 leading-tight">시트에서 넘어온 노드를 켜고 끕니다</p>
      </div>

      {/* 관계 유형별 분포 바 (중심 노드 설정 후에만) */}
      {centerNodeId && filteredStandards.length > 0 && (() => {
        const relCounts: Record<string, number> = {}
        let total = 0
        for (const { node, relation } of filteredStandards) {
          if (node.id === centerNodeId) continue
          const claudeKey = [centerNodeId, node.id].sort().join('||')
          const claudeRel = claudeRelations.get(claudeKey)
          const rel = claudeRel?.relationType ?? relation ?? '의미연결'
          relCounts[rel] = (relCounts[rel] ?? 0) + 1
          total++
        }
        if (total === 0) return null
        const sorted = Object.entries(relCounts).sort((a, b) => b[1] - a[1])
        return (
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex h-2 rounded-full overflow-hidden mb-1">
              {sorted.map(([rel, count]) => (
                <div
                  key={rel}
                  style={{ width: `${(count / total) * 100}%`, background: RELATION_COLORS[rel] ?? '#6B7280' }}
                  title={`${rel} ${Math.round((count / total) * 100)}%`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {sorted.map(([rel, count]) => (
                <span key={rel} className="text-[10px] font-semibold text-gray-400">
                  {rel} {Math.round((count / total) * 100)}%
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      {/* 교과 필터 버튼 */}
      <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap gap-1">
        <button
          onClick={() => setSubjectFilter(null)}
          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors border ${
            subjectFilter === null ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200 hover:border-gray-300'
          }`}
        >전체</button>
        {Object.entries(SUBJECT_NAMES).map(([id, name]) => {
          const col = subjectColor(id)
          const isActive = subjectFilter === id
          const hasResults = subjectsWithResults.has(id) || !!subjectExtraNodes[id]?.length
          const isLoadingThis = subjectExtraLoading === id
          return (
            <button
              key={id}
              onClick={() => {
                if (isActive) { setSubjectFilter(null); return }
                setSubjectFilter(id)
                if (!subjectsWithResults.has(id) && !subjectExtraNodes[id]) {
                  setSubjectExtraLoading(id)
                  const p = new URLSearchParams({ keyword, topK: '20', subjects: id, algorithm: algoMode })
                  if (gradeGroup) p.set('gradeGroup', gradeGroup)
                  fetch(`/api/knowledge-graph?${p}`)
                    .then(r => r.json())
                    .then(data => {
                      const nodes = (data.nodes as GNode[]).filter(n => n.type === 'standard' && n.subject_id === id)
                      setSubjectExtraNodes(prev => ({ ...prev, [id]: nodes }))
                    })
                    .catch(() => setSubjectExtraNodes(prev => ({ ...prev, [id]: [] })))
                    .finally(() => setSubjectExtraLoading(null))
                }
              }}
              className="px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all border"
              style={isActive
                ? { background: col, color: 'white', borderColor: col }
                : hasResults
                ? { color: col, borderColor: col + '60', background: col + '10' }
                : { color: '#9CA3AF', borderColor: '#E5E7EB', background: '#F9FAFB' }
              }
              title={hasResults ? `${name} 성취기준 보기` : `${name} — 이 키워드와 직접 연관 낮음 (클릭해서 불러오기)`}
            >
              {isLoadingThis ? '…' : name}
            </button>
          )
        })}
      </div>

      {/* 상태 안내 */}
      <div className="px-4 py-2 border-b border-gray-100">
        {!centerNodeId ? (
          <div>
            <p className="text-[13px] text-gray-500">{isLeader ? '노드 우클릭 → 중심으로 설정하세요.' : '노드 우클릭 → 중심으로 추천하세요.'}</p>
            {isLeader && recommendedCenterIds.size > 0 && (
              <div className="mt-1.5 space-y-1">
                {[...recommendedCenterIds.entries()].map(([nodeId, recommender]) => {
                  const rNode = rawNodes.find(n => n.id === nodeId)
                  if (!rNode) return null
                  return (
                    <button
                      key={nodeId}
                      onClick={() => onApplyCenterNode(nodeId)}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-left"
                    >
                      <span className="font-mono font-bold text-[13px]" style={{ color: subjectColor(rNode.subject_id) }}>{rNode.label}</span>
                      <span className="text-[12px] text-amber-700 flex-1 truncate">{recommender} 추천</span>
                      <span className="text-[12px] text-amber-600 font-semibold shrink-0">설정</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-gray-600 font-semibold">중심 노드 선택됨</p>
        )}
      </div>

      {/* 추천 목록 */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1.5 px-3">
        {loading && <div className="text-[13px] text-gray-400 text-center py-4 animate-pulse">불러오는 중…</div>}
        {!loading && filteredStandards.length === 0 && (
          <div className="text-[13px] text-gray-400 text-center py-4">성취기준 없음</div>
        )}
        {claudeLoading && centerNodeId && (
          <div className="text-[12px] text-[#7B1FA2] text-center py-1.5 flex items-center justify-center gap-1.5 animate-pulse">
            <span className="w-3 h-3 rounded-full border-2 border-[#CE93D8] border-t-[#7B1FA2] animate-spin inline-block" />
            <span>관계 분석 중…</span>
          </div>
        )}
        {filteredStandards.map(({ node: n, isAIMentioned, isCenter, score, relation }) => {
          const color = subjectColor(n.subject_id)
          const isVisible = visibleIds.has(n.id)
          const claudeKey = [centerNodeId ?? '', n.id].sort().join('||')
          const claudeRel = claudeRelations.get(claudeKey)
          const effectiveRelation = claudeRel?.relationType ?? relation
          const relationColor = effectiveRelation ? RELATION_COLORS[effectiveRelation] : undefined
          const analysisState = getRelationDisplayState(claudeRel)
          const relationStatus = getRelationStatusMeta(analysisState)
          const isForced = isCenter
          const isSelected = selectedCardId === n.id
          const isRecommendedCenter = recommendedCenterIds.has(n.id)
          return (
            <div
              key={n.id}
              className={`w-full text-left rounded-xl border transition-all cursor-pointer ${
                isCenter
                  ? 'border-amber-400 bg-amber-50'
                : isSelected
                  ? 'border-gray-400 bg-gray-50 shadow-sm'
                : isVisible
                  ? 'border-gray-200 bg-white shadow-sm hover:border-gray-300'
                  : 'border-dashed border-gray-200 bg-white/60 opacity-50'
              }`}
              onClick={() => onSetSelectedCardId(isSelected ? null : n.id)}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-bold text-[15px]" style={{ color }}>{n.label}</span>
                    <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: color + '18', color }}>{subjectName(n.subject_id)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {isCenter && <span className="text-[12px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">중심</span>}
                    {isAIMentioned && !isCenter && <span className="text-[12px] font-semibold text-[#7B1FA2] bg-[#F3E5F5] px-1.5 py-0.5 rounded-full">AI 언급</span>}
                    {score > 0.01 && !isCenter && <span className="text-[12px] font-bold text-gray-500">{Math.round(score * 100)}%</span>}
                    {effectiveRelation && !isCenter && (
                      <span
                        className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${analysisState === 'estimated' ? 'border border-dashed' : ''}`}
                        style={{ color: relationColor, background: (relationColor ?? '#999') + '18', borderColor: analysisState === 'estimated' ? (relationColor ?? '#999') + '50' : undefined }}
                      >{effectiveRelation}</span>
                    )}
                    {centerNodeId && !isCenter && effectiveRelation && (
                      <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                    )}
                    {!centerNodeId && isRecommendedCenter && <span className="text-[12px] text-amber-600 font-semibold">추천됨</span>}
                  </div>
                </div>
                <button
                  title={isVisible ? '그래프에서 숨기기' : '그래프에 표시'}
                  onClick={e => {
                    e.stopPropagation()
                    if (isVisible) {
                      if (isForced) return
                      applyCheckedStandards(prev => { const next = new Set(prev); next.delete(n.id); return next })
                    } else {
                      applyCheckedStandards(prev => new Set([...prev, n.id]))
                      const alreadyInGraph = rawNodes.some(rn => rn.id === n.id)
                      if (!alreadyInGraph && onPinChange) {
                        onPinChange([...pinnedStandards, { stdId: n.id, addedBy: currentUserName ?? '나', source: 'manual' }])
                      }
                    }
                  }}
                  className={`relative w-8 h-5 rounded-full shrink-0 transition-colors ${isVisible ? 'bg-[#7B1FA2]' : 'bg-gray-200'} ${isForced ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all" style={{ left: isVisible ? '15px' : '2px' }} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 하단 상세 패널 */}
      {(() => {
        const selNode = selectedCardId ? rawNodes.find(n => n.id === selectedCardId) : null
        if (!selNode) return null
        const centerNode = centerNodeId ? rawNodes.find(n => n.id === centerNodeId) : null
        const claudeKey = [centerNodeId ?? '', selNode.id].sort().join('||')
        const claudeRel = claudeRelations.get(claudeKey)
        const hasAnalyzedRelation = hasCompletedRelationAnalysis(claudeRel)
        const relationType = centerNode && selNode.id !== centerNodeId
          ? (claudeRel?.relationType ?? classifyRelation(centerNode, selNode))
          : null
        const relationExplanation = centerNode && relationType
          ? (hasAnalyzedRelation
              ? (claudeRel.explanation?.trim() || buildFallbackRelationExplanation(centerNode, selNode, relationType))
              : buildFallbackRelationExplanation(centerNode, selNode, relationType))
          : null
        const teachingNote = centerNode && selNode.id !== centerNodeId && relationType
          ? (hasAnalyzedRelation
              ? (claudeRel?.teachingNote ?? buildFallbackTeachingHint(centerNode, selNode, relationType))
              : buildFallbackTeachingHint(centerNode, selNode, relationType))
          : undefined
        const relationStatus = getRelationStatusMeta(getRelationDisplayState(claudeRel))
        return (
          <div className="border-t-2 border-[#E1BEE7] bg-[#FAFAFA] px-3 py-3 shrink-0 max-h-52 overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono font-bold text-[15px]" style={{ color: subjectColor(selNode.subject_id) }}>{selNode.label}</span>
              <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: subjectColor(selNode.subject_id) + '18', color: subjectColor(selNode.subject_id) }}>
                {subjectName(selNode.subject_id)}
              </span>
              <button onClick={() => onSetSelectedCardId(null)} className="ml-auto text-gray-300 hover:text-gray-500 text-base leading-none">×</button>
            </div>
            <p className="text-[14px] text-gray-700 leading-relaxed mb-2">{selNode.text}</p>
            {relationType && (
              <div className="rounded-lg bg-[#F3E5F5]/70 border border-[#CE93D8]/40 px-2.5 py-2">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span className="text-[12px] font-bold text-[#7B1FA2]">수업 아이디어</span>
                  <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                  <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: RELATION_COLORS[relationType] ?? '#7B1FA2', background: (RELATION_COLORS[relationType] ?? '#7B1FA2') + '18' }}>
                    {relationType}
                  </span>
                </div>
                {relationExplanation && (
                  <p className="text-[13px] text-gray-600 leading-relaxed">{relationExplanation}</p>
                )}
                {teachingNote && (
                  <p className="text-[13px] text-[#7B1FA2] font-medium mt-1.5 leading-relaxed">수업 제안: {teachingNote}</p>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* 성취기준 추가 검색 */}
      <div className="border-t border-gray-200 px-3 py-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[12px] font-semibold text-gray-400 uppercase tracking-wide">성취기준 직접 추가</div>
          <button onClick={onShowStandardsBrowser} className="text-[12px] text-[#7B1FA2] font-semibold hover:underline">전체 성취기준 찾기</button>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="코드·키워드로 검색…"
            value={addQuery}
            onChange={e => setAddQuery(e.target.value)}
            className="w-full text-[13px] border border-gray-200 bg-white rounded-lg px-2 py-1 outline-none focus:border-[#CE93D8] placeholder:text-gray-300"
          />
          {addLoading && <span className="absolute right-2 top-1 text-[11px] text-gray-400 animate-pulse">…</span>}
        </div>
        {addResults.length > 0 && (
          <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
            {addResults.map(n => (
              <button
                key={n.id}
                onClick={() => {
                  const newNode: GNode = {
                    ...n,
                    x: svgWidth / 2 + (Math.random() - 0.5) * 200,
                    y: svgHeight / 2 + (Math.random() - 0.5) * 200,
                    vx: 0, vy: 0,
                  }
                  onAddNode(newNode)
                  applyCheckedStandards(prev => new Set([...prev, n.id]))
                  if (onPinChange) {
                    onPinChange([...pinnedStandards, { stdId: n.id, addedBy: currentUserName ?? '나', source: 'manual' }])
                  }
                  setAddQuery('')
                  setAddResults([])
                }}
                className="w-full text-left px-2 py-1 rounded-lg hover:bg-[#F3E5F5] border border-transparent hover:border-[#CE93D8] transition-colors"
              >
                <span className="font-mono font-bold text-[12px]" style={{ color: subjectColor(n.subject_id) }}>{n.label}</span>
                <span className="text-[11px] text-gray-400 ml-1">{subjectName(n.subject_id)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

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

  // ── 내비게이션 드로어 ↔ 레일 (M3 반응형 접힘, UI 전용 상태) ────────────────
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setCollapsed(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

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

  // 교과 선택 핸들러 — 필터 칩과 접힌 레일 점이 공유 (동작 동일, 표현만 재사용)
  function selectSubject(id: string) {
    if (subjectFilter === id) { setSubjectFilter(null); return }
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
  }

  return (
    <aside
      className={`${collapsed ? 'm3-nav-rail' : 'm3-nav-drawer'} shrink-0 flex flex-col overflow-hidden`}
      aria-label="연결 노드 탐색"
      style={{ color: 'var(--md-sys-on-surface)' }}
    >
      {/* 헤더 (M3 top app bar) */}
      <div className={`m3-top-app-bar flex items-center gap-1 shrink-0 py-3 ${collapsed ? 'px-2 justify-center' : 'px-4'}`}>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-medium" style={{ color: 'var(--md-sys-on-surface)' }}>성취기준 목록</div>
            <p className="text-[12px] leading-tight" style={{ color: 'var(--md-sys-on-surface-variant)' }}>그래프에 표시할 성취기준을 선택하세요</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="m3-icon-button m3-state m3-focus-ring"
          aria-label={collapsed ? '패널 펼치기' : '패널 접기'}
          aria-expanded={!collapsed}
          title={collapsed ? '패널 펼치기' : '패널 접기'}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>

      {collapsed ? (
        /* ── 접힌 레일: 교과 필터 점 (칩과 동일 핸들러 재사용) ── */
        <nav className="flex-1 overflow-y-auto flex flex-col items-center gap-2 py-3" aria-label="교과 필터">
          <button
            type="button"
            onClick={() => setSubjectFilter(null)}
            className="m3-focus-ring flex items-center justify-center w-9 h-9 rounded-full text-[11px] font-bold transition-colors"
            aria-pressed={subjectFilter === null}
            title="전체 교과"
            style={subjectFilter === null
              ? { background: 'var(--md-sys-secondary-container)', color: 'var(--md-sys-on-secondary-container)' }
              : { background: 'transparent', color: 'var(--md-sys-on-surface-variant)', border: '1px solid var(--md-sys-outline-variant)' }}
          >전체</button>
          {Object.entries(SUBJECT_NAMES).map(([id, name]) => {
            const col = subjectColor(id)
            const isActive = subjectFilter === id
            const hasResults = subjectsWithResults.has(id) || !!subjectExtraNodes[id]?.length
            const isLoadingThis = subjectExtraLoading === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => { setCollapsed(false); selectSubject(id) }}
                className="m3-focus-ring flex items-center justify-center w-9 h-9 rounded-full text-[13px] font-bold transition-colors"
                aria-pressed={isActive}
                aria-label={`${name} 교과 필터`}
                title={hasResults ? `${name} 성취기준 보기` : `${name} — 클릭해서 불러오기`}
                style={isActive
                  ? { background: col, color: 'white' }
                  : hasResults
                  ? { background: col + '1F', color: col }
                  : { background: 'transparent', color: 'var(--md-sys-outline)', border: '1px solid var(--md-sys-outline-variant)' }}
              >{isLoadingThis ? '…' : name.slice(0, 1)}</button>
            )
          })}
        </nav>
      ) : (
        <>
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
              <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--md-sys-outline-variant)' }}>
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
                    <span key={rel} className="text-[10px] font-semibold" style={{ color: 'var(--md-sys-on-surface-variant)' }}>
                      {rel} {Math.round((count / total) * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* 교과 필터 칩 (M3 filter chips) */}
          <div className="px-4 py-3 flex flex-wrap gap-2 shrink-0" style={{ borderBottom: '1px solid var(--md-sys-outline-variant)' }} role="group" aria-label="교과 필터">
            <button
              type="button"
              onClick={() => setSubjectFilter(null)}
              className="m3-chip m3-focus-ring"
              aria-pressed={subjectFilter === null}
              style={subjectFilter === null ? { background: 'var(--md-sys-secondary-container)', color: 'var(--md-sys-on-secondary-container)', borderColor: 'transparent' } : undefined}
            >전체</button>
            {Object.entries(SUBJECT_NAMES).map(([id, name]) => {
              const col = subjectColor(id)
              const isActive = subjectFilter === id
              const hasResults = subjectsWithResults.has(id) || !!subjectExtraNodes[id]?.length
              const isLoadingThis = subjectExtraLoading === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectSubject(id)}
                  className="m3-chip m3-focus-ring"
                  aria-pressed={isActive}
                  style={isActive
                    ? { background: col, color: 'white', borderColor: 'transparent' }
                    : hasResults
                    ? { color: col, borderColor: col + '60', background: col + '14' }
                    : undefined}
                  title={hasResults ? `${name} 성취기준 보기` : `${name} — 이 키워드와 직접 연관 낮음 (클릭해서 불러오기)`}
                >
                  {isLoadingThis ? '…' : name}
                </button>
              )
            })}
          </div>

          {/* 상태 안내 */}
          <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--md-sys-outline-variant)' }}>
            {!centerNodeId ? (
              <div>
                <p className="text-[13px]" style={{ color: 'var(--md-sys-on-surface-variant)' }}>{isLeader ? '노드 우클릭 → 중심으로 설정하세요.' : '노드 우클릭 → 중심으로 추천하세요.'}</p>
                {isLeader && recommendedCenterIds.size > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {[...recommendedCenterIds.entries()].map(([nodeId, recommender]) => {
                      const rNode = rawNodes.find(n => n.id === nodeId)
                      if (!rNode) return null
                      return (
                        <button
                          key={nodeId}
                          type="button"
                          onClick={() => onApplyCenterNode(nodeId)}
                          className="m3-state m3-focus-ring w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left"
                          style={{ background: 'var(--md-sys-tertiary-container)', color: 'var(--md-sys-on-tertiary-container)' }}
                        >
                          <span className="font-mono font-bold text-[13px]" style={{ color: subjectColor(rNode.subject_id) }}>{rNode.label}</span>
                          <span className="text-[12px] flex-1 truncate">{recommender} 추천</span>
                          <span className="text-[12px] font-semibold shrink-0">설정</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[13px] font-semibold" style={{ color: 'var(--md-sys-on-surface)' }}>중심 노드 선택됨</p>
            )}
          </div>

          {/* 추천 목록 (M3 list rows) */}
          <div className="min-h-0 flex-1 overflow-y-auto py-3 space-y-2 px-3">
            {loading && <div className="text-[13px] text-center py-4 animate-pulse" style={{ color: 'var(--md-sys-on-surface-variant)' }}>불러오는 중…</div>}
            {!loading && filteredStandards.length === 0 && (
              <div className="text-[13px] text-center py-4" style={{ color: 'var(--md-sys-on-surface-variant)' }}>성취기준 없음</div>
            )}
            {claudeLoading && centerNodeId && (
              <div className="text-[12px] text-center py-1.5 flex items-center justify-center gap-1.5 animate-pulse" style={{ color: 'var(--md-sys-primary)' }} role="status" aria-live="polite">
                <span className="w-3 h-3 rounded-full border-2 animate-spin inline-block" style={{ borderColor: 'var(--md-sys-primary-container)', borderTopColor: 'var(--md-sys-primary)' }} />
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
              const rowClass = [
                'm3-list-row m3-focus-ring w-full text-left',
                isCenter ? '' : isSelected ? 'is-selected' : !isVisible ? 'is-muted' : '',
              ].filter(Boolean).join(' ')
              return (
                <div
                  key={n.id}
                  role="button"
                  aria-pressed={isSelected}
                  tabIndex={0}
                  className={rowClass}
                  style={isCenter ? { borderColor: 'var(--md-sys-primary)', background: 'var(--md-sys-primary-container)' } : undefined}
                  onClick={() => onSetSelectedCardId(isSelected ? null : n.id)}
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSelectedCardId(isSelected ? null : n.id) }
                  }}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-[15px]" style={{ color }}>{n.label}</span>
                        <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: color + '18', color }}>{subjectName(n.subject_id)}</span>
                      </div>
                      {n.text && <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-[var(--md-on-surface-variant)]">{n.text}</p>}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {/^\[?[246]/.test(n.label) && <span className="text-[12px] text-[var(--md-on-surface-variant)]">{({ '2': '1–2학년군', '4': '3–4학년군', '6': '5–6학년군' } as Record<string, string>)[n.label.replace('[', '')[0]]}</span>}
                        {isCenter && <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--md-sys-primary)', color: 'white' }}>중심 성취기준</span>}
                        {isAIMentioned && !isCenter && <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--md-sys-secondary-container)', color: 'var(--md-sys-on-secondary-container)' }}>AI 언급</span>}
                        {score > 0.01 && !isCenter && <span className="text-[12px] font-bold" style={{ color: 'var(--md-sys-on-surface-variant)' }}>{Math.round(score * 100)}%</span>}
                        {effectiveRelation && !isCenter && (
                          <span
                            className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${analysisState === 'estimated' ? 'border border-dashed' : ''}`}
                            style={{ color: relationColor, background: (relationColor ?? '#999') + '18', borderColor: analysisState === 'estimated' ? (relationColor ?? '#999') + '50' : undefined }}
                          >{effectiveRelation}</span>
                        )}
                        {centerNodeId && !isCenter && effectiveRelation && (
                          <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                        )}
                        {!centerNodeId && isRecommendedCenter && <span className="text-[12px] font-semibold" style={{ color: 'var(--md-sys-tertiary)' }}>추천됨</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isVisible}
                      aria-label={isVisible ? `${n.label} 그래프에서 숨기기` : `${n.label} 그래프에 표시`}
                      title={isVisible ? '그래프에서 숨기기' : '그래프에 표시'}
                      disabled={isForced}
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
                      className="m3-switch m3-focus-ring"
                    >
                      <span className="m3-switch-thumb" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 하단 상세 패널 (M3 surface container) */}
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
              <div className="px-3 py-3 shrink-0 max-h-52 overflow-y-auto" style={{ borderTop: '1px solid var(--md-sys-outline-variant)', background: 'var(--md-sys-surface-container)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono font-bold text-[15px]" style={{ color: subjectColor(selNode.subject_id) }}>{selNode.label}</span>
                  <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: subjectColor(selNode.subject_id) + '18', color: subjectColor(selNode.subject_id) }}>
                    {subjectName(selNode.subject_id)}
                  </span>
                  <button type="button" onClick={() => onSetSelectedCardId(null)} className="m3-icon-button m3-state m3-focus-ring ml-auto" style={{ width: 28, height: 28 }} aria-label="상세 닫기">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
                <p className="text-[14px] leading-relaxed mb-2" style={{ color: 'var(--md-sys-on-surface)' }}>{selNode.text}</p>
                {relationType && (
                  <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--md-sys-secondary-container)', color: 'var(--md-sys-on-secondary-container)' }}>
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span className="text-[12px] font-bold">수업 아이디어</span>
                      <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                      <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: RELATION_COLORS[relationType] ?? '#7B1FA2', background: (RELATION_COLORS[relationType] ?? '#7B1FA2') + '18' }}>
                        {relationType}
                      </span>
                    </div>
                    {relationExplanation && (
                      <p className="text-[13px] leading-relaxed">{relationExplanation}</p>
                    )}
                    {teachingNote && (
                      <p className="text-[13px] font-semibold mt-1.5 leading-relaxed">수업 제안: {teachingNote}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* 성취기준 추가 검색 (M3 filled search field) */}
          <div className="px-3 py-2 shrink-0" style={{ borderTop: '1px solid var(--md-sys-outline-variant)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--md-sys-on-surface-variant)' }}>성취기준 직접 추가</div>
              <button type="button" onClick={onShowStandardsBrowser} className="m3-focus-ring text-[12px] font-semibold hover:underline" style={{ color: 'var(--md-sys-primary)' }}>전체 성취기준 찾기</button>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="코드·키워드로 검색…"
                value={addQuery}
                onChange={e => setAddQuery(e.target.value)}
                aria-label="성취기준 코드·키워드 검색"
                className="m3-search-field h-10 w-full text-[14px] px-3"
              />
              {addLoading && <span className="absolute right-3 top-1.5 text-[11px] animate-pulse" style={{ color: 'var(--md-sys-on-surface-variant)' }}>…</span>}
            </div>
            {addResults.length > 0 && (
              <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                {addResults.map(n => (
                  <button
                    key={n.id}
                    type="button"
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
                    className="m3-state m3-focus-ring w-full text-left px-2 py-1.5 rounded-lg"
                    style={{ color: 'var(--md-sys-on-surface)' }}
                  >
                    <span className="font-mono font-bold text-[12px]" style={{ color: subjectColor(n.subject_id) }}>{n.label}</span>
                    <span className="text-[11px] ml-1" style={{ color: 'var(--md-sys-on-surface-variant)' }}>{subjectName(n.subject_id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

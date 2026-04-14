'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_GRAPH_RELATION_TYPE } from '@/lib/knowledge-graph/domain'
import type { GNode, GEdge, GraphRelationAnalysis } from './types'
import {
  subjectColor, subjectName, cleanKeyword, edgeColor, edgeRelationLabel,
  classifyRelation, buildFallbackRelationExplanation, buildFallbackTeachingHint,
  hasCompletedRelationAnalysis, getRelationDisplayState, getRelationStatusMeta,
  RELATION_COLORS,
} from './constants'

interface NodePopupProps {
  node: GNode
  centerNodeId: string | null
  rawNodes: GNode[]
  visibleNodes: GNode[]
  visibleEdges: GEdge[]
  claudeRelations: Map<string, GraphRelationAnalysis>
  claudeLoading: boolean
  popupAnalysisLoading: boolean
  onClose: () => void
}

export default function NodePopup({
  node, centerNodeId, rawNodes, visibleNodes, visibleEdges,
  claudeRelations, claudeLoading, popupAnalysisLoading, onClose,
}: NodePopupProps) {
  if (typeof document === 'undefined' || node.type !== 'standard') return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center z-[9999]"
      style={{ background: 'rgba(0,0,0,0.50)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full relative overflow-hidden"
        style={{ maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 flex items-start justify-between gap-3" style={{ background: subjectColor(node.subject_id) }}>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono font-bold text-xl text-white">{node.label}</span>
              <span className="text-sm font-semibold text-white/80 bg-white/20 px-2 py-0.5 rounded-full">
                {subjectName(node.subject_id)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-white/70 text-xs">
              {node.grade_band && <span>{node.grade_band}학년군</span>}
              {node.area && <span>· {node.area}</span>}
            </div>
          </div>
          <button className="text-white/60 hover:text-white text-2xl leading-none shrink-0 mt-0.5" onClick={onClose}>×</button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-base text-gray-800 leading-relaxed mb-5">{node.text}</p>

          {/* 키워드 태그 */}
          {(node.keywords ?? []).length > 0 && (() => {
            const cleaned = [...new Set(
              (node.keywords ?? []).map(cleanKeyword).filter(w => w.length >= 2)
            )].slice(0, 12)
            if (cleaned.length === 0) return null
            return (
              <div className="mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">핵심 키워드</div>
                <div className="flex flex-wrap gap-1.5">
                  {cleaned.map(kw => (
                    <span
                      key={kw}
                      className="px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{
                        background: subjectColor(node.subject_id) + '20',
                        color: subjectColor(node.subject_id),
                        border: `1px solid ${subjectColor(node.subject_id)}40`,
                      }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* 연결된 성취기준 */}
          {(() => {
            const related = visibleEdges.filter(e => e.source === node.id || e.target === node.id)
            if (related.length === 0) return null
            return (
              <div className="mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">교과 간 연결 성취기준</div>
                <div className="space-y-2">
                  {related.slice(0, 6).map(e => {
                    const otherId = e.source === node.id ? e.target : e.source
                    const other = visibleNodes.find(n => n.id === otherId)
                    const label = edgeRelationLabel(e)
                    if (!other) return null
                    return (
                      <div
                        key={e.id}
                        className="rounded-xl p-3 border"
                        style={{ borderColor: subjectColor(other.subject_id) + '40', background: subjectColor(other.subject_id) + '08' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="font-mono font-bold text-sm" style={{ color: subjectColor(other.subject_id) }}>{other.label}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: subjectColor(other.subject_id) + '20', color: subjectColor(other.subject_id) }}>
                            {subjectName(other.subject_id)}
                          </span>
                          {label && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: edgeColor(e.method) + '20', color: edgeColor(e.method), border: `1px solid ${edgeColor(e.method)}50` }}>
                              {label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{other.text ?? ''}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Agent 분석 */}
          {node.id !== centerNodeId && (() => {
            const claudeKey = [centerNodeId ?? '', node.id].sort().join('||')
            const claudeRel = claudeRelations.get(claudeKey)
            const centerNode = centerNodeId ? rawNodes.find(n => n.id === centerNodeId) : null
            const hasAnalyzed = hasCompletedRelationAnalysis(claudeRel)
            const relationType = centerNode
              ? (claudeRel?.relationType ?? classifyRelation(centerNode, node))
              : undefined
            // AI 분석 완료 시 우선, 아니면 폴백 설명 제공 (빈 상태 없음)
            const relationExplanation = centerNode
              ? (hasAnalyzed
                  ? (claudeRel.explanation?.trim() || buildFallbackRelationExplanation(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE))
                  : buildFallbackRelationExplanation(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE))
              : ''
            const teachingNote = centerNode
              ? (hasAnalyzed
                  ? (claudeRel?.teachingNote ?? buildFallbackTeachingHint(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE))
                  : buildFallbackTeachingHint(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE))
              : undefined
            const relationStatus = getRelationStatusMeta(getRelationDisplayState(claudeRel))
            if (!centerNodeId) return null
            return (
              <div className="rounded-xl bg-[#F3E5F5]/60 border border-[#CE93D8]/50 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-[#7B1FA2]">수업 아이디어</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                  {relationType && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: RELATION_COLORS[relationType] ?? '#7B1FA2', background: (RELATION_COLORS[relationType] ?? '#7B1FA2') + '18' }}>
                      {relationType}
                    </span>
                  )}
                </div>
                {(popupAnalysisLoading || claudeLoading) && !hasAnalyzed ? (
                  <div className="flex items-center gap-2 text-[12px] text-[#7B1FA2] animate-pulse">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[#CE93D8] border-t-[#7B1FA2] animate-spin inline-block" />
                    수업 아이디어 생성 중…
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 leading-relaxed mb-2">{relationExplanation}</p>
                    {teachingNote && (
                      <div className="border-t border-[#CE93D8]/30 pt-2">
                        <p className="text-xs font-semibold text-[#7B1FA2] mb-0.5">수업 제안</p>
                        <p className="text-sm text-gray-600 leading-relaxed">{teachingNote}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>,
    document.body
  )
}

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

interface CurriculumSheetContext {
  coreIdea?: string
  knowledge?: string
  processFunction?: string
  agentLessonExample?: string
  description?: string
  subject?: string
}

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
  onReanalyze?: (popupId: string, centerNodeId: string) => void
  curriculumSheetContext?: CurriculumSheetContext | null
}

export default function NodePopup({
  node, centerNodeId, rawNodes, visibleNodes, visibleEdges,
  claudeRelations, claudeLoading, popupAnalysisLoading, onClose, onReanalyze,
  curriculumSheetContext,
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
              <span className="text-base font-semibold text-white/80 bg-white/20 px-2 py-0.5 rounded-full">
                {subjectName(node.subject_id)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-white/70 text-sm">
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
                <div className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">핵심 키워드</div>
                <div className="flex flex-wrap gap-1.5">
                  {cleaned.map(kw => (
                    <span
                      key={kw}
                      className="px-2.5 py-1 rounded-full text-sm font-semibold"
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

          {/* 교육과정 시트 맥락 */}
          {curriculumSheetContext && (curriculumSheetContext.coreIdea || curriculumSheetContext.knowledge || curriculumSheetContext.processFunction || curriculumSheetContext.agentLessonExample || curriculumSheetContext.description) && (
            <div className="mb-5 rounded-xl p-4" style={{ background: '#F3E5F5', border: '1px solid #CE93D8' }}>
              <div className="text-sm font-semibold text-[#7B1FA2] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-[#7B1FA2] text-white text-[10px] flex items-center justify-center font-bold">S</span>
                분석 시트 맥락
              </div>
              <div className="space-y-2.5">
                {curriculumSheetContext.coreIdea && (
                  <div>
                    <span className="text-[12px] font-bold text-[#7B1FA2] uppercase">핵심아이디어</span>
                    <p className="text-base text-[#4A148C] leading-relaxed mt-0.5">{curriculumSheetContext.coreIdea}</p>
                  </div>
                )}
                {curriculumSheetContext.knowledge && (
                  <div>
                    <span className="text-[12px] font-bold text-[#0D47A1] uppercase">지식·이해</span>
                    <p className="text-base text-[#1A237E] leading-relaxed mt-0.5">{curriculumSheetContext.knowledge}</p>
                  </div>
                )}
                {curriculumSheetContext.processFunction && (
                  <div>
                    <span className="text-[12px] font-bold text-[#137333] uppercase">과정·기능</span>
                    <p className="text-base text-[#1B5E20] leading-relaxed mt-0.5">{curriculumSheetContext.processFunction}</p>
                  </div>
                )}
                {curriculumSheetContext.agentLessonExample && (
                  <div>
                    <span className="text-[12px] font-bold text-[#7B1FA2] uppercase">Agent 추천 수업 예시</span>
                    <p className="text-base text-[#4A148C] leading-relaxed mt-0.5 whitespace-pre-line">{curriculumSheetContext.agentLessonExample}</p>
                  </div>
                )}
                {curriculumSheetContext.description && (
                  <div>
                    <span className="text-[12px] font-bold text-[#5F6368] uppercase">수업내용 설명</span>
                    <p className="text-base text-[#202124] leading-relaxed mt-0.5">{curriculumSheetContext.description}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 연결된 성취기준 */}
          {(() => {
            const related = visibleEdges.filter(e => e.source === node.id || e.target === node.id)
            if (related.length === 0) return null
            return (
              <div className="mb-5">
                <div className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">교과 간 연결 성취기준</div>
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
                          <span className="font-mono font-bold text-base" style={{ color: subjectColor(other.subject_id) }}>{other.label}</span>
                          <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded" style={{ background: subjectColor(other.subject_id) + '20', color: subjectColor(other.subject_id) }}>
                            {subjectName(other.subject_id)}
                          </span>
                          {label && (
                            <span className="text-[12px] px-2 py-0.5 rounded-full font-semibold" style={{ background: edgeColor(e.method) + '20', color: edgeColor(e.method), border: `1px solid ${edgeColor(e.method)}50` }}>
                              {label}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed">{other.text ?? ''}</p>
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
            const ideas = claudeRel?.ideas && claudeRel.ideas.length > 0 ? claudeRel.ideas : undefined
            const relationType = centerNode
              ? (claudeRel?.relationType ?? classifyRelation(centerNode, node))
              : undefined
            const teachingNote = centerNode
              ? (hasAnalyzed
                  ? (claudeRel?.teachingNote ?? buildFallbackTeachingHint(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE))
                  : buildFallbackTeachingHint(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE))
              : undefined
            const relationRationale = claudeRel?.explanation?.trim()
              || (centerNode ? buildFallbackRelationExplanation(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE) : '')
            const relationStatus = getRelationStatusMeta(getRelationDisplayState(claudeRel))
            const loading = (popupAnalysisLoading || claudeLoading) && !hasAnalyzed
            if (!centerNodeId) return null
            return (
              <div className="rounded-xl bg-[#F3E5F5]/60 border border-[#CE93D8]/50 px-4 py-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-bold text-[#7B1FA2]">수업 아이디어</span>
                  <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${relationStatus.className}`}>{relationStatus.label}</span>
                  {relationType && (
                    <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ color: RELATION_COLORS[relationType] ?? '#7B1FA2', background: (RELATION_COLORS[relationType] ?? '#7B1FA2') + '18' }}>
                      {relationType}
                    </span>
                  )}
                  {onReanalyze && !loading && (
                    <button
                      onClick={() => onReanalyze(node.id, centerNodeId ?? node.id)}
                      className="ml-auto text-[12px] font-semibold px-2 py-0.5 rounded-full bg-white text-[#7B1FA2] border border-[#CE93D8] hover:bg-[#F3E5F5] transition"
                      title="Claude로 분석하기"
                    >
                      ↻ {centerNodeId ? '다시 분석' : 'AI 분석'}
                    </button>
                  )}
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 text-[14px] text-[#7B1FA2] animate-pulse">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[#CE93D8] border-t-[#7B1FA2] animate-spin inline-block" />
                    AI가 두 성취기준의 교차점을 분석 중…
                  </div>
                ) : (
                  <>
                    {/* 수업 아이디어 — 콘텐츠 접근 (보편+창의) */}
                    {ideas ? (
                      <ul className="text-base text-gray-800 leading-relaxed mb-3 space-y-1.5 list-none">
                        {ideas.map((idea, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ background: i === 0 ? '#9E9E9E' : '#7B1FA2' }}>
                              {i === 0 ? '보' : '창'}
                            </span>
                            <span className="flex-1">{idea}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-base text-gray-500 italic mb-3">
                        AI 분석이 아직 없어요. ↻ 다시 분석을 눌러 구체적인 아이디어를 받아보세요.
                      </p>
                    )}

                    {/* 수업 제안 — 융합 수업 구조 */}
                    {teachingNote && (
                      <div className="border-t border-[#CE93D8]/30 pt-2.5 mb-2">
                        <p className="text-sm font-semibold text-[#7B1FA2] mb-1">수업 제안 <span className="font-normal text-gray-400">· 융합 구조</span></p>
                        <p className="text-base text-gray-700 leading-relaxed whitespace-pre-wrap">{teachingNote}</p>
                      </div>
                    )}

                    {/* 관계 근거 — 작게 */}
                    {relationRationale && (
                      <div className="border-t border-[#CE93D8]/30 pt-2">
                        <p className="text-[12px] font-semibold text-gray-400 mb-0.5 uppercase tracking-wide">관계 근거</p>
                        <p className="text-sm text-gray-500 leading-relaxed">{relationRationale}</p>
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

'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_GRAPH_RELATION_TYPE } from '@/lib/knowledge-graph/domain'
import type { GNode, GEdge, GraphRelationAnalysis } from './types'
import {
  subjectColor, subjectName, cleanKeyword, edgeColor, edgeRelationLabel,
  classifyRelation, buildFallbackRelationExplanation, buildFallbackTeachingHint,
  hasCompletedRelationAnalysis, getRelationDisplayState, getRelationStatusMeta,
  RELATION_COLORS,
} from './constants'

// MD3 tokens — scoped to the portal root (rendered outside `.m3-landing`).
// Defined via an injected <style> so a `prefers-color-scheme: dark` media query
// can switch the palette (inline styles cannot express media queries, and only
// this file may be edited). Descendants inherit the custom properties.
const POPUP_THEME_CSS = `
.kg-node-popup-scrim {
  --md-primary:#0B57D0; --md-on-primary:#FFFFFF;
  --md-primary-container:#D3E3FD; --md-on-primary-container:#041E49;
  --md-secondary-container:#C2E7FF; --md-on-secondary-container:#001D35;
  --md-tertiary-container:#C4EED0; --md-on-tertiary-container:#072711;
  --md-surface:#FFFFFF;
  --md-surface-container-lowest:#FFFFFF;
  --md-surface-container-low:#F8FAFD;
  --md-surface-container:#F0F4F9;
  --md-surface-container-high:#E9EEF6;
  --md-surface-container-highest:#DDE3EA;
  --md-on-surface:#1F1F1F; --md-on-surface-variant:#444746;
  --md-outline:#747775; --md-outline-variant:#C4C7C5;
  --md-scrim:rgba(0,0,0,0.50);
}
@media (prefers-color-scheme: dark) {
  .kg-node-popup-scrim {
    --md-primary:#A8C7FA; --md-on-primary:#062E6F;
    --md-primary-container:#284777; --md-on-primary-container:#D3E3FD;
    --md-secondary-container:#004A77; --md-on-secondary-container:#C2E7FF;
    --md-tertiary-container:#0F5223; --md-on-tertiary-container:#C4EED0;
    --md-surface:#131314;
    --md-surface-container-lowest:#0E0E0E;
    --md-surface-container-low:#1B1B1B;
    --md-surface-container:#1E1F20;
    --md-surface-container-high:#282A2C;
    --md-surface-container-highest:#333537;
    --md-on-surface:#E3E3E3; --md-on-surface-variant:#C4C7C5;
    --md-outline:#8E918F; --md-outline-variant:#444746;
    --md-scrim:rgba(0,0,0,0.60);
  }
}
`

// Divider shared between stacked body sections.
const SECTION_BORDER = '1px solid var(--md-outline-variant)'

// Theme-adaptive relation-status badge styling, keyed on the display state.
// Replaces getRelationStatusMeta().className, whose hardcoded light-only hex
// classes fail on the dark surface. M3 container / on-container token pairs are
// defined for both light and dark and are contrast-safe by design.
const RELATION_STATUS_STYLE = {
  claude:    { background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' },
  rule:      { background: 'var(--md-tertiary-container)', color: 'var(--md-on-tertiary-container)' },
  estimated: { background: 'var(--md-surface-container-highest)', color: 'var(--md-on-surface-variant)' },
}

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Initial focus on the close button; restore focus to the opener on unmount.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => { prev?.focus?.() }
  }, [])

  // Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  if (typeof document === 'undefined' || node.type !== 'standard') return null

  // Education subject color — used only as a slim accent (strip, heading tick,
  // tonal badges), never as a large fill.
  const accent = subjectColor(node.subject_id)

  // Consistent M3 section heading with a small subject-colored tick.
  const sectionHeading = (label: string) => (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-1 h-4 rounded-full shrink-0" style={{ background: accent }} />
      <h3 className="text-sm font-semibold" style={{ color: 'var(--md-on-surface)' }}>{label}</h3>
    </div>
  )

  return createPortal(
    <div
      className="kg-node-popup-scrim fixed inset-0 flex items-center justify-center z-[9999] p-4"
      style={{ background: 'var(--md-scrim)' }}
      onClick={onClose}
    >
      <style>{POPUP_THEME_CSS}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kg-node-popup-title"
        className="rounded-[28px] md-shadow-3 w-full relative overflow-hidden"
        style={{
          maxWidth: 'min(560px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--md-surface)', color: 'var(--md-on-surface)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 슬림 교과 강조 스트립 */}
        <div className="h-1.5 w-full shrink-0" style={{ background: accent }} />

        {/* 스티키 헤더 — 차분한 표면, 교과색은 토널 배지에만 */}
        <div
          className="shrink-0 px-6 pt-4 pb-3 flex items-start justify-between gap-3"
          style={{ background: 'var(--md-surface)', borderBottom: SECTION_BORDER }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span id="kg-node-popup-title" className="font-mono font-bold text-xl" style={{ color: 'var(--md-on-surface)' }}>{node.label}</span>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: accent + '1F', color: accent }}
              >
                {subjectName(node.subject_id)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--md-on-surface-variant)' }}>
              {node.grade_band && <span>{node.grade_band}학년군</span>}
              {node.area && <span>· {node.area}</span>}
            </div>
          </div>
          <button
            ref={closeRef}
            aria-label="닫기"
            className="m3-state shrink-0 w-10 h-10 -mt-1 -mr-1 rounded-full flex items-center justify-center"
            style={{ color: 'var(--md-on-surface-variant)' }}
            onClick={onClose}
          >
            <span className="text-2xl leading-none">×</span>
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto panel-scroll">
          <div className="px-6">
            <p className="py-5 text-[15px] leading-relaxed" style={{ color: 'var(--md-on-surface)' }}>{node.text}</p>

            {/* 키워드 — M3 어시스트 칩 */}
            {(node.keywords ?? []).length > 0 && (() => {
              const cleaned = [...new Set(
                (node.keywords ?? []).map(cleanKeyword).filter(w => w.length >= 2)
              )].slice(0, 12)
              if (cleaned.length === 0) return null
              return (
                <section className="py-5" style={{ borderTop: SECTION_BORDER }}>
                  {sectionHeading('핵심 키워드')}
                  <div className="flex flex-wrap gap-2">
                    {cleaned.map(kw => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium border"
                        style={{
                          background: 'var(--md-surface)',
                          color: 'var(--md-on-surface)',
                          borderColor: 'var(--md-outline-variant)',
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
                        {kw}
                      </span>
                    ))}
                  </div>
                </section>
              )
            })()}

            {/* 교육과정 시트 맥락 — surface-container 토널 카드 */}
            {curriculumSheetContext && (curriculumSheetContext.coreIdea || curriculumSheetContext.knowledge || curriculumSheetContext.processFunction || curriculumSheetContext.agentLessonExample || curriculumSheetContext.description) && (
              <section className="py-5" style={{ borderTop: SECTION_BORDER }}>
                {sectionHeading('분석 시트 맥락')}
                <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--md-surface-container)' }}>
                  {curriculumSheetContext.coreIdea && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--md-on-surface-variant)' }}>핵심아이디어</span>
                      <p className="text-sm leading-relaxed mt-0.5" style={{ color: 'var(--md-on-surface)' }}>{curriculumSheetContext.coreIdea}</p>
                    </div>
                  )}
                  {curriculumSheetContext.knowledge && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--md-on-surface-variant)' }}>지식·이해</span>
                      <p className="text-sm leading-relaxed mt-0.5" style={{ color: 'var(--md-on-surface)' }}>{curriculumSheetContext.knowledge}</p>
                    </div>
                  )}
                  {curriculumSheetContext.processFunction && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--md-on-surface-variant)' }}>과정·기능</span>
                      <p className="text-sm leading-relaxed mt-0.5" style={{ color: 'var(--md-on-surface)' }}>{curriculumSheetContext.processFunction}</p>
                    </div>
                  )}
                  {curriculumSheetContext.agentLessonExample && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--md-on-surface-variant)' }}>Agent 추천 수업 예시</span>
                      <p className="text-sm leading-relaxed mt-0.5 whitespace-pre-line" style={{ color: 'var(--md-on-surface)' }}>{curriculumSheetContext.agentLessonExample}</p>
                    </div>
                  )}
                  {curriculumSheetContext.description && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--md-on-surface-variant)' }}>수업내용 설명</span>
                      <p className="text-sm leading-relaxed mt-0.5" style={{ color: 'var(--md-on-surface)' }}>{curriculumSheetContext.description}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 연결된 성취기준 — 아웃라인 카드 */}
            {(() => {
              const related = visibleEdges.filter(e => e.source === node.id || e.target === node.id)
              if (related.length === 0) return null
              return (
                <section className="py-5" style={{ borderTop: SECTION_BORDER }}>
                  {sectionHeading('교과 간 연결 성취기준')}
                  <div className="space-y-2">
                    {related.slice(0, 6).map(e => {
                      const otherId = e.source === node.id ? e.target : e.source
                      const other = visibleNodes.find(n => n.id === otherId)
                      const label = edgeRelationLabel(e)
                      if (!other) return null
                      const otherColor = subjectColor(other.subject_id)
                      const relColor = edgeColor(e.method)
                      return (
                        <div
                          key={e.id}
                          className="rounded-2xl p-3 border"
                          style={{ borderColor: 'var(--md-outline-variant)', background: 'var(--md-surface)' }}
                        >
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="font-mono font-bold text-base" style={{ color: otherColor }}>{other.label}</span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: otherColor + '1F', color: otherColor }}>
                              {subjectName(other.subject_id)}
                            </span>
                            {label && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: relColor + '1F', color: relColor }}>
                                {label}
                              </span>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: 'var(--md-on-surface-variant)' }}>{other.text ?? ''}</p>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })()}

            {/* Agent 분석 — 차분한 토널 카드 */}
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
              const relationState = getRelationDisplayState(claudeRel)
              const relationStatus = getRelationStatusMeta(relationState)
              const loading = (popupAnalysisLoading || claudeLoading) && !hasAnalyzed
              if (!centerNodeId) return null
              return (
                <section className="py-5" style={{ borderTop: SECTION_BORDER }}>
                  <div className="rounded-2xl p-4" style={{ background: 'var(--md-surface-container-low)', border: SECTION_BORDER }}>
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: 'var(--md-on-surface)' }}>수업 아이디어</span>
                      <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={RELATION_STATUS_STYLE[relationState]}>{relationStatus.label}</span>
                      {relationType && (
                        <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ color: RELATION_COLORS[relationType] ?? '#7B1FA2', background: (RELATION_COLORS[relationType] ?? '#7B1FA2') + '1F' }}>
                          {relationType}
                        </span>
                      )}
                      {onReanalyze && !loading && (
                        <button
                          onClick={() => onReanalyze(node.id, centerNodeId ?? node.id)}
                          className="m3-state ml-auto text-[12px] font-semibold px-3 h-8 rounded-full border inline-flex items-center"
                          style={{ background: 'var(--md-surface)', color: 'var(--md-primary)', borderColor: 'var(--md-outline)' }}
                          title="Claude로 분석하기"
                          aria-label="Claude로 다시 분석하기"
                        >
                          ↻ {centerNodeId ? '다시 분석' : 'AI 분석'}
                        </button>
                      )}
                    </div>
                    {loading ? (
                      <div className="flex items-center gap-2 text-sm animate-pulse" style={{ color: 'var(--md-primary)' }}>
                        <span className="w-3.5 h-3.5 rounded-full border-2 animate-spin inline-block" style={{ borderColor: 'var(--md-outline-variant)', borderTopColor: 'var(--md-primary)' }} />
                        AI가 두 성취기준의 교차점을 분석 중…
                      </div>
                    ) : (
                      <>
                        {/* 수업 아이디어 — 콘텐츠 접근 (보편+창의) */}
                        {ideas ? (
                          <ul className="text-[15px] leading-relaxed mb-3 space-y-1.5 list-none" style={{ color: 'var(--md-on-surface)' }}>
                            {ideas.map((idea, i) => (
                              <li key={i} className="flex gap-2">
                                <span
                                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold"
                                  style={i === 0
                                    ? { background: 'var(--md-surface-container-highest)', color: 'var(--md-on-surface-variant)' }
                                    : { background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}
                                >
                                  {i === 0 ? '보' : '창'}
                                </span>
                                <span className="flex-1">{idea}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm italic mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                            AI 분석이 아직 없어요. ↻ 다시 분석을 눌러 구체적인 아이디어를 받아보세요.
                          </p>
                        )}

                        {/* 수업 제안 — 융합 수업 구조 */}
                        {teachingNote && (
                          <div className="pt-2.5 mb-2" style={{ borderTop: SECTION_BORDER }}>
                            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--md-on-surface)' }}>수업 제안 <span className="font-normal" style={{ color: 'var(--md-on-surface-variant)' }}>· 융합 구조</span></p>
                            <p className="text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--md-on-surface)' }}>{teachingNote}</p>
                          </div>
                        )}

                        {/* 관계 근거 — 작게 */}
                        {relationRationale && (
                          <div className="pt-2" style={{ borderTop: SECTION_BORDER }}>
                            <p className="text-[12px] font-semibold mb-0.5 uppercase tracking-wide" style={{ color: 'var(--md-on-surface-variant)' }}>관계 근거</p>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--md-on-surface-variant)' }}>{relationRationale}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )
            })()}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

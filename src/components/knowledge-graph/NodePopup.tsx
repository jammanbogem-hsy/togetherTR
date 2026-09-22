'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SheetAppBar } from '@/components/chat/curriculum-sheet/SheetAppBar'
import { SheetBottomBar } from '@/components/chat/curriculum-sheet/SheetBottomBar'
import { LabelChip } from '@/components/chat/curriculum-sheet/SheetChips'
import { MD3Button } from '@/components/ui/MD3Button'
import { DEFAULT_GRAPH_RELATION_TYPE } from '@/lib/knowledge-graph/domain'
import { subjectIcon } from '@/components/curriculum-map/subjectIcons'
import type { GNode, GEdge, GraphRelationAnalysis } from './types'
import {
  subjectColor, subjectName, cleanKeyword, classifyRelation,
  buildFallbackRelationExplanation, buildFallbackTeachingHint,
  hasCompletedRelationAnalysis, getRelationDisplayState, getRelationStatusMeta,
  RELATION_COLORS,
} from './constants'
import { graphEdgeAppearance } from './graphPresentation'

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

function gradeLabel(node: GNode) {
  if (node.grade_band) {
    const band = node.grade_band.replace(/^초(?=\d)/, '')
    return band.endsWith('학년군') ? band : `${band}학년군`
  }
  const grade = node.label.replace(/^\[/, '')[0]
  return ({ '2': '1–2학년군', '4': '3–4학년군', '6': '5–6학년군' } as Record<string, string>)[grade] ?? ''
}

const sectionClass = 'overflow-hidden rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface)]'
const headingClass = 'border-b border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-4 py-3 text-[14px] font-medium text-[var(--md-on-surface)]'

export default function NodePopup({
  node, centerNodeId, rawNodes, visibleNodes, visibleEdges,
  claudeRelations, claudeLoading, popupAnalysisLoading, onClose, onReanalyze,
  curriculumSheetContext,
}: NodePopupProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { previous?.focus() }
  }, [])

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [node.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      const first = focusables[0], last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  if (typeof document === 'undefined' || node.type !== 'standard') return null

  const accent = subjectColor(node.subject_id)
  const band = gradeLabel(node)
  const keywords = [...new Set((node.keywords ?? []).map(cleanKeyword).filter(word => word.length >= 2))].slice(0, 12)
  const fields = [
    { label: '핵심아이디어', value: curriculumSheetContext?.coreIdea },
    { label: '지식·이해', value: curriculumSheetContext?.knowledge },
    { label: '과정·기능', value: curriculumSheetContext?.processFunction },
    { label: 'Agent 추천 수업 예시', value: curriculumSheetContext?.agentLessonExample },
    { label: '수업내용 설명', value: curriculumSheetContext?.description },
  ].filter(field => field.value?.trim())
  const related = visibleEdges
    .filter(edge => edge.source === node.id || edge.target === node.id)
    .flatMap(edge => {
      const otherId = edge.source === node.id ? edge.target : edge.source
      const other = visibleNodes.find(candidate => candidate.id === otherId)
      if (!other) return []
      const analysis = claudeRelations.get([node.id, otherId].sort().join('||'))
      return [{ edge, other, appearance: graphEdgeAppearance(edge, analysis, false, false) }]
    })
  const centerNode = centerNodeId ? rawNodes.find(candidate => candidate.id === centerNodeId) : null
  const analysis = claudeRelations.get([centerNodeId ?? '', node.id].sort().join('||'))
  const hasAnalyzed = hasCompletedRelationAnalysis(analysis)
  const relationType = centerNode ? (analysis?.relationType ?? classifyRelation(centerNode, node)) : undefined
  const relationState = getRelationDisplayState(analysis)
  const relationStatus = getRelationStatusMeta(relationState)
  const loading = popupAnalysisLoading || claudeLoading
  const showLoading = loading && !hasAnalyzed
  const ideas = analysis?.ideas?.length ? analysis.ideas : undefined
  const teachingNote = centerNode
    ? (hasAnalyzed ? analysis?.teachingNote : undefined) ?? buildFallbackTeachingHint(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE)
    : undefined
  const rationale = analysis?.explanation?.trim()
    || (centerNode ? buildFallbackRelationExplanation(centerNode, node, relationType ?? DEFAULT_GRAPH_RELATION_TYPE) : '')

  return createPortal(
    <div className="m3-sheet kg-node-popup-scrim fixed inset-0 z-[15000] flex items-center justify-center bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${node.label} 성취기준 상세`}
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[960px] flex-col overflow-hidden rounded-[28px] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] text-[var(--md-on-surface)] shadow-2xl sm:max-h-[min(880px,calc(100dvh-48px))]"
        onClick={event => event.stopPropagation()}
      >
        <SheetAppBar title="성취기준 상세" supporting={[node.label, band, node.area].filter(Boolean).join(' · ')}
          elevated={false} onClose={onClose} closeLabel="성취기준 상세 닫기"
        >
          <LabelChip variant={node.id === centerNodeId ? 'primary' : 'surface'}>
            {node.id === centerNodeId ? '중심 성취기준' : '연결 성취기준'}
          </LabelChip>
        </SheetAppBar>

        <div ref={bodyRef} data-node-popup-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--md-surface-container-low)] p-4 sm:p-6">
          <section aria-label="성취기준 내용" className={`${sectionClass} mb-5 p-4 sm:p-5`}>
            <div className="mb-3 flex items-center gap-3">
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: accent + '18', color: accent }}>
                <span className="material-symbols-rounded text-[26px]">{subjectIcon(node.subject_id)}</span>
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[18px] font-medium text-[var(--md-primary)]">{node.label}</span>
                  <span className="rounded-lg px-2 py-0.5 text-[12px] font-medium" style={{ background: accent + '18', color: accent }}>{subjectName(node.subject_id)}</span>
                </div>
                <p className="mt-1 text-[12px] text-[var(--md-on-surface-variant)]">{[band, node.area].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <p className="whitespace-pre-line text-[16px] leading-7">{node.text}</p>
            {keywords.length > 0 && <div aria-label="핵심 키워드" className="mt-4 flex flex-wrap gap-2">
              {keywords.map(keyword => <LabelChip key={keyword} className="px-2.5 py-1.5">{keyword}</LabelChip>)}
            </div>}
          </section>

          <div className={`grid items-start gap-5 ${fields.length > 0 && related.length > 0 ? 'md:grid-cols-2' : ''}`}>
            {fields.length > 0 && <section aria-labelledby="kg-sheet-context-title" className={sectionClass}>
              <h3 id="kg-sheet-context-title" className={headingClass}>교육과정 분석시트</h3>
              <dl className="divide-y divide-[var(--md-outline-variant)]">
                {fields.map(field => <div key={field.label} className="px-4 py-3">
                  <dt className="mb-1.5 text-[12px] font-medium text-[var(--md-on-surface-variant)]">{field.label}</dt>
                  <dd className="whitespace-pre-line text-[14px] leading-6">{field.value}</dd>
                </div>)}
              </dl>
            </section>}

            {related.length > 0 && <section aria-labelledby="kg-related-title" className={sectionClass}>
              <h3 id="kg-related-title" className={`${headingClass} flex flex-wrap items-center justify-between gap-2`}>
                교과 간 연결 성취기준 <LabelChip>{related.length}개</LabelChip>
              </h3>
              <ul className="divide-y divide-[var(--md-outline-variant)]">
                {related.map(({ edge, other, appearance }) => <li key={edge.id} className="px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-[var(--md-primary)]">{other.label}</span>
                    <span className="rounded-lg px-2 py-0.5 text-[12px] font-medium" style={{ background: subjectColor(other.subject_id) + '18', color: subjectColor(other.subject_id) }}>{subjectName(other.subject_id)}</span>
                    {gradeLabel(other) && <span className="text-[12px] text-[var(--md-on-surface-variant)]">{gradeLabel(other)}</span>}
                  </div>
                  <p className="text-[14px] leading-6">{other.text}</p>
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--md-surface-container)] px-2 py-1 text-[12px] text-[var(--md-on-surface-variant)]">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: appearance.color }} />{appearance.label}
                  </span>
                </li>)}
              </ul>
            </section>}
          </div>

          {node.id !== centerNodeId && centerNodeId && <section aria-labelledby="kg-lesson-ideas-title" className={`${sectionClass} mt-5`}>
            <div className={`${headingClass} flex flex-wrap items-center gap-2`}>
              <h3 id="kg-lesson-ideas-title">수업 아이디어</h3>
              <LabelChip variant={relationState === 'claude' ? 'primary' : relationState === 'rule' ? 'tertiary' : 'surface'}>{relationStatus.label}</LabelChip>
              {relationType && <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--md-on-surface-variant)]">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: hasAnalyzed ? RELATION_COLORS[relationType] : '#94A3B8' }} />{relationType}
              </span>}
              {onReanalyze && <MD3Button variant="outlined" size="xs" className="ml-auto" disabled={loading}
                onClick={() => onReanalyze(node.id, centerNodeId)} aria-label="성취기준 연결 다시 분석">
                {loading ? '분석 중…' : '다시 분석'}
              </MD3Button>}
            </div>
            <div className="space-y-4 p-4">
              {showLoading ? <p role="status" className="text-[14px] leading-6 text-[var(--md-primary)]">성취기준의 연결과 수업 아이디어를 분석하고 있습니다…</p> : <>
                {ideas ? <ol className="space-y-3">
                  {ideas.map((idea, index) => <li key={index} className="flex items-start gap-3 text-[14px] leading-6">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--md-primary-container)] text-[12px] font-medium text-[var(--md-on-primary-container)]">{index + 1}</span>
                    <span className="whitespace-pre-line">{idea}</span>
                  </li>)}
                </ol> : <p className="text-[14px] leading-6 text-[var(--md-on-surface-variant)]">
                  {onReanalyze ? '다시 분석을 누르면 연결된 성취기준을 바탕으로 수업 아이디어를 제안합니다.' : '팀장이 분석하면 수업 아이디어를 함께 확인할 수 있습니다.'}
                </p>}
                {teachingNote && <div className="rounded-xl bg-[var(--md-surface-container-low)] p-4">
                  <h4 className="mb-2 text-[12px] font-medium text-[var(--md-on-surface-variant)]">수업 제안 · 융합 구조</h4>
                  <p className="whitespace-pre-line text-[14px] leading-6">{teachingNote}</p>
                </div>}
                {rationale && <div className="border-t border-[var(--md-outline-variant)] pt-3">
                  <h4 className="mb-1 text-[12px] font-medium text-[var(--md-on-surface-variant)]">관계 근거</h4>
                  <p className="whitespace-pre-line text-[14px] leading-6 text-[var(--md-on-surface-variant)]">{rationale}</p>
                </div>}
              </>}
            </div>
          </section>}
        </div>

        <SheetBottomBar
          start={<span className="text-[12px] leading-5 text-[var(--md-on-surface-variant)]">{subjectName(node.subject_id)}{band ? ` · ${band}` : ''}</span>}
          end={<MD3Button variant="filled" onClick={onClose}>그래프로 돌아가기</MD3Button>}
        />
      </div>
    </div>,
    document.body,
  )
}

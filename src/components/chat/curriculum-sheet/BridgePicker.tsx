'use client'

// ─── 교육과정 분석 시트 — 연결 줄 '유사 성취기준 찾기' 팝오버 (표시 전용) ───
// 다른 교과의 그 학년군 성취기준 후보를 보여 주고 하나를 고르게 한다.
// 판정·요청·적용 로직은 모두 CurriculumSheetModal에 있다.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/** 서버 판정기 표시 라벨 — 시트 전역에서 같은 문구를 쓴다. */
export const JUDGE_LABEL: Record<'jev' | 'embedding', string> = { jev: '수업 맥락 검토', embedding: '내용 유사도 비교' }

/** 연결 줄 후보 — /api/curriculum-sheet/autofill mode:'bridgeStandards' 응답 항목. */
export interface BridgeCandidate {
  subject: string
  code: string
  text: string
  standard: string
  area: string
  coreIdea: string
  contentCoreIdea: string
  score: number
  level: '무관' | '약함' | '관련' | '핵심'
}
const BRIDGE_LEVEL_STYLE: Record<BridgeCandidate['level'], string> = {
  '핵심': 'bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]',
  '관련': 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]',
  '약함': 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]',
  '무관': 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]',
}

// ─── 연결 줄: 유사 성취기준 찾기 팝오버 ──────────────────

interface BridgePickerProps {
  anchorRect: DOMRect | null
  sourceSubject: string
  sourceCoreIdea: string
  targetBand: string
  loading: boolean
  error?: string
  notes: string[]
  judge?: 'jev' | 'embedding'
  candidates: BridgeCandidate[]
  subjectsSearched: string[]
  subjectFilter: string
  onSubjectFilterChange: (subject: string) => void
  onSelect: (candidate: BridgeCandidate) => void
  onClose: () => void
}

export function BridgePicker({
  anchorRect, sourceSubject, sourceCoreIdea, targetBand, loading, error, notes, judge,
  candidates, subjectsSearched, subjectFilter, onSubjectFilterChange, onSelect, onClose,
}: BridgePickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const shown = subjectFilter
    ? candidates.filter(candidate => candidate.subject === subjectFilter)
    : candidates

  if (!anchorRect) return null
  const pickerHeight = Math.min(560, window.innerHeight - 24)
  const top = Math.max(12, Math.min(anchorRect.bottom + 4, window.innerHeight - pickerHeight - 12))
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - 520 - 12))

  return createPortal(
    <div
      ref={ref}
      className="m3-sheet fixed flex flex-col overflow-hidden rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] shadow-[0_2px_6px_2px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.3)]"
      style={{ top, left, width: 520, maxHeight: pickerHeight, zIndex: 10050 }}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    >
      <div className="p-3 border-b border-[#F1F3F4] flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-base font-bold text-[#202124]">
            {targetBand} 유사 성취기준 찾기
          </h4>
          <p className="mt-0.5 text-[13px] leading-relaxed text-[#5F6368] line-clamp-2" title={sourceCoreIdea}>
            {sourceSubject} 핵심아이디어: {sourceCoreIdea}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#5F6368]">선택한 교과·학년군에 맞게 핵심아이디어와 내용 요소를 반영하고, 빈 수업내용 설명도 함께 채웁니다.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {judge && (
            <span title={JUDGE_LABEL[judge]}
              className={cn('px-2 py-0.5 rounded-full text-[12px] font-bold', judge === 'jev' ? 'bg-[#E6F4EA] text-[#137333]' : 'bg-[#F1F3F4] text-[#5F6368]')}>
              {JUDGE_LABEL[judge]}
            </span>
          )}
          <button onClick={onClose} aria-label="닫기" title="닫기" className="m3-state flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]">
            <span className="material-symbols-rounded text-[20px] leading-none" aria-hidden>close</span>
          </button>
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="px-3 py-2 border-b border-[#FDD663] bg-[#FEF7E0] space-y-0.5">
          {notes.map((note, noteIdx) => (
            <li key={noteIdx} className="text-[13px] leading-relaxed text-[#8A5A00]">· {note}</li>
          ))}
        </ul>
      )}

      {subjectsSearched.length > 0 && (
        <div className="px-3 py-2 border-b border-[#F1F3F4] flex flex-wrap items-center gap-1.5">
          {['', ...subjectsSearched].map(subject => (
            <button
              key={subject || '전체'}
              onClick={() => onSubjectFilterChange(subject)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[13px] font-bold border transition',
                subjectFilter === subject
                  ? 'bg-[#E8F0FE] border-[#C2D7F8] text-[#1A73E8]'
                  : 'bg-white border-[#E8EAED] text-[#5F6368] hover:border-[#DADCE0]',
              )}
            >
              {subject || '전체'}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-8 text-center text-base text-[#9AA0A6]">유사 성취기준을 찾고 있습니다...</p>}
        {!loading && error && <p className="px-4 py-6 text-base font-semibold text-[#A50E0E]">{error}</p>}
        {!loading && !error && shown.length === 0 && (
          <p className="px-4 py-8 text-center text-base text-[#9AA0A6]">후보가 없습니다. 교과 필터를 넓혀 보세요.</p>
        )}
        {!loading && shown.map(candidate => (
          <button
            key={`${candidate.subject}:${candidate.code}`}
            onClick={() => onSelect(candidate)}
            className="w-full text-left px-4 py-3 border-b border-[#F1F3F4] hover:bg-[#F8F9FA] transition"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-bold text-[#5F6368]">{candidate.subject}</span>
              {candidate.area && <span className="text-[12px] font-semibold text-[#7B1FA2]">{candidate.area}</span>}
              <span className={cn('ml-auto px-2 py-0.5 rounded-full text-[12px] font-bold flex-shrink-0', BRIDGE_LEVEL_STYLE[candidate.level] ?? BRIDGE_LEVEL_STYLE['무관'])}>
                {candidate.level} {candidate.score.toFixed(2)}
              </span>
            </div>
            {/* code는 이미 '[2슬02-01]' 형태로 대괄호를 포함한다. standard('[코드] 본문')를 그대로 쓴다. */}
            <p className="text-base leading-relaxed text-[#1A73E8]">{candidate.standard || `${candidate.code} ${candidate.text}`.trim()}</p>
            {(candidate.contentCoreIdea || candidate.coreIdea) && (
              <p className="mt-1 text-[13px] leading-relaxed text-[#5F6368]">
                핵심아이디어: {candidate.contentCoreIdea || candidate.coreIdea}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

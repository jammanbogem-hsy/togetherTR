'use client'

// 교육과정 분석맵 우측 패널 — 검색 결과, 선택 성취기준 상세·관련 목록, 필터.

import { useState } from 'react'
import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import { EDGE_THRESHOLD_MAX, EDGE_THRESHOLD_MIN, formatScore } from './mapMath'
import { JudgeBadge, LevelBadge, ScoreBar, SectionTitle, SOURCE_LABELS } from './MapPanelBits'
import type { RelatedState, SearchState } from './useCurriculumMap'
import type { MapFilters, MapNode, MapSubject } from './types'

const FALLBACK_RELATION_COLOR = '#94A3B8'

export interface MapSidePanelProps {
  subjects: MapSubject[]
  bands: string[]
  subjectColors: Record<string, string>
  filters: MapFilters
  onToggleSubject: (subjectId: string) => void
  onToggleBand: (band: string) => void
  onEdgeThresholdChange: (value: number) => void
  onAlwaysLabelsChange: (value: boolean) => void
  onResetFilters: () => void
  search: SearchState
  onPickResult: (id: string) => void
  selectedNode: MapNode | null
  related: RelatedState
  onPickRelated: (id: string) => void
  onRefetchRelated: () => void
  onClearSelection: () => void
}

export default function MapSidePanel({
  subjects,
  bands,
  subjectColors,
  filters,
  onToggleSubject,
  onToggleBand,
  onEdgeThresholdChange,
  onAlwaysLabelsChange,
  onResetFilters,
  search,
  onPickResult,
  selectedNode,
  related,
  onPickRelated,
  onRefetchRelated,
  onClearSelection,
}: MapSidePanelProps): React.ReactElement {
  const [filtersOpen, setFiltersOpen] = useState(true)

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      {/* ── 선택 성취기준 상세 ─────────────────────────────────────────── */}
      {selectedNode && (
        <section className="border-b border-[#E8EAED] p-4">
          <SectionTitle
            right={
              <button
                type="button"
                onClick={onClearSelection}
                className="text-[11px] font-bold text-[#9AA0A6] hover:text-[#5F6368] transition-colors"
              >
                선택 해제
              </button>
            }
          >
            선택한 성취기준
          </SectionTitle>
          <div className="mb-2 flex items-center gap-1.5 flex-wrap">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-extrabold text-white"
              style={{ backgroundColor: subjectColors[selectedNode.subjectId] ?? '#9AA0A6' }}
            >
              {selectedNode.subject}
            </span>
            <span className="text-[13px] font-extrabold text-[#202124]">{selectedNode.code}</span>
            <span className="text-[11px] font-semibold text-[#5F6368]">{selectedNode.band}</span>
          </div>
          <p className="mb-2 text-[13px] leading-relaxed text-[#3C4043]">{selectedNode.text}</p>
          <dl className="space-y-1 text-[11px]">
            {selectedNode.area && (
              <div className="flex gap-1.5">
                <dt className="font-bold text-[#9AA0A6] flex-shrink-0">영역</dt>
                <dd className="font-semibold text-[#5F6368]">{selectedNode.area}</dd>
              </div>
            )}
            {selectedNode.coreIdea && (
              <div className="flex gap-1.5">
                <dt className="font-bold text-[#9AA0A6] flex-shrink-0">핵심 아이디어</dt>
                <dd className="text-[#5F6368] leading-snug">{selectedNode.coreIdea}</dd>
              </div>
            )}
          </dl>

          {/* 관련 성취기준 */}
          <div className="mt-4">
            <SectionTitle
              right={
                <div className="flex items-center gap-2">
                  <JudgeBadge judge={related.judge} elapsedMs={related.elapsedMs} />
                  <button
                    type="button"
                    onClick={onRefetchRelated}
                    disabled={related.status === 'loading'}
                    className="rounded-lg border border-[#DADCE0] px-2 py-1 text-[10px] font-bold text-[#5F6368] hover:border-[#1A73E8] hover:text-[#1A73E8] disabled:opacity-40 transition-colors"
                  >
                    관련 다시 판정
                  </button>
                </div>
              }
            >
              관련 성취기준
            </SectionTitle>

            {related.status === 'loading' && (
              <p className="py-3 text-center text-[12px] font-semibold text-[#9AA0A6]">관련 성취기준을 판정하는 중…</p>
            )}
            {related.status === 'error' && (
              <div className="rounded-xl bg-[#FCE8E6] px-3 py-2">
                <p className="text-[12px] font-semibold text-[#C5221F]">{related.error}</p>
                <button
                  type="button"
                  onClick={onRefetchRelated}
                  className="mt-1 text-[11px] font-bold text-[#C5221F] underline"
                >
                  다시 시도
                </button>
              </div>
            )}
            {related.status === 'ready' && related.items.length === 0 && (
              <p className="py-3 text-center text-[12px] font-semibold text-[#9AA0A6]">관련 성취기준을 찾지 못했습니다.</p>
            )}

            <ul className="space-y-1.5">
              {related.items.map(item => {
                const relColor = RELATION_COLORS[item.relationType] ?? FALLBACK_RELATION_COLOR
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onPickRelated(item.id)}
                      className="w-full rounded-xl border border-[#E8EAED] p-2.5 text-left hover:border-[#1A73E8] hover:bg-[#F8FBFF] transition-colors"
                    >
                      <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-extrabold text-white"
                          style={{ backgroundColor: relColor }}
                        >
                          {item.relationType || '관련'}
                        </span>
                        <span className="text-[11px] font-extrabold text-[#202124]">{item.code}</span>
                        <span
                          className="text-[10px] font-bold"
                          style={{ color: subjectColors[item.subjectId] ?? '#5F6368' }}
                        >
                          {item.subject}
                        </span>
                        <span className="text-[10px] font-semibold text-[#9AA0A6]">{item.band}</span>
                      </div>
                      <p className="mb-1.5 line-clamp-2 text-[11.5px] leading-snug text-[#3C4043]">{item.text}</p>
                      <div className="flex items-center gap-1.5">
                        <ScoreBar value={item.strength} color={relColor} />
                        <span className="text-[10px] font-bold tabular-nums text-[#5F6368]">
                          {formatScore(item.strength)}
                        </span>
                        <LevelBadge level={item.level} />
                        {item.source && (
                          <span className="text-[10px] font-semibold text-[#9AA0A6]">
                            {SOURCE_LABELS[item.source] ?? item.source}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ── 검색 결과 ───────────────────────────────────────────────────── */}
      <section className="border-b border-[#E8EAED] p-4">
        <SectionTitle right={<JudgeBadge judge={search.judge} elapsedMs={search.elapsedMs} />}>
          {search.submittedQuery ? `‘${search.submittedQuery}’ 검색 결과` : '검색 결과'}
        </SectionTitle>

        {search.status === 'idle' && (
          <p className="py-4 text-center text-[12px] font-semibold leading-relaxed text-[#9AA0A6]">
            수업 주제나 키워드를 입력하면
            <br />
            가장 가까운 성취기준을 찾아 줍니다.
          </p>
        )}
        {search.status === 'loading' && (
          <p className="py-4 text-center text-[12px] font-semibold text-[#9AA0A6]">성취기준을 찾는 중…</p>
        )}
        {search.status === 'error' && (
          <div className="rounded-xl bg-[#FCE8E6] px-3 py-2">
            <p className="text-[12px] font-semibold text-[#C5221F]">{search.error}</p>
          </div>
        )}
        {search.status === 'ready' && search.results.length === 0 && (
          <p className="py-4 text-center text-[12px] font-semibold text-[#9AA0A6]">
            일치하는 성취기준이 없습니다. 다른 키워드를 시도해 보세요.
          </p>
        )}

        <ul className="space-y-1.5">
          {search.results.map(r => {
            const color = subjectColors[r.subjectId] ?? '#5F6368'
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPickResult(r.id)}
                  className="w-full rounded-xl border border-[#E8EAED] p-2.5 text-left hover:border-[#1A73E8] hover:bg-[#F8FBFF] transition-colors"
                >
                  <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-extrabold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {r.subject}
                    </span>
                    <span className="text-[11px] font-extrabold text-[#202124]">{r.code}</span>
                    <span className="text-[10px] font-semibold text-[#9AA0A6]">{r.band}</span>
                    {r.area && <span className="text-[10px] font-semibold text-[#BDC1C6]">{r.area}</span>}
                  </div>
                  <p className="mb-1.5 line-clamp-2 text-[11.5px] leading-snug text-[#3C4043]">{r.text}</p>
                  <div className="flex items-center gap-1.5">
                    <ScoreBar value={r.score} color={color} />
                    <span className="text-[10px] font-bold tabular-nums text-[#5F6368]">{formatScore(r.score)}</span>
                    <LevelBadge level={r.level} />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ── 필터 ────────────────────────────────────────────────────────── */}
      <section className="p-4">
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onResetFilters}
                className="text-[11px] font-bold text-[#9AA0A6] hover:text-[#5F6368] transition-colors"
              >
                초기화
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(o => !o)}
                className="text-[11px] font-bold text-[#1A73E8]"
                aria-expanded={filtersOpen}
              >
                {filtersOpen ? '접기' : '펼치기'}
              </button>
            </div>
          }
        >
          보기 설정
        </SectionTitle>

        {filtersOpen && (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-bold text-[#9AA0A6]">교과</p>
              <div className="flex flex-wrap gap-1.5">
                {subjects.map(s => {
                  const hidden = filters.hiddenSubjectIds.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onToggleSubject(s.id)}
                      aria-pressed={!hidden}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        hidden
                          ? 'border-[#E8EAED] bg-white text-[#BDC1C6]'
                          : 'border-transparent bg-[#F1F3F4] text-[#3C4043]'
                      }`}
                    >
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: hidden ? '#DADCE0' : (subjectColors[s.id] ?? s.color) }}
                      />
                      {s.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-bold text-[#9AA0A6]">학년군</p>
              <div className="flex flex-wrap gap-1.5">
                {bands.map(b => {
                  const hidden = filters.hiddenBands.includes(b)
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => onToggleBand(b)}
                      aria-pressed={!hidden}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        hidden
                          ? 'border-[#E8EAED] bg-white text-[#BDC1C6]'
                          : 'border-transparent bg-[#E8F0FE] text-[#1A73E8]'
                      }`}
                    >
                      {b}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="edge-threshold" className="text-[11px] font-bold text-[#9AA0A6]">
                  연결선 표시 기준
                </label>
                <span className="text-[11px] font-bold tabular-nums text-[#5F6368]">
                  {filters.edgeThreshold.toFixed(2)}
                </span>
              </div>
              <input
                id="edge-threshold"
                type="range"
                min={EDGE_THRESHOLD_MIN}
                max={EDGE_THRESHOLD_MAX}
                step={0.05}
                value={filters.edgeThreshold}
                onChange={e => onEdgeThresholdChange(Number(e.target.value))}
                className="w-full accent-[#1A73E8]"
              />
              <p className="mt-0.5 text-[10px] text-[#BDC1C6]">
                값을 올리면 더 강하게 연결된 성취기준만 남습니다.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={filters.alwaysLabels}
                onChange={e => onAlwaysLabelsChange(e.target.checked)}
                className="h-4 w-4 accent-[#1A73E8]"
              />
              <span className="text-[12px] font-semibold text-[#3C4043]">라벨 항상 표시</span>
            </label>
          </div>
        )}
      </section>
    </div>
  )
}

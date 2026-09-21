'use client'

// 교육과정 분석맵 우측 패널 — 검색 결과, 선택 성취기준 상세·관련 목록, 보기 설정.
// M3: surface-container-low 시트 + surface-container-lowest 카드.

import { useState } from 'react'
import { MD3Button } from '@/components/ui/MD3Button'
import { EDGE_THRESHOLD_MAX, EDGE_THRESHOLD_MIN } from './mapMath'
import { JudgeBadge, M3Switch, SectionTitle } from './MapPanelBits'
import { RelatedCard, ResultCard } from './MapResultCards'
import type { RelatedState, SearchState } from './useCurriculumMap'
import type { MapFilters, MapNode } from './types'

export interface MapSidePanelProps {
  subjectColors: Record<string, string>
  filters: MapFilters
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

function Hint({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="py-5 text-center text-[14px] leading-[1.5] text-[var(--md-on-surface-variant)]">{children}</p>
  )
}

function Loading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="py-4">
      <div className="m3-progress mb-2.5" />
      <p className="text-center text-[14px] text-[var(--md-on-surface-variant)]">{children}</p>
    </div>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div className="rounded-xl bg-[var(--md-error-container)] px-4 py-3">
      <p className="text-[14px] leading-[1.5] text-[var(--md-on-error-container)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 text-[14px] font-medium text-[var(--md-on-error-container)] underline"
        >
          다시 시도
        </button>
      )}
    </div>
  )
}

export default function MapSidePanel({
  subjectColors,
  filters,
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
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--md-surface-container-low)]">
      {/* ── 선택 성취기준 상세 ─────────────────────────────────────────── */}
      {selectedNode && (
        <section className="border-b border-[var(--md-outline-variant)] p-5">
          <SectionTitle
            right={
              <MD3Button variant="text" size="xs" tone="neutral" onClick={onClearSelection}>
                선택 해제
              </MD3Button>
            }
          >
            선택한 성취기준
          </SectionTitle>

          <div className="rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span
                className="rounded-lg px-2 py-0.5 text-[12px] font-medium text-white"
                style={{ backgroundColor: subjectColors[selectedNode.subjectId] ?? '#747775' }}
              >
                {selectedNode.subject}
              </span>
              <span className="text-[16px] font-medium text-[var(--md-on-surface)]">{selectedNode.code}</span>
              <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{selectedNode.band}</span>
            </div>
            <p className="mb-3 text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{selectedNode.text}</p>
            <dl className="space-y-1.5">
              {selectedNode.area && (
                <div className="flex gap-2">
                  <dt className="flex-shrink-0 text-[12px] font-medium text-[var(--md-on-surface-variant)]">영역</dt>
                  <dd className="text-[14px] text-[var(--md-on-surface)]">{selectedNode.area}</dd>
                </div>
              )}
              {selectedNode.coreIdea && (
                <div className="flex gap-2">
                  <dt className="flex-shrink-0 text-[12px] font-medium text-[var(--md-on-surface-variant)]">
                    핵심 아이디어
                  </dt>
                  <dd className="text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{selectedNode.coreIdea}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* 관련 성취기준 */}
          <div className="mt-5">
            <SectionTitle
              right={
                <div className="flex items-center gap-2">
                  <JudgeBadge judge={related.judge} elapsedMs={related.elapsedMs} />
                  <MD3Button
                    variant="outlined"
                    size="xs"
                    onClick={onRefetchRelated}
                    disabled={related.status === 'loading'}
                  >
                    관련 다시 판정
                  </MD3Button>
                </div>
              }
            >
              관련 성취기준
            </SectionTitle>

            {related.status === 'loading' && <Loading>관련 성취기준을 판정하는 중…</Loading>}
            {related.status === 'error' && related.error && (
              <ErrorBox message={related.error} onRetry={onRefetchRelated} />
            )}
            {related.status === 'ready' && related.items.length === 0 && (
              <Hint>관련 성취기준을 찾지 못했습니다.</Hint>
            )}

            <ul className="space-y-2">
              {related.items.map(item => (
                <li key={item.id}>
                  <RelatedCard
                    item={item}
                    color={subjectColors[item.subjectId] ?? 'var(--md-on-surface-variant)'}
                    onClick={() => onPickRelated(item.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── 검색 결과 ───────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--md-outline-variant)] p-5">
        <SectionTitle right={<JudgeBadge judge={search.judge} elapsedMs={search.elapsedMs} />}>
          {search.submittedQuery ? `‘${search.submittedQuery}’ 검색 결과` : '검색 결과'}
        </SectionTitle>

        {search.status === 'idle' && (
          <Hint>
            수업 주제나 키워드를 입력하면
            <br />
            가장 가까운 성취기준을 찾아 줍니다.
          </Hint>
        )}
        {search.status === 'loading' && <Loading>성취기준을 찾는 중…</Loading>}
        {search.status === 'error' && search.error && <ErrorBox message={search.error} />}
        {search.status === 'ready' && search.results.length === 0 && (
          <Hint>일치하는 성취기준이 없습니다. 다른 키워드를 시도해 보세요.</Hint>
        )}

        <ul className="space-y-2">
          {search.results.map(r => (
            <li key={r.id}>
              <ResultCard
                result={r}
                color={subjectColors[r.subjectId] ?? '#747775'}
                onClick={() => onPickResult(r.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* ── 보기 설정 ───────────────────────────────────────────────────── */}
      <section className="p-5">
        <SectionTitle
          right={
            <div className="flex items-center gap-1">
              <MD3Button variant="text" size="xs" tone="neutral" onClick={onResetFilters}>
                초기화
              </MD3Button>
              <MD3Button variant="text" size="xs" onClick={() => setFiltersOpen(o => !o)}>
                {filtersOpen ? '접기' : '펼치기'}
              </MD3Button>
            </div>
          }
        >
          보기 설정
        </SectionTitle>

        {filtersOpen && (
          <div className="space-y-5">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="edge-threshold" className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">
                  연결선 표시 기준
                </label>
                <span className="rounded-lg bg-[var(--md-primary-container)] px-2 py-0.5 text-[12px] font-medium tabular-nums text-[var(--md-on-primary-container)]">
                  {filters.edgeThreshold.toFixed(2)}
                </span>
              </div>
              <input
                id="edge-threshold"
                type="range"
                className="m3-slider"
                min={EDGE_THRESHOLD_MIN}
                max={EDGE_THRESHOLD_MAX}
                step={0.05}
                value={filters.edgeThreshold}
                onChange={e => onEdgeThresholdChange(Number(e.target.value))}
              />
              <p className="mt-1 text-[12px] leading-[1.5] text-[var(--md-on-surface-variant)]">
                값을 올리면 더 강하게 연결된 성취기준만 남습니다.
              </p>
            </div>

            <M3Switch
              checked={filters.alwaysLabels}
              onChange={onAlwaysLabelsChange}
              label="라벨 항상 표시"
            />
          </div>
        )}
      </section>
    </div>
  )
}

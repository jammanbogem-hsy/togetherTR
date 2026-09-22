'use client'

// 분석맵 상단 — M3 앱 바(64dp) + 도킹 검색 바(56dp) + 맥락 칩 + 교과·학년군 필터 칩.

import { MD3Button } from '@/components/ui/MD3Button'
import { FilterChip } from './MapPanelBits'
import { formatCount } from './mapMath'
import { subjectIcon } from './subjectIcons'
import type { CurriculumMapAsset, MapFilters } from './types'

export interface MapTopBarProps {
  /** 뒤로 가기 방식: 'dashboard' 화살표 · 'close' 화살표(onBack) · 'hub' 아이콘만 */
  leading: 'dashboard' | 'close' | 'hub'
  onBack: () => void
  asset: CurriculumMapAsset | null
  query: string
  onQueryChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onClearQuery: () => void
  searching: boolean
  /** 시트에서 넘어온 맥락 — 클릭하면 핵심 아이디어로 다시 검색 */
  contextLabel?: string
  onContextClick?: () => void
  filters: MapFilters
  onToggleSubject: (id: string) => void
  onToggleBand: (band: string) => void
  panelOpen: boolean
  onTogglePanel: () => void
}

export default function MapTopBar({
  leading,
  onBack,
  asset,
  query,
  onQueryChange,
  onSubmit,
  onClearQuery,
  searching,
  contextLabel,
  onContextClick,
  filters,
  onToggleSubject,
  onToggleBand,
  panelOpen,
  onTogglePanel,
}: MapTopBarProps): React.ReactElement {
  return (
    <header className="flex-shrink-0 border-b border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
      <div className="flex h-16 items-center gap-2 px-4">
        {leading === 'hub' ? (
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center text-[var(--md-primary)]">
            <span className="material-symbols-rounded text-[28px] leading-none">hub</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={onBack}
            aria-label={leading === 'close' ? '분석맵 닫기' : '대시보드로 돌아가기'}
            className="m3-state flex h-12 w-12 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
          >
            <span className="material-symbols-rounded text-[24px] leading-none">arrow_back</span>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-normal leading-tight text-[var(--md-on-surface)]">교육과정 분석맵</h1>
          {asset && (
            <p className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">
              성취기준 {formatCount(asset.nodes.length)}개 · 연결 {formatCount(asset.edges.length)}개
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onTogglePanel}
          aria-label={panelOpen ? '분석 패널 접기' : '분석 패널 펼치기'}
          aria-expanded={panelOpen}
          className="m3-state ml-auto flex h-12 w-12 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
        >
          <span className="material-symbols-rounded text-[24px] leading-none">
            {panelOpen ? 'right_panel_close' : 'right_panel_open'}
          </span>
        </button>
      </div>

      <div className="px-4 pb-3">
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full bg-[var(--md-surface-container-high)] px-5">
            <span className="material-symbols-rounded text-[24px] leading-none text-[var(--md-on-surface-variant)]">search</span>
            <input
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder="수업 주제나 키워드로 성취기준 찾기"
              aria-label="성취기준 검색"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--md-on-surface)] placeholder:text-[var(--md-on-surface-variant)] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={onClearQuery}
                aria-label="검색어 지우기"
                className="m3-state flex h-10 w-10 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
              >
                <span className="material-symbols-rounded text-[20px] leading-none">close</span>
              </button>
            )}
          </div>
          <MD3Button type="submit" variant="filled" size="md" disabled={searching || !query.trim()}>
            찾기
          </MD3Button>
        </form>

        {/* 시트에서 넘어온 맥락 — M3 assist chip */}
        {contextLabel && (
          <div className="mt-3">
            <button
              type="button"
              onClick={onContextClick}
              className="m3-state inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--md-outline-variant)] px-3 text-[14px] font-medium text-[var(--md-on-surface)]"
              title="이 맥락으로 다시 찾기"
            >
              <span className="material-symbols-rounded text-[18px] leading-none text-[var(--md-primary)]">table_chart</span>
              {contextLabel}
            </button>
          </div>
        )}

        {asset && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {asset.subjects.map(s => (
              <FilterChip
                key={s.id}
                label={s.name}
                active={!filters.hiddenSubjectIds.includes(s.id)}
                dotColor={s.color}
                icon={subjectIcon(s.id)}
                onClick={() => onToggleSubject(s.id)}
              />
            ))}
            <span className="mx-1 h-6 w-px bg-[var(--md-outline-variant)]" aria-hidden="true" />
            {asset.bands.map(b => (
              <FilterChip
                key={b}
                label={b}
                active={!filters.hiddenBands.includes(b)}
                onClick={() => onToggleBand(b)}
              />
            ))}
          </div>
        )}
      </div>
    </header>
  )
}

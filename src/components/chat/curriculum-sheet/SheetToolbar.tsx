'use client'

// ─── 교육과정 분석 시트 — M3 툴바 (표시 전용) ───────────────────────────
// M3 segmented button: 높이 40, 바깥 radius full, 선택 세그먼트는 primary-container +
// check 아이콘. 도움말은 assist chip으로 토글하고, 본문은 supporting text 블록.

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  title?: string
}

/** M3 세그먼트 버튼 — 선택 세그먼트에 check 아이콘과 primary-container. */
export function SheetSegmented<T extends string>({
  options, value, onChange, ariaLabel, compact,
}: {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  compact?: boolean
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex h-10 overflow-hidden rounded-full border border-[var(--md-outline)]">
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.title ?? option.label}
            onClick={() => { if (!selected) onChange(option.value) }}
            className={cn(
              'm3-state inline-flex items-center gap-1.5 text-[14px] font-medium leading-[20px] transition-colors duration-150',
              compact ? 'px-3' : 'px-4',
              index > 0 && 'border-l border-[var(--md-outline)]',
              selected
                ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
                : 'bg-transparent text-[var(--md-on-surface-variant)]',
            )}
          >
            {selected && <span className="material-symbols-rounded text-[18px] leading-none" aria-hidden>check</span>}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function SheetToolbar({
  children, helpOpen, onToggleHelp, helpText,
}: {
  children: React.ReactNode
  helpOpen: boolean
  onToggleHelp: () => void
  helpText: string
}) {
  return (
    <div className="shrink-0 border-b border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]">
      <div className="flex min-h-14 flex-wrap items-center gap-2 px-4 py-2">
        {children}
        <button
          type="button"
          onClick={onToggleHelp}
          aria-pressed={helpOpen}
          aria-label="도움말 보기"
          className={cn(
            'm3-state ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[14px] font-medium leading-[20px] transition-colors duration-150',
            helpOpen
              ? 'border-transparent bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
              : 'border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] text-[var(--md-on-surface-variant)]',
          )}
        >
          <span className="material-symbols-rounded text-[18px] leading-none" aria-hidden>help</span>
          도움말
        </button>
      </div>
      {helpOpen && (
        <p className="px-4 pb-3 text-[14px] leading-[20px] text-[var(--md-on-surface-variant)]">{helpText}</p>
      )}
    </div>
  )
}

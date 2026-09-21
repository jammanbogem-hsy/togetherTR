'use client'

// ─── 교육과정 분석 시트 — M3 상단 앱 바 (표시 전용) ─────────────────────
// M3 top app bar: 높이 64, surface 배경, 스크롤 시 surface-container로 승격,
// headline은 title-large(22/28), 보조 줄은 label-medium(12/16).

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SheetAppBar({
  title, supporting, elevated, onClose, children, closeLabel = '분석 시트 닫기',
}: {
  title: string
  supporting: string
  elevated: boolean
  onClose: () => void
  closeLabel?: string
  /** 우측 액션 영역(프레즌스 아바타·저장 버튼 등). */
  children?: ReactNode
}) {
  return (
    <header
      className={cn(
        'flex h-16 shrink-0 items-center gap-3 border-b border-[var(--md-outline-variant)] px-4 transition-[background-color,box-shadow] duration-150',
        elevated
          ? 'bg-[var(--md-surface-container)] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)]'
          : 'bg-[var(--md-surface)]',
      )}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className="m3-state flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
      >
        <span className="material-symbols-rounded text-[24px] leading-none" aria-hidden>arrow_back</span>
      </button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[22px] font-normal leading-[28px] text-[var(--md-on-surface)]">{title}</h2>
        <p className="truncate text-[12px] font-medium leading-[16px] text-[var(--md-on-surface-variant)]">{supporting}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </header>
  )
}

'use client'

// ─── 교육과정 분석 시트 — M3 칩 (표시 전용) ─────────────────────────────
// M3 Chips 스펙: 높이 32, radius 8, outline-variant 1px 테두리, label-large(14/20, 500),
// trailing icon 18. 로직은 없다 — 시트 모달이 값·핸들러를 넘긴다.

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 입력 칩 — 선택된 값 하나(성취기준·내용 요소). trailing close로 제거. */
export function InputChip({
  label, color, onRemove, removeTitle,
}: {
  label: string
  color?: string
  onRemove: () => void
  removeTitle?: string
}) {
  return (
    <span
      className="inline-flex max-w-full items-start gap-1 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] py-1 pl-2.5 pr-1"
      style={color ? { color } : undefined}
    >
      <span className="min-w-0 flex-1 break-words text-[14px] font-medium leading-[20px]">{label}</span>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onRemove() }}
        aria-label={removeTitle ?? '제거'}
        title={removeTitle ?? '제거'}
        className="m3-state mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--md-on-surface-variant)] hover:text-[var(--md-error)]"
      >
        <span className="material-symbols-rounded text-[18px] leading-none" aria-hidden>close</span>
      </button>
    </span>
  )
}

/** 어시스트 칩 — 값을 추가하는 동작('＋ 성취기준'). */
export function AssistChip({
  label, icon = 'add', color, onClick, title,
}: {
  label: string
  icon?: string
  color?: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className="m3-state inline-flex h-8 items-center gap-1.5 self-start rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] px-2.5 text-[14px] font-medium leading-[20px]"
      style={color ? { color } : { color: 'var(--md-on-surface-variant)' }}
    >
      <span className="material-symbols-rounded text-[18px] leading-none" aria-hidden>{icon}</span>
      {label}
    </button>
  )
}

/** 정적 라벨 칩 — 영역(secondary) / 연결(tertiary) / 기본(surface). */
export function LabelChip({
  children, variant = 'surface', title, className,
}: {
  children: ReactNode
  variant?: 'secondary' | 'tertiary' | 'surface' | 'primary'
  title?: string
  className?: string
}) {
  const palette = {
    secondary: 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]',
    tertiary: 'bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]',
    primary: 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]',
    surface: 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]',
  }[variant]
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[12px] font-medium leading-[16px]', palette, className)}
    >
      {children}
    </span>
  )
}

'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ─── Material Design 3 버튼 ──────────────────────────────
// M3 스펙 요약:
//  - 높이 xs 32 / sm 40 / md 56, shape = full(pill)
//  - 라벨 label-large(14sp, weight 500), 아이콘-라벨 간격 8dp
//  - 상태 레이어: hover 8% / focus 10% / pressed 10% (라벨 색 기준)
//  - variant: filled(최상위 강조) · tonal(중간) · outlined(낮음) · text(최소)
// 브랜드 색은 Google 팔레트를 M3 토큰(main/onMain/container/onContainer/outline)으로 매핑.

export type MD3Tone = 'blue' | 'amber' | 'purple' | 'teal' | 'red' | 'neutral' | 'green'
export type MD3Variant = 'filled' | 'tonal' | 'outlined' | 'text'
export type MD3Size = 'xs' | 'sm' | 'md'

type ToneToken = {
  main: string
  onMain: string
  container: string
  onContainer: string
  outline: string
}

export const MD3_TONES: Record<MD3Tone, ToneToken> = {
  blue:    { main: '#0B57D0', onMain: '#FFFFFF', container: '#D3E3FD', onContainer: '#0842A0', outline: '#A8C7FA' },
  amber:   { main: '#E65100', onMain: '#FFFFFF', container: '#FFE7C7', onContainer: '#8A3D00', outline: '#F2B77A' },
  purple:  { main: '#7B1FA2', onMain: '#FFFFFF', container: '#F1DEF7', onContainer: '#5E1478', outline: '#D8A9E5' },
  teal:    { main: '#00897B', onMain: '#FFFFFF', container: '#CDE9E5', onContainer: '#00564C', outline: '#7CC7BF' },
  red:     { main: '#C5221F', onMain: '#FFFFFF', container: '#FADCD9', onContainer: '#8C1D18', outline: '#F0AFAB' },
  green:   { main: '#188038', onMain: '#FFFFFF', container: '#D7EBDD', onContainer: '#0D652D', outline: '#8FCBA1' },
  neutral: { main: '#3C4043', onMain: '#FFFFFF', container: '#E8EAED', onContainer: '#3C4043', outline: '#C4C7C5' },
}

// 높이·타이포·패딩 — M3 size 스케일
const SIZE_STYLE: Record<MD3Size, { box: string; pad: string; padIconOnly: string; text: string; gap: string }> = {
  xs: { box: 'h-8',  pad: 'px-3',   padIconOnly: 'w-8 px-0',  text: 'text-[12px]', gap: 'gap-1.5' },
  sm: { box: 'h-10', pad: 'px-4',   padIconOnly: 'w-10 px-0', text: 'text-[13px]', gap: 'gap-2' },
  md: { box: 'h-14', pad: 'px-6',   padIconOnly: 'w-14 px-0', text: 'text-[15px]', gap: 'gap-2' },
}

// 아이콘 권장 크기 — 호출부에서 <Star size={MD3_ICON.sm} /> 형태로 사용
export const MD3_ICON: Record<MD3Size, number> = { xs: 16, sm: 18, md: 22 }

export interface MD3ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: MD3Variant
  size?: MD3Size
  tone?: MD3Tone
  icon?: ReactNode
  trailing?: ReactNode
  /** 토글 버튼: true면 filled로 승격되어 활성 상태를 표현 */
  selected?: boolean
  fullWidth?: boolean
}

export const MD3Button = forwardRef<HTMLButtonElement, MD3ButtonProps>(function MD3Button(
  {
    variant = 'tonal',
    size = 'sm',
    tone = 'blue',
    icon,
    trailing,
    selected = false,
    fullWidth = false,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const t = MD3_TONES[tone]
  const s = SIZE_STYLE[size]
  const effective: MD3Variant = selected ? 'filled' : variant
  const iconOnly = !children

  // 상태 레이어는 bg-current(=라벨 색)를 사용하므로 variant별 색 지정만 하면 자동으로 맞음
  const surface =
    effective === 'filled'
      ? 'bg-[var(--md3-main)] text-[var(--md3-on-main)] shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)]'
      : effective === 'tonal'
        ? 'bg-[var(--md3-container)] text-[var(--md3-on-container)]'
        : effective === 'outlined'
          ? 'bg-transparent text-[var(--md3-on-container)] border border-[var(--md3-outline)]'
          : 'bg-transparent text-[var(--md3-on-container)]'

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'group relative isolate inline-flex items-center justify-center overflow-hidden rounded-full',
        'font-medium leading-none whitespace-nowrap select-none',
        'transition-[box-shadow,background-color,color] duration-200',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--md3-outline)] focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-40',
        s.box, s.text, s.gap,
        iconOnly ? s.padIconOnly : s.pad,
        fullWidth && 'w-full',
        surface,
        className,
      )}
      style={{
        '--md3-main': t.main,
        '--md3-on-main': t.onMain,
        '--md3-container': t.container,
        '--md3-on-container': t.onContainer,
        '--md3-outline': t.outline,
        ...rest.style,
      } as React.CSSProperties}
      {...rest}
    >
      {/* M3 상태 레이어 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-current opacity-0 transition-opacity duration-150
          group-hover:opacity-[0.08] group-focus-visible:opacity-[0.10] group-active:opacity-[0.12]"
      />
      {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
      {children}
      {trailing && <span className="flex shrink-0 items-center justify-center">{trailing}</span>}
    </button>
  )
})

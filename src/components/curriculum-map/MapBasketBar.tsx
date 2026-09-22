'use client'

// 담은 성취기준 하단 바 — M3 bottom app bar 느낌. 담긴 것이 있을 때만 보인다.

import { MD3Button } from '@/components/ui/MD3Button'
import type { MapPick } from './types'

export interface MapBasketBarProps {
  picks: MapPick[]
  /** embedded 는 "시트에 반영", page 는 "시트로 보내기" */
  mode: 'page' | 'embedded'
  busy?: boolean
  onRemove: (id: string) => void
  onClear: () => void
  onPrimary: () => void
}

export default function MapBasketBar({
  picks,
  mode,
  busy = false,
  onRemove,
  onClear,
  onPrimary,
}: MapBasketBarProps): React.ReactElement | null {
  if (picks.length === 0) return null
  return (
    <div
      className="flex min-h-16 flex-shrink-0 flex-wrap items-center gap-3 border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)] px-4 py-2"
      role="region"
      aria-label="담은 성취기준"
    >
      <span className="text-[14px] font-medium text-[var(--md-on-surface)]">담은 성취기준 {picks.length}개</span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {picks.map(p => (
          <span
            key={p.id}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface)] pl-2.5 pr-1 text-[13px] font-medium text-[var(--md-on-surface)]"
          >
            {p.code}
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              aria-label={`${p.code} 빼기`}
              className="m3-state flex h-6 w-6 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
            >
              <span className="material-symbols-rounded text-[16px] leading-none">close</span>
            </button>
          </span>
        ))}
      </div>

      <MD3Button variant="text" size="sm" tone="neutral" onClick={onClear} disabled={busy}>
        비우기
      </MD3Button>
      <MD3Button
        variant="filled"
        size="sm"
        onClick={onPrimary}
        disabled={busy}
        icon={<span className="material-symbols-rounded text-[18px] leading-none">{mode === 'embedded' ? 'check' : 'send'}</span>}
      >
        {mode === 'embedded' ? '시트에 반영' : '시트로 보내기'}
      </MD3Button>
    </div>
  )
}

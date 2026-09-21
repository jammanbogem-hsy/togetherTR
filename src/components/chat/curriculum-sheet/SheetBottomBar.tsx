'use client'

// ─── 교육과정 분석 시트 — M3 하단 앱 바 (표시 전용) ─────────────────────
// M3 bottom app bar: 높이 80, surface-container, 상단 outline-variant 경계선.
// 좌측은 주요 동작(tonal 버튼), 우측은 상태·FAB.

import type { ReactNode } from 'react'

export function SheetBottomBar({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-4">
      <div className="flex min-w-0 items-center gap-2">{start}</div>
      <div className="flex min-w-0 items-center gap-3">{end}</div>
    </div>
  )
}

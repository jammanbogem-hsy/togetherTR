'use client'

// 분석맵 패널의 M3 표시 요소들 — 판정기 배지, 점수 바, 관련도 칩, 섹션 제목,
// 필터 칩, 스위치. 타입 스케일은 label-medium 12/500, label-large 14/500,
// body-medium 14, title-medium 16/500 만 사용한다 (11px 이하 금지).

import { formatElapsed } from './mapMath'
import type { MapJudge } from './types'

/** /related 의 source 값(영문 식별자)을 화면용 한국어 라벨로. */
export const SOURCE_LABELS: Record<string, string> = {
  cross: '교과 간 링크',
  mixed: '링크+유사도',
  similar: '유사 이웃',
  embedding: '임베딩',
}

/** 관련도 4단계 → M3 컨테이너 색. */
const LEVEL_STYLE: Record<string, string> = {
  핵심: 'bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]',
  관련: 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]',
  약함: 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]',
  무관: 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]',
}

export function JudgeBadge({ judge, elapsedMs }: { judge: MapJudge | null; elapsedMs: number }): React.ReactElement | null {
  if (!judge) return null
  const isJev = judge === 'jev'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded-lg px-2 py-0.5 text-[12px] font-medium ${
          isJev
            ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
            : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
        }`}
      >
        {isJev ? 'Jev 판정' : '임베딩'}
      </span>
      <span className="text-[12px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
        {formatElapsed(elapsedMs)}
      </span>
    </span>
  )
}

export function ScoreBar({ value, color }: { value: number; color?: string }): React.ReactElement {
  return (
    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--md-surface-container-highest)]">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{
          width: `${Math.max(3, Math.min(100, value * 100))}%`,
          backgroundColor: color ?? 'var(--md-primary)',
        }}
      />
    </div>
  )
}

export function LevelChip({ level }: { level: string }): React.ReactElement | null {
  if (!level) return null
  return (
    <span
      className={`flex-shrink-0 rounded-lg px-2 py-0.5 text-[12px] font-medium ${
        LEVEL_STYLE[level] ?? 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
      }`}
    >
      {level}
    </span>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-[16px] font-medium text-[var(--md-on-surface)]">{children}</h3>
      {right}
    </div>
  )
}

/** M3 필터 칩 — 활성 시 check 아이콘 + secondary-container. */
export function FilterChip({
  label,
  active,
  dotColor,
  icon,
  onClick,
}: {
  label: string
  active: boolean
  dotColor?: string
  /** Material Symbols 이름 — 교과 칩에 쓴다 */
  icon?: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`m3-state flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[14px] font-medium transition-colors ${
        active
          ? 'border-transparent bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
          : 'border-[var(--md-outline-variant)] bg-transparent text-[var(--md-on-surface-variant)]'
      }`}
    >
      {icon ? (
        <span
          className="material-symbols-rounded text-[18px] leading-none"
          style={{ color: active ? dotColor : 'var(--md-outline)' }}
        >
          {icon}
        </span>
      ) : active ? (
        <span className="material-symbols-rounded text-[18px] leading-none">check</span>
      ) : dotColor ? (
        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
      ) : null}
      {label}
    </button>
  )
}

/** M3 스위치 — 시각 스타일은 globals.css 의 .m3-switch 가 담당. */
export function M3Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14px] text-[var(--md-on-surface)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="m3-switch"
      />
    </div>
  )
}

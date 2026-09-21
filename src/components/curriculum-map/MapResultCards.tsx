'use client'

// 분석맵 패널의 카드 — 검색 결과 카드와 관련 성취기준 카드.
// M3: surface-container-lowest, 12px radius, outline-variant 외곽선.

import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import { formatScore } from './mapMath'
import { LevelChip, ScoreBar, SOURCE_LABELS } from './MapPanelBits'
import type { MapRelatedItem, MapSearchResult } from './types'

const FALLBACK_RELATION_COLOR = '#94A3B8'

const CARD_CLASS =
  'm3-state w-full rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4 text-left transition-colors hover:border-[var(--md-primary)]'

function SubjectChip({ name, color }: { name: string; color: string }): React.ReactElement {
  return (
    <span className="rounded-lg px-2 py-0.5 text-[12px] font-medium text-white" style={{ backgroundColor: color }}>
      {name}
    </span>
  )
}

export function ResultCard({
  result,
  color,
  onClick,
}: {
  result: MapSearchResult
  color: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button type="button" onClick={onClick} className={CARD_CLASS}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SubjectChip name={result.subject} color={color} />
        <span className="text-[14px] font-medium text-[var(--md-on-surface)]">{result.code}</span>
        <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{result.band}</span>
        {result.area && (
          <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{result.area}</span>
        )}
      </div>
      <p className="mb-2.5 line-clamp-2 text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{result.text}</p>
      <div className="flex items-center gap-2">
        <ScoreBar value={result.score} />
        <span className="text-[12px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
          {formatScore(result.score)}
        </span>
        <LevelChip level={result.level} />
      </div>
    </button>
  )
}

export function RelatedCard({
  item,
  color,
  onClick,
}: {
  item: MapRelatedItem
  color: string
  onClick: () => void
}): React.ReactElement {
  const relColor = RELATION_COLORS[item.relationType] ?? FALLBACK_RELATION_COLOR
  return (
    <button type="button" onClick={onClick} className={CARD_CLASS}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="rounded-lg px-2 py-0.5 text-[12px] font-medium text-white"
          style={{ backgroundColor: relColor }}
        >
          {item.relationType || '관련'}
        </span>
        <span className="text-[14px] font-medium text-[var(--md-on-surface)]">{item.code}</span>
        <span className="text-[12px] font-medium" style={{ color }}>
          {item.subject}
        </span>
        <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{item.band}</span>
      </div>
      <p className="mb-2.5 line-clamp-2 text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{item.text}</p>
      <div className="flex items-center gap-2">
        <ScoreBar value={item.strength} color={relColor} />
        <span className="text-[12px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
          {formatScore(item.strength)}
        </span>
        <LevelChip level={item.level} />
        {item.source && (
          <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">
            {SOURCE_LABELS[item.source] ?? item.source}
          </span>
        )}
      </div>
    </button>
  )
}

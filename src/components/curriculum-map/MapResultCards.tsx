'use client'

// 분석맵 패널의 카드 — 검색 결과 카드와 관련 성취기준 카드.
// M3: surface-container-lowest, 12px radius, outline-variant 외곽선, 16px 패딩.
// 근거 필드(reason / sharedKeywords / sameCoreIdea …)는 백엔드가 주면 그때 표시한다.

import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import { formatScore } from './mapMath'
import { LevelChip, ScoreBar, SOURCE_LABELS } from './MapPanelBits'
import { subjectIcon } from './subjectIcons'
import type { MapRelatedItem, MapSearchResult } from './types'

const FALLBACK_RELATION_COLOR = '#94A3B8'

const CARD_CLASS =
  'm3-state w-full rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4 text-left transition-colors hover:border-[var(--md-primary)]'

function SubjectChip({ name, color, subjectId }: { name: string; color: string; subjectId: string }): React.ReactElement {
  const icon = subjectIcon(subjectId)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[13px] font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {icon && <span className="material-symbols-rounded text-[18px] leading-none">{icon}</span>}
      {name}
    </span>
  )
}

/** 공유 키워드·맞은 표현 칩 */
function TermChips({ terms }: { terms: readonly string[] }): React.ReactElement | null {
  if (terms.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {terms.slice(0, 8).map(term => (
        <span
          key={term}
          className="rounded-lg bg-[var(--md-surface-container-high)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-surface-variant)]"
        >
          {term}
        </span>
      ))}
    </div>
  )
}

function Reason({ text }: { text?: string }): React.ReactElement | null {
  if (!text) return null
  return <p className="mt-2 text-[14px] leading-[1.5] text-[var(--md-on-surface-variant)]">{text}</p>
}

export function ResultCard({
  result,
  color,
  onClick,
  onHover,
}: {
  result: MapSearchResult
  color: string
  onClick: () => void
  onHover: (id: string | null) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(result.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(result.id)}
      onBlur={() => onHover(null)}
      className={CARD_CLASS}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SubjectChip name={result.subject} color={color} subjectId={result.subjectId} />
        <span className="text-[15px] font-semibold text-[var(--md-on-surface)]">{result.code}</span>
        <span className="text-[13px] font-medium text-[var(--md-on-surface-variant)]">{result.band}</span>
        {result.area && (
          <span className="text-[13px] font-medium text-[var(--md-on-surface-variant)]">{result.area}</span>
        )}
      </div>
      <p className="line-clamp-2 text-[15px] leading-[1.5] text-[var(--md-on-surface)]">{result.text}</p>
      <Reason text={result.reason} />
      <TermChips terms={result.matchedTerms ?? []} />
      <div className="mt-2.5 flex items-center gap-2">
        <ScoreBar value={result.score} />
        <span className="text-[13px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
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
  onHover,
}: {
  item: MapRelatedItem
  color: string
  onClick: () => void
  onHover: (id: string | null) => void
}): React.ReactElement {
  const relColor = RELATION_COLORS[item.relationType] ?? FALLBACK_RELATION_COLOR
  const hasScores = typeof item.jevScore === 'number' || typeof item.sim === 'number'
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(item.id)}
      onBlur={() => onHover(null)}
      className={CARD_CLASS}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-lg px-2 py-0.5 text-[13px] font-medium text-white" style={{ backgroundColor: relColor }}>
          {item.relationType || '관련'}
        </span>
        <span className="text-[15px] font-semibold text-[var(--md-on-surface)]">{item.code}</span>
        <span className="inline-flex items-center gap-1 text-[13px] font-medium" style={{ color }}>
          {subjectIcon(item.subjectId) && (
            <span className="material-symbols-rounded text-[18px] leading-none">
              {subjectIcon(item.subjectId)}
            </span>
          )}
          {item.subject}
        </span>
        <span className="text-[13px] font-medium text-[var(--md-on-surface-variant)]">{item.band}</span>
      </div>
      <p className="line-clamp-2 text-[15px] leading-[1.5] text-[var(--md-on-surface)]">{item.text}</p>

      <Reason text={item.reason} />
      <TermChips terms={item.sharedKeywords ?? []} />

      {/* 구조적 근거 — 같은 핵심아이디어 / 같은 영역 / 문서상 연결 */}
      {(item.sameCoreIdea || item.sameArea || item.linkEvidence) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.sameCoreIdea && (
            <span className="rounded-lg bg-[var(--md-tertiary-container)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-tertiary-container)]">
              같은 핵심아이디어{item.coreIdeaArea ? ` · ${item.coreIdeaArea}` : ''}
            </span>
          )}
          {item.sameArea && (
            <span className="rounded-lg bg-[var(--md-secondary-container)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-secondary-container)]">
              같은 영역
            </span>
          )}
          {item.linkEvidence && (
            <span className="rounded-lg bg-[var(--md-surface-container-high)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-surface-variant)]">
              {item.linkEvidence}
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <ScoreBar value={item.strength} color={relColor} />
        <span className="text-[13px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
          {formatScore(item.strength)}
        </span>
        <LevelChip level={item.level} />
        {item.source && (
          <span className="text-[13px] font-medium text-[var(--md-on-surface-variant)]">
            {SOURCE_LABELS[item.source] ?? item.source}
          </span>
        )}
      </div>

      {hasScores && (
        <p className="mt-1.5 text-[13px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
          {typeof item.jevScore === 'number' && `Jev 판정 ${item.jevScore.toFixed(2)} · `}
          유사도 {item.sim.toFixed(2)}
        </p>
      )}
    </button>
  )
}

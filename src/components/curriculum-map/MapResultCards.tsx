'use client'

// 분석맵 패널의 카드 — 검색 결과 카드와 관련 성취기준 카드.
// M3: surface-container-lowest, 12px radius, outline-variant 외곽선, 16px 패딩.
// 근거 필드(reason / sharedKeywords / sameCoreIdea …)는 백엔드가 주면 그때 표시한다.

import { RELATION_COLORS } from '@/components/knowledge-graph/constants'
import { formatScore } from './mapMath'
import { LevelChip, ScoreBar, SOURCE_LABELS } from './MapPanelBits'
import { LevelCompareBox } from './MapLevelBits'
import { subjectIcon } from './subjectIcons'
import type { MapNodeLevels, MapRelatedItem, MapSearchResult } from './types'

const FALLBACK_RELATION_COLOR = '#94A3B8'

const CARD_CLASS =
  'm3-state w-full rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4 text-left transition-colors hover:border-[var(--md-primary)]'

/** 담기 토글 — M3 tonal, 담기면 check 아이콘과 "담김". 카드 클릭과 분리한다. */
export function PickButton({ picked, onToggle }: { picked: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={picked}
      className={`m3-state flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium ${
        picked
          ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
          : 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
      }`}
    >
      <span className="material-symbols-rounded text-[18px] leading-none">{picked ? 'check' : 'add_task'}</span>
      {picked ? '담김' : '담기'}
    </button>
  )
}

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
  picked,
  onClick,
  onHover,
  onTogglePick,
}: {
  result: MapSearchResult
  color: string
  picked: boolean
  onClick: () => void
  onHover: (id: string | null) => void
  onTogglePick?: () => void
}): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      onMouseEnter={() => onHover(result.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(result.id)}
      onBlur={() => onHover(null)}
      className={`${CARD_CLASS} cursor-pointer`}
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
        <span className="ml-auto">
          {onTogglePick && <PickButton picked={picked} onToggle={onTogglePick} />}
        </span>
      </div>
    </div>
  )
}

export function RelatedCard({
  item,
  color,
  picked,
  onClick,
  onHover,
  onTogglePick,
  centerCode = '',
  centerLevels,
  itemLevels,
}: {
  item: MapRelatedItem
  color: string
  picked: boolean
  onClick: () => void
  onHover: (id: string | null) => void
  onTogglePick?: () => void
  /** 성취수준 비교를 펼칠 때 쓰는 선택 성취기준 코드·성취수준 */
  centerCode?: string
  centerLevels?: MapNodeLevels
  itemLevels?: MapNodeLevels
}): React.ReactElement {
  const relColor = RELATION_COLORS[item.relationType] ?? FALLBACK_RELATION_COLOR
  const hasScores = typeof item.jevScore === 'number' || typeof item.sim === 'number'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(item.id)}
      onBlur={() => onHover(null)}
      className={`${CARD_CLASS} cursor-pointer`}
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

      <LevelCompareBox
        centerCode={centerCode}
        centerLevels={centerLevels}
        itemCode={item.code}
        itemLevels={itemLevels}
      />

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

      <div className="mt-2 flex items-center justify-between gap-2">
        {hasScores ? (
          <p className="text-[13px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
            {typeof item.jevScore === 'number' && `AI 판정 ${item.jevScore.toFixed(2)} · `}
            유사도 {item.sim.toFixed(2)}
          </p>
        ) : (
          <span />
        )}
        {onTogglePick && <PickButton picked={picked} onToggle={onTogglePick} />}
      </div>
    </div>
  )
}

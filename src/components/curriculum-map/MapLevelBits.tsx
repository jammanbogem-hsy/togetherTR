'use client'

// 교육과정 분석맵 — 성취수준(A·B·C) 표시 조각.
// 원문은 교육부·한국교육과정평가원 「2022 개정 교육과정에 따른 성취수준」 그대로다.
// 화면에서 새로 요약·의역하지 않는다(교사가 공식 원문으로 읽어야 한다).

import { useState } from 'react'
import type { MapNodeLevels } from './types'

const LEVEL_KEYS = ['A', 'B', 'C'] as const

function LevelRow({ level, text, emphasized }: { level: string; text: string; emphasized?: boolean }): React.ReactElement {
  return (
    <div className="flex gap-2">
      <span
        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${
          emphasized
            ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
            : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
        }`}
      >
        {level}
      </span>
      <p className="text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{text}</p>
    </div>
  )
}

/** 선택한 성취기준의 A·B·C 원문. 수준 데이터가 없는 성취기준(창체)은 안내만 한다. */
export function AchievementLevelList({ levels }: { levels?: MapNodeLevels }): React.ReactElement {
  if (!levels) {
    return (
      <p className="text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
        이 항목은 공식 성취수준 문서의 대상이 아닙니다.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {LEVEL_KEYS.map(key => (
        <LevelRow key={key} level={key} text={levels[key]} />
      ))}
      {levels.inferred && (
        <p className="text-[12px] leading-[1.5] text-[var(--md-on-surface-variant)]">
          원문 표에 A·B·C 표시가 없어 서술 순서대로 배정했습니다.
        </p>
      )}
    </div>
  )
}

/**
 * 관련 카드의 성취수준 비교 — 선택한 성취기준과 이 성취기준의 A·B·C 원문을 수준별로
 * 나란히 펼친다. 어느 수준에서 엮을지는 교사가 원문을 보고 정한다(AI 라벨을 붙이지 않는다:
 * 수준별 판정은 변별력이 없었다 — src/lib/curriculum/curriculumMap.ts 기록 참고).
 */
export function LevelCompareBox({
  centerCode,
  centerLevels,
  itemCode,
  itemLevels,
}: {
  centerCode: string
  centerLevels?: MapNodeLevels
  itemCode: string
  itemLevels?: MapNodeLevels
}): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  if (!centerLevels || !itemLevels) return null
  return (
    <div className="mt-2 rounded-lg bg-[var(--md-surface-container)] px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={e => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[13px] font-medium text-[var(--md-on-surface)]">성취수준 비교 (A·B·C 원문)</span>
        <span className="material-symbols-rounded text-[18px] leading-none text-[var(--md-on-surface-variant)]">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-3 border-t border-[var(--md-outline-variant)] pt-2" onClick={e => e.stopPropagation()}>
          {LEVEL_KEYS.map(key => (
            <div key={key} className="space-y-1">
              <LevelRow level={key} text={`${centerCode} ${centerLevels[key]}`} emphasized />
              <LevelRow level={key} text={`${itemCode} ${itemLevels[key]}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

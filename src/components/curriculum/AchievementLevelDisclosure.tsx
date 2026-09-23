'use client'

/**
 * 성취기준 칸 아래 "성취수준 A·B·C" 펼쳐 보기. 칸 글에서 성취기준 코드를 찾아 코드별로 공식 원문을 보여 준다.
 * A-2-1 산출물 표와 교육과정 시트에서 성취기준을 고를 때 수준까지 보고 판단하게 한다.
 */

import { useState } from 'react'
import { extractStandardCodes } from '@/lib/curriculum/standardCodes'
import { useAchievementLevels, type ClientAchievementLevel } from '@/lib/curriculum/useAchievementLevels'

const LEVEL_TONE: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-[#E6F4EA] text-[#137333]',
  B: 'bg-[#E8F0FE] text-[#1557B0]',
  C: 'bg-[#FEF7E0] text-[#B06000]',
}

export function LevelBadge({ level }: { level: 'A' | 'B' | 'C' }) {
  return (
    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold ${LEVEL_TONE[level]}`}>
      {level}
    </span>
  )
}

export function AchievementLevelList({ entry }: { entry: ClientAchievementLevel }) {
  return (
    <ul className="space-y-1.5">
      {(['A', 'B', 'C'] as const).map(level => (
        <li key={level} className="flex items-start gap-2 text-[12px] leading-relaxed text-[#3C4043]">
          <LevelBadge level={level} />
          <span>{entry[level]}</span>
        </li>
      ))}
      {entry.inferred && (
        <li className="text-[11px] text-[#80868B]">원문에 A·B·C 표시가 없어 서술 순서로 배정했습니다.</li>
      )}
    </ul>
  )
}

export function AchievementLevelDisclosure({ standard }: { standard?: string }) {
  const codes = extractStandardCodes(standard ?? '')
  const [open, setOpen] = useState(false)
  const { levels, error } = useAchievementLevels(open)
  if (codes.length === 0) return null

  return (
    <div className="mt-1.5 [word-break:keep-all]">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-[#DADCE0] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#5F6368] hover:bg-[#F1F3F4]"
      >
        성취수준 A·B·C {open ? '접기' : '보기'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 rounded-lg border border-[#E8EAED] bg-[#F8F9FA] px-2.5 py-2">
          {error && <p className="text-[11px] text-[#C5221F]">{error}</p>}
          {!error && !levels && <p className="text-[11px] text-[#80868B]">불러오는 중…</p>}
          {levels && codes.map(code => {
            const entry = levels[code]
            return (
              <div key={code}>
                {codes.length > 1 && <p className="mb-1 text-[11px] font-bold text-[#1A73E8]">{code}</p>}
                {entry
                  ? <AchievementLevelList entry={entry} />
                  : <p className="text-[11px] text-[#80868B]">{code}의 공식 성취수준 자료가 없습니다.</p>}
              </div>
            )
          })}
          {levels && <p className="text-[10px] text-[#9AA0A6]">출처: 교육부·한국교육과정평가원, 2022 개정 교육과정에 따른 성취수준</p>}
        </div>
      )}
    </div>
  )
}

'use client'

// 분석맵 패널의 작은 표시 요소들 — 판정기 배지, 점수 바, 등급 배지, 섹션 제목.

import { formatElapsed } from './mapMath'
import type { MapJudge } from './types'

/** /related 의 source 값(영문 식별자)을 화면용 한국어 라벨로. */
export const SOURCE_LABELS: Record<string, string> = {
  cross: '교과 간 링크',
  mixed: '링크+유사도',
  similar: '유사 이웃',
  embedding: '임베딩',
}

export function JudgeBadge({ judge, elapsedMs }: { judge: MapJudge | null; elapsedMs: number }): React.ReactElement | null {
  if (!judge) return null
  const isJev = judge === 'jev'
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
          isJev ? 'bg-[#EDE7F6] text-[#5E35B1]' : 'bg-[#E3F2FD] text-[#1565C0]'
        }`}
      >
        {isJev ? 'Jev 판정' : '임베딩'}
      </span>
      <span className="text-[10px] font-semibold text-[#9AA0A6] tabular-nums">{formatElapsed(elapsedMs)}</span>
    </span>
  )
}

export function ScoreBar({ value, color }: { value: number; color: string }): React.ReactElement {
  return (
    <div className="h-1.5 flex-1 rounded-full bg-[#F1F3F4] overflow-hidden">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${Math.max(3, Math.min(100, value * 100))}%`, backgroundColor: color }}
      />
    </div>
  )
}

export function LevelBadge({ level }: { level: string }): React.ReactElement | null {
  if (!level) return null
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-[#F1F3F4] text-[#5F6368] flex-shrink-0">
      {level}
    </span>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 className="text-[12px] font-extrabold text-[#5F6368] tracking-tight">{children}</h3>
      {right}
    </div>
  )
}

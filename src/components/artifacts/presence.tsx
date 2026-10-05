'use client'

// 공동 편집 참여자 표시 — 13개 공동 편집 창이 같이 쓴다(#R2).
// 프로필 색은 파스텔이라 흰 글자·연한 배경에서 이름이 안 보였다. 같은 사람은 같은 색을 유지하되,
// 표시에 쓰는 색은 대비 4.5:1 이상이 되도록 진하게 바꾼 '잉크' 색을 쓴다.
// 참여 상태는 시계로 다시 계산해, 창을 닫지 않고 떠난 사람도 시간이 지나면 '잠시 비움' → 사라짐으로 바뀐다.

import { useEffect, useState, type CSSProperties } from 'react'

const FALLBACK = '#1A73E8'
export const PRESENCE_MIN_CONTRAST = 4.5
/** 신호가 끊긴 뒤 '잠시 비움'으로 보여 주는 시간(이후 숨김) */
export const PRESENCE_AWAY_MS = 3 * 60 * 1000

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a), cb = parseHex(b)
  if (!ca || !cb) return 1
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 같은 색상(hue)을 유지하며 배경(bg)과 대비가 min 이상이 될 때까지 어둡게 */
function darkenUntil(color: string, bg: string, min = PRESENCE_MIN_CONTRAST): string {
  let rgb = parseHex(color) ?? parseHex(FALLBACK)!
  for (let i = 0; i < 40 && contrastRatio(toHex(rgb), bg) < min; i++) rgb = rgb.map(v => v * 0.9) as [number, number, number]
  return toHex(rgb)
}

/** 흰 글자·흰 배경 위에서 읽히는 진한 사용자 색(대비 4.5:1 이상) */
export function presenceInk(color?: string): string {
  return darkenUntil(color || FALLBACK, '#FFFFFF')
}

/** 이름 칩 배경 — 사용자 색을 흰색에 섞은 연한 색 */
export function presenceTint(color?: string): string {
  const ink = parseHex(presenceInk(color))!
  return toHex(ink.map(v => v + (255 - v) * 0.88) as [number, number, number])
}

/** 칸 위 이름표: 진한 사용자 색 배경 + 흰 글자 */
export function presenceTagStyle(color?: string): CSSProperties {
  return { backgroundColor: presenceInk(color), color: '#FFFFFF' }
}

/** 머리글 참여자 칩: 연한 배경 + 진한 글자 + 같은 색 테두리 */
export function presenceChipStyle(color?: string): CSSProperties {
  const tint = presenceTint(color)
  return { backgroundColor: tint, color: darkenUntil(presenceInk(color), tint), borderColor: presenceInk(color) }
}

/** 편집 중인 칸 테두리 */
export function presenceAccentStyle(color?: string): CSSProperties {
  const ink = presenceInk(color)
  return { borderColor: ink, boxShadow: `0 0 0 2px ${ink}40` }
}

export interface PresenceLike {
  uid: string
  displayName?: string
  color?: string
  cellKey?: string
  updatedAt?: number
}

/** 참여 상태 나누기 — fresh: 최근 freshMs 안 신호, away: 그 뒤 PRESENCE_AWAY_MS 안(잠시 비움), 그 밖은 숨김 */
export function splitPresence<T extends PresenceLike>(entries: readonly (T | null | undefined)[], now: number, freshMs: number, awayMs = PRESENCE_AWAY_MS): { fresh: T[]; away: T[] } {
  const fresh: T[] = [], away: T[] = []
  for (const entry of entries) {
    if (!entry) continue
    const age = now - (entry.updatedAt ?? 0)
    if (age < freshMs) fresh.push(entry)
    else if (age < freshMs + awayMs) away.push(entry)
  }
  return { fresh, away }
}

/** 참여 상태를 다시 계산하는 시계 — 신호가 끊긴 사람이 화면에 남지 않게 */
export function usePresenceClock(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function presenceTitle(entry: PresenceLike, away = false): string {
  const name = entry.displayName || '팀원'
  if (away) return `${name} — 잠시 비움`
  return entry.cellKey && entry.cellKey !== 'modal:idle' ? `${name} — 편집 중` : `${name} — 보는 중`
}

/** 머리글의 '잠시 비움' 칩들(흐리게) */
export function PresenceAwayChips({ entries }: { entries: readonly PresenceLike[] }) {
  if (!entries.length) return null
  return (
    <>
      {entries.slice(0, 3).map(entry => (
        <span
          key={entry.uid}
          title={presenceTitle(entry, true)}
          className="rounded-full border border-dashed px-2.5 py-1 text-[13px] font-bold opacity-70"
          style={presenceChipStyle(entry.color)}
          data-presence-state="away"
        >
          {entry.displayName || '팀원'} · 잠시 비움
        </span>
      ))}
    </>
  )
}

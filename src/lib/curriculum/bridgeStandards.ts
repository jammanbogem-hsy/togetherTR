/**
 * Helpers for the "bridge standard" search (pure, dependency-free).
 *
 * A mixed-grade team picks one core idea for the whole lesson, but a subject
 * does not always have achievement standards in every band (사회 has none in
 * 1-2학년군, 실과 only in 5-6학년군). The 1st/2nd-grade teacher then needs the
 * best-matching standard of *another* subject in their own band, so the lesson
 * still shares the same core idea. These helpers shape that candidate list;
 * the ranking itself is done by the Jev judge (or the embedding fallback).
 */

/** Jev Score(0~3) 눈금의 관련도 등급. jevJudge 의 RELEVANCE_LEVELS 와 같은 순서. */
export const BRIDGE_LEVELS = ['무관', '약함', '관련', '핵심'] as const
export type BridgeLevel = (typeof BRIDGE_LEVELS)[number]

/**
 * Map a normalized 0..1 relevance score onto the 0-3 Score scale's label, so a
 * Jev score of 2.4 and an embedding score of 0.8 read the same way in the UI.
 */
export function bridgeLevelFor(score: number): BridgeLevel {
  const normalized = Number.isFinite(score) ? Math.min(Math.max(score, 0), 1) : 0
  const index = Math.round(normalized * (BRIDGE_LEVELS.length - 1))
  return BRIDGE_LEVELS[Math.min(Math.max(index, 0), BRIDGE_LEVELS.length - 1)]
}

/** '[2슬01-04]' · ' 2슬01-04 ' → '2슬01-04'. */
export function normalizeStandardCode(code: string): string {
  return (code ?? '').replace(/[[\]\s]/g, '').trim()
}

/**
 * Collapse candidates that repeat the same achievement standard.
 *
 * The same standard reaches the list twice when a subject resolves to more than
 * one graph id, or when its core-idea node appears under two areas. First
 * occurrence wins, so callers should push their preferred source first.
 */
export function dedupeByStandardCode<T extends { code: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = normalizeStandardCode(item.code)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/**
 * Split candidates into fan-out batches. One Jev call carries one question per
 * standard, and 1-2학년군 alone holds ~100 standards across 국어·수학·통합교과,
 * which is too many questions (and too long) for a single request.
 */
export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let index = 0; index < items.length; index += step) {
    out.push(items.slice(index, index + step) as T[])
  }
  return out
}

/** Clamp the requested candidate count into 1..max (default 8). */
export function clampBridgeLimit(limit?: number | null, fallback = 8, max = 20): number {
  const value = Math.round(Number(limit))
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(value, max)
}

/**
 * Order candidates for the picker: relevance first, then standard code so the
 * list is stable when several standards tie (common with Jev's integer scores).
 */
export function sortBridgeCandidates<T extends { score: number; code: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    b.score - a.score || normalizeStandardCode(a.code).localeCompare(normalizeStandardCode(b.code)),
  )
}

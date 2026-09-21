'use client'

// 분석맵 보기 설정(필터) 외부 스토어.
// localStorage 는 React 밖의 시스템이므로 useSyncExternalStore 로 구독한다
// (effect 안에서 setState 로 복원하면 캐스케이드 렌더가 발생).

import { EDGE_THRESHOLD_DEFAULT, EDGE_THRESHOLD_MAX, EDGE_THRESHOLD_MIN, clamp } from './mapMath'
import type { MapFilters } from './types'

const FILTERS_KEY = 'tcid.curriculumMap.filters.v1'

export const DEFAULT_FILTERS: MapFilters = {
  hiddenSubjectIds: [],
  hiddenBands: [],
  edgeThreshold: EDGE_THRESHOLD_DEFAULT,
  alwaysLabels: false,
  physics: true,
}

function readStoredFilters(): MapFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY)
    if (!raw) return DEFAULT_FILTERS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FILTERS
    const obj = parsed as Partial<Record<keyof MapFilters, unknown>>
    return {
      hiddenSubjectIds: Array.isArray(obj.hiddenSubjectIds)
        ? obj.hiddenSubjectIds.filter((v): v is string => typeof v === 'string')
        : [],
      hiddenBands: Array.isArray(obj.hiddenBands)
        ? obj.hiddenBands.filter((v): v is string => typeof v === 'string')
        : [],
      edgeThreshold: typeof obj.edgeThreshold === 'number'
        ? clamp(obj.edgeThreshold, EDGE_THRESHOLD_MIN, EDGE_THRESHOLD_MAX)
        : EDGE_THRESHOLD_DEFAULT,
      alwaysLabels: obj.alwaysLabels === true,
      // 저장값이 없으면 움직임은 기본 켜짐
      physics: obj.physics === undefined ? true : obj.physics === true,
    }
  } catch {
    return DEFAULT_FILTERS
  }
}

function writeStoredFilters(filters: MapFilters): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters))
  } catch {
    // 저장 실패는 조용히 무시 (사생활 보호 모드 등)
  }
}

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

// ─── 필터 외부 스토어 ─────────────────────────────────────────────────────
// localStorage 는 React 밖의 시스템이므로 useSyncExternalStore 로 구독한다.
// (effect 안에서 setState 로 복원하면 캐스케이드 렌더가 발생)

let filtersSnapshot: MapFilters | null = null
const filtersListeners = new Set<() => void>()

export function getFiltersSnapshot(): MapFilters {
  if (filtersSnapshot === null) filtersSnapshot = readStoredFilters()
  return filtersSnapshot
}

/** SSR·하이드레이션 시점에는 저장값을 읽을 수 없으므로 기본값을 쓴다. */
export function getFiltersServerSnapshot(): MapFilters {
  return DEFAULT_FILTERS
}

export function subscribeFilters(onChange: () => void): () => void {
  filtersListeners.add(onChange)
  return () => filtersListeners.delete(onChange)
}

export function updateFilters(reducer: (prev: MapFilters) => MapFilters): void {
  const next = reducer(getFiltersSnapshot())
  filtersSnapshot = next
  writeStoredFilters(next)
  for (const listener of filtersListeners) listener()
}

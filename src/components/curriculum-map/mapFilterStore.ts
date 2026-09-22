'use client'

// 분석맵 보기 설정(필터) 외부 스토어.
// localStorage 는 React 밖의 시스템이므로 useSyncExternalStore 로 구독한다
// (effect 안에서 setState 로 복원하면 캐스케이드 렌더가 발생).
//
// 두 종류가 있다:
//  - 공유·영속 스토어(page 모드): 앱 전체가 하나를 쓰고 localStorage 에 저장한다.
//  - 인스턴스·비영속 스토어(embedded 모드): 시트에서 열 때마다 새로 만들고 저장하지
//    않는다. 그래야 "사회 줄에서 열었던 필터"가 다음 열기에 새지 않는다.

import { EDGE_THRESHOLD_DEFAULT, EDGE_THRESHOLD_MAX, EDGE_THRESHOLD_MIN, clamp } from './mapMath'
import type { MapFilters } from './types'

const FILTERS_KEY = 'tcid.curriculumMap.filters.v1'

export const DEFAULT_FILTERS: MapFilters = {
  hiddenSubjectIds: [],
  hiddenBands: [],
  edgeThreshold: EDGE_THRESHOLD_DEFAULT,
  // 기본 꺼짐. 개요에서는 호버·선택·관련·검색 결과 라벨만 보이고,
  // 1.2 배율을 넘으면 나머지도 가림 검사를 거쳐 나타난다.
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
      // 저장값이 있으면 그것을 따른다 (없으면 기본 꺼짐)
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

export interface FilterStore {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => MapFilters
  /** SSR·하이드레이션 시점에는 저장값을 읽을 수 없으므로 기본값을 쓴다. */
  getServerSnapshot: () => MapFilters
  update: (reducer: (prev: MapFilters) => MapFilters) => void
}

export function createFilterStore(options: { persist: boolean; initial?: MapFilters }): FilterStore {
  let snapshot: MapFilters | null = options.initial ?? null
  const listeners = new Set<() => void>()
  const getSnapshot = (): MapFilters => {
    if (snapshot === null) snapshot = options.persist ? readStoredFilters() : DEFAULT_FILTERS
    return snapshot
  }
  return {
    subscribe: onChange => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    getSnapshot,
    getServerSnapshot: () => DEFAULT_FILTERS,
    update: reducer => {
      snapshot = reducer(getSnapshot())
      if (options.persist) writeStoredFilters(snapshot)
      for (const listener of listeners) listener()
    },
  }
}

/** page 모드가 쓰는 앱 전체 공유·영속 스토어 */
export const sharedFilterStore: FilterStore = createFilterStore({ persist: true })

'use client'

// 분석맵 필터 조작 — 스토어 갱신만 담당하는 얇은 훅.

import { useCallback } from 'react'
import { EDGE_THRESHOLD_MAX, EDGE_THRESHOLD_MIN, clamp } from './mapMath'
import { DEFAULT_FILTERS, toggleInList, type FilterStore } from './mapFilterStore'
import type { MapFilters } from './types'

export interface MapFilterActions {
  toggleSubject: (subjectId: string) => void
  toggleBand: (band: string) => void
  /** 보이는 교과를 이 목록으로 고정 (나머지는 숨김). 시트에서 열 때 쓴다 */
  setVisibleSubjects: (visibleIds: readonly string[], allIds: readonly string[]) => void
  setVisibleBands: (visibleBands: readonly string[], allBands: readonly string[]) => void
  /** 여러 필드를 한 번에 — 시트에서 열 때 시작 필터를 통째로 적용한다 */
  applyFilters: (next: Partial<MapFilters>) => void
  setEdgeThreshold: (value: number) => void
  setAlwaysLabels: (value: boolean) => void
  setPhysics: (value: boolean) => void
  resetFilters: () => void
}

export function useMapFilterActions(store: FilterStore): MapFilterActions {
  const updateFilters = store.update

  const toggleSubject = useCallback((subjectId: string) => {
    updateFilters(f => ({ ...f, hiddenSubjectIds: toggleInList(f.hiddenSubjectIds, subjectId) }))
  }, [updateFilters])

  const toggleBand = useCallback((band: string) => {
    updateFilters(f => ({ ...f, hiddenBands: toggleInList(f.hiddenBands, band) }))
  }, [updateFilters])

  const setVisibleSubjects = useCallback((visibleIds: readonly string[], allIds: readonly string[]) => {
    updateFilters(f => ({ ...f, hiddenSubjectIds: allIds.filter(id => !visibleIds.includes(id)) }))
  }, [updateFilters])

  const setVisibleBands = useCallback((visibleBands: readonly string[], allBands: readonly string[]) => {
    updateFilters(f => ({ ...f, hiddenBands: allBands.filter(b => !visibleBands.includes(b)) }))
  }, [updateFilters])

  const applyFilters = useCallback((next: Partial<MapFilters>) => {
    updateFilters(f => ({ ...f, ...next }))
  }, [updateFilters])

  const setEdgeThreshold = useCallback((value: number) => {
    updateFilters(f => ({ ...f, edgeThreshold: clamp(value, EDGE_THRESHOLD_MIN, EDGE_THRESHOLD_MAX) }))
  }, [updateFilters])

  const setAlwaysLabels = useCallback((value: boolean) => {
    updateFilters(f => ({ ...f, alwaysLabels: value }))
  }, [updateFilters])

  const setPhysics = useCallback((value: boolean) => {
    updateFilters(f => ({ ...f, physics: value }))
  }, [updateFilters])

  const resetFilters = useCallback(() => updateFilters(() => DEFAULT_FILTERS), [updateFilters])

  return {
    toggleSubject,
    toggleBand,
    setVisibleSubjects,
    setVisibleBands,
    applyFilters,
    setEdgeThreshold,
    setAlwaysLabels,
    setPhysics,
    resetFilters,
  }
}

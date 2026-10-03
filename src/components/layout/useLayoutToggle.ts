'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Task #34: 프로젝트별 레이아웃 패널(단계/사이드바/산출물) 접기 상태.
 * - localStorage 키: `layoutPanels:{projectId}` → `{stage: boolean, sidebar: boolean, artifact: boolean}`
 * - true = 펼침(default), false = 접힘(thin strip)
 * - SSR hydration mismatch 방지: 초기 렌더는 기본값(모두 true), mount 후 localStorage 읽어 동기화.
 * - 좁은 화면(NARROW_QUERY)은 저장값을 따로 둔다(`layoutPanels:{projectId}:narrow`).
 *   사용자가 좁은 화면에서 직접 바꾼 적이 없으면 사이드바·산출물을 접어 채팅 폭을 확보하고,
 *   넓은 화면 저장값은 읽지도 덮어쓰지도 않는다.
 */
export type LayoutPanelKey = 'stage' | 'sidebar' | 'artifact'

export type LayoutPanelState = Record<LayoutPanelKey, boolean>

const DEFAULT_STATE: LayoutPanelState = {
  stage: true,
  sidebar: true,
  artifact: true,
}

/** 좁은 화면 기본값: 양옆 패널을 접어 채팅 입력 폭(약 320px 이상)을 확보한다. */
export const NARROW_DEFAULT_STATE: LayoutPanelState = {
  stage: true,
  sidebar: false,
  artifact: false,
}

/** 이 폭 미만이면 좁은 화면 레이아웃을 쓴다 (펼친 사이드바·산출물 패널만으로 채팅이 눌리는 폭). */
export const NARROW_QUERY = 'not all and (min-width: 900px)'

type LayoutMode = 'wide' | 'narrow'

function storageKey(projectId: string, mode: LayoutMode) {
  return mode === 'narrow' ? `layoutPanels:${projectId}:narrow` : `layoutPanels:${projectId}`
}

/** 저장값이 있으면 그대로, 없으면 화면 폭에 맞는 기본값을 쓴다. */
export function resolveLayoutState(stored: Partial<LayoutPanelState> | null, narrow: boolean): LayoutPanelState {
  const base = narrow ? NARROW_DEFAULT_STATE : DEFAULT_STATE
  if (!stored) return base
  return {
    stage: typeof stored.stage === 'boolean' ? stored.stage : base.stage,
    sidebar: typeof stored.sidebar === 'boolean' ? stored.sidebar : base.sidebar,
    artifact: typeof stored.artifact === 'boolean' ? stored.artifact : base.artifact,
  }
}

const snapshots = new Map<string, LayoutPanelState>()
const listeners = new Map<string, Set<() => void>>()

function readStorage(projectId: string, mode: LayoutMode): Partial<LayoutPanelState> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId, mode))
    return raw ? JSON.parse(raw) as Partial<LayoutPanelState> : null
  } catch {
    return null
  }
}

function getProjectSnapshot(projectId: string, mode: LayoutMode): LayoutPanelState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  const cacheKey = `${projectId}|${mode}`
  const cached = snapshots.get(cacheKey)
  if (cached) return cached
  // 마운트/projectId·화면 모드 변경 시에만 읽고, 이후에는 다른 탭의 저장값을 반영하지 않음.
  const state = resolveLayoutState(projectId ? readStorage(projectId, mode) : null, mode === 'narrow')
  snapshots.set(cacheKey, state)
  return state
}

function writeStorage(projectId: string, mode: LayoutMode, state: LayoutPanelState) {
  if (typeof window === 'undefined') return
  snapshots.set(`${projectId}|${mode}`, state)
  try {
    if (projectId) {
      window.localStorage.setItem(storageKey(projectId, mode), JSON.stringify(state))
    }
  } catch {
    // localStorage 용량 초과 등 무시 — 메모리 상태는 유지
  }
  listeners.get(projectId)?.forEach(onStoreChange => onStoreChange())
}

function subscribeStorage(projectId: string, onStoreChange: () => void) {
  let projectListeners = listeners.get(projectId)
  if (!projectListeners) {
    projectListeners = new Set()
    listeners.set(projectId, projectListeners)
  }
  projectListeners.add(onStoreChange)

  return () => {
    projectListeners.delete(onStoreChange)
    if (projectListeners.size === 0) {
      listeners.delete(projectId)
      snapshots.delete(`${projectId}|wide`)
      snapshots.delete(`${projectId}|narrow`)
    }
  }
}

const getServerSnapshot = () => DEFAULT_STATE

function subscribeNarrow(onStoreChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onStoreChange)
  return () => query.removeEventListener('change', onStoreChange)
}

const getNarrowSnapshot = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW_QUERY).matches
const getNarrowServerSnapshot = () => false

export function useLayoutToggle(projectId: string) {
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, getNarrowServerSnapshot)
  const mode: LayoutMode = narrow ? 'narrow' : 'wide'
  const subscribe = useCallback((onStoreChange: () => void) => (
    subscribeStorage(projectId, onStoreChange)
  ), [projectId])
  const getSnapshot = useCallback(() => getProjectSnapshot(projectId, mode), [projectId, mode])
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback((key: LayoutPanelKey) => {
    const prev = getProjectSnapshot(projectId, mode)
    writeStorage(projectId, mode, { ...prev, [key]: !prev[key] })
  }, [projectId, mode])

  return { ...state, toggle }
}

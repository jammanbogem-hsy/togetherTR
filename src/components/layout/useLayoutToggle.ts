'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Task #34: 프로젝트별 레이아웃 패널(단계/사이드바/산출물) 접기 상태.
 * - localStorage 키: `layoutPanels:{projectId}` → `{stage: boolean, sidebar: boolean, artifact: boolean}`
 * - true = 펼침(default), false = 접힘(thin strip)
 * - SSR hydration mismatch 방지: 초기 렌더는 기본값(모두 true), mount 후 localStorage 읽어 동기화.
 */
export type LayoutPanelKey = 'stage' | 'sidebar' | 'artifact'

export type LayoutPanelState = Record<LayoutPanelKey, boolean>

const DEFAULT_STATE: LayoutPanelState = {
  stage: true,
  sidebar: true,
  artifact: true,
}

function storageKey(projectId: string) {
  return `layoutPanels:${projectId}`
}

const snapshots = new Map<string, LayoutPanelState>()
const listeners = new Map<string, Set<() => void>>()

function readStorage(projectId: string): LayoutPanelState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<LayoutPanelState>
    return {
      stage: typeof parsed.stage === 'boolean' ? parsed.stage : true,
      sidebar: typeof parsed.sidebar === 'boolean' ? parsed.sidebar : true,
      artifact: typeof parsed.artifact === 'boolean' ? parsed.artifact : true,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function getProjectSnapshot(projectId: string): LayoutPanelState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  const cached = snapshots.get(projectId)
  if (cached) return cached
  // 마운트/projectId 변경 시에만 읽고, 이후에는 다른 탭의 저장값을 반영하지 않음.
  const state = projectId ? readStorage(projectId) : DEFAULT_STATE
  snapshots.set(projectId, state)
  return state
}

function writeStorage(projectId: string, state: LayoutPanelState) {
  if (typeof window === 'undefined') return
  snapshots.set(projectId, state)
  try {
    if (projectId) {
      window.localStorage.setItem(storageKey(projectId), JSON.stringify(state))
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
      snapshots.delete(projectId)
    }
  }
}

const getServerSnapshot = () => DEFAULT_STATE

export function useLayoutToggle(projectId: string) {
  const subscribe = useCallback((onStoreChange: () => void) => (
    subscribeStorage(projectId, onStoreChange)
  ), [projectId])
  const getSnapshot = useCallback(() => getProjectSnapshot(projectId), [projectId])
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback((key: LayoutPanelKey) => {
    const prev = getProjectSnapshot(projectId)
    writeStorage(projectId, { ...prev, [key]: !prev[key] })
  }, [projectId])

  return { ...state, toggle }
}

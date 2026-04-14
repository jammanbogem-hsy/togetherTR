'use client'

import { useCallback, useEffect, useState } from 'react'

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

function writeStorage(projectId: string, state: LayoutPanelState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(state))
  } catch {
    // localStorage 용량 초과 등 무시 — 메모리 상태는 유지
  }
}

export function useLayoutToggle(projectId: string) {
  const [state, setState] = useState<LayoutPanelState>(DEFAULT_STATE)

  // Mount 후 localStorage 동기화 (SSR mismatch 방지)
  useEffect(() => {
    if (!projectId) return
    setState(readStorage(projectId))
  }, [projectId])

  const toggle = useCallback((key: LayoutPanelKey) => {
    setState(prev => {
      const next = { ...prev, [key]: !prev[key] }
      if (projectId) writeStorage(projectId, next)
      return next
    })
  }, [projectId])

  return { ...state, toggle }
}

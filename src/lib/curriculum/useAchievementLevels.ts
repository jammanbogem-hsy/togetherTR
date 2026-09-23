'use client'

/**
 * 클라이언트용 성취수준(A·B·C) 조회. public/achievement-levels.json 을 한 번만 받아 모듈 단위로 캐시한다.
 * 실패를 삼키지 않는다 — 빈 결과와 실패를 구분해 화면이 "성취수준 없음"으로 오해하지 않게 한다.
 */

import { useEffect, useState } from 'react'

export interface ClientAchievementLevel {
  band: string
  subject: string
  A: string
  B: string
  C: string
  inferred?: boolean
}

type LevelMap = Record<string, ClientAchievementLevel>

let pending: Promise<LevelMap> | null = null

function loadLevels(): Promise<LevelMap> {
  if (!pending) {
    pending = fetch('/achievement-levels.json')
      .then(res => {
        if (!res.ok) throw new Error(`성취수준 파일을 불러오지 못했습니다 (${res.status})`)
        return res.json() as Promise<{ standards?: LevelMap }>
      })
      .then(data => data.standards ?? {})
      .catch(error => {
        pending = null   // 다음 마운트에서 다시 시도
        throw error
      })
  }
  return pending
}

export function useAchievementLevels(enabled = true): { levels: LevelMap | null; error: string } {
  const [levels, setLevels] = useState<LevelMap | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadLevels()
      .then(map => { if (alive) setLevels(map) })
      .catch(err => {
        console.error('[useAchievementLevels]', err)
        if (alive) setError(err instanceof Error ? err.message : '성취수준을 불러오지 못했습니다')
      })
    return () => { alive = false }
  }, [enabled])
  return { levels, error }
}

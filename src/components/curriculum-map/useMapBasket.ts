'use client'

// 담기(바구니) 상태 — 선택 해제·검색 초기화와 무관하게 유지된다.

import { useCallback, useMemo, useState } from 'react'
import { removeFromBasket, toggleBasket } from './basketMath'
import type { MapPick } from './types'

export interface MapBasket {
  picks: MapPick[]
  pickedIds: ReadonlySet<string>
  toggle: (pick: MapPick) => void
  remove: (id: string) => void
  clear: () => void
}

export function useMapBasket(): MapBasket {
  const [picks, setPicks] = useState<MapPick[]>([])
  const pickedIds = useMemo(() => new Set(picks.map(p => p.id)), [picks])
  const toggle = useCallback((pick: MapPick) => setPicks(b => toggleBasket(b, pick)), [])
  const remove = useCallback((id: string) => setPicks(b => removeFromBasket(b, id)), [])
  const clear = useCallback(() => setPicks([]), [])
  return { picks, pickedIds, toggle, remove, clear }
}

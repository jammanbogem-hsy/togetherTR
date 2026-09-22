'use client'

// ─── 교육과정 분석 시트 → 분석맵 전체 화면 레이어 ─────────────────────────
// 시트 위(z 9500)에 분석맵을 띄운다. 시트는 아래에 그대로 마운트되어 있다.
// 브라우저 뒤로가기가 분석맵을 먼저 닫도록 history 항목(tcidMap)을 하나 쌓는다
// (CurriculumWorkspaceModal의 tcidSheet 항목 위에 얹힌다). 누가 닫히는지는
// sheetMapHistory.decidePopOwner 한곳에서 판정한다.
// 이 파일이 분석맵 컴포넌트를 import하는 유일한 시트 쪽 파일이다.

import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CurriculumMapView } from '@/components/curriculum-map/CurriculumMapView'
import { closeViaHistory, decidePopOwner, isMapLayerOpen, setMapLayerOpen, shouldPushEntry } from '@/lib/curriculum/sheetMapHistory'

/** 분석맵에서 고른 성취기준 — CurriculumMapView의 MapPick과 같은 필드(구조적 호환). */
export interface SheetMapPick {
  id: string
  code: string
  text: string
  standard: string
  subject: string
  subjectId: string
  band: string
  area: string
  coreIdea: string
  contentCoreIdea?: string
}

export interface SheetMapRequest {
  rowId?: string
  query: string
  subjects: string[]
  bands: string[]
  context?: { subject?: string; gradeBand?: string; coreIdea?: string; rowId?: string }
}

// back()을 요청하고 popstate를 기다리는 동안 두 번째 닫기 요청을 막는다(이중 pop 방지).
let backPending = false

/**
 * 시트 쪽 닫기 요청(뒤로가기 화살표·Esc·반영 완료 모두 이 경로).
 * 맵 항목이 최상단이면 back()으로 소비하고 popstate에서 닫는다. 아니면 바로 닫는다.
 */
export function requestSheetMapClose(close: () => void): void {
  if (typeof window === 'undefined') { close(); return }
  const result = closeViaHistory({
    currentState: window.history.state,
    key: 'tcidMap',
    backPending,
    back: () => { backPending = true; window.history.back() },
    close,
  })
  if (result === 'close') setMapLayerOpen(false)
}

export function SheetMapLayer({
  request, onApply, onClose,
}: {
  request: SheetMapRequest
  onApply: (picks: SheetMapPick[]) => void
  onClose: () => void
}) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setMapLayerOpen(true)
    backPending = false
    if (shouldPushEntry(window.history.state, 'tcidMap')) {
      window.history.pushState({ tcidMap: true }, '')
    }
    const handlePop = () => {
      backPending = false
      const owner = decidePopOwner({ sheetOpen: true, mapOpen: isMapLayerOpen(), newState: window.history.state })
      if (owner !== 'map') return
      // 두 번째 pop이 바로 이어져도 시트 컨테이너가 올바르게 판정하도록 플래그를 먼저 내린다.
      setMapLayerOpen(false)
      onCloseRef.current()
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      setMapLayerOpen(false)
    }
  }, [])

  const handleClose = useCallback(() => requestSheetMapClose(() => onCloseRef.current()), [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[9500] bg-[#FFFFFF]">
      <CurriculumMapView
        mode="embedded"
        initialQuery={request.query || undefined}
        initialSubjects={request.subjects.length > 0 ? request.subjects : undefined}
        initialBands={request.bands.length > 0 ? request.bands : undefined}
        context={request.context}
        onApply={onApply}
        onClose={handleClose}
      />
    </div>,
    document.body,
  )
}

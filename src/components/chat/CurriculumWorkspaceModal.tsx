'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CurriculumSheetModal } from './CurriculumSheetModal'
import type { CurriculumSheetRow } from '@/types'
import type { CurriculumSheetPatch } from '@/lib/firebase/projects'
import { buildGraphCodesFromSheet } from '@/lib/curriculum/graphSheetBridge'
import { closeViaHistory, decidePopOwner, isMapLayerOpen, shouldPushEntry } from '@/lib/curriculum/sheetMapHistory'

/**
 * 교육과정 분석 워크스페이스 — 분석시트 ↔ 지식그래프 통합 모달
 *
 * 흐름: 지식그래프 버튼 → 분석시트 (기본) → "지식 그래프 보기" → 그래프 뷰 → "← 분석시트"
 */

interface Props {
  open: boolean
  onClose: () => void
  initialView?: 'sheet' | 'graph'
  // ─── 시트 props ───
  sheetRows: CurriculumSheetRow[]
  onSheetSave: (rows: CurriculumSheetRow[]) => void | Promise<void>
  onSheetPatch?: (patch: CurriculumSheetPatch) => void | Promise<CurriculumSheetRow[] | void>
  onRequestArtifactSave?: (rows: CurriculumSheetRow[]) => void
  onPresenceUpdate?: (presence: { uid: string; displayName: string; color: string; cellKey: string; updatedAt: number } | null) => void
  presence?: Record<string, { uid: string; displayName: string; color: string; cellKey: string; updatedAt: number }>
  currentUserName?: string
  currentUid?: string
  currentUserColor?: string
  projectId?: string
  // ─── 그래프 뷰 ───
  renderGraphView?: (onBackToSheet: () => void) => React.ReactNode
  onGraphCodesFromSheet?: (codes: Array<{ code: string; addedBy: string }>, options?: { centerCode?: string }) => void
  onViewChange?: (view: 'sheet' | 'graph') => void
  // ─── AI 자동 채우기 ───
  a12Artifact?: Record<string, unknown>
  graphSavedData?: { centerNode: { id: string; label: string; subjectId: string; text: string } | null; selectedStandards: Array<{ id: string; label: string; subjectId: string; text: string }> } | null
  targetGradeGroup?: string
  teamGradeBands?: string[]
  chatContext?: string
  // ─── 시트 학년군 설정 (프로젝트 문서 공유 값) ───
  gradeMode?: 'single' | 'multi'
  sheetGradeBand?: string
  onGradeSettingsChange?: (settings: { gradeMode?: 'single' | 'multi'; gradeBand?: string }) => void | Promise<void>
}

export function CurriculumWorkspaceModal({
  open, onClose, initialView = 'sheet',
  sheetRows, onSheetSave, onSheetPatch, onPresenceUpdate, presence,
  currentUserName, currentUid, currentUserColor, projectId,
  renderGraphView, onGraphCodesFromSheet, onViewChange,
  a12Artifact, graphSavedData, targetGradeGroup, teamGradeBands, chatContext,
  gradeMode, sheetGradeBand, onGradeSettingsChange,
  onRequestArtifactSave,
}: Props) {
  const [view, setView] = useState<'sheet' | 'graph'>(initialView)

  // 시트 → 그래프 전환
  const switchToGraph = useCallback((sourceRows?: CurriculumSheetRow[]) => {
    const rowsForGraph = sourceRows ?? sheetRows
    void (async () => {
      const savedRows = onSheetPatch
        ? await onSheetPatch({ type: 'replace-all', rows: rowsForGraph })
        : (await onSheetSave(rowsForGraph), rowsForGraph)
      const rowsForCodes = savedRows?.length ? savedRows : rowsForGraph
      const { codes, centerCode } = buildGraphCodesFromSheet(rowsForCodes)
      onGraphCodesFromSheet?.(codes, { centerCode })
      setView('graph')
      onViewChange?.('graph')
    })()
  }, [sheetRows, onSheetSave, onSheetPatch, onGraphCodesFromSheet, onViewChange])

  const backToSheet = useCallback(() => {
    setView('sheet')
    onViewChange?.('sheet')
  }, [onViewChange])

  // 전체 화면 뷰라 브라우저 뒤로가기로도 닫혀야 한다.
  // 열 때 history 항목을 하나 쌓고 popstate에서 닫는다. onClose는 부모에서 인라인
  // 함수로 오는 경우가 많아 ref로 읽어 effect가 open에만 반응하도록 한다(중복 push 방지).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  const backPendingRef = useRef(false)
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    backPendingRef.current = false
    // 이미 우리 항목이 최상단이면 다시 쌓지 않는다(StrictMode·remount 대비).
    if (shouldPushEntry(window.history.state, 'tcidSheet')) {
      window.history.pushState({ tcidSheet: true }, '')
    }
    const handlePop = () => {
      backPendingRef.current = false
      // cleanup에서는 history를 건드리지 않는다(StrictMode의 mount→cleanup→mount가 자기
      // 항목을 pop해 즉시 닫히던 문제). 남은 항목은 다음 뒤로가기에서 무해하게 소비된다.
      // 분석맵(tcidMap)이 열려 있거나 우리 항목이 아직 위에 있으면 시트는 유지한다.
      const owner = decidePopOwner({ sheetOpen: openRef.current, mapOpen: isMapLayerOpen(), newState: window.history.state })
      if (owner !== 'sheet') return
      setView('sheet')
      onCloseRef.current()
    }
    window.addEventListener('popstate', handlePop)
    return () => { window.removeEventListener('popstate', handlePop) }
  }, [open])

  // 전체 화면 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  // 모달 닫힐 때 시트 뷰로 리셋. history 항목이 우리 것이면 back()으로 소비해
  // popstate 경로 하나로만 닫는다(이중 pop 방지).
  const handleClose = useCallback(() => {
    if (typeof window === 'undefined') { setView('sheet'); onCloseRef.current(); return }
    closeViaHistory({
      currentState: window.history.state,
      key: 'tcidSheet',
      backPending: backPendingRef.current,
      back: () => { backPendingRef.current = true; window.history.back() },
      close: () => { setView('sheet'); onCloseRef.current() },
    })
  }, [])

  if (!open || typeof document === 'undefined') return null

  // M3 full-screen dialog — 배경·여백 없이 화면을 가득 채운다.
  return createPortal(
    <div className="fixed inset-0 z-[9000] bg-[#FFFFFF]">
      <div className="flex h-full w-full flex-col overflow-hidden">
        {view === 'sheet' ? (
          <CurriculumSheetModal
            open
            onClose={handleClose}
            rows={sheetRows}
            onSave={onSheetSave}
            onPatchSave={onSheetPatch}
            onRequestArtifactSave={onRequestArtifactSave}
            onPresenceUpdate={onPresenceUpdate}
            onSwitchToGraph={switchToGraph}
            presence={presence}
            currentUserName={currentUserName}
            currentUid={currentUid}
            currentUserColor={currentUserColor}
            projectId={projectId}
            a12Artifact={a12Artifact}
            graphSavedData={graphSavedData}
            targetGradeGroup={targetGradeGroup}
            teamGradeBands={teamGradeBands}
            chatContext={chatContext}
            gradeMode={gradeMode}
            sheetGradeBand={sheetGradeBand}
            onGradeSettingsChange={onGradeSettingsChange}
          />
        ) : (
          renderGraphView ? renderGraphView(backToSheet) : null
        )}
      </div>
    </div>,
    document.body,
  )
}

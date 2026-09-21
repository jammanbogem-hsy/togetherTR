'use client'

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CurriculumSheetModal } from './CurriculumSheetModal'
import type { CurriculumSheetRow } from '@/types'
import type { CurriculumSheetPatch } from '@/lib/firebase/projects'
import { buildGraphCodesFromSheet } from '@/lib/curriculum/graphSheetBridge'

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
  a12Artifact, graphSavedData, targetGradeGroup, chatContext,
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

  // 모달 닫힐 때 시트 뷰로 리셋
  const handleClose = useCallback(() => {
    setView('sheet')
    onClose()
  }, [onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: '96vw', maxWidth: 1500, height: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
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

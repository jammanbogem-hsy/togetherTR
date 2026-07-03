'use client'

import React, { useState } from 'react'
import type { GraphSavedData, SaveState } from './types'

interface SaveButtonsProps {
  onSaveGraph?: (data: Omit<GraphSavedData, 'savedAt'>) => Promise<void>
  buildData: () => Omit<GraphSavedData, 'savedAt'>
}

export default function SaveButtons({ onSaveGraph, buildData }: SaveButtonsProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle')

  async function handleSave() {
    if (!onSaveGraph || saveState === 'saving') return
    setSaveState('saving')
    try {
      await onSaveGraph(buildData())
      setSaveState('success')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }

  const saveLabel = saveState === 'saving' ? '저장 중…'
    : saveState === 'success' ? '✓ 저장 완료'
    : saveState === 'error' ? '✗ 저장 실패'
    : '지식 그래프·수업 예시 저장'

  const saveClass = saveState === 'success'
    ? 'bg-[#2E7D32] hover:bg-[#2E7D32] cursor-default shadow-md'
    : saveState === 'error'
    ? 'bg-[#C62828] hover:bg-[#C62828] cursor-default shadow-md'
    : saveState === 'saving'
    ? 'bg-gray-900 opacity-70 cursor-not-allowed shadow-md'
    : 'bg-gray-900 hover:bg-gray-800 shadow-md'

  return (
    onSaveGraph ? (
      <div className="relative flex items-center">
        <div className="absolute bottom-[calc(100%+12px)] right-0 w-[270px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-700 shadow-lg">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-[#7B1FA2]" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold leading-snug">이 버튼을 누르면 산출물 저장을 할 수 있어요</p>
              <p className="mt-1 text-[13px] leading-snug text-gray-500">그래프와 수업 예시가 분석시트에 반영됩니다.</p>
            </div>
          </div>
          <span className="absolute -bottom-2 right-9 h-4 w-4 rotate-45 border-b border-r border-gray-200 bg-white" />
        </div>
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className={`relative flex items-center gap-2 px-5 py-3 rounded-2xl text-white text-[15px] font-bold transition-colors ${saveClass}`}
        >
          {saveState === 'saving' && (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          {saveLabel}
        </button>
      </div>
    ) : null
  )
}

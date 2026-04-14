'use client'

import React, { useState } from 'react'
import type { GraphSavedData, SaveState } from './types'

interface SaveButtonsProps {
  onSaveGraph?: (data: Omit<GraphSavedData, 'savedAt'>) => Promise<void>
  onSendToChat?: (data: Omit<GraphSavedData, 'savedAt'>) => void | Promise<void>
  buildData: () => Omit<GraphSavedData, 'savedAt'>
}

export default function SaveButtons({ onSaveGraph, onSendToChat, buildData }: SaveButtonsProps) {
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
    : saveState === 'error' ? '✗ ��장 실패'
    : '지식 그래프 저장'

  const saveClass = saveState === 'success'
    ? 'bg-[#2E7D32] hover:bg-[#2E7D32] cursor-default'
    : saveState === 'error'
    ? 'bg-[#C62828] hover:bg-[#C62828] cursor-default'
    : saveState === 'saving'
    ? 'bg-[#7B1FA2] opacity-70 cursor-not-allowed'
    : 'bg-[#7B1FA2] hover:bg-[#6A1B9A]'

  return (
    <>
      {onSaveGraph && (
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-[12px] font-bold shadow-lg transition-colors ${saveClass}`}
        >
          {saveState === 'saving' && (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          {saveLabel}
        </button>
      )}
      {onSendToChat && (
        <button
          onClick={() => onSendToChat(buildData())}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1565C0] text-white text-[12px] font-bold shadow-lg hover:bg-[#0D47A1] transition-colors"
        >
          채팅으로 보내기
        </button>
      )}
    </>
  )
}

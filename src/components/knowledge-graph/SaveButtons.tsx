'use client'

import { useEffect, useRef, useState } from 'react'
import { MD3Button } from '@/components/ui/MD3Button'
import type { GraphSavedData, SaveState } from './types'

interface SaveButtonsProps {
  onSaveGraph?: (data: Omit<GraphSavedData, 'savedAt'>) => Promise<void>
  buildData: () => Omit<GraphSavedData, 'savedAt'>
  disabled?: boolean
}

export default function SaveButtons({ onSaveGraph, buildData, disabled }: SaveButtonsProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const savingRef = useRef(false)
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetRef.current) clearTimeout(resetRef.current) }, [])

  async function handleSave() {
    if (!onSaveGraph || disabled || savingRef.current) return
    if (resetRef.current) clearTimeout(resetRef.current)
    savingRef.current = true
    setSaveState('saving')
    try {
      await onSaveGraph(buildData())
      setSaveState('success')
      resetRef.current = setTimeout(() => setSaveState('idle'), 2500)
    } catch {
      setSaveState('error')
    } finally {
      savingRef.current = false
    }
  }

  if (!onSaveGraph) return null
  const statusMessage = saveState === 'success' ? '분석시트에 저장했습니다.'
    : saveState === 'error' ? '저장하지 못했습니다. 다시 시도해 주세요.' : saveState === 'saving' ? '저장 중…' : ''

  return (
    <div className="flex flex-col items-end gap-1">
      <MD3Button onClick={handleSave} variant="filled" tone={saveState === 'error' ? 'red' : saveState === 'success' ? 'green' : 'blue'}
        disabled={disabled || saveState === 'saving'} aria-busy={saveState === 'saving'}
        aria-label="지식 그래프와 수업 예시를 분석시트에 저장"
        icon={<span className="material-symbols-rounded text-[20px]" aria-hidden>{saveState === 'success' ? 'check' : 'save'}</span>}
      >
        {saveState === 'saving' ? '저장 중…' : saveState === 'success' ? '저장 완료' : saveState === 'error' ? '다시 저장' : '분석시트에 저장'}
      </MD3Button>
      <span role="status" aria-live="polite" className={saveState === 'error' ? 'max-w-60 text-[12px] text-[var(--md-error)]' : 'sr-only'}>{statusMessage}</span>
    </div>
  )
}

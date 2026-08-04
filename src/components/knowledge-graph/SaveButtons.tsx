'use client'

import React, { useState } from 'react'
import type { GraphSavedData, SaveState } from './types'

// MD3 tokens — scoped locally (rendered outside `.m3-landing`).
const M3 = {
  '--md-primary': '#0B57D0',
  '--md-on-primary': '#FFFFFF',
  '--md-surface': '#FFFFFF',
  '--md-on-surface': '#1F1F1F',
  '--md-on-surface-variant': '#444746',
  '--md-outline-variant': '#C4C7C5',
  '--md-error': '#B3261E',
} as React.CSSProperties

interface SaveButtonsProps {
  onSaveGraph?: (data: Omit<GraphSavedData, 'savedAt'>) => Promise<void>
  buildData: () => Omit<GraphSavedData, 'savedAt'>
}

export default function SaveButtons({ onSaveGraph, buildData }: SaveButtonsProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // 저장 안내 말풍선 표시 여부 (현재 컴포넌트/세션 한정 — 새로고침·재마운트 시 다시 표시)
  const [hintDismissed, setHintDismissed] = useState(false)

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

  const isBusy = saveState === 'saving'

  const saveLabel = saveState === 'saving' ? '저장 중…'
    : saveState === 'success' ? '✓ 저장 완료'
    : saveState === 'error' ? '✗ 저장 실패'
    : '지식 그래프·수업 예시 저장'

  const statusMessage = saveState === 'success' ? '저장 완료'
    : saveState === 'error' ? '저장 실패'
    : saveState === 'saving' ? '저장 중' : ''

  const buttonStyle: React.CSSProperties =
    saveState === 'success' ? { background: '#1E8E3E', color: '#FFFFFF' }
    : saveState === 'error' ? { background: 'var(--md-error)', color: '#FFFFFF' }
    : saveState === 'saving' ? { background: 'var(--md-primary)', color: 'var(--md-on-primary)', opacity: 0.75 }
    : { background: 'var(--md-primary)', color: 'var(--md-on-primary)' }

  return (
    onSaveGraph ? (
      <div className="relative flex items-center" style={M3}>
        {!hintDismissed && (
        <div
          id="kg-save-hint"
          role="region"
          aria-label="저장 안내"
          className="absolute bottom-[calc(100%+12px)] right-0 w-[270px] rounded-2xl border md-shadow-2 px-4 py-3 bg-[var(--md-surface)] border-[var(--md-outline-variant)]"
        >
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-0.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: 'var(--md-primary)' }} />
            <div className="min-w-0 pr-6">
              <p className="text-[14px] font-bold leading-snug" style={{ color: 'var(--md-on-surface)' }}>이 버튼을 누르면 산출물 저장을 할 수 있어요</p>
              <p className="mt-1 text-[14px] leading-snug" style={{ color: 'var(--md-on-surface-variant)' }}>그래프와 수업 예시가 분석시트에 반영됩니다.</p>
            </div>
          </div>
          {/* 닫기 — 절대 배치라 레이아웃을 밀지 않음, 텍스트는 pr-6로 겹침 회피 */}
          <button
            type="button"
            onClick={() => setHintDismissed(true)}
            aria-label="저장 안내 닫기"
            className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[16px] leading-none transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--md-primary)]"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            <span aria-hidden>×</span>
          </button>
          <span aria-hidden className="absolute -bottom-2 right-9 h-4 w-4 rotate-45 border-b border-r bg-[var(--md-surface)] border-[var(--md-outline-variant)]" />
        </div>
        )}
        <button
          onClick={handleSave}
          disabled={isBusy}
          aria-busy={isBusy}
          aria-describedby={hintDismissed ? undefined : 'kg-save-hint'}
          aria-label="지식 그래프와 수업 예시를 분석시트에 저장"
          className={`m3-state relative flex items-center gap-2 px-5 py-3 rounded-2xl text-[15px] font-bold transition-colors md-shadow-1 ${isBusy ? 'cursor-not-allowed' : ''}`}
          style={buttonStyle}
        >
          {saveState === 'saving' && (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          {saveLabel}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>
      </div>
    ) : null
  )
}

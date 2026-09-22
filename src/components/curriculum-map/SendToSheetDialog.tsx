'use client'

// page 모드 "시트로 보내기" — 내 프로젝트를 골라 분석시트에 성취기준을 추가한다.

import { useEffect, useState } from 'react'
import { MD3Button } from '@/components/ui/MD3Button'
import { appendMapPicksToSheet, getUserProjects } from '@/lib/firebase/projects'
import type { Project } from '@/types'
import type { MapPick } from './types'

export interface SendToSheetDialogProps {
  open: boolean
  picks: MapPick[]
  uid: string
  displayName?: string
  onClose: () => void
  /** 추가된 행 수 */
  onDone: (rowsAdded: number) => void
}

type Status = 'loading' | 'ready' | 'error' | 'sending'

export default function SendToSheetDialog({
  open,
  picks,
  uid,
  displayName,
  onClose,
  onDone,
}: SendToSheetDialogProps): React.ReactElement | null {
  const [projects, setProjects] = useState<Project[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getUserProjects(uid)
      .then(list => {
        if (cancelled) return
        setProjects(list)
        setChosen(list[0]?.id ?? null)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '프로젝트 목록을 불러오지 못했습니다.')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, uid])

  if (!open) return null

  const send = (): void => {
    if (!chosen) return
    setStatus('sending')
    setError(null)
    appendMapPicksToSheet(chosen, picks, displayName)
      .then(rows => onDone(rows))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '분석시트에 추가하지 못했습니다.')
        setStatus('ready')
      })
  }

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-to-sheet-title"
        className="w-full max-w-md rounded-[28px] bg-[var(--md-surface-container-low)] p-6"
        style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.2), 0 16px 40px rgba(0,0,0,0.16)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="send-to-sheet-title" className="mb-1 text-[22px] font-normal text-[var(--md-on-surface)]">
          시트로 보내기
        </h2>
        <p className="mb-4 text-[14px] leading-[1.5] text-[var(--md-on-surface-variant)]">
          담은 성취기준 {picks.length}개를 추가할 프로젝트를 고르세요.
        </p>

        {status === 'loading' && <div className="m3-progress mb-4" />}
        {status === 'error' && error && (
          <p className="mb-4 rounded-xl bg-[var(--md-error-container)] px-4 py-3 text-[14px] text-[var(--md-on-error-container)]">
            {error}
          </p>
        )}
        {status !== 'loading' && projects.length === 0 && status !== 'error' && (
          <p className="mb-4 text-[14px] text-[var(--md-on-surface-variant)]">참여 중인 프로젝트가 없습니다.</p>
        )}

        {projects.length > 0 && (
          <ul className="mb-5 max-h-[40vh] space-y-1 overflow-y-auto" role="radiogroup" aria-label="프로젝트">
            {projects.map(p => {
              const active = p.id === chosen
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setChosen(p.id)}
                    className={`m3-state flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
                      active
                        ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
                        : 'text-[var(--md-on-surface)]'
                    }`}
                  >
                    <span className="material-symbols-rounded text-[20px] leading-none">
                      {active ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{p.title}</span>
                      <span className="block text-[13px] text-[var(--md-on-surface-variant)]">
                        {p.currentStage} · {p.targetGradeGroup}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {status === 'ready' && error && (
          <p className="mb-3 text-[13px] text-[var(--md-error)]">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <MD3Button variant="text" size="sm" tone="neutral" onClick={onClose} disabled={status === 'sending'}>
            취소
          </MD3Button>
          <MD3Button
            variant="filled"
            size="sm"
            onClick={send}
            disabled={!chosen || status === 'sending' || status === 'loading'}
          >
            {status === 'sending' ? '추가하는 중…' : '추가'}
          </MD3Button>
        </div>
      </div>
    </div>
  )
}

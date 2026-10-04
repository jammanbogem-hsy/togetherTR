'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { useProjectStore } from '@/store/project'
import { MD3Button } from '@/components/ui/MD3Button'
import { TrainingModeFields } from './TrainingModeFields'
import type { Project } from '@/types'

export function TrainingSettingsModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const user = useProjectStore(state => state.userProfile)
  const isHost = !!user && (project.hostUid === user.uid || project.createdBy === user.uid)
  const [value, setValue] = useState(() => ({
    enabled: project.trainingMode?.enabled ?? false,
    coreFormal: project.trainingMode?.coreFormal ?? true,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
      if (event.key !== 'Tab') return
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
      if (!elements?.length) { event.preventDefault(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previousFocus?.focus() }
  }, [onClose, saving])

  async function save() {
    if (!isHost || saving) return
    setSaving(true)
    setError('')
    try {
      await updateDoc(doc(db, 'projects', project.id), { trainingMode: value, updatedAt: serverTimestamp() })
      onClose()
    } catch {
      setError('설정을 저장하지 못했습니다. 다시 시도해 주세요.')
    } finally { setSaving(false) }
  }

  if (!isHost) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="training-settings-title" tabIndex={-1}
        className="max-h-[calc(100dvh-32px)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl outline-none">
        <h2 id="training-settings-title" className="mb-4 text-lg font-semibold text-[#202124]">프로젝트 설정</h2>
        <TrainingModeFields value={value} onChange={setValue} disabled={saving} />
        {error && <p role="alert" className="mt-3 text-sm text-[#C5221F]">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <MD3Button variant="text" size="sm" onClick={onClose} disabled={saving}>닫기</MD3Button>
          <MD3Button variant="filled" size="sm" onClick={save} disabled={saving}>{saving ? '저장 중…' : '설정 저장'}</MD3Button>
        </div>
      </div>
    </div>, document.body,
  )
}

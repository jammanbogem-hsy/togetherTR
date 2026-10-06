'use client'

import { useCallback, useRef, useState } from 'react'
import type { Project } from '@/types'
import { removeMember } from '@/lib/firebase/projects'
import { MD3Button } from '@/components/ui/MD3Button'
import { MemberActionDialog } from './MemberActionDialog'
import { canRemoveMember, memberRemovalError } from './memberManagement'

export function MemberRemovalButton({ project, userId, targetUid, name }: {
  project: Project; userId: string; targetUid: string; name: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)
  const close = useCallback(() => { if (!pendingRef.current) setOpen(false) }, [])
  async function confirm() {
    if (pendingRef.current || !canRemoveMember(project, userId, targetUid)) return
    pendingRef.current = true
    setBusy(true); setError('')
    try {
      await removeMember(project.id, userId, targetUid)
      setOpen(false)
    } catch (cause) { setError(memberRemovalError(cause)) }
    finally { pendingRef.current = false; setBusy(false) }
  }
  if (!canRemoveMember(project, userId, targetUid)) return null
  return <>
    <MD3Button variant="text" tone="neutral" size="xs" aria-label={`${name} 선생님 내보내기`} onClick={() => { setError(''); setOpen(true) }}>내보내기</MD3Button>
    {open && <MemberActionDialog title={`${name} 선생님을 내보낼까요?`} confirmLabel="내보내기" busy={busy} error={error} onConfirm={confirm} onClose={close}>
      <p>남긴 대화와 산출물은 남아요.</p>
      <p>초대코드로 다시 들어올 수 있어요.</p>
    </MemberActionDialog>}
  </>
}

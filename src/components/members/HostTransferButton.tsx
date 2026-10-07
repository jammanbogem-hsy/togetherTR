'use client'

import { useCallback, useRef, useState } from 'react'
import type { Project } from '@/types'
import { transferHostTo } from '@/lib/firebase/projects'
import { hostTransferErrorText, planHostTransfer } from '@/lib/project/hostTransfer'
import { MD3Button } from '@/components/ui/MD3Button'
import { MemberActionDialog } from './MemberActionDialog'

/** 기록 담당이 팀원 목록에서 그 팀원에게 기록 권한을 넘긴다. */
export function HostTransferButton({ project, userId, targetUid, name }: {
  project: Project; userId: string; targetUid: string; name: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)
  const close = useCallback(() => { if (!pendingRef.current) setOpen(false) }, [])
  const allowed = !project.demoRun && targetUid !== userId && planHostTransfer(project, userId, targetUid, 0).ok
  async function confirm() {
    if (pendingRef.current) return
    pendingRef.current = true
    setBusy(true); setError('')
    try {
      await transferHostTo(project.id, userId, targetUid)
      setOpen(false)
    } catch (cause) { setError(hostTransferErrorText(cause)) }
    finally { pendingRef.current = false; setBusy(false) }
  }
  if (!allowed) return null
  return <>
    <MD3Button variant="text" tone="neutral" size="xs" aria-label={`${name} 선생님에게 기록 권한 넘기기`} onClick={() => { setError(''); setOpen(true) }}>기록 권한 넘기기</MD3Button>
    {open && <MemberActionDialog title={`${name} 선생님에게 기록 권한을 넘길까요?`} confirmLabel="넘기기" busy={busy} error={error} onConfirm={confirm} onClose={close}>
      <p>넘기면 나는 일반 팀원이 되고, 산출물 확정·활동 이동·팀원 관리는 {name} 선생님이 해요.</p>
      <p>나중에 다시 기록 권한을 요청할 수 있어요.</p>
    </MemberActionDialog>}
  </>
}

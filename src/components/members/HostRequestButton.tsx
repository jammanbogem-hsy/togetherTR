'use client'

import { useState } from 'react'
import type { Project } from '@/types'
import { cancelHostRequest, requestHostRole } from '@/lib/firebase/projects'
import { canRequestHost, myHostRequestState } from '@/lib/project/hostTransfer'
import { MD3Button } from '@/components/ui/MD3Button'

/** 팀원이 자기 줄에서 기록 권한을 요청·취소한다. 거절되면 알려 주고 다시 요청할 수 있다. */
export function HostRequestButton({ project, userId, name }: { project: Project; userId: string; name: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!canRequestHost(project, userId)) return null
  const state = myHostRequestState(project, userId)
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch { setError('처리하지 못했어요. 잠시 후 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      {state === 'pending'
        ? <MD3Button variant="text" tone="neutral" size="xs" disabled={busy} onClick={() => run(() => cancelHostRequest(project.id, userId))}>요청 취소</MD3Button>
        : <MD3Button variant="text" tone="neutral" size="xs" disabled={busy} onClick={() => run(() => requestHostRole(project.id, userId, name))}>기록 권한 요청</MD3Button>}
      {state === 'pending' && <span role="status" className="text-[11px] text-[#5F6368]">기록 담당의 응답을 기다리고 있어요</span>}
      {state === 'rejected' && <span role="status" className="text-[11px] text-[#5F6368]">요청이 거절됐어요</span>}
      {error && <span role="alert" className="text-[11px] text-[#C5221F]">{error}</span>}
    </div>
  )
}

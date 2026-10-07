'use client'

import { useState } from 'react'
import type { Project } from '@/types'
import { rejectHostRequest, transferHostTo } from '@/lib/firebase/projects'
import { hostTransferErrorText, pendingHostRequests } from '@/lib/project/hostTransfer'
import { MD3Button } from '@/components/ui/MD3Button'

/** 기록 담당 화면 상단 — 팀원의 기록 권한 요청(오프라인 동안 들어온 것 포함)을 넘기기·거절로 처리한다. */
export function HostRequestBanner({ project, userId }: { project: Project; userId: string }) {
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [error, setError] = useState('')
  const requests = pendingHostRequests(project, userId)
  if (!requests.length) return null
  async function run(uid: string, action: () => Promise<void>) {
    if (busyUid) return
    setBusyUid(uid); setError('')
    try { await action() } catch (cause) { setError(hostTransferErrorText(cause)) }
    finally { setBusyUid(null) }
  }
  return (
    <div role="region" aria-label="기록 권한 요청" className="flex flex-col gap-2 border-b border-[#F9AB00]/40 bg-[#FEF7E0] px-4 py-2.5">
      {requests.map(request => (
        <div key={request.uid} className="flex flex-wrap items-center gap-2 text-[14px] text-[#3C4043]">
          <span className="min-w-0 flex-1">{request.name} 선생님이 기록 권한을 요청했어요</span>
          <MD3Button variant="filled" size="xs" disabled={!!busyUid} onClick={() => run(request.uid, () => transferHostTo(project.id, userId, request.uid))}>
            {busyUid === request.uid ? '처리 중…' : '넘기기'}
          </MD3Button>
          <MD3Button variant="text" tone="neutral" size="xs" disabled={!!busyUid} onClick={() => run(request.uid, () => rejectHostRequest(project.id, request.uid))}>거절</MD3Button>
        </div>
      ))}
      {error && <p role="alert" className="text-[13px] text-[#C5221F]">{error}</p>}
    </div>
  )
}

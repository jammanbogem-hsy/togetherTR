import { useState } from 'react'
import type { ActivityCode } from '@/types'

interface SharedState {
  projectId: string
  userUid: string
  open: boolean
}

// 공유 상태가 바뀔 때만 따라가므로 팀원의 로컬 닫기는 다음 방장 재오픈까지 유지된다.
export function useProblemSituationOpen({ projectId, userUid, isHost, sharedOpen, currentActivity }: {
  projectId?: string
  userUid?: string
  isHost: boolean
  sharedOpen?: boolean
  currentActivity: ActivityCode
}) {
  const [open, setOpen] = useState(false)
  const [previousShared, setPreviousShared] = useState<SharedState | null>(null)
  const shared = sharedOpen === true

  if (projectId && userUid && (
    previousShared?.projectId !== projectId
    || previousShared?.userUid !== userUid
    || previousShared?.open !== shared
  )) {
    setPreviousShared({ projectId, userUid, open: shared })
    if (!isHost) {
      if (!shared) setOpen(false)
      else if (currentActivity === 'Ds-1-2') setOpen(true)
    }
  }

  return [open, setOpen] as const
}

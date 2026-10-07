'use client'

import { UserMinus } from '@phosphor-icons/react'
import { MD3Button } from '@/components/ui/MD3Button'

export function MemberRemovalCard({ name, isHost, busy = false, error, state = 'pending', onRemove, onCancel }: {
  name: string; isHost: boolean; busy?: boolean; error?: string
  state?: 'pending' | 'removed' | 'cancelled'; onRemove: () => void; onCancel: () => void
}) {
  if (state !== 'pending') return (
    <div role="status" className="flex justify-center py-2" data-testid="member-removal-chip">
      <span className="rounded-full bg-[#E8F0FE] px-3 py-1 text-xs font-medium text-[#0842A0]">
        {state === 'removed' ? `${name} 선생님이 방에서 나갔어요` : `${name} 선생님 내보내기를 취소했어요`}
      </span>
    </div>
  )
  return (
    <section aria-label="팀원 내보내기 확인" className="my-3 rounded-2xl border border-[#DADCE0] bg-[#F8F9FA] p-4 text-sm text-[#202124]">
      <p className="flex items-center gap-2 font-semibold"><UserMinus size={18} className="shrink-0 text-[#0B57D0]" />{name} 선생님을 내보낼까요?</p>
      <p className="mt-2 text-[#5F6368]">남긴 대화와 산출물은 남아요. 초대코드로 다시 들어올 수 있어요.</p>
      {!isHost && <p className="mt-2 text-xs text-[#5F6368]">기록 담당이 확인하면 처리돼요.</p>}
      {error && <p role="alert" className="mt-2 text-[#C5221F]">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <MD3Button variant="text" tone="neutral" onClick={onCancel} disabled={!isHost || busy}>취소</MD3Button>
        <MD3Button variant="tonal" onClick={onRemove} disabled={!isHost || busy}>{busy ? '처리 중…' : '내보내기'}</MD3Button>
      </div>
    </section>
  )
}

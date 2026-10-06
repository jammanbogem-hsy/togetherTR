'use client'

// 채팅 '팀원 내보내기' 명령의 로컬 카드 — 방장 화면에만 보이고 Firestore 에 저장하지 않는다.
// confirm 은 MemberRemovalCard(members UI), 동명이인 선택·안내 문구는 여기서 그린다.
import { MemberRemovalCard } from '@/components/members/MemberRemovalCard'
import { memberCommandText, type MemberCommand, type MemberRef } from '@/lib/project/memberAdmin'

export type MemberCommandState = {
  command: MemberCommand
  state: 'pending' | 'removed' | 'cancelled'
  busy?: boolean
  error?: string
}

export function MemberCommandPanel({ value, isHost, onChoose, onRemove, onClose }: {
  value: MemberCommandState
  isHost: boolean
  onChoose: (target: MemberRef) => void
  onRemove: (target: MemberRef) => void
  onClose: () => void
}) {
  const { command } = value
  if (command.kind === 'none') return null
  if (command.kind === 'confirm') {
    return (
      <div className="px-4 py-2">
        <MemberRemovalCard
          name={command.target.displayName}
          isHost={isHost}
          busy={value.busy}
          error={value.error}
          state={value.state}
          onRemove={() => onRemove(command.target)}
          onCancel={onClose}
        />
      </div>
    )
  }
  return (
    <div role="status" className="mx-4 my-2 rounded-xl border border-[#DADCE0] bg-white px-4 py-3 text-[14px] text-[#202124]">
      <p>{memberCommandText(command)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {command.kind === 'choose' && command.candidates.map(candidate => (
          <button key={candidate.uid} type="button" onClick={() => onChoose(candidate)}
            className="rounded-full border border-[#DADCE0] px-3 py-1 text-[13px] font-bold hover:bg-[#F1F3F4]">
            {candidate.emoji ? `${candidate.emoji} ` : ''}{candidate.displayName}
          </button>
        ))}
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-[13px] text-[#5F6368] hover:bg-[#F1F3F4]">
          {command.kind === 'choose' ? '취소' : '닫기'}
        </button>
      </div>
    </div>
  )
}

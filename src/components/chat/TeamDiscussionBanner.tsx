'use client'

import { UsersThree, StopCircle } from '@phosphor-icons/react'

interface Props {
  topic: string
  onEnd: () => void
  isHost?: boolean
}

export function TeamDiscussionBanner({ topic, onEnd, isHost }: Props) {
  return (
    <div
      className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between gap-3 border-b border-[#80CBC4]"
      style={{ background: 'linear-gradient(90deg, #E0F2F1 0%, #F1F8F7 100%)' }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {/* 펄스 아이콘 */}
        <div
          className="w-7 h-7 bg-[#00897B] flex items-center justify-center flex-shrink-0"
          style={{ animation: 'morph-shape 7s ease-in-out infinite', boxShadow: '0 2px 8px rgba(0,137,123,0.4)' }}
        >
          <UsersThree size={14} weight="fill" className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00897B]"
              style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span className="text-[12px] font-bold text-[#004D40]">팀 자유 토의 중</span>
          </div>
          {topic && (
            <p className="text-[11px] text-[#00695C] truncate">주제: {topic}</p>
          )}
        </div>
      </div>

      {isHost ? (
        <button
          onClick={onEnd}
          title="팀 자유 토의를 종료하고 AI가 논의 내용을 분석합니다"
          className="morph-btn flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-extrabold text-white bg-[#E8710A] hover:bg-[#C75E00] ring-2 ring-white transition-colors"
          style={{ filter: 'drop-shadow(0 2px 10px rgba(232,113,10,0.45))' }}
        >
          <StopCircle size={16} weight="fill" />
          회의 종료 → AI 분석
        </button>
      ) : (
        <span className="text-[11px] text-[#00695C] flex-shrink-0">방장이 종료할 수 있어요</span>
      )}
    </div>
  )
}

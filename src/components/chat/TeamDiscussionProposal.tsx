'use client'

import { UsersThree } from '@phosphor-icons/react'

interface Props {
  topic: string
  onAccept: () => void
  onDecline: () => void
}

export function TeamDiscussionProposal({ topic, onAccept, onDecline }: Props) {
  return (
    <div className="mx-0 my-3 rounded-2xl overflow-hidden border border-[#80CBC4]"
      style={{ background: 'linear-gradient(135deg, #E0F2F1 0%, #F1F8F7 100%)' }}>

      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          className="w-10 h-10 bg-[#00897B] flex items-center justify-center flex-shrink-0"
          style={{ animation: 'morph-shape 8s ease-in-out infinite', boxShadow: '0 4px 14px rgba(0,137,123,0.38)' }}
        >
          <UsersThree size={18} weight="fill" className="text-white" />
        </div>
        <div>
          <p className="text-[14px] font-extrabold text-[#004D40]">팀 자유 토의를 시작할까요?</p>
          <p className="text-[11px] text-[#00695C]">지금은 AI 없이 팀원끼리 직접 대화하기 좋은 시점입니다</p>
        </div>
      </div>

      {/* 주제 태그 */}
      <div className="px-4 pb-3">
        <div className="inline-flex items-center gap-1.5 bg-white/70 border border-[#80CBC4] rounded-xl px-3 py-1.5">
          <span className="text-[11px] font-bold text-[#00695C] uppercase tracking-wide">주제</span>
          <span className="text-[12px] font-semibold text-[#004D40]">{topic}</span>
        </div>
        <p className="text-[11px] text-[#00897B] mt-2 flex items-center gap-1">
          <span>💡</span>
          <span>토의가 끝나면 AI가 대화 내용을 분석해 인사이트를 제공합니다</span>
        </p>
      </div>

      {/* 버튼 */}
      <div className="flex gap-2 px-4 pb-4">
        <button
          onClick={onAccept}
          className="morph-btn flex-1 py-2.5 bg-[#00897B] text-white text-[13px] font-bold hover:bg-[#00746a] transition-colors"
          style={{ filter: 'drop-shadow(0 3px 10px rgba(0,137,123,0.42))' }}
        >
          네, 시작할게요
        </button>
        <button
          onClick={onDecline}
          className="morph-btn px-5 py-2.5 bg-white border border-[#80CBC4] text-[#00695C] text-[13px] font-semibold hover:bg-[#E0F2F1] transition-colors"
        >
          나중에
        </button>
      </div>
    </div>
  )
}

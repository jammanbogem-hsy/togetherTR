'use client'

interface Props {
  topic: string
  onAccept: () => void
  onDecline: () => void
}

export function TeamDiscussionProposal({ topic, onAccept, onDecline }: Props) {
  return (
    <div className="mx-4 my-3 bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-[#00897B] flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-rounded msf text-white" style={{ fontSize: 18 }}>group</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-[#004D40] mb-1">팀 자유 토론을 시작할까요?</p>
          <p className="text-xs text-[#00695C] mb-3 leading-relaxed">
            지금은 AI 없이 팀원끼리 직접 대화하기 좋은 시점입니다.<br />
            <span className="font-semibold">주제: {topic}</span>
          </p>
          <p className="text-[11px] text-[#00695C] mb-3">
            토론이 끝나면 AI가 대화 내용을 분석해 인사이트를 제공합니다.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onAccept}
              className="flex-1 py-2 rounded-full bg-[#00897B] text-white text-sm font-bold hover:bg-[#00746a] transition-colors"
            >
              네, 시작할게요
            </button>
            <button
              onClick={onDecline}
              className="px-4 py-2 rounded-full border border-[#80CBC4] text-[#00695C] text-sm hover:bg-[#B2DFDB] transition-colors"
            >
              나중에
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

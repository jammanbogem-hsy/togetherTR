'use client'

interface Props {
  topic: string
  onEnd: () => void
  isHost?: boolean
}

export function TeamDiscussionBanner({ topic, onEnd, isHost }: Props) {
  return (
    <div className="flex-shrink-0 bg-[#E0F2F1] border-b border-[#80CBC4] px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#00897B] animate-pulse" />
        <span className="material-symbols-rounded msf ms-sm text-[#00695C]">group</span>
        <div>
          <span className="text-xs font-bold text-[#004D40]">팀 자유 토론 중</span>
          {topic && <span className="text-xs text-[#00695C] ml-2">주제: {topic}</span>}
        </div>
      </div>
      {isHost ? (
        <button
          onClick={onEnd}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors bg-[#00897B] text-white hover:bg-[#00746a]"
        >
          <span className="material-symbols-rounded msf ms-sm">stop_circle</span>
          종료 → AI 분석
        </button>
      ) : (
        <span className="text-xs text-[#00695C]">방장이 종료할 수 있어요</span>
      )}
    </div>
  )
}

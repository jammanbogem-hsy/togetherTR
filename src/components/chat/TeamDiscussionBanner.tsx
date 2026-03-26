'use client'

import { useProjectStore } from '@/store/project'
import { Users, StopCircle } from 'lucide-react'

interface Props {
  topic: string
  onEnd: () => void
  isHost?: boolean
}

export function TeamDiscussionBanner({ topic, onEnd, isHost }: Props) {
  return (
    <div className="flex-shrink-0 bg-teal-50 border-b-2 border-teal-300 px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
        <Users className="w-4 h-4 text-teal-700" />
        <div>
          <span className="text-xs font-bold text-teal-800">팀 자유 토론 중</span>
          {topic && <span className="text-xs text-teal-600 ml-2">주제: {topic}</span>}
        </div>
      </div>
      {isHost ? (
        <button
          onClick={onEnd}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-teal-500 text-white hover:bg-teal-600"
        >
          <StopCircle className="w-3.5 h-3.5" />
          종료 → AI 분석
        </button>
      ) : (
        <span className="text-xs text-teal-600">방장이 종료할 수 있어요</span>
      )}
    </div>
  )
}

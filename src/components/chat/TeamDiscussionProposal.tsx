'use client'

import { Users, X } from 'lucide-react'

interface Props {
  topic: string
  onAccept: () => void
  onDecline: () => void
}

export function TeamDiscussionProposal({ topic, onAccept, onDecline }: Props) {
  return (
    <div className="mx-4 my-3 bg-teal-50 border-2 border-teal-300 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
          <Users className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-teal-900 mb-1">팀 자유 토론을 시작할까요?</p>
          <p className="text-xs text-teal-700 mb-3 leading-relaxed">
            지금은 AI 없이 팀원끼리 직접 대화하기 좋은 시점입니다.<br />
            <span className="font-semibold">주제: {topic}</span>
          </p>
          <p className="text-[11px] text-teal-600 mb-3">
            토론이 끝나면 AI가 대화 내용을 분석해 인사이트를 제공합니다.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onAccept}
              className="flex-1 py-2 rounded-xl bg-teal-500 text-white text-sm font-bold
                         hover:bg-teal-600 transition-colors"
            >
              네, 시작할게요
            </button>
            <button
              onClick={onDecline}
              className="px-4 py-2 rounded-xl border border-teal-300 text-teal-700 text-sm
                         hover:bg-teal-100 transition-colors"
            >
              나중에
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

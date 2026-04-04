'use client'

import { useState } from 'react'
import { MagnifyingGlass, Lightbulb, MapTrifold, UsersThree } from '@phosphor-icons/react'

interface Props {
  message: string
  onSearchStandards: () => void
  onShowExample: () => void
  onShowGuide: () => void
  onStartTeamDiscussion: () => void
}

export function HelpCard({ message, onSearchStandards, onShowExample, onShowGuide, onStartTeamDiscussion }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="mx-0 my-3 rounded-2xl overflow-hidden border border-[#FFD54F]"
      style={{ background: 'linear-gradient(135deg, #FFFDE7 0%, #FFF9C4 100%)' }}>

      {/* 헤더 */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-2">
        <div
          className="w-9 h-9 bg-[#F9AB00] flex items-center justify-center flex-shrink-0 text-white text-base"
          style={{ animation: 'morph-shape 8s ease-in-out infinite', boxShadow: '0 3px 10px rgba(249,171,0,0.4)' }}
        >
          💛
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-extrabold text-[#E65100]">잠깐요!</p>
          <p className="text-[12px] text-[#795548] mt-0.5 leading-snug">{message}에 어려움을 겪고 계신 것 같습니다.<br />도움이 필요하시면 아래를 눌러주세요.</p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-[#9E9E9E] hover:text-[#616161] text-[14px] flex-shrink-0 mt-0.5"
        >✕</button>
      </div>

      {/* 버튼 그리드 */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-1">
        <button
          onClick={() => { onSearchStandards(); setDismissed(true) }}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-[#FFD54F] hover:bg-[#FFFDE7] transition-colors text-left"
        >
          <MagnifyingGlass size={16} weight="fill" className="text-[#1A73E8] flex-shrink-0" />
          <span className="text-[12px] font-semibold text-[#3C4043]">성취기준 찾기</span>
        </button>
        <button
          onClick={() => { onShowExample(); setDismissed(true) }}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-[#FFD54F] hover:bg-[#FFFDE7] transition-colors text-left"
        >
          <Lightbulb size={16} weight="fill" className="text-[#F9AB00] flex-shrink-0" />
          <span className="text-[12px] font-semibold text-[#3C4043]">예시 보기</span>
        </button>
        <button
          onClick={() => { onShowGuide(); setDismissed(true) }}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-[#FFD54F] hover:bg-[#FFFDE7] transition-colors text-left"
        >
          <MapTrifold size={16} weight="fill" className="text-[#00897B] flex-shrink-0" />
          <span className="text-[12px] font-semibold text-[#3C4043]">흐름 안내받기</span>
        </button>
        <button
          onClick={() => { onStartTeamDiscussion(); setDismissed(true) }}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-[#FFD54F] hover:bg-[#FFFDE7] transition-colors text-left"
        >
          <UsersThree size={16} weight="fill" className="text-[#7B1FA2] flex-shrink-0" />
          <span className="text-[12px] font-semibold text-[#3C4043]">팀 토론 하기</span>
        </button>
      </div>
    </div>
  )
}

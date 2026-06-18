'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  children: React.ReactNode
  onDelete?: () => void
}

// 산출물 전체를 감싸는 wrapper. 확대 보기·전체 삭제 버튼은 카드들 위 별도 헤더 막대에 둔다.
// children 위에 absolute로 띄우면 첫 번째 카드 헤더에 겹쳐 "그 카드만의 버튼"으로 오해를 일으킴.
export function ExpandableWrapper({ title, children, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <div className="space-y-2">
        {/* 산출물 전체 버튼 막대 — 카드 외부에 둬서 섹션별 버튼과 혼동되지 않도록 함 */}
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#DADCE0] bg-white hover:bg-[#E8F0FE] hover:border-[#1A73E8] px-2 py-1 text-[11px] font-bold text-[#5F6368] hover:text-[#1A73E8] transition-colors"
            title="이 산출물 전체를 크게 보기"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
            확대
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-[#DADCE0] bg-white hover:bg-[#FFEBEE] hover:border-[#C62828] px-2 py-1 text-[11px] font-bold text-[#9AA0A6] hover:text-[#C62828] transition-colors"
              title="산출물 전체를 삭제 (섹션별 부분 수정은 편집 모달에서)"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              전체 삭제
            </button>
          )}
        </div>
        {children}
      </div>

      {expanded && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden flex flex-col"
            style={{ maxWidth: 900, maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#DADCE0] bg-[#F8F9FA]">
              <span className="text-sm font-bold text-[#202124]">{title}</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-[#5F6368] hover:text-[#202124] text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

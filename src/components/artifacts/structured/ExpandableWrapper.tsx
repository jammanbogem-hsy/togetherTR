'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  children: React.ReactNode
  onDelete?: () => void
}

export function ExpandableWrapper({ title, children, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <div className="relative">
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button
            onClick={() => setExpanded(true)}
            className="w-8 h-8 rounded-lg bg-white hover:bg-[#E8F0FE] border border-[#DADCE0] hover:border-[#1A73E8] flex items-center justify-center transition-colors text-[#5F6368] hover:text-[#1A73E8]"
            title="확대 보기"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="w-8 h-8 rounded-lg bg-white hover:bg-[#FFEBEE] border border-[#DADCE0] hover:border-[#C62828] flex items-center justify-center transition-colors text-[#9AA0A6] hover:text-[#C62828]"
              title="산출물 삭제"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
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

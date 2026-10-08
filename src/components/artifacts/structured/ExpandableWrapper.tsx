'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsOut, Trash } from '@phosphor-icons/react'
import { MD3Button } from '@/components/ui/MD3Button'

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
        <div className="flex flex-wrap items-center justify-end gap-2" role="group" aria-label="산출물 전체 작업">
          <MD3Button
            onClick={() => setExpanded(true)}
            variant="tonal" tone="blue" size="sm" className="min-h-11 text-base"
            title="이 산출물 전체를 크게 보기" aria-label="산출물 확대 보기"
            icon={<ArrowsOut size={20} aria-hidden="true" />}
          >
            확대 보기
          </MD3Button>
          {onDelete && (
            <MD3Button
              onClick={onDelete}
              variant="outlined" tone="red" size="sm" className="min-h-11 text-base"
              title="산출물 전체 내용 삭제" aria-label="산출물 내용 전체 삭제"
              icon={<Trash size={20} aria-hidden="true" />}
            >
              내용 삭제
            </MD3Button>
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
                aria-label="확대 보기 닫기"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#E8EAED] text-2xl focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
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

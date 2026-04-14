'use client'

import { CaretLeft, CaretRight, CaretUp, CaretDown } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * Task #34: 패널 접기/펼치기 토글 버튼.
 * - direction: 현재 버튼이 가리키는 방향 (펼쳐진 상태에서 클릭 시 어느 쪽으로 접히는지 표시)
 *   - 'left' = 좌측으로 접힘 (사이드바 접기용 ‹)
 *   - 'right' = 우측으로 접힘 (산출물 접기용 ›, 또는 사이드바 펼치기 ›)
 *   - 'up' = 위로 접힘 (StageBar 접기용 ︿)
 *   - 'down' = 아래로 접힘/펼침 (StageBar 펼치기 ﹀)
 */
export function PanelToggle({
  direction,
  onClick,
  label,
  className,
}: {
  direction: 'left' | 'right' | 'up' | 'down'
  onClick: () => void
  label: string
  className?: string
}) {
  const Icon =
    direction === 'left' ? CaretLeft
    : direction === 'right' ? CaretRight
    : direction === 'up' ? CaretUp
    : CaretDown

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center w-6 h-6 rounded-md',
        'text-[#9AA0A6] hover:text-[#202124] hover:bg-[#F1F3F4]',
        'transition-colors duration-150',
        className,
      )}
    >
      <Icon size={14} weight="bold" />
    </button>
  )
}

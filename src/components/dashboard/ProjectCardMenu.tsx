'use client'

import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { EyeOff, Home, Trash2 } from 'lucide-react'

interface ProjectCardMenuProps {
  id: string
  title: string
  x: number
  y: number
  onClose: () => void
  onMoveToMain: () => void
  onDelete?: () => void
  onHide?: () => void
}

/** Portal keeps the menu outside the card's clipping/hover transform. */
export function ProjectCardMenu({ id, title, x, y, onClose, onMoveToMain, onDelete, onHide }: ProjectCardMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose })
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const close = () => closeRef.current()
    // A scroll or resize invalidates the original card/pointer position.
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [x, y])

  const select = (action: () => void) => { onClose(); action() }
  return createPortal(
    <div className="fixed inset-0 z-[220]" onPointerDown={e => { e.stopPropagation(); onClose() }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onClose() }}>
      <div
        ref={menuRef}
        id={id}
        role="menu"
        aria-label={`${title} 프로젝트 메뉴`}
        className="fixed w-64 max-w-[calc(100vw-16px)] rounded-xl border border-[#C4C7C5] bg-[#F0F4F9] p-2 text-[#1F1F1F] shadow-lg"
        style={{ left: x, top: y }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
          const current = items.indexOf(document.activeElement as HTMLButtonElement)
          if (e.key === 'Escape' || e.key === 'Tab') {
            if (e.key === 'Escape') e.preventDefault()
            e.stopPropagation(); onClose()
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault()
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next]?.focus()
          }
        }}
      >
        <p className="truncate px-3 py-2 text-sm font-medium text-[#444746]" title={title}>{title}</p>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onMoveToMain)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base font-medium hover:bg-[#D3E3FD] focus:bg-[#D3E3FD] focus:outline-none">
          <Home className="h-5 w-5 shrink-0" aria-hidden="true" /> 메인 화면으로 이동
        </button>
        {(onDelete || onHide) && <div role="separator" className="my-1 border-t border-[#C4C7C5]" />}
        {onDelete && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onDelete)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base text-[#8C1D18] hover:bg-[#FADCD9] focus:bg-[#FADCD9] focus:outline-none"><Trash2 className="h-5 w-5 shrink-0" aria-hidden="true" /> 프로젝트 삭제</button>}
        {onHide && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onHide)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base hover:bg-[#DDE3EA] focus:bg-[#DDE3EA] focus:outline-none"><EyeOff className="h-5 w-5 shrink-0" aria-hidden="true" /> 대시보드에서 숨기기</button>}
      </div>
    </div>, document.body,
  )
}

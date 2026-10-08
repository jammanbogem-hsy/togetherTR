'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

export const FINDER_CHIP = 'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]'
export const FINDER_ACTIVE = 'border-[#D3E3FD] bg-[#D3E3FD] text-[#0842A0]'
export const FINDER_INACTIVE = 'border-[#747775] bg-transparent text-[#444746] hover:bg-[#E1E9F3]'

export function CurriculumFinderDialog({ open, title, description, onClose, filters, children, footer }: {
  open: boolean; title: string; description: string; onClose: () => void
  filters: ReactNode; children: ReactNode; footer?: ReactNode
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-dialog-close]')?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0)
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey, true); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [open])
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-2 sm:p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex h-[94dvh] w-full max-w-[1600px] flex-col overflow-hidden rounded-[28px] bg-[#F8FAFD] text-[#1F1F1F] shadow-2xl" onClick={event => event.stopPropagation()}>
        <header className="flex shrink-0 items-start gap-3 border-b border-[#C4C7C5] px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1"><h2 id={titleId} className="text-xl font-semibold sm:text-2xl">{title}</h2><p className="mt-1 text-sm leading-relaxed text-[#444746] sm:text-base">{description}</p></div>
          <button data-dialog-close type="button" aria-label={`${title} 닫기`} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#E1E9F3] focus-visible:outline-2 focus-visible:outline-[#0B57D0]"><X size={24} /></button>
        </header>
        <div className="max-h-[38dvh] shrink-0 space-y-3 overflow-y-auto border-b border-[#C4C7C5] bg-[#F0F4F9] px-4 py-3 sm:px-6">{filters}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" data-finder-results>{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#C4C7C5] bg-[#F0F4F9] px-4 py-3 text-base sm:px-6">{footer}</footer>}
      </div>
    </div>, document.body,
  )
}

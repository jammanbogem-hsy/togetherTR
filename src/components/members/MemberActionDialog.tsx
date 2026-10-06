'use client'

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MD3Button } from '@/components/ui/MD3Button'

export function MemberActionDialog({ title, children, confirmLabel, busy, error, onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel: string; busy: boolean; error?: string
  onConfirm: () => void; onClose: () => void
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const current = useRef({ busy, onClose })
  useLayoutEffect(() => { current.current = { busy, onClose } }, [busy, onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!current.current.busy) current.current.onClose() }
      if (event.key !== 'Tab') return
      const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!buttons?.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} aria-busy={busy}
        className="max-h-[calc(100dvh-32px)] w-full max-w-md overflow-y-auto rounded-3xl bg-[#F8F9FA] p-5 text-[#202124] shadow-xl" onClick={event => event.stopPropagation()}>
        <h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>
        <div id={`${id}-body`} className="mt-3 space-y-2 text-sm leading-relaxed text-[#3C4043]">{children}</div>
        {error && <p role="alert" className="mt-3 text-sm text-[#C5221F]">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <MD3Button ref={cancelRef} variant="text" tone="neutral" onClick={onClose} disabled={busy}>취소</MD3Button>
          <MD3Button variant="filled" onClick={onConfirm} disabled={busy}>{busy ? '처리 중…' : confirmLabel}</MD3Button>
        </div>
      </div>
    </div>, document.body,
  )
}

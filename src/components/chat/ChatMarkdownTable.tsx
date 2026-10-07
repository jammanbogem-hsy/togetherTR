'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Keep comparison semantics and readable cells; only the table scrolls on a narrow screen. */
export function ChatMarkdownTable({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const hintId = useId()
  const titleId = useId()
  useEffect(() => {
    if (!expanded) return
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [expanded])
  useEffect(() => {
    const viewport = ref.current
    if (!viewport) return
    const check = () => setOverflow(viewport.scrollWidth > viewport.clientWidth + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => observer.disconnect()
  }, [children])
  return <div className="my-2 min-w-0 max-w-full">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
      <p id={hintId} className="text-xs text-[#5F6368]">{overflow ? '좌우로 넘기거나 표를 눌러 크게 확인하세요.' : '표를 누르면 크게 볼 수 있어요.'}</p>
      <button type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)}
        className="shrink-0 rounded-full border border-[#AECBFA] bg-white px-3 py-1.5 text-xs font-semibold text-[#1557B0] hover:bg-[#E8F0FE] focus-visible:outline-2 focus-visible:outline-[#1A73E8]">표 크게 보기</button>
    </div>
    <div ref={ref} role="region" aria-label="비교 표" aria-describedby={overflow ? hintId : undefined} tabIndex={overflow ? 0 : undefined}
      onClick={event => {
        if (!(event.target instanceof Element) || event.target.closest('button,input,label,textarea,select,a,[data-testid="checker-badge"]')) return
        if (window.getSelection()?.toString()) return
        setExpanded(true)
      }}
      className="max-h-[min(28rem,55vh)] max-w-full cursor-zoom-in overflow-auto rounded-xl border border-[#DADCE0] focus-visible:outline-2 focus-visible:outline-[#1A73E8]" style={{ overscrollBehaviorX: 'contain' }}>
      <table className="w-full table-auto border-collapse text-sm">{children}</table>
    </div>
    {expanded && createPortal(<dialog ref={dialogRef} aria-labelledby={titleId} onClose={() => setExpanded(false)}
      onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close() }}
      className="fixed inset-0 m-auto w-[96vw] max-w-[1600px] max-h-[92dvh] rounded-2xl border border-[#DADCE0] bg-white p-0 text-[#202124] shadow-2xl backdrop:bg-black/50">
      <div className="flex max-h-[90dvh] flex-col" onClick={event => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#DADCE0] px-4 py-3">
          <div><h2 id={titleId} className="text-lg font-semibold">표 전체 보기</h2><p className="text-sm text-[#5F6368]">표 안에서 좌우·위아래로 이동할 수 있어요.</p></div>
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="표 전체 보기 닫기"
            className="rounded-full px-4 py-2 text-base font-semibold text-[#1557B0] hover:bg-[#E8F0FE]">닫기</button>
        </header>
        <div role="region" aria-label="확대한 표" tabIndex={0} className="min-h-0 overflow-auto p-3 focus-visible:outline-2 focus-visible:outline-[#1A73E8]">
          <table className="w-full table-auto border-collapse [&_td]:text-base [&_th]:text-sm [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">{children}</table>
        </div>
      </div>
    </dialog>, document.body)}
  </div>
}

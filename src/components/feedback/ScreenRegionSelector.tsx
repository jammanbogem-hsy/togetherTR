'use client'

// 화면 캡처 영역 고르기 — 지금 보고 있는 화면 위에서 바로 끌어 영역을 고른다(캡처 도구처럼).
// 끌기를 놓는 순간 그 영역이 찍힌다. 끌지 않고 '화면 전체'를 누르면 화면 전체.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { FrameCorners, X } from '@phosphor-icons/react'
import { isUsableCrop, normalizeCrop, type CropRect } from '@/lib/feedback/screenCapture'

interface Props {
  /** Region in viewport CSS px, or null for the whole screen. */
  onSelect: (region: CropRect | null) => void
  onCancel: () => void
}

export function ScreenRegionSelector({ onSelect, onCancel }: Props) {
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const [selection, setSelection] = useState<CropRect | null>(null)
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-capture-toolbar]')) return
    const point = { x: event.clientX, y: event.clientY }
    start.current = { ...point, pointerId: event.pointerId }
    setSelection(normalizeCrop(point, point, viewport()))
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = start.current
    if (!origin || origin.pointerId !== event.pointerId) return
    setSelection(normalizeCrop(origin, { x: event.clientX, y: event.clientY }, viewport()))
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = start.current
    if (!origin || origin.pointerId !== event.pointerId) return
    start.current = null
    const region = normalizeCrop(origin, { x: event.clientX, y: event.clientY }, viewport())
    // A plain click (no real drag) is ignored so a stray tap doesn't capture a sliver.
    if (isUsableCrop(region)) onSelect(region)
    else setSelection(null)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      if (event.key === 'Enter') { event.preventDefault(); onSelect(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, onSelect])

  const dragging = !!selection && selection.width > 0
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="캡처할 영역 고르기"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { start.current = null; setSelection(null) }}
      className={`fixed inset-0 z-[120] cursor-crosshair touch-none select-none ${dragging ? '' : 'bg-black/30'}`}>
      {dragging && (
        <div aria-hidden="true" className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.3)] outline outline-1 outline-[#0B57D0]"
          style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />
      )}
      {!dragging && (
        <div data-capture-toolbar className="absolute left-1/2 top-4 flex -translate-x-1/2 cursor-default items-center gap-2 rounded-full bg-[#1F1F1F]/90 py-1.5 pl-5 pr-1.5 text-[14px] text-white shadow-lg">
          <span className="whitespace-nowrap">끌어서 캡처할 영역을 고르세요</span>
          <button type="button" onClick={() => onSelect(null)} className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#D3E3FD] px-3.5 font-semibold text-[#0842A0] hover:bg-[#C2D7F8]">
            <FrameCorners size={16} aria-hidden="true" /> 화면 전체
          </button>
          <button type="button" onClick={onCancel} aria-label="캡처 취소" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>, document.body,
  )
}

'use client'

// 화면 캡처 직후 보낼 부분을 끌어서 고르는 화면. 고르지 않으면 화면 전체를 넣는다.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Crop, FrameCorners, X } from '@phosphor-icons/react'
import { cropToSource, isUsableCrop, normalizeCrop, type CropRect } from '@/lib/feedback/screenCapture'

interface Props {
  src: string
  onConfirm: (crop: CropRect | null) => void
  onCancel: () => void
}

export function CaptureCropper({ src, onConfirm, onCancel }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const wholeRef = useRef<HTMLButtonElement>(null)
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const [selection, setSelection] = useState<CropRect | null>(null)
  const usable = isUsableCrop(selection)

  function localPoint(event: ReactPointerEvent) {
    const rect = imgRef.current!.getBoundingClientRect()
    return { point: { x: event.clientX - rect.left, y: event.clientY - rect.top }, bounds: { width: rect.width, height: rect.height } }
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const { point, bounds } = localPoint(event)
    dragStart.current = { ...point, pointerId: event.pointerId }
    setSelection(normalizeCrop(point, point, bounds))
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    if (!start || start.pointerId !== event.pointerId) return
    const { point, bounds } = localPoint(event)
    setSelection(normalizeCrop(start, point, bounds))
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStart.current?.pointerId !== event.pointerId) return
    dragStart.current = null
    setSelection(current => isUsableCrop(current) ? current : null)
  }

  function confirmSelection() {
    const img = imgRef.current
    if (!img || !isUsableCrop(selection)) return
    const rect = img.getBoundingClientRect()
    onConfirm(cropToSource(selection, { width: rect.width, height: rect.height }, { width: img.naturalWidth, height: img.naturalHeight }))
  }

  useEffect(() => {
    wholeRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="capture-crop-title" className="fixed inset-0 z-[120] flex flex-col bg-[#1F1F1F]/90 text-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h2 id="capture-crop-title" className="mr-auto text-[16px] font-semibold">보낼 부분을 끌어서 고르세요 <span className="font-normal text-white/70">· 고르지 않으면 화면 전체</span></h2>
        <button type="button" onClick={onCancel} className="flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-white hover:bg-white/10">
          <X size={16} aria-hidden="true" /> 취소
        </button>
        <button ref={wholeRef} type="button" onClick={() => onConfirm(null)} className="flex h-10 items-center gap-1.5 rounded-full border border-white/40 px-4 text-[14px] font-semibold text-white hover:bg-white/10">
          <FrameCorners size={16} aria-hidden="true" /> 화면 전체 넣기
        </button>
        <button type="button" onClick={confirmSelection} disabled={!usable} className="flex h-10 items-center gap-1.5 rounded-full bg-[#D3E3FD] px-4 text-[14px] font-semibold text-[#0842A0] hover:bg-[#C2D7F8] disabled:opacity-40">
          <Crop size={16} aria-hidden="true" /> 고른 부분 넣기
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
        <div className="relative inline-block max-h-full max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded-lg"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragStart.current = null }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 방금 찍은 화면(blob URL) 미리보기 */}
          <img ref={imgRef} src={src} alt="방금 캡처한 화면" draggable={false} className="block max-h-[calc(100dvh-96px)] max-w-full object-contain" />
          {selection && selection.width > 0 && (
            <div aria-hidden="true" className="pointer-events-none absolute border-2 border-[#A8C7FA] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />
          )}
        </div>
      </div>
    </div>, document.body,
  )
}

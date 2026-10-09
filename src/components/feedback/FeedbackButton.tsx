'use client'

// 화면 오른쪽 아래 피드백 버튼 — 글과 오류 화면(붙여넣기·끌어 놓기·파일)을 보내면 관리자 메일·피드백함으로 간다.
// 현재 화면 위치(주소·프로젝트·활동)와 최근 오류 기록을 함께 담는다.
// '화면 캡처'는 별도 캡처 프로그램 없이, 지금 화면 위에서 바로 끌어 고른 영역을 브라우저 탭 공유로 찍어 넣는다.
// 평소엔 작은 말풍선, hover/focus 때 글자가 펼쳐지고, 끌어서 옮길 수 있다(위치는 이 브라우저에 기억).
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Camera, ChatCircleText, ImageSquare, PaperPlaneRight, Trash, X } from '@phosphor-icons/react'
import { auth } from '@/lib/firebase/config'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, displayActivityCode } from '@/types'
import { FEEDBACK_LIMITS } from '@/lib/feedback/feedbackModel'
import { installClientErrorLog, recentClientErrors } from '@/lib/feedback/errorLog'
import { cn } from '@/lib/utils'
import { canCaptureScreen, captureErrorMessage, cropImageBlob, openTabStream, viewportRegionToFrame, type CropRect, type TabStream } from '@/lib/feedback/screenCapture'
import { ScreenRegionSelector } from './ScreenRegionSelector'
import {
  LAUNCHER_SIZE, LAUNCHER_STORAGE_KEY, clampLauncherPosition, exceededDragThreshold, expandsLeftward,
  launcherStyle, parseStoredLauncherPosition, type LauncherPoint, type Viewport,
} from './launcherPosition'

/** 캡처를 긴 변 1600px·JPEG 로 줄여 data URL 로 — 서버 한도(약 600KB) 안에 들 때까지 품질을 낮춘다. */
async function compressImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
  let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', attempt < 2 ? 0.82 : 0.7)
    if (dataUrl.length <= FEEDBACK_LIMITS.imageDataUrlMax) return dataUrl
    scale *= 0.75
  }
  throw new Error('too-large')
  } finally { bitmap.close() }
}

export function FeedbackButton() {
  const pathname = usePathname() ?? '/'
  const project = useProjectStore(state => state.project)
  const currentActivity = useProjectStore(state => state.currentActivity)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const inFlight = useRef(false)
  const processing = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // 화면 캡처 중에는 피드백 창과 말풍선을 숨겨 찍히지 않게 하고, 화면 위에 영역 고르기 층을 띄운다.
  const [capturing, setCapturing] = useState(false)
  const [selectingRegion, setSelectingRegion] = useState(false)
  const tabStreamRef = useRef<TabStream | null>(null)
  const [captureSupported, setCaptureSupported] = useState(false)
  const locked = busy || preparing || capturing
  function close() {
    if (inFlight.current || processing.current) return
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    installClientErrorLog()
    const frame = requestAnimationFrame(() => setCaptureSupported(canCaptureScreen()))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => () => { tabStreamRef.current?.stop() }, [])

  // ─── 끌어서 옮기기 ───
  // placed 가 null 이면 기본 자리(오른쪽 아래, 프로젝트 화면 넓은 폭은 오른쪽 가운데). 옮긴 자리는 접힌 원의 왼쪽 위 좌표.
  const [placed, setPlaced] = useState<LauncherPoint | null>(null)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; start: LauncherPoint; origin: LauncherPoint; before: LauncherPoint | null; last: LauncherPoint | null; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const vp = { width: window.innerWidth, height: window.innerHeight }
      setViewport(vp)
      let stored: LauncherPoint | null = null
      try { stored = parseStoredLauncherPosition(window.localStorage.getItem(LAUNCHER_STORAGE_KEY)) } catch { /* storage blocked */ }
      if (stored) setPlaced(clampLauncherPosition(stored, vp))
    })
    // 창 크기가 바뀌면 화면 안으로 되돌린다(저장값은 그대로 두어 다시 커지면 원래 자리).
    function onResize() {
      const vp = { width: window.innerWidth, height: window.innerHeight }
      setViewport(vp)
      setPlaced(current => current && clampLauncherPosition(current, vp))
    }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize) }
  }, [])
  useEffect(() => {
    if (!dragging) return
    // 끄는 동안 페이지 글자가 선택되지 않게.
    const root = document.documentElement
    const previous = root.style.userSelect
    root.style.userSelect = 'none'
    return () => { root.style.userSelect = previous }
  }, [dragging])

  function onLauncherPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const vp = { width: window.innerWidth, height: window.innerHeight }
    const leftward = placed ? expandsLeftward(placed, vp) : true
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: leftward ? rect.right - LAUNCHER_SIZE : rect.left, y: rect.top },
      before: placed, last: null, moved: false,
    }
    // 빠르게 끌어도 버튼 밖으로 놓치지 않게 누르는 순간부터 포인터를 잡는다(click 은 그대로 버튼에서 난다).
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
  }
  function onLauncherPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const current = { x: event.clientX, y: event.clientY }
    if (!drag.moved) {
      if (!exceededDragThreshold(drag.start, current)) return
      drag.moved = true
      setDragging(true)
    }
    event.preventDefault()
    const vp = { width: window.innerWidth, height: window.innerHeight }
    drag.last = clampLauncherPosition({ x: drag.origin.x + current.x - drag.start.x, y: drag.origin.y + current.y - drag.start.y }, vp)
    setViewport(vp)
    setPlaced(drag.last)
  }
  function endLauncherDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    if (!drag.moved) return
    setDragging(false)
    if (cancelled) { setPlaced(drag.before); return }
    // 키보드로 돌아온 포커스(focus-visible)가 남아 있으면 옮긴 뒤에도 펼쳐진 채라 놓아 준다.
    event.currentTarget.blur()
    // 끌기가 끝난 직후 따라오는 click 은 창을 열지 않는다.
    suppressClickRef.current = true
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
    if (drag.last) {
      try { window.localStorage.setItem(LAUNCHER_STORAGE_KEY, JSON.stringify(drag.last)) } catch { /* storage blocked */ }
    }
  }
  function resetLauncherPosition() {
    setPlaced(null)
    try { window.localStorage.removeItem(LAUNCHER_STORAGE_KEY) } catch { /* storage blocked */ }
  }
  const leftward = placed && viewport ? expandsLeftward(placed, viewport) : true
  const dialogShown = open && !capturing
  useEffect(() => {
    if (!dialogShown) return
    const dialog = dialogRef.current
    dialog?.showModal()
    textRef.current?.focus()
    return () => { dialog?.close() }
  }, [dialogShown])

  const inProject = /^\/projects\/(?!new|join)[^/]+/.test(pathname)
  const projectId = inProject ? pathname.split('/')[2] : undefined
  const activityCode = inProject && project?.id === projectId ? currentActivity : undefined
  const whereText = [project && project.id === projectId ? project.title : null, activityCode ? `${displayActivityCode(activityCode)} ${ACTIVITY_META[activityCode]?.label ?? ''}`.trim() : null].filter(Boolean).join(' · ') || pathname

  async function addFiles(files: Iterable<File>) {
    if (inFlight.current || processing.current) return
    const list = [...files].filter(file => file.type.startsWith('image/'))
    if (!list.length) return
    setNotice(null)
    const room = FEEDBACK_LIMITS.imagesMax - images.length
    if (room <= 0) { setNotice({ tone: 'error', text: `캡처는 ${FEEDBACK_LIMITS.imagesMax}장까지 붙일 수 있어요.` }); return }
    processing.current = true; setPreparing(true)
    const added: string[] = []
    for (const file of list.slice(0, room)) {
      try { added.push(await compressImage(file)) } catch { setNotice({ tone: 'error', text: '캡처가 너무 커요. 화면 일부만 잘라 붙여 주세요.' }) }
    }
    setImages(current => [...current, ...added].slice(0, FEEDBACK_LIMITS.imagesMax))
    processing.current = false; setPreparing(false)
  }

  async function startScreenCapture() {
    if (inFlight.current || processing.current || capturing) return
    if (images.length >= FEEDBACK_LIMITS.imagesMax) { setNotice({ tone: 'error', text: `캡처는 ${FEEDBACK_LIMITS.imagesMax}장까지 붙일 수 있어요.` }); return }
    setNotice(null)
    setCapturing(true)
    try {
      // 탭 공유 허락(브라우저가 한 번 묻는다) → 화면 위에서 영역을 끌어 고른다.
      const stream = await openTabStream()
      tabStreamRef.current = stream
      stream.onEnded(() => { if (tabStreamRef.current === stream) cancelScreenCapture() })
      setSelectingRegion(true)
    } catch (error) {
      setCapturing(false)
      setNotice({ tone: 'error', text: captureErrorMessage(error) })
    }
  }
  function cancelScreenCapture() {
    tabStreamRef.current?.stop()
    tabStreamRef.current = null
    setSelectingRegion(false)
    setCapturing(false)
  }
  async function captureRegion(region: CropRect | null) {
    const stream = tabStreamRef.current
    setSelectingRegion(false)
    if (!stream) { setCapturing(false); return }
    try {
      // grab 은 고르기 층이 사라진 화면이 다시 그려진 뒤의 장면을 찍는다.
      const frame = await stream.grab()
      tabStreamRef.current = null
      stream.stop()
      const bitmap = await createImageBitmap(frame)
      const frameSize = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      const crop = region ? viewportRegionToFrame(region, { width: window.innerWidth, height: window.innerHeight }, frameSize) : null
      const blob = await cropImageBlob(frame, crop)
      setCapturing(false)
      await addFiles([new File([blob], `screen-${Date.now()}.png`, { type: 'image/png' })])
    } catch (error) {
      cancelScreenCapture()
      setNotice({ tone: 'error', text: captureErrorMessage(error) })
    }
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file)
    if (files.length) { event.preventDefault(); void addFiles(files) }
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    void addFiles(event.dataTransfer.files)
  }

  async function submit() {
    if (inFlight.current || processing.current) return
    if (!message.trim() && !images.length) { setNotice({ tone: 'error', text: '내용을 적거나 오류 화면을 붙여 넣어 주세요.' }); return }
    inFlight.current = true; setBusy(true); setNotice(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('로그인이 필요해요.')
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message, images, recentErrors: recentClientErrors(),
          context: {
            path: pathname, projectId, projectTitle: project && project.id === projectId ? project.title : undefined,
            activityCode, activityLabel: activityCode ? ACTIVITY_META[activityCode]?.label : undefined,
          },
        }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? '보내지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      setMessage(''); setImages([])
      setNotice({ tone: 'ok', text: '피드백함에 접수했습니다. 보내 주셔서 감사합니다.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '보내지 못했어요.' })
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <>
    {/* Compact 44px bubble; the label slides out on hover/keyboard focus toward the roomier side.
        Drag (mouse/touch/pen) past a small threshold to move it; a drag never opens the dialog. */}
    <button ref={triggerRef} type="button" aria-label="피드백 보내기" aria-haspopup="dialog" title="피드백 보내기 · 끌어서 옮길 수 있어요"
      onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return } setNotice(null); setOpen(true) }}
      onPointerDown={onLauncherPointerDown} onPointerMove={onLauncherPointerMove}
      onPointerUp={event => endLauncherDrag(event, false)} onPointerCancel={event => endLauncherDrag(event, true)}
      onDragStart={event => event.preventDefault()}
      data-dragging={dragging || undefined}
      style={placed && viewport ? launcherStyle(placed, viewport) : undefined}
      className={cn('fixed z-[90] flex h-[44px] w-[44px] touch-none select-none items-center overflow-hidden rounded-full bg-[var(--md-sys-primary-container)] text-[14px] font-semibold text-[var(--md-sys-on-primary-container)] shadow-[0_2px_8px_rgba(0,0,0,0.16)] transition-[width,box-shadow] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--md-sys-primary)] motion-reduce:transition-none',
        leftward && 'flex-row-reverse',
        capturing && 'invisible',
        dragging ? 'cursor-grabbing shadow-lg' : 'cursor-pointer hover:w-[168px] hover:shadow-md focus-visible:w-[168px]',
        // Default spot: bottom-right. On project screens that corner holds the composer (mobile) and the
        // artifact footer actions (desktop: confirm/delete), so there it sits above the composer / at mid-height.
        !placed && (inProject ? 'bottom-28 right-3 lg:bottom-auto lg:top-[calc(50%-22px)]' : 'bottom-3 right-3'))}>
      <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center" aria-hidden="true"><ChatCircleText size={22} weight="fill" /></span>
      <span aria-hidden="true" className={cn('shrink-0 whitespace-nowrap', leftward ? 'pl-4' : 'pr-4')}>피드백 보내기</span>
    </button>
    {selectingRegion && <ScreenRegionSelector onSelect={region => { void captureRegion(region) }} onCancel={cancelScreenCapture} />}
    {dialogShown && typeof document !== 'undefined' && createPortal(
      <dialog ref={dialogRef} aria-labelledby="feedback-title" onCancel={event => { event.preventDefault(); close() }}
        onClick={event => { if (event.target === event.currentTarget) close() }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] max-w-lg overflow-y-auto rounded-[28px] border-0 bg-[#F8FAFD] p-0 text-[#1F1F1F] shadow-xl backdrop:bg-black/40">
        <div onClick={event => event.stopPropagation()} onPaste={onPaste}
          onDragOver={event => event.preventDefault()} onDrop={onDrop}
          className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <h2 id="feedback-title" className="flex-1 text-[22px] font-semibold leading-7">피드백 보내기</h2>
            <button type="button" onClick={close} disabled={locked} aria-label="닫기" className="rounded-full p-2 text-[#444746] hover:bg-black/5"><X size={20} /></button>
          </div>
          <p className="mt-1 text-[14px] text-[#444746]">오류나 불편한 점을 적고, 오류 화면은 {captureSupported ? '‘화면 캡처’로 바로 찍거나 ' : ''}캡처해서 붙여 넣어 주세요(Ctrl+V · 끌어 놓기).</p>
          <textarea aria-label="피드백 내용" disabled={locked} ref={textRef} value={message} onChange={event => setMessage(event.target.value)} maxLength={FEEDBACK_LIMITS.messageMax} rows={5}
            placeholder="예: A-4에서 저장을 눌렀는데 표가 사라졌어요."
            className="mt-4 w-full resize-y rounded-xl border border-[#C4C7C5] bg-white px-4 py-3 text-[15px] leading-6 outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/20" />
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((src, index) => (
              <div key={index} className="relative h-20 w-28 overflow-hidden rounded-lg border border-[#C4C7C5] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element -- 붙여 넣은 캡처 미리보기(data URL) */}
                <img src={src} alt={`캡처 ${index + 1}`} className="h-full w-full object-cover" />
                <button type="button" disabled={locked} onClick={() => setImages(current => current.filter((_, i) => i !== index))} aria-label={`캡처 ${index + 1} 빼기`}
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-[#B3261E]"><Trash size={14} /></button>
              </div>
            ))}
            {images.length < FEEDBACK_LIMITS.imagesMax && captureSupported && (
              <button type="button" disabled={locked} onClick={() => { void startScreenCapture() }} className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-[#0B57D0]/40 bg-[#D3E3FD]/50 text-[12px] font-semibold text-[#0842A0] hover:bg-[#D3E3FD]">
                <Camera size={20} aria-hidden="true" /> 화면 캡처
              </button>
            )}
            {images.length < FEEDBACK_LIMITS.imagesMax && (
              <button type="button" disabled={locked} onClick={() => fileRef.current?.click()} className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#747775] text-[12px] text-[#444746] hover:bg-black/5">
                <ImageSquare size={20} aria-hidden="true" /> 파일 추가
              </button>
            )}
            <input ref={fileRef} disabled={locked} type="file" accept="image/*" multiple hidden onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = '' }} />
          </div>
          <p className="mt-3 text-[12px] text-[#444746]">함께 보내는 정보: 지금 화면({whereText}) · 최근 오류 기록 {recentClientErrors().length}건</p>
          {preparing && <p role="status" className="mt-3 text-sm text-[#444746]">캡처를 준비하고 있습니다.</p>}
          {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('mt-3 text-[14px]', notice.tone === 'error' ? 'text-[#B3261E]' : 'text-[#146C2E]')}>{notice.text}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Link href="/feedback" aria-disabled={locked} onClick={event => { if (locked) event.preventDefault(); else close() }} className="mr-auto inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-[#0842A0] underline">관리자 피드백함</Link>
            {placed && <button type="button" onClick={resetLauncherPosition} className="h-11 rounded-full px-3 text-[13px] text-[#444746] hover:bg-black/5">버튼 위치 처음으로</button>}
            <button type="button" onClick={close} disabled={locked} className="h-11 rounded-full px-4 text-[14px] font-semibold text-[#0B57D0] hover:bg-[#0B57D0]/10">닫기</button>
            <button type="button" onClick={() => { void submit() }} disabled={locked}
              className="flex h-11 items-center gap-2 rounded-full bg-[#0B57D0] px-6 text-[14px] font-semibold text-white hover:bg-[#0842A0] disabled:opacity-60">
              <PaperPlaneRight size={16} weight="fill" aria-hidden="true" />{busy ? '보내는 중…' : '보내기'}
            </button>
          </div>
        </div>
      </dialog>, document.body,
    )}
  </>
}

'use client'

// 화면 오른쪽 아래 피드백 버튼 — 글과 오류 화면(붙여넣기·끌어 놓기·파일)을 보내면 관리자 메일·피드백함으로 간다.
// 현재 화면 위치(주소·프로젝트·활동)와 최근 오류 기록을 함께 담는다.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChatCircleText, ImageSquare, PaperPlaneRight, Trash, X } from '@phosphor-icons/react'
import { auth } from '@/lib/firebase/config'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, displayActivityCode } from '@/types'
import { FEEDBACK_LIMITS } from '@/lib/feedback/feedbackModel'
import { installClientErrorLog, recentClientErrors } from '@/lib/feedback/errorLog'
import { cn } from '@/lib/utils'

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
  const locked = busy || preparing
  function close() {
    if (inFlight.current || processing.current) return
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { installClientErrorLog() }, [])
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    dialog?.showModal()
    textRef.current?.focus()
    return () => { dialog?.close() }
  }, [open])

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
    <button ref={triggerRef} type="button" onClick={() => { setNotice(null); setOpen(true) }} aria-label="피드백 보내기" title="오류·불편 신고"
      className={cn('fixed right-4 z-[90] flex h-14 items-center gap-2 rounded-2xl bg-[#D3E3FD] pl-4 pr-5 text-[15px] font-semibold text-[#0842A0] shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#C2D7F8]',
        inProject ? 'bottom-28 lg:bottom-4' : 'bottom-4')}>
      <ChatCircleText size={22} weight="fill" aria-hidden="true" />
      <span>피드백 보내기</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(
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
          <p className="mt-1 text-[14px] text-[#444746]">오류나 불편한 점을 적고, 오류 화면은 캡처해서 여기에 붙여 넣어 주세요(Ctrl+V · 끌어 놓기).</p>
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
            {images.length < FEEDBACK_LIMITS.imagesMax && (
              <button type="button" disabled={locked} onClick={() => fileRef.current?.click()} className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#747775] text-[12px] text-[#444746] hover:bg-black/5">
                <ImageSquare size={20} aria-hidden="true" /> 캡처 추가
              </button>
            )}
            <input ref={fileRef} disabled={locked} type="file" accept="image/*" multiple hidden onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = '' }} />
          </div>
          <p className="mt-3 text-[12px] text-[#444746]">함께 보내는 정보: 지금 화면({whereText}) · 최근 오류 기록 {recentClientErrors().length}건</p>
          {preparing && <p role="status" className="mt-3 text-sm text-[#444746]">캡처를 준비하고 있습니다.</p>}
          {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('mt-3 text-[14px]', notice.tone === 'error' ? 'text-[#B3261E]' : 'text-[#146C2E]')}>{notice.text}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Link href="/feedback" aria-disabled={locked} onClick={event => { if (locked) event.preventDefault(); else close() }} className="mr-auto inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-[#0842A0] underline">관리자 피드백함</Link>
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

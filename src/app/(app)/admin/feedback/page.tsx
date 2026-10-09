'use client'

// 관리자 피드백함 — 관리자 계정(기본 jammanbogem@gmail.com, FEEDBACK_ADMIN_EMAILS)만 서버가 목록을 준다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowsClockwise } from '@phosphor-icons/react'
import { auth } from '@/lib/firebase/config'
import type { FeedbackContext, FeedbackStatus } from '@/lib/feedback/feedbackModel'
import { cn } from '@/lib/utils'

type FeedbackItem = {
  id: string; message: string; senderName?: string | null; senderEmail?: string | null; createdAtMs?: number
  context?: FeedbackContext; recentErrors?: string[]; imageCount?: number; status?: FeedbackStatus; emailed?: boolean; emailError?: string
}
const STATUS: Record<FeedbackStatus, { label: string; className: string }> = {
  new: { label: '새로 옴', className: 'bg-[#FFDAD6] text-[#410002]' },
  in_progress: { label: '처리 중', className: 'bg-[#FFE7C7] text-[#8A3D00]' },
  done: { label: '완료', className: 'bg-[#C4EED0] text-[#072711]' },
}

async function call(path: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken()
  const response = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((body as { error?: string }).error ?? '불러오지 못했어요.')
  return body
}

export default function FeedbackInboxPage() {
  const router = useRouter()
  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const statusInFlight = useRef(false)
  const [selected, setSelected] = useState<(FeedbackItem & { images?: string[] }) | null>(null)

  const load = useCallback(async (cursor?: string) => {
    const request = ++listRequest.current
    setError(''); setLoading(true)
    try {
      const page = await call(`/api/feedback${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`) as { items: FeedbackItem[]; nextCursor?: string }
      if (request !== listRequest.current) return
      setItems(current => cursor ? [...(current ?? []), ...page.items.filter(item => !current?.some(existing => existing.id === item.id))] : page.items)
      setNextCursor(page.nextCursor ?? null)
    } catch (cause) {
      if (request === listRequest.current) setError(cause instanceof Error ? cause.message : '불러오지 못했어요.')
    } finally { if (request === listRequest.current) setLoading(false) }
  }, [])
  useEffect(() => {
    const requests = listRequest
    const details = detailRequest
    void load()
    return () => { requests.current++; details.current++ }
  }, [load])

  async function open(item: FeedbackItem) {
    const request = ++detailRequest.current
    setSelected(item); setError(''); setNotice(''); setDetailLoading(true)
    try {
      const detail = await call(`/api/feedback?id=${encodeURIComponent(item.id)}`)
      if (request === detailRequest.current) setSelected(detail)
    } catch {
      if (request === detailRequest.current) setError('피드백 상세 내용을 불러오지 못했습니다. 카드를 다시 눌러 주세요.')
    } finally { if (request === detailRequest.current) setDetailLoading(false) }
  }
  async function setStatus(id: string, status: FeedbackStatus) {
    if (statusInFlight.current) return
    statusInFlight.current = true; setStatusBusy(true); setError(''); setNotice('')
    try {
      await call('/api/feedback', { method: 'PATCH', body: JSON.stringify({ id, status }) })
      setItems(current => current?.map(item => item.id === id ? { ...item, status } : item) ?? null)
      setSelected(current => current && current.id === id ? { ...current, status } : current)
      setNotice('처리 상태를 저장했습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '처리 상태를 저장하지 못했습니다.') }
    finally { statusInFlight.current = false; setStatusBusy(false) }
  }

  return (
    <main className="min-h-dvh bg-[#F8FAFD] px-4 py-6 text-[#1F1F1F] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push('/dashboard')} aria-label="대시보드로" className="rounded-full p-2 hover:bg-black/5"><ArrowLeft size={20} /></button>
          <h1 className="flex-1 text-[28px] font-semibold">피드백함</h1>
          <button type="button" disabled={loading} onClick={() => { void load() }} className="flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-[#0B57D0] hover:bg-[#0B57D0]/10"><ArrowsClockwise size={16} /> 새로고침</button>
        </div>
        <p className="mt-3 text-base text-[#444746]">새로 받은 피드백부터 쌓입니다. 카드를 누르면 캡처와 상세 내용을 볼 수 있어요.</p>
        <p role="status" className="mt-2 text-sm text-[#146C2E]">{notice || (items ? `${items.length}건 표시 중` : '')}</p>
        {error && <p role="alert" className="mt-6 text-[15px] text-[#B3261E]">{error}</p>}
        {!error && !items && <p className="mt-6 text-[15px] text-[#444746]">불러오는 중…</p>}
        {items && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <ul aria-label="받은 피드백" className="space-y-3">
              {items.length === 0 && <li className="text-[15px] text-[#444746]">아직 받은 피드백이 없어요.</li>}
              {items.map(item => {
                const status = STATUS[item.status ?? 'new']
                return (
                  <li key={item.id}>
                    <button type="button" disabled={statusBusy} aria-expanded={selected?.id === item.id} onClick={() => { void open(item) }}
                      className={cn('w-full rounded-2xl border bg-white p-4 text-left hover:border-[#0B57D0]', selected?.id === item.id ? 'border-[#0B57D0]' : 'border-[#E1E3E1]')}>
                      <div className="flex items-center gap-2 text-[12px] text-[#444746]">
                        <span className={cn('rounded-full px-2 py-0.5 font-semibold', status.className)}>{status.label}</span>
                        <span>{item.createdAtMs ? new Date(item.createdAtMs).toLocaleString('ko-KR') : ''}</span>
                        <span className="truncate">{item.senderName ?? item.senderEmail ?? ''}</span>
                        {!!item.imageCount && <span>캡처 {item.imageCount}</span>}
                      </div>
                      <p className="mt-2 line-clamp-2 text-[15px]">{item.message || '(캡처만 보냄)'}</p>
                      <p className="mt-1 truncate text-[12px] text-[#444746]">{[item.context?.projectTitle, item.context?.activityCode, item.context?.path].filter(Boolean).join(' · ')}</p>
                    </button>
                  </li>
                )
              })}
              {nextCursor && <li><button type="button" disabled={loading} onClick={() => { void load(nextCursor) }} className="min-h-12 w-full rounded-full bg-[#D3E3FD] px-5 text-base font-semibold text-[#0842A0] disabled:opacity-50">{loading ? '불러오는 중…' : '이전 피드백 더 보기'}</button></li>}
            </ul>
            {selected && (
              <section aria-label="피드백 상세" className="min-w-0 h-fit rounded-[28px] bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {(Object.keys(STATUS) as FeedbackStatus[]).map(status => (
                    <button key={status} type="button" disabled={statusBusy || detailLoading} onClick={() => { void setStatus(selected.id, status) }}
                      className={cn('min-h-11 rounded-full border px-4 text-[13px] font-semibold', (selected.status ?? 'new') === status ? STATUS[status].className + ' border-transparent' : 'border-[#C4C7C5] text-[#444746]')}>
                      {STATUS[status].label}
                    </button>
                  ))}
                </div>
                {detailLoading && <p role="status" className="mt-3 text-sm text-[#444746]">상세 내용을 불러오는 중…</p>}
                <p className="mt-4 whitespace-pre-wrap text-[15px] leading-6">{selected.message || '(글 없음)'}</p>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] text-[#444746]">
                  <dt>보낸 사람</dt><dd className="break-all">{selected.senderName ?? '-'} {selected.senderEmail ? `<${selected.senderEmail}>` : ''}</dd>
                  <dt>화면</dt><dd className="break-all">{selected.context?.path}</dd>
                  <dt>프로젝트</dt><dd className="break-all">{selected.context?.projectTitle ?? '-'} {selected.context?.projectId ? `(${selected.context.projectId})` : ''}</dd>
                  <dt>활동</dt><dd>{selected.context?.activityCode ? `${selected.context.activityCode} ${selected.context.activityLabel ?? ''}` : '-'}</dd>
                  <dt>메일</dt><dd>{selected.emailed ? '보냄' : `안 보냄${selected.emailError ? ` — ${selected.emailError}` : ''}`}</dd>
                </dl>
                {!!selected.recentErrors?.length && (
                  <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-[#F1F4F9] p-3 text-[12px] leading-5">{selected.recentErrors.join('\n')}</pre>
                )}
                <div className="mt-4 space-y-3">
                  {(selected.images ?? []).map((src, index) => (
                    // eslint-disable-next-line @next/next/no-img-element -- 저장된 캡처(data URL)
                    <a key={index} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`캡처 ${index + 1}`} className="w-full rounded-xl border border-[#E1E3E1]" /></a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Megaphone, RefreshCw, Send, Undo2, X } from 'lucide-react'
import { ADMIN_COMPOSE_EVENT, adminButton, adminDate, adminFetch, type NoticeTarget } from './adminClient'
import { NOTICE_BODY_MAX, NOTICE_SCOPE_LABEL, NOTICE_TITLE_MAX, type NoticeLog } from '@/lib/admin/notices'

/** Popup composer: opened by openNoticeComposer() from cards, or for an all-teacher notice. */
export function NoticeComposerDialog() {
  const [target, setTarget] = useState<NoticeTarget | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const open = (event: Event) => {
      setTarget((event as CustomEvent<NoticeTarget>).detail)
      setTitle(''); setBody(''); setError(''); setDone('')
    }
    window.addEventListener(ADMIN_COMPOSE_EVENT, open)
    return () => window.removeEventListener(ADMIN_COMPOSE_EVENT, open)
  }, [])
  useEffect(() => {
    const element = dialog.current
    if (target && element && !element.open) element.showModal()
    if (!target && element?.open) element.close()
  }, [target])

  async function send() {
    if (!target || busy) return
    if (target.scope === 'all' && !window.confirm('모든 선생님 화면에 팝업이 뜹니다. 보낼까요?')) return
    setBusy(true); setError('')
    try {
      const result = await adminFetch<{ recipientCount: number; targetLabel: string }>('/api/admin/notices', {
        method: 'POST', body: JSON.stringify({ scope: target.scope, target: target.target, title, body }),
      })
      setDone(`${result.targetLabel}에게 보냈어요 · 받는 사람 ${result.recipientCount}명`)
      window.dispatchEvent(new Event('tcid-admin-notices-changed'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '보내지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) setTarget(null) }}
    className="m-auto w-[calc(100vw-32px)] max-w-[560px] rounded-[28px] border-0 bg-[#F3F6FC] p-0 text-[#1F1F1F] shadow-2xl backdrop:bg-black/40">
    {target && <form className="p-6" onSubmit={event => { event.preventDefault(); void send() }}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D3E3FD] text-[#0842A0]"><Megaphone size={22} /></span>
        <div className="min-w-0 flex-1"><h2 id={titleId} className="text-[22px] font-semibold leading-8">팝업 알림 보내기</h2>
          <p className="mt-1 break-words text-sm text-[#444746]">{NOTICE_SCOPE_LABEL[target.scope]} · {target.label}</p></div>
        <button type="button" aria-label="닫기" disabled={busy} onClick={() => setTarget(null)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-[#E3E3E3]"><X size={22} /></button>
      </div>
      {done ? <>
        <p role="status" className="mt-6 rounded-2xl bg-[#C4EED0] p-4 text-[#0D652D]">{done}</p>
        <div className="mt-6 flex justify-end"><button type="button" className={adminButton} onClick={() => setTarget(null)}>닫기</button></div>
      </> : <>
        <label className="mt-5 block text-sm font-semibold">제목 (선택)
          <input value={title} maxLength={NOTICE_TITLE_MAX} onChange={event => setTitle(event.target.value)} placeholder="관리자 알림"
            className="mt-2 block min-h-12 w-full rounded-xl border border-[#747775] bg-white px-4 text-base" /></label>
        <label className="mt-4 block text-sm font-semibold">내용
          <textarea value={body} maxLength={NOTICE_BODY_MAX} required rows={5} onChange={event => setBody(event.target.value)}
            placeholder="예: 10분 뒤 전체 공유를 시작합니다. 지금 단계 기록을 저장해 주세요."
            className="mt-2 block w-full rounded-xl border border-[#747775] bg-white px-4 py-3 text-base leading-7" /></label>
        <p className="mt-1 text-right text-xs text-[#444746]">{body.length}/{NOTICE_BODY_MAX}</p>
        {error && <p role="alert" className="mt-2 rounded-xl bg-[#F9DEDC] p-3 text-sm text-[#8C1D18]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setTarget(null)} className="min-h-11 rounded-full px-5 text-sm font-semibold text-[#0842A0] hover:bg-[#E3E8F0]">취소</button>
          <button type="submit" disabled={busy || !body.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0B57D0] px-5 text-sm font-semibold text-white hover:bg-[#0842A0] disabled:opacity-40"><Send size={16} /> {busy ? '보내는 중…' : '보내기'}</button>
        </div>
      </>}
    </form>}
  </dialog>
}

/** Sent notices with read counts; unread copies can be withdrawn. */
export function NoticeHistory() {
  const [items, setItems] = useState<NoticeLog[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try { setItems((await adminFetch<{ items: NoticeLog[] }>('/api/admin/notices')).items) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => {
    void load()
    const reload = () => { void load() }
    window.addEventListener('tcid-admin-notices-changed', reload)
    return () => window.removeEventListener('tcid-admin-notices-changed', reload)
  }, [load])
  async function withdraw(item: NoticeLog) {
    if (!window.confirm('아직 읽지 않은 선생님 화면에서 이 알림을 거둘까요?')) return
    try { await adminFetch(`/api/admin/notices?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' }); void load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '회수하지 못했습니다.') }
  }
  return <section aria-label="보낸 알림" className="rounded-[28px] border border-[#C4C7C5] bg-white p-5 sm:p-7">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="flex-1 text-xl font-bold">보낸 알림</h2>
      <button type="button" className={adminButton} onClick={() => window.dispatchEvent(new CustomEvent(ADMIN_COMPOSE_EVENT, { detail: { scope: 'all', target: 'all', label: '전체 선생님' } }))}><Megaphone size={16} /> 전체 공지 보내기</button>
      <button type="button" disabled={busy} className={adminButton} onClick={() => { void load() }}><RefreshCw size={16} /> 새로고침</button>
    </div>
    <p className="mt-2 text-sm text-[#444746]">개인·방 알림은 회원 목록이나 프로젝트 카드의 &lsquo;알림 보내기&rsquo;에서 보냅니다.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#F9DEDC] p-3 text-[#8C1D18]">{error}</p>}
    {busy && <p role="status" className="mt-4">불러오는 중…</p>}
    {!busy && !items.length && !error && <p className="mt-4 text-[#444746]">아직 보낸 알림이 없습니다.</p>}
    <ul className="mt-4 space-y-3">{items.map(item => <li key={item.id} className="rounded-2xl bg-[#F8FAFD] p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-[#D3E3FD] px-3 py-1 text-[#0842A0]">{NOTICE_SCOPE_LABEL[item.scope]}</span>
        <span className="text-[#444746]">{item.targetLabel}</span>
        <span className="text-[#444746]">· {adminDate(item.createdAt)}</span>
        <span className={`rounded-full px-3 py-1 ${item.withdrawn ? 'bg-[#E3E3E3] text-[#444746]' : 'bg-[#C4EED0] text-[#0D652D]'}`}>{item.withdrawn ? '회수함' : `읽음 ${item.readCount}/${item.recipientCount}`}</span>
      </div>
      <p className="mt-2 font-semibold">{item.title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#1F1F1F]">{item.body}</p>
      {!item.withdrawn && item.readCount < item.recipientCount && <button type="button" onClick={() => { void withdraw(item) }}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#8C1D18] hover:bg-[#F9DEDC]"><Undo2 size={16} /> 안 읽은 알림 회수</button>}
    </li>)}</ul>
  </section>
}

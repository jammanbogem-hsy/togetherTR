'use client'

/**
 * Shows admin notices as a popup anywhere in the signed-in app.
 * Listens to the teacher's own noticeInbox doc (read-only by rules); "확인" asks the server to
 * remove it, so the same notice does not come back on another device.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { Megaphone } from '@phosphor-icons/react'
import { auth, db } from '@/lib/firebase/config'
import { inboxItems, NOTICE_SCOPE_LABEL, type NoticeItem } from '@/lib/admin/notices'
import { MD3Button } from '@/components/ui/MD3Button'

export function AdminNoticePopup() {
  const [uid, setUid] = useState<string | null>(null)
  const [items, setItems] = useState<NoticeItem[]>([])
  // Hidden locally right away so a slow network never shows the same notice twice.
  const [dismissed, setDismissed] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid ?? null)), [])
  useEffect(() => {
    if (!uid) { setItems([]); return }
    return onSnapshot(doc(db, 'noticeInbox', uid), snap => setItems(inboxItems(snap.data())), () => setItems([]))
  }, [uid])

  const current = items.find(item => !dismissed.includes(item.id)) ?? null
  const remaining = items.filter(item => !dismissed.includes(item.id)).length
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (current && !element.open) element.showModal()
    if (!current && element.open) element.close()
  }, [current])

  async function confirm() {
    if (!current || busy) return
    const id = current.id
    setBusy(true); setError('')
    setDismissed(list => [...list, id])
    try {
      const token = await auth.currentUser?.getIdToken()
      const response = await fetch('/api/notices', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) throw Error()
    } catch {
      // Keep it hidden on this screen; it will show again on the next visit so it is not lost.
      setError('확인 표시를 저장하지 못했어요. 다음 접속 때 한 번 더 보일 수 있어요.')
    } finally { setBusy(false) }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); void confirm() }}
    className="m-auto w-[calc(100vw-32px)] max-w-[480px] rounded-[28px] border-0 bg-[#F3F6FC] p-0 text-[#1F1F1F] shadow-2xl backdrop:bg-black/40">
    {current && <div className="p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D3E3FD] text-[#0842A0]"><Megaphone size={24} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#0842A0]">관리자 알림 · {NOTICE_SCOPE_LABEL[current.scope]}{current.context ? ` · ${current.context}` : ''}</p>
          <h2 id={titleId} className="break-words text-[22px] font-semibold leading-8">{current.title}</h2>
        </div>
      </div>
      <p className="mt-4 max-h-[50dvh] overflow-y-auto whitespace-pre-wrap break-words text-base leading-7 text-[#1F1F1F]">{current.body}</p>
      <p className="mt-3 text-xs text-[#444746]">{new Date(current.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{remaining > 1 ? ` · 알림 ${remaining - 1}개 더 있음` : ''}</p>
      {error && <p role="alert" className="mt-3 text-sm text-[#B3261E]">{error}</p>}
      <div className="mt-6 flex justify-end">
        <MD3Button variant="filled" size="md" disabled={busy} onClick={() => { void confirm() }}>{remaining > 1 ? '확인 · 다음 알림' : '확인'}</MD3Button>
      </div>
    </div>}
  </dialog>
}

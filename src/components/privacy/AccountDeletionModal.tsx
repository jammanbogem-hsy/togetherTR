'use client'

import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_DELETION_COPY, ACCOUNT_DELETION_ERROR_COPY, type AccountDeletionErrorCode } from '@/lib/privacy/consent'
import { deleteCurrentAccount } from '@/lib/privacy/deleteAccountClient'
import { MD3Button } from '@/components/ui/MD3Button'

export function AccountDeletionModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void | Promise<void> }) {
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close() }
  }, [])

  async function withdraw() {
    if (confirm !== ACCOUNT_DELETION_COPY.confirmWord || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await deleteCurrentAccount(confirm)
      await onDeleted()
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : ''
      setError(Object.hasOwn(ACCOUNT_DELETION_ERROR_COPY, code)
        ? ACCOUNT_DELETION_ERROR_COPY[code as AccountDeletionErrorCode]
        : code.includes('requires-recent-login') ? ACCOUNT_DELETION_COPY.reauthRequired : ACCOUNT_DELETION_COPY.failed)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialogRef} aria-labelledby="account-deletion-title" aria-describedby="account-deletion-details"
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose() }}
    className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-3xl border border-[#DADCE0] bg-white p-5 text-[#202124] shadow-xl backdrop:bg-black/40 sm:p-6">
    <h2 id="account-deletion-title" className="text-xl font-semibold">{ACCOUNT_DELETION_COPY.dialogTitle}</h2>
    <ul id="account-deletion-details" className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#5F6368]">
      {ACCOUNT_DELETION_COPY.steps.map(step => <li key={step}>{step}</li>)}
    </ul>
    <label className="mt-5 block text-sm font-medium" htmlFor="account-deletion-confirm">{ACCOUNT_DELETION_COPY.confirmPrompt}</label>
    <input id="account-deletion-confirm" type="text" value={confirm} placeholder={ACCOUNT_DELETION_COPY.confirmPlaceholder} disabled={busy}
      autoComplete="off" onChange={event => setConfirm(event.target.value)}
      className="mt-2 w-full rounded-xl border border-[#C4C7C5] bg-white px-3 py-2.5 text-sm placeholder:text-[#5F6368] focus:border-[#0B57D0] focus:outline-2 focus:outline-[#0B57D0]" />
    {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-[#C5221F]">{error}</p>}
    {busy && <p role="status" className="mt-3 text-sm text-[#5F6368]">{ACCOUNT_DELETION_COPY.inProgress}</p>}
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <MD3Button variant="text" size="sm" tone="neutral" disabled={busy} onClick={onClose}>{ACCOUNT_DELETION_COPY.cancelButton}</MD3Button>
      <MD3Button variant="filled" size="sm" tone="red" disabled={busy || confirm !== ACCOUNT_DELETION_COPY.confirmWord} aria-busy={busy} onClick={withdraw}>
        {busy ? ACCOUNT_DELETION_COPY.inProgress : ACCOUNT_DELETION_COPY.submitButton}
      </MD3Button>
    </div>
  </dialog>
}

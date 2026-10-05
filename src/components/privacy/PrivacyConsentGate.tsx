'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from '@phosphor-icons/react'
import { CONSENT_COPY, CONSENT_UI_COPY, CONSENT_COLLECTION_TABLE, CONSENT_OVERSEAS_TABLE, recordConsent } from '@/lib/privacy/consent'
import { saveLocalProfile, signOut, type UserProfile } from '@/lib/auth'
import { useProjectStore } from '@/store/project'
import { MD3Button } from '@/components/ui/MD3Button'
import { ConsentTable } from './ConsentTable'

export function PrivacyConsentGate({ profile }: { profile: UserProfile }) {
  const router = useRouter()
  const [checked, setChecked] = useState({ collect: false, overseas: false })
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const ready = CONSENT_COPY.items.every(item => checked[item.id])

  async function agree() {
    if (!ready || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const privacyConsent = await recordConsent(profile.uid)
      const current = useProjectStore.getState().userProfile
      if (current?.uid !== profile.uid) return
      const updated = { ...current, privacyConsent }
      try { saveLocalProfile(updated) } catch { /* 저장 완료는 Firestore 기록을 기준으로 한다. */ }
      useProjectStore.getState().setUserProfile(updated)
    } catch {
      setError(CONSENT_UI_COPY.saveError)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function decline() {
    if (pending.current) return
    pending.current = true
    setLeaving(true)
    setBusy(true)
    setError('')
    try {
      await signOut()
      useProjectStore.getState().setUserProfile(null)
      router.replace('/login')
    } catch {
      setError(CONSENT_UI_COPY.declineError)
    } finally {
      pending.current = false
      setBusy(false)
      setLeaving(false)
    }
  }

  return <main className="fixed inset-0 z-[2000] overflow-y-auto bg-[#F8F9FA] p-4 sm:p-6" aria-labelledby="privacy-consent-title">
    <div className="mx-auto w-full max-w-3xl rounded-3xl border border-[#DADCE0] bg-white p-5 sm:p-8">
      <ShieldCheck size={28} className="mb-3 text-[#0B57D0]" aria-hidden="true" />
      <h1 id="privacy-consent-title" className="text-2xl font-semibold text-[#202124]">{CONSENT_COPY.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-[#5F6368]">{CONSENT_COPY.intro}</p>
      <fieldset disabled={busy} className="mt-6 space-y-3">
        <legend className="sr-only">{CONSENT_COPY.title}</legend>
        {CONSENT_COPY.items.map(item => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#DADCE0] p-4">
          <input type="checkbox" checked={checked[item.id]} onChange={event => setChecked(current => ({ ...current, [item.id]: event.target.checked }))}
            className="mt-1 h-5 w-5 shrink-0 accent-[#0B57D0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]" />
          <span className="min-w-0 text-sm leading-relaxed">
            <span className="block font-semibold text-[#202124]">{CONSENT_UI_COPY.requiredLabel} {item.title}</span>
            <span className="mt-1 block text-[#5F6368]">{item.body}</span>
          </span>
        </label>)}
      </fieldset>
      <div className="mt-4 space-y-2 text-sm leading-relaxed text-[#5F6368]">
        <p>{CONSENT_COPY.refusal}</p><p>{CONSENT_COPY.retention}</p>
      </div>
      <details className="mt-5 rounded-2xl border border-[#DADCE0] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[#0B57D0] focus-visible:outline-2 focus-visible:outline-[#0B57D0]">{CONSENT_COPY.detailsLink}</summary>
        <div className="mt-4 space-y-5">
          <ConsentTable title={CONSENT_UI_COPY.collectionTableTitle} {...CONSENT_COLLECTION_TABLE} />
          <ConsentTable title={CONSENT_UI_COPY.overseasTableTitle} {...CONSENT_OVERSEAS_TABLE} />
        </div>
      </details>
      {error && <p role="alert" className="mt-4 text-sm text-[#C5221F]">{error}</p>}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <MD3Button variant="text" size="sm" disabled={busy} onClick={decline}>{CONSENT_COPY.declineButton}</MD3Button>
        <MD3Button variant="filled" size="sm" disabled={!ready || busy} aria-busy={busy} onClick={agree}>
          {busy && !leaving ? CONSENT_UI_COPY.saving : error ? CONSENT_UI_COPY.retry : CONSENT_COPY.agreeButton}
        </MD3Button>
      </div>
    </div>
  </main>
}

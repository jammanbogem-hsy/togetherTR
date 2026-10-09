'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Check, X, UserCircle, ShieldCheck } from '@phosphor-icons/react'
import { Avatar } from '@/components/ui/Avatar'
import { MD3Button } from '@/components/ui/MD3Button'
import { PROFILE_AVATARS, isProfileAvatarId, type ProfileAvatarId } from '@/lib/profile/avatars'
import { saveProfileAvatar } from '@/lib/profile/saveAvatar'
import { saveLocalProfile, type UserProfile } from '@/lib/auth'
import { useProjectStore } from '@/store/project'
import { useAdminSession } from '@/components/admin/adminClient'

export function ProfileAvatarButton({ profile, projectId, size = 40, showName = false }: {
  profile: UserProfile; projectId?: string; size?: number; showName?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Only the super admin gets a menu; everyone else keeps the direct avatar picker.
  const { uid: adminUid } = useAdminSession()
  const isAdmin = !!adminUid && adminUid === profile.uid
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])
  function close() {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  function openPicker() { setMenuOpen(false); setNotice(''); setOpen(true) }
  return <span className="relative inline-flex">
    <button ref={trigger} type="button" aria-label={isAdmin ? `${profile.displayName} 프로필 메뉴` : `${profile.displayName} 프로필 이미지 변경`}
      title={isAdmin ? '프로필 메뉴' : '프로필 이미지 변경'} aria-haspopup={isAdmin ? 'menu' : undefined} aria-expanded={isAdmin ? menuOpen : undefined}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full p-1 hover:bg-[#E8F0FE] focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
      onClick={() => { if (isAdmin) setMenuOpen(value => !value); else openPicker() }}>
      <Avatar name={profile.displayName} color={profile.color} avatarId={profile.avatarId} photoURL={profile.photoURL} size={size} />
      {showName && <span className="max-w-32 truncate pr-2 text-[13px] font-medium text-[#3C4043]">{profile.displayName}</span>}
    </button>
    {isAdmin && menuOpen && <div ref={menuRef} role="menu" aria-label="프로필 메뉴"
      className="absolute right-0 top-full z-[60] mt-2 w-56 overflow-hidden rounded-2xl border border-[#C4C7C5] bg-[#F3F6FC] py-2 shadow-[0_2px_6px_2px_rgba(0,0,0,0.15)]">
      <button type="button" role="menuitem" onClick={openPicker}
        className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium text-[#1F1F1F] hover:bg-[#E3E8F0] focus-visible:bg-[#E3E8F0] focus-visible:outline-none">
        <UserCircle size={20} aria-hidden="true" className="text-[#444746]" />프로필 이미지 변경</button>
      <Link href="/admin" role="menuitem" onClick={() => setMenuOpen(false)}
        className="flex min-h-12 w-full items-center gap-3 px-4 text-sm font-medium text-[#0842A0] hover:bg-[#E3E8F0] focus-visible:bg-[#E3E8F0] focus-visible:outline-none">
        <ShieldCheck size={20} aria-hidden="true" />관리자</Link>
    </div>}
    <span className="sr-only" role="status">{notice}</span>
    {open && createPortal(<ProfileAvatarPicker profile={profile} projectId={projectId} onClose={close}
      onSaved={() => { setNotice('프로필 이미지를 저장했습니다.'); close() }} />, document.body)}
  </span>
}

export function ProfileAvatarPicker({ profile, projectId, onClose, onSaved }: {
  profile: UserProfile; projectId?: string; onClose: () => void; onSaved: () => void
}) {
  const [selected, setSelected] = useState<ProfileAvatarId>(isProfileAvatarId(profile.avatarId) ? profile.avatarId : 'initials')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])

  async function apply() {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError('')
    try {
      await saveProfileAvatar(profile.uid, selected, projectId)
      const latest = useProjectStore.getState()
      // A response from an old account must not replace a newly signed-in profile.
      if (latest.userProfile?.uid === profile.uid) {
        const updated = { ...latest.userProfile, avatarId: selected }
        latest.setUserProfile(updated)
        try { saveLocalProfile(updated) } catch { /* Firestore remains authoritative when local storage is unavailable. */ }
      }
      onSaved()
    } catch {
      setError('이미지를 저장하지 못했습니다. 선택은 그대로 있으니 다시 적용해 주세요.')
    } finally { inFlight.current = false; setSaving(false) }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={`${titleId}-description`}
    onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose() }}
    className="m-auto max-h-[90dvh] w-[calc(100vw-24px)] max-w-[720px] overflow-hidden rounded-[28px] border-0 bg-[#F8FAFD] p-0 text-[#1F1F1F] shadow-2xl backdrop:bg-black/40">
    <div className="flex max-h-[90dvh] flex-col">
      <header className="flex items-start gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
        <Avatar name={profile.displayName} color={profile.color} avatarId={selected} size={64} />
        <div className="flex-1 pt-1"><h2 id={titleId} className="text-[22px] font-semibold leading-8">나의 프로필 이미지</h2>
          <p id={`${titleId}-description`} className="mt-1 text-sm leading-6 text-[#444746]">마음에 드는 친구를 골라 주세요. 언제든 바꿀 수 있어요.</p></div>
        <button type="button" aria-label="프로필 이미지 선택 닫기" disabled={saving} onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[#E3E3E3] focus-visible:outline-2 focus-visible:outline-[#0B57D0] disabled:opacity-40"><X size={24} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="프로필 이미지 30종">
          {PROFILE_AVATARS.map(([id, label]) => <button key={id} type="button" aria-label={label} aria-pressed={selected === id}
            disabled={saving} onClick={() => { setSelected(id); setError('') }}
            className={`relative flex min-h-[88px] min-w-0 flex-col items-center justify-center rounded-2xl border-2 px-1 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] disabled:opacity-50 ${selected === id ? 'border-[#0B57D0] bg-[#D3E3FD]' : 'border-transparent bg-white hover:bg-[#E8F0FE]'}`}>
            <Avatar avatarId={id} size={64} className="max-w-full" />
            <span className="text-xs leading-5 text-[#444746]">{label}</span>
            {selected === id && <Check size={16} weight="bold" className="absolute right-1 top-1 text-[#0B57D0]" />}
          </button>)}
        </div>
        <button type="button" aria-pressed={selected === 'initials'} disabled={saving} onClick={() => { setSelected('initials'); setError('') }}
          className={`mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${selected === 'initials' ? 'border-[#0B57D0] bg-[#D3E3FD] text-[#0842A0]' : 'border-[#C4C7C5] bg-white text-[#444746]'}`}>
          <Avatar name={profile.displayName} color={profile.color} size={32} />기본 이니셜 사용
          {selected === 'initials' && <Check size={18} className="ml-auto" />}
        </button>
      </div>
      <footer className="shrink-0 border-t border-[#E1E3E1] px-5 py-4 sm:px-7">
        {error && <p role="alert" className="mb-3 text-sm leading-6 text-[#B3261E]">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <MD3Button variant="text" size="md" disabled={saving} onClick={onClose}>취소</MD3Button>
          <MD3Button variant="filled" size="md" disabled={saving} onClick={() => { void apply() }}>{saving ? '저장 중…' : '적용'}</MD3Button>
        </div>
      </footer>
    </div>
  </dialog>
}

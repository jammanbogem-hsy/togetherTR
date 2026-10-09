'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/config'
import { isSuperAdmin } from '@/lib/admin/consoleModel'

export function useAdminSession() {
  const [session, setSession] = useState<{ ready: boolean; uid: string | null }>({ ready: false, uid: null })
  useEffect(() => onAuthStateChanged(auth, user => {
    setSession({ ready: true, uid: user && isSuperAdmin({ email: user.email, email_verified: user.emailVerified }) ? user.uid : null })
  }), [])
  return session
}

export async function adminRead<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  await auth.authStateReady()
  const user = auth.currentUser
  if (!user || !isSuperAdmin({ email: user.email, email_verified: user.emailVerified })) throw Error('최고관리자 계정으로 로그인해 주세요.')
  const token = await user.getIdToken()
  const response = await fetch(`/api/admin/console?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal })
  const result = await response.json()
  if (!response.ok) throw Error(result.error || '관리자 정보를 불러오지 못했습니다.')
  return result as T
}

export const adminButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-[#0842A0] bg-[#D3E3FD] hover:bg-[#C2D7FA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] disabled:opacity-50'
export const adminDate = (value: number | null) => value === null ? '기록 없음' : new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

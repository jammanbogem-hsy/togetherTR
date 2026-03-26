'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { getOrRestoreProfile } from '@/lib/auth'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { userProfile, setUserProfile } = useProjectStore()
  const router = useRouter()

  useEffect(() => {
    if (userProfile) return  // 이미 있으면 skip
    getOrRestoreProfile().then(p => {
      if (p) {
        setUserProfile(p)
      } else {
        // 프로필 없으면 로그인으로
        router.replace('/login')
      }
    })
  }, [userProfile, setUserProfile, router])

  // 프로필 복원 전 잠깐 로딩 (빈 화면 방지)
  if (!userProfile) return null

  return <>{children}</>
}

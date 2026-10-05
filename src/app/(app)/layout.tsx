'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { onProfileRestored } from '@/lib/auth'
import { needsConsent } from '@/lib/privacy/consent'
import { PrivacyConsentGate } from '@/components/privacy/PrivacyConsentGate'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { userProfile, setUserProfile } = useProjectStore()
  const router = useRouter()

  useEffect(() => {
    const unsubscribe = onProfileRestored(profile => {
      if (profile) {
        setUserProfile(profile)
      } else {
        setUserProfile(null)
        router.replace('/login')
      }
    })
    return unsubscribe
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 프로필 복원 전 잠깐 로딩 (빈 화면 방지)
  if (!userProfile) return null

  if (needsConsent(userProfile)) return <PrivacyConsentGate key={userProfile.uid} profile={userProfile} />

  return <>{children}</>
}

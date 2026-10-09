'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { onProfileRestored } from '@/lib/auth'
import { FeedbackButton } from '@/components/feedback/FeedbackButton'

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

  // 화면 오른쪽 아래 피드백 버튼 — 로그인한 모든 화면에서 오류·불편을 바로 보낸다
  return <>{children}<FeedbackButton /></>
}

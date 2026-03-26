'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getOrRestoreProfile } from '@/lib/auth'
import { useProjectStore } from '@/store/project'

export default function RootPage() {
  const router = useRouter()
  const { setUserProfile } = useProjectStore()

  useEffect(() => {
    getOrRestoreProfile().then(profile => {
      if (profile) {
        setUserProfile(profile)
        router.replace('/dashboard')
      } else {
        router.replace('/login')
      }
    })
  }, [])

  return null
}

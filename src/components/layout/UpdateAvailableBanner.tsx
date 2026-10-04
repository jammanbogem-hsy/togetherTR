'use client'

import { useEffect, useState } from 'react'
import { BUILD_CHECK_INTERVAL_MS, CLIENT_BUILD_STAMP, isNewBuildAvailable } from '@/lib/version/buildVersion'

/** 새 버전이 배포되면 화면 위에 작은 안내를 띄운다. 누르면 새로고침(자동 새로고침은 하지 않음 — 입력 중 내용 보호). */
export function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!CLIENT_BUILD_STAMP) return
    let stopped = false
    const check = async () => {
      if (stopped || document.visibilityState === 'hidden') return
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { build?: unknown }
        if (!stopped && isNewBuildAvailable(CLIENT_BUILD_STAMP, data.build)) setAvailable(true)
      } catch {
        // 오프라인·일시 오류는 다음 확인 때 다시
      }
    }
    const timer = setInterval(check, BUILD_CHECK_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!available) return null
  return (
    <div role="status" className="fixed left-1/2 top-2 z-[1000] -translate-x-1/2" data-testid="update-available-banner">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-[#1A73E8] px-4 py-1.5 text-[13px] font-medium text-white shadow-md hover:bg-[#1557B0]"
      >
        새 버전이 있어요 — 새로고침
      </button>
    </div>
  )
}

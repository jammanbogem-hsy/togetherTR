'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { getPublicReport } from '@/lib/firebase/publicReports'
import type { PublicReport } from '@/types'
import { PublicReportViewer } from '@/components/public/PublicReportViewer'

export default function PublicReportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const [report, setReport] = useState<PublicReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getPublicReport(projectId)
      .then(r => {
        if (cancelled) return
        setReport(r)
        setLoading(false)
        if (r) {
          // 탭 타이틀 — OG 공유는 추후 server metadata로 보강
          document.title = `${r.projectTitle} — T-CID2.0 협력적 수업설계`
        }
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '보고서를 불러오지 못했습니다.')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] text-[#9AA0A6] text-sm">
        공개 보고서를 불러오는 중입니다…
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FA] px-6 text-center">
        <p className="text-[#202124] text-lg font-bold mb-2">공개 보고서를 찾을 수 없습니다</p>
        <p className="text-[#5F6368] text-sm max-w-md">
          이 링크의 공개가 해제되었거나 아직 배포되지 않은 프로젝트일 수 있습니다. 공유자에게 다시 링크를 요청해 주세요.
        </p>
        {error && (
          <p className="mt-3 text-[#9AA0A6] text-xs">{error}</p>
        )}
      </div>
    )
  }

  return <PublicReportViewer report={report} />
}

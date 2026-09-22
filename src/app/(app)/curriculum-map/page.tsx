'use client'

// 교육과정 분석맵 라우트 — ?q= ?subjects= ?bands= 를 읽어 본체에 넘기는 얇은 래퍼.
// (app) 레이아웃이 로그인 보호를 담당한다.

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CurriculumMapView } from '@/components/curriculum-map/CurriculumMapView'

function splitParam(value: string | null): string[] | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(v => v.trim()).filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

function CurriculumMapRoute(): React.ReactElement {
  const params = useSearchParams()
  return (
    <CurriculumMapView
      mode="page"
      initialQuery={params.get('q') ?? undefined}
      initialSubjects={splitParam(params.get('subjects'))}
      initialBands={splitParam(params.get('bands'))}
    />
  )
}

export default function CurriculumMapPage(): React.ReactElement {
  // useSearchParams 는 정적 렌더 시 Suspense 경계가 필요하다
  return (
    <Suspense fallback={null}>
      <CurriculumMapRoute />
    </Suspense>
  )
}

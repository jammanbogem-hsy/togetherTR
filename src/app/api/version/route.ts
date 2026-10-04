// 지금 배포된 서버의 빌드 도장 — 열린 탭이 새 버전 배포를 알아채는 데 쓴다(UpdateAvailableBanner).
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { build: process.env.NEXT_PUBLIC_BUILD_STAMP ?? '' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}

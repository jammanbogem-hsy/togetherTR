// /login — 안내형 로그인 랜딩 (서버 컴포넌트 조립).
// 로그인 로직은 LoginCard.tsx(클라이언트)로 verbatim 이식 — 기능 무변경.
// 설계 기준: docs/login-guide-design-spec.md · Material Design 3 리스타일
export const dynamic = 'force-dynamic'

import { Roboto } from 'next/font/google'
import 'material-symbols/rounded.css'
import LandingNav from './landing/LandingNav'
import { ACCOUNT_DELETION_COPY } from '@/lib/privacy/consent'
import {
  HeroSection,
  StartSection,
  WorkflowSection,
  AiFacilitatorSection,
  PrinciplesSection,
  CollaborationSection,
  FaqSection,
  FinalCtaSection,
  LandingFooter,
} from './landing/sections'

// 로그인 트리 전용 폰트 — 전역 layout.tsx는 무변경, 이 라우트에만 --font-roboto 노출.
const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
})

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ accountDeleted?: string | string[] }> }) {
  const params = await searchParams
  return (
    <div className={`${roboto.variable} m3-landing relative min-h-screen bg-[var(--md-surface-container-low)]`}>
      <LandingNav />
      {params.accountDeleted === '1' && <p role="status" className="fixed left-4 right-4 top-20 z-50 mx-auto max-w-xl rounded-2xl border border-[#CEEAD6] bg-[#E6F4EA] p-4 text-sm leading-relaxed text-[#137333] shadow-sm">
        {ACCOUNT_DELETION_COPY.done}
      </p>}
      {/* 고정 네비가 sticky이므로 Hero를 네비 뒤로 겹치게 올림 */}
      <main className="-mt-16">
        <HeroSection />
        <StartSection />
        <WorkflowSection />
        <AiFacilitatorSection />
        <PrinciplesSection />
        <CollaborationSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <LandingFooter />
    </div>
  )
}

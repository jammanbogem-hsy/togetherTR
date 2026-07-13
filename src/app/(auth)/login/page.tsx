// /login — 안내형 로그인 랜딩 (서버 컴포넌트 조립).
// 로그인 로직은 LoginCard.tsx(클라이언트)로 verbatim 이식 — 기능 무변경.
// 설계 기준: docs/login-guide-design-spec.md
export const dynamic = 'force-dynamic'

import LandingNav from './landing/LandingNav'
import { gowunBatang } from './landing/fonts'
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

export default function LoginPage() {
  return (
    <div className={`${gowunBatang.variable} relative min-h-screen bg-[#F8F9FA]`}>
      <LandingNav />
      {/* 고정 네비가 sticky이므로 Hero를 네비 뒤로 겹치게 올림 */}
      <main className="-mt-14">
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

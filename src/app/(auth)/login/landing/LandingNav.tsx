'use client'

import { useEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'

// 고정 상단 네비 — 최상단에선 투명, Hero를 벗어나면 흰 배경+그림자.
// 1px sentinel + IntersectionObserver (스크롤 리스너 대신 경량 감지).
export default function LandingNav() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const anchors = [
    { href: '#start', label: '소개' },
    { href: '#workflow', label: '5단계' },
    { href: '#ai', label: 'AI' },
    { href: '#principles', label: '협력 원리' },
  ]

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-px absolute top-0" />
      <nav
        aria-label="페이지 내비게이션"
        className={`sticky top-0 z-50 h-16 flex items-center justify-between px-4 md:px-8 transition-all duration-200 ${
          scrolled ? 'bg-white/85 backdrop-blur-md md-shadow-1' : 'bg-transparent'
        }`}
      >
        <a href="#login" className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-[#1A73E8] focus-visible:outline-offset-2 rounded-lg">
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-9 h-9 bg-[#1A73E8]"
            style={{ animation: 'morph-shape 8s ease-in-out infinite' }}
          >
            <BookOpen className="w-5 h-5 text-white" strokeWidth={2.2} />
          </span>
          <span className="text-[16px] font-bold text-[#202124]">T-CID 협력 수업설계</span>
        </a>

        <div className="flex items-center gap-1 md:gap-5">
          <div className="hidden md:flex items-center gap-5">
            {anchors.map(a => (
              <a
                key={a.href}
                href={a.href}
                className="text-[14px] font-semibold text-[#5F6368] hover:text-[#1A73E8] transition-colors focus-visible:outline-2 focus-visible:outline-[#1A73E8] focus-visible:outline-offset-2 rounded"
              >
                {a.label}
              </a>
            ))}
          </div>
          <a
            href="#login"
            className="rounded-full px-5 py-2.5 text-[14px] font-bold bg-[#1A73E8] text-white hover:bg-[#1558D6] transition-colors focus-visible:outline-2 focus-visible:outline-[#1A73E8] focus-visible:outline-offset-2"
          >
            바로 로그인
          </a>
        </div>
      </nav>
    </>
  )
}

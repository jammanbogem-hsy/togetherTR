'use client'

import { useEffect, useRef, useState } from 'react'

// 고정 상단 네비 — 최상단에선 투명, Hero를 벗어나면 M3 tonal surface(그림자 없음).
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
        className={`sticky top-0 z-50 h-16 flex items-center justify-between px-4 md:px-8 transition-colors duration-200 ${
          scrolled ? 'bg-[color-mix(in_srgb,var(--md-surface-container-low)_95%,transparent)] backdrop-blur-md' : 'bg-transparent'
        }`}
      >
        <a href="#login" className="m3-state flex items-center gap-3 rounded-full pr-3 py-1">
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--md-primary-container)]"
          >
            <span className="material-symbols-rounded text-[color:var(--md-on-primary-container)]" style={{ fontSize: 22 }}>menu_book</span>
          </span>
          <span className="text-[16px] font-bold text-[color:var(--md-on-surface)]">T-CID2.0 협력적 수업설계</span>
        </a>

        <div className="flex items-center gap-1 md:gap-2">
          <div className="hidden md:flex items-center gap-1">
            {anchors.map(a => (
              <a
                key={a.href}
                href={a.href}
                className="m3-state rounded-full px-4 py-2 text-[15px] font-medium text-[color:var(--md-on-surface-variant)] transition-colors"
              >
                {a.label}
              </a>
            ))}
          </div>
          <a
            href="#login"
            className="m3-state inline-flex items-center h-10 rounded-full px-6 text-[15px] font-medium bg-[var(--md-primary)] text-[color:var(--md-on-primary)]"
          >
            바로 로그인
          </a>
        </div>
      </nav>
    </>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'

// 스크롤 리빌 래퍼 — 뷰포트 진입 시 1회만 .reveal-in 부여 (IntersectionObserver 1개).
// prefers-reduced-motion은 globals.css append 블록에서 무효화.
export default function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: React.ReactNode
  className?: string
  delayMs?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? 'reveal-in' : ''} ${className}`}
      style={{ '--reveal-delay': `${delayMs}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

'use client'

import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// MD3 tokens — scoped locally (rendered outside `.m3-landing`).
const M3 = {
  '--md-primary': '#0B57D0',
  '--md-on-primary': '#FFFFFF',
  '--md-primary-container': '#D3E3FD',
  '--md-on-primary-container': '#041E49',
  '--md-surface': '#FFFFFF',
  '--md-on-surface': '#1F1F1F',
  '--md-on-surface-variant': '#444746',
  '--md-outline-variant': '#C4C7C5',
} as React.CSSProperties

interface OnboardingOverlayProps {
  svgRef: React.RefObject<SVGSVGElement | null>
  onDismiss: () => void
}

export default function OnboardingOverlay({ svgRef, onDismiss }: OnboardingOverlayProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Initial focus on the confirm button; restore focus to the opener on unmount.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    return () => { prev?.focus?.() }
  }, [])

  // Escape dismisses the onboarding dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onDismiss])

  if (typeof document === 'undefined') return null

  // Layout measurement of a caller-provided ref for spotlight positioning; this is a
  // read-only geometry lookup, not reactive state (unchanged from the original behavior).
  // eslint-disable-next-line react-hooks/refs
  const svgRect = svgRef.current?.getBoundingClientRect()
  const spotX = svgRect ? svgRect.left + svgRect.width / 2 : window.innerWidth / 2
  const spotY = svgRect ? svgRect.top + svgRect.height / 2 : window.innerHeight / 2
  const spotR = svgRect ? Math.min(svgRect.width, svgRect.height) * 0.38 : 220

  return createPortal(
    <div className="fixed inset-0 z-[15000] flex items-center justify-center pointer-events-auto" style={M3}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle ${spotR}px at ${spotX}px ${spotY}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.58) 100%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        className="absolute rounded-full border-2 pointer-events-none"
        style={{
          left: spotX - spotR * 0.68,
          top: spotY - spotR * 0.68,
          width: spotR * 1.36,
          height: spotR * 1.36,
          borderColor: 'var(--md-primary)',
          animation: 'kg-spotlight-pulse 2s ease-in-out infinite',
          boxShadow: '0 0 0 4px rgba(11,87,208,0.12), inset 0 0 32px rgba(11,87,208,0.08)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kg-onboarding-title"
        className="relative rounded-2xl overflow-hidden md-shadow-3 flex flex-col pointer-events-auto border bg-[var(--md-surface)] border-[var(--md-outline-variant)]"
        style={{ width: 'min(340px, calc(100vw - 2rem))', zIndex: 1 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ background: 'var(--md-primary-container)', borderColor: 'var(--md-outline-variant)' }}>
          <span style={{ color: 'var(--md-on-primary-container)' }} aria-hidden>
            <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor">
              <path d="M229.66,218.34l-50.07-50.07a88.21,88.21,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
            </svg>
          </span>
          <span id="kg-onboarding-title" className="text-[15px] font-semibold" style={{ color: 'var(--md-on-primary-container)' }}>중심 성취기준 설정 안내</span>
        </div>
        <div className="px-5 py-4 bg-[var(--md-surface)]">
          <p className="text-[14px] leading-relaxed mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
            그래프의 <span className="font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--md-on-primary-container)', background: 'var(--md-primary-container)' }}>노드를 우클릭</span>하여 중심 성취기준을 설정하세요.<br/>
            중심 노드 기준으로 교과 간 연결이 자동 분류됩니다.
          </p>
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            {[
              { label: '🛠 도구-활용', color: '#EF4444' },
              { label: '⚖️ 현상-가치', color: '#F97316' },
              { label: '🎨 내용-표현', color: '#22C55E' },
            ].map(({ label, color }) => (
              <span
                key={label}
                className="px-2 py-1 rounded-lg text-[12px] font-semibold text-white"
                style={{ background: color }}
              >
                {label}
              </span>
            ))}
          </div>
          <button
            ref={confirmRef}
            onClick={onDismiss}
            className="m3-state w-full py-2.5 rounded-full text-[14px] font-semibold"
            style={{ background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}
          >
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

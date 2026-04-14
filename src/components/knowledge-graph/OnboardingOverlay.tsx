'use client'

import React from 'react'
import { createPortal } from 'react-dom'

interface OnboardingOverlayProps {
  svgRef: React.RefObject<SVGSVGElement | null>
  onDismiss: () => void
}

export default function OnboardingOverlay({ svgRef, onDismiss }: OnboardingOverlayProps) {
  if (typeof document === 'undefined') return null

  const svgRect = svgRef.current?.getBoundingClientRect()
  const spotX = svgRect ? svgRect.left + svgRect.width / 2 : window.innerWidth / 2
  const spotY = svgRect ? svgRect.top + svgRect.height / 2 : window.innerHeight / 2
  const spotR = svgRect ? Math.min(svgRect.width, svgRect.height) * 0.38 : 220

  return createPortal(
    <div className="fixed inset-0 z-[15000] flex items-center justify-center pointer-events-auto">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle ${spotR}px at ${spotX}px ${spotY}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.58) 100%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        className="absolute rounded-full border-2 border-[#CE93D8] pointer-events-none"
        style={{
          left: spotX - spotR * 0.68,
          top: spotY - spotR * 0.68,
          width: spotR * 1.36,
          height: spotR * 1.36,
          animation: 'kg-spotlight-pulse 2s ease-in-out infinite',
          boxShadow: '0 0 0 4px rgba(123,31,162,0.12), inset 0 0 32px rgba(123,31,162,0.08)',
        }}
      />
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl flex flex-col pointer-events-auto"
        style={{ width: 340, zIndex: 1 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 bg-[#F3E5F5] border-b border-[#CE93D8]">
          <span className="text-[#7B1FA2]">
            <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor">
              <path d="M229.66,218.34l-50.07-50.07a88.21,88.21,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
            </svg>
          </span>
          <span className="text-sm font-semibold text-[#7B1FA2]">중심 성취기준 설정 안내</span>
        </div>
        <div className="bg-white px-5 py-4">
          <p className="text-xs text-[#5F6368] leading-relaxed mb-3">
            그래프의 <span className="font-semibold text-[#7B1FA2] bg-[#F3E5F5] px-1.5 py-0.5 rounded">노드를 우클릭</span>하여 중심 성취기준을 설정하세요.<br/>
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
                className="px-2 py-1 rounded-lg text-[10px] font-semibold text-white"
                style={{ background: color }}
              >
                {label}
              </span>
            ))}
          </div>
          <button
            onClick={onDismiss}
            className="w-full py-2 rounded-xl text-xs font-semibold text-white transition-colors"
            style={{ background: '#7B1FA2' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = '#6A1B9A' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = '#7B1FA2' }}
          >
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

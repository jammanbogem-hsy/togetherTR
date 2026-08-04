'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import type { GNode } from './types'
import { subjectColor, subjectName } from './constants'

// MD3 tokens — scoped locally because these portals render outside `.m3-landing`.
const M3 = {
  '--md-primary': '#0B57D0',
  '--md-on-primary': '#FFFFFF',
  '--md-primary-container': '#D3E3FD',
  '--md-on-primary-container': '#041E49',
  '--md-surface': '#FFFFFF',
  '--md-surface-container': '#F0F4F9',
  '--md-on-surface': '#1F1F1F',
  '--md-on-surface-variant': '#444746',
  '--md-outline': '#747775',
  '--md-outline-variant': '#C4C7C5',
} as React.CSSProperties

interface TooltipProps {
  nodeId: string
  x: number
  y: number
  rawNodes: GNode[]
}

export default function Tooltip({ nodeId, x, y, rawNodes }: TooltipProps) {
  if (typeof document === 'undefined') return null

  const tn = rawNodes.find(n => n.id === nodeId)
  if (!tn) return null

  const col = subjectColor(tn.subject_id)
  const simPct = tn.similarityScore !== undefined
    ? `유사도 ${Math.round(tn.similarityScore * 100)}%` : null
  const textPreview = (tn.text ?? '').length > 90
    ? (tn.text ?? '').slice(0, 90) + '…' : (tn.text ?? '')

  return createPortal(
    <div
      className="fixed z-[20000] pointer-events-none"
      style={{ ...M3, left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}
    >
      <div
        role="tooltip"
        className="relative rounded-xl md-shadow-3 border pr-3 py-2.5 pl-4 max-w-[300px] text-left bg-[var(--md-surface)] border-[var(--md-outline-variant)]"
        style={{ minWidth: 200 }}
      >
        {/* subject accent strip */}
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
          style={{ background: col }}
        />
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="font-mono font-bold text-base" style={{ color: col }}>
            {tn.label}
          </span>
          <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded" style={{ background: col + '18', color: col }}>
            {subjectName(tn.subject_id)}
          </span>
          {simPct && (
            <span className="text-[12px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
              {simPct}
            </span>
          )}
        </div>
        {textPreview && (
          <p className="text-[14px] leading-relaxed text-[color:var(--md-on-surface-variant)]">{textPreview}</p>
        )}
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-[-5px] w-2.5 h-2.5 rotate-45 border-r border-b bg-[var(--md-surface)] border-[var(--md-outline-variant)]"
      />
    </div>,
    document.body
  )
}

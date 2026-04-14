'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import type { GNode } from './types'
import { subjectColor, subjectName } from './constants'

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
      style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}
    >
      <div
        className="rounded-xl shadow-2xl border px-3 py-2.5 max-w-[300px] text-left"
        style={{ background: 'white', borderColor: col + '70', minWidth: 200 }}
      >
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="font-mono font-bold text-sm" style={{ color: col }}>
            {tn.label}
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: col + '18', color: col }}>
            {subjectName(tn.subject_id)}
          </span>
          {simPct && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
              {simPct}
            </span>
          )}
        </div>
        {textPreview && (
          <p className="text-xs text-gray-600 leading-relaxed">{textPreview}</p>
        )}
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-[-5px] w-2.5 h-2.5 rotate-45 border-r border-b"
        style={{ background: 'white', borderColor: col + '70' }}
      />
    </div>,
    document.body
  )
}

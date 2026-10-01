'use client'

// 노드 호버 툴팁 — 코드·교과·학년군·본문과 (있으면) 키워드, 관계 근거.

import { useLayoutEffect, useRef } from 'react'
import { placeMapTooltip, type Point, type Viewport } from './mapMath'
import { subjectIcon } from './subjectIcons'
import type { MapNode } from './types'

export interface MapTooltipProps {
  node: MapNode
  anchor: Point
  viewport: Viewport
  color: string
  /** 선택 노드와의 관계 근거 (Jev 관련 목록에 있을 때만) */
  relation?: { relationType: string; reason?: string; strength: number }
  /** 지금 강조된 연결이 에셋 유사도 이웃이라는 표시 (Jev 관계와 구분) */
  similarityNeighbor?: boolean
  /** 필터에 가려졌지만 관련 항목이라 점선으로 표시된 노드 */
  ghost?: boolean
}

export default function MapTooltip({
  node,
  anchor,
  viewport,
  color,
  relation,
  similarityNeighbor = false,
  ghost = false,
}: MapTooltipProps): React.ReactElement {
  const tooltipRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element) return
    const position = (): void => {
      const rect = element.getBoundingClientRect()
      const point = placeMapTooltip(anchor, rect, viewport)
      element.style.left = `${point.x}px`
      element.style.top = `${point.y}px`
      element.style.visibility = 'visible'
    }
    // Before paint, including when a different node has a longer description.
    position()
    const observer = new ResizeObserver(position)
    observer.observe(element)
    return () => observer.disconnect()
  }, [anchor, viewport])

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-none absolute z-10 overflow-hidden break-words rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-4 py-3"
      style={{
        visibility: 'hidden',
        width: Math.max(0, Math.min(340, viewport.width - 16)),
        maxHeight: Math.max(0, viewport.height - 16),
        boxShadow: '0 2px 6px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.1)',
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[13px] font-medium text-white"
          style={{ backgroundColor: color }}
        >
          {subjectIcon(node.subjectId) && (
            <span className="material-symbols-rounded text-[18px] leading-none">
              {subjectIcon(node.subjectId)}
            </span>
          )}
          {node.subject}
        </span>
        <span className="text-[15px] font-semibold text-[var(--md-on-surface)]">{node.code}</span>
        <span className="text-[13px] font-medium text-[var(--md-on-surface-variant)]">{node.band}</span>
        {ghost && (
          <span className="rounded-lg border border-dashed border-[var(--md-outline)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-surface-variant)]">
            필터에 가려짐
          </span>
        )}
      </div>
      <p className="text-[15px] leading-[1.5] text-[var(--md-on-surface)]">{node.text}</p>

      {node.keywords && node.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.keywords.slice(0, 6).map(k => (
            <span
              key={k}
              className="rounded-lg bg-[var(--md-surface-container-high)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-surface-variant)]"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      {!relation && similarityNeighbor && (
        <p className="mt-2 text-[13px] font-medium text-[var(--md-on-surface-variant)]">
          의미가 비슷한 이웃 — AI 관계 판정은 아닙니다
        </p>
      )}

      {relation && (
        <div className="mt-2.5 border-t border-[var(--md-outline-variant)] pt-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--md-on-surface)]">{relation.relationType}</span>
            <span className="text-[13px] font-medium tabular-nums text-[var(--md-on-surface-variant)]">
              강도 {Math.round(relation.strength * 100)}%
            </span>
          </div>
          {relation.reason && (
            <p className="text-[14px] leading-[1.5] text-[var(--md-on-surface-variant)]">{relation.reason}</p>
          )}
        </div>
      )}
    </div>
  )
}

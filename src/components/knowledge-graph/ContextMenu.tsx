'use client'

import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { GNode } from './types'
import { subjectColor, subjectName } from './constants'

// MD3 tokens — scoped locally (rendered outside `.m3-landing`).
const M3 = {
  '--md-primary': '#0B57D0',
  '--md-on-primary': '#FFFFFF',
  '--md-primary-container': '#D3E3FD',
  '--md-on-primary-container': '#041E49',
  '--md-surface': '#FFFFFF',
  '--md-surface-container-low': '#F8FAFD',
  '--md-surface-container': '#F0F4F9',
  '--md-on-surface': '#1F1F1F',
  '--md-on-surface-variant': '#444746',
  '--md-outline': '#747775',
  '--md-outline-variant': '#C4C7C5',
} as React.CSSProperties

interface ContextMenuProps {
  x: number
  y: number
  nodeId: string
  visibleNodes: GNode[]
  centerNodeId: string | null
  isLeader: boolean
  recommendedCenterIds: Map<string, string>
  currentUserName?: string
  onClose: () => void
  onSetCenter: (nodeId: string) => void
  onUnsetCenter: (nodeId: string) => void
  onRecommendCenter?: (nodeId: string, nodeName: string) => void
  onLocalRecommend: (nodeId: string, name: string) => void
  onShowPopup: (node: GNode) => void
}

interface MenuItem {
  id: string
  label: string
  tone: 'default' | 'primary' | 'active'
  disabled?: boolean
  onSelect: () => void
}

export default function ContextMenu({
  x, y, nodeId, visibleNodes, centerNodeId, isLeader,
  recommendedCenterIds, currentUserName,
  onClose, onSetCenter, onUnsetCenter,
  onRecommendCenter, onLocalRecommend, onShowPopup,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Initial focus on the first menu item; restore focus on unmount.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    itemRefs.current[0]?.focus()
    return () => { prev?.focus?.() }
  }, [])

  if (typeof document === 'undefined') return null

  const ctxNode = visibleNodes.find(n => n.id === nodeId)
  if (!ctxNode) return null

  const isAlreadyCenter = nodeId === centerNodeId
  const isRecommended = recommendedCenterIds.has(nodeId)

  const items: MenuItem[] = []
  if (isLeader) {
    items.push({
      id: 'center',
      label: isAlreadyCenter ? '★ 중심 해제' : '★ 중심 성취기준으로 설정',
      tone: isAlreadyCenter ? 'active' : 'default',
      onSelect: () => {
        if (isAlreadyCenter) onUnsetCenter(nodeId)
        else onSetCenter(nodeId)
        onClose()
      },
    })
  } else {
    items.push({
      id: 'recommend',
      label: isRecommended ? '> 추천 완료' : '> 중심으로 추천',
      tone: isRecommended ? 'active' : 'default',
      disabled: isRecommended,
      onSelect: () => {
        if (isRecommended) return
        if (onRecommendCenter) onRecommendCenter(nodeId, ctxNode.label)
        else onLocalRecommend(nodeId, currentUserName ?? '팀원')
        onClose()
      },
    })
  }
  items.push({
    id: 'detail',
    label: '상세 보기',
    tone: 'primary',
    onSelect: () => { onShowPopup(ctxNode); onClose() },
  })

  function handleKeyDown(e: React.KeyboardEvent) {
    const focusable = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
    if (focusable.length === 0) return
    const idx = focusable.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusable[(idx + 1) % focusable.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusable[(idx - 1 + focusable.length) % focusable.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusable[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      focusable[focusable.length - 1]?.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000]"
      onClick={onClose}
      onContextMenu={e => { e.preventDefault(); onClose() }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${ctxNode.label} 성취기준 작업 메뉴`}
        className="absolute rounded-xl md-shadow-3 border py-1.5 min-w-[210px] max-w-[280px] bg-[var(--md-surface-container-low)] border-[var(--md-outline-variant)]"
        style={{ ...M3, left: x, top: y }}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="px-3 py-1.5 mb-1 border-b border-[var(--md-outline-variant)]">
          <span className="font-mono font-bold text-[14px]" style={{ color: subjectColor(ctxNode.subject_id) }}>
            {ctxNode.label}
          </span>
          <span className="text-[13px] ml-1" style={{ color: 'var(--md-on-surface-variant)' }}>{subjectName(ctxNode.subject_id)}</span>
        </div>

        <div className="px-1">
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={el => { itemRefs.current[i] = el }}
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled ? true : undefined}
              className={`m3-state w-full text-left px-3 py-2.5 text-[14px] rounded-lg flex items-center gap-2 ${item.tone === 'default' ? 'font-medium' : 'font-bold'} ${item.disabled ? 'cursor-default' : ''}`}
              style={{ color: item.tone === 'default' ? 'var(--md-on-surface)' : 'var(--md-primary)' }}
              onClick={item.onSelect}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import type { GNode } from './types'
import { subjectColor, subjectName } from './constants'

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

export default function ContextMenu({
  x, y, nodeId, visibleNodes, centerNodeId, isLeader,
  recommendedCenterIds, currentUserName,
  onClose, onSetCenter, onUnsetCenter,
  onRecommendCenter, onLocalRecommend, onShowPopup,
}: ContextMenuProps) {
  if (typeof document === 'undefined') return null

  const ctxNode = visibleNodes.find(n => n.id === nodeId)
  if (!ctxNode) return null

  const isAlreadyCenter = nodeId === centerNodeId
  const isRecommended = recommendedCenterIds.has(nodeId)

  return createPortal(
    <div
      className="fixed inset-0 z-[10000]"
      onClick={onClose}
      onContextMenu={e => { e.preventDefault(); onClose() }}
    >
      <div
        className="absolute bg-white rounded-xl shadow-2xl border border-gray-200 py-1 min-w-[200px]"
        style={{ left: x, top: y }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 border-b border-gray-100">
          <span className="font-mono font-bold text-sm" style={{ color: subjectColor(ctxNode.subject_id) }}>
            {ctxNode.label}
          </span>
          <span className="text-[12px] text-gray-400 ml-1">{subjectName(ctxNode.subject_id)}</span>
        </div>

        {isLeader && (
          <button
            className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex items-center gap-2 ${isAlreadyCenter ? 'text-amber-600 font-bold' : 'text-gray-700'}`}
            onClick={() => {
              if (isAlreadyCenter) onUnsetCenter(nodeId)
              else onSetCenter(nodeId)
              onClose()
            }}
          >
            <span>{isAlreadyCenter ? '★ 중심 해제' : '★ 중심 성취기준으로 설정'}</span>
          </button>
        )}

        {!isLeader && (
          <button
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
              isRecommended
                ? 'text-amber-500 bg-amber-50 font-bold cursor-default'
                : 'hover:bg-amber-50 text-gray-700'
            }`}
            onClick={() => {
              if (isRecommended) return
              if (onRecommendCenter) {
                onRecommendCenter(nodeId, ctxNode.label)
              } else {
                onLocalRecommend(nodeId, currentUserName ?? '팀원')
              }
              onClose()
            }}
          >
            <span>{isRecommended ? '> 추천 완료' : '> 중심으로 추천'}</span>
          </button>
        )}

        <button
          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-blue-600 flex items-center gap-2"
          onClick={() => { onShowPopup(ctxNode); onClose() }}
        >
          <span>상세 보기</span>
        </button>
      </div>
    </div>,
    document.body
  )
}

'use client'

import React, { useEffect, useState } from 'react'
import type { GNode, GraphPinnedStandard } from './types'
import { SUBJECT_NAMES, subjectColor, subjectName } from './constants'

interface StandardsBrowserProps {
  onClose: () => void
  rawNodes: GNode[]
  checkedStandards: Set<string>
  nodesRef: React.MutableRefObject<GNode[]>
  svgWidth: number
  svgHeight: number
  pinnedStandards: GraphPinnedStandard[]
  currentUserName?: string
  onAddNode: (node: GNode) => void
  onPinChange?: (pins: GraphPinnedStandard[]) => void
  applyCheckedStandards: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
}

export default function StandardsBrowser({
  onClose, rawNodes, checkedStandards, nodesRef, svgWidth, svgHeight,
  pinnedStandards, currentUserName, onAddNode, onPinChange, applyCheckedStandards,
}: StandardsBrowserProps) {
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  const [gradeFilter, setGradeFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [allStandards, setAllStandards] = useState<Array<{
    id: string; code: string; subject_id: string; grade_band?: string
    area?: string; text: string; keywords?: string[]
  }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (allStandards.length > 0) return
    setLoading(true)
    const params = new URLSearchParams({ browseAll: 'true' })
    if (subjectFilter) params.set('subject', subjectFilter)
    fetch(`/api/knowledge-graph?${params}`)
      .then(r => r.json())
      .then(data => { if (data.standards) setAllStandards(data.standards) })
      .catch(() => {})
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = searchQuery.trim().toLowerCase()
  const filtered = allStandards.filter(n => {
    if (subjectFilter && n.subject_id !== subjectFilter) return false
    if (gradeFilter && !n.grade_band?.includes(gradeFilter)) return false
    if (q && !n.code.toLowerCase().includes(q) && !n.text.toLowerCase().includes(q)) return false
    return true
  })

  // [2026-05-14] 사용자 요청 — 교과 → 영역 → 학년 순으로 계층 그룹화·정렬.
  const GRADE_ORDER = ['초1-2', '초3-4', '초5-6']
  const gradeSortKey = (gb?: string): number => {
    if (!gb) return 999
    const idx = GRADE_ORDER.indexOf(gb)
    return idx >= 0 ? idx : 999
  }
  const grouped: Record<string, Record<string, typeof filtered>> = {}
  for (const n of filtered) {
    const s = n.subject_id ?? 'unknown'
    const area = (n.area && n.area.trim()) ? n.area : '기타'
    if (!grouped[s]) grouped[s] = {}
    if (!grouped[s][area]) grouped[s][area] = []
    grouped[s][area].push(n)
  }
  // 영역 안에서 학년 → 코드 순 정렬
  for (const s of Object.keys(grouped)) {
    for (const a of Object.keys(grouped[s])) {
      grouped[s][a].sort((x, y) => {
        const g = gradeSortKey(x.grade_band) - gradeSortKey(y.grade_band)
        if (g !== 0) return g
        return (x.code || '').localeCompare(y.code || '')
      })
    }
  }

  return (
    <div className="absolute inset-0 z-40 bg-white flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none font-bold">←</button>
        <span className="font-bold text-[14px] text-gray-800">전체 성취기준</span>
        <input
          type="text"
          placeholder="코드·키워드 검색…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 text-[12px] border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-[#CE93D8]"
        />
      </div>

      <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => setSubjectFilter(null)} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${!subjectFilter ? 'bg-[#7B1FA2] text-white border-[#7B1FA2]' : 'text-gray-500 border-gray-200'}`}>전체 교과</button>
          {Object.entries(SUBJECT_NAMES).map(([id, name]) => {
            const col = subjectColor(id)
            return (
              <button key={id} onClick={() => setSubjectFilter(subjectFilter === id ? null : id)}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all"
                style={subjectFilter === id ? { background: col, color: 'white', borderColor: col } : { color: col, borderColor: col + '60', background: col + '10' }}>
                {name}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {['초1-2', '초3-4', '초5-6'].map(g => (
            <button key={g} onClick={() => setGradeFilter(gradeFilter === g ? null : g)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${gradeFilter === g ? 'bg-gray-700 text-white border-gray-700' : 'text-gray-500 border-gray-200'}`}>
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-[12px] text-gray-400">
            <span className="w-4 h-4 rounded-full border-2 border-gray-200 border-t-[#7B1FA2] animate-spin" />
            성취기준 불러오는 중…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] text-gray-400 text-center py-8">성취기준 없음</p>
        ) : (
          Object.entries(grouped).map(([subId, byArea]) => {
            const totalCount = Object.values(byArea).reduce((sum, arr) => sum + arr.length, 0)
            return (
            <div key={subId} className="mb-4">
              <div className="text-[11px] font-bold mb-2 flex items-center gap-1.5" style={{ color: subjectColor(subId) }}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: subjectColor(subId) }} />
                {subjectName(subId)} ({totalCount})
              </div>
              {Object.entries(byArea).map(([area, nodes]) => (
              <div key={area} className="mb-3 ml-1.5 pl-2 border-l-2" style={{ borderColor: subjectColor(subId) + '40' }}>
                <div className="text-[10px] font-semibold text-gray-500 mb-1.5">{area} <span className="text-gray-400">({nodes.length})</span></div>
                <div className="space-y-1.5">
                  {nodes.map(n => {
                  const alreadyIn = checkedStandards.has(n.id) || rawNodes.some(rn => rn.id === n.id)
                  return (
                    <div key={n.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${alreadyIn ? 'border-[#CE93D8]/50 bg-[#F3E5F5]/30' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-mono font-bold text-[12px]" style={{ color: subjectColor(subId) }}>{n.code}</span>
                          {n.grade_band && <span className="text-[10px] text-gray-400">{n.grade_band}</span>}
                        </div>
                        <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-2">{n.text}</p>
                      </div>
                      <button
                        onClick={() => {
                          if (alreadyIn) return
                          const existing = nodesRef.current.find(nd => nd.id === n.id)
                          if (!existing) {
                            const newNode: GNode = {
                              id: n.id, type: 'standard', label: n.code,
                              text: n.text, subject_id: n.subject_id, grade_band: n.grade_band,
                              area: n.area, keywords: n.keywords, group: n.subject_id ?? 'unknown',
                              x: svgWidth / 2 + (Math.random() - 0.5) * 300,
                              y: svgHeight / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0,
                            }
                            onAddNode(newNode)
                          }
                          applyCheckedStandards(prev => new Set([...prev, n.id]))
                          if (onPinChange) onPinChange([...pinnedStandards, { stdId: n.id, addedBy: currentUserName ?? '나', source: 'manual' }])
                          onClose()
                        }}
                        disabled={alreadyIn}
                        className={`shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors ${alreadyIn ? 'bg-gray-100 text-gray-400 cursor-default' : 'bg-[#7B1FA2] text-white hover:bg-[#6A1B9A]'}`}
                      >
                        {alreadyIn ? '추가됨' : '추가하기'}
                      </button>
                    </div>
                  )
                  })}
                </div>
              </div>
              ))}
            </div>
            )
          })
        )}
      </div>
    </div>
  )
}

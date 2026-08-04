'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { GNode, GraphPinnedStandard } from './types'
import { SUBJECT_NAMES, subjectColor, subjectName } from './constants'

// MD3 tokens — scoped locally (rendered outside `.m3-landing`).
const M3 = {
  '--md-primary': '#0B57D0',
  '--md-on-primary': '#FFFFFF',
  '--md-primary-container': '#D3E3FD',
  '--md-on-primary-container': '#041E49',
  '--md-surface': '#FFFFFF',
  '--md-surface-container': '#F0F4F9',
  '--md-surface-container-high': '#E9EEF6',
  '--md-surface-container-highest': '#DDE3EA',
  '--md-on-surface': '#1F1F1F',
  '--md-on-surface-variant': '#444746',
  '--md-outline': '#747775',
  '--md-outline-variant': '#C4C7C5',
} as React.CSSProperties

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

  const searchRef = useRef<HTMLInputElement>(null)

  // Dialog behavior: initial focus on search; restore focus to the opener on unmount.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    searchRef.current?.focus()
    return () => { prev?.focus?.() }
  }, [])

  // Escape closes the browser overlay.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kg-standards-title"
      className="absolute inset-0 z-40 flex flex-col bg-[var(--md-surface)]"
      style={M3}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--md-outline-variant)] shrink-0">
        <button
          onClick={onClose}
          aria-label="전체 성취기준 닫기"
          className="m3-state rounded-full w-9 h-9 flex items-center justify-center text-xl leading-none font-bold"
          style={{ color: 'var(--md-on-surface-variant)' }}
        >
          ←
        </button>
        <span id="kg-standards-title" className="font-bold text-[16px]" style={{ color: 'var(--md-on-surface)' }}>전체 성취기준</span>
        <input
          ref={searchRef}
          type="text"
          aria-label="성취기준 코드·키워드 검색"
          placeholder="코드·키워드 검색…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="m3-field flex-1 text-[14px] px-3 py-2 outline-none"
          style={{ color: 'var(--md-on-surface)' }}
        />
      </div>

      <div className="px-4 py-2 border-b border-[var(--md-outline-variant)] flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setSubjectFilter(null)}
            aria-pressed={!subjectFilter}
            className="m3-state px-3 py-1 rounded-full text-[13px] font-semibold border transition-colors"
            style={!subjectFilter
              ? { background: 'var(--md-primary)', color: 'var(--md-on-primary)', borderColor: 'var(--md-primary)' }
              : { color: 'var(--md-on-surface-variant)', borderColor: 'var(--md-outline-variant)', background: 'transparent' }}
          >
            전체 교과
          </button>
          {Object.entries(SUBJECT_NAMES).map(([id, name]) => {
            const col = subjectColor(id)
            return (
              <button key={id} onClick={() => setSubjectFilter(subjectFilter === id ? null : id)}
                aria-pressed={subjectFilter === id}
                className="m3-state px-3 py-1 rounded-full text-[13px] font-semibold border transition-all"
                style={subjectFilter === id ? { background: col, color: 'white', borderColor: col } : { color: col, borderColor: col + '60', background: col + '10' }}>
                {name}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {['초1-2', '초3-4', '초5-6'].map(g => (
            <button key={g} onClick={() => setGradeFilter(gradeFilter === g ? null : g)}
              aria-pressed={gradeFilter === g}
              className="m3-state px-3 py-1 rounded-full text-[13px] font-semibold border transition-colors"
              style={gradeFilter === g
                ? { background: 'var(--md-on-surface)', color: 'var(--md-surface)', borderColor: 'var(--md-on-surface)' }
                : { color: 'var(--md-on-surface-variant)', borderColor: 'var(--md-outline-variant)', background: 'transparent' }}>
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 panel-scroll">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-[14px]" style={{ color: 'var(--md-on-surface-variant)' }}>
            <span className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--md-outline-variant)', borderTopColor: 'var(--md-primary)' }} />
            성취기준 불러오는 중…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-[14px] text-center py-8" style={{ color: 'var(--md-on-surface-variant)' }}>성취기준 없음</p>
        ) : (
          Object.entries(grouped).map(([subId, byArea]) => {
            const totalCount = Object.values(byArea).reduce((sum, arr) => sum + arr.length, 0)
            return (
            <div key={subId} className="mb-4">
              <div className="text-[14px] font-bold mb-2 flex items-center gap-1.5" style={{ color: subjectColor(subId) }}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: subjectColor(subId) }} />
                {subjectName(subId)} ({totalCount})
              </div>
              {Object.entries(byArea).map(([area, nodes]) => (
              <div key={area} className="mb-3 ml-1.5 pl-2 border-l-2" style={{ borderColor: subjectColor(subId) + '40' }}>
                <div className="text-[13px] font-semibold mb-1.5" style={{ color: 'var(--md-on-surface-variant)' }}>{area} <span style={{ color: 'var(--md-outline)' }}>({nodes.length})</span></div>
                <div className="space-y-1.5">
                  {nodes.map(n => {
                  const alreadyIn = checkedStandards.has(n.id) || rawNodes.some(rn => rn.id === n.id)
                  return (
                    <div
                      key={n.id}
                      className={alreadyIn
                        ? 'flex items-start gap-3 rounded-xl border px-3 py-2.5 border-[var(--md-primary)] bg-[var(--md-primary-container)]'
                        : 'flex items-start gap-3 rounded-xl border px-3 py-2.5 border-[var(--md-outline-variant)] bg-[var(--md-surface)] transition-colors hover:border-[var(--md-outline)]'}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-mono font-bold text-[14px]" style={{ color: subjectColor(subId) }}>{n.code}</span>
                          {n.grade_band && <span className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>{n.grade_band}</span>}
                        </div>
                        <p className="text-[14px] leading-relaxed line-clamp-2" style={{ color: 'var(--md-on-surface-variant)' }}>{n.text}</p>
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
                        aria-label={alreadyIn ? `${n.code} 이미 추가됨` : `${n.code} 그래프에 추가하기`}
                        className={`m3-state shrink-0 text-[13px] font-semibold px-3 py-2 rounded-full ${alreadyIn ? 'cursor-default' : ''}`}
                        style={alreadyIn
                          ? { background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface-variant)' }
                          : { background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}
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

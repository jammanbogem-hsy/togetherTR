'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

interface ContentItem {
  id: string
  subject: string
  course: string
  area: string
  gradeBands: string[]
  coreIdeas: string[]
  knowledge: string[]
  functions: string[]
  attitudes: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  onInsert: (text: string) => void
}

const SUBJECT_CHIPS = [
  { id: '국어', label: '국어' }, { id: '수학', label: '수학' },
  { id: '과학', label: '과학' }, { id: '사회', label: '사회' },
  { id: '도덕', label: '도덕' }, { id: '미술', label: '미술' },
  { id: '음악', label: '음악' }, { id: '체육', label: '체육' },
  { id: '영어', label: '영어' }, { id: '실과', label: '실과' },
]

export function CoreIdeaFinderModal({ open, onClose, onInsert }: Props) {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(open)
  const [prevOpen, setPrevOpen] = useState(open)
  const [requestNumber, setRequestNumber] = useState(open ? 1 : 0)
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')

  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setLoading(true)
      setRequestNumber(requestNumber + 1)
    }
  }

  useEffect(() => {
    if (!open) return
    fetch('/api/core-ideas')
      .then(r => r.json())
      .then(d => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, requestNumber])

  const filtered = useMemo(() => {
    let result = items
    if (selectedSubject) result = result.filter(i => i.subject.includes(selectedSubject) || i.course.includes(selectedSubject))
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      result = result.filter(i =>
        i.area.toLowerCase().includes(q) ||
        i.coreIdeas.some(ci => ci.toLowerCase().includes(q)) ||
        i.knowledge.some(k => k.toLowerCase().includes(q)) ||
        i.functions.some(f => f.toLowerCase().includes(q))
      )
    }
    return result
  }, [items, selectedSubject, searchText])

  function handleSelect(item: ContentItem, coreIdea: string) {
    const parts = [`[${item.subject} · ${item.area}]`]
    parts.push(`핵심 아이디어: ${coreIdea}`)
    if (item.knowledge.length > 0) parts.push(`지식·이해: ${item.knowledge.slice(0, 5).join(', ')}`)
    if (item.functions.length > 0) parts.push(`과정·기능: ${item.functions.slice(0, 4).join(', ')}`)
    onInsert(parts.join('\n'))
    onClose()
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden flex flex-col"
        style={{ maxWidth: 720, maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-[#DADCE0] bg-[#F8F9FA]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#202124]">핵심아이디어 찾기</h2>
            <button onClick={onClose} className="text-[#5F6368] hover:text-[#202124] text-xl">×</button>
          </div>
          {/* 교과 칩 */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setSelectedSubject(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${!selectedSubject ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#5F6368] hover:bg-[#E8EAED]'}`}
            >
              전체
            </button>
            {SUBJECT_CHIPS.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSubject(s.id === selectedSubject ? null : s.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${selectedSubject === s.id ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#5F6368] hover:bg-[#E8EAED]'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* 검색 */}
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="영역, 핵심아이디어, 지식·이해 검색..."
            className="w-full px-3 py-2 rounded-lg border border-[#DADCE0] text-sm focus:outline-none focus:border-[#1A73E8]"
          />
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-sm text-[#9AA0A6]">내용체계 로딩 중...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#9AA0A6]">검색 결과가 없습니다</div>
          ) : (
            <div className="divide-y divide-[#F1F3F4]">
              {filtered.map(item => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F0FE] text-[#1A73E8]">{item.subject}</span>
                    <span className="text-xs font-semibold text-[#5F6368]">{item.area}</span>
                    {item.gradeBands.length > 0 && <span className="text-[10px] text-[#9AA0A6]">{item.gradeBands.join(', ')}</span>}
                  </div>
                  {/* 핵심아이디어 */}
                  {item.coreIdeas.slice(0, 3).map((ci, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelect(item, ci)}
                      className="w-full text-left mb-2 p-3 rounded-xl border border-[#DADCE0] hover:border-[#1A73E8] hover:bg-[#F8FBFF] transition group"
                    >
                      <p className="text-sm text-[#202124] leading-relaxed mb-1.5 group-hover:text-[#1A73E8]">{ci}</p>
                      <div className="flex flex-wrap gap-1">
                        {item.knowledge.slice(0, 4).map((k, j) => (
                          <span key={`k-${j}`} className="text-[10px] px-1.5 py-0.5 rounded bg-[#E8F0FE] text-[#1A73E8]">{k}</span>
                        ))}
                        {item.functions.slice(0, 3).map((f, j) => (
                          <span key={`f-${j}`} className="text-[10px] px-1.5 py-0.5 rounded bg-[#E6F4EA] text-[#137333]">{f}</span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

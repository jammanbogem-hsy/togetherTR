'use client'

import { useState, useEffect, useMemo } from 'react'
import { Check, ArrowRight } from '@phosphor-icons/react'
import { CurriculumFinderDialog, FINDER_CHIP, FINDER_ACTIVE, FINDER_INACTIVE } from './CurriculumFinderDialog'
import { cn } from '@/lib/utils'

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

  return <CurriculumFinderDialog
    open={open} onClose={onClose} title="핵심아이디어 찾기"
    description="교과와 영역의 핵심아이디어를 확인하고, 원하는 내용을 눌러 채팅에 넣으세요."
    filters={<>
      <div>
        <p className="mb-2 text-sm font-medium text-[#444746]">교과</p>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
          <button onClick={() => setSelectedSubject(null)} aria-pressed={!selectedSubject} className={cn(FINDER_CHIP, !selectedSubject ? FINDER_ACTIVE : FINDER_INACTIVE)}>{!selectedSubject && <Check size={16} />}전체</button>
          {SUBJECT_CHIPS.map(subject => <button key={subject.id} onClick={() => setSelectedSubject(subject.id === selectedSubject ? null : subject.id)} aria-pressed={selectedSubject === subject.id} className={cn(FINDER_CHIP, selectedSubject === subject.id ? FINDER_ACTIVE : FINDER_INACTIVE)}>{selectedSubject === subject.id && <Check size={16} />}{subject.label}</button>)}
        </div>
      </div>
      <label className="block text-sm font-medium text-[#444746]">검색
        <input aria-label="핵심아이디어 검색" value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="영역·핵심아이디어·지식·이해 검색" className="mt-1 min-h-12 w-full rounded-xl border border-[#747775] bg-white px-4 text-base text-[#1F1F1F] placeholder:text-[#5F6368] focus:outline-2 focus:outline-[#0B57D0]" />
      </label>
    </>}
    footer={<p className="text-[#444746]">검색 결과 <strong className="text-[#0842A0]">{filtered.length}</strong>개 영역 · 핵심아이디어를 누르면 채팅에 넣습니다.</p>}
  >
    {loading ? <p role="status" className="py-12 text-center text-base text-[#444746]">내용체계를 불러오는 중…</p>
      : filtered.length === 0 ? <p className="py-12 text-center text-base text-[#444746]">검색 결과가 없습니다.</p>
      : <div className="space-y-6">{filtered.map(item => <section key={item.id}>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#E9EEF6] px-4 py-3">
          <h3 className="text-lg font-semibold text-[#1F1F1F]">{item.subject} · {item.area}</h3>
          {item.gradeBands.length > 0 && <span className="text-sm text-[#444746]">{item.gradeBands.join(', ')}</span>}
        </div>
        <div className="space-y-3">{item.coreIdeas.map((idea, index) => <button key={index} onClick={() => handleSelect(item, idea)} className="group w-full rounded-2xl border border-[#C4C7C5] bg-white p-4 text-left transition-colors hover:border-[#0B57D0] hover:bg-[#E8F0FE] focus-visible:outline-2 focus-visible:outline-[#0B57D0]">
          <p className="text-base leading-relaxed text-[#1F1F1F] sm:text-lg [word-break:keep-all] [overflow-wrap:anywhere]">{idea}</p>
          {item.knowledge.length > 0 && <p className="mt-3 text-sm leading-relaxed text-[#444746]"><span className="font-semibold text-[#0842A0]">지식·이해</span> · {item.knowledge.slice(0, 4).join(' · ')}</p>}
          {item.functions.length > 0 && <p className="mt-2 text-sm leading-relaxed text-[#444746]"><span className="font-semibold text-[#0D652D]">과정·기능</span> · {item.functions.slice(0, 3).join(' · ')}</p>}
          <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#0842A0]">채팅에 넣기 <ArrowRight size={18} /></span>
        </button>)}</div>
      </section>)}</div>}
  </CurriculumFinderDialog>
}

'use client'

import { useEffect, useState } from 'react'
import { SheetAppBar } from '@/components/chat/curriculum-sheet/SheetAppBar'
import { MD3Button } from '@/components/ui/MD3Button'

export function GraphWorkspaceHeader({ keyword, isLeader, onBack, onSearch }: {
  keyword: string
  isLeader: boolean
  onBack: () => void
  onSearch: (keyword: string) => void
}) {
  const [query, setQuery] = useState(keyword)
  useEffect(() => { setQuery(keyword) }, [keyword])

  return (
    <div className="m3-sheet shrink-0">
      <SheetAppBar
        title="교육과정 융합 지식 그래프"
        supporting="교육과정 분석시트 · 성취기준 연결과 수업 예시"
        elevated={false}
        onClose={onBack}
        closeLabel="분석시트로 돌아가기"
      >
        <span className="hidden rounded-full bg-[var(--md-secondary-container)] px-3 py-1.5 text-[12px] font-medium text-[var(--md-on-secondary-container)] sm:inline-flex">
          {isLeader ? '팀 공유 중 · 팀장' : '팀 공유 중'}
        </span>
      </SheetAppBar>
      <form
        role="search"
        aria-label="수업 주제 검색"
        className="flex items-center gap-3 border-b border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] px-4 py-3"
        onSubmit={event => { event.preventDefault(); if (query.trim()) onSearch(query.trim()) }}
      >
        <label htmlFor="graph-topic-input" className="hidden shrink-0 text-[14px] font-medium text-[var(--md-on-surface-variant)] sm:block">수업 주제</label>
        <input id="graph-topic-input" type="search" value={query} onChange={event => setQuery(event.target.value)}
          aria-label="수업 주제 검색어" placeholder="수업 주제로 관련 성취기준 찾기"
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-4 text-[14px] text-[var(--md-on-surface)]"
        />
        <MD3Button type="submit" variant="filled" disabled={!query.trim()}>검색</MD3Button>
      </form>
    </div>
  )
}

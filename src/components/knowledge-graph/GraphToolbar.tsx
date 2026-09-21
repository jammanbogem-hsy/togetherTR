'use client'

import { SheetSegmented, SheetToolbar } from '@/components/chat/curriculum-sheet/SheetToolbar'
import type { GraphRelationFilter } from './types'
import { RELATION_COLORS } from './constants'

export function GraphToolbar({ algoMode, relFilter, helpOpen, isLeader, onAlgoModeChange, onRelFilterChange, onToggleHelp }: {
  algoMode: 'keyword' | 'semantic' | 'hybrid'
  relFilter: GraphRelationFilter
  helpOpen: boolean
  isLeader: boolean
  onAlgoModeChange: (mode: 'keyword' | 'semantic' | 'hybrid') => void
  onRelFilterChange: (filter: GraphRelationFilter) => void
  onToggleHelp: () => void
}) {
  return (
    <div className="shrink-0">
      <SheetToolbar helpOpen={helpOpen} onToggleHelp={onToggleHelp}
        helpText={`왼쪽에서 성취기준을 켜고 끄고, 노드를 누르면 내용을 확인할 수 있습니다. 노드를 우클릭하거나 키보드에서 Shift+F10을 눌러 중심으로 ${isLeader ? '설정' : '추천'}하세요. 연결을 분석해 수업 예시를 만든 뒤 팀장이 저장하면 분석시트에 반영됩니다.`}
      >
        <span className="text-[14px] font-medium text-[var(--md-on-surface-variant)]">검색 방식</span>
        <SheetSegmented compact ariaLabel="검색 방식" value={algoMode} onChange={onAlgoModeChange}
          options={[
            { value: 'keyword', label: '키워드', title: '키워드 기반 검색' },
            { value: 'semantic', label: '의미망', title: '개념과 맥락 기반 검색' },
            { value: 'hybrid', label: '통합', title: '의미망과 키워드 통합 검색' },
          ]}
        />
      </SheetToolbar>
      <div role="group" aria-label="관계 필터" className="flex items-center gap-2 overflow-x-auto border-b border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-4 py-2">
        <span className="shrink-0 text-[14px] font-medium text-[var(--md-on-surface-variant)]">관계</span>
        {(['all', ...Object.keys(RELATION_COLORS)] as GraphRelationFilter[]).map(relation => (
          <button key={relation} type="button" onClick={() => onRelFilterChange(relation)} aria-pressed={relFilter === relation}
            className={`m3-state inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium ${relFilter === relation ? 'border-transparent bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]' : 'border-[var(--md-outline-variant)] text-[var(--md-on-surface-variant)]'}`}
          >
            {relation !== 'all' && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: RELATION_COLORS[relation] }} />}
            {relation === 'all' ? '전체' : relation}
          </button>
        ))}
      </div>
    </div>
  )
}

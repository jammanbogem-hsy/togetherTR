'use client'

// 교육과정 분석맵 — 초등 성취기준 전체를 하나의 지식맵으로 보는 독립 화면.
// (app) 레이아웃이 로그인 보호를 담당하므로 여기서는 인증을 다루지 않는다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Search, X } from 'lucide-react'
import CurriculumMapCanvas from '@/components/curriculum-map/CurriculumMapCanvas'
import MapSidePanel from '@/components/curriculum-map/MapSidePanel'
import { useCurriculumMap } from '@/components/curriculum-map/useCurriculumMap'

export default function CurriculumMapPage(): React.ReactElement {
  const router = useRouter()
  const map = useCurriculumMap()
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)

  const subjectColors = useMemo(() => {
    const record: Record<string, string> = {}
    for (const s of map.asset?.subjects ?? []) record[s.id] = s.color
    return record
  }, [map.asset])

  const selectedNode = map.selectedId ? map.nodeById.get(map.selectedId) ?? null : null

  // 결과·관련 항목 클릭 → 선택 + 카메라 이동 (패널이 접혀 있으면 펼친다)
  const focusNode = useCallback((id: string) => {
    map.selectNode(id)
    setFocusRequest({ id, nonce: Date.now() })
    setPanelOpen(true)
  }, [map])

  // Esc: 선택 → 검색 순으로 해제
  const { selectedId, selectNode, clearSearch } = map
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (selectedId) {
        selectNode(null)
        return
      }
      clearSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSearch, selectNode, selectedId])

  const onSubmitSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    map.runSearch()
    setPanelOpen(true)
  }, [map])

  return (
    <div className="flex h-screen flex-col bg-[#F8F9FA]">
      {/* ── 상단 바 ───────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-[#DADCE0] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1 text-[13px] font-bold text-[#5F6368] hover:text-[#1A73E8] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            대시보드
          </button>
          <h1 className="text-[16px] font-extrabold text-[#202124]">교육과정 분석맵</h1>

          <form onSubmit={onSubmitSearch} className="ml-auto flex items-center gap-2 order-3 w-full sm:order-none sm:w-auto">
            <div className="relative flex-1 sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA0A6]" />
              <input
                value={map.query}
                onChange={e => map.setQuery(e.target.value)}
                placeholder="수업 주제나 키워드로 성취기준 찾기"
                className="w-full rounded-xl border-2 border-[#DADCE0] bg-white py-2 pl-9 pr-8 text-[13px] font-medium text-[#202124] placeholder:text-[#BDC1C6] focus:border-[#1A73E8] focus:outline-none"
              />
              {map.query && (
                <button
                  type="button"
                  onClick={map.clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9AA0A6] hover:text-[#5F6368]"
                  aria-label="검색어 지우기"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={map.search.status === 'loading' || !map.query.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-[#1A73E8] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#1557B0] disabled:opacity-40 transition-colors"
            >
              {map.search.status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
              찾기
            </button>
            <button
              type="button"
              onClick={() => setPanelOpen(o => !o)}
              className="rounded-xl border-2 border-[#DADCE0] px-3 py-2 text-[12px] font-bold text-[#5F6368] hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
              aria-expanded={panelOpen}
            >
              {panelOpen ? '패널 접기' : '패널 펼치기'}
            </button>
          </form>
        </div>

        {/* 교과 범례 */}
        {map.asset && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {map.asset.subjects.map(s => (
              <span key={s.id} className="flex items-center gap-1 text-[11px] font-semibold text-[#5F6368]">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </span>
            ))}
            <span className="text-[11px] font-semibold text-[#BDC1C6]">
              성취기준 {map.asset.nodes.length}개 · 연결 {map.asset.edges.length}개
            </span>
          </div>
        )}
      </header>

      {/* ── 본문 ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {map.assetStatus === 'loading' && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-[#1A73E8]" />
              <p className="text-[13px] font-semibold text-[#5F6368]">분석맵을 불러오는 중…</p>
            </div>
          )}
          {map.assetStatus === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[13px] font-semibold text-[#C5221F]">{map.assetError}</p>
              <button
                type="button"
                onClick={map.reloadAsset}
                className="rounded-xl bg-[#1A73E8] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#1557B0] transition-colors"
              >
                다시 시도
              </button>
            </div>
          )}
          {map.assetStatus === 'ready' && (
            <CurriculumMapCanvas
              nodes={map.visibleNodes}
              edges={map.visibleEdges}
              subjectColors={subjectColors}
              maxDegree={map.maxDegree}
              scoreById={map.scoreById}
              searchActive={map.searchActive}
              selectedId={map.selectedId}
              neighborIds={map.neighborIds}
              alwaysLabels={map.filters.alwaysLabels}
              onSelect={map.selectNode}
              focusRequest={focusRequest}
            />
          )}
        </main>

        {/* 데스크톱: 우측 패널 / 모바일: 하단 시트 */}
        {panelOpen && (
          <>
            <aside className="hidden w-[360px] flex-shrink-0 border-l border-[#E8EAED] md:block">
              <MapSidePanel
                subjects={map.asset?.subjects ?? []}
                bands={map.asset?.bands ?? []}
                subjectColors={subjectColors}
                filters={map.filters}
                onToggleSubject={map.toggleSubject}
                onToggleBand={map.toggleBand}
                onEdgeThresholdChange={map.setEdgeThreshold}
                onAlwaysLabelsChange={map.setAlwaysLabels}
                onResetFilters={map.resetFilters}
                search={map.search}
                onPickResult={focusNode}
                selectedNode={selectedNode}
                related={map.related}
                onPickRelated={focusNode}
                onRefetchRelated={map.refetchRelated}
                onClearSelection={() => map.selectNode(null)}
              />
            </aside>

            <div className="fixed inset-x-0 bottom-0 z-30 max-h-[58vh] overflow-hidden rounded-t-2xl border-t border-[#E8EAED] bg-white shadow-2xl md:hidden">
              <div className="flex items-center justify-between border-b border-[#E8EAED] px-4 py-2">
                <span className="text-[12px] font-extrabold text-[#5F6368]">분석 패널</span>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="text-[#9AA0A6] hover:text-[#5F6368]"
                  aria-label="패널 닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[calc(58vh-40px)] overflow-y-auto">
                <MapSidePanel
                  subjects={map.asset?.subjects ?? []}
                  bands={map.asset?.bands ?? []}
                  subjectColors={subjectColors}
                  filters={map.filters}
                  onToggleSubject={map.toggleSubject}
                  onToggleBand={map.toggleBand}
                  onEdgeThresholdChange={map.setEdgeThreshold}
                  onAlwaysLabelsChange={map.setAlwaysLabels}
                  onResetFilters={map.resetFilters}
                  search={map.search}
                  onPickResult={focusNode}
                  selectedNode={selectedNode}
                  related={map.related}
                  onPickRelated={focusNode}
                  onRefetchRelated={map.refetchRelated}
                  onClearSelection={() => map.selectNode(null)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

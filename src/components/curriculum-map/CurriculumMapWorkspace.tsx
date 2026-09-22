'use client'

// 교육과정 분석맵 — 초등 성취기준 전체를 하나의 지식맵으로 보는 독립 화면.
// 앱 내부와 로그인 없는 공개 사이트가 같은 화면·동작을 재사용한다.
// M3 토큰은 globals.css 의 .m3-map 스코프에서 공급된다.

import 'material-symbols/rounded.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MD3Button } from '@/components/ui/MD3Button'
import CurriculumMapCanvas from '@/components/curriculum-map/CurriculumMapCanvas'
import MapSidePanel from '@/components/curriculum-map/MapSidePanel'
import { FilterChip } from '@/components/curriculum-map/MapPanelBits'
import { formatCount, nextSelection } from '@/components/curriculum-map/mapMath'
import { subjectIcon } from '@/components/curriculum-map/subjectIcons'
import { useCurriculumMap } from '@/components/curriculum-map/useCurriculumMap'

export default function CurriculumMapWorkspace({ standalone = false }: { standalone?: boolean }): React.ReactElement {
  const router = useRouter()
  const map = useCurriculumMap()
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  /** 패널 카드 호버 → 캔버스 강조 */
  const [hoverCardId, setHoverCardId] = useState<string | null>(null)

  const subjectColors = useMemo(() => {
    const record: Record<string, string> = {}
    for (const s of map.asset?.subjects ?? []) record[s.id] = s.color
    return record
  }, [map.asset])

  const selectedNode = map.selectedId ? map.nodeById.get(map.selectedId) ?? null : null

  // 체크된 학년군 — 에셋 순서(1-2 → 3-4 → 5-6)를 그대로 쓴다
  const checkedBands = useMemo(
    () => (map.asset?.bands ?? []).filter(b => !map.filters.hiddenBands.includes(b)),
    [map.asset, map.filters.hiddenBands],
  )

  // 관계 유형·강도·근거 — 캔버스가 관계선 색·굵기·근거 라벨에 쓴다.
  // /related 가 아직 응답하지 않았으면 비워 둔다: 이전 선택의 관계선이 남거나
  // 에셋 유사도 엣지가 Jev 관계처럼 보이면 패널 목록과 화면이 어긋난다.
  const relatedReady = map.related.status === 'ready'
  const relatedMeta = useMemo(() => {
    const meta = new Map<string, { relationType: string; strength: number; reason?: string }>()
    if (!relatedReady) return meta
    for (const item of map.related.items) {
      meta.set(item.id, { relationType: item.relationType, strength: item.strength, reason: item.reason })
    }
    return meta
  }, [map.related.items, relatedReady])

  // 필터에 가려졌지만 관련 목록에 있는 성취기준 — 점선 고스트로 함께 보여 준다
  const ghostNodes = useMemo(() => {
    if (!relatedReady) return []
    const out = []
    for (const item of map.related.items) {
      if (map.visibleIds.has(item.id)) continue
      const node = map.nodeById.get(item.id)
      if (node) out.push(node)
    }
    return out
  }, [map.related.items, map.nodeById, map.visibleIds, relatedReady])

  // 결과·관련 항목 클릭 → 선택 + 카메라 이동 (패널이 접혀 있으면 펼친다)
  const focusNode = useCallback((id: string) => {
    map.selectNode(id)
    setFocusRequest({ id, nonce: Date.now() })
    setPanelOpen(true)
  }, [map])

  // 캔버스 클릭: 같은 노드를 다시 누르면 선택 해제 (빈 공간도 해제)
  const handleCanvasSelect = useCallback((id: string | null) => {
    map.selectNode(nextSelection(id, map.selectedId))
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

  const panel = (
    <MapSidePanel
      subjectColors={subjectColors}
      filters={map.filters}
      onEdgeThresholdChange={map.setEdgeThreshold}
      onAlwaysLabelsChange={map.setAlwaysLabels}
      onPhysicsChange={map.setPhysics}
      onResetFilters={map.resetFilters}
      onHoverItem={setHoverCardId}
      search={map.search}
      onPickResult={focusNode}
      selectedNode={selectedNode}
      related={map.related}
      onPickRelated={focusNode}
      onRefetchRelated={map.refetchRelated}
      onClearSelection={() => map.selectNode(null)}
      hiddenRelatedCount={ghostNodes.length}
      bands={checkedBands}
    />
  )

  return (
    <div className="m3-map flex h-screen flex-col bg-[var(--md-surface-container-low)]">
      {/* ── M3 상단 앱 바 (64dp) ───────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
        <div className="flex h-16 items-center gap-2 px-4">
          {standalone ? (
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center text-[var(--md-primary)]">
              <span className="material-symbols-rounded text-[28px] leading-none">hub</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              aria-label="대시보드로 돌아가기"
              className="m3-state flex h-12 w-12 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
            >
              <span className="material-symbols-rounded text-[24px] leading-none">arrow_back</span>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-normal leading-tight text-[var(--md-on-surface)]">
              교육과정 분석맵
            </h1>
            {map.asset && (
              <p className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">
                성취기준 {formatCount(map.asset.nodes.length)}개 · 연결 {formatCount(map.asset.edges.length)}개
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen(o => !o)}
            aria-label={panelOpen ? '분석 패널 접기' : '분석 패널 펼치기'}
            aria-expanded={panelOpen}
            className="m3-state ml-auto flex h-12 w-12 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
          >
            <span className="material-symbols-rounded text-[24px] leading-none">
              {panelOpen ? 'right_panel_close' : 'right_panel_open'}
            </span>
          </button>
        </div>

        {/* ── 도킹된 M3 검색 바 (56dp) ─────────────────────────────────── */}
        <div className="px-4 pb-3">
          <form onSubmit={onSubmitSearch} className="flex items-center gap-2">
            <div className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full bg-[var(--md-surface-container-high)] px-5">
              <span className="material-symbols-rounded text-[24px] leading-none text-[var(--md-on-surface-variant)]">
                search
              </span>
              <input
                value={map.query}
                onChange={e => map.setQuery(e.target.value)}
                placeholder="수업 주제나 키워드로 성취기준 찾기"
                aria-label="성취기준 검색"
                className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--md-on-surface)] placeholder:text-[var(--md-on-surface-variant)] focus:outline-none"
              />
              {map.query && (
                <button
                  type="button"
                  onClick={map.clearSearch}
                  aria-label="검색어 지우기"
                  className="m3-state flex h-10 w-10 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
                >
                  <span className="material-symbols-rounded text-[20px] leading-none">close</span>
                </button>
              )}
            </div>
            <MD3Button
              type="submit"
              variant="filled"
              size="md"
              disabled={map.search.status === 'loading' || !map.query.trim()}
            >
              찾기
            </MD3Button>
          </form>

          {/* 교과·학년군 범례 겸 필터 칩 */}
          {map.asset && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {map.asset.subjects.map(s => (
                <FilterChip
                  key={s.id}
                  label={s.name}
                  active={!map.filters.hiddenSubjectIds.includes(s.id)}
                  dotColor={s.color}
                  icon={subjectIcon(s.id)}
                  onClick={() => map.toggleSubject(s.id)}
                />
              ))}
              <span className="mx-1 h-6 w-px bg-[var(--md-outline-variant)]" aria-hidden="true" />
              {map.asset.bands.map(b => (
                <FilterChip
                  key={b}
                  label={b}
                  active={!map.filters.hiddenBands.includes(b)}
                  onClick={() => map.toggleBand(b)}
                />
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ── 본문 ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {map.assetStatus === 'loading' && (
            <div className="flex h-full flex-col items-center justify-center px-6">
              <div className="w-full max-w-[280px]">
                <div className="m3-progress mb-3" />
                <p className="text-center text-[14px] text-[var(--md-on-surface-variant)]">
                  분석맵을 불러오는 중…
                </p>
              </div>
            </div>
          )}
          {map.assetStatus === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-[14px] leading-[1.5] text-[var(--md-error)]">{map.assetError}</p>
              <MD3Button variant="filled" size="sm" onClick={map.reloadAsset}>
                다시 시도
              </MD3Button>
            </div>
          )}
          {map.assetStatus === 'ready' && (
            <CurriculumMapCanvas
              nodes={map.visibleNodes}
              ghostNodes={ghostNodes}
              edges={map.visibleEdges}
              subjectColors={subjectColors}
              scoreById={map.scoreById}
              searchActive={map.searchActive}
              selectedId={map.selectedId}
              alwaysLabels={map.filters.alwaysLabels}
              physicsEnabled={map.filters.physics}
              relatedMeta={relatedMeta}
              relatedPending={map.related.status === 'loading'}
              externalHoverId={hoverCardId}
              onSelect={handleCanvasSelect}
              onClearSelection={() => map.selectNode(null)}
              focusRequest={focusRequest}
            />
          )}
        </main>

        {/* 데스크톱: 우측 시트 380dp / 모바일: 하단 시트 */}
        {panelOpen && (
          <>
            <aside className="hidden w-[380px] flex-shrink-0 border-l border-[var(--md-outline-variant)] md:block">
              {panel}
            </aside>

            <div
              className="fixed inset-x-0 bottom-0 z-30 max-h-[58vh] overflow-hidden rounded-t-[28px] border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] md:hidden"
              style={{ boxShadow: '0 -2px 6px rgba(0,0,0,0.15), 0 -8px 24px rgba(0,0,0,0.1)' }}
            >
              <div className="flex items-center justify-between border-b border-[var(--md-outline-variant)] px-5 py-2.5">
                <span className="text-[16px] font-medium text-[var(--md-on-surface)]">분석 패널</span>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  aria-label="패널 닫기"
                  className="m3-state flex h-10 w-10 items-center justify-center rounded-full text-[var(--md-on-surface-variant)]"
                >
                  <span className="material-symbols-rounded text-[20px] leading-none">close</span>
                </button>
              </div>
              <div className="max-h-[calc(58vh-53px)] overflow-y-auto">{panel}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

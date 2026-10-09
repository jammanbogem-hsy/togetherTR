'use client'

// 교육과정 분석맵 — 페이지와 분석시트(embedded) 양쪽에서 쓰는 본체.
// M3 토큰은 globals.css 의 .m3-map 스코프에서 공급된다.

import 'material-symbols/rounded.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import CurriculumMapCanvas from './CurriculumMapCanvas'
import FusionGraph, { FUSION_STRONG_MIN } from './FusionGraph'
import { FusionHubCard, FusionPanel } from './MapFusionBits'
import MapBasketBar from './MapBasketBar'
import MapSidePanel from './MapSidePanel'
import MapTopBar from './MapTopBar'
import { contextChipLabel, pickFromItem, pickFromNode, resolveInitialFilters } from './basketMath'
import { nextSelection } from './mapMath'
import { computeGridLayout } from './gridLayout'
import { computeConstellationLayout } from './constellationLayout'
import { useCurriculumMap } from './useCurriculumMap'
import { useMapBasket } from './useMapBasket'
import type { MapNode, MapPick } from './types'

export type { MapPick }

/** page 모드 "시트로 보내기" 대화상자 슬롯 — 앱 라우트만 꽂는다(공개 사이트는 없음). */
export interface SendDialogProps {
  open: boolean
  picks: MapPick[]
  onClose: () => void
  /** 추가된 행 수 */
  onDone: (rowsAdded: number) => void
}

export interface CurriculumMapViewProps {
  mode?: 'page' | 'embedded'
  /** 공개 사이트(로그인 없음): 뒤로 가기 대신 허브 아이콘 */
  standalone?: boolean
  /** 미리 채운 검색어 — 비어 있지 않으면 마운트 후 한 번 자동 실행 */
  initialQuery?: string
  /** 시트의 교과 이름('사회','통합교과' …) → 에셋 id 로 바꿔 필터로 적용 */
  initialSubjects?: string[]
  /** 정규 학년군 라벨 → 학년군 필터 */
  initialBands?: string[]
  /** 시트 행의 맥락 — 검색 바 아래 assist chip. 클릭하면 핵심 아이디어로 재검색 */
  context?: { subject?: string; gradeBand?: string; coreIdea?: string; rowId?: string }
  /** embedded: "시트에 반영" 버튼이 호출 */
  onApply?: (picks: MapPick[]) => void
  /** embedded: 뒤로 가기 화살표가 라우터 대신 호출 */
  onClose?: () => void
  /**
   * page 모드의 "시트로 보내기" 대화상자. 없으면(공개 사이트) 담기·바구니를 숨긴다 —
   * 보낼 곳이 없는데 담기 버튼만 보이면 막다른 길이 된다.
   */
  SendDialog?: React.ComponentType<SendDialogProps>
}

export function CurriculumMapView({
  mode = 'page',
  standalone = false,
  initialQuery,
  initialSubjects,
  initialBands,
  context,
  onApply,
  onClose,
  SendDialog,
}: CurriculumMapViewProps): React.ReactElement {
  const router = useRouter()
  // embedded: 열 때마다 새 비영속 필터 스토어 — 이전 열기의 교과·학년군이 새지 않는다
  const map = useCurriculumMap({ persistFilters: mode === 'page' })
  const basket = useMapBasket()
  const canPick = mode === 'embedded' || Boolean(SendDialog)
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  const [hoverCardId, setHoverCardId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [fusionShowWeak, setFusionShowWeak] = useState(false)
  const [fusionFocusId, setFusionFocusId] = useState<string | null>(null)
  const initialAppliedRef = useRef(false)

  const subjectColors = useMemo(() => {
    const record: Record<string, string> = {}
    for (const s of map.asset?.subjects ?? []) record[s.id] = s.color
    return record
  }, [map.asset])

  const selectedNode = map.selectedId ? map.nodeById.get(map.selectedId) ?? null : null

  // ── 융합 찾기 ──────────────────────────────────────────────────────────
  const subjectOrder = useMemo(() => (map.asset?.subjects ?? []).map(s => s.id), [map.asset])
  const subjectNames = useMemo(() => {
    const record: Record<string, string> = {}
    for (const s of map.asset?.subjects ?? []) record[s.id] = s.name
    return record
  }, [map.asset])
  const fusionOpen = map.fusion.hubId !== null
  const fusionHubNode = map.fusion.hubId ? map.nodeById.get(map.fusion.hubId) ?? null : null
  // 지도 위 ★ — 융합 보기 중이면 그 중심, 아니면 검색의 1위 추천
  const starHubId = map.fusion.hubId
    ?? (map.search.status === 'ready' ? map.search.fusionHubs[0]?.id ?? null : null)
  const { openFusion, closeFusion } = map
  const toggleFusion = useCallback((hubId: string) => {
    setFusionFocusId(null)
    setFusionShowWeak(false)
    if (map.fusion.hubId === hubId) closeFusion()
    else openFusion(hubId)
  }, [closeFusion, map.fusion.hubId, openFusion])
  const closeFusionView = useCallback(() => {
    setFusionFocusId(null)
    closeFusion()
  }, [closeFusion])

  const checkedBands = useMemo(
    () => (map.asset?.bands ?? []).filter(b => !map.filters.hiddenBands.includes(b)),
    [map.asset, map.filters.hiddenBands],
  )

  // ── 초기 props 적용 (에셋이 준비된 뒤 한 번만) ─────────────────────────
  // 자동 검색은 타이머 없이 여기서 바로 실행한다. 필터를 바꾸면 runSearch 의
  // 참조가 바뀌어 이 effect 가 다시 돌고 cleanup 이 타이머를 취소했었다(실제 결함).
  // 그래서 (1) ref 로 1회만 보장하고 (2) 방금 정한 교과·학년군을 overrides 로 넘겨
  // store 반영 순서와 무관하게 요청을 보낸다. 검색 중 상태는 runSearch 가 즉시 켠다.
  const { asset, assetStatus, applyFilters, setQuery, runSearch } = map
  useEffect(() => {
    if (initialAppliedRef.current || assetStatus !== 'ready' || !asset) return
    initialAppliedRef.current = true
    // page 모드에서 URL 에 아무 필터도 없으면 사용자의 저장 필터를 건드리지 않는다.
    // embedded 는 항상 props 기준으로 시작한다(없으면 전부 켬).
    const hasInitialFilters = (initialSubjects?.length ?? 0) > 0 || (initialBands?.length ?? 0) > 0
    const next = mode === 'embedded' || hasInitialFilters
      ? resolveInitialFilters({ initialSubjects, initialBands }, asset, map.filters)
      : map.filters
    if (next !== map.filters) {
      applyFilters({ hiddenSubjectIds: next.hiddenSubjectIds, hiddenBands: next.hiddenBands })
    }
    const q = initialQuery?.trim()
    if (!q) return
    setQuery(q)
    setPanelOpen(true)
    runSearch(q, {
      subjects: asset.subjects.map(s => s.id).filter(id => !next.hiddenSubjectIds.includes(id)),
      bands: asset.bands.filter(b => !next.hiddenBands.includes(b)),
    })
  // 마운트 시점의 props 로 한 번만 적용한다 (ref 가 재실행을 막는다)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, assetStatus])

  // ── 관계 메타 · 고스트 ─────────────────────────────────────────────────
  const relatedReady = map.related.status === 'ready'
  const relatedMeta = useMemo(() => {
    const meta = new Map<string, { relationType: string; strength: number; reason?: string }>()
    if (!relatedReady) return meta
    for (const item of map.related.items) {
      meta.set(item.id, { relationType: item.relationType, strength: item.strength, reason: item.reason })
    }
    return meta
  }, [map.related.items, relatedReady])

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

  // ── 배치: 정렬(기본) / 유사도 ─────────────────────────────────────────
  // 정렬 좌표는 필터와 무관하게 전체 에셋으로 한 번만 계산한다 — 교과를 숨겨도 남은
  // 성취기준의 자리가 바뀌지 않아야 "자리 = 교과·학년군·영역" 이라는 약속이 지켜진다.
  const layoutMode = map.filters.layout
  const grid = useMemo(
    () => (asset ? computeGridLayout(asset.nodes, asset.subjects, asset.bands) : null),
    [asset],
  )
  const constellation = useMemo(
    () => (asset ? computeConstellationLayout(asset.nodes, asset.subjects, asset.bands) : null),
    [asset],
  )
  const placeNodes = useCallback((list: MapNode[]): MapNode[] => {
    const positions = layoutMode === 'grid' ? grid?.positions
      : layoutMode === 'constellation' ? constellation?.positions
        : undefined
    if (!positions) return list
    return list.map(n => {
      const p = positions.get(n.id)
      return p ? { ...n, x: p.x, y: p.y } : n
    })
  }, [constellation, grid, layoutMode])
  const canvasNodes = useMemo(() => placeNodes(map.visibleNodes), [map.visibleNodes, placeNodes])
  const canvasGhostNodes = useMemo(() => placeNodes(ghostNodes), [ghostNodes, placeNodes])

  // ── 선택 · 검색 상호작용 ───────────────────────────────────────────────
  const focusNode = useCallback((id: string) => {
    map.selectNode(id)
    setFocusRequest({ id, nonce: Date.now() })
    setPanelOpen(true)
  }, [map])

  const handleCanvasSelect = useCallback((id: string | null) => {
    map.selectNode(nextSelection(id, map.selectedId))
  }, [map])

  const { selectedId, selectNode, clearSearch } = map
  // Esc 는 안쪽부터 하나씩 닫는다: 대화상자 → 융합 묶음 → 선택 → 검색.
  // 문서 캡처 단계에서 먼저 받는다 — 분석시트(embedded)도 document 에서 Esc 로 분석맵 전체를
  // 닫으므로, 지도 안에서 닫을 것이 있으면 여기서 소비하고 바깥으로 보내지 않는다
  // (2026-10-02: 시트 안에서 융합 묶음을 Esc 로 닫으면 분석맵까지 닫히던 문제).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const consume = (): void => {
        e.stopPropagation()
        e.preventDefault()
      }
      if (dialogOpen) {
        consume()
        setDialogOpen(false)
        return
      }
      if (fusionOpen) {
        consume()
        closeFusionView()
        return
      }
      if (selectedId) {
        consume()
        selectNode(null)
        return
      }
      clearSearch()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [clearSearch, closeFusionView, dialogOpen, fusionOpen, selectNode, selectedId])

  const onSubmitSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    map.runSearch()
    setPanelOpen(true)
  }, [map])

  const contextLabel = context ? contextChipLabel(context) : ''
  const onContextClick = useCallback(() => {
    const q = context?.coreIdea?.trim()
    if (!q) return
    map.setQuery(q)
    map.runSearch(q)
    setPanelOpen(true)
  }, [context, map])

  // ── 담기 ───────────────────────────────────────────────────────────────
  const togglePickById = useCallback((id: string) => {
    const node = map.nodeById.get(id)
    if (node) {
      basket.toggle(pickFromNode(node))
      return
    }
    const item = map.search.results.find(r => r.id === id) ?? map.search.weak.find(r => r.id === id)
      ?? map.related.items.find(r => r.id === id)
    if (item) basket.toggle(pickFromItem(item, null))
  }, [basket, map.nodeById, map.related.items, map.search.results, map.search.weak])

  const onPrimary = useCallback(() => {
    if (mode === 'embedded') {
      onApply?.(basket.picks)
      basket.clear()
      return
    }
    setDialogOpen(true)
  }, [basket, mode, onApply])

  // 결과 안내와 "시트로 이동"은 대화상자가 맡는다(작은 띠는 놓치기 쉬웠다).
  const onSent = useCallback(() => {
    setDialogOpen(false)
    basket.clear()
  }, [basket])

  const onBack = useCallback(() => {
    if (mode === 'embedded') onClose?.()
    else router.push('/dashboard')
  }, [mode, onClose, router])

  const panel = (
    <MapSidePanel
      subjectColors={subjectColors}
      filters={map.filters}
      onEdgeThresholdChange={map.setEdgeThreshold}
      onAlwaysLabelsChange={map.setAlwaysLabels}
      onPhysicsChange={map.setPhysics}
      nodeById={map.nodeById}
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
      pickedIds={basket.pickedIds}
      onTogglePick={canPick ? togglePickById : undefined}
      searchTop={
        <FusionHubCard
          hubs={map.search.fusionHubs}
          nodeById={map.nodeById}
          subjectColors={subjectColors}
          subjectNames={subjectNames}
          activeHubId={map.fusion.hubId}
          onOpen={toggleFusion}
          onLocate={focusNode}
        />
      }
    />
  )

  const fusionPanel = (
    <FusionPanel
      fusion={map.fusion}
      hubNode={fusionHubNode}
      nodeById={map.nodeById}
      subjectColors={subjectColors}
      subjectOrder={subjectOrder}
      subjectNames={subjectNames}
      strongMin={FUSION_STRONG_MIN}
      showWeak={fusionShowWeak}
      focusedId={fusionFocusId}
      onFocus={setFusionFocusId}
      pickedIds={basket.pickedIds}
      onTogglePick={canPick ? togglePickById : undefined}
      onHover={setHoverCardId}
      onClose={closeFusionView}
    />
  )
  const activePanel = fusionOpen ? fusionPanel : panel

  return (
    <div className="m3-map flex h-screen flex-col bg-[var(--md-surface-container-low)]">
      <MapTopBar
        leading={mode === 'embedded' ? 'close' : standalone ? 'hub' : 'dashboard'}
        onBack={onBack}
        asset={map.asset}
        query={map.query}
        onQueryChange={map.setQuery}
        onSubmit={onSubmitSearch}
        onClearQuery={map.clearSearch}
        searching={map.search.status === 'loading'}
        contextLabel={contextLabel || undefined}
        onContextClick={onContextClick}
        filters={map.filters}
        onToggleSubject={map.toggleSubject}
        onToggleBand={map.toggleBand}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(o => !o)}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {map.assetStatus === 'loading' && (
            <div className="flex h-full flex-col items-center justify-center px-6">
              <div className="w-full max-w-[280px]">
                <div className="m3-progress mb-3" />
                <p className="text-center text-[14px] text-[var(--md-on-surface-variant)]">분석맵을 불러오는 중…</p>
              </div>
            </div>
          )}
          {map.assetStatus === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-[14px] leading-[1.5] text-[var(--md-error)]">{map.assetError}</p>
              <button
                type="button"
                onClick={map.reloadAsset}
                className="m3-state rounded-full bg-[var(--md-primary)] px-5 py-2.5 text-[14px] font-medium text-[var(--md-on-primary)]"
              >
                다시 시도
              </button>
            </div>
          )}
          {map.assetStatus === 'ready' && (
            <CurriculumMapCanvas
              // 배치를 바꾸면 캔버스를 새로 마운트한다 — 물리 상태가 이전 좌표를 물려받지
              // 않고, 새 배치에 맞춰 전체 보기로 다시 맞춘다.
              key={layoutMode}
              nodes={canvasNodes}
              ghostNodes={canvasGhostNodes}
              edges={map.visibleEdges}
              subjectColors={subjectColors}
              scoreById={map.scoreById}
              searchActive={map.searchActive}
              selectedId={map.selectedId}
              alwaysLabels={map.filters.alwaysLabels}
              physicsEnabled={layoutMode === 'similarity' && map.filters.physics}
              layoutMode={layoutMode}
              onLayoutChange={map.setLayout}
              guides={layoutMode === 'grid' ? grid?.guides ?? null : null}
              constellation={layoutMode === 'constellation' ? constellation?.guides ?? null : null}
              canvasTheme={map.filters.canvasTheme}
              onCanvasThemeChange={map.setCanvasTheme}
              relatedMeta={relatedMeta}
              relatedPending={map.related.status === 'loading'}
              externalHoverId={hoverCardId}
              onSelect={handleCanvasSelect}
              onClearSelection={() => map.selectNode(null)}
              focusRequest={focusRequest}
              hubId={starHubId}
            />
          )}
          {map.assetStatus === 'ready' && fusionOpen && (
            <FusionGraph
              fusion={map.fusion}
              hubNode={fusionHubNode}
              nodeById={map.nodeById}
              edges={map.asset?.edges ?? []}
              subjectColors={subjectColors}
              subjectOrder={subjectOrder}
              subjectNames={subjectNames}
              showWeak={fusionShowWeak}
              onShowWeakChange={setFusionShowWeak}
              focusedId={fusionFocusId ?? hoverCardId}
              onFocus={setFusionFocusId}
              onClose={closeFusionView}
              onRetry={() => map.fusion.hubId && openFusion(map.fusion.hubId)}
            />
          )}
        </main>

        {panelOpen && (
          <>
            <aside className="hidden w-[380px] flex-shrink-0 border-l border-[var(--md-outline-variant)] md:block">
              {activePanel}
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
              <div className="max-h-[calc(58vh-53px)] overflow-y-auto">{activePanel}</div>
            </div>
          </>
        )}
      </div>

      {canPick && (
        <MapBasketBar
          picks={basket.picks}
          mode={mode}
          busy={dialogOpen}
          onRemove={basket.remove}
          onClear={basket.clear}
          onPrimary={onPrimary}
        />
      )}

      {mode === 'page' && SendDialog && (
        <SendDialog
          open={dialogOpen}
          picks={basket.picks}
          onClose={() => setDialogOpen(false)}
          onDone={onSent}
        />
      )}
    </div>
  )
}

export default CurriculumMapView

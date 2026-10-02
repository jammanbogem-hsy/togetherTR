'use client'

// 교육과정 분석맵 상태 훅 — 에셋 로드, 필터, 검색, 선택, 관련 성취기준을 한곳에서 관리.
// 렌더러(캔버스)와 패널은 이 훅이 만든 파생값만 읽는다.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isEdgeVisible, isNodeVisible } from './mapMath'
import { createFilterStore, sharedFilterStore, type FilterStore } from './mapFilterStore'
import { useMapFilterActions, type MapFilterActions } from './useMapFilterActions'
import type {
  AsyncStatus,
  CurriculumMapAsset,
  MapEdge,
  MapFilters,
  MapFusionHub,
  MapJudge,
  MapNode,
  MapRelatedCenter,
  MapRelatedItem,
  MapRelatedResponse,
  MapSearchResponse,
  MapSearchResult,
} from './types'

const ASSET_URL = '/curriculum_map.json'
const SEARCH_URL = '/api/curriculum-map/search'
const RELATED_URL = '/api/curriculum-map/related'
const SEARCH_LIMIT = 30
const RELATED_LIMIT = 12
/** 융합 그래프 상한 — 한 화면에 담기는 수 */
const FUSION_LIMIT = 20

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** 라우트가 돌려주는 한국어 error 본문을 그대로 보여 준다. */
async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (typeof body === 'object' && body !== null) {
      const detail = (body as { error?: unknown }).error
      if (typeof detail === 'string' && detail.trim()) return detail
    }
  } catch {
    // JSON 본문이 아니면 상태 코드만 알린다
  }
  return `${fallback} (HTTP ${res.status})`
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export interface SearchState {
  status: AsyncStatus
  results: MapSearchResult[]
  /** 약함·무관 등급 — 접힌 영역에 따로 보여 준다 */
  weak: MapSearchResult[]
  /** 학년군별 상위 항목 (백엔드가 주면 채워진다) */
  byBand?: Record<string, MapSearchResult[]>
  /** 관련 성취기준이 없는 학년군 */
  emptyBands?: string[]
  judge: MapJudge | null
  elapsedMs: number
  error: string | null
  /** 실제로 서버에 보낸 질의 — 결과 헤더·관련 재판정에 재사용 */
  submittedQuery: string
  /** 융합 핵심 추천(1위 + 다른 후보). 없으면 빈 배열 */
  fusionHubs: MapFusionHub[]
}

/** 융합 그래프 — 핵심 성취기준 하나를 중심으로 같은 학년군 다른 교과의 융합 짝 */
export interface FusionState {
  /** null 이면 융합 보기가 닫혀 있다 */
  hubId: string | null
  status: AsyncStatus
  center: MapRelatedCenter | null
  items: MapRelatedItem[]
  judge: MapJudge | null
  elapsedMs: number
  error: string | null
  /** 판정에 쓴 수업 주제(검색어) */
  query: string
}

export interface RelatedState {
  status: AsyncStatus
  center: MapRelatedCenter | null
  items: MapRelatedItem[]
  judge: MapJudge | null
  elapsedMs: number
  error: string | null
}

export interface CurriculumMapController extends MapFilterActions {
  asset: CurriculumMapAsset | null
  assetStatus: AsyncStatus
  assetError: string | null
  reloadAsset: () => void

  filters: MapFilters

  query: string
  setQuery: (value: string) => void
  search: SearchState
  /**
   * overrides 를 주면 현재 필터 대신 그 교과·학년군으로 요청한다.
   * 필터를 방금 바꿔서 store 반영을 기다릴 수 없을 때(초기 자동 검색) 쓴다.
   */
  runSearch: (value?: string, overrides?: { subjects?: readonly string[]; bands?: readonly string[] }) => void
  clearSearch: () => void

  selectedId: string | null
  selectNode: (id: string | null) => void
  related: RelatedState
  refetchRelated: () => void

  fusion: FusionState
  /** 핵심 성취기준을 중심으로 융합 그래프를 연다 */
  openFusion: (hubId: string) => void
  closeFusion: () => void

  visibleNodes: MapNode[]
  visibleEdges: MapEdge[]
  nodeById: Map<string, MapNode>
  scoreById: Map<string, number>
  /** 현재 보이는 노드 id — 필터에 가려진 관련 항목을 골라낼 때 쓴다 */
  visibleIds: Set<string>
  searchActive: boolean
}

const EMPTY_SEARCH: SearchState = {
  status: 'idle',
  results: [],
  weak: [],
  judge: null,
  elapsedMs: 0,
  error: null,
  submittedQuery: '',
  fusionHubs: [],
}

const EMPTY_FUSION: FusionState = {
  hubId: null,
  status: 'idle',
  center: null,
  items: [],
  judge: null,
  elapsedMs: 0,
  error: null,
  query: '',
}

const EMPTY_RELATED: RelatedState = {
  status: 'idle',
  center: null,
  items: [],
  judge: null,
  elapsedMs: 0,
  error: null,
}

export interface CurriculumMapOptions {
  /**
   * true(기본): 앱 공유·영속 스토어(page 모드).
   * false: 이 마운트 전용 비영속 스토어(embedded 모드) — 열 때마다 새로 시작한다.
   */
  persistFilters?: boolean
}

export function useCurriculumMap(options: CurriculumMapOptions = {}): CurriculumMapController {
  const persistFilters = options.persistFilters !== false
  // 마운트당 한 번만 만든다 (lazy initializer). 렌더 중 ref 를 쓰지 않는다.
  const [store] = useState<FilterStore>(() =>
    persistFilters ? sharedFilterStore : createFilterStore({ persist: false }),
  )
  const [asset, setAsset] = useState<CurriculumMapAsset | null>(null)
  const [assetStatus, setAssetStatus] = useState<AsyncStatus>('loading')
  const [assetError, setAssetError] = useState<string | null>(null)
  const [assetReloadKey, setAssetReloadKey] = useState(0)

  const filters = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)

  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [related, setRelated] = useState<RelatedState>(EMPTY_RELATED)
  const [fusion, setFusion] = useState<FusionState>(EMPTY_FUSION)

  const searchAbortRef = useRef<AbortController | null>(null)
  const relatedAbortRef = useRef<AbortController | null>(null)
  const fusionAbortRef = useRef<AbortController | null>(null)
  const submittedQueryRef = useRef('')

  // ── 정적 에셋 로드 ─────────────────────────────────────────────────────
  // 상태 전환은 reloadAsset 에서 처리한다 (effect 본문에서 동기 setState 금지)
  useEffect(() => {
    const controller = new AbortController()
    // 'no-cache' = 매번 ETag 로 재검증(바뀌지 않았으면 304 라 비용이 거의 없다).
    // 예전 'force-cache' 는 만료된 사본도 그대로 써서, 배포 뒤 재방문자에게 새 화면 +
    // 옛 에셋(제각각 반지름·성취수준 없음)이 섞여 보였다(2026-09-23 공개 사이트에서 발생).
    fetch(ASSET_URL, { signal: controller.signal, cache: 'no-cache' })
      .then(async res => {
        if (!res.ok) throw new Error(`분석맵 데이터를 불러오지 못했습니다 (HTTP ${res.status})`)
        return (await res.json()) as CurriculumMapAsset
      })
      .then(data => {
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error('분석맵 데이터 형식이 올바르지 않습니다.')
        }
        setAsset(data)
        setAssetStatus('ready')
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        setAssetError(errorMessage(err, '분석맵 데이터를 불러오지 못했습니다.'))
        setAssetStatus('error')
      })
    return () => controller.abort()
  }, [assetReloadKey])

  const reloadAsset = useCallback(() => {
    setAsset(null)
    setAssetError(null)
    setAssetStatus('loading')
    setAssetReloadKey(k => k + 1)
  }, [])

  // ── 필터 조작 ──────────────────────────────────────────────────────────
  const filterActions = useMapFilterActions(store)

  // ── 파생 데이터 ────────────────────────────────────────────────────────
  const nodeById = useMemo(() => {
    const map = new Map<string, MapNode>()
    for (const n of asset?.nodes ?? []) map.set(n.id, n)
    return map
  }, [asset])

  const visibleNodes = useMemo(
    () => (asset?.nodes ?? []).filter(n => isNodeVisible(n, filters)),
    [asset, filters],
  )

  const visibleIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes])

  const visibleEdges = useMemo(
    () => (asset?.edges ?? []).filter(e => isEdgeVisible(e, filters.edgeThreshold, visibleIds, selectedId)),
    [asset, filters.edgeThreshold, visibleIds, selectedId],
  )

  const scoreById = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of search.results) map.set(r.id, r.score)
    return map
  }, [search.results])

  const searchActive = search.status === 'ready' && search.results.length > 0

  // ── 검색 ───────────────────────────────────────────────────────────────
  const visibleSubjectIds = useMemo(
    () => (asset?.subjects ?? []).map(s => s.id).filter(id => !filters.hiddenSubjectIds.includes(id)),
    [asset, filters.hiddenSubjectIds],
  )
  const visibleBands = useMemo(
    () => (asset?.bands ?? []).filter(b => !filters.hiddenBands.includes(b)),
    [asset, filters.hiddenBands],
  )

  // 검색 요청에 실을 학년군 목록 — 패널의 묶기 순서와 같은 기준을 쓴다
  const runSearch = useCallback((
    value?: string,
    overrides?: { subjects?: readonly string[]; bands?: readonly string[] },
  ) => {
    const q = (value ?? query).trim()
    // 새 검색이면 이전 주제의 융합 보기는 닫는다
    fusionAbortRef.current?.abort()
    setFusion(EMPTY_FUSION)
    if (!q) {
      setSearch(EMPTY_SEARCH)
      submittedQueryRef.current = ''
      return
    }
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    submittedQueryRef.current = q
    setSearch(s => ({ ...s, status: 'loading', error: null, submittedQuery: q }))

    fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      // 체크된 교과·학년군을 항상 보낸다 — 백엔드가 학년군별로 균형 있게 뽑는다
      body: JSON.stringify({
        query: q,
        subjects: overrides?.subjects ?? visibleSubjectIds,
        bands: overrides?.bands ?? visibleBands,
        limit: SEARCH_LIMIT,
      }),
    })
      .then(async res => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, '검색에 실패했습니다'))
        return (await res.json()) as MapSearchResponse
      })
      .then(data => {
        setSearch({
          status: 'ready',
          results: Array.isArray(data.results) ? data.results : [],
          weak: Array.isArray(data.weak) ? data.weak : [],
          byBand: data.byBand,
          emptyBands: Array.isArray(data.emptyBands) ? data.emptyBands : undefined,
          judge: data.judge ?? null,
          elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : 0,
          error: null,
          submittedQuery: q,
          fusionHubs: Array.isArray(data.fusion?.hubs) ? data.fusion.hubs : [],
        })
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        setSearch({
          ...EMPTY_SEARCH,
          status: 'error',
          error: errorMessage(err, '검색에 실패했습니다.'),
          submittedQuery: q,
        })
      })
  }, [query, visibleSubjectIds, visibleBands])

  const clearSearch = useCallback(() => {
    searchAbortRef.current?.abort()
    fusionAbortRef.current?.abort()
    setFusion(EMPTY_FUSION)
    submittedQueryRef.current = ''
    setQuery('')
    setSearch(EMPTY_SEARCH)
  }, [])

  // ── 관련 성취기준 ──────────────────────────────────────────────────────
  const fetchRelated = useCallback((id: string, withQuery: boolean) => {
    relatedAbortRef.current?.abort()
    const controller = new AbortController()
    relatedAbortRef.current = controller
    setRelated(r => ({ ...r, status: 'loading', error: null }))

    const q = withQuery ? submittedQueryRef.current.trim() : ''
    fetch(RELATED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ id, query: q || undefined, limit: RELATED_LIMIT }),
    })
      .then(async res => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, '관련 성취기준을 불러오지 못했습니다'))
        return (await res.json()) as MapRelatedResponse
      })
      .then(data => {
        setRelated({
          status: 'ready',
          center: data.center ?? null,
          items: Array.isArray(data.related) ? data.related : [],
          judge: data.judge ?? null,
          elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : 0,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        setRelated({
          ...EMPTY_RELATED,
          status: 'error',
          error: errorMessage(err, '관련 성취기준을 불러오지 못했습니다.'),
        })
      })
  }, [])

  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id)
    if (!id) {
      relatedAbortRef.current?.abort()
      setRelated(EMPTY_RELATED)
      return
    }
    fetchRelated(id, true)
  }, [fetchRelated])

  const refetchRelated = useCallback(() => {
    if (!selectedId) return
    fetchRelated(selectedId, true)
  }, [fetchRelated, selectedId])

  // ── 융합 그래프 ────────────────────────────────────────────────────────
  // 검색이 넘긴 주제 짝(partnerIds)을 후보로 함께 보내고, 서버가 같은 학년군·다른 교과만
  // 남겨 Jev 로 관계 유형·강도를 판정한다(수업 주제 = 검색어).
  const openFusion = useCallback((hubId: string) => {
    fusionAbortRef.current?.abort()
    const controller = new AbortController()
    fusionAbortRef.current = controller
    const q = submittedQueryRef.current.trim()
    const hub = search.fusionHubs.find(h => h.id === hubId)
    setFusion({ ...EMPTY_FUSION, hubId, status: 'loading', query: q })

    fetch(RELATED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        id: hubId,
        query: q || undefined,
        mode: 'fusion',
        partnerIds: hub?.partnerIds ?? [],
        limit: FUSION_LIMIT,
      }),
    })
      .then(async res => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, '융합 성취기준을 불러오지 못했습니다'))
        return (await res.json()) as MapRelatedResponse
      })
      .then(data => {
        setFusion({
          hubId,
          status: 'ready',
          center: data.center ?? null,
          items: Array.isArray(data.related) ? data.related : [],
          judge: data.judge ?? null,
          elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : 0,
          error: null,
          query: q,
        })
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        setFusion({
          ...EMPTY_FUSION,
          hubId,
          status: 'error',
          error: errorMessage(err, '융합 성취기준을 불러오지 못했습니다.'),
          query: q,
        })
      })
  }, [search.fusionHubs])

  const closeFusion = useCallback(() => {
    fusionAbortRef.current?.abort()
    setFusion(EMPTY_FUSION)
  }, [])

  // 언마운트 시 진행 중 요청 정리
  useEffect(() => () => {
    searchAbortRef.current?.abort()
    relatedAbortRef.current?.abort()
    fusionAbortRef.current?.abort()
  }, [])

  return {
    asset,
    assetStatus,
    assetError,
    reloadAsset,
    filters,
    ...filterActions,
    query,
    setQuery,
    search,
    runSearch,
    clearSearch,
    selectedId,
    selectNode,
    related,
    refetchRelated,
    fusion,
    openFusion,
    closeFusion,
    visibleNodes,
    visibleEdges,
    nodeById,
    scoreById,
    visibleIds,
    searchActive,
  }
}

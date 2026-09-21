// 교육과정 분석맵 — 정적 에셋(public/curriculum_map.json)과 API 응답 계약 타입.
// 백엔드가 생성하는 스키마와 1:1 대응하며, UI는 이 타입만 신뢰한다.

export interface MapSubject {
  id: string
  name: string
  color: string
}

export interface MapNode {
  id: string
  code: string
  subjectId: string
  subject: string
  band: string
  area: string
  coreIdeaId: string
  coreIdea: string
  text: string
  /** 0..2000 좌표계로 사전 계산된 위치 */
  x: number
  y: number
  /** 연결 차수 — 노드 반지름 산정 기준 */
  degree: number
}

export type MapEdgeKind = 'similar' | 'cross' | 'both'

export interface MapEdge {
  source: string
  target: string
  /** 0..1 유사도 */
  sim: number
  kind: MapEdgeKind
  /** 8종 교육적 관계 유형 (없을 수 있음) */
  relation?: string
}

export interface CurriculumMapAsset {
  /** 빌더가 숫자로 내보내므로 둘 다 허용 */
  version: string | number
  builtAt: string
  subjects: MapSubject[]
  bands: string[]
  nodes: MapNode[]
  edges: MapEdge[]
}

// ─── 검색 API ─────────────────────────────────────────────────────────────

export type MapJudge = 'jev' | 'embedding'

export interface MapSearchResult {
  id: string
  code: string
  subject: string
  subjectId: string
  band: string
  area: string
  text: string
  sim: number
  /** 0..1 종합 점수 — 검색 모드 노드 크기 기준 */
  score: number
  level: string
}

export interface MapSearchResponse {
  results: MapSearchResult[]
  judge: MapJudge
  elapsedMs: number
}

// ─── 관련 성취기준 API ────────────────────────────────────────────────────

export interface MapRelatedCenter {
  id: string
  code: string
  subjectId: string
  subject: string
  band: string
  area: string
  coreIdeaId?: string
  coreIdea: string
  text: string
}

export interface MapRelatedItem {
  id: string
  code: string
  subject: string
  subjectId: string
  band: string
  area: string
  text: string
  sim: number
  relationType: string
  /** 0..1 관계 강도 */
  strength: number
  level: string
  source: string
}

export interface MapRelatedResponse {
  center: MapRelatedCenter
  related: MapRelatedItem[]
  judge: MapJudge
  elapsedMs: number
}

// ─── UI 상태 ──────────────────────────────────────────────────────────────

export interface MapFilters {
  /** 숨긴 교과 id 목록 (빈 배열 = 전부 표시) */
  hiddenSubjectIds: string[]
  /** 숨긴 학년군 목록 (빈 배열 = 전부 표시) */
  hiddenBands: string[]
  /** 0.3~0.8 — 이 값 미만 엣지는 그리지 않음 */
  edgeThreshold: number
  /** 라벨 항상 표시 */
  alwaysLabels: boolean
}

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error'

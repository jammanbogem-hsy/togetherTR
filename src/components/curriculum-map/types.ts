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
  /**
   * 빌더가 사전 계산한 월드 좌표. 겹침 방지 레이아웃 때문에 범위는 고정이 아니다
   * (현재 에셋은 약 0..3100) — 렌더러는 항상 fitToView 로 맞추므로 상한을 가정하지 않는다.
   */
  x: number
  y: number
  /** 연결 차수 — 노드 반지름 산정 기준 */
  degree: number
  /**
   * 월드 단위 노드 반지름. 빌더가 겹침 방지 레이아웃을 계산할 때 쓴 값을
   * 실어 보내면 렌더러가 그대로 따른다. 없으면 degree 순위로 계산한다.
   */
  r?: number
  /** 성취기준 키워드 — 툴팁 근거 표시용 (에셋에 있을 때만) */
  keywords?: string[]
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
  /** 왜 이 성취기준이 걸렸는지 한 줄 근거 (백엔드가 제공하면 표시) */
  reason?: string
  /** 질의와 실제로 맞은 표현들 */
  matchedTerms?: string[]
}

export interface MapSearchResponse {
  /** 관련·핵심 등급 */
  results: MapSearchResult[]
  /** 약함·무관 등급 — 접힌 영역에 따로 보여 준다 */
  weak?: MapSearchResult[]
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
  /** ── 관계 근거 (백엔드가 제공하면 표시) ── */
  /** 왜 관련 있는지 한 줄 설명 */
  reason?: string
  /** 두 성취기준이 공유하는 키워드 */
  sharedKeywords?: string[]
  sameArea?: boolean
  sameCoreIdea?: boolean
  /** 공통 핵심 아이디어가 속한 영역 */
  coreIdeaArea?: string
  /** 교육과정 문서상의 연결 근거 */
  linkEvidence?: string
  /** Jev 판정 원점수 (0..1) */
  jevScore?: number
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
  /** 힘 기반 레이아웃(움직임) 사용 여부 */
  physics: boolean
}

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error'

import type { GraphPinnedStandard, GraphRelationFilter, GraphRelationType, GraphSavedData, GraphSelectedStandard } from '@/lib/knowledge-graph/domain'

// ─── 그래프 노드/엣지 ─────────────────────────────────────────────────────

export interface GNode {
  id: string
  type: 'subject' | 'core_idea' | 'standard'
  label: string
  text?: string
  subject_id?: string
  grade_band?: string
  area?: string
  keywords?: string[]
  competencies?: string[]
  group: string
  similarityScore?: number  // 0.1–1.0, 가장 관련도 높은 노드가 1.0
  x: number
  y: number
  vx: number
  vy: number
  fx?: number
  fy?: number
}

export interface GEdge {
  id: string
  source: string
  target: string
  relation: GraphRelationType
  weight: number
  method: string
  explanation?: string
  teachingNote?: string
}

// ─── 내부 상태 타입 ──────────────────────────────────────────────────────

export interface GraphRelationAnalysis {
  relationType: GraphRelationType
  score: number
  /** 관계 근거 한 줄 (팝업에선 보조 역할) */
  explanation: string
  /** 수업 아이디어: 2~3개의 구체적 콘텐츠 접근 (보편/창의 혼합) */
  ideas?: string[]
  /** 수업 제안: 2개 성취기준을 융합한 수업 구조 (차시·역할·산출물 포함) */
  teachingNote?: string
  source: 'claude' | 'rule'
}

export type RelationDisplayState = 'claude' | 'rule' | 'estimated'
export type SaveState = 'idle' | 'saving' | 'success' | 'error'

// ─── 컴포넌트 Props ─────────────────────────────────────────────────────

export interface KnowledgeGraphViewerProps {
  keyword: string
  gradeGroup?: string
  onSelectStandard?: (std: { code: string; text: string; subject_id: string; keywords: string[] }) => void
  height?: number
  currentUserName?: string
  currentUserUid?: string
  isLeader?: boolean
  chatMentionedCodes?: Array<{ code: string; addedBy: string }>
  pinnedStandards?: GraphPinnedStandard[]
  onPinChange?: (pins: GraphPinnedStandard[]) => void
  externalCheckedStandardIds?: string[]
  onCheckedStandardsChange?: (ids: string[]) => void
  onClose?: () => void
  externalRecommendations?: Array<{ nodeId: string; recommenderName: string; recommenderUid?: string }>
  onRecommendCenter?: (nodeId: string, nodeName: string) => void
  externalCenterNodeId?: string
  preferredCenterCode?: string
  onSetCenter?: (nodeId: string) => void
  onSaveGraph?: (data: Omit<GraphSavedData, 'savedAt'>) => Promise<void>
  savedData?: GraphSavedData | null
  /** 이전 활동 산출물 요약 (관계 분석 프롬프트에 활용) */
  artifactContext?: string
  /** 교육과정 분석 시트 데이터 — 노드 팝업에 맥락 표시 */
  curriculumSheet?: Array<{ subject: string; coreIdea: string; standard: string; knowledge: string; processFunction: string; agentLessonExample?: string; description: string }>
}

// ─── 재사용 서브 컴포넌트 Props ──────────────────────────────────────────

export interface RecommendedStandard {
  node: GNode
  isAIMentioned: boolean
  isPinned: boolean
  isCenter: boolean
  score: number
  relation: GraphRelationType | null
}

export { type GraphRelationFilter, type GraphRelationType, type GraphSavedData, type GraphSelectedStandard, type GraphPinnedStandard }

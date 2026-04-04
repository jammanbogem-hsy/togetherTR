import { Timestamp } from 'firebase/firestore'

// ─── 단계 ───────────────────────────────────────────
export type StageCode = 'T' | 'A' | 'Ds' | 'DI' | 'E'

export type StageStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'warning'
  | 'active_return'

export interface StageInfo {
  code: StageCode
  label: string
  description: string
  activities: ActivityCode[]
}

export const STAGES: StageInfo[] = [
  { code: 'T',  label: '팀준비',    description: '협력 조건 구축',     activities: ['T-1-1','T-1-2','T-2-1','T-2-2','T-2-3'] },
  { code: 'A',  label: '분석',      description: '주제·학습자 분석',   activities: [/*'A-1-1',*/'A-1-2','A-2-1','A-2-2','A-2-3'] },
  { code: 'Ds', label: '설계',      description: '수업 구조 설계',     activities: ['Ds-1-1','Ds-1-2','Ds-1-3','Ds-2-1','Ds-2-2'] },
  { code: 'DI', label: '개발·실행', description: '자료 개발 및 수업',  activities: ['DI-1-1','DI-2-1'] },
  { code: 'E',  label: '평가',      description: '성찰·개선·새 주기', activities: ['E-1-1','E-2-1'] },
]

// ─── 활동 ───────────────────────────────────────────
export type ActivityCode =
  | 'T-1-1' | 'T-1-2' | 'T-2-1' | 'T-2-2' | 'T-2-3'
  | 'A-1-1' | 'A-1-2' | 'A-2-1' | 'A-2-2' | 'A-2-3'
  | 'Ds-1-1' | 'Ds-1-2' | 'Ds-1-3' | 'Ds-2-1' | 'Ds-2-2'
  | 'DI-1-1' | 'DI-2-1'
  | 'E-1-1' | 'E-2-1'

export interface ActivityMeta {
  code: ActivityCode
  label: string
  stage: StageCode
  isGuardrailSource?: boolean   // A-2-3
  isGuardrailTarget?: boolean   // Ds 전체
  isBackwardDesignFirst?: boolean // Ds-1-1 (평가 먼저)
}

export const ACTIVITY_META: Record<ActivityCode, ActivityMeta> = {
  'T-1-1': { code: 'T-1-1', label: '팀 공통 비전 설정',    stage: 'T' },
  'T-1-2': { code: 'T-1-2', label: '수업설계 방향 설정',   stage: 'T' },
  'T-2-1': { code: 'T-2-1', label: '역할 배분',            stage: 'T' },
  'T-2-2': { code: 'T-2-2', label: '팀 규칙 수립',         stage: 'T' },
  'T-2-3': { code: 'T-2-3', label: '팀 일정 협의',         stage: 'T' },
  'A-1-1': { code: 'A-1-1', label: '주제 선정 기준',        stage: 'A' },
  'A-1-2': { code: 'A-1-2', label: '주제 선정',            stage: 'A' },
  'A-2-1': { code: 'A-2-1', label: '내용·기능요소 분석',   stage: 'A' },
  'A-2-2': { code: 'A-2-2', label: '통합 수업목표 진술',   stage: 'A' },
  'A-2-3': { code: 'A-2-3', label: '학습자·맥락 분석',     stage: 'A', isGuardrailSource: true },
  'Ds-1-1': { code: 'Ds-1-1', label: '평가 계획 수립',     stage: 'Ds', isBackwardDesignFirst: true },
  'Ds-1-2': { code: 'Ds-1-2', label: '문제상황 개발',       stage: 'Ds', isGuardrailTarget: true },
  'Ds-1-3': { code: 'Ds-1-3', label: '학습활동 설계',       stage: 'Ds', isGuardrailTarget: true },
  'Ds-2-1': { code: 'Ds-2-1', label: '지원 도구 설계',      stage: 'Ds', isGuardrailTarget: true },
  'Ds-2-2': { code: 'Ds-2-2', label: '스캐폴딩 설계',       stage: 'Ds', isGuardrailTarget: true },
  'DI-1-1': { code: 'DI-1-1', label: '자료 탐색·개발',     stage: 'DI' },
  'DI-2-1': { code: 'DI-2-1', label: '수업 기록',           stage: 'DI' },
  'E-1-1':  { code: 'E-1-1',  label: '수업 성찰·평가',     stage: 'E' },
  'E-2-1':  { code: 'E-2-1',  label: '팀 활동 성찰·평가',  stage: 'E' },
}

// ─── 활동유형 10종 ──────────────────────────────────
export type ActivityType =
  | '제시' | '탐색' | '생성' | '시각화' | '공유·협의'
  | '조정' | '점검' | '성찰' | '판단' | '기록'

export type ActorType =
  | '개인교사단독' | '교사팀협의' | '개인+AI' | '팀+AI' | 'AI단독'

// ─── 프로젝트 ────────────────────────────────────────
export type SchoolLevel = '초등학교' | '중학교' | '고등학교'
export type GradeGroup = '초1-2' | '초3-4' | '초5-6' | '중1-3' | '고공통' | '고선택'
export type ProjectMode = 'collaborative' | 'solo'

export interface Project {
  id: string
  title: string
  mode: ProjectMode
  schoolLevel: SchoolLevel
  targetGradeGroup: GradeGroup
  targetSubjects: string[]
  createdBy: string
  currentStage: StageCode
  currentCycle: number
  status: 'active' | 'completed' | 'archived'
  isECompleted: boolean      // E→T 순환 화살표 트리거
  isA23Completed: boolean    // 가드레일 뱃지 트리거
  cycleCount: number
  createdAt: Timestamp
  updatedAt: Timestamp
  metadata: {
    semester: string
    weeklyHours?: number
    totalSessions?: number
  }
  // 초대코드 & 팀 관련
  inviteCode?: string
  hostUid?: string
  memberUids?: string[]
  memberInfo?: Record<string, { uid: string; displayName: string; color: string; emoji: string; joinedAt: number }>
  started?: boolean        // 방장이 시작 버튼을 눌러야 true
  analysisOpen?: boolean   // 단계 분석 모달 팀 동기화
  analysisReport?: {       // 방장이 생성한 보고서 (팀원 공유용)
    stage: string
    content: string
    generating: boolean
  }
  currentActivity?: ActivityCode  // 현재 활동 (팀 전체 공유)
  activityStatuses?: Partial<Record<ActivityCode, StageStatus>>  // 활동별 상태 (팀 전체 공유)
  teamDiscussion?: {
    active: boolean
    topic?: string
    startedAt?: number
  }
  teamDiscussionRequest?: {
    pending: boolean
    requestedBy?: string
    displayName?: string
    requestedAt?: number
  }
  // 활동별 팀 채팅 상태 (activityCode → 상태)
  teamDiscussions?: Record<string, {
    active: boolean
    topic?: string
    startedAt?: number
  }>
  teamDiscussionRequests?: Record<string, {
    pending: boolean
    requestedBy?: string
    displayName?: string
    requestedAt?: number
  }>
  // 안(案) 선택지 투표: msgId → uid → label ('A안' 등)
  optionVotes?: Record<string, Record<string, string>>
  // 활동별 확정 산출물: activityCode → 확정 내용
  artifacts?: Record<string, {
    status: ArtifactStatus
    title: string
    content: Record<string, unknown>
    version: number
    confirmedBy?: string
    confirmedAt?: number
    revisionNote?: string      // 팀원이 보낸 수정 요청 메모
    revisionRequestedBy?: string
    revisionRequestedAt?: number
  }>
}

// ─── 산출물 ──────────────────────────────────────────
export type ArtifactStatus = 'ai_draft' | 'in_review' | 'confirmed' | 'rejected'

export interface Artifact {
  id: string
  activityCode: ActivityCode
  artifactType: string
  title: string
  status: ArtifactStatus
  currentVersion: number
  aiDraft?: Record<string, unknown>
  confirmedContent?: Record<string, unknown>
  lastEditedContent?: Record<string, unknown>
  createdBy: string
  confirmedBy?: string
  confirmedAt?: Timestamp
  meta: {
    author: string
    createdAt: Timestamp
    updatedAt: Timestamp
    evidence: string
    changeReason?: string
    approvalStatus: 'pending' | 'approved' | 'rejected'
  }
}

// ─── 메시지 ──────────────────────────────────────────
export type MessageRole = 'user' | 'assistant' | 'system'
export type AgentType = 'orchestrator' | 'stage' | 'artifact' | 'check' | 'coach' | 'collab'

export interface Message {
  id: string
  role: MessageRole
  content: string
  activityCode: ActivityCode
  activityType?: ActivityType
  actorType?: ActorType
  agentType?: AgentType
  userId?: string
  displayName?: string   // 발신자 실명 — AI에게 전달되어 누가 말했는지 파악
  replyTo?: { id: string; content: string; senderName?: string }
  relatedArtifactId?: string
  createdAt: Timestamp
}

// ─── 성취기준 ────────────────────────────────────────
export interface Standard {
  code: string
  subject_group: string
  subject: string
  grade_group: GradeGroup | string
  school_level: SchoolLevel | string
  area: string
  content: string
  keywords: string[]
  explanation?: string
  embedding?: number[]
}

export interface StandardSearchResult {
  standard: Standard
  finalScore: number
  tfidfScore: number
  vectorScore: number
  isCrossSubject: boolean
}

// ─── 단계 전환 이력 ──────────────────────────────────
export interface StageTransition {
  id: string
  fromStage: StageCode
  toStage: StageCode
  direction: 'forward' | 'backward' | 'cycle'
  cycleNumber: number
  reason: string
  missingItemsIgnored?: string[]
  initiatedBy: string
  createdAt: Timestamp
}

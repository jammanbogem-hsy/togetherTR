import { Timestamp } from 'firebase/firestore'
import type { GraphSavedData, GraphSelectionState } from '@/lib/knowledge-graph/domain'

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
  { code: 'T',  label: '팀준비',    description: '협력의 밭을 일구는 시간',            activities: ['T-1-1','T-1-2','T-2-1','T-2-2','T-2-3'] },
  { code: 'A',  label: '분석',      description: '우리 땅을 살피고 씨앗을 고르는 시간', activities: ['A-1-1','A-1-2','A-2-1','A-2-2','A-2-3'] },
  { code: 'Ds', label: '설계',      description: '배움의 텃밭을 함께 그려가는 시간',    activities: ['Ds-1-1','Ds-1-2','Ds-1-3','Ds-2-1','Ds-2-2'] },
  { code: 'DI', label: '개발·실행', description: '우리의 협력이 꽃피우는 시간',         activities: ['DI-1-1','DI-2-1'] },
  { code: 'E',  label: '평가',      description: '우리의 열매를 거두는 시간',           activities: ['E-1-1','E-2-1'] },
]

// ─── 활동 ───────────────────────────────────────────
export type ActivityCode =
  | 'T-1-1' | 'T-1-2' | 'T-2-1' | 'T-2-2' | 'T-2-3'
  | 'A-1-1' | 'A-1-2' | 'A-2-1' | 'A-2-2' | 'A-2-3'
  | 'Ds-1-1' | 'Ds-1-2' | 'Ds-1-3' | 'Ds-2-1' | 'Ds-2-2'
  | 'DI-1-1' | 'DI-2-1'
  | 'E-1-1' | 'E-2-1'

// 화면·대화 표시용 활동 번호 (가이드 문서 260619 피드백판 체계).
// 내부 코드(Firestore 경로·신호·산출물 키)는 데이터 호환을 위해 유지하고, 사용자에게 보이는 번호만 이 매핑을 쓴다.
// A-2-3(학습자·맥락 분석)은 문서에 없는 앱 고유 활동이라 순서상 A-5로 표시.
export const ACTIVITY_DISPLAY_CODE: Record<ActivityCode, string> = {
  'T-1-1': 'T-1', 'T-1-2': 'T-2', 'T-2-1': 'T-3', 'T-2-2': 'T-4', 'T-2-3': 'T-5',
  'A-1-1': 'A-1', 'A-1-2': 'A-2', 'A-2-1': 'A-3', 'A-2-2': 'A-4', 'A-2-3': 'A-5',
  'Ds-1-1': 'Ds-1', 'Ds-1-2': 'Ds-2', 'Ds-1-3': 'Ds-3', 'Ds-2-1': 'Ds-4', 'Ds-2-2': 'Ds-5',
  'DI-1-1': 'DI-1', 'DI-2-1': 'DI-2',
  'E-1-1': 'E-1', 'E-2-1': 'E-2',
}

// 표시 번호 → 내부 코드 역매핑 (AI가 신호에 표시 번호를 쓴 경우의 정규화 방어용)
export const DISPLAY_TO_ACTIVITY_CODE: Record<string, ActivityCode> = Object.fromEntries(
  (Object.entries(ACTIVITY_DISPLAY_CODE) as [ActivityCode, string][]).map(([code, display]) => [display, code])
) as Record<string, ActivityCode>

/** 사용자에게 보여줄 활동 번호. 알 수 없는 코드는 원문 그대로 반환. */
export function displayActivityCode(code: string): string {
  return ACTIVITY_DISPLAY_CODE[code as ActivityCode] ?? code
}

export interface ActivityMeta {
  code: ActivityCode
  label: string
  stage: StageCode
  isGuardrailSource?: boolean   // A-2-3
  isGuardrailTarget?: boolean   // Ds 전체
  isBackwardDesignFirst?: boolean // Ds-1-1 (평가 먼저)
  /**
   * 완료 판정에 쓰이는 강제 섹션. `projects.ts`의 v2-sections 자동 승격 트리거이기도 하다.
   * 현재는 E-1-1/E-2-1 두 활동만 정의 (cycle 진입 조건으로 쓰임).
   */
  requiredSections?: RequiredSection[]
  /**
   * UI chip·AI 프롬프트 힌트용 "권장 섹션". 완료 판정에는 영향 없음.
   * - `completion.ts`는 requiredSections만 검증 → recommendedSections는 grandfather·완료 로직에 무영향.
   * - `projects.ts:338~340` 자동 v2-sections 승격도 requiredSections 기준이라 신규 산출물이 강제 검증으로 승격되지 않음.
   * - UI는 `requiredSections ?? recommendedSections` fallback + variant prop으로 "권장"/"필수" 톤 분기.
   */
  recommendedSections?: RequiredSection[]
}

// 활동 산출물의 필수 섹션 정의. `artifacts[code].content`가 `Record<string, unknown>` 형태이므로
// key는 실제 저장된 섹션명과 1:1 매칭됨 (한글 라벨 그대로 — AI의 [ARTIFACT_UPDATE: <label>=<값>] 신호가 그대로 키로 저장됨).
export interface RequiredSection {
  key: string           // content 맵의 키 (예: '사실', '해석', '수정안')
  label: string         // UI/프롬프트 표시용 (대부분 key와 동일)
  minChars: number      // 한국어 최소 글자 수 (기본 20자 — "ㅇㅇ" 등 nullity 차단)
  required: 'all' | 'any' // 'all'=전부 필수 / 'any'=섹션 중 최소 1개 충족
}

export const ACTIVITY_META: Record<ActivityCode, ActivityMeta> = {
  // ── recommendedSections (가이드 전용) — Task #9 / pedagogy-auditor 제안서 기준 ──
  // 원칙: required='any', minChars 10~20, key는 ARTIFACT_UPDATE 키 원문과 문자 단위 일치.
  // `AI 분석`·`AI 점검` 섹션은 제외(AI 자동 생성 메타).
  'T-1-1': {
    code: 'T-1-1', label: '공동 비전 설정', stage: 'T',
    recommendedSections: [
      { key: '개인 비전',    label: '개인 비전 키워드·정교화 문장', minChars: 20, required: 'any' },
      { key: '팀 공통 비전', label: '팀 공통 비전 문장',          minChars: 10, required: 'any' },
      { key: '핵심 키워드',  label: '비전 핵심 키워드 (3~5개)',    minChars: 5,  required: 'any' },
    ],
  },
  'T-1-2': {
    code: 'T-1-2', label: '수업설계 방향 설정', stage: 'T',
    recommendedSections: [
      { key: '설계 방향', label: '설계 방향 (방향·근거 표)', minChars: 20, required: 'any' },
    ],
  },
  'T-2-1': {
    code: 'T-2-1', label: '역할 배분', stage: 'T',
    recommendedSections: [
      { key: '역할 배분', label: '역할 배분 (교사별 5열 표)', minChars: 20, required: 'any' },
    ],
  },
  'T-2-2': {
    code: 'T-2-2', label: '팀 규칙 결정', stage: 'T',
    recommendedSections: [
      { key: '팀 규칙', label: '팀 규칙 (규칙명·필요 배경·실천 방법)', minChars: 20, required: 'any' },
    ],
  },
  'T-2-3': {
    code: 'T-2-3', label: '팀 일정 결정', stage: 'T',
    recommendedSections: [
      { key: '팀 일정', label: '팀 일정 (기간·활동·내용·담당자)', minChars: 20, required: 'any' },
    ],
  },
  'A-1-1': {
    code: 'A-1-1', label: '주제 선정 기준 논의·조정', stage: 'A',
    recommendedSections: [
      { key: '주제 선정 기준', label: '주제 선정 기준 (핵심 기준·참고 기준)', minChars: 10, required: 'any' },
    ],
  },
  'A-1-2': {
    code: 'A-1-2', label: '비전 기반 주제 선정', stage: 'A',
    // minChars: 주제명·기준명은 본질적으로 짧은 명사구라 낮게 조정.
    // "가중치" 표현은 AI가 자의적 숫자를 박아 교사 판단을 구속하는 부작용이 있어 라벨에서 제거 (우선순위 표현 자율).
    recommendedSections: [
      { key: '주제 선정 기준', label: '주제 선정 기준 (기준·설명·우선순위)', minChars: 10, required: 'any' },
      { key: '최종 선정 주제', label: '선정 주제',                          minChars: 3,  required: 'any' },
      { key: '주제 유형',      label: '주제 유형 (내용/기능/혼합)',          minChars: 3,  required: 'any' },
      { key: '선정 근거',      label: '선정 근거 (비전·교과·학생 맥락)',     minChars: 15, required: 'any' },
    ],
  },
  'A-2-1': {
    code: 'A-2-1', label: '주제 상세 분석·성취기준 재구조화', stage: 'A',
    // ⚠️ key는 `성취기준분석표` (띄어쓰기 없음). ChatPanel.tsx:660 extractA21TableForSave 출력과 1:1 일치.
    // ARTIFACT_UPDATE 신호 경로를 쓰지 않는 유일한 활동이라 Task #10 프롬프트 힌트도 별도 포맷 필요.
    recommendedSections: [
      { key: '성취기준분석표', label: '핵심아이디어 + 성취기준 분석표 + 융합 분석', minChars: 20, required: 'any' },
    ],
  },
  'A-2-2': {
    code: 'A-2-2', label: '통합 수업목표 진술', stage: 'A',
    recommendedSections: [
      { key: '공통 핵심 아이디어', label: '공통 핵심 아이디어 (1문장)',      minChars: 10, required: 'any' },
      { key: '통합 수업목표',     label: '통합 수업목표 (단일 문장)',       minChars: 15, required: 'any' },
      { key: '교과별 수업목표',   label: '교과별 수업목표 (태그 포함 표)', minChars: 20, required: 'any' },
    ],
  },
  'A-2-3': {
    code: 'A-2-3', label: '학습자·맥락 분석', stage: 'A', isGuardrailSource: true,
    // Ds 가드레일 카드 연동 시 이 단일 key를 참조.
    recommendedSections: [
      { key: '학습자 프로필', label: '학습자 프로필 (팀 공통 + 교사별 맞춤)', minChars: 20, required: 'any' },
    ],
  },
  'Ds-1-1': {
    code: 'Ds-1-1', label: '평가 설계', stage: 'Ds', isBackwardDesignFirst: true,
    recommendedSections: [
      { key: '평가 계획', label: '평가 계획 (평가 항목·방법·시점·상중하 루브릭)', minChars: 20, required: 'any' },
    ],
  },
  'Ds-1-2': {
    code: 'Ds-1-2', label: '문제 상황 설정', stage: 'Ds', isGuardrailTarget: true,
    recommendedSections: [
      { key: '문제상황',  label: '문제상황 시나리오 (제목·실제성·학습내용+산출물·청중+행위)', minChars: 20, required: 'any' },
      { key: '핵심 질문', label: '탐구 질문 (Driving Question)',                          minChars: 10, required: 'any' },
    ],
  },
  'Ds-1-3': {
    code: 'Ds-1-3', label: '학습활동 설계', stage: 'Ds', isGuardrailTarget: true,
    recommendedSections: [
      { key: '학습 활동', label: '학습 활동 (흐름 단계·동사형 활동명·핵심/부가·누적 차시·운영)', minChars: 20, required: 'any' },
      { key: 'AI 점검',  label: 'AI 점검 (목표·평가 정합성, 실행 적절성)',                  minChars: 20, required: 'any' },
    ],
  },
  'Ds-2-1': {
    code: 'Ds-2-1', label: '자료와 도구 연결', stage: 'Ds', isGuardrailTarget: true,
    recommendedSections: [
      { key: '활동별 자료 설계', label: '활동별 자료 설계 (활동·자료·이유·탐색/개발·공동/개별·담당·일정)', minChars: 20, required: 'any' },
      { key: 'AI 점검',          label: 'AI 점검 (학생 수준·출처·저작권·개인정보·접근성)',              minChars: 20, required: 'any' },
    ],
  },
  'Ds-2-2': {
    code: 'Ds-2-2', label: '스캐폴딩 설계', stage: 'Ds', isGuardrailTarget: true,
    recommendedSections: [
      { key: '지원 방안 정리', label: '지원 방안 정리 (지원 방안·대상 활동)',                   minChars: 20, required: 'any' },
      { key: '스캐폴딩 계획',  label: '스캐폴딩 계획 (활동·유형·내용·대상·점진적 제거)',        minChars: 20, required: 'any' },
      { key: 'AI 점검',       label: 'AI 점검 (GRR 부합·개별화 충분성·제거 시점)',             minChars: 20, required: 'any' },
    ],
  },
  'DI-1-1': {
    code: 'DI-1-1', label: '자료 탐색·개발', stage: 'DI',
    recommendedSections: [
      { key: '개발 자료 목록', label: '개발 자료 목록 (유형·자료명·교과·구분·담당자·우선순위·마감일)', minChars: 20, required: 'any' },
    ],
  },
  'DI-2-1': {
    code: 'DI-2-1', label: '수업 실행·기록', stage: 'DI',
    recommendedSections: [
      { key: '주요 상황 기록', label: '주요 상황 기록 (시점·상황·학생 반응·시사점)', minChars: 20, required: 'any' },
      { key: '종합 시사점',    label: '종합 시사점 (성공·장애·예상외·포용)',          minChars: 20, required: 'any' },
    ],
  },
  'E-1-1':  {
    code: 'E-1-1', label: '수업 성찰과 공동 개선', stage: 'E',
    // P1-I: 사실/해석/수정안 중 최소 1개 섹션(각 20자 이상) 충족 시 완료 인정.
    // Lead 결정 — E에 갇혀 cycle 진입 못 하는 상황을 막기 위한 완화 옵션.
    requiredSections: [
      { key: '사실',   label: '사실',   minChars: 20, required: 'any' },
      { key: '해석',   label: '해석',   minChars: 20, required: 'any' },
      { key: '수정안', label: '수정안', minChars: 20, required: 'any' },
    ],
  },
  'E-2-1':  {
    code: 'E-2-1', label: '협력 과정 성찰', stage: 'E',
    // 다음 주기 결정(A안/B안)만 필수, 팀 개선안은 선택.
    requiredSections: [
      { key: '다음 주기 선택', label: '다음 주기 선택', minChars: 10, required: 'all' },
      { key: '팀 개선안',      label: '팀 개선안',      minChars: 20, required: 'any' },
    ],
  },
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
  demoExperience?: {
    scenarioId: string
    generatedAt: number
    personaUids: string[]
  }
  // 초대코드 & 팀 관련
  inviteCode?: string
  hostUid?: string
  memberUids?: string[]
  memberInfo?: Record<string, { uid: string; displayName: string; color: string; emoji: string; joinedAt: number }>
  started?: boolean        // 방장이 시작 버튼을 눌러야 true
  analysisOpen?: boolean   // 단계 분석 모달 팀 동기화
  analysisReport?: {       // 방장이 생성한 보고서 (팀원 공유용, 현재 진행 중)
    stage: string
    content: string
    generating: boolean
  }
  stageReports?: Partial<Record<StageCode, {  // 완료된 단계별 보고서 영구 저장
    content: string
    savedAt: number
  }>>
  cumulativeReport?: {  // T→DI-1-1 종합 설계 보고서 (팀장 생성 후 팀 공유)
    content: string
    savedAt: number
    savedBy: string
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
  // 방장이 지식 그래프를 공유 중인지 (팀원 자동 오픈)
  graphOpen?: boolean
  graphView?: 'sheet' | 'graph'
  graphKeyword?: string  // 방장이 설정한 그래프 키워드
  // 팀원 중심 성취기준 추천 (nodeId → 추천 정보)
  graphCenterRecommendations?: Record<string, { nodeId: string; recommenderName: string; recommenderUid?: string | null }>
  // 팀장이 확정한 중심 노드 ID (팀원 화면에 자동 반영)
  graphCenterNodeId?: string
  // 방장의 그래프 선택/해제 상태 (팀원 실시간 동기화)
  graphSelectionState?: GraphSelectionState
  // 팀원이 방장에게 산출물 저장을 제안 (방장이 수락/거절)
  artifactProposal?: {
    activityCode: ActivityCode
    sections: Record<string, string>
    proposedBy: string
    proposedByName: string
    proposedAt: number
  }
  // 지식 그래프 저장 데이터
  graphSavedData?: GraphSavedData
  // 문제상황 디자이너 오픈 상태 (팀원 자동 오픈)
  problemSituationOpen?: boolean
  // 문제상황 저장 데이터
  problemSituationData?: {
    scenario: {
      title: string
      row1: string   // 문제 상황 서술
      row2: string   // 학습내용+산출물
      row3: string   // 데이터 출처
    }
    drivingQuestion: string
    essentialQuestions: string[]
    fullResult?: Record<string, unknown>  // 전체 생성 결과 (산출물 저장용)
    savedAt: number
  }
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
    // P1-I: 섹션 검증 스키마 버전. 'v2-sections' 이면 ACTIVITY_META[code].requiredSections 검증 적용.
    // undefined 또는 다른 값이면 레거시(grandfather) — 기존 로직으로만 완료 판정.
    _schemaVersion?: string
    // 산출물 이력 (최신 = 가장 큰 version). content 덮어쓰기 전 push, 최대 20개 유지.
    versions?: ArtifactVersion[]
  }>
  // P1-I: E→T 순환 시 직전 주기 E 산출물에서 추출된 개선안.
  // 다음 주기 T-1-1 프롬프트에 주입되어 지식 누적의 흐름을 만든다.
  // 단일 슬롯(덮어쓰기). 전체 이력은 별도 `cycle_history/{n}` 서브컬렉션으로 분리(P2).
  previousCycleImprovements?: {
    cycleNumber: number
    extractedAt: Timestamp
    e11Improvement?: string
    e21Improvement?: string
    nextCycleChoice?: 'A' | 'B'
  }
  // Phase 1-b: ACTION_CARD skip 로깅 (방장·팀원 모두 skip 가능, 분석용 누적)
  skippedActionCards?: SkippedActionCard[]
  // 중요 노트 (포스트잇) — 팀이 채팅에서 "중요"로 저장한 메시지 모음.
  // AI 프롬프트에 자동 주입되어 이전 활동 비공식 대화 맥락 보전.
  keyNotes?: KeyNote[]
  // 교육과정 시트 — A-2-1 핵심아이디어·성취기준 공동 편집 시트
  curriculumSheet?: CurriculumSheetRow[]
  // 교육과정 시트 프레즌스 — 누가 어느 셀을 편집 중인지 실시간 표시
  curriculumSheetPresence?: Record<string, {
    uid: string
    displayName: string
    color: string
    cellKey: string
    updatedAt: number
  }>
  // 팀 공통 비전 워크스페이스 — T-1-1 수동 공동 편집 초안
  teamVisionWorkspace?: TeamVisionWorkspace
  teamVisionWorkspacePresence?: Record<string, {
    uid: string
    displayName: string
    color: string
    cellKey: string
    updatedAt: number
  }>
  // 통합 수업목표 워크스페이스 — A-2-2 수동 공동 편집 초안
  // Presence는 projects/{id}/integratedGoalPresence subcollection로 분리됨
  // (부모 문서 updateTime 충돌로 인한 patchIntegratedGoalWorkspace 트랜잭션 failed-precondition 회피)
  integratedGoalWorkspace?: IntegratedGoalWorkspace
  // 수업설계 방향 워크스페이스 — T-1-2 수동 공동 편집 초안.
  // shape은 TeamVisionWorkspace와 동일 (열·행·블록). Presence는 projects/{id}/lessonDesignDirectionPresence subcollection로 분리.
  lessonDesignDirectionWorkspace?: LessonDesignDirectionWorkspace
  // 평가 계획 워크스페이스 — Ds-1-1 수동 공동 편집 초안. Presence는 projects/{id}/evaluationPlanPresence subcollection.
  evaluationPlanWorkspace?: EvaluationPlanWorkspace
  // 문제상황 워크스페이스 — Ds-1-2 수동 공동 편집 초안 (기존 problemSituationData와 별개).
  problemSituationWorkspace?: ProblemSituationWorkspace
  // 역할 배분 워크스페이스 — T-2-1 수동 공동 편집 초안.
  // 5열 표(교사명·담당교과·강점·전문성·팀내역할·담당업무) + 자유 블록. Presence는 projects/{id}/roleDistributionPresence subcollection로 분리.
  roleDistributionWorkspace?: RoleDistributionWorkspace
  // 팀 규칙 워크스페이스 — T-2-2 수동 공동 편집 초안.
  // 4열 표(분류·규칙명·설명·위반 시 조치) + 자유 블록. Presence는 projects/{id}/teamRulesPresence subcollection로 분리.
  teamRulesWorkspace?: TeamRulesWorkspace
  // 팀 일정 워크스페이스 — T-2-3 수동 공동 편집 초안.
  // 4열 표(기간·활동·산출/마감·담당자) + 자유 블록. Presence는 projects/{id}/teamSchedulePresence subcollection로 분리.
  teamScheduleWorkspace?: TeamScheduleWorkspace
  // 주제 선정 워크스페이스 — A-1-2 수동 공동 편집 초안.
  // 기준 표(기준·설명·우선순위) + 메타(선정 주제·주제 유형·선정 근거) + 자유 블록.
  // Presence는 projects/{id}/topicSelectionPresence subcollection로 분리.
  topicSelectionWorkspace?: TopicSelectionWorkspace
  // 학습활동 설계 워크스페이스 — Ds-1-3 수동 공동 편집 초안.
  // 8열 활동 표(순서·흐름단계·활동명·설명·핵심부가·교과·차시·운영) + 메타(AI 점검) + 자유 블록.
  // Presence는 projects/{id}/learningActivityPresence subcollection로 분리.
  learningActivityWorkspace?: LearningActivityWorkspace
  // 지원 도구(자료) 설계 워크스페이스 — Ds-2-1 수동 공동 편집 초안.
  supportToolWorkspace?: SupportToolWorkspace
  // 스캐폴딩 설계 워크스페이스 — Ds-2-2 수동 공동 편집 초안.
  // 5열 스캐폴딩 계획 표(대상활동·유형·내용·대상수준·점진적제거) + 메타(AI 점검) + 자유 블록.
  // Presence는 projects/{id}/scaffoldingPresence subcollection로 분리.
  scaffoldingWorkspace?: ScaffoldingWorkspace
  // 공개 배포 상태 — "공개 링크" 기능으로 보고서를 외부에 공유 중일 때 true.
  // 실제 공개 데이터는 Firestore `public_reports/{projectId}`에 **스냅샷**으로 별도 저장.
  // 원본 프로젝트를 직접 공개하지 않는 이유: 팀원 UID/메시지 등 민감 데이터 분리 보장.
  publicStatus?: {
    isPublic: boolean
    lastPublishedAt?: number
  }
}

// ─── 중요 노트 (포스트잇) ─────────────────────────────
// 교사가 채팅에서 "이 내용 중요해" 라고 표시한 메시지 스냅샷.
// 활동 경계를 넘어 프로젝트 전반에 유지되며, AI 프롬프트에 자동 주입.
export interface KeyNote {
  id: string                       // nanoid
  content: string                  // 내용 (AI 신호·이모지 필터 후)
  sourceActivityCode?: ActivityCode  // 저장된 활동
  sourceRole?: 'user' | 'assistant'  // 원 메시지 발화자 종류
  sourceDisplayName?: string       // 원 발화자 이름 (user only)
  savedBy: string                  // uid of saver
  savedByName?: string             // 저장자 이름
  savedAt: number                  // ms epoch
}

// ─── 교육과정 시트 (공동 편집) ────────────────────────────
// A-2-1 핵심아이디어·성취기준 분석을 시트 형태로 공동 작업.
// Firestore 프로젝트 문서에 저장되어 팀원 간 실시간 동기화.
export interface CurriculumSheetRow {
  id: string                    // nanoid
  session?: string              // 차시 (예: "1차시", "2-3차시")
  subject: string               // 과목명
  isCenter?: boolean            // 중심 교과 여부 (지식그래프 중심 노드로 연결)
  coreIdea: string              // 핵심아이디어 (DB 원문)
  standard: string              // 성취기준 코드 + 텍스트
  knowledge: string             // 지식·이해
  processFunction: string       // 과정·기능
  agentLessonExample?: string   // Agent 추천 수업 예시 (지식 그래프 관계 분석 기반)
  description: string           // 수업내용 설명 (자유 입력)
  updatedBy?: string            // 마지막 수정자 이름
  updatedAt?: number            // 마지막 수정 시각 (ms)
}

// ─── 팀 공통 비전 워크스페이스 (공동 편집) ─────────────────
// T-1-1에서 템플릿 표와 자유 블록을 함께 다루는 수동 편집 상태.
// 최종 저장 시 T-1-1 구조화 산출물의 manualWorkspace로 보존된다.
export interface TeamVisionWorkspaceColumn {
  id: string
  label: string
  color?: string
}

export interface TeamVisionWorkspaceRow {
  id: string
  cells: Record<string, string>
  color?: string
  updatedBy?: string
  updatedAt?: number
}

export type TeamVisionWorkspaceBlockType = 'heading' | 'subheading' | 'paragraph' | 'checklist' | 'quote' | 'table'

export interface TeamVisionWorkspaceTableData {
  columns: TeamVisionWorkspaceColumn[]
  rows: TeamVisionWorkspaceRow[]
}

export interface TeamVisionWorkspaceBlock {
  id: string
  type: TeamVisionWorkspaceBlockType
  content: string
  table?: TeamVisionWorkspaceTableData
  color?: string
  checked?: boolean
  includeInArtifact?: boolean
  updatedBy?: string
  updatedAt?: number
}

export interface TeamVisionWorkspace {
  columns: TeamVisionWorkspaceColumn[]
  rows: TeamVisionWorkspaceRow[]
  teamVision: string
  coreKeywords: string[]
  blocks: TeamVisionWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 통합 수업목표 워크스페이스 (A-2-2 공동 편집) ─────────
// A-2-2에서 공통 핵심 아이디어·통합 수업목표·교과별 목표 표를 함께 다루는 수동 편집 상태.
// 최종 저장 시 A-2-2 구조화 산출물(A22Structured)의 manualWorkspace로 보존된다.
// 컬럼/행/블록 타입은 TeamVisionWorkspace와 동일 구조를 재사용한다.
export type IntegratedGoalWorkspaceColumn = TeamVisionWorkspaceColumn
export type IntegratedGoalWorkspaceRow = TeamVisionWorkspaceRow
export type IntegratedGoalWorkspaceBlock = TeamVisionWorkspaceBlock
export type IntegratedGoalWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type IntegratedGoalWorkspaceTableData = TeamVisionWorkspaceTableData

export type IntegratedGoalMethod = 'inductive' | 'deductive'

export interface IntegratedGoalWorkspace {
  /** 교과별 수업목표 표의 컬럼 (디폴트: 교과·목표·지식·이해·과정·기능·가치·태도) */
  columns: IntegratedGoalWorkspaceColumn[]
  /** 교과별 수업목표 표의 행 */
  rows: IntegratedGoalWorkspaceRow[]
  /** 공통 핵심 아이디어 (단일 문장) */
  commonCoreIdea: string
  /** 통합 수업목표 (단일 문장, "학생은 ~ 할 수 있다") */
  integratedGoal: string
  /** 핵심 키워드 (수렴 키워드, 최대 8개) */
  convergentKeywords: string[]
  /** 진술 방식 — 귀납적/연역적 */
  method?: IntegratedGoalMethod
  /** 자유 형식 블록 (문단·제목·표·인용·체크리스트) */
  blocks: IntegratedGoalWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 수업설계 방향 워크스페이스 (T-1-2 공동 편집) ─────────
// T-1-2에서 "설계 원칙·근거" 표와 자유 편집 블록을 함께 다루는 수동 편집 상태.
// 최종 저장 시 T-1-2 구조화 산출물(T12Structured)의 manualWorkspace로 보존된다.
// 컬럼/행/블록 타입은 TeamVisionWorkspace와 동일 구조를 재사용 (의미적 분리만 위한 alias).
export type LessonDesignDirectionWorkspaceColumn = TeamVisionWorkspaceColumn
export type LessonDesignDirectionWorkspaceRow = TeamVisionWorkspaceRow
export type LessonDesignDirectionWorkspaceBlock = TeamVisionWorkspaceBlock
export type LessonDesignDirectionWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type LessonDesignDirectionWorkspaceTableData = TeamVisionWorkspaceTableData

export interface LessonDesignDirectionWorkspace {
  /** 설계 원칙·근거 표의 컬럼 (디폴트: principle·rationale) */
  columns: LessonDesignDirectionWorkspaceColumn[]
  /** 표의 행 */
  rows: LessonDesignDirectionWorkspaceRow[]
  /** 자유 형식 블록 */
  blocks: LessonDesignDirectionWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 평가 계획 워크스페이스 (Ds-1-1 공동 편집) ─────────
// Ds-1-1에서 "평가 항목·방법·시점·상·중·하" 6열 루브릭 표와 자유 편집 블록을 다루는 수동 편집 상태.
// 최종 저장 시 Ds-1-1 구조화 산출물(Ds11Structured)의 manualWorkspace로 보존된다.
export type EvaluationPlanWorkspaceColumn = TeamVisionWorkspaceColumn
export type EvaluationPlanWorkspaceRow = TeamVisionWorkspaceRow
export type EvaluationPlanWorkspaceBlock = TeamVisionWorkspaceBlock
export type EvaluationPlanWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type EvaluationPlanWorkspaceTableData = TeamVisionWorkspaceTableData

export interface EvaluationPlanWorkspace {
  /** 루브릭 표 컬럼 (디폴트: item·method·timing·high·mid·low) */
  columns: EvaluationPlanWorkspaceColumn[]
  /** 표의 행 */
  rows: EvaluationPlanWorkspaceRow[]
  /** 자유 형식 블록 */
  blocks: EvaluationPlanWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 문제상황 워크스페이스 (Ds-1-2 공동 편집) ─────────
// "문제상황 시나리오 요소·내용" 표(요소|내용) + 자유 편집 블록. 시드 행: 제목/실제성/학습 내용+산출물/청중+행위/핵심 질문.
export type ProblemSituationWorkspaceColumn = TeamVisionWorkspaceColumn
export type ProblemSituationWorkspaceRow = TeamVisionWorkspaceRow
export type ProblemSituationWorkspaceBlock = TeamVisionWorkspaceBlock
export type ProblemSituationWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type ProblemSituationWorkspaceTableData = TeamVisionWorkspaceTableData

export interface ProblemSituationWorkspace {
  columns: ProblemSituationWorkspaceColumn[]
  rows: ProblemSituationWorkspaceRow[]
  blocks: ProblemSituationWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 지원 도구(자료) 워크스페이스 (Ds-2-1 공동 편집) ─────────
// 활동별 필요 자료 표(대상 활동·자료명·활용 이유·탐색/개발·공동/개별·담당·일정) + 자유 편집 블록.
// 최종 저장 시 Ds-2-1 구조화 산출물(Ds21Structured)의 manualWorkspace로 보존.
export type SupportToolWorkspaceColumn = TeamVisionWorkspaceColumn
export type SupportToolWorkspaceRow = TeamVisionWorkspaceRow
export type SupportToolWorkspaceBlock = TeamVisionWorkspaceBlock
export type SupportToolWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type SupportToolWorkspaceTableData = TeamVisionWorkspaceTableData

export interface SupportToolWorkspace {
  columns: SupportToolWorkspaceColumn[]
  rows: SupportToolWorkspaceRow[]
  blocks: SupportToolWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 역할 배분 워크스페이스 (T-2-1 공동 편집) ─────────────
// T-2-1에서 5열 역할 배분 표(교사명·담당교과·강점·전문성·팀내역할·담당업무)와
// 자유 편집 블록을 함께 다루는 수동 편집 상태.
// 최종 저장 시 T-2-1 구조화 산출물(T21Structured)의 manualWorkspace로 보존된다.
// 컬럼/행/블록 타입은 TeamVisionWorkspace와 동일 구조를 재사용 (의미적 분리만 위한 alias).
export type RoleDistributionWorkspaceColumn = TeamVisionWorkspaceColumn
export type RoleDistributionWorkspaceRow = TeamVisionWorkspaceRow
export type RoleDistributionWorkspaceBlock = TeamVisionWorkspaceBlock
export type RoleDistributionWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type RoleDistributionWorkspaceTableData = TeamVisionWorkspaceTableData

export interface RoleDistributionWorkspace {
  /** 역할 배분 표의 컬럼 (디폴트 5열: teacherName·subject·strengths·role·responsibilities) */
  columns: RoleDistributionWorkspaceColumn[]
  /** 표의 행 (팀원별 한 줄) */
  rows: RoleDistributionWorkspaceRow[]
  /** 자유 형식 블록 (문단·제목·표·인용·체크리스트) */
  blocks: RoleDistributionWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 팀 규칙 워크스페이스 (T-2-2 공동 편집) ──────────────
// 4열 표(category·name·description·violation) + 자유 블록.
export type TeamRulesWorkspaceColumn = TeamVisionWorkspaceColumn
export type TeamRulesWorkspaceRow = TeamVisionWorkspaceRow
export type TeamRulesWorkspaceBlock = TeamVisionWorkspaceBlock
export type TeamRulesWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type TeamRulesWorkspaceTableData = TeamVisionWorkspaceTableData

export interface TeamRulesWorkspace {
  columns: TeamRulesWorkspaceColumn[]
  rows: TeamRulesWorkspaceRow[]
  blocks: TeamRulesWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 팀 일정 워크스페이스 (T-2-3 공동 편집) ──────────────
// 4열 표(period·activity·content·assignee) + 자유 블록.
export type TeamScheduleWorkspaceColumn = TeamVisionWorkspaceColumn
export type TeamScheduleWorkspaceRow = TeamVisionWorkspaceRow
export type TeamScheduleWorkspaceBlock = TeamVisionWorkspaceBlock
export type TeamScheduleWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type TeamScheduleWorkspaceTableData = TeamVisionWorkspaceTableData

export interface TeamScheduleWorkspace {
  columns: TeamScheduleWorkspaceColumn[]
  rows: TeamScheduleWorkspaceRow[]
  blocks: TeamScheduleWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 주제 선정 워크스페이스 (A-1-2 공동 편집) ─────────────
// IGW 패턴: 메타 단일 필드 + 기준 표 + 자유 블록.
// 기준 표(criterion·description·priority) + 메타(selectedTopic·topicType·rationale).
export type TopicSelectionWorkspaceColumn = TeamVisionWorkspaceColumn
export type TopicSelectionWorkspaceRow = TeamVisionWorkspaceRow
export type TopicSelectionWorkspaceBlock = TeamVisionWorkspaceBlock
export type TopicSelectionWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type TopicSelectionWorkspaceTableData = TeamVisionWorkspaceTableData

export interface TopicSelectionWorkspace {
  /** 주제 선정 기준 표의 컬럼 (디폴트 3열: criterion·description·priority) */
  columns: TopicSelectionWorkspaceColumn[]
  /** 기준 표의 행 */
  rows: TopicSelectionWorkspaceRow[]
  /** 최종 선정 주제 (단일 문장) */
  selectedTopic: string
  /** 주제 유형 — 내용요소형 / 기능요소형 / 혼합형 */
  topicType: string
  /** 선정 근거 (비전·교과·학생 맥락) */
  rationale: string
  /** 자유 형식 블록 (문단·제목·표·인용·체크리스트) */
  blocks: TopicSelectionWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 학습활동 설계 워크스페이스 (Ds-1-3 공동 편집) ─────────
// IGW 패턴: 메타 단일 필드(review) + 8열 활동 표 + 자유 블록.
export type LearningActivityWorkspaceColumn = TeamVisionWorkspaceColumn
export type LearningActivityWorkspaceRow = TeamVisionWorkspaceRow
export type LearningActivityWorkspaceBlock = TeamVisionWorkspaceBlock
export type LearningActivityWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type LearningActivityWorkspaceTableData = TeamVisionWorkspaceTableData

export interface LearningActivityWorkspace {
  /** 학습활동 표의 컬럼 (디폴트 8열: order·phase·name·description·coreType·subject·session·operation) */
  columns: LearningActivityWorkspaceColumn[]
  /** 활동 표의 행 */
  rows: LearningActivityWorkspaceRow[]
  /** AI 점검 — 목표·평가 정합성, 흐름·실행 적절성 단락 */
  review: string
  /** 자유 형식 블록 (문단·제목·표·인용·체크리스트) */
  blocks: LearningActivityWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 스캐폴딩 설계 워크스페이스 (Ds-2-2 공동 편집) ─────────
// IGW 패턴: 메타 단일 필드(review) + 5열 스캐폴딩 계획 표 + 자유 블록.
export type ScaffoldingWorkspaceColumn = TeamVisionWorkspaceColumn
export type ScaffoldingWorkspaceRow = TeamVisionWorkspaceRow
export type ScaffoldingWorkspaceBlock = TeamVisionWorkspaceBlock
export type ScaffoldingWorkspaceBlockType = TeamVisionWorkspaceBlockType
export type ScaffoldingWorkspaceTableData = TeamVisionWorkspaceTableData

export interface ScaffoldingWorkspace {
  /** 스캐폴딩 계획 표의 컬럼 (디폴트 5열: targetActivity·type·content·level·fadeOut) */
  columns: ScaffoldingWorkspaceColumn[]
  /** 스캐폴딩 계획 표의 행 */
  rows: ScaffoldingWorkspaceRow[]
  /** AI 점검 — GRR 부합·개별화 충분성·제거 시점 명확성 단락 */
  review: string
  /** 자유 형식 블록 (문단·제목·표·인용·체크리스트). 지원 방안 정리는 표 블록으로 자유 작성 */
  blocks: ScaffoldingWorkspaceBlock[]
  updatedBy?: string
  updatedAt?: number
}

// ─── 공개 배포 보고서 ─────────────────────────────────
// Firestore 루트 컬렉션 `public_reports/{projectId}`에 저장되는 스냅샷.
// 인증 없이 누구나 read 가능하도록 rule에서 허용.
// 원본 프로젝트의 민감 필드(memberUids, memberInfo, messages, inviteCode, hostUid 등)는 절대 포함하지 않는다.
export interface PublicReport {
  projectId: string
  projectTitle: string
  publishedAt: number           // ms epoch
  // 공개 시점에 존재했던 프로젝트 메타 (익명화)
  schoolLevel: SchoolLevel
  targetGradeGroup: GradeGroup
  targetSubjects: string[]
  cycleCount: number
  memberCount: number           // 팀원 수만 익명 노출 (이름·UID 제외)
  // 보고서 스냅샷
  stageReports?: Partial<Record<StageCode, { content: string; savedAt: number }>>
  cumulativeReport?: { content: string; savedAt: number }
}

// ─── ACTION_CARD 관련 타입 (Phase 1-b) ──────────────────
// 파서가 추출한 순수 데이터 형태. ux-frontend-reviewer의 ActionCardProps는 이 타입을 포함한 컴포넌트 props.
export interface ActionCard {
  intent: string      // 필수 — 카드 목적 한 문장
  primary: string     // 필수 — 권장 행동 라벨
  secondary?: string  // 선택 — 대안 행동
  skip: string        // 필수 — 건너뛰기 라벨
}

export interface SkippedActionCard {
  cardId: string          // = messageId (ACTION_CARD가 첨부된 메시지 id)
  activityCode: ActivityCode
  intent: string          // 원본 intent (분석용)
  primary: string         // 원본 primary 라벨 (분석용)
  dismissedBy: string     // userId
  displayName: string
  dismissedAt: number     // Date.now()
}

// Phase 1-c: ActionCard 컴포넌트 props (UI 레이어 전용)
// 데이터 타입 ActionCard와 분리 — flow-integrator가 Firestore에는 ActionCard만 저장,
// 렌더 시 ChatPanel이 stage/isHost/isSelected 등 UI 맥락을 덧붙여 props 구성.
export interface ActionCardProps {
  card: ActionCard
  stage: StageCode         // 단계 색상 매핑 (T=파랑, A=보라, Ds=청록, DI=주황, E=빨강)
  isHost: boolean          // 방장만 primary/secondary 활성, 팀원은 skip만
  isSelected?: boolean     // 이미 선택된 카드면 전체 비활성 + 배지 표시
  selectedLabel?: string   // 선택된 버튼 라벨 (배지 문구에 사용)
  onPrimary: () => void
  onSecondary?: () => void
  onSkip: () => void
}

// ─── 프로젝트 자료 / RAG ──────────────────────────────────
export type ProjectMaterialStatus = 'uploaded' | 'processing' | 'ready' | 'failed'
export type MaterialChunkType = 'front_matter' | 'body' | 'activity_material' | 'appendix'
export type TextExtractQuality = 'high' | 'medium' | 'low'

export interface ProjectMaterial {
  id: string
  projectId: string
  fileName: string
  mimeType: string
  size: number
  storagePath?: string
  downloadURL?: string
  status: ProjectMaterialStatus
  pageCount?: number
  chunkCount?: number
  textPageCount?: number
  imageOnlyPageCount?: number
  textExtractQuality?: TextExtractQuality
  summary?: string
  error?: string
  createdBy: string
  createdByName?: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
  readyAt?: number
}

export interface MaterialChunk {
  id: string
  projectId: string
  materialId: string
  fileName: string
  chunkIndex: number
  chunkType: MaterialChunkType
  pageStart: number
  pageEnd: number
  unitTitle?: string
  topicTitle?: string
  text: string
  keywords: string[]
  embedding: number[]
  tokenCount: number
  createdAt?: Timestamp
}

export interface MaterialSearchHit {
  materialId: string
  fileName: string
  chunkIndex: number
  pageStart: number
  pageEnd: number
  chunkType: MaterialChunkType
  score: number
  text: string
  unitTitle?: string
  topicTitle?: string
}

// ─── 산출물 ──────────────────────────────────────────
export type ArtifactStatus = 'ai_draft' | 'in_review' | 'confirmed' | 'rejected'

// 산출물 이력 스냅샷 — content 덮어쓰기 전 push되어 rollback dropdown의 소스.
export interface ArtifactVersion {
  version: number
  content: Record<string, unknown>
  savedAt: number  // ms timestamp
  savedBy?: string  // displayName
}

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
  // Phase 1-b: ACTION_CARD 첨부. 파서가 추출 → Firestore 저장 → 렌더 시 재구성.
  // state는 클릭 후 갱신. selection은 어떤 버튼이 눌렸는지.
  actionCard?: ActionCard
  actionCardState?: 'pending' | 'selected' | 'skipped'
  actionCardSelection?: 'primary' | 'secondary' | 'skip'
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

import { create } from 'zustand'
import type { Project, StageCode, ActivityCode, Message, Artifact, StageStatus, KeyNote } from '@/types'
import type { UserProfile } from '@/lib/auth'

interface StageActivityState {
  [key: string]: StageStatus  // "T-1-1" → status
}

// 중요 노트 union: 레거시(프로젝트 문서 배열) + subcollection.
// 같은 id면 subcollection이 권위(덮어씀). savedAt ASC 정렬 → 모달/백엔드 번호 규약과 일치.
function mergeKeyNotes(legacy: KeyNote[], sub: KeyNote[]): KeyNote[] {
  const map = new Map<string, KeyNote>()
  for (const n of legacy) map.set(n.id, n)
  for (const n of sub) map.set(n.id, n)
  return [...map.values()].sort((a, b) => a.savedAt - b.savedAt)
}

interface ProjectStore {
  // 현재 사용자
  userProfile: UserProfile | null
  setUserProfile: (p: UserProfile | null) => void

  // 현재 프로젝트
  project: Project | null
  setProject: (p: Project | null) => void

  // 중요 노트: 레거시 배열 + subcollection union을 project.keyNotes로 노출
  keyNotesLegacy: KeyNote[]
  keyNotesSub: KeyNote[]
  setKeyNotes: (notes: KeyNote[]) => void

  // 단계·활동 상태
  activityStatus: StageActivityState
  setActivityStatus: (code: ActivityCode, status: StageStatus) => void

  // 현재 활동 (Firestore 동기화 — 방장이 제어)
  currentActivity: ActivityCode
  setCurrentActivity: (code: ActivityCode) => void

  // 탭 뷰 활동 (방장: currentActivity와 동일, 팀원: 독립적 탐색)
  viewingActivity: ActivityCode
  setViewingActivity: (code: ActivityCode) => void

  // 메시지
  messages: Message[]
  addMessage: (msg: Message) => void
  /** fields를 주면 새 응답의 필드(actionCard 등)도 함께 바꾼다. undefined 값은 기존 필드를 지운다. */
  replaceMessage: (id: string, content: string, fields?: Partial<Omit<Message, 'id' | 'content'>>) => void
  setMessages: (msgs: Message[]) => void
  messagesLoaded: boolean          // Firestore 첫 응답 여부
  /** 첫 스냅샷 없이 5초 대비 타이머로 켜진 '로드 완료' — 환영 메시지 생성 판단에서 제외한다(#33) */
  messagesLoadedByFallback: boolean
  /** byFallback=true 는 대비 타이머 경로. 실제 스냅샷·오류 응답은 기본값(false)으로 플래그를 해제한다 */
  setMessagesLoaded: (v: boolean, byFallback?: boolean) => void
  streamingText: string
  setStreamingText: (text: string) => void
  appendStreamingText: (chunk: string) => void
  clearStreamingText: () => void

  // 현재 산출물
  currentArtifact: Artifact | null
  setCurrentArtifact: (artifact: Artifact | null) => void

  // E→T 순환 모달
  showCycleModal: boolean
  setShowCycleModal: (show: boolean) => void

  // 단계 이동 모달
  pendingStageMove: StageCode | null
  /** AI 되돌아가기로 연 단계 이동 창의 도착 활동(#29). 다른 경로로 창을 열면 null */
  pendingReturnActivity: ActivityCode | null
  setPendingStageMove: (stage: StageCode | null, returnActivity?: ActivityCode | null) => void

  // 팀 자유 토의 모드
  discussionMode: 'ai_facilitated' | 'team_discussion'
  setDiscussionMode: (mode: 'ai_facilitated' | 'team_discussion') => void
  pendingTeamDiscussion: { topic: string } | null
  setPendingTeamDiscussion: (v: { topic: string } | null) => void
  teamDiscussionStartIdx: number
  setTeamDiscussionStartIdx: (idx: number) => void

  // 분석 결과 → 산출물 저장 제안
  pendingArtifactSave: {
    title: string
    sections: Record<string, string>
    activityCode?: string    // 크로스-활동 또는 Firestore 제안 시 명시
    proposerName?: string    // 팀원이 제안한 경우 이름
  } | null
  setPendingArtifactSave: (v: { title: string; sections: Record<string, string>; activityCode?: string; proposerName?: string } | null) => void

  // 산출물 패널 등에서 채팅 입력창에 프롬프트를 "주입 요청"할 때 사용 (ChatPanel이 consume 후 null로 리셋)
  chatInputRequest: string | null
  setChatInputRequest: (text: string | null) => void

  // 프로젝트 전환 시 상태 초기화
  resetProjectState: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  userProfile: null,
  setUserProfile: (p) => set({ userProfile: p }),

  project: null,
  setProject: (p) => set((state) => {
    const legacy = p?.keyNotes ?? []
    return {
      project: p ? { ...p, keyNotes: mergeKeyNotes(legacy, state.keyNotesSub) } : null,
      keyNotesLegacy: legacy,
      pendingStageMove: p?.currentStage === state.pendingStageMove ? null : state.pendingStageMove,
    }
  }),

  keyNotesLegacy: [],
  keyNotesSub: [],
  setKeyNotes: (notes) => set((state) => ({
    keyNotesSub: notes,
    project: state.project ? { ...state.project, keyNotes: mergeKeyNotes(state.keyNotesLegacy, notes) } : null,
  })),

  activityStatus: {},
  setActivityStatus: (code, status) =>
    set((state) => ({ activityStatus: { ...state.activityStatus, [code]: status } })),

  currentActivity: 'T-1-1',
  setCurrentActivity: (code) => set((state) => {
    if (state.currentActivity === code) {
      return state
    }
    return {
      currentActivity: code,
      currentArtifact: null,
      pendingArtifactSave: null,
      discussionMode: 'ai_facilitated',
      pendingTeamDiscussion: null,
      teamDiscussionStartIdx: 0,
      messages: [],
      messagesLoaded: false,
      messagesLoadedByFallback: false,
    }
  }),

  viewingActivity: 'T-1-1',
  setViewingActivity: (code) => set({ viewingActivity: code, currentArtifact: null }),

  messages: [],
  // P0-bug1: id 기반 중복 제거. 환영 메시지 등 낙관적 추가 + Firestore onSnapshot 재전달로
  // 같은 id 메시지가 두 번 들어오는 경우 React key 중복 경고가 발생하던 문제 해결.
  // (Map은 삽입 순서를 유지하므로 메시지 시간순 정렬은 안전)
  addMessage: (msg) => set((state) =>
    state.messages.some(m => m.id === msg.id)
      ? state
      : { messages: [...state.messages, msg] }
  ),
  replaceMessage: (id, content, fields) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, ...fields, content } : m),
  })),
  setMessages: (msgs) => set({
    messages: Array.from(new Map(msgs.map(m => [m.id, m])).values()),
  }),
  messagesLoaded: false,
  messagesLoadedByFallback: false,
  setMessagesLoaded: (v, byFallback = false) => set({ messagesLoaded: v, messagesLoadedByFallback: v && byFallback }),
  streamingText: '',
  setStreamingText: (text) => set({ streamingText: text }),
  appendStreamingText: (chunk) =>
    set((state) => ({ streamingText: state.streamingText + chunk })),
  clearStreamingText: () => set({ streamingText: '' }),

  currentArtifact: null,
  setCurrentArtifact: (artifact) => set({ currentArtifact: artifact }),

  showCycleModal: false,
  setShowCycleModal: (show) => set({ showCycleModal: show }),

  pendingStageMove: null,
  pendingReturnActivity: null,
  setPendingStageMove: (stage, returnActivity = null) => set((state) => {
    if (stage && state.project?.currentStage === stage) {
      return state.pendingStageMove ? { pendingStageMove: null, pendingReturnActivity: null } : {}
    }
    const nextReturn = stage ? returnActivity : null
    if (state.pendingStageMove === stage && state.pendingReturnActivity === nextReturn) return {}
    return { pendingStageMove: stage, pendingReturnActivity: nextReturn }
  }),

  discussionMode: 'ai_facilitated',
  setDiscussionMode: (mode) => set({ discussionMode: mode }),
  pendingTeamDiscussion: null,
  setPendingTeamDiscussion: (v) => set({ pendingTeamDiscussion: v }),
  teamDiscussionStartIdx: 0,
  setTeamDiscussionStartIdx: (idx) => set({ teamDiscussionStartIdx: idx }),

  pendingArtifactSave: null,
  setPendingArtifactSave: (v) => set({ pendingArtifactSave: v }),

  chatInputRequest: null,
  setChatInputRequest: (text) => set({ chatInputRequest: text }),

  resetProjectState: () => set({
    project: null,
    keyNotesLegacy: [],
    keyNotesSub: [],
    activityStatus: {},
    currentActivity: 'T-1-1',
    viewingActivity: 'T-1-1',
    messages: [],
    messagesLoaded: false,
    messagesLoadedByFallback: false,
    streamingText: '',
    currentArtifact: null,
    showCycleModal: false,
    pendingStageMove: null,
    pendingReturnActivity: null,
    discussionMode: 'ai_facilitated',
    pendingTeamDiscussion: null,
    teamDiscussionStartIdx: 0,
    pendingArtifactSave: null,
    chatInputRequest: null,
  }),
}))

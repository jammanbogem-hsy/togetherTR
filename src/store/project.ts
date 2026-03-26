import { create } from 'zustand'
import type { Project, StageCode, ActivityCode, Message, Artifact, StageStatus } from '@/types'
import type { UserProfile } from '@/lib/auth'

interface StageActivityState {
  [key: string]: StageStatus  // "T-1-1" → status
}

interface ProjectStore {
  // 현재 사용자
  userProfile: UserProfile | null
  setUserProfile: (p: UserProfile | null) => void

  // 현재 프로젝트
  project: Project | null
  setProject: (p: Project | null) => void

  // 단계·활동 상태
  activityStatus: StageActivityState
  setActivityStatus: (code: ActivityCode, status: StageStatus) => void

  // 현재 활동
  currentActivity: ActivityCode
  setCurrentActivity: (code: ActivityCode) => void

  // 메시지
  messages: Message[]
  addMessage: (msg: Message) => void
  setMessages: (msgs: Message[]) => void
  messagesLoaded: boolean          // Firestore 첫 응답 여부
  setMessagesLoaded: (v: boolean) => void
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
  setPendingStageMove: (stage: StageCode | null) => void

  // 팀 자유 토론 모드
  discussionMode: 'ai_facilitated' | 'team_discussion'
  setDiscussionMode: (mode: 'ai_facilitated' | 'team_discussion') => void
  pendingTeamDiscussion: { topic: string } | null
  setPendingTeamDiscussion: (v: { topic: string } | null) => void
  teamDiscussionStartIdx: number
  setTeamDiscussionStartIdx: (idx: number) => void

  // 분석 결과 → 산출물 저장 제안
  pendingArtifactSave: {
    title: string
    sections: Record<string, string>  // { '합의 내용': '...', '미결 사항': '...' }
  } | null
  setPendingArtifactSave: (v: { title: string; sections: Record<string, string> } | null) => void

  // 프로젝트 전환 시 상태 초기화
  resetProjectState: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  userProfile: null,
  setUserProfile: (p) => set({ userProfile: p }),

  project: null,
  setProject: (p) => set({ project: p }),

  activityStatus: {},
  setActivityStatus: (code, status) =>
    set((state) => ({ activityStatus: { ...state.activityStatus, [code]: status } })),

  currentActivity: 'T-1-1',
  setCurrentActivity: (code) => set({ currentActivity: code, currentArtifact: null, pendingArtifactSave: null }),

  messages: [],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  messagesLoaded: false,
  setMessagesLoaded: (v) => set({ messagesLoaded: v }),
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
  setPendingStageMove: (stage) => set({ pendingStageMove: stage }),

  discussionMode: 'ai_facilitated',
  setDiscussionMode: (mode) => set({ discussionMode: mode }),
  pendingTeamDiscussion: null,
  setPendingTeamDiscussion: (v) => set({ pendingTeamDiscussion: v }),
  teamDiscussionStartIdx: 0,
  setTeamDiscussionStartIdx: (idx) => set({ teamDiscussionStartIdx: idx }),

  pendingArtifactSave: null,
  setPendingArtifactSave: (v) => set({ pendingArtifactSave: v }),

  resetProjectState: () => set({
    project: null,
    activityStatus: {},
    currentActivity: 'T-1-1',
    messages: [],
    messagesLoaded: false,
    streamingText: '',
    currentArtifact: null,
    showCycleModal: false,
    pendingStageMove: null,
    discussionMode: 'ai_facilitated',
    pendingTeamDiscussion: null,
    teamDiscussionStartIdx: 0,
    pendingArtifactSave: null,
  }),
}))

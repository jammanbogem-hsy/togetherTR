import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc, deleteDoc, query,
  where, orderBy, serverTimestamp, onSnapshot, Unsubscribe, arrayUnion, deleteField
} from 'firebase/firestore'
import { db } from './config'
import type { Project, StageCode, ActivityCode, Artifact, Message, StageTransition } from '@/types'
import { ACTIVITY_META } from '@/types'
import { addJoinedProjectId } from '@/lib/inviteCode'

// ─── 프로젝트 CRUD ───────────────────────────────────

export async function createProject(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'projects'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function getProject(projectId: string): Promise<Project | null> {
  const snap = await getDoc(doc(db, 'projects', projectId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Project
}

export async function getUserProjects(userId: string): Promise<Project[]> {
  const seen = new Set<string>()
  const projects: Project[] = []

  const merge = (docs: any[]) => {
    for (const d of docs) {
      if (!seen.has(d.id)) {
        seen.add(d.id)
        projects.push({ id: d.id, ...d.data() } as Project)
      }
    }
  }

  // 1) memberUids에 포함된 프로젝트
  // 2) createdBy == userId (레거시)
  // 3) createdBy == 'demo-user' (개발 초기 데이터 복구용)
  // 4) localStorage에 저장된 프로젝트 ID 직접 조회
  const queries = [
    getDocs(query(collection(db, 'projects'), where('memberUids', 'array-contains', userId))),
    getDocs(query(collection(db, 'projects'), where('createdBy', '==', userId))),
    getDocs(query(collection(db, 'projects'), where('createdBy', '==', 'demo-user'))),
  ]

  const results = await Promise.allSettled(queries)
  for (const r of results) {
    if (r.status === 'fulfilled') merge(r.value.docs)
  }

  // localStorage 멤버십 (초대받은 방)
  const { getJoinedProjectIds } = await import('@/lib/inviteCode')
  const localIds = getJoinedProjectIds()
  const localFetches = localIds
    .filter(id => !seen.has(id))
    .map(id => getDoc(doc(db, 'projects', id)))
  const localSnaps = await Promise.allSettled(localFetches)
  for (const r of localSnaps) {
    if (r.status === 'fulfilled' && r.value.exists()) {
      const d = r.value
      if (!seen.has(d.id)) {
        seen.add(d.id)
        projects.push({ id: d.id, ...d.data() } as Project)
      }
    }
  }

  return projects.sort((a, b) => {
    const aTime = a.updatedAt?.toDate?.()?.getTime() ?? 0
    const bTime = b.updatedAt?.toDate?.()?.getTime() ?? 0
    return bTime - aTime
  })
}

export async function findProjectByInviteCode(code: string): Promise<Project | null> {
  const q = query(collection(db, 'projects'), where('inviteCode', '==', code))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...d.data() } as Project
}

export async function joinProject(
  projectId: string,
  uid: string,
  memberInfo?: { displayName: string; color: string; emoji: string }
): Promise<void> {
  const updates: Record<string, unknown> = {
    memberUids: arrayUnion(uid),
    updatedAt: serverTimestamp(),
  }
  if (memberInfo) {
    updates[`memberInfo.${uid}`] = { ...memberInfo, uid, joinedAt: Date.now() }
  }
  await updateDoc(doc(db, 'projects', projectId), updates)
  addJoinedProjectId(projectId)
}

// ─── 로비 채팅 (대기실 채팅) ─────────────────────────

export interface LobbyMessage {
  id: string
  uid: string
  displayName: string
  color: string
  emoji: string
  content: string
  createdAt: any
}

export async function sendLobbyMessage(
  projectId: string,
  data: Omit<LobbyMessage, 'id' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(db, `projects/${projectId}/lobby`), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export function watchLobbyMessages(
  projectId: string,
  callback: (messages: LobbyMessage[]) => void
): Unsubscribe {
  const q = query(
    collection(db, `projects/${projectId}/lobby`),
    orderBy('createdAt', 'asc')
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as LobbyMessage))
  })
}

// ─── 팀 채팅 상태 동기화 ──────────────────────────────

export async function setTeamDiscussion(
  projectId: string,
  active: boolean,
  topic?: string
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    teamDiscussion: active
      ? { active: true, topic: topic ?? '', startedAt: Date.now() }
      : { active: false },
    updatedAt: serverTimestamp(),
  })
}

export async function requestTeamDiscussion(
  projectId: string,
  requestedBy: string,
  displayName: string
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    teamDiscussionRequest: { pending: true, requestedBy, displayName, requestedAt: Date.now() },
    updatedAt: serverTimestamp(),
  })
}

export async function clearTeamDiscussionRequest(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    teamDiscussionRequest: { pending: false },
    updatedAt: serverTimestamp(),
  })
}

// ─── 현재 활동 동기화 ────────────────────────────────

export async function setProjectActivity(
  projectId: string,
  activityCode: ActivityCode
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    currentActivity: activityCode,
    updatedAt: serverTimestamp(),
  })
}

export async function setActivityStatus(
  projectId: string,
  activityCode: ActivityCode,
  status: import('@/types').StageStatus
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`activityStatuses.${activityCode}`]: status,
    updatedAt: serverTimestamp(),
  })
}

// 현재 활동 완료 후 다음 활동으로 전진 (건너뛴 활동은 warning 처리)
export async function advanceActivity(
  projectId: string,
  allActivities: ActivityCode[],
  fromActivity: ActivityCode,
  toActivity: ActivityCode,
  newStage?: import('@/types').StageCode
): Promise<void> {
  const fromIdx = allActivities.indexOf(fromActivity)
  const toIdx = allActivities.indexOf(toActivity)
  const updates: Record<string, unknown> = {
    currentActivity: toActivity,
    [`activityStatuses.${fromActivity}`]: 'completed',
    updatedAt: serverTimestamp(),
  }
  if (newStage) updates.currentStage = newStage
  // 사이에 건너뛴 활동들은 warning 상태로 표시
  for (let i = fromIdx + 1; i < toIdx; i++) {
    updates[`activityStatuses.${allActivities[i]}`] = 'warning'
  }
  await updateDoc(doc(db, 'projects', projectId), updates)
}

// 이전 활동으로 되돌아가기 (해당 활동을 active_return 으로 표시)
export async function returnToActivity(
  projectId: string,
  toActivity: ActivityCode
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    currentActivity: toActivity,
    [`activityStatuses.${toActivity}`]: 'active_return',
    updatedAt: serverTimestamp(),
  })
}

// ─── 활동 산출물 확정 저장 ────────────────────────────

export async function setProjectArtifact(
  projectId: string,
  activityCode: ActivityCode,
  data: {
    status: 'confirmed' | 'in_review' | 'ai_draft'
    title: string
    content: Record<string, unknown>
    version: number
    confirmedBy?: string
    confirmedAt?: number
    revisionNote?: string
    revisionRequestedBy?: string
    revisionRequestedAt?: number
  }
): Promise<void> {
  // Firestore는 undefined 값을 허용하지 않으므로 제거
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  )
  await updateDoc(doc(db, 'projects', projectId), {
    [`artifacts.${activityCode}`]: clean,
    updatedAt: serverTimestamp(),
  })
}

// ─── 안(案) 선택지 투표 ──────────────────────────────

export async function setOptionVote(
  projectId: string,
  messageId: string,
  uid: string,
  label: string | null  // null이면 투표 취소
): Promise<void> {
  const field = `optionVotes.${messageId}.${uid}`
  await updateDoc(doc(db, 'projects', projectId), {
    [field]: label === null ? deleteField() : label,
    updatedAt: serverTimestamp(),
  })
}

export async function transferHost(projectId: string, newHostUid: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    hostUid: newHostUid,
    updatedAt: serverTimestamp(),
  })
}

export async function startProject(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    started: true,
    updatedAt: serverTimestamp(),
  })
}

export async function updateProjectStage(projectId: string, stage: StageCode): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    currentStage: stage,
    updatedAt: serverTimestamp(),
  })
}

export async function markA23Completed(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    isA23Completed: true,
    updatedAt: serverTimestamp(),
  })
}

export async function markECompleted(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    isECompleted: true,
    updatedAt: serverTimestamp(),
  })
}

// ─── 실시간 구독 ─────────────────────────────────────

export function watchProject(projectId: string, callback: (project: Project) => void): Unsubscribe {
  return onSnapshot(doc(db, 'projects', projectId), (snap) => {
    if (snap.exists()) {
      callback({ id: snap.id, ...snap.data() } as Project)
    }
  })
}

// ─── 산출물 ──────────────────────────────────────────

function artifactPath(projectId: string, stageCode: StageCode, activityCode: ActivityCode) {
  return `projects/${projectId}/stages/${stageCode}/activities/${activityCode}/artifacts`
}

export async function saveArtifact(
  projectId: string,
  stageCode: StageCode,
  activityCode: ActivityCode,
  data: Omit<Artifact, 'id'>
): Promise<string> {
  const ref = await addDoc(collection(db, artifactPath(projectId, stageCode, activityCode)), {
    ...data,
    'meta.updatedAt': serverTimestamp(),
  })
  // A-2-3 완료 시 프로젝트 플래그 업데이트
  if (activityCode === 'A-2-3' && data.status === 'confirmed') {
    await markA23Completed(projectId)
  }
  return ref.id
}

export async function getArtifact(
  projectId: string,
  stageCode: StageCode,
  activityCode: ActivityCode,
  artifactId: string
): Promise<Artifact | null> {
  const snap = await getDoc(
    doc(db, artifactPath(projectId, stageCode, activityCode), artifactId)
  )
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Artifact
}

export function watchArtifact(
  projectId: string,
  stageCode: StageCode,
  activityCode: ActivityCode,
  artifactId: string,
  callback: (artifact: Artifact) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, artifactPath(projectId, stageCode, activityCode), artifactId),
    (snap) => {
      if (snap.exists()) callback({ id: snap.id, ...snap.data() } as Artifact)
    }
  )
}

// ─── 대화 메시지 ─────────────────────────────────────

export async function saveMessage(
  projectId: string,
  activityCode: ActivityCode,
  data: Omit<Message, 'id' | 'createdAt'>
): Promise<string> {
  // Firestore는 undefined 값을 허용하지 않으므로 제거
  const clean = Object.fromEntries(
    Object.entries({ ...data, createdAt: serverTimestamp() })
      .filter(([, v]) => v !== undefined)
  )
  const ref = await addDoc(
    collection(db, `projects/${projectId}/conversations/${activityCode}/messages`),
    clean
  )
  return ref.id
}

export function watchMessages(
  projectId: string,
  activityCode: ActivityCode,
  callback: (messages: Message[]) => void
): Unsubscribe {
  // 신규 경로: 활동별 저장
  const newQ = query(
    collection(db, `projects/${projectId}/conversations/${activityCode}/messages`),
    orderBy('createdAt', 'asc')
  )
  // 구버전 경로: 단계별 저장 (레거시 데이터 복구용)
  const stageCode = ACTIVITY_META[activityCode]?.stage
  // where + orderBy 조합은 복합 인덱스 필요 → orderBy만 쓰고 클라이언트에서 필터
  const legacyQ = stageCode ? query(
    collection(db, `projects/${projectId}/conversations/${stageCode}/messages`),
    orderBy('createdAt', 'asc')
  ) : null

  let newMessages: Message[] = []
  let legacyMessages: Message[] = []
  let legacyLoaded = !legacyQ  // 레거시 없으면 즉시 완료

  function merge() {
    const seen = new Set<string>()
    const all: Message[] = []
    for (const m of [...legacyMessages, ...newMessages]) {
      if (!seen.has(m.id)) { seen.add(m.id); all.push(m) }
    }
    all.sort((a, b) => {
      const at = a.createdAt?.toDate?.()?.getTime?.() ?? 0
      const bt = b.createdAt?.toDate?.()?.getTime?.() ?? 0
      return at - bt
    })
    callback(all)
  }

  const unsubNew = onSnapshot(newQ, (snap) => {
    newMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Message)
    if (legacyLoaded) merge()
  })

  let unsubLegacy: Unsubscribe | null = null
  if (legacyQ) {
    unsubLegacy = onSnapshot(legacyQ, (snap) => {
      // 클라이언트에서 activityCode 필터 (인덱스 불필요)
      legacyMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Message)
        .filter(m => m.activityCode === activityCode)
      legacyLoaded = true
      merge()
    })
  }

  return () => {
    unsubNew()
    unsubLegacy?.()
  }
}

// ─── 단계 전환 이력 ──────────────────────────────────

export async function logStageTransition(
  projectId: string,
  data: Omit<StageTransition, 'id' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(db, `projects/${projectId}/stage_transitions`), {
    ...data,
    createdAt: serverTimestamp(),
  })
  // E→T 순환이면 isECompleted 플래그도 설정
  if (data.direction === 'cycle') {
    await markECompleted(projectId)
  }
}

// ─── AI 스트리밍 상태 공유 ────────────────────────────
// 다른 팀원도 AI 타이핑을 실시간으로 볼 수 있도록 Firestore에 동기화

export interface StreamingState {
  text: string
  senderUid: string
  isStreaming: boolean
}

export async function setStreamingState(
  projectId: string,
  activityCode: ActivityCode,
  text: string,
  senderUid: string
): Promise<void> {
  await setDoc(
    doc(db, `projects/${projectId}/streamingState/${activityCode}`),
    { text, senderUid, isStreaming: true }
  )
}

export async function clearStreamingState(
  projectId: string,
  activityCode: ActivityCode
): Promise<void> {
  await deleteDoc(doc(db, `projects/${projectId}/streamingState/${activityCode}`))
}

export function watchStreamingState(
  projectId: string,
  activityCode: ActivityCode,
  callback: (state: StreamingState | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, `projects/${projectId}/streamingState/${activityCode}`),
    (snap) => {
      if (snap.exists() && snap.data().isStreaming) {
        callback(snap.data() as StreamingState)
      } else {
        callback(null)
      }
    }
  )
}

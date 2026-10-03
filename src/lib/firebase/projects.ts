import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc, deleteDoc, query,
  where, orderBy, limit, serverTimestamp, onSnapshot, type Unsubscribe, arrayUnion, deleteField,
  runTransaction, type QueryDocumentSnapshot, type DocumentData, Timestamp
} from 'firebase/firestore'
import { auth, db } from './config'
import type { ArtifactConfirmationEntry, Project, StageCode, ActivityCode, Artifact, Message, StageTransition, SkippedActionCard, KeyNote, CurriculumSheetRow, TeamVisionWorkspace, TeamVisionWorkspaceBlock, TeamVisionWorkspaceColumn, TeamVisionWorkspaceRow, IntegratedGoalWorkspace, IntegratedGoalWorkspaceBlock, IntegratedGoalWorkspaceColumn, IntegratedGoalWorkspaceRow, IntegratedGoalMethod } from '@/types'
import { ACTIVITY_META } from '@/types'
import { computePendingConfirmations, rediscussMessage, staleRediscussUids } from '@/lib/collab/artifactConfirmations'
import type { GraphSavedData, GraphSelectionState } from '@/lib/knowledge-graph/domain'
import { normalizeGraphSavedData, normalizeGraphSelectionState } from '@/lib/knowledge-graph/domain'
import { addJoinedProjectId, generateInviteCode } from '@/lib/inviteCode'
import { extractImprovementText, parseNextCycleChoice } from '@/lib/activity/completion'
import { resolveNextCycleChoice, type NextCycleChoice } from '@/lib/activity/cycle'
import { sanitizeArtifactSections } from '@/lib/artifacts/schemas'
import { mergeMessagesForCycle } from '@/lib/chat/messageCycles'
import { normalizeTeamGradeBands } from '@/lib/curriculum/teamGradeBands'
import { defaultGradeMode, planMapPickApplication, resolveSheetGradeBand } from '@/lib/curriculum/sheetGradeBands'
import type { MapPickLike } from '@/lib/curriculum/sheetGradeBands'
import { mergeAutofillRows, setCenterInGradeBand } from '@/lib/curriculum/collaborativeBands'
import { buildTeamGradeBandUpdate } from '@/lib/curriculum/teamGradeBandState'
import { canFillRowDescription, type RowDescriptionUpdate } from '@/lib/curriculum/rowDescriptions'

// ─── Firestore nested undefined 청소 ─────────────────
// Firestore는 nested undefined를 거부 — `updateDoc` 직전에 객체·배열 트리 전체를 순회해 undefined 값 키를 제거한다.
// 기존 cleanXxxRow/cleanXxxBlock 같은 1-level cleanup은 row.cells / block.table 같은 nested 객체 안의
// undefined를 잡지 못해 워크스페이스 저장 실패가 발생. 모든 patch 함수의 최종 송신 직전에 적용.
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[k] = stripUndefinedDeep(v)
    }
    return out as T
  }
  return value
}

// ─── 대시보드 폴더 ──────────────────────────────────

export interface DashboardFolder {
  id: string
  name: string
  color: string
  projectIds: string[]
}

export async function getUserFolders(uid: string): Promise<DashboardFolder[]> {
  const ref = doc(db, 'user_settings', uid)
  const snap = await getDoc(ref)
  return (snap.data()?.folders as DashboardFolder[] | undefined) ?? []
}

export async function saveUserFolders(uid: string, folders: DashboardFolder[]): Promise<void> {
  const ref = doc(db, 'user_settings', uid)
  await setDoc(ref, { folders }, { merge: true })
}

// 비호스트가 대시보드에서 안 보이게 숨긴 프로젝트 ID 목록
export async function getUserHiddenProjects(uid: string): Promise<string[]> {
  const ref = doc(db, 'user_settings', uid)
  const snap = await getDoc(ref)
  return (snap.data()?.hiddenProjectIds as string[] | undefined) ?? []
}

export async function hideProjectFromDashboard(uid: string, projectId: string): Promise<void> {
  const ref = doc(db, 'user_settings', uid)
  await setDoc(ref, { hiddenProjectIds: arrayUnion(projectId) }, { merge: true })
}

export async function unhideProjectFromDashboard(uid: string, projectId: string): Promise<void> {
  const ref = doc(db, 'user_settings', uid)
  const snap = await getDoc(ref)
  const current = (snap.data()?.hiddenProjectIds as string[] | undefined) ?? []
  await setDoc(ref, { hiddenProjectIds: current.filter(id => id !== projectId) }, { merge: true })
}

// ─── 프로젝트 CRUD ───────────────────────────────────

export async function deleteProject(projectId: string): Promise<void> {
  await deleteDoc(doc(db, 'projects', projectId))
}

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ id: string; inviteCode: string }> {
  const ref = doc(collection(db, 'projects'))
  const baseInviteCode = (data.inviteCode?.trim() || generateInviteCode()).replace(/\s+/g, '')
  const uniqueInviteCode = `${baseInviteCode}${ref.id.slice(0, 4).toUpperCase()}`
  await setDoc(ref, {
    ...data,
    inviteCode: uniqueInviteCode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: ref.id, inviteCode: uniqueInviteCode }
}

export async function getProject(projectId: string): Promise<Project | null> {
  const snap = await getDoc(doc(db, 'projects', projectId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Project
}

export async function getUserProjects(userId: string): Promise<Project[]> {
  const seen = new Set<string>()
  const projects: Project[] = []

  const merge = (docs: QueryDocumentSnapshot<DocumentData>[]) => {
    for (const d of docs) {
      if (!seen.has(d.id)) {
        seen.add(d.id)
        projects.push({ id: d.id, ...d.data() } as Project)
      }
    }
  }

  // 1) memberUids에 포함된 프로젝트
  // 2) createdBy == userId (레거시 호환)
  // 3) localStorage에 저장된 프로젝트 ID 직접 조회
  // rules의 `request.query.limit <= 50` 조건 충족을 위해 limit(50) 명시
  const queries = [
    getDocs(query(collection(db, 'projects'), where('memberUids', 'array-contains', userId), limit(50))),
    getDocs(query(collection(db, 'projects'), where('createdBy', '==', userId), limit(50))),
  ]

  const results = await Promise.allSettled(queries)
  for (const r of results) {
    if (r.status === 'fulfilled') merge(r.value.docs)
    else console.error('[getUserProjects] query 실패:', r.reason)
  }

  // localStorage 멤버십 (초대받은 방)
  // rules.list가 정상 동작하면 위 두 query 로 충분하지만, 회귀/오프라인 대비 보조 fetch.
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
  const q = query(collection(db, 'projects'), where('inviteCode', '==', code), limit(2))
  const snap = await getDocs(q)
  if (snap.empty) return null
  if (snap.size > 1) {
    throw new Error('duplicate-invite-code')
  }
  const d = snap.docs[0]
  return { id: d.id, ...d.data() } as Project
}

/**
 * 프로젝트에 참여한다.
 *
 * 보안 메모 (P0-4): 이전 버전은 inviteCode 인자 없이 누구든 projectId만 알면
 * 본인을 memberUids에 추가할 수 있었다. firestore.rules의 isSelfJoinUpdate()는
 * inviteCode 일치 검증이 불가하므로, 앱 레벨에서 이중 방어한다.
 *
 * 단, 이미 멤버인 사용자가 프로필(displayName/color/emoji)을 갱신하기 위해
 * 이 함수를 다시 호출하는 경로(projects/[id]/page.tsx)에서는 inviteCode 검증을
 * 스킵한다 — 멤버가 아니라면 애초에 프로젝트 문서를 read 할 수 없기 때문.
 *
 * 완전 차단(예: 클라이언트가 SDK를 직접 호출하여 검증 우회)은 Cloud Function
 * 위임이 필요하다. 이번 변경은 1차 방어선이다.
 */
export async function joinProject(
  projectId: string,
  uid: string,
  inviteCode: string,
  memberInfo?: { displayName: string; color: string; emoji: string }
): Promise<void> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error('project-not-found')
  }
  const data = snap.data() as Project
  const isAlreadyMember = (data.memberUids ?? []).includes(uid)
  // 신규 가입자인 경우에만 inviteCode 일치를 강제한다.
  if (!isAlreadyMember) {
    // 개인 설계 프로젝트는 초대 참여를 받지 않는다 (2원화 — 협력 프로젝트만 팀 참여 가능).
    if (data.mode === 'solo') {
      throw new Error('solo-project')
    }
    if (!inviteCode || data.inviteCode !== inviteCode) {
      throw new Error('invalid-invite-code')
    }
  }

  const updates: Record<string, unknown> = {
    memberUids: arrayUnion(uid),
    updatedAt: serverTimestamp(),
  }
  if (memberInfo) {
    updates[`memberInfo.${uid}`] = { ...memberInfo, uid, joinedAt: Date.now() }
  }
  await updateDoc(ref, updates)
  addJoinedProjectId(projectId)
}

export async function ensureProjectMemberUid(
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
  createdAt: Timestamp
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
  activityCode: string,
  active: boolean,
  topic?: string
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`teamDiscussions.${activityCode}`]: active
      ? { active: true, topic: topic ?? '', startedAt: Date.now() }
      : { active: false },
    updatedAt: serverTimestamp(),
  })
}

export async function requestTeamDiscussion(
  projectId: string,
  activityCode: string,
  requestedBy: string,
  displayName: string
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`teamDiscussionRequests.${activityCode}`]: { pending: true, requestedBy, displayName, requestedAt: Date.now() },
    updatedAt: serverTimestamp(),
  })
}

export async function clearTeamDiscussionRequest(projectId: string, activityCode: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`teamDiscussionRequests.${activityCode}`]: { pending: false },
    updatedAt: serverTimestamp(),
  })
}

// ─── Phase 1-b: ACTION_CARD skip 로깅 ──────────────────
// Project 문서의 skippedActionCards 배열에 dismiss 이벤트 추가.
// cardId는 ACTION_CARD가 첨부된 메시지 id. 재오픈 방지를 위해 렌더 시 렌더러가 이 배열을 조회.

export async function recordActionCardSkip(
  projectId: string,
  entry: SkippedActionCard
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    skippedActionCards: arrayUnion(entry),
    updatedAt: serverTimestamp(),
  })
}

// 메시지에 첨부된 ACTION_CARD 선택 결과를 Firestore 메시지 문서에 저장.
// 렌더 시 isSelected 판정 근거 — 방장이 primary/secondary를 고르면 팀원에게도 동기화.
export async function updateMessageActionCardState(
  projectId: string,
  activityCode: ActivityCode,
  messageId: string,
  state: 'selected' | 'skipped',
  selection: 'primary' | 'secondary' | 'skip'
): Promise<void> {
  await updateDoc(
    doc(db, `projects/${projectId}/conversations/${activityCode}/messages`, messageId),
    {
      actionCardState: state,
      actionCardSelection: selection,
    }
  )
}

// ─── 지식 그래프 공유 (방장 → 팀원) ─────────────────────────────────────────

export async function setGraphOpen(
  projectId: string,
  open: boolean,
  keyword?: string,
  view: 'sheet' | 'graph' = 'graph',
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    graphOpen: open,
    graphView: open ? view : 'sheet',
    ...(keyword !== undefined ? { graphKeyword: keyword } : {}),
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

// 이전 활동으로 되돌아가기 — 활동 상태는 그대로 유지하고 현재 위치만 변경
export async function returnToActivity(
  projectId: string,
  toActivity: ActivityCode,
  newStage?: import('@/types').StageCode
): Promise<void> {
  const updates: Record<string, unknown> = {
    currentActivity: toActivity,
    updatedAt: serverTimestamp(),
  }
  if (newStage) updates.currentStage = newStage
  await updateDoc(doc(db, 'projects', projectId), updates)
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
    _schemaVersion?: string
  }
): Promise<void> {
  // P1-I: requiredSections 정의가 있는 활동(E-1-1/E-2-1)은 v2-sections 스키마로 자동 마킹.
  // - 중앙 부착으로 호출처(applyArtifactUpdate/applyArtifactConfirm/handleAcceptArtifactSave 등)
  //   누락 방지 — Lead 지시 "절대 누락 금지".
  // - 호출부에서 명시적으로 _schemaVersion을 넘긴 경우에는 그 값을 우선.
  // - non-E 활동은 부착하지 않음 (회귀 방지: 기존 산출물 grandfather 유지).
  const shouldAttachSchema =
    data._schemaVersion === undefined &&
    (ACTIVITY_META[activityCode]?.requiredSections?.length ?? 0) > 0
  // 심층 방어 — 어떤 호출부가 정화를 누락해도 A안/B안 선택지·절차 문구가 저장되지 않도록
  // 쓰기 직전 top-level string 값만 정화한다 (구조화 산출물의 배열·객체 필드는 통과).
  // 정화 결과가 빈 값이어도 키는 유지해 구조화 스키마의 필드 형태를 보존한다.
  const cleanedContent = sanitizeArtifactSections(data.content, { dropEmptied: false })
  const normalized = shouldAttachSchema
    ? { ...data, content: cleanedContent, _schemaVersion: 'v2-sections' as const }
    : { ...data, content: cleanedContent }

  // 이력 적재 — 새 content 덮어쓰기 전 현재 스냅샷을 versions에 push (최대 20개 유지).
  // race-safety는 lag fix 라운드에서 trade-off 수용. 트랜잭션 없이 read-then-write.
  const projectRef = doc(db, 'projects', projectId)
  const snap = await getDoc(projectRef)
  const projectData = snap.exists() ? (snap.data() as Project) : undefined
  const current = projectData?.artifacts?.[activityCode]
  const priorVersions = current?.versions ?? []
  const nextVersions = [...priorVersions]
  if (current?.content && Object.keys(current.content).length > 0 && typeof current.version === 'number') {
    nextVersions.push({
      version: current.version,
      content: current.content as Record<string, unknown>,
      savedAt: current.confirmedAt ?? Date.now(),
      savedBy: current.confirmedBy,
    })
  }
  const trimmedVersions = nextVersions.slice(-20)

  // Firestore는 nested undefined까지 거부 — top-level의 confirmedBy/revisionNote 같은 optional 필드뿐 아니라
  // content.manualWorkspace.blocks[].table, versions[].savedBy 등 깊은 곳까지 모두 청소해야 한다.
  // versions 합친 결과 전체를 한 번에 deep clean (versions[].savedBy === undefined 같은 케이스가 reject 원인).
  const baseMerged: Record<string, unknown> = trimmedVersions.length > 0
    ? { ...normalized, versions: trimmedVersions }
    : { ...normalized }
  const mergedArtifact = stripUndefinedDeep(baseMerged) as Record<string, unknown>
  const updates: Record<string, unknown> = {
    [`artifacts.${activityCode}`]: mergedArtifact,
    updatedAt: serverTimestamp(),
  }

  // A-2-3는 "확정 완료" 이전이라도 저장된 프로필이 있으면 Ds 단계 가드레일로 활용한다.
  if (activityCode === 'A-2-3') {
    const hasContent = Object.keys((data.content ?? {}) as Record<string, unknown>).length > 0
    updates.isA23Completed = hasContent && data.status !== 'ai_draft'
  }

  await updateDoc(projectRef, updates)
  // 팀장 종합으로 저장된 산출물은 이 활동에서 말하지 않은 팀원에게 확인을 요청한다(#28). 저장을 늦추지 않도록 기다리지 않는다.
  if (projectData) {
    void recordArtifactConfirmations(projectId, activityCode, data.version, projectData)
      .catch(error => console.error('[artifactConfirmations] record failed:', error))
  }
}

/** 이 활동 대화(현재 주기)에서 말하지 않은 팀원을 '확인 대기'로 기록한다. 방장 저장 직후 호출. */
export async function recordArtifactConfirmations(
  projectId: string,
  activityCode: ActivityCode,
  version: number,
  project: Project,
): Promise<void> {
  if (project.mode === 'solo' || project.demoRun) return
  const cycle = project.currentCycle ?? 1
  const messagesSnap = await getDocs(collection(db, `projects/${projectId}/conversations/${activityCode}/messages`))
  const speakerUids = messagesSnap.docs
    .map(item => item.data() as Partial<Message>)
    .filter(message => message.role === 'user' && message.userId && (message.cycleNumber ?? 1) === cycle)
    .map(message => message.userId as string)
  const pending = computePendingConfirmations({
    mode: project.mode,
    demoRun: !!project.demoRun,
    hostUid: project.hostUid,
    createdBy: project.createdBy,
    memberUids: project.memberUids,
    memberInfo: project.memberInfo,
    speakerUids,
    activityCode,
    version,
    now: Date.now(),
    existing: project.artifactConfirmations,
  })
  const updates: Record<string, unknown> = Object.fromEntries(
    Object.entries(pending).map(([uid, entry]) => [`artifactConfirmations.${uid}.${activityCode}`, entry]),
  )
  for (const uid of staleRediscussUids(project.artifactConfirmations, activityCode, version)) {
    if (!(uid in pending)) updates[`artifactConfirmations.${uid}.${activityCode}`] = deleteField()
  }
  if (Object.keys(updates).length === 0) return
  await updateDoc(doc(db, 'projects', projectId), updates)
}

/**
 * 팀원 본인의 확인 응답. 확인했어요 → confirmed, 다시 논의 요청 → 그 활동 대화에 사유 메시지를 남기고 rediscuss.
 * 규칙상 팀원은 artifactConfirmations 의 자기 uid 항목만 바꿀 수 있다.
 */
export async function respondArtifactConfirmation(
  projectId: string,
  activityCode: ActivityCode,
  uid: string,
  entry: ArtifactConfirmationEntry,
  response: { type: 'confirmed' } | { type: 'rediscuss'; reason: string; cycleNumber?: number },
): Promise<void> {
  const respondedAt = Date.now()
  if (response.type === 'rediscuss') {
    await saveMessage(projectId, activityCode, {
      role: 'user',
      content: rediscussMessage(response.reason),
      activityCode,
      userId: uid,
      displayName: entry.displayName,
      cycleNumber: response.cycleNumber ?? 1,
    })
  }
  const next: ArtifactConfirmationEntry = response.type === 'rediscuss'
    ? { ...entry, status: 'rediscuss', reason: response.reason.trim(), respondedAt }
    : { ...entry, status: 'confirmed', respondedAt }
  await updateDoc(doc(db, 'projects', projectId), {
    [`artifactConfirmations.${uid}.${activityCode}`]: stripUndefinedDeep(next),
  })
}

// 산출물 삭제 — 호스트 전용. artifacts.{activityCode}를 통째로 제거하고
// 의존 상태(activityStatuses, isA23Completed)도 함께 reset해 다른 화면 정합성 보존.
// Why: 잘못 보낸 산출물을 호스트가 되돌릴 수 있어야 한다는 사용자 요청.
export async function deleteProjectArtifact(
  projectId: string,
  activityCode: ActivityCode,
): Promise<void> {
  const updates: Record<string, unknown> = {
    [`artifacts.${activityCode}`]: deleteField(),
    [`activityStatuses.${activityCode}`]: deleteField(),
    updatedAt: serverTimestamp(),
  }
  if (activityCode === 'A-2-3') {
    updates.isA23Completed = false
  }
  await updateDoc(doc(db, 'projects', projectId), updates)
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

export async function closeOptionChoice(
  projectId: string,
  messageId: string,
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`closedOptionMessages.${messageId}`]: true,
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

export async function saveCumulativeReport(projectId: string, content: string, savedBy: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    cumulativeReport: { content, savedAt: Date.now(), savedBy },
    updatedAt: serverTimestamp(),
  })
  // 공개 중이면 자동으로 공개 스냅샷도 갱신 (호스트가 저장한 경우만 실제 동기화됨)
  const { autoSyncIfPublic } = await import('./publicReports')
  autoSyncIfPublic(projectId, savedBy).catch(() => {})
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

// P1-I 3-C: 새 주기의 T-1-1 첫 산출물 저장 감지 시 isECompleted 플래그를 내려
// StageBar의 E→T 순환 화살표 표시를 종료. page.tsx의 useEffect에서 idempotent하게 호출.
export async function clearECompleted(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    isECompleted: false,
    updatedAt: serverTimestamp(),
  })
}

export async function setAnalysisOpen(projectId: string, open: boolean): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    analysisOpen: open,
    updatedAt: serverTimestamp(),
  })
}

export async function setAnalysisReport(
  projectId: string,
  stage: string,
  content: string,
  generating: boolean
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    analysisReport: { stage, content, generating },
    updatedAt: serverTimestamp(),
  })
}

// ─── 중요 노트 (포스트잇) ──────────────────────────────
// projects/{pid}/keyNotes/{noteId} subcollection에 노트당 문서 1개로 저장.
// (이전: 프로젝트 문서의 keyNotes 배열 필드 — 문서 1MiB 한도로 길이/개수 제약)
// 노트당 문서 1개라 각 1MiB까지 → 긴 내용·다수 노트도 안전. 부모 문서 비대화도 해소.
// 기존 배열 노트는 migrateKeyNotesToSubcollection으로 1회 이전하며, 그 전까지는
// store에서 (배열 ∪ subcollection) union으로 합쳐 보여 데이터 손실이 없다.

function cleanKeyNote(note: KeyNote): KeyNote {
  // Firestore는 undefined 필드를 거부 — 전송 전 제거
  return Object.fromEntries(
    Object.entries(note).filter(([, v]) => v !== undefined),
  ) as KeyNote
}

export async function addKeyNote(projectId: string, note: KeyNote): Promise<void> {
  await setDoc(doc(db, 'projects', projectId, 'keyNotes', note.id), cleanKeyNote(note))
}

export async function removeKeyNote(projectId: string, noteId: string): Promise<void> {
  // subcollection 문서 삭제
  await deleteDoc(doc(db, 'projects', projectId, 'keyNotes', noteId))
  // 아직 마이그레이션 전이라 레거시 배열에 남아 있을 수 있으니 거기서도 제거
  try {
    const snap = await getDoc(doc(db, 'projects', projectId))
    if (!snap.exists()) return
    const data = snap.data() as Project
    const legacy = data.keyNotes ?? []
    if (legacy.some(n => n.id === noteId)) {
      await updateDoc(doc(db, 'projects', projectId), {
        keyNotes: legacy.filter(n => n.id !== noteId),
        updatedAt: serverTimestamp(),
      })
    }
  } catch (err) {
    console.warn('[removeKeyNote] legacy array cleanup skipped:', err)
  }
}

// subcollection 노트 실시간 구독 (savedAt ASC 정렬 — 번호 규약과 일치)
export function watchKeyNotes(
  projectId: string,
  onChange: (notes: KeyNote[]) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'keyNotes')
  return onSnapshot(ref, (snap) => {
    const notes = snap.docs.map(d => d.data() as KeyNote)
    notes.sort((a, b) => a.savedAt - b.savedAt)
    onChange(notes)
  })
}

// 레거시 배열 노트 → subcollection 1회 이전. 멱등(같은 id setDoc은 덮어쓰기) + 동시성 안전.
// 이전 후 부모 문서의 keyNotes 배열을 비워 단일 출처(subcollection)로 통일.
export async function migrateKeyNotesToSubcollection(projectId: string): Promise<void> {
  const snap = await getDoc(doc(db, 'projects', projectId))
  if (!snap.exists()) return
  const legacy = ((snap.data() as Project).keyNotes ?? [])
  if (legacy.length === 0) return
  await Promise.all(
    legacy.map(n => setDoc(doc(db, 'projects', projectId, 'keyNotes', n.id), cleanKeyNote(n))),
  )
  await updateDoc(doc(db, 'projects', projectId), {
    keyNotes: deleteField(),
    updatedAt: serverTimestamp(),
  })
}

// 완료된 보고서를 stageReports에 영구 저장
// uid를 넘기면 공개 중 프로젝트의 공개 스냅샷도 자동 동기화 (호스트일 때만 실제 실행).
export async function saveStageReport(
  projectId: string,
  stage: string,
  content: string,
  uid?: string,
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`stageReports.${stage}`]: { content, savedAt: Date.now() },
    updatedAt: serverTimestamp(),
  })
  if (uid) {
    const { autoSyncIfPublic } = await import('./publicReports')
    autoSyncIfPublic(projectId, uid).catch(() => {})
  }
}

// ─── 그래프 중심 성취기준 추천 (팀원 동기화) ─────────────────────────────────

export async function setGraphCenter(projectId: string, nodeId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    graphCenterNodeId: nodeId,
    updatedAt: serverTimestamp(),
  })
}

export async function recommendGraphCenter(
  projectId: string,
  nodeId: string,
  recommenderName: string,
  recommenderUid?: string,
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    [`graphCenterRecommendations.${nodeId}`]: { recommenderName, recommenderUid: recommenderUid ?? null, nodeId },
    updatedAt: serverTimestamp(),
  })
}

export async function setGraphSelectionState(
  projectId: string,
  data: Omit<GraphSelectionState, 'updatedAt'>
): Promise<void> {
  const normalized = normalizeGraphSelectionState({
    ...data,
    updatedAt: Date.now(),
  })

  await updateDoc(doc(db, 'projects', projectId), {
    graphSelectionState: normalized,
    updatedAt: serverTimestamp(),
  })
}

// 지식 그래프 저장 (중심 노드 + 선택 성취기준 + Agent 분석)
export async function saveGraphData(
  projectId: string,
  data: Omit<GraphSavedData, 'savedAt'>
): Promise<void> {
  const normalized = normalizeGraphSavedData({
    ...data,
    savedAt: Date.now(),
  })

  await updateDoc(doc(db, 'projects', projectId), {
    'graphSavedData': normalized,
    ...(normalized.centerNode ? { graphCenterNodeId: normalized.centerNode.id } : {}),
    updatedAt: serverTimestamp(),
  })
}

// ─── 교육과정 분석 시트 공동 편집 ──────────────────────────────

export type CurriculumSheetEditableField =
  | 'session'
  | 'subject'
  | 'gradeBand'
  | 'linkedCoreIdea'
  | 'isCenter'
  | 'coreIdea'
  | 'standard'
  | 'knowledge'
  | 'processFunction'
  | 'valueAttitude'
  | 'agentLessonExample'
  | 'description'

export type CurriculumSheetPatch =
  | {
      type: 'update-cell'
      rowId: string
      field: CurriculumSheetEditableField
      value: CurriculumSheetRow[CurriculumSheetEditableField]
      updatedBy?: string
    }
  | {
      type: 'update-cells'
      updates: Array<{
        rowId: string
        field: CurriculumSheetEditableField
        value: CurriculumSheetRow[CurriculumSheetEditableField]
      }>
      updatedBy?: string
    }
  | { type: 'upsert-row'; row: CurriculumSheetRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'reorder'; rowIds: string[] }
  | { type: 'set-center'; rowId: string | null; gradeBand?: string; updatedBy?: string }
  | { type: 'merge-autofill'; rows: CurriculumSheetRow[]; defaultBand?: string; updatedBy?: string }
  | { type: 'fill-descriptions'; rows: RowDescriptionUpdate[]; updatedBy?: string }
  | { type: 'replace-all'; rows: CurriculumSheetRow[]; updatedBy?: string }

function cleanCurriculumSheetRow(row: CurriculumSheetRow): CurriculumSheetRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as CurriculumSheetRow
}

function applyCurriculumSheetPatch(
  currentRows: CurriculumSheetRow[],
  patch: CurriculumSheetPatch,
): CurriculumSheetRow[] {
  const now = Date.now()
  const stampRow = (row: CurriculumSheetRow, updatedBy?: string): CurriculumSheetRow => cleanCurriculumSheetRow({
    ...row,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })

  if (patch.type === 'replace-all') {
    return patch.rows.map(row => stampRow(row, patch.updatedBy))
  }

  if (patch.type === 'merge-autofill') {
    return mergeAutofillRows(currentRows, patch.rows, patch.defaultBand).map(cleanCurriculumSheetRow)
  }
  if (patch.type === 'fill-descriptions') {
    return currentRows.map(row => {
      const incoming = patch.rows.find(item => item.id === row.id)
      if (!incoming?.description?.trim() || !canFillRowDescription(row, incoming)) return row
      return stampRow({ ...row, description: incoming.description }, patch.updatedBy)
    })
  }

  if (patch.type === 'upsert-row') {
    const next = [...currentRows]
    const index = next.findIndex(row => row.id === patch.row.id)
    const nextRow = stampRow(patch.row, patch.updatedBy)
    if (index >= 0) next[index] = { ...next[index], ...nextRow }
    else next.push(nextRow)
    return next.map(cleanCurriculumSheetRow)
  }

  if (patch.type === 'delete-row') {
    return currentRows.filter(row => row.id !== patch.rowId).map(cleanCurriculumSheetRow)
  }

  if (patch.type === 'reorder') {
    const byId = new Map(currentRows.map(row => [row.id, row]))
    const ordered = patch.rowIds.map(id => byId.get(id)).filter(Boolean) as CurriculumSheetRow[]
    const orderedIds = new Set(ordered.map(row => row.id))
    const missing = currentRows.filter(row => !orderedIds.has(row.id))
    return [...ordered, ...missing].map(cleanCurriculumSheetRow)
  }

  if (patch.type === 'set-center') {
    return setCenterInGradeBand(currentRows, patch.rowId, patch.gradeBand)
      .map(row => stampRow(row, patch.updatedBy))
  }

  const updates = patch.type === 'update-cell'
    ? [{ rowId: patch.rowId, field: patch.field, value: patch.value }]
    : patch.updates
  const updatedBy = patch.updatedBy
  const updateMap = new Map<string, Partial<CurriculumSheetRow>>()
  for (const update of updates) {
    const key = update.rowId
    updateMap.set(key, {
      ...(updateMap.get(key) ?? {}),
      [update.field]: update.value,
    })
  }

  return currentRows.map(row => {
    const update = updateMap.get(row.id)
    if (!update) return cleanCurriculumSheetRow(row)
    return stampRow({ ...row, ...update }, updatedBy)
  })
}

export async function patchCurriculumSheet(
  projectId: string,
  patch: CurriculumSheetPatch,
): Promise<CurriculumSheetRow[]> {
  const ref = doc(db, 'projects', projectId)
  let nextRows: CurriculumSheetRow[] = []

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('project-not-found')
    const data = snap.data() as Project
    const currentRows = (data.curriculumSheet ?? []) as CurriculumSheetRow[]
    nextRows = applyCurriculumSheetPatch(currentRows, patch)
    transaction.update(ref, {
      curriculumSheet: nextRows,
      updatedAt: serverTimestamp(),
    })
  })

  return nextRows
}

/**
 * 분석맵(독립 페이지)에서 고른 성취기준을 시트에 새 줄로 추가한다.
 * 시트 모달과 같은 계획 함수(planMapPickApplication)를 대상 줄 없이 돌려
 * 교과·핵심아이디어·학년군별로 한 줄씩 upsert-row로 저장한다(동시 편집 안전).
 * 반환값은 추가된 줄 수. undefined 필드는 cleanCurriculumSheetRow가 제거한다.
 */
export async function appendMapPicksToSheet(
  projectId: string,
  picks: MapPickLike[],
  updatedBy?: string,
): Promise<number> {
  const snap = await getDoc(doc(db, 'projects', projectId))
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const currentRows = (data.curriculumSheet ?? []) as CurriculumSheetRow[]
  const mode = data.curriculumSheetGradeMode ?? defaultGradeMode(currentRows)
  const sheetBand = resolveSheetGradeBand(data.curriculumSheetGradeBand, data.targetGradeGroup)
  const plan = planMapPickApplication(currentRows, picks, undefined, mode, sheetBand)

  let added = 0
  for (const newRow of plan.newRows) {
    const row: CurriculumSheetRow = {
      id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      session: '',
      subject: newRow.subject,
      ...(newRow.gradeBand ? { gradeBand: newRow.gradeBand } : {}),
      coreIdea: newRow.coreIdea,
      standard: newRow.standard,
      knowledge: '',
      processFunction: '',
      valueAttitude: '',
      agentLessonExample: '',
      description: '',
    }
    await patchCurriculumSheet(projectId, { type: 'upsert-row', row, ...(updatedBy ? { updatedBy } : {}) })
    added += 1
  }
  return added
}

/**
 * 시트 학년군 설정(모드·기준 학년군) 저장. 시트는 공동 편집이라 팀원 누구나 바꿀 수 있고,
 * 프로젝트 문서에 저장되므로 onSnapshot으로 전원 화면에 동시 반영된다.
 * undefined 필드는 제거한다(Firestore는 undefined를 거부한다 — CLAUDE.md).
 */
export async function updateCurriculumSheetSettings(
  projectId: string,
  settings: { gradeMode?: 'single' | 'multi'; gradeBand?: string },
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (settings.gradeMode !== undefined) payload.curriculumSheetGradeMode = settings.gradeMode
  if (settings.gradeBand !== undefined) payload.curriculumSheetGradeBand = settings.gradeBand
  if (Object.keys(payload).length === 0) return

  await updateDoc(doc(db, 'projects', projectId), {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

/** Only the host can commit team composition; mode and legacy row labels change atomically. */
function requireGradeBandHost(project: Project) {
  const uid = auth.currentUser?.uid
  if (!uid || (project.hostUid !== uid && project.createdBy !== uid)) {
    throw new Error('팀 학년군은 방장만 확정할 수 있습니다.')
  }
}

export async function updateTeamGradeBands(
  projectId: string,
  bands: readonly (string | null | undefined)[],
  options: { repairModeOnly?: boolean } = {},
): Promise<string[]> {
  const normalized = normalizeTeamGradeBands(bands)
  if (!normalized.length) return []
  const ref = doc(db, 'projects', projectId)
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('project-not-found')
    const data = snap.data() as Project
    requireGradeBandHost(data)
    const next = options.repairModeOnly ? normalizeTeamGradeBands(data.teamGradeBands) : normalized
    if (options.repairModeOnly && (next.length < 2 || data.curriculumSheetGradeMode === 'multi')) return next
    transaction.update(ref, {
      ...stripUndefinedDeep(buildTeamGradeBandUpdate(data, next)),
      updatedAt: serverTimestamp(),
    })
    return next
  })
}

/** Members leave a durable proposal; they cannot change the confirmed team or sheet mode. */
export async function proposeTeamGradeBands(projectId: string, bands: string[], displayName: string): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('로그인이 필요합니다.')
  const normalized = normalizeTeamGradeBands(bands)
  if (!normalized.length) return
  await updateDoc(doc(db, 'projects', projectId), {
    [`teamGradeBandProposals.${uid}`]: {
      id: crypto.randomUUID(), bands: normalized, proposedByName: displayName, proposedAt: Date.now(),
    },
    updatedAt: serverTimestamp(),
  })
}

/** Proposal ID prevents an older approval/rejection from deleting a newer member proposal. */
export async function resolveTeamGradeBandProposal(
  projectId: string, proposerUid: string, proposalId: string, accept: boolean,
): Promise<string[] | null> {
  const ref = doc(db, 'projects', projectId)
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('project-not-found')
    const data = snap.data() as Project
    requireGradeBandHost(data)
    const proposal = data.teamGradeBandProposals?.[proposerUid]
    if (!proposal || proposal.id !== proposalId) throw new Error('학년군 제안이 변경되었습니다. 새 제안을 확인해주세요.')
    // A member's own grade adds to the team; it must not silently remove another teacher's band.
    const next = normalizeTeamGradeBands([...(data.teamGradeBands ?? [data.targetGradeGroup]), ...proposal.bands])
    transaction.update(ref, {
      ...(accept ? stripUndefinedDeep(buildTeamGradeBandUpdate(data, next)) : {}),
      [`teamGradeBandProposals.${proposerUid}`]: deleteField(),
      updatedAt: serverTimestamp(),
    })
    return accept ? next : null
  })
}

// ─── 팀 공통 비전 워크스페이스 공동 편집 ─────────────────────

const DEFAULT_TEAM_VISION_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'teacherName', label: '교사명', color: '#E8F0FE' },
  { id: 'keywords', label: '개인 비전 키워드', color: '#E8F0FE' },
  { id: 'refinedVision', label: '정교화 비전 문장', color: '#E8F0FE' },
  { id: 'agreementNote', label: '합의 근거', color: '#E8F0FE' },
]

function cleanTeamVisionRow(row: TeamVisionWorkspaceRow): TeamVisionWorkspaceRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as TeamVisionWorkspaceRow
}

function cleanTeamVisionBlock(block: TeamVisionWorkspaceBlock): TeamVisionWorkspaceBlock {
  return Object.fromEntries(
    Object.entries(block).filter(([, value]) => value !== undefined),
  ) as TeamVisionWorkspaceBlock
}

function cleanTeamVisionWorkspace(workspace: TeamVisionWorkspace): TeamVisionWorkspace {
  return {
    ...workspace,
    columns: workspace.columns.map(column => ({ ...column })),
    rows: workspace.rows.map(cleanTeamVisionRow),
    blocks: workspace.blocks.map(cleanTeamVisionBlock),
  }
}

function emptyTeamVisionWorkspace(): TeamVisionWorkspace {
  return {
    columns: DEFAULT_TEAM_VISION_COLUMNS,
    rows: [],
    teamVision: '',
    coreKeywords: [],
    blocks: [],
  }
}

export type TeamVisionWorkspacePatch =
  | { type: 'replace-all'; workspace: TeamVisionWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'update-meta'; field: 'teamVision' | 'coreKeywords'; value: string | string[]; updatedBy?: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyTeamVisionWorkspacePatch(
  current: TeamVisionWorkspace | undefined,
  patch: TeamVisionWorkspacePatch,
): TeamVisionWorkspace {
  const now = Date.now()
  const workspace = cleanTeamVisionWorkspace(current ?? emptyTeamVisionWorkspace())
  const stampWorkspace = (value: TeamVisionWorkspace, updatedBy?: string): TeamVisionWorkspace => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampRow = (value: TeamVisionWorkspaceRow, updatedBy?: string): TeamVisionWorkspaceRow => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampBlock = (value: TeamVisionWorkspaceBlock, updatedBy?: string): TeamVisionWorkspaceBlock => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })

  if (patch.type === 'replace-all') {
    return cleanTeamVisionWorkspace(stampWorkspace(patch.workspace, patch.updatedBy))
  }

  if (patch.type === 'update-cell') {
    const rows = workspace.rows.map(row => {
      if (row.id !== patch.rowId) return row
      return stampRow({
        ...row,
        cells: { ...row.cells, [patch.columnId]: patch.value },
      }, patch.updatedBy)
    })
    return cleanTeamVisionWorkspace(stampWorkspace({ ...workspace, rows }, patch.updatedBy))
  }

  if (patch.type === 'add-row') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      rows: [...workspace.rows, stampRow(patch.row, patch.updatedBy)],
    }, patch.updatedBy))
  }

  if (patch.type === 'delete-row') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      rows: workspace.rows.filter(row => row.id !== patch.rowId),
    }))
  }

  if (patch.type === 'add-column') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      columns: [...workspace.columns, patch.column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [patch.column.id]: '' } })),
    }, patch.updatedBy))
  }

  if (patch.type === 'update-column') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.map(column => column.id === patch.columnId
        ? { ...column, label: patch.label, color: patch.color ?? column.color }
        : column),
    }, patch.updatedBy))
  }

  if (patch.type === 'delete-column') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.filter(column => column.id !== patch.columnId),
      rows: workspace.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[patch.columnId]
        return { ...row, cells }
      }),
    }))
  }

  if (patch.type === 'update-meta') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      [patch.field]: patch.value,
    }, patch.updatedBy))
  }

  if (patch.type === 'upsert-block') {
    const index = workspace.blocks.findIndex(block => block.id === patch.block.id)
    const block = stampBlock(patch.block, patch.updatedBy)
    const blocks = [...workspace.blocks]
    if (index >= 0) blocks[index] = block
    else blocks.push(block)
    return cleanTeamVisionWorkspace(stampWorkspace({ ...workspace, blocks }, patch.updatedBy))
  }

  if (patch.type === 'delete-block') {
    return cleanTeamVisionWorkspace(stampWorkspace({
      ...workspace,
      blocks: workspace.blocks.filter(block => block.id !== patch.blockId),
    }))
  }

  if (patch.type === 'reorder-blocks') {
    const byId = new Map(workspace.blocks.map(block => [block.id, block]))
    const ordered = patch.blockIds.map(id => byId.get(id)).filter(Boolean) as TeamVisionWorkspaceBlock[]
    const orderedIds = new Set(ordered.map(block => block.id))
    const missing = workspace.blocks.filter(block => !orderedIds.has(block.id))
    return cleanTeamVisionWorkspace(stampWorkspace({ ...workspace, blocks: [...ordered, ...missing] }))
  }

  return workspace
}

export async function patchTeamVisionWorkspace(
  projectId: string,
  patch: TeamVisionWorkspacePatch,
): Promise<TeamVisionWorkspace> {
  // [lag fix 2026-05-14] runTransaction → getDoc+updateDoc 단순화 (IGW와 동일 path).
  // Why: 같은 사용자가 빠른 blur/click으로 연속 commit하면 자기 자신과 base-version 충돌(failed-precondition) →
  //      5회 backoff retry 후 throw → "저장 못함" + retry 동안 main thread lag.
  //      동시 편집 race-safety는 last-write-wins로 trade-off.
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyTeamVisionWorkspacePatch(data.teamVisionWorkspace, patch)
  // row.cells / block.table 등 nested 객체 안 undefined까지 제거 — cleanTeamVisionRow/Block은 1-level만 처리
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace)
  await updateDoc(ref, {
    teamVisionWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

// presence는 부모 projects/{id}를 건드리지 않도록 subcollection으로 분리 (IGW와 동일).
// Why: focus/blur마다 부모 문서 필드를 update하면 onSnapshot cascade로 ChatPanel 전체 re-render 폭주.
export type TeamVisionPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  /** textarea selectionStart — 다른 팀원 화면에 구글 문서식 caret 표시용 (IGW와 동일 패턴) */
  caretPos?: number
  updatedAt: number
}

const TVW_PRESENCE_DEBOUNCE_MS = 300
const tvwPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushTvwPresence(
  projectId: string,
  uid: string,
  presence: TeamVisionPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'teamVisionPresence', uid)
  if (presence) {
    // Firestore는 undefined 필드를 거부 — caretPos 같은 optional이 비어 있으면 키 자체를 제거.
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setTeamVisionWorkspacePresence(
  projectId: string,
  uid: string,
  presence: TeamVisionPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = tvwPresenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    tvwPresenceTimers.delete(key)
  }
  if (presence === null) {
    await flushTvwPresence(projectId, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      tvwPresenceTimers.delete(key)
      flushTvwPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setTeamVisionWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, TVW_PRESENCE_DEBOUNCE_MS)
    tvwPresenceTimers.set(key, timer)
  })
}

export function watchTeamVisionWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, TeamVisionPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'teamVisionPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, TeamVisionPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as TeamVisionPresenceEntry })
    onChange(out)
  })
}

// ─── 통합 수업목표 워크스페이스 공동 편집 (A-2-2) ────────────
// teamVisionWorkspace 패턴을 그대로 답습. update-meta 필드만 A-2-2 도메인으로 확장.

const DEFAULT_INTEGRATED_GOAL_COLUMNS: IntegratedGoalWorkspaceColumn[] = [
  { id: 'subject', label: '교과', color: '#E8F0FE' },
  { id: 'goal', label: '교과별 수업목표', color: '#E6F4EA' },
  { id: 'knowledge', label: '지식·이해', color: '#FEF7E0' },
  { id: 'process', label: '과정·기능', color: '#FCE8E6' },
  { id: 'attitude', label: '가치·태도', color: '#F3E8FF' },
]

function cleanIntegratedGoalRow(row: IntegratedGoalWorkspaceRow): IntegratedGoalWorkspaceRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as IntegratedGoalWorkspaceRow
}

function cleanIntegratedGoalBlock(block: IntegratedGoalWorkspaceBlock): IntegratedGoalWorkspaceBlock {
  return Object.fromEntries(
    Object.entries(block).filter(([, value]) => value !== undefined),
  ) as IntegratedGoalWorkspaceBlock
}

function cleanIntegratedGoalWorkspace(workspace: IntegratedGoalWorkspace): IntegratedGoalWorkspace {
  const cleaned: IntegratedGoalWorkspace = {
    ...workspace,
    columns: workspace.columns.map(column => ({ ...column })),
    rows: workspace.rows.map(cleanIntegratedGoalRow),
    blocks: workspace.blocks.map(cleanIntegratedGoalBlock),
  }
  // method가 undefined면 Firestore 저장 불가 — 명시 제거
  return Object.fromEntries(
    Object.entries(cleaned).filter(([, value]) => value !== undefined),
  ) as IntegratedGoalWorkspace
}

function emptyIntegratedGoalWorkspace(): IntegratedGoalWorkspace {
  return {
    columns: DEFAULT_INTEGRATED_GOAL_COLUMNS,
    rows: [],
    commonCoreIdea: '',
    inquiryQuestion: '',
    integratedGoal: '',
    convergentKeywords: [],
    blocks: [],
  }
}

export type IntegratedGoalWorkspacePatch =
  | { type: 'replace-all'; workspace: IntegratedGoalWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: IntegratedGoalWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: IntegratedGoalWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'update-meta'; field: 'commonCoreIdea' | 'inquiryQuestion' | 'integratedGoal' | 'convergentKeywords' | 'method'; value: string | string[] | IntegratedGoalMethod | null; updatedBy?: string }
  | { type: 'upsert-block'; block: IntegratedGoalWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyIntegratedGoalWorkspacePatch(
  current: IntegratedGoalWorkspace | undefined,
  patch: IntegratedGoalWorkspacePatch,
): IntegratedGoalWorkspace {
  const now = Date.now()
  const workspace = cleanIntegratedGoalWorkspace(current ?? emptyIntegratedGoalWorkspace())
  const stampWorkspace = (value: IntegratedGoalWorkspace, updatedBy?: string): IntegratedGoalWorkspace => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampRow = (value: IntegratedGoalWorkspaceRow, updatedBy?: string): IntegratedGoalWorkspaceRow => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampBlock = (value: IntegratedGoalWorkspaceBlock, updatedBy?: string): IntegratedGoalWorkspaceBlock => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })

  if (patch.type === 'replace-all') {
    return cleanIntegratedGoalWorkspace(stampWorkspace(patch.workspace, patch.updatedBy))
  }

  if (patch.type === 'update-cell') {
    const rows = workspace.rows.map(row => {
      if (row.id !== patch.rowId) return row
      return stampRow({
        ...row,
        cells: { ...row.cells, [patch.columnId]: patch.value },
      }, patch.updatedBy)
    })
    return cleanIntegratedGoalWorkspace(stampWorkspace({ ...workspace, rows }, patch.updatedBy))
  }

  if (patch.type === 'add-row') {
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      rows: [...workspace.rows, stampRow(patch.row, patch.updatedBy)],
    }, patch.updatedBy))
  }

  if (patch.type === 'delete-row') {
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      rows: workspace.rows.filter(row => row.id !== patch.rowId),
    }))
  }

  if (patch.type === 'add-column') {
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      columns: [...workspace.columns, patch.column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [patch.column.id]: '' } })),
    }, patch.updatedBy))
  }

  if (patch.type === 'update-column') {
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.map(column => column.id === patch.columnId
        ? { ...column, label: patch.label, color: patch.color ?? column.color }
        : column),
    }, patch.updatedBy))
  }

  if (patch.type === 'delete-column') {
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.filter(column => column.id !== patch.columnId),
      rows: workspace.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[patch.columnId]
        return { ...row, cells }
      }),
    }))
  }

  if (patch.type === 'update-meta') {
    // method 필드는 null이면 제거 (undefined Firestore 저장 불가)
    if (patch.field === 'method') {
      const next = { ...workspace }
      if (patch.value === null || patch.value === undefined || patch.value === '') {
        delete (next as Partial<IntegratedGoalWorkspace>).method
      } else {
        next.method = patch.value as IntegratedGoalMethod
      }
      return cleanIntegratedGoalWorkspace(stampWorkspace(next, patch.updatedBy))
    }
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      [patch.field]: patch.value,
    } as IntegratedGoalWorkspace, patch.updatedBy))
  }

  if (patch.type === 'upsert-block') {
    const index = workspace.blocks.findIndex(block => block.id === patch.block.id)
    const block = stampBlock(patch.block, patch.updatedBy)
    const blocks = [...workspace.blocks]
    if (index >= 0) blocks[index] = block
    else blocks.push(block)
    return cleanIntegratedGoalWorkspace(stampWorkspace({ ...workspace, blocks }, patch.updatedBy))
  }

  if (patch.type === 'delete-block') {
    return cleanIntegratedGoalWorkspace(stampWorkspace({
      ...workspace,
      blocks: workspace.blocks.filter(block => block.id !== patch.blockId),
    }))
  }

  if (patch.type === 'reorder-blocks') {
    const byId = new Map(workspace.blocks.map(block => [block.id, block]))
    const ordered = patch.blockIds.map(id => byId.get(id)).filter(Boolean) as IntegratedGoalWorkspaceBlock[]
    const orderedIds = new Set(ordered.map(block => block.id))
    const missing = workspace.blocks.filter(block => !orderedIds.has(block.id))
    return cleanIntegratedGoalWorkspace(stampWorkspace({ ...workspace, blocks: [...ordered, ...missing] }))
  }

  return workspace
}

export async function patchIntegratedGoalWorkspace(
  projectId: string,
  patch: IntegratedGoalWorkspacePatch,
): Promise<IntegratedGoalWorkspace> {
  // [lag fix 2026-05-14] runTransaction → getDoc+updateDoc 로 단순화.
  // Why: 같은 사용자가 빠른 blur/click으로 연속 commit하면 자기 자신과 base-version 충돌(failed-precondition)이 나
  //      5회 backoff retry 후 throw → "저장하지 못했습니다" + retry 동안 main thread lag.
  //      동시 편집의 race-safety는 last-write-wins로 trade-off (다중 사용자 동시 편집 시 한쪽 변경이 덮어쓸 수 있음).
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyIntegratedGoalWorkspacePatch(data.integratedGoalWorkspace, patch)
  // row.cells / block.table 등 nested 객체 안 undefined까지 제거 — cleanXxxRow/Block은 1-level만 처리
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace)
  await updateDoc(ref, {
    integratedGoalWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

// presence는 부모 projects/{id}를 건드리지 않도록 subcollection으로 분리
// (focus/blur 시 부모 updateTime이 바뀌면 patchIntegratedGoalWorkspace 트랜잭션이 failed-precondition으로 무한 재시도)
export type IntegratedGoalPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  /** textarea selectionStart — 다른 팀원 화면에 구글 문서식 caret 표시용 */
  caretPos?: number
  updatedAt: number
}

// 셀 focus 이동마다 setDoc이 즉시 호출되면 트래픽 폭주 + 다른 팀원의 watch onSnapshot 폭주.
// 같은 uid의 연속 호출은 마지막 것만 실제 write (300ms window).
// 단, presence=null(unfocus)은 즉시 — 다른 팀원 화면에서 cursor가 빠르게 사라져야 자연스럽다.
const PRESENCE_DEBOUNCE_MS = 300
const presenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushPresence(
  projectId: string,
  uid: string,
  presence: IntegratedGoalPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'integratedGoalPresence', uid)
  if (presence) {
    // Firestore는 undefined 필드를 거부하므로 제거 후 write
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setIntegratedGoalWorkspacePresence(
  projectId: string,
  uid: string,
  presence: IntegratedGoalPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  // pending timer가 있으면 일단 취소 (마지막 것만 적용)
  const pending = presenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    presenceTimers.delete(key)
  }

  // unfocus(null)는 즉시 flush — 다른 팀원 화면에서 cursor가 빠르게 사라지도록.
  if (presence === null) {
    await flushPresence(projectId, uid, null)
    return
  }

  // focus/move는 디바운스. 호출자는 await를 걸지만 실제 write는 trailing-edge에서만 일어난다.
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      presenceTimers.delete(key)
      flushPresence(projectId, uid, presence).then(resolve, (err) => {
        // 실패해도 resolve — presence는 best-effort, 호출자 흐름을 막지 않는다.
        console.warn('[setIntegratedGoalWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, PRESENCE_DEBOUNCE_MS)
    presenceTimers.set(key, timer)
  })
}

export function watchIntegratedGoalWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, IntegratedGoalPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'integratedGoalPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, IntegratedGoalPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as IntegratedGoalPresenceEntry })
    onChange(out)
  })
}

// ─── 수업설계 방향 워크스페이스 공동 편집 (T-1-2) ────────────
// shape은 TeamVisionWorkspace와 동일하므로 apply 로직을 그대로 위임한다.
// (관련 type alias는 types/index.ts에서 정의)

import type { LessonDesignDirectionWorkspace, EvaluationPlanWorkspace, ProblemSituationWorkspace, SupportToolWorkspace } from '@/types'

const DEFAULT_LESSON_DESIGN_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'principle', label: '설계 원칙', color: '#E8F0FE' },
  { id: 'rationale', label: '근거', color: '#E8F0FE' },
]

function emptyLessonDesignDirectionWorkspace(): LessonDesignDirectionWorkspace {
  return {
    columns: DEFAULT_LESSON_DESIGN_COLUMNS,
    rows: [],
    blocks: [],
  }
}

// 수업설계 방향 patch는 TeamVision과 동일 union을 재사용 (의미적 alias만 분리).
// update-meta는 'teamVision'/'coreKeywords'에 한정되므로 LDD에선 사용 불가 (호출자 책임).
export type LessonDesignDirectionWorkspacePatch =
  | { type: 'replace-all'; workspace: LessonDesignDirectionWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyLessonDesignDirectionWorkspacePatch(
  current: LessonDesignDirectionWorkspace | undefined,
  patch: LessonDesignDirectionWorkspacePatch,
): LessonDesignDirectionWorkspace {
  // TeamVision의 apply는 update-meta를 제외하면 동일 동작. fakeAsTeamVision 헬퍼로 위임.
  const tvCurrent = current
    ? ({ ...current, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_LESSON_DESIGN_COLUMNS } as TeamVisionWorkspace)
  const tvPatch = patch as TeamVisionWorkspacePatch
  const next = applyTeamVisionWorkspacePatch(tvCurrent, tvPatch)
  // T-1-2 워크스페이스에는 teamVision/coreKeywords 필드가 없으므로 떼어낸다.
  const result: LessonDesignDirectionWorkspace = {
    columns: next.columns,
    rows: next.rows,
    blocks: next.blocks,
    updatedBy: next.updatedBy,
    updatedAt: next.updatedAt,
  }
  return result
}

export async function patchLessonDesignDirectionWorkspace(
  projectId: string,
  patch: LessonDesignDirectionWorkspacePatch,
): Promise<LessonDesignDirectionWorkspace> {
  const ref = doc(db, 'projects', projectId)
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('project-not-found')
    const data = snap.data() as Project
    const base = { ...emptyLessonDesignDirectionWorkspace(), ...data.lessonDesignDirectionWorkspace }
    const nextWorkspace = applyLessonDesignDirectionWorkspacePatch(base, patch)
    // Once migrated, legacy whole-workspace saves must not overwrite CRDT text.
    if (snap.data().lessonDesignDirectionDocument?.state) {
      nextWorkspace.blocks = data.lessonDesignDirectionWorkspace?.blocks ?? []
    }
    const cleanWorkspace = stripUndefinedDeep(nextWorkspace)
    transaction.update(ref, {
      lessonDesignDirectionWorkspace: cleanWorkspace,
      updatedAt: serverTimestamp(),
    })
    return cleanWorkspace
  })
}

export type LessonDesignDirectionPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const LDD_PRESENCE_DEBOUNCE_MS = 300
const lddPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushLddPresence(
  projectId: string,
  uid: string,
  presence: LessonDesignDirectionPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'lessonDesignDirectionPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setLessonDesignDirectionWorkspacePresence(
  projectId: string,
  uid: string,
  presence: LessonDesignDirectionPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = lddPresenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    lddPresenceTimers.delete(key)
  }
  if (presence === null) {
    await flushLddPresence(projectId, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      lddPresenceTimers.delete(key)
      flushLddPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setLessonDesignDirectionWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, LDD_PRESENCE_DEBOUNCE_MS)
    lddPresenceTimers.set(key, timer)
  })
}

export function watchLessonDesignDirectionWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, LessonDesignDirectionPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'lessonDesignDirectionPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, LessonDesignDirectionPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as LessonDesignDirectionPresenceEntry })
    onChange(out)
  })
}

// ─── 평가 계획 워크스페이스 공동 편집 (Ds-1-1) ────────────
// LDD와 동일 패턴 — shape은 TeamVisionWorkspace 재사용, apply는 그대로 위임.

const DEFAULT_EVALUATION_PLAN_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'checkpoint', label: '확인 지점', color: '#E8F0FE' },
  { id: 'item',       label: '평가 요소', color: '#E8F0FE' },
  { id: 'method',     label: '평가 방법', color: '#E8F0FE' },
  { id: 'timing',     label: '평가 시점', color: '#E8F0FE' },
  { id: 'actor',      label: '평가 주체', color: '#FEF7E0' },
]

export type EvaluationPlanWorkspacePatch =
  | { type: 'replace-all'; workspace: EvaluationPlanWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyEvaluationPlanWorkspacePatch(
  current: EvaluationPlanWorkspace | undefined,
  patch: EvaluationPlanWorkspacePatch,
): EvaluationPlanWorkspace {
  const normalizedCurrent = current && !current.columns.some(column => column.id === 'checkpoint' || column.id === 'actor')
    ? {
        ...current,
        columns: DEFAULT_EVALUATION_PLAN_COLUMNS,
        rows: current.rows.map(row => ({
          ...row,
          cells: {
            ...row.cells,
            checkpoint: row.cells.timing ?? '',
            actor: ['교사', '동료', '자기'].filter(actor => (row.cells.method ?? '').includes(actor)).join('·'),
          },
        })),
      }
    : current
  const tvCurrent = normalizedCurrent
    ? ({ ...normalizedCurrent, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_EVALUATION_PLAN_COLUMNS } as TeamVisionWorkspace)
  const next = applyTeamVisionWorkspacePatch(tvCurrent, patch as TeamVisionWorkspacePatch)
  return {
    columns: next.columns,
    rows: next.rows,
    blocks: next.blocks,
    updatedBy: next.updatedBy,
    updatedAt: next.updatedAt,
  }
}

export async function patchEvaluationPlanWorkspace(
  projectId: string,
  patch: EvaluationPlanWorkspacePatch,
): Promise<EvaluationPlanWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyEvaluationPlanWorkspacePatch(data.evaluationPlanWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace)
  await updateDoc(ref, {
    evaluationPlanWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type EvaluationPlanPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const EVP_PRESENCE_DEBOUNCE_MS = 300
const evpPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushEvpPresence(
  projectId: string,
  uid: string,
  presence: EvaluationPlanPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'evaluationPlanPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setEvaluationPlanWorkspacePresence(
  projectId: string,
  uid: string,
  presence: EvaluationPlanPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = evpPresenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    evpPresenceTimers.delete(key)
  }
  if (presence === null) {
    await flushEvpPresence(projectId, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      evpPresenceTimers.delete(key)
      flushEvpPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setEvaluationPlanWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, EVP_PRESENCE_DEBOUNCE_MS)
    evpPresenceTimers.set(key, timer)
  })
}

export function watchEvaluationPlanWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, EvaluationPlanPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'evaluationPlanPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, EvaluationPlanPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as EvaluationPlanPresenceEntry })
    onChange(out)
  })
}

// ─── 문제상황 워크스페이스 공동 편집 (Ds-1-2) ────────────
const DEFAULT_PROBLEM_SITUATION_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'element', label: '요소', color: '#E8F0FE' },
  { id: 'content', label: '내용', color: '#E8F0FE' },
]

export type ProblemSituationWorkspacePatch =
  | { type: 'replace-all'; workspace: ProblemSituationWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyProblemSituationWorkspacePatch(
  current: ProblemSituationWorkspace | undefined,
  patch: ProblemSituationWorkspacePatch,
): ProblemSituationWorkspace {
  const tvCurrent = current
    ? ({ ...current, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_PROBLEM_SITUATION_COLUMNS } as TeamVisionWorkspace)
  const next = applyTeamVisionWorkspacePatch(tvCurrent, patch as TeamVisionWorkspacePatch)
  return {
    columns: next.columns,
    rows: next.rows,
    blocks: next.blocks,
    updatedBy: next.updatedBy,
    updatedAt: next.updatedAt,
  }
}

export async function patchProblemSituationWorkspace(
  projectId: string,
  patch: ProblemSituationWorkspacePatch,
): Promise<ProblemSituationWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyProblemSituationWorkspacePatch(data.problemSituationWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace)
  await updateDoc(ref, {
    problemSituationWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type ProblemSituationPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const PSW_PRESENCE_DEBOUNCE_MS = 300
const pswPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushPswPresence(
  projectId: string,
  uid: string,
  presence: ProblemSituationPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'problemSituationWorkspacePresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setProblemSituationWorkspacePresence(
  projectId: string,
  uid: string,
  presence: ProblemSituationPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = pswPresenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    pswPresenceTimers.delete(key)
  }
  if (presence === null) {
    await flushPswPresence(projectId, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pswPresenceTimers.delete(key)
      flushPswPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setProblemSituationWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, PSW_PRESENCE_DEBOUNCE_MS)
    pswPresenceTimers.set(key, timer)
  })
}

export function watchProblemSituationWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, ProblemSituationPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'problemSituationWorkspacePresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, ProblemSituationPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as ProblemSituationPresenceEntry })
    onChange(out)
  })
}

// ─── 지원 도구(자료) 설계 워크스페이스 공동 편집 (Ds-2-1) ────────────
const DEFAULT_SUPPORT_TOOL_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'activity', label: '대상 활동', color: '#E8F0FE' },
  { id: 'name', label: '자료/도구명', color: '#E8F0FE' },
  { id: 'purpose', label: '활용 이유', color: '#E8F0FE' },
  { id: 'sourceType', label: '탐색/개발', color: '#E8F0FE' },
  { id: 'devScope', label: '공동/개별', color: '#E8F0FE' },
  { id: 'owner', label: '담당 교사', color: '#E8F0FE' },
  { id: 'schedule', label: '일정', color: '#E8F0FE' },
]

export type SupportToolWorkspacePatch =
  | { type: 'replace-all'; workspace: SupportToolWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applySupportToolWorkspacePatch(
  current: SupportToolWorkspace | undefined,
  patch: SupportToolWorkspacePatch,
): SupportToolWorkspace {
  const tvCurrent = current
    ? ({ ...current, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_SUPPORT_TOOL_COLUMNS } as TeamVisionWorkspace)
  const next = applyTeamVisionWorkspacePatch(tvCurrent, patch as TeamVisionWorkspacePatch)
  return {
    columns: next.columns,
    rows: next.rows,
    blocks: next.blocks,
    updatedBy: next.updatedBy,
    updatedAt: next.updatedAt,
  }
}

export async function patchSupportToolWorkspace(
  projectId: string,
  patch: SupportToolWorkspacePatch,
): Promise<SupportToolWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applySupportToolWorkspacePatch(data.supportToolWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace)
  await updateDoc(ref, {
    supportToolWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type SupportToolPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const STW_PRESENCE_DEBOUNCE_MS = 300
const stwPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushStwPresence(
  projectId: string,
  uid: string,
  presence: SupportToolPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'supportToolWorkspacePresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setSupportToolWorkspacePresence(
  projectId: string,
  uid: string,
  presence: SupportToolPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = stwPresenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    stwPresenceTimers.delete(key)
  }
  if (presence === null) {
    await flushStwPresence(projectId, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      stwPresenceTimers.delete(key)
      flushStwPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setSupportToolWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, STW_PRESENCE_DEBOUNCE_MS)
    stwPresenceTimers.set(key, timer)
  })
}

export function watchSupportToolWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, SupportToolPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'supportToolWorkspacePresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, SupportToolPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as SupportToolPresenceEntry })
    onChange(out)
  })
}

// ─── 역할 배분 워크스페이스 공동 편집 (T-2-1) ────────────
// shape은 TeamVisionWorkspace와 동일 (5열 표 + 블록). update-meta 필드 없음.

import type { RoleDistributionWorkspace } from '@/types'

const DEFAULT_ROLE_DISTRIBUTION_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'teacherName',     label: '교사명',         color: '#E8F0FE' },
  { id: 'subject',          label: '담당 교과',      color: '#E8F0FE' },
  { id: 'strengths',        label: '강점·전문성',    color: '#E8F0FE' },
  { id: 'role',             label: '팀 내 역할',     color: '#E8F0FE' },
  { id: 'responsibilities', label: '담당 업무',      color: '#E8F0FE' },
  { id: 'deadline',         label: '완료 시점',      color: '#FEF7E0' },
]

function emptyRoleDistributionWorkspace(): RoleDistributionWorkspace {
  return {
    columns: DEFAULT_ROLE_DISTRIBUTION_COLUMNS,
    rows: [],
    blocks: [],
  }
}

// patch union은 TeamVision과 동일 (update-meta는 호출처가 사용하지 않음).
export type RoleDistributionWorkspacePatch =
  | { type: 'replace-all'; workspace: RoleDistributionWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyRoleDistributionWorkspacePatch(
  current: RoleDistributionWorkspace | undefined,
  patch: RoleDistributionWorkspacePatch,
): RoleDistributionWorkspace {
  const normalizedCurrent = current && !current.columns.some(column => column.id === 'deadline')
    ? { ...current, columns: [...current.columns, DEFAULT_ROLE_DISTRIBUTION_COLUMNS[DEFAULT_ROLE_DISTRIBUTION_COLUMNS.length - 1]] }
    : current
  const tvCurrent = normalizedCurrent
    ? ({ ...normalizedCurrent, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_ROLE_DISTRIBUTION_COLUMNS } as TeamVisionWorkspace)
  const tvPatch = patch as TeamVisionWorkspacePatch
  const next = applyTeamVisionWorkspacePatch(tvCurrent, tvPatch)
  return {
    columns: next.columns,
    rows: next.rows,
    blocks: next.blocks,
    updatedBy: next.updatedBy,
    updatedAt: next.updatedAt,
  }
}

export async function patchRoleDistributionWorkspace(
  projectId: string,
  patch: RoleDistributionWorkspacePatch,
): Promise<RoleDistributionWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyRoleDistributionWorkspacePatch(data.roleDistributionWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace) as RoleDistributionWorkspace
  await updateDoc(ref, {
    roleDistributionWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type RoleDistributionPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const RD_PRESENCE_DEBOUNCE_MS = 300
const rdPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushRdPresence(
  projectId: string,
  uid: string,
  presence: RoleDistributionPresenceEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'roleDistributionPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setRoleDistributionWorkspacePresence(
  projectId: string,
  uid: string,
  presence: RoleDistributionPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = rdPresenceTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    rdPresenceTimers.delete(key)
  }
  if (presence === null) {
    await flushRdPresence(projectId, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      rdPresenceTimers.delete(key)
      flushRdPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setRoleDistributionWorkspacePresence] flush failed:', err)
        resolve()
      })
    }, RD_PRESENCE_DEBOUNCE_MS)
    rdPresenceTimers.set(key, timer)
  })
}

export function watchRoleDistributionWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, RoleDistributionPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'roleDistributionPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, RoleDistributionPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as RoleDistributionPresenceEntry })
    onChange(out)
  })
}

// ─── 팀 규칙 워크스페이스 공동 편집 (T-2-2) ─────────────
// shape은 TeamVisionWorkspace와 동일 — apply는 TVW에 위임 후 meta 필드만 떼어낸다.

import type { TeamRulesWorkspace, TeamScheduleWorkspace } from '@/types'

const DEFAULT_TEAM_RULES_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'category',    label: '분류',         color: '#E8F0FE' },
  { id: 'name',        label: '규칙명',       color: '#E8F0FE' },
  { id: 'description', label: '설명',         color: '#E8F0FE' },
  { id: 'feasibility', label: '실천 방법',     color: '#E8F0FE' },
]

function emptyTeamRulesWorkspace(): TeamRulesWorkspace {
  return { columns: DEFAULT_TEAM_RULES_COLUMNS, rows: [], blocks: [] }
}

function normalizeTeamRulesWorkspace(workspace: TeamRulesWorkspace): TeamRulesWorkspace {
  const columns = workspace.columns.map(column => column.id === 'violation'
    ? { ...column, id: 'feasibility', label: '실천 방법' }
    : column)
  const rows = workspace.rows.map(row => {
    const legacyValue = row.cells.violation
    if (!legacyValue || row.cells.feasibility) return row
    const cells = Object.fromEntries(Object.entries(row.cells).filter(([key]) => key !== 'violation'))
    return { ...row, cells: { ...cells, feasibility: legacyValue } }
  })
  return { ...workspace, columns, rows }
}

export type TeamRulesWorkspacePatch =
  | { type: 'replace-all'; workspace: TeamRulesWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyTeamRulesWorkspacePatch(
  current: TeamRulesWorkspace | undefined,
  patch: TeamRulesWorkspacePatch,
): TeamRulesWorkspace {
  const normalizedCurrent = current ? normalizeTeamRulesWorkspace(current) : undefined
  const tvCurrent = normalizedCurrent
    ? ({ ...normalizedCurrent, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_TEAM_RULES_COLUMNS } as TeamVisionWorkspace)
  const next = applyTeamVisionWorkspacePatch(tvCurrent, patch as TeamVisionWorkspacePatch)
  return { columns: next.columns, rows: next.rows, blocks: next.blocks, updatedBy: next.updatedBy, updatedAt: next.updatedAt }
}

export async function patchTeamRulesWorkspace(
  projectId: string,
  patch: TeamRulesWorkspacePatch,
): Promise<TeamRulesWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyTeamRulesWorkspacePatch(data.teamRulesWorkspace, patch)
  const clean = stripUndefinedDeep(nextWorkspace) as TeamRulesWorkspace
  await updateDoc(ref, { teamRulesWorkspace: clean, updatedAt: serverTimestamp() })
  return clean
}

export type TeamRulesPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const TR_PRESENCE_DEBOUNCE_MS = 300
const trPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushTrPresence(projectId: string, uid: string, presence: TeamRulesPresenceEntry | null): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'teamRulesPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setTeamRulesWorkspacePresence(
  projectId: string,
  uid: string,
  presence: TeamRulesPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = trPresenceTimers.get(key)
  if (pending) { clearTimeout(pending); trPresenceTimers.delete(key) }
  if (presence === null) { await flushTrPresence(projectId, uid, null); return }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      trPresenceTimers.delete(key)
      flushTrPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setTeamRulesWorkspacePresence] flush failed:', err); resolve()
      })
    }, TR_PRESENCE_DEBOUNCE_MS)
    trPresenceTimers.set(key, timer)
  })
}

export function watchTeamRulesWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, TeamRulesPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'teamRulesPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, TeamRulesPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as TeamRulesPresenceEntry })
    onChange(out)
  })
}

// ─── 팀 일정 워크스페이스 공동 편집 (T-2-3) ─────────────

const DEFAULT_TEAM_SCHEDULE_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'period',      label: '기간',         color: '#E8F0FE' },
  { id: 'activity',    label: '활동',         color: '#E8F0FE' },
  { id: 'content',     label: '내용',         color: '#E8F0FE' },
  { id: 'assignee',    label: '담당자',       color: '#E8F0FE' },
]

function emptyTeamScheduleWorkspace(): TeamScheduleWorkspace {
  return { columns: DEFAULT_TEAM_SCHEDULE_COLUMNS, rows: [], blocks: [] }
}

export type TeamScheduleWorkspacePatch =
  | { type: 'replace-all'; workspace: TeamScheduleWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyTeamScheduleWorkspacePatch(
  current: TeamScheduleWorkspace | undefined,
  patch: TeamScheduleWorkspacePatch,
): TeamScheduleWorkspace {
  const tvCurrent = current
    ? ({ ...current, teamVision: '', coreKeywords: [] } as TeamVisionWorkspace)
    : ({ ...emptyTeamVisionWorkspace(), columns: DEFAULT_TEAM_SCHEDULE_COLUMNS } as TeamVisionWorkspace)
  const next = applyTeamVisionWorkspacePatch(tvCurrent, patch as TeamVisionWorkspacePatch)
  return { columns: next.columns, rows: next.rows, blocks: next.blocks, updatedBy: next.updatedBy, updatedAt: next.updatedAt }
}

export async function patchTeamScheduleWorkspace(
  projectId: string,
  patch: TeamScheduleWorkspacePatch,
): Promise<TeamScheduleWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyTeamScheduleWorkspacePatch(data.teamScheduleWorkspace, patch)
  const clean = stripUndefinedDeep(nextWorkspace) as TeamScheduleWorkspace
  await updateDoc(ref, { teamScheduleWorkspace: clean, updatedAt: serverTimestamp() })
  return clean
}

export type TeamSchedulePresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const TS_PRESENCE_DEBOUNCE_MS = 300
const tsPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushTsPresence(projectId: string, uid: string, presence: TeamSchedulePresenceEntry | null): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'teamSchedulePresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setTeamScheduleWorkspacePresence(
  projectId: string,
  uid: string,
  presence: TeamSchedulePresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = tsPresenceTimers.get(key)
  if (pending) { clearTimeout(pending); tsPresenceTimers.delete(key) }
  if (presence === null) { await flushTsPresence(projectId, uid, null); return }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      tsPresenceTimers.delete(key)
      flushTsPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setTeamScheduleWorkspacePresence] flush failed:', err); resolve()
      })
    }, TS_PRESENCE_DEBOUNCE_MS)
    tsPresenceTimers.set(key, timer)
  })
}

export function watchTeamScheduleWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, TeamSchedulePresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'teamSchedulePresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, TeamSchedulePresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as TeamSchedulePresenceEntry })
    onChange(out)
  })
}

// ─── 주제 선정 워크스페이스 공동 편집 (A-1-2) ────────────
// IGW 패턴 답습 — 메타 단일 필드(selectedTopic·topicType·rationale) + 기준 표 + 블록.

import type { TopicSelectionWorkspace } from '@/types'

const DEFAULT_TOPIC_SELECTION_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'criterion',   label: '선정 기준', color: '#E8F0FE' },
  { id: 'description', label: '설명',      color: '#E8F0FE' },
  { id: 'priority',    label: '우선순위',  color: '#E8F0FE' },
]

function cleanTopicSelectionRow(row: TeamVisionWorkspaceRow): TeamVisionWorkspaceRow {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as TeamVisionWorkspaceRow
}

function cleanTopicSelectionBlock(block: TeamVisionWorkspaceBlock): TeamVisionWorkspaceBlock {
  return Object.fromEntries(Object.entries(block).filter(([, v]) => v !== undefined)) as TeamVisionWorkspaceBlock
}

function cleanTopicSelectionWorkspace(workspace: TopicSelectionWorkspace): TopicSelectionWorkspace {
  const cleaned: TopicSelectionWorkspace = {
    ...workspace,
    columns: workspace.columns.map(column => ({ ...column })),
    rows: workspace.rows.map(cleanTopicSelectionRow),
    blocks: workspace.blocks.map(cleanTopicSelectionBlock),
  }
  return Object.fromEntries(Object.entries(cleaned).filter(([, v]) => v !== undefined)) as TopicSelectionWorkspace
}

function emptyTopicSelectionWorkspace(): TopicSelectionWorkspace {
  return {
    columns: DEFAULT_TOPIC_SELECTION_COLUMNS,
    rows: [],
    selectedTopic: '',
    topicType: '',
    rationale: '',
    blocks: [],
  }
}

export type TopicSelectionWorkspacePatch =
  | { type: 'replace-all'; workspace: TopicSelectionWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'update-meta'; field: 'selectedTopic' | 'topicType' | 'rationale'; value: string; updatedBy?: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyTopicSelectionWorkspacePatch(
  current: TopicSelectionWorkspace | undefined,
  patch: TopicSelectionWorkspacePatch,
): TopicSelectionWorkspace {
  const now = Date.now()
  const workspace = cleanTopicSelectionWorkspace(current ?? emptyTopicSelectionWorkspace())
  const stampWorkspace = (value: TopicSelectionWorkspace, updatedBy?: string): TopicSelectionWorkspace => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampRow = (value: TeamVisionWorkspaceRow, updatedBy?: string): TeamVisionWorkspaceRow => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampBlock = (value: TeamVisionWorkspaceBlock, updatedBy?: string): TeamVisionWorkspaceBlock => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })

  if (patch.type === 'replace-all') {
    return cleanTopicSelectionWorkspace(stampWorkspace(patch.workspace, patch.updatedBy))
  }
  if (patch.type === 'update-cell') {
    const rows = workspace.rows.map(row => row.id === patch.rowId
      ? stampRow({ ...row, cells: { ...row.cells, [patch.columnId]: patch.value } }, patch.updatedBy)
      : row)
    return cleanTopicSelectionWorkspace(stampWorkspace({ ...workspace, rows }, patch.updatedBy))
  }
  if (patch.type === 'add-row') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      rows: [...workspace.rows, stampRow(patch.row, patch.updatedBy)],
    }, patch.updatedBy))
  }
  if (patch.type === 'delete-row') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      rows: workspace.rows.filter(row => row.id !== patch.rowId),
    }))
  }
  if (patch.type === 'add-column') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      columns: [...workspace.columns, patch.column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [patch.column.id]: '' } })),
    }, patch.updatedBy))
  }
  if (patch.type === 'update-column') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.map(column => column.id === patch.columnId
        ? { ...column, label: patch.label, color: patch.color ?? column.color }
        : column),
    }, patch.updatedBy))
  }
  if (patch.type === 'delete-column') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.filter(column => column.id !== patch.columnId),
      rows: workspace.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[patch.columnId]
        return { ...row, cells }
      }),
    }))
  }
  if (patch.type === 'update-meta') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      [patch.field]: patch.value,
    } as TopicSelectionWorkspace, patch.updatedBy))
  }
  if (patch.type === 'upsert-block') {
    const index = workspace.blocks.findIndex(block => block.id === patch.block.id)
    const block = stampBlock(patch.block, patch.updatedBy)
    const blocks = [...workspace.blocks]
    if (index >= 0) blocks[index] = block
    else blocks.push(block)
    return cleanTopicSelectionWorkspace(stampWorkspace({ ...workspace, blocks }, patch.updatedBy))
  }
  if (patch.type === 'delete-block') {
    return cleanTopicSelectionWorkspace(stampWorkspace({
      ...workspace,
      blocks: workspace.blocks.filter(block => block.id !== patch.blockId),
    }))
  }
  if (patch.type === 'reorder-blocks') {
    const byId = new Map(workspace.blocks.map(block => [block.id, block]))
    const ordered = patch.blockIds.map(id => byId.get(id)).filter(Boolean) as TeamVisionWorkspaceBlock[]
    const orderedIds = new Set(ordered.map(block => block.id))
    const missing = workspace.blocks.filter(block => !orderedIds.has(block.id))
    return cleanTopicSelectionWorkspace(stampWorkspace({ ...workspace, blocks: [...ordered, ...missing] }))
  }
  return workspace
}

export async function patchTopicSelectionWorkspace(
  projectId: string,
  patch: TopicSelectionWorkspacePatch,
): Promise<TopicSelectionWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyTopicSelectionWorkspacePatch(data.topicSelectionWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace) as TopicSelectionWorkspace
  await updateDoc(ref, {
    topicSelectionWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type TopicSelectionPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const TPS_PRESENCE_DEBOUNCE_MS = 300
const tpsPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushTpsPresence(projectId: string, uid: string, presence: TopicSelectionPresenceEntry | null): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'topicSelectionPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setTopicSelectionWorkspacePresence(
  projectId: string,
  uid: string,
  presence: TopicSelectionPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = tpsPresenceTimers.get(key)
  if (pending) { clearTimeout(pending); tpsPresenceTimers.delete(key) }
  if (presence === null) { await flushTpsPresence(projectId, uid, null); return }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      tpsPresenceTimers.delete(key)
      flushTpsPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setTopicSelectionWorkspacePresence] flush failed:', err); resolve()
      })
    }, TPS_PRESENCE_DEBOUNCE_MS)
    tpsPresenceTimers.set(key, timer)
  })
}

export function watchTopicSelectionWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, TopicSelectionPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'topicSelectionPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, TopicSelectionPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as TopicSelectionPresenceEntry })
    onChange(out)
  })
}

// ─── 학습활동 설계 워크스페이스 공동 편집 (Ds-1-3) ────────────
// IGW 패턴 — 메타 단일 필드(review) + 8열 활동 표 + 블록.

import type { LearningActivityWorkspace } from '@/types'

const DEFAULT_LEARNING_ACTIVITY_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'order',       label: '순서',       color: '#E8F0FE' },
  { id: 'phase',       label: '흐름 단계',  color: '#E8F0FE' },
  { id: 'name',        label: '활동명',     color: '#E8F0FE' },
  { id: 'description', label: '활동 설명',  color: '#E8F0FE' },
  { id: 'coreType',    label: '핵심/부가',  color: '#E8F0FE' },
  { id: 'subject',     label: '담당 교과',  color: '#E8F0FE' },
  { id: 'session',     label: '누적 차시',  color: '#E8F0FE' },
  { id: 'operation',   label: '차시 운영(시간·지원·자료·평가)', color: '#E8F0FE' },
]

function cleanLearningActivityRow(row: TeamVisionWorkspaceRow): TeamVisionWorkspaceRow {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as TeamVisionWorkspaceRow
}

function cleanLearningActivityBlock(block: TeamVisionWorkspaceBlock): TeamVisionWorkspaceBlock {
  return Object.fromEntries(Object.entries(block).filter(([, v]) => v !== undefined)) as TeamVisionWorkspaceBlock
}

function cleanLearningActivityWorkspace(workspace: LearningActivityWorkspace): LearningActivityWorkspace {
  const cleaned: LearningActivityWorkspace = {
    ...workspace,
    columns: workspace.columns.map(column => ({ ...column })),
    rows: workspace.rows.map(cleanLearningActivityRow),
    blocks: workspace.blocks.map(cleanLearningActivityBlock),
  }
  return Object.fromEntries(Object.entries(cleaned).filter(([, v]) => v !== undefined)) as LearningActivityWorkspace
}

function emptyLearningActivityWorkspace(): LearningActivityWorkspace {
  return {
    columns: DEFAULT_LEARNING_ACTIVITY_COLUMNS,
    rows: [],
    review: '',
    blocks: [],
  }
}

export type LearningActivityWorkspacePatch =
  | { type: 'replace-all'; workspace: LearningActivityWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'update-meta'; field: 'review'; value: string; updatedBy?: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyLearningActivityWorkspacePatch(
  current: LearningActivityWorkspace | undefined,
  patch: LearningActivityWorkspacePatch,
): LearningActivityWorkspace {
  const now = Date.now()
  const workspace = cleanLearningActivityWorkspace(current ?? emptyLearningActivityWorkspace())
  const stampWorkspace = (value: LearningActivityWorkspace, updatedBy?: string): LearningActivityWorkspace => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampRow = (value: TeamVisionWorkspaceRow, updatedBy?: string): TeamVisionWorkspaceRow => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampBlock = (value: TeamVisionWorkspaceBlock, updatedBy?: string): TeamVisionWorkspaceBlock => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })

  if (patch.type === 'replace-all') {
    return cleanLearningActivityWorkspace(stampWorkspace(patch.workspace, patch.updatedBy))
  }
  if (patch.type === 'update-cell') {
    const rows = workspace.rows.map(row => row.id === patch.rowId
      ? stampRow({ ...row, cells: { ...row.cells, [patch.columnId]: patch.value } }, patch.updatedBy)
      : row)
    return cleanLearningActivityWorkspace(stampWorkspace({ ...workspace, rows }, patch.updatedBy))
  }
  if (patch.type === 'add-row') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      rows: [...workspace.rows, stampRow(patch.row, patch.updatedBy)],
    }, patch.updatedBy))
  }
  if (patch.type === 'delete-row') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      rows: workspace.rows.filter(row => row.id !== patch.rowId),
    }))
  }
  if (patch.type === 'add-column') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      columns: [...workspace.columns, patch.column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [patch.column.id]: '' } })),
    }, patch.updatedBy))
  }
  if (patch.type === 'update-column') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.map(column => column.id === patch.columnId
        ? { ...column, label: patch.label, color: patch.color ?? column.color }
        : column),
    }, patch.updatedBy))
  }
  if (patch.type === 'delete-column') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.filter(column => column.id !== patch.columnId),
      rows: workspace.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[patch.columnId]
        return { ...row, cells }
      }),
    }))
  }
  if (patch.type === 'update-meta') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      [patch.field]: patch.value,
    } as LearningActivityWorkspace, patch.updatedBy))
  }
  if (patch.type === 'upsert-block') {
    const index = workspace.blocks.findIndex(block => block.id === patch.block.id)
    const block = stampBlock(patch.block, patch.updatedBy)
    const blocks = [...workspace.blocks]
    if (index >= 0) blocks[index] = block
    else blocks.push(block)
    return cleanLearningActivityWorkspace(stampWorkspace({ ...workspace, blocks }, patch.updatedBy))
  }
  if (patch.type === 'delete-block') {
    return cleanLearningActivityWorkspace(stampWorkspace({
      ...workspace,
      blocks: workspace.blocks.filter(block => block.id !== patch.blockId),
    }))
  }
  if (patch.type === 'reorder-blocks') {
    const byId = new Map(workspace.blocks.map(block => [block.id, block]))
    const ordered = patch.blockIds.map(id => byId.get(id)).filter(Boolean) as TeamVisionWorkspaceBlock[]
    const orderedIds = new Set(ordered.map(block => block.id))
    const missing = workspace.blocks.filter(block => !orderedIds.has(block.id))
    return cleanLearningActivityWorkspace(stampWorkspace({ ...workspace, blocks: [...ordered, ...missing] }))
  }
  return workspace
}

export async function patchLearningActivityWorkspace(
  projectId: string,
  patch: LearningActivityWorkspacePatch,
): Promise<LearningActivityWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyLearningActivityWorkspacePatch(data.learningActivityWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace) as LearningActivityWorkspace
  await updateDoc(ref, {
    learningActivityWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type LearningActivityPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const LAW_PRESENCE_DEBOUNCE_MS = 300
const lawPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushLawPresence(projectId: string, uid: string, presence: LearningActivityPresenceEntry | null): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'learningActivityPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setLearningActivityWorkspacePresence(
  projectId: string,
  uid: string,
  presence: LearningActivityPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = lawPresenceTimers.get(key)
  if (pending) { clearTimeout(pending); lawPresenceTimers.delete(key) }
  if (presence === null) { await flushLawPresence(projectId, uid, null); return }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      lawPresenceTimers.delete(key)
      flushLawPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setLearningActivityWorkspacePresence] flush failed:', err); resolve()
      })
    }, LAW_PRESENCE_DEBOUNCE_MS)
    lawPresenceTimers.set(key, timer)
  })
}

export function watchLearningActivityWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, LearningActivityPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'learningActivityPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, LearningActivityPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as LearningActivityPresenceEntry })
    onChange(out)
  })
}

// ─── 스캐폴딩 설계 워크스페이스 공동 편집 (Ds-2-2) ────────────
// IGW 패턴 — 메타 단일 필드(review) + 5열 스캐폴딩 계획 표 + 블록.

import type { ScaffoldingWorkspace } from '@/types'

const DEFAULT_SCAFFOLDING_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'targetActivity', label: '대상 활동',      color: '#E8F0FE' },
  { id: 'type',           label: '스캐폴딩 유형',  color: '#E8F0FE' },
  { id: 'content',        label: '구체적 내용',    color: '#E8F0FE' },
  { id: 'level',          label: '대상 수준',      color: '#E8F0FE' },
  { id: 'fadeOut',        label: '점진적 제거 계획', color: '#E8F0FE' },
]

function cleanScaffoldingRow(row: TeamVisionWorkspaceRow): TeamVisionWorkspaceRow {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as TeamVisionWorkspaceRow
}

function cleanScaffoldingBlock(block: TeamVisionWorkspaceBlock): TeamVisionWorkspaceBlock {
  return Object.fromEntries(Object.entries(block).filter(([, v]) => v !== undefined)) as TeamVisionWorkspaceBlock
}

function cleanScaffoldingWorkspace(workspace: ScaffoldingWorkspace): ScaffoldingWorkspace {
  const cleaned: ScaffoldingWorkspace = {
    ...workspace,
    columns: workspace.columns.map(column => ({ ...column })),
    rows: workspace.rows.map(cleanScaffoldingRow),
    blocks: workspace.blocks.map(cleanScaffoldingBlock),
  }
  return Object.fromEntries(Object.entries(cleaned).filter(([, v]) => v !== undefined)) as ScaffoldingWorkspace
}

function emptyScaffoldingWorkspace(): ScaffoldingWorkspace {
  return { columns: DEFAULT_SCAFFOLDING_COLUMNS, rows: [], review: '', blocks: [] }
}

export type ScaffoldingWorkspacePatch =
  | { type: 'replace-all'; workspace: ScaffoldingWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: TeamVisionWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: TeamVisionWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'update-meta'; field: 'review'; value: string; updatedBy?: string }
  | { type: 'upsert-block'; block: TeamVisionWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

function applyScaffoldingWorkspacePatch(
  current: ScaffoldingWorkspace | undefined,
  patch: ScaffoldingWorkspacePatch,
): ScaffoldingWorkspace {
  const now = Date.now()
  const workspace = cleanScaffoldingWorkspace(current ?? emptyScaffoldingWorkspace())
  const stampWorkspace = (value: ScaffoldingWorkspace, updatedBy?: string): ScaffoldingWorkspace => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampRow = (value: TeamVisionWorkspaceRow, updatedBy?: string): TeamVisionWorkspaceRow => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })
  const stampBlock = (value: TeamVisionWorkspaceBlock, updatedBy?: string): TeamVisionWorkspaceBlock => ({
    ...value,
    ...(updatedBy ? { updatedBy } : {}),
    updatedAt: now,
  })

  if (patch.type === 'replace-all') {
    return cleanScaffoldingWorkspace(stampWorkspace(patch.workspace, patch.updatedBy))
  }
  if (patch.type === 'update-cell') {
    const rows = workspace.rows.map(row => row.id === patch.rowId
      ? stampRow({ ...row, cells: { ...row.cells, [patch.columnId]: patch.value } }, patch.updatedBy)
      : row)
    return cleanScaffoldingWorkspace(stampWorkspace({ ...workspace, rows }, patch.updatedBy))
  }
  if (patch.type === 'add-row') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      rows: [...workspace.rows, stampRow(patch.row, patch.updatedBy)],
    }, patch.updatedBy))
  }
  if (patch.type === 'delete-row') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      rows: workspace.rows.filter(row => row.id !== patch.rowId),
    }))
  }
  if (patch.type === 'add-column') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      columns: [...workspace.columns, patch.column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [patch.column.id]: '' } })),
    }, patch.updatedBy))
  }
  if (patch.type === 'update-column') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.map(column => column.id === patch.columnId
        ? { ...column, label: patch.label, color: patch.color ?? column.color }
        : column),
    }, patch.updatedBy))
  }
  if (patch.type === 'delete-column') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      columns: workspace.columns.filter(column => column.id !== patch.columnId),
      rows: workspace.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[patch.columnId]
        return { ...row, cells }
      }),
    }))
  }
  if (patch.type === 'update-meta') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      [patch.field]: patch.value,
    } as ScaffoldingWorkspace, patch.updatedBy))
  }
  if (patch.type === 'upsert-block') {
    const index = workspace.blocks.findIndex(block => block.id === patch.block.id)
    const block = stampBlock(patch.block, patch.updatedBy)
    const blocks = [...workspace.blocks]
    if (index >= 0) blocks[index] = block
    else blocks.push(block)
    return cleanScaffoldingWorkspace(stampWorkspace({ ...workspace, blocks }, patch.updatedBy))
  }
  if (patch.type === 'delete-block') {
    return cleanScaffoldingWorkspace(stampWorkspace({
      ...workspace,
      blocks: workspace.blocks.filter(block => block.id !== patch.blockId),
    }))
  }
  if (patch.type === 'reorder-blocks') {
    const byId = new Map(workspace.blocks.map(block => [block.id, block]))
    const ordered = patch.blockIds.map(id => byId.get(id)).filter(Boolean) as TeamVisionWorkspaceBlock[]
    const orderedIds = new Set(ordered.map(block => block.id))
    const missing = workspace.blocks.filter(block => !orderedIds.has(block.id))
    return cleanScaffoldingWorkspace(stampWorkspace({ ...workspace, blocks: [...ordered, ...missing] }))
  }
  return workspace
}

export async function patchScaffoldingWorkspace(
  projectId: string,
  patch: ScaffoldingWorkspacePatch,
): Promise<ScaffoldingWorkspace> {
  const ref = doc(db, 'projects', projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('project-not-found')
  const data = snap.data() as Project
  const nextWorkspace = applyScaffoldingWorkspacePatch(data.scaffoldingWorkspace, patch)
  const cleanWorkspace = stripUndefinedDeep(nextWorkspace) as ScaffoldingWorkspace
  await updateDoc(ref, {
    scaffoldingWorkspace: cleanWorkspace,
    updatedAt: serverTimestamp(),
  })
  return cleanWorkspace
}

export type ScaffoldingPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const SCF_PRESENCE_DEBOUNCE_MS = 300
const scfPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushScfPresence(projectId: string, uid: string, presence: ScaffoldingPresenceEntry | null): Promise<void> {
  const ref = doc(db, 'projects', projectId, 'scaffoldingPresence', uid)
  if (presence) {
    const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setScaffoldingWorkspacePresence(
  projectId: string,
  uid: string,
  presence: ScaffoldingPresenceEntry | null,
): Promise<void> {
  const key = `${projectId}::${uid}`
  const pending = scfPresenceTimers.get(key)
  if (pending) { clearTimeout(pending); scfPresenceTimers.delete(key) }
  if (presence === null) { await flushScfPresence(projectId, uid, null); return }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      scfPresenceTimers.delete(key)
      flushScfPresence(projectId, uid, presence).then(resolve, (err) => {
        console.warn('[setScaffoldingWorkspacePresence] flush failed:', err); resolve()
      })
    }, SCF_PRESENCE_DEBOUNCE_MS)
    scfPresenceTimers.set(key, timer)
  })
}

export function watchScaffoldingWorkspacePresence(
  projectId: string,
  onChange: (presence: Record<string, ScaffoldingPresenceEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, 'scaffoldingPresence')
  return onSnapshot(ref, (snap) => {
    const out: Record<string, ScaffoldingPresenceEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as ScaffoldingPresenceEntry })
    onChange(out)
  })
}

// 문제상황 디자이너 오픈 상태 설정 (팀원 자동 오픈)
export async function setProblemSituationOpen(projectId: string, open: boolean): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    problemSituationOpen: open,
    updatedAt: serverTimestamp(),
  })
}

// 문제상황 데이터 저장
export async function saveProblemSituationData(
  projectId: string,
  data: {
    scenario: { title: string; row1: string; row2: string; row3: string }
    drivingQuestion: string
    essentialQuestions: string[]
    fullResult?: Record<string, unknown>
  }
): Promise<void> {
  const payload: Record<string, unknown> = {
    scenario: data.scenario,
    drivingQuestion: data.drivingQuestion,
    essentialQuestions: data.essentialQuestions,
    savedAt: Date.now(),
  }
  if (data.fullResult !== undefined) payload.fullResult = data.fullResult
  await updateDoc(doc(db, 'projects', projectId), {
    'problemSituationData': payload,
    problemSituationOpen: false,
    updatedAt: serverTimestamp(),
  })
}

// 팀원이 방장에게 산출물 저장 제안
export async function proposeArtifactToHost(
  projectId: string,
  activityCode: string,
  sections: Record<string, string>,
  proposedBy: string,
  proposedByName: string
): Promise<void> {
  // 제안 단계에서 선택지·절차 문구를 정화 — 전부 걸러지면(실질 내용 없음) 제안 자체를 생략
  const cleaned = sanitizeArtifactSections(sections)
  if (Object.keys(cleaned).length === 0) return
  await updateDoc(doc(db, 'projects', projectId), {
    artifactProposal: { activityCode, sections: cleaned, proposedBy, proposedByName, proposedAt: Date.now() },
    updatedAt: serverTimestamp(),
  })
}

// 산출물 저장 제안 삭제 (수락 또는 거절 후)
export async function clearArtifactProposal(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    artifactProposal: deleteField(),
    updatedAt: serverTimestamp(),
  })
}

export async function requestArtifactRevision(
  projectId: string,
  activityCode: ActivityCode,
  note: string,
  requestedBy: string,
  requestedByName: string,
): Promise<void> {
  const cleanNote = note.trim().slice(0, 2000)
  if (!cleanNote) return
  await updateDoc(doc(db, 'projects', projectId), {
    artifactRevisionRequest: {
      activityCode,
      note: cleanNote,
      requestedBy,
      requestedByName,
      requestedAt: Date.now(),
    },
    updatedAt: serverTimestamp(),
  })
}

export async function clearArtifactRevisionRequest(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    artifactRevisionRequest: deleteField(),
    updatedAt: serverTimestamp(),
  })
}

// ─── 실시간 구독 ─────────────────────────────────────

export function watchProject(
  projectId: string,
  callback: (project: Project | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'projects', projectId),
    (snap) => {
      if (!snap.exists()) {
        callback(null)
        return
      }
      callback({ id: snap.id, ...snap.data() } as Project)
    },
    (error) => {
      console.error('watchProject failed:', error)
      onError?.(error)
    }
  )
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

/** 현재 활동의 모든 메시지 삭제 (데모/디버그용) */
export async function deleteActivityMessages(projectId: string, activityCode: ActivityCode): Promise<void> {
  const colRef = collection(db, `projects/${projectId}/conversations/${activityCode}/messages`)
  const snap = await getDocs(query(colRef, limit(50)))
  const batch = await import('firebase/firestore').then(m => m.writeBatch(db))
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  // 50개 초과 시 재귀
  if (snap.size >= 50) await deleteActivityMessages(projectId, activityCode)
}

// P3: 메시지 저장 전 Firestore ID 미리 생성 → 로컬 임시 메시지와 동일한 ID 사용
export function generateMessageId(projectId: string, activityCode: ActivityCode): string {
  return doc(collection(db, `projects/${projectId}/conversations/${activityCode}/messages`)).id
}

export async function saveMessage(
  projectId: string,
  activityCode: ActivityCode,
  data: Omit<Message, 'id' | 'createdAt'>,
  id?: string,  // 미리 생성한 ID를 넘기면 setDoc, 없으면 addDoc
  createdAt?: Message['createdAt'],  // 같은 문서를 덮어쓸 때 기존 시각을 유지해 대화 위치를 지킨다
): Promise<string> {
  // Firestore는 undefined 값을 허용하지 않으므로 제거
  const clean = Object.fromEntries(
    Object.entries({ ...data, createdAt: createdAt ?? serverTimestamp() })
      .filter(([, v]) => v !== undefined)
  )
  if (id) {
    await setDoc(doc(db, `projects/${projectId}/conversations/${activityCode}/messages`, id), clean)
    return id
  }
  const ref = await addDoc(
    collection(db, `projects/${projectId}/conversations/${activityCode}/messages`),
    clean
  )
  return ref.id
}

export function watchMessages(
  projectId: string,
  activityCode: ActivityCode,
  callback: (messages: Message[]) => void,
  onError?: (error: Error) => void,
  currentCycle = 1,
): Unsubscribe {
  const activityQuery = query(
    collection(db, `projects/${projectId}/conversations/${activityCode}/messages`),
    orderBy('createdAt', 'asc')
  )
  const stageCode = ACTIVITY_META[activityCode].stage
  const legacyQuery = query(
    collection(db, `projects/${projectId}/conversations/${stageCode}/messages`),
    orderBy('createdAt', 'asc')
  )

  let activityMessages: Message[] = []
  let legacyMessages: Message[] = []
  const emit = () => callback(
    mergeMessagesForCycle([activityMessages, legacyMessages], currentCycle),
  )
  const handleError = (source: 'activity' | 'legacy') => (error: Error) => {
    console.error(`watchMessages ${source} path failed:`, error)
    onError?.(error)
  }

  const unsubscribeActivity = onSnapshot(
    activityQuery,
    (snap) => {
      activityMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Message)
      emit()
    },
    handleError('activity'),
  )
  const unsubscribeLegacy = onSnapshot(
    legacyQuery,
    (snap) => {
      legacyMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Message)
        .filter(message => message.activityCode === activityCode)
      emit()
    },
    handleError('legacy'),
  )

  return () => {
    unsubscribeActivity()
    unsubscribeLegacy()
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
  if (data.direction === 'cycle') {
    // cycle 방향은 사용자가 모달에서 "새 주기 시작"을 명시적으로 고른 경우에만 생성된다.
    await finalizeCycleTransition(projectId, data.cycleNumber, 'A')
  }
}

/**
 * E→T 순환 전환 시 호출. 다음 3가지를 한 번의 updateDoc으로 처리:
 *  1. isECompleted = true (순환 화살표 UI 유지)
 *  2. currentCycle / cycleCount 증가
 *  3. 직전 주기 E-1-1/E-2-1 산출물에서 개선안 추출 → previousCycleImprovements 기록
 *
 * 추출 실패는 cycle 전환 자체를 막지 않음. best-effort.
 * 레거시(_schemaVersion !== 'v2-sections') 산출물도 best-effort로 시도.
 * 모달의 명시적 선택은 E-2-1 산출물에 남아 있던 이전 선택보다 우선한다.
 */
export async function finalizeCycleTransition(
  projectId: string,
  completedCycleNumber: number,
  explicitNextCycleChoice?: NextCycleChoice,
): Promise<void> {
  // 현재 프로젝트 상태를 읽어 산출물 추출. 실패해도 cycle 자체는 이미 기록됐으므로 throw 금지.
  const update: Record<string, unknown> = {
    isECompleted: true,
    currentCycle: completedCycleNumber + 1,
    cycleCount: completedCycleNumber + 1,
    cycleStartT11Version: 0,
    updatedAt: serverTimestamp(),
  }
  const improvements: Record<string, unknown> = {
    cycleNumber: completedCycleNumber,
    extractedAt: serverTimestamp(),
  }
  if (explicitNextCycleChoice) improvements.nextCycleChoice = explicitNextCycleChoice
  let hasImprovementData = !!explicitNextCycleChoice

  try {
    const snap = await getDoc(doc(db, 'projects', projectId))
    if (snap.exists()) {
      const proj = snap.data() as Project
      const e11 = proj.artifacts?.['E-1-1']
      const e21 = proj.artifacts?.['E-2-1']
      update.cycleStartT11Version = proj.artifacts?.['T-1-1']?.version ?? 0

      // E-1-1: '수정안' 섹션에서 개선 텍스트
      const e11Improvement = extractImprovementText(e11, ['수정안', '개선안', '다음 주기', '개선', '고칠 점', '다음엔'])
      // E-2-1: '팀 개선안' 섹션
      const e21Improvement = extractImprovementText(e21, ['팀 개선안', '개선안', '수정안', '다음 주기'])
      // E-2-1: '다음 주기 선택' 섹션에서 A/B 판정
      const nextCycleText = extractImprovementText(e21, ['다음 주기 선택', '다음주기', '선택', '다음 주기'])
      const nextCycleChoice = resolveNextCycleChoice(
        explicitNextCycleChoice,
        parseNextCycleChoice(nextCycleText),
      )

      // undefined 필드는 Firestore 저장 불가 → 조건부로만 포함
      if (e11Improvement) improvements.e11Improvement = e11Improvement
      if (e21Improvement) improvements.e21Improvement = e21Improvement
      if (nextCycleChoice) improvements.nextCycleChoice = nextCycleChoice
      hasImprovementData = !!(e11Improvement || e21Improvement || nextCycleChoice)
    }
  } catch (err) {
    // 추출 실패는 로그만 남기고 cycle 전환 자체는 계속 진행
    console.warn('[finalizeCycleTransition] extract failed, continuing without improvements:', err)
  }

  // 추출된 내용 또는 모달의 명시적 선택이 있으면 기록한다.
  if (hasImprovementData) update.previousCycleImprovements = improvements

  await updateDoc(doc(db, 'projects', projectId), update)
}

// ─── AI 스트리밍 상태 공유 ────────────────────────────
// 다른 팀원도 AI 타이핑을 실시간으로 볼 수 있도록 Firestore에 동기화

export interface StreamingState {
  text: string
  senderUid: string
  isStreaming: boolean
}

// 경로: streamingState/{activityCode}/{senderUid}
// 사용자별 개별 문서로 동시 스트리밍 충돌 방지

export async function setStreamingState(
  projectId: string,
  activityCode: ActivityCode,
  text: string,
  senderUid: string
): Promise<void> {
  await setDoc(
    doc(db, `projects/${projectId}/streamingState/${activityCode}/users/${senderUid}`),
    { text, senderUid, isStreaming: true, updatedAt: Date.now() }
  )
}

// P2: 재시도 포함 — 실패해도 좀비 데이터 방지
export async function clearStreamingState(
  projectId: string,
  activityCode: ActivityCode,
  senderUid: string
): Promise<void> {
  const ref = doc(db, `projects/${projectId}/streamingState/${activityCode}/users/${senderUid}`)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await deleteDoc(ref)
      return
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
    }
  }
}

const STREAMING_TTL_MS = 3 * 60 * 1000  // 3분 이상 업데이트 없으면 좀비로 간주

export function watchStreamingState(
  projectId: string,
  activityCode: ActivityCode,
  currentUid: string,
  callback: (states: StreamingState[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, `projects/${projectId}/streamingState/${activityCode}/users`),
    (snap) => {
      const now = Date.now()
      const states = snap.docs
        .map(d => d.data() as StreamingState & { updatedAt?: number })
        .filter(s =>
          s.senderUid !== currentUid &&
          s.isStreaming &&
          // TTL: updatedAt이 없거나 3분 이내인 것만 유효
          (s.updatedAt === undefined || now - s.updatedAt < STREAMING_TTL_MS)
        )
      callback(states)
    }
  )
}

// ─── 협업 프롬프트 초안 (모든 단계 공용) ────────────
// 각 단계 모달의 "구체적으로 AI에게 요청하기" 협업 입력.
// scope 별로 subcollection 분리: `<scope>PromptDraft` (이름 컨벤션 firestore.rules wildcard 매칭).
//   scope = 'roleDistribution' | 'teamVision' | 'integratedGoal' | 'lessonDesignDirection' | ...
// uid별 1행. 본인만 자기 행 write, 멤버 전원 read.

export type CollaborativePromptScope =
  | 'roleDistribution'
  | 'teamVision'
  | 'integratedGoal'
  | 'lessonDesignDirection'
  | 'evaluationPlan'
  | 'problemSituation'
  | 'supportTool'

export type CollaborativePromptEntry = {
  uid: string
  displayName: string
  color: string
  text: string
  updatedAt: number
}

function promptCollectionName(scope: CollaborativePromptScope): string {
  return `${scope}PromptDraft`
}

const COLLAB_PROMPT_DEBOUNCE_MS = 250
const collabPromptTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function flushCollabPrompt(
  projectId: string,
  scope: CollaborativePromptScope,
  uid: string,
  entry: CollaborativePromptEntry | null,
): Promise<void> {
  const ref = doc(db, 'projects', projectId, promptCollectionName(scope), uid)
  if (entry) {
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))
    await setDoc(ref, clean)
  } else {
    await deleteDoc(ref)
  }
}

export async function setCollaborativePromptDraft(
  projectId: string,
  scope: CollaborativePromptScope,
  uid: string,
  entry: CollaborativePromptEntry | null,
): Promise<void> {
  const key = `${projectId}::${scope}::${uid}`
  const pending = collabPromptTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    collabPromptTimers.delete(key)
  }
  if (entry === null) {
    await flushCollabPrompt(projectId, scope, uid, null)
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      collabPromptTimers.delete(key)
      flushCollabPrompt(projectId, scope, uid, entry).then(resolve, (err) => {
        console.warn('[setCollaborativePromptDraft] flush failed:', err)
        resolve()
      })
    }, COLLAB_PROMPT_DEBOUNCE_MS)
    collabPromptTimers.set(key, timer)
  })
}

export function watchCollaborativePromptDraft(
  projectId: string,
  scope: CollaborativePromptScope,
  onChange: (entries: Record<string, CollaborativePromptEntry>) => void,
): Unsubscribe {
  const ref = collection(db, 'projects', projectId, promptCollectionName(scope))
  return onSnapshot(ref, (snap) => {
    const out: Record<string, CollaborativePromptEntry> = {}
    snap.forEach(d => { out[d.id] = d.data() as CollaborativePromptEntry })
    onChange(out)
  })
}

/** 모달 닫기 또는 AI 제안 호출 후 일괄 삭제 (호출자 책임) */
export async function clearCollaborativePromptDraft(
  projectId: string,
  scope: CollaborativePromptScope,
): Promise<void> {
  const colRef = collection(db, 'projects', projectId, promptCollectionName(scope))
  const snap = await getDocs(colRef)
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
}

// ─── DI·E 공동 편집 워크스페이스 (가이드 20260804 §4·§5) ─────────────────
// 기존 12종은 활동마다 patch/presence 함수를 통째로 복제했지만, 신규 4종은
// shape이 완전히 동일하므로 공통 팩토리로 묶는다 (동작은 동일, 코드만 1/4).
// ⚠️ 기존 12종 함수는 그대로 둔다 — 팀 모드 동작 불변이 최우선.

import type {
  CoeditWorkspace,
  CoeditWorkspaceBlock,
  CoeditWorkspaceColumn,
  CoeditWorkspaceRow,
  MaterialDevWorkspace,
  LessonRecordWorkspace,
  LessonReflectionWorkspace,
  CollaborationReflectionWorkspace,
} from '@/types'

export type CoeditWorkspacePatch =
  | { type: 'replace-all'; workspace: CoeditWorkspace; updatedBy?: string }
  | { type: 'update-cell'; rowId: string; columnId: string; value: string; updatedBy?: string }
  | { type: 'add-row'; row: CoeditWorkspaceRow; updatedBy?: string }
  | { type: 'delete-row'; rowId: string }
  | { type: 'add-column'; column: CoeditWorkspaceColumn; updatedBy?: string }
  | { type: 'update-column'; columnId: string; label: string; color?: string; updatedBy?: string }
  | { type: 'delete-column'; columnId: string }
  | { type: 'upsert-block'; block: CoeditWorkspaceBlock; updatedBy?: string }
  | { type: 'delete-block'; blockId: string }
  | { type: 'reorder-blocks'; blockIds: string[] }

export type CoeditPresenceEntry = {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

const COEDIT_PRESENCE_DEBOUNCE_MS = 300
const coeditPresenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 하나의 DI·E 워크스페이스에 대한 patch/presence 모듈을 생성한다.
 * @param field            Project 문서의 워크스페이스 필드명
 * @param presenceCol      presence subcollection 이름 (부모 문서 미변경 → 트랜잭션 충돌 없음)
 * @param defaultColumns   최초 진입 시 주입할 기본 컬럼
 * @param seedBlocks       최초 진입 시 주입할 보조 표/안내 블록 (없으면 빈 배열)
 */
function createCoeditWorkspaceModule<T extends CoeditWorkspace>(
  field: string,
  presenceCol: string,
  defaultColumns: CoeditWorkspaceColumn[],
  seedBlocks: () => CoeditWorkspaceBlock[] = () => [],
) {
  function empty(): CoeditWorkspace {
    return { columns: defaultColumns.map(c => ({ ...c })), rows: [], blocks: seedBlocks() }
  }

  function apply(current: CoeditWorkspace | undefined, patch: CoeditWorkspacePatch): CoeditWorkspace {
    // TeamVision 패치 로직을 그대로 재사용 — 검증된 단일 구현을 공유한다.
    const base = current ?? empty()
    const tv = { ...base, teamVision: '', coreKeywords: [] } as unknown as TeamVisionWorkspace
    const next = applyTeamVisionWorkspacePatch(tv, patch as TeamVisionWorkspacePatch)
    return { columns: next.columns, rows: next.rows, blocks: next.blocks, updatedBy: next.updatedBy, updatedAt: next.updatedAt }
  }

  async function patchWorkspace(projectId: string, patch: CoeditWorkspacePatch): Promise<T> {
    const ref = doc(db, 'projects', projectId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('project-not-found')
    const data = snap.data() as Record<string, unknown>
    const next = apply(data[field] as CoeditWorkspace | undefined, patch)
    const clean = stripUndefinedDeep(next) as T
    await updateDoc(ref, { [field]: clean, updatedAt: serverTimestamp() })
    return clean
  }

  async function flushPresence(projectId: string, uid: string, presence: CoeditPresenceEntry | null): Promise<void> {
    const ref = doc(db, 'projects', projectId, presenceCol, uid)
    if (presence) {
      const clean = Object.fromEntries(Object.entries(presence).filter(([, v]) => v !== undefined))
      await setDoc(ref, clean)
    } else {
      await deleteDoc(ref)
    }
  }

  async function setPresence(projectId: string, uid: string, presence: CoeditPresenceEntry | null): Promise<void> {
    const key = `${presenceCol}::${projectId}::${uid}`
    const pending = coeditPresenceTimers.get(key)
    if (pending) {
      clearTimeout(pending)
      coeditPresenceTimers.delete(key)
    }
    if (presence === null) {
      await flushPresence(projectId, uid, null)
      return
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        coeditPresenceTimers.delete(key)
        flushPresence(projectId, uid, presence).then(resolve, (err) => {
          console.warn(`[${presenceCol}] presence flush failed:`, err)
          resolve()
        })
      }, COEDIT_PRESENCE_DEBOUNCE_MS)
      coeditPresenceTimers.set(key, timer)
    })
  }

  function watchPresence(
    projectId: string,
    onChange: (presence: Record<string, CoeditPresenceEntry>) => void,
  ): Unsubscribe {
    const ref = collection(db, 'projects', projectId, presenceCol)
    return onSnapshot(ref, (snap) => {
      const out: Record<string, CoeditPresenceEntry> = {}
      snap.forEach(d => { out[d.id] = d.data() as CoeditPresenceEntry })
      onChange(out)
    })
  }

  return { empty, patchWorkspace, setPresence, watchPresence }
}

// ── DI-1-1 자료 탐색·개발 ──────────────────────────────────
// 가이드 p56~57 활동 흐름 ➊~➍를 한 표에 담는다.
// '완료' 칸: p57 협력UP #조정 "'완료 여부' 칸을 함께 만들어 두세요"
// '학생 관점 검토' 칸: ➍ 자료 워크스루 — 동료가 학생인 척 따라가며 막힌 지점을 남긴다.
const DEFAULT_MATERIAL_DEV_COLUMNS: CoeditWorkspaceColumn[] = [
  { id: 'activity',   label: '대상 학습활동',   color: '#E8F0FE' },
  { id: 'material',   label: '필요 자료',       color: '#E8F0FE' },
  { id: 'sourceType', label: '탐색/개발',       color: '#E6F4EA' },
  { id: 'devScope',   label: '공동/개별',       color: '#E6F4EA' },
  { id: 'owner',      label: '담당 교사',       color: '#FEF7E0' },
  { id: 'deadline',   label: '마감',            color: '#FEF7E0' },
  { id: 'done',       label: '완료',            color: '#FEF7E0' },
  { id: 'walkthrough', label: '학생 관점 검토(막힌 지점)', color: '#F3E5F5' },
]

// ── DI-2-1 수업 실행·기록 ──────────────────────────────────
// 주 표 = 결정적 장면 기록(산출물 '주요 상황 기록'·'E단계 확인 질문'과 직결).
// 'E단계 확인 질문' 열은 p59 "깊은 분석은 평가 단계에서 합니다"를 구조로 강제 —
// 기록 시점에 해석을 유보시키고 그대로 E-1-1의 입력이 된다.
const DEFAULT_LESSON_RECORD_COLUMNS: CoeditWorkspaceColumn[] = [
  { id: 'when',     label: '시점(차시·시각)',        color: '#E8F0FE' },
  { id: 'scene',    label: '장면·에피소드',          color: '#E8F0FE' },
  { id: 'reaction', label: '학생 반응(직접 인용)',   color: '#E6F4EA' },
  { id: 'gap',      label: '설계와 달랐던 점',       color: '#FCE8E6' },
  { id: 'question', label: 'E단계 확인 질문',        color: '#F3E5F5' },
]

// 보조 표 = 실행 계획. p58 협력UP #상호의존 "같은 프로젝트를 누가 언제 하는지 한 장에 모아 두세요"
function seedLessonRecordBlocks(): CoeditWorkspaceBlock[] {
  return [
    { id: 'plan-heading', type: 'subheading', content: '수업 실행 계획 — 누가 언제 어떻게' },
    {
      id: 'plan-table',
      type: 'table',
      content: '',
      table: {
        columns: [
          { id: 'teacher',  label: '교사',                 color: '#E8F0FE' },
          { id: 'subject',  label: '교과',                 color: '#E8F0FE' },
          { id: 'when',     label: '일시',                 color: '#E8F0FE' },
          { id: 'mode',     label: '실행 방식(개별/공동)', color: '#E6F4EA' },
          { id: 'observer', label: '참관자',               color: '#FEF7E0' },
          { id: 'focus',    label: '관찰 요청 사항',        color: '#FEF7E0' },
        ],
        rows: [],
      },
    },
  ]
}

// ── E-1-1 수업 성찰과 공동 개선 ────────────────────────────
// 주 표 = 학생 증거. p65 협력UP #인지분산이 지정한 3분류 샘플을 열로 고정한다.
const DEFAULT_LESSON_REFLECTION_COLUMNS: CoeditWorkspaceColumn[] = [
  { id: 'teacher',   label: '교사·교과',                       color: '#E8F0FE' },
  { id: 'sampleType', label: '샘플 유형(도달/오개념/예상 밖)',  color: '#E8F0FE' },
  { id: 'evidence',  label: '학생 결과물 근거',                color: '#E6F4EA' },
  { id: 'rubric',    label: '루브릭 도달 정도',                color: '#FEF7E0' },
  { id: 'gap',       label: '설계 의도와의 차이',              color: '#FCE8E6' },
]

// 보조 표 = 개선안. p66 협력UP #외현화 "바뀐 내용 옆에 '왜 바꿨는지'를 한 줄로 붙여 두세요"
function seedLessonReflectionBlocks(): CoeditWorkspaceBlock[] {
  return [
    { id: 'improve-heading', type: 'subheading', content: '수업 개선 — 무엇을 왜 바꿨는가' },
    {
      id: 'improve-table',
      type: 'table',
      content: '',
      table: {
        columns: [
          { id: 'difficulty', label: '학생이 어려워한 지점', color: '#FCE8E6' },
          { id: 'cause',      label: '원인(설계의 어디에?)', color: '#FEF7E0' },
          { id: 'fix',        label: '수정 내용',            color: '#E6F4EA' },
          { id: 'why',        label: '왜 바꿨는지',          color: '#E8F0FE' },
          { id: 'where',      label: '반영 위치(지도안/활동지/평가도구)', color: '#E8F0FE' },
        ],
        rows: [],
      },
    },
  ]
}

// ── E-2-1 협력 과정 성찰 ───────────────────────────────────
// '구조적 보완점' 열 이름 자체가 안전장치 — p68 "'확인이 늦었다'가 아니라
// '확인 여부를 알 수 있는 장치가 없었다'로 옮겨 보면, 탓하지 않으면서도 진짜 고칠 지점이 드러납니다."
const DEFAULT_COLLABORATION_REFLECTION_COLUMNS: CoeditWorkspaceColumn[] = [
  { id: 'agreement', label: '초기 합의(T단계)',   color: '#E8F0FE' },
  { id: 'actual',    label: '실제 진행',          color: '#E8F0FE' },
  { id: 'kept',      label: '잘된 점',            color: '#E6F4EA' },
  { id: 'structural', label: '구조적 보완점',     color: '#FEF7E0' },
  { id: 'principle', label: '다음 협력 운영 원칙', color: '#F3E5F5' },
]

const materialDevModule = createCoeditWorkspaceModule<MaterialDevWorkspace>(
  'materialDevWorkspace', 'materialDevPresence', DEFAULT_MATERIAL_DEV_COLUMNS)
const lessonRecordModule = createCoeditWorkspaceModule<LessonRecordWorkspace>(
  'lessonRecordWorkspace', 'lessonRecordPresence', DEFAULT_LESSON_RECORD_COLUMNS, seedLessonRecordBlocks)
const lessonReflectionModule = createCoeditWorkspaceModule<LessonReflectionWorkspace>(
  'lessonReflectionWorkspace', 'lessonReflectionPresence', DEFAULT_LESSON_REFLECTION_COLUMNS, seedLessonReflectionBlocks)
const collaborationReflectionModule = createCoeditWorkspaceModule<CollaborationReflectionWorkspace>(
  'collaborationReflectionWorkspace', 'collaborationReflectionPresence', DEFAULT_COLLABORATION_REFLECTION_COLUMNS)

export const patchMaterialDevWorkspace = materialDevModule.patchWorkspace
export const setMaterialDevWorkspacePresence = materialDevModule.setPresence
export const watchMaterialDevWorkspacePresence = materialDevModule.watchPresence
export const emptyMaterialDevWorkspace = materialDevModule.empty

export const patchLessonRecordWorkspace = lessonRecordModule.patchWorkspace
export const setLessonRecordWorkspacePresence = lessonRecordModule.setPresence
export const watchLessonRecordWorkspacePresence = lessonRecordModule.watchPresence
export const emptyLessonRecordWorkspace = lessonRecordModule.empty

export const patchLessonReflectionWorkspace = lessonReflectionModule.patchWorkspace
export const setLessonReflectionWorkspacePresence = lessonReflectionModule.setPresence
export const watchLessonReflectionWorkspacePresence = lessonReflectionModule.watchPresence
export const emptyLessonReflectionWorkspace = lessonReflectionModule.empty

export const patchCollaborationReflectionWorkspace = collaborationReflectionModule.patchWorkspace
export const setCollaborationReflectionWorkspacePresence = collaborationReflectionModule.setPresence
export const watchCollaborationReflectionWorkspacePresence = collaborationReflectionModule.watchPresence
export const emptyCollaborationReflectionWorkspace = collaborationReflectionModule.empty

// E-2-1 합의 대조 행 생성 — 순수 로직은 테스트 가능한 모듈에 둔다.
export { buildCollaborationAgreementRows } from '@/lib/artifacts/coeditSerialize'

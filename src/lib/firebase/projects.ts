import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc, deleteDoc, query,
  where, orderBy, limit, serverTimestamp, onSnapshot, Unsubscribe, arrayUnion, deleteField,
  runTransaction, type QueryDocumentSnapshot, type DocumentData, Timestamp
} from 'firebase/firestore'
import { db } from './config'
import type { Project, StageCode, ActivityCode, Artifact, Message, StageTransition, SkippedActionCard, KeyNote, CurriculumSheetRow } from '@/types'
import { ACTIVITY_META } from '@/types'
import type { GraphSavedData, GraphSelectionState } from '@/lib/knowledge-graph/domain'
import { normalizeGraphSavedData, normalizeGraphSelectionState } from '@/lib/knowledge-graph/domain'
import { addJoinedProjectId, generateInviteCode } from '@/lib/inviteCode'
import { extractImprovementText, parseNextCycleChoice } from '@/lib/activity/completion'

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
  const normalized = shouldAttachSchema
    ? { ...data, _schemaVersion: 'v2-sections' as const }
    : data

  // Firestore는 undefined 값을 허용하지 않으므로 제거
  const clean = Object.fromEntries(
    Object.entries(normalized).filter(([, v]) => v !== undefined)
  )
  const updates: Record<string, unknown> = {
    [`artifacts.${activityCode}`]: clean,
    updatedAt: serverTimestamp(),
  }

  // A-2-3는 "확정 완료" 이전이라도 저장된 프로필이 있으면 Ds 단계 가드레일로 활용한다.
  if (activityCode === 'A-2-3') {
    const hasContent = Object.keys((data.content ?? {}) as Record<string, unknown>).length > 0
    updates.isA23Completed = hasContent && data.status !== 'ai_draft'
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
// arrayUnion으로 append, 삭제는 전체 배열 교체 (arrayRemove 는 객체 equality 요구로 까다로움)

export async function addKeyNote(projectId: string, note: KeyNote): Promise<void> {
  // Firestore는 arrayUnion 요소의 undefined 필드를 거부 — 전송 전 제거
  const cleanNote = Object.fromEntries(
    Object.entries(note).filter(([, v]) => v !== undefined),
  ) as KeyNote
  await updateDoc(doc(db, 'projects', projectId), {
    keyNotes: arrayUnion(cleanNote),
    updatedAt: serverTimestamp(),
  })
}

export async function removeKeyNote(projectId: string, noteId: string): Promise<void> {
  const snap = await getDoc(doc(db, 'projects', projectId))
  if (!snap.exists()) return
  const data = snap.data() as Project
  const filtered = (data.keyNotes ?? []).filter(n => n.id !== noteId)
  await updateDoc(doc(db, 'projects', projectId), {
    keyNotes: filtered,
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
  | 'isCenter'
  | 'coreIdea'
  | 'standard'
  | 'knowledge'
  | 'processFunction'
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
  | { type: 'set-center'; rowId: string | null; updatedBy?: string }
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
    return currentRows.map(row => stampRow({
      ...row,
      isCenter: patch.rowId ? row.id === patch.rowId : false,
    }, patch.updatedBy))
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
  await updateDoc(doc(db, 'projects', projectId), {
    artifactProposal: { activityCode, sections, proposedBy, proposedByName, proposedAt: Date.now() },
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
  id?: string  // 미리 생성한 ID를 넘기면 setDoc, 없으면 addDoc
): Promise<string> {
  // Firestore는 undefined 값을 허용하지 않으므로 제거
  const clean = Object.fromEntries(
    Object.entries({ ...data, createdAt: serverTimestamp() })
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
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, `projects/${projectId}/conversations/${activityCode}/messages`),
    orderBy('createdAt', 'asc')
  )
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Message))
    },
    (error) => {
      console.error('watchMessages failed:', error)
      onError?.(error)
    }
  )
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
  // E→T 순환: isECompleted 플래그 + previousCycleImprovements 추출 + currentCycle 증가를
  // 단일 updateDoc으로 통합 (이중 write 방지).
  if (data.direction === 'cycle') {
    await finalizeCycleTransition(projectId, data.cycleNumber)
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
 */
async function finalizeCycleTransition(
  projectId: string,
  completedCycleNumber: number
): Promise<void> {
  // 현재 프로젝트 상태를 읽어 산출물 추출. 실패해도 cycle 자체는 이미 기록됐으므로 throw 금지.
  const update: Record<string, unknown> = {
    isECompleted: true,
    currentCycle: completedCycleNumber + 1,
    cycleCount: completedCycleNumber + 1,
    updatedAt: serverTimestamp(),
  }

  try {
    const snap = await getDoc(doc(db, 'projects', projectId))
    if (snap.exists()) {
      const proj = snap.data() as Project
      const e11 = proj.artifacts?.['E-1-1']
      const e21 = proj.artifacts?.['E-2-1']

      // E-1-1: '수정안' 섹션에서 개선 텍스트
      const e11Improvement = extractImprovementText(e11, ['수정안', '개선안', '다음 주기', '개선', '고칠 점', '다음엔'])
      // E-2-1: '팀 개선안' 섹션
      const e21Improvement = extractImprovementText(e21, ['팀 개선안', '개선안', '수정안', '다음 주기'])
      // E-2-1: '다음 주기 선택' 섹션에서 A/B 판정
      const nextCycleText = extractImprovementText(e21, ['다음 주기 선택', '다음주기', '선택', '다음 주기'])
      const nextCycleChoice = parseNextCycleChoice(nextCycleText)

      // undefined 필드는 Firestore 저장 불가 → 조건부로만 포함
      const improvements: Record<string, unknown> = {
        cycleNumber: completedCycleNumber,
        extractedAt: serverTimestamp(),
      }
      if (e11Improvement) improvements.e11Improvement = e11Improvement
      if (e21Improvement) improvements.e21Improvement = e21Improvement
      if (nextCycleChoice) improvements.nextCycleChoice = nextCycleChoice

      // 추출된 내용이 하나라도 있으면 기록. 전부 비었으면 필드 생략(덮어쓰기만 방지).
      if (e11Improvement || e21Improvement || nextCycleChoice) {
        update.previousCycleImprovements = improvements
      }
    }
  } catch (err) {
    // 추출 실패는 로그만 남기고 cycle 전환 자체는 계속 진행
    console.warn('[finalizeCycleTransition] extract failed, continuing without improvements:', err)
  }

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

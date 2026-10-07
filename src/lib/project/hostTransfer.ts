// 기록 권한(내부 이름 host) 넘기기·요청. 화면에는 '기록 담당'으로 보인다.
// 앱과 규칙 모두 hostUid·createdBy 둘 다를 기록 담당으로 보므로 넘길 때 두 값을 함께 바꿔야
// 이전 기록 담당이 일반 팀원이 된다. 처음 만든 사람은 originalCreatedBy 에 한 번만 남긴다.
import { isProjectHost } from './memberAdmin'

export type HostRequest = { at: number; name: string; rejectedAt?: number }
export type HostTransferRecord = { from: string; to: string; byUid: string; at: number; via: 'transfer' | 'request' }

type HostSource = {
  hostUid?: string
  createdBy?: string
  originalCreatedBy?: string
  memberUids?: readonly string[]
  memberInfo?: Record<string, { displayName?: string } | undefined>
  hostRequests?: Record<string, HostRequest | undefined>
  demoRun?: unknown
}

export type HostTransferError = 'project-not-found' | 'not-host' | 'target-not-member' | 'already-host'

export const HOST_TRANSFER_ERROR_COPY: Record<HostTransferError, string> = {
  'project-not-found': '프로젝트를 찾지 못했어요. 새로고침 뒤 다시 시도해 주세요.',
  // 두 창에서 동시에 넘긴 경우 늦은 쪽도 이 문구를 받는다.
  'not-host': '기록 담당만 넘길 수 있어요. 이미 다른 선생님에게 넘어갔을 수 있어요.',
  'target-not-member': '이 방에 없는 선생님이에요.',
  'already-host': '이미 기록 담당인 선생님이에요.',
}

export function hostTransferErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  return HOST_TRANSFER_ERROR_COPY[code as HostTransferError] ?? '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

export type HostTransferPlan =
  | { ok: false; error: HostTransferError }
  | { ok: true; updates: Record<string, unknown>; clearRequestOf: string; record: HostTransferRecord }

/** 넘기기 전 검사와 바꿀 값. 트랜잭션 안에서 최신 문서로 다시 계산해 동시 넘기기를 막는다. */
export function planHostTransfer(project: HostSource | null | undefined, byUid: string, targetUid: string, now: number): HostTransferPlan {
  if (!project) return { ok: false, error: 'project-not-found' }
  if (!isProjectHost(project, byUid)) return { ok: false, error: 'not-host' }
  if (!(project.memberUids ?? []).includes(targetUid)) return { ok: false, error: 'target-not-member' }
  if (project.hostUid === targetUid && (!project.createdBy || project.createdBy === targetUid)) return { ok: false, error: 'already-host' }
  const updates: Record<string, unknown> = { hostUid: targetUid, createdBy: targetUid }
  if (!project.originalCreatedBy && project.createdBy) updates.originalCreatedBy = project.createdBy
  const via = project.hostRequests?.[targetUid] && !project.hostRequests[targetUid]?.rejectedAt ? 'request' : 'transfer'
  return {
    ok: true, updates, clearRequestOf: targetUid,
    record: { from: project.hostUid ?? project.createdBy ?? byUid, to: targetUid, byUid, at: now, via },
  }
}

/** 팀원이 기록 권한을 요청할 수 있는지 — 이미 기록 담당이거나 데모 관전 중이면 아니다. */
export function canRequestHost(project: HostSource | null | undefined, uid: string | null | undefined): boolean {
  return !!project && !!uid && !project.demoRun && (project.memberUids ?? []).includes(uid) && !isProjectHost(project, uid)
}

export function myHostRequestState(project: HostSource | null | undefined, uid: string | null | undefined): 'none' | 'pending' | 'rejected' {
  const request = uid ? project?.hostRequests?.[uid] : undefined
  if (!request || isProjectHost(project, uid)) return 'none' // 기록 담당이 된 뒤 남은 요청은 의미 없음
  return request.rejectedAt ? 'rejected' : 'pending'
}

/** 기록 담당 화면에 띄울 요청 — 거절한 것·방을 나간 사람·이미 기록 담당인 사람은 빼고 먼저 요청한 순서. */
export function pendingHostRequests(project: HostSource | null | undefined, viewerUid: string | null | undefined): Array<{ uid: string; name: string; at: number }> {
  if (!project || !isProjectHost(project, viewerUid) || project.demoRun) return []
  const members = new Set(project.memberUids ?? [])
  return Object.entries(project.hostRequests ?? {})
    .filter(([uid, request]) => request && !request.rejectedAt && members.has(uid) && !isProjectHost(project, uid))
    .map(([uid, request]) => ({ uid, name: project.memberInfo?.[uid]?.displayName?.trim() || request!.name || '팀원', at: request!.at }))
    .sort((a, b) => a.at - b.at)
}

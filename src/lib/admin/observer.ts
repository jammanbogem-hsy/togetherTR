/**
 * Super admin observer mode — the admin opens a team's real project screen read-only.
 *
 * Safety layers (all three must hold):
 *  1. Firestore rules give the super admin read access only; every write stays member-only.
 *  2. The project page never self-joins an observer (joinProject would otherwise add the admin
 *     to memberUids because the page passes the room's own invite code).
 *  3. While observing, same-origin non-GET /api calls are refused so no AI call or save runs.
 */

import { isSuperAdmin } from './consoleModel'

type Membership = { memberUids?: string[] | null; createdBy?: string | null; hostUid?: string | null }
type AuthUser = { uid: string; email?: string | null; emailVerified?: boolean } | null | undefined

export function isProjectParticipant(project: Membership | null | undefined, uid: string | null | undefined): boolean {
  if (!project || !uid) return false
  return (project.memberUids ?? []).includes(uid) || project.createdBy === uid || project.hostUid === uid
}

/** True when the signed-in super admin is looking at a room they are not part of. */
export function isAdminObserver(project: Membership | null | undefined, user: AuthUser): boolean {
  if (!project || !user) return false
  if (!isSuperAdmin({ email: user.email, email_verified: user.emailVerified })) return false
  return !isProjectParticipant(project, user.uid)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Decide whether an observer request may go out. Only same-origin writes to /api are refused. */
export function observerBlocksRequest(url: string, method: string | undefined, origin: string): boolean {
  if (SAFE_METHODS.has((method ?? 'GET').toUpperCase())) return false
  let parsed: URL
  try { parsed = new URL(url, origin) } catch { return false }
  return parsed.origin === origin && parsed.pathname.startsWith('/api/')
}

/** Install the fetch guard; returns the restore function. */
export function installObserverFetchGuard(onBlocked: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const original = window.fetch
  const guarded: typeof window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (observerBlocksRequest(url, method, window.location.origin)) {
      onBlocked()
      return Promise.reject(new Error('관찰자 모드에서는 저장하거나 AI를 실행할 수 없습니다.'))
    }
    return original(input, init)
  }
  window.fetch = guarded
  return () => { if (window.fetch === guarded) window.fetch = original }
}

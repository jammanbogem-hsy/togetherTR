// Presence docs are keyed by uid (rules: projects/{pid}/{*Presence}/{uid}), so every tab of the same
// account writes the same doc. Without arbitration an idle tab's heartbeat overwrote the caret of the
// tab the person was typing in, and teammates saw the caret jump back and forth (#R4-C).
//
// Ownership is decided per write inside a Firestore transaction:
// - sessionId: random per tab (one module instance), stamped by the send wrapper.
// - interactionAt: wall-clock time of the last real caret event (focus/select/key/click/change);
//   heartbeats repeat it unchanged. 0/absent = never interacted.
// - updatedAt is freshness only. It never decides ownership between live tabs; it only lets a tab
//   claim a doc whose writer stopped heartbeating (crashed/closed without delete).
//
// Limit: tabs running an older build write without a transaction and win unconditionally.
// Blocking them needs a rules change (server-side check), which is out of scope.

export const PRESENCE_OWNER_STALE_MS = 30000

export type OwnedPresence = {
  sessionId?: string
  interactionAt?: number
  updatedAt?: number
}

export type PresenceWriteDecision = 'set' | 'delete' | 'skip'

function interaction(entry: OwnedPresence): number {
  return typeof entry.interactionAt === 'number' && Number.isFinite(entry.interactionAt) ? entry.interactionAt : 0
}

/** Decides what this tab may do to the shared presence doc, given what the doc holds right now. */
export function decidePresenceWrite(
  current: OwnedPresence | null | undefined,
  next: OwnedPresence | null,
  sessionId: string,
  now: number,
): PresenceWriteDecision {
  if (next === null) {
    // Closing removes only this tab's own entry, never another tab's live caret.
    return current && current.sessionId === sessionId ? 'delete' : 'skip'
  }
  if (!current || current.sessionId === sessionId) return 'set'
  // A more recent real interaction takes the doc over; an idle tab (0) never takes an active one.
  if (interaction(next) > interaction(current)) return 'set'
  const updatedAt = typeof current.updatedAt === 'number' ? current.updatedAt : 0
  if (now - updatedAt > PRESENCE_OWNER_STALE_MS) return 'set'
  return 'skip'
}

/** One id per tab. crypto.randomUUID where available; the fallback only needs to differ between tabs. */
export function createPresenceSessionId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

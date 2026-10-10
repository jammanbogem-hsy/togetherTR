/**
 * Admin notices — the super admin sends a short message that pops up inside the web app.
 *
 * Storage (written only by the server with the admin SDK):
 *  - adminNotices/{id}      sent log: scope, target, text, recipients, readBy, withdrawn
 *  - noticeInbox/{uid}      one doc per teacher: { items: NoticeItem[] } — unread notices only
 * Teachers can read only their own inbox doc (firestore.rules); every write goes through the API.
 */

export type NoticeScope = 'user' | 'project' | 'all'

export interface NoticeItem {
  id: string
  title: string
  body: string
  scope: NoticeScope
  /** Room title for project notices, so the teacher knows which room it is about. */
  context?: string
  createdAt: number
}

export interface NoticeLog {
  id: string
  scope: NoticeScope
  target: string
  targetLabel: string
  title: string
  body: string
  createdAt: number | null
  recipientCount: number
  readCount: number
  withdrawn: boolean
}

export const NOTICE_TITLE_MAX = 60
export const NOTICE_BODY_MAX = 1000
/** Unread notices kept per teacher; older ones drop off so the inbox doc stays small. */
export const NOTICE_INBOX_MAX = 20

export type NoticeInput = { scope: NoticeScope; target: string; title: string; body: string }

/** Validate an admin send request. Returns the cleaned input or a Korean error message. */
export function parseNoticeInput(raw: unknown): { ok: true; value: NoticeInput } | { ok: false; error: string } {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const scope = value.scope
  if (scope !== 'user' && scope !== 'project' && scope !== 'all') return { ok: false, error: '보낼 대상을 골라 주세요.' }
  const target = typeof value.target === 'string' ? value.target.trim() : ''
  if (scope !== 'all' && !/^[A-Za-z0-9_-]{1,128}$/.test(target)) return { ok: false, error: '보낼 대상이 올바르지 않습니다.' }
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim() : ''
  const body = typeof value.body === 'string' ? value.body.replace(/\r\n/g, '\n').trim() : ''
  if (!body) return { ok: false, error: '보낼 내용을 적어 주세요.' }
  if (title.length > NOTICE_TITLE_MAX) return { ok: false, error: `제목은 ${NOTICE_TITLE_MAX}자 이내로 적어 주세요.` }
  if (body.length > NOTICE_BODY_MAX) return { ok: false, error: `내용은 ${NOTICE_BODY_MAX}자 이내로 적어 주세요.` }
  return { ok: true, value: { scope, target: scope === 'all' ? 'all' : target, title: title || '관리자 알림', body } }
}

/** Add a notice to an inbox, oldest first, keeping only the most recent NOTICE_INBOX_MAX. */
export function addToInbox(items: readonly NoticeItem[], item: NoticeItem): NoticeItem[] {
  const rest = items.filter(existing => existing.id !== item.id)
  return [...rest, item].sort((a, b) => a.createdAt - b.createdAt).slice(-NOTICE_INBOX_MAX)
}

export function removeFromInbox(items: readonly NoticeItem[], id: string): NoticeItem[] {
  return items.filter(item => item.id !== id)
}

/** Read the inbox doc defensively — anything malformed is dropped rather than shown. */
export function inboxItems(data: unknown): NoticeItem[] {
  const raw = data && typeof data === 'object' ? (data as { items?: unknown }).items : undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.body !== 'string') return []
    const scope: NoticeScope = item.scope === 'project' || item.scope === 'all' ? item.scope : 'user'
    return [{
      id: item.id,
      title: typeof item.title === 'string' && item.title ? item.title : '관리자 알림',
      body: item.body,
      scope,
      ...(typeof item.context === 'string' && item.context ? { context: item.context } : {}),
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
    }]
  }).sort((a, b) => a.createdAt - b.createdAt)
}

/** Recipients of a project notice: every member, plus the creator and the recorder. */
export function projectRecipients(data: Record<string, unknown>): string[] {
  const uids = new Set<string>()
  if (Array.isArray(data.memberUids)) for (const uid of data.memberUids) if (typeof uid === 'string' && uid) uids.add(uid)
  const info = data.memberInfo && typeof data.memberInfo === 'object' ? Object.keys(data.memberInfo as object) : []
  for (const uid of info) if (uid) uids.add(uid)
  for (const key of ['createdBy', 'hostUid'] as const) if (typeof data[key] === 'string' && data[key]) uids.add(data[key] as string)
  return [...uids]
}

export const NOTICE_SCOPE_LABEL: Record<NoticeScope, string> = { user: '개인', project: '방 전체', all: '전체 공지' }

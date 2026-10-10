/**
 * /api/admin/notices — the super admin sends, lists and withdraws in-app popup notices.
 * Writes use the admin SDK; teachers only read their own noticeInbox doc (see firestore.rules).
 */
import { getAdminAuth, getAdminDb, getFieldValue } from '@/lib/firebase/admin'
import { noStoreReply, verifySuperAdminRequest } from '@/lib/admin/serverAuth'
import { textValue, timeValue, recordValue } from '@/lib/admin/consoleModel'
import { parseNoticeInput, projectRecipients, type NoticeItem, type NoticeLog, type NoticeScope } from '@/lib/admin/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Firestore batches allow 500 writes; stay below it. */
const BATCH_SIZE = 400

async function allUserIds(): Promise<string[]> {
  const auth = getAdminAuth()
  if (!auth) return []
  const uids: string[] = []
  let pageToken: string | undefined
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const user of page.users) if (!user.disabled) uids.push(user.uid)
    pageToken = page.pageToken
  } while (pageToken)
  return uids
}

function logOf(id: string, data: Record<string, unknown>): NoticeLog {
  const recipients = Array.isArray(data.recipients) ? data.recipients.length : 0
  return {
    id,
    scope: (['user', 'project', 'all'] as const).includes(data.scope as NoticeScope) ? data.scope as NoticeScope : 'user',
    target: textValue(data.target),
    targetLabel: textValue(data.targetLabel),
    title: textValue(data.title),
    body: textValue(data.body),
    createdAt: timeValue(data.createdAt),
    recipientCount: recipients,
    readCount: Object.keys(recordValue(data.readBy)).length,
    withdrawn: data.withdrawn === true,
  }
}

export async function GET(request: Request) {
  const identity = await verifySuperAdminRequest(request)
  if (identity instanceof Response) return identity
  const db = getAdminDb()
  if (!db) return noStoreReply({ error: '관리자 조회를 준비하지 못했습니다.' }, 503)
  try {
    const page = await db.collection('adminNotices').orderBy('createdAt', 'desc').limit(50).get()
    return noStoreReply({ items: page.docs.map(doc => logOf(doc.id, doc.data())) })
  } catch (error) {
    console.error('[admin-notices] list failed', error instanceof Error ? error.name : 'Unknown')
    return noStoreReply({ error: '보낸 알림을 불러오지 못했습니다.' }, 503)
  }
}

export async function POST(request: Request) {
  const identity = await verifySuperAdminRequest(request)
  if (identity instanceof Response) return identity
  const db = getAdminDb()
  if (!db) return noStoreReply({ error: '알림 보내기를 준비하지 못했습니다.' }, 503)
  const parsed = parseNoticeInput(await request.json().catch(() => null))
  if (!parsed.ok) return noStoreReply({ error: parsed.error }, 400)
  const input = parsed.value
  try {
    let recipients: string[] = []
    let targetLabel = '전체 선생님'
    let context: string | undefined
    if (input.scope === 'user') {
      const profile = await db.collection('users').doc(input.target).get()
      const auth = getAdminAuth()
      const user = auth ? await auth.getUser(input.target).catch(() => null) : null
      if (!profile.exists && !user) return noStoreReply({ error: '받는 선생님을 찾을 수 없습니다.' }, 404)
      recipients = [input.target]
      targetLabel = textValue(profile.data()?.displayName) || user?.displayName || user?.email || '이름 미등록'
    } else if (input.scope === 'project') {
      const project = await db.collection('projects').doc(input.target).get()
      if (!project.exists) return noStoreReply({ error: '프로젝트를 찾을 수 없습니다.' }, 404)
      recipients = projectRecipients(project.data()!)
      context = textValue(project.data()?.title) || '프로젝트'
      targetLabel = context
    } else {
      recipients = await allUserIds()
    }
    if (recipients.length === 0) return noStoreReply({ error: '받을 선생님이 없습니다.' }, 400)

    const ref = db.collection('adminNotices').doc()
    const item: NoticeItem = { id: ref.id, title: input.title, body: input.body, scope: input.scope, ...(context ? { context } : {}), createdAt: Date.now() }
    const FieldValue = getFieldValue()
    await ref.set({ ...input, targetLabel, item, recipients, readBy: {}, withdrawn: false, createdAt: FieldValue.serverTimestamp(), createdBy: identity.uid })
    for (let start = 0; start < recipients.length; start += BATCH_SIZE) {
      const batch = db.batch()
      for (const uid of recipients.slice(start, start + BATCH_SIZE)) {
        batch.set(db.collection('noticeInbox').doc(uid), { items: FieldValue.arrayUnion(item), updatedAt: Date.now() }, { merge: true })
      }
      await batch.commit()
    }
    return noStoreReply({ ok: true, id: ref.id, recipientCount: recipients.length, targetLabel })
  } catch (error) {
    console.error('[admin-notices] send failed', error instanceof Error ? error.name : 'Unknown')
    return noStoreReply({ error: '알림을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503)
  }
}

/** Withdraw: remove the notice from every inbox that has not read it yet. The log stays. */
export async function DELETE(request: Request) {
  const identity = await verifySuperAdminRequest(request)
  if (identity instanceof Response) return identity
  const db = getAdminDb()
  if (!db) return noStoreReply({ error: '알림 회수를 준비하지 못했습니다.' }, 503)
  const id = new URL(request.url).searchParams.get('id') || ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return noStoreReply({ error: '잘못된 알림입니다.' }, 400)
  try {
    const ref = db.collection('adminNotices').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return noStoreReply({ error: '알림을 찾을 수 없습니다.' }, 404)
    const data = snap.data()!
    const recipients = Array.isArray(data.recipients) ? data.recipients.filter((uid): uid is string => typeof uid === 'string') : []
    const FieldValue = getFieldValue()
    for (let start = 0; start < recipients.length; start += BATCH_SIZE) {
      const batch = db.batch()
      for (const uid of recipients.slice(start, start + BATCH_SIZE)) {
        batch.set(db.collection('noticeInbox').doc(uid), { items: FieldValue.arrayRemove(data.item) }, { merge: true })
      }
      await batch.commit()
    }
    await ref.update({ withdrawn: true, withdrawnAt: FieldValue.serverTimestamp() })
    return noStoreReply({ ok: true })
  } catch (error) {
    console.error('[admin-notices] withdraw failed', error instanceof Error ? error.name : 'Unknown')
    return noStoreReply({ error: '알림을 회수하지 못했습니다.' }, 503)
  }
}

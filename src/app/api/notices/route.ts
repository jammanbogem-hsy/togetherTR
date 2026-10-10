/**
 * POST /api/notices — a teacher marks an admin notice as read.
 * The notice leaves the teacher's inbox and the sender's log records who read it.
 */
import { getAdminDb, getFieldValue } from '@/lib/firebase/admin'
import { noStoreReply, verifyRequestUser } from '@/lib/admin/serverAuth'
import { inboxItems, removeFromInbox } from '@/lib/admin/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const identity = await verifyRequestUser(request)
  if (identity instanceof Response) return identity
  const db = getAdminDb()
  if (!db) return noStoreReply({ error: '알림 확인을 준비하지 못했습니다.' }, 503)
  const body = await request.json().catch(() => null) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return noStoreReply({ error: '잘못된 알림입니다.' }, 400)
  try {
    const inbox = db.collection('noticeInbox').doc(identity.uid)
    const log = db.collection('adminNotices').doc(id)
    await db.runTransaction(async tx => {
      const [inboxSnap, logSnap] = await Promise.all([tx.get(inbox), tx.get(log)])
      if (inboxSnap.exists) tx.set(inbox, { items: removeFromInbox(inboxItems(inboxSnap.data()), id), updatedAt: Date.now() }, { merge: true })
      const recipients = logSnap.exists ? logSnap.data()?.recipients : null
      if (Array.isArray(recipients) && recipients.includes(identity.uid)) {
        tx.update(log, { [`readBy.${identity.uid}`]: getFieldValue().serverTimestamp() })
      }
    })
    return noStoreReply({ ok: true })
  } catch (error) {
    console.error('[notices] mark read failed', error instanceof Error ? error.name : 'Unknown')
    return noStoreReply({ error: '알림을 확인 처리하지 못했습니다.' }, 503)
  }
}

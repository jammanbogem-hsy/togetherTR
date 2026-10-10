/**
 * GET /api/admin/dashboard — read-only overview of every room for the super admin.
 * Reads only small fields (statuses, timestamps); message/material counts use count() aggregation
 * and are limited to the most recently active rooms to keep each refresh cheap.
 */
import { getAdminAuth, getAdminDb, getFieldPath } from '@/lib/firebase/admin'
import { noStoreReply, verifySuperAdminRequest } from '@/lib/admin/serverAuth'
import { ALL_ACTIVITIES, dashboardProject, summarizeDashboard } from '@/lib/admin/dashboardModel'
import { STAGES } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const PROJECT_LIMIT = 500
/** Rooms (most recently active first) that also get message and material counts. */
const COUNTED_ROOMS = 30

const BASE_FIELDS = ['title', 'originalCreatedBy', 'createdBy', 'hostUid', 'schoolLevel', 'targetGradeGroup', 'teamGradeBands', 'targetSubjects',
  'currentStage', 'currentActivity', 'status', 'currentCycle', 'trainingMode', 'memberUids', 'memberInfo', 'createdAt', 'updatedAt', 'mode', 'started']

async function countUsers(): Promise<number | null> {
  const auth = getAdminAuth()
  if (!auth) return null
  let total = 0
  let pageToken: string | undefined
  do {
    const page = await auth.listUsers(1000, pageToken)
    total += page.users.length
    pageToken = page.pageToken
  } while (pageToken)
  return total
}

export async function GET(request: Request) {
  const identity = await verifySuperAdminRequest(request)
  if (identity instanceof Response) return identity
  const db = getAdminDb()
  if (!db) return noStoreReply({ error: '관리자 조회를 준비하지 못했습니다.' }, 503)
  const FieldPath = getFieldPath()
  const fields = [
    ...BASE_FIELDS.map(field => new FieldPath(field)),
    ...ALL_ACTIVITIES.flatMap(code => [new FieldPath('artifacts', code, 'status'), new FieldPath('artifacts', code, 'version')]),
    ...STAGES.map(stage => new FieldPath('stageReports', stage.code, 'savedAt')),
    new FieldPath('cumulativeReport', 'savedAt'),
  ]
  try {
    const now = Date.now()
    const [snap, members, messages] = await Promise.all([
      db.collection('projects').select(...fields).limit(PROJECT_LIMIT).get(),
      countUsers().catch(() => null),
      db.collectionGroup('messages').count().get().then(result => result.data().count).catch(() => null),
    ])
    const rows = snap.docs.map(doc => dashboardProject(doc.id, doc.data(), now))
    const recent = [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, COUNTED_ROOMS)
    await Promise.all(recent.map(async row => {
      const ref = db.collection('projects').doc(row.id)
      try {
        const conversations = await ref.collection('conversations').listDocuments()
        const counts = await Promise.all(conversations.map(conversation => conversation.collection('messages').count().get().then(result => result.data().count)))
        row.messageCount = counts.reduce((sum, count) => sum + count, 0)
        row.materialCount = (await ref.collection('materials').count().get()).data().count
      } catch { /* Counts are optional; the row still shows. */ }
    }))
    return noStoreReply({ ...summarizeDashboard(rows, now, { members, messages }), truncated: snap.size >= PROJECT_LIMIT })
  } catch (error) {
    console.error('[admin-dashboard] read failed', error instanceof Error ? error.name : 'Unknown')
    return noStoreReply({ error: '현황을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503)
  }
}

import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, projectSummary, projectDetail, memberSummary, textValue, timeValue, type AdminMessage } from '@/lib/admin/consoleModel'
import { ACTIVITY_META, type ActivityCode } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const PAGE_SIZE = 50
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } })
const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)
const PROJECT_FIELDS = ['title', 'originalCreatedBy', 'createdBy', 'hostUid', 'schoolLevel', 'targetGradeGroup', 'teamGradeBands', 'targetSubjects', 'currentStage', 'currentActivity', 'status', 'currentCycle', 'trainingMode', 'memberUids', 'memberInfo', 'createdAt', 'updatedAt']

// GET only. No membership, presence, project state, or profile writes in the admin viewer.
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return reply({ error: '로그인이 필요합니다.' }, 401)
  const auth = getAdminAuth()
  if (!auth) return reply({ error: '관리자 인증을 준비하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503)
  let identity
  try { identity = await auth.verifyIdToken(token, true) }
  catch { return reply({ error: '로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.' }, 401) }
  if (!isSuperAdmin(identity)) return reply({ error: '최고관리자만 볼 수 있습니다.' }, 403)
  const db = getAdminDb()
  if (!db) return reply({ error: '관리자 조회를 준비하지 못했습니다.' }, 503)
  const params = new URL(request.url).searchParams
  const view = params.get('view') || 'projects'
  const cursor = params.get('cursor') || ''
  try {
    if (view === 'projects') {
      if (cursor && !validId(cursor)) return reply({ error: '잘못된 목록 위치입니다.' }, 400)
      let query = db.collection('projects').orderBy('__name__').select(...PROJECT_FIELDS).limit(PAGE_SIZE + 1)
      if (cursor) query = query.startAfter(cursor)
      const [page, count] = await Promise.all([query.get(), cursor ? null : db.collection('projects').count().get()])
      const docs = page.docs.slice(0, PAGE_SIZE)
      const items = docs.map(doc => projectSummary(doc.id, doc.data()))
      // Owner profiles also resolve names when the original creator has left the team.
      const owners = [...new Set(items.filter(item => !item.ownerName && item.ownerUid).map(item => item.ownerUid))]
      if (owners.length) {
        const profiles = await db.getAll(...owners.map(uid => db.collection('users').doc(uid)))
        const names = new Map(profiles.map(profile => [profile.id, textValue(profile.data()?.displayName)]))
        items.forEach(item => { if (!item.ownerName) item.ownerName = names.get(item.ownerUid) || '이름 미등록' })
      }
      return reply({ items, nextCursor: page.docs.length > PAGE_SIZE ? docs.at(-1)!.id : null, ...(count ? { total: count.data().count } : {}) })
    }
    if (view === 'members') {
      if (cursor.length > 4096) return reply({ error: '잘못된 목록 위치입니다.' }, 400)
      const page = await auth.listUsers(PAGE_SIZE, cursor || undefined)
      const profiles = page.users.length ? await db.getAll(...page.users.map(user => db.collection('users').doc(user.uid))) : []
      const byId = new Map(profiles.filter(profile => profile.exists).map(profile => [profile.id, profile.data()]))
      return reply({ items: page.users.map(user => memberSummary(user, byId.get(user.uid))), nextCursor: page.pageToken || null })
    }
    const id = params.get('id') || ''
    if (!['project', 'messages'].includes(view) || !validId(id)) return reply({ error: '잘못된 프로젝트 요청입니다.' }, 400)
    const project = await db.collection('projects').doc(id).get()
    if (!project.exists) return reply({ error: '프로젝트를 찾을 수 없습니다.' }, 404)
    if (view === 'project') return reply(projectDetail(project.id, project.data()!))
    const activity = params.get('activity') as ActivityCode
    if (!Object.hasOwn(ACTIVITY_META, activity)) return reply({ error: '잘못된 활동입니다.' }, 400)
    const cycle = Number(params.get('cycle') || project.data()?.currentCycle || 1)
    if (!Number.isInteger(cycle) || cycle < 1 || cycle > (Number(project.data()?.currentCycle) || 1)) return reply({ error: '잘못된 주기입니다.' }, 400)
    let positions: { activity: string | null; legacy: string | null } = { activity: '', legacy: '' }
    if (cursor) {
      try {
        if (cursor.length > 1024) throw Error('cursor')
        positions = JSON.parse(cursor)
        for (const key of ['activity', 'legacy'] as const) if (positions[key] !== null && !(typeof positions[key] === 'string' && validId(positions[key]))) throw Error('cursor')
      } catch { return reply({ error: '잘못된 대화 위치입니다.' }, 400) }
    }
    const result = await Promise.all((['activity', 'legacy'] as const).map(async source => {
      if (positions[source] === null) return { items: [] as AdminMessage[], next: null }
      const path = source === 'activity' ? activity : ACTIVITY_META[activity].stage
      let query = project.ref.collection('conversations').doc(path).collection('messages').orderBy('__name__').limit(101)
      if (positions[source]) query = query.startAfter(positions[source])
      const page = await query.get()
      const docs = page.docs.slice(0, 100)
      const items = docs.flatMap(doc => {
        const data = doc.data()
        if ((source === 'legacy' && data.activityCode !== activity) || (data.cycleNumber ?? 1) !== cycle) return []
        if (!['user', 'assistant', 'system'].includes(data.role)) return []
        return [{ id: doc.id, role: data.role, name: textValue(data.displayName) || textValue(data.senderName), content: textValue(data.content), createdAt: timeValue(data.createdAt), legacy: source === 'legacy' }]
      })
      return { items, next: page.docs.length > 100 ? docs.at(-1)!.id : null }
    }))
    const next = { activity: result[0].next, legacy: result[1].next }
    return reply({ items: result.flatMap(page => page.items), nextCursor: next.activity || next.legacy ? JSON.stringify(next) : null })
  } catch (error) {
    console.error('[admin-console] Read failed', error instanceof Error ? error.name : 'Unknown error')
    return reply({ error: '목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503)
  }
}

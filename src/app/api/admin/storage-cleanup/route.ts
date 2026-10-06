import { getAdminAuth, getAdminBucket, getAdminDb, getFieldValue } from '@/lib/firebase/admin'
import { retryStorageCleanup } from '@/lib/account/storageCleanup'

export const runtime = 'nodejs'
export const maxDuration = 60

const json = (body: Record<string, unknown>, status: number) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
})

/** 관리자만 큐 한 건 재시도. 프로젝트 방장·클라이언트 users 문서의 role은 관리자 권한이 아니다. */
export async function POST(request: Request) {
  const auth = getAdminAuth()
  const db = getAdminDb()
  if (!auth || !db) return json({ error: 'admin-unavailable' }, 503)
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  let claims: { uid: string; admin?: boolean }
  try {
    if (!token) throw new Error('missing-token')
    claims = await auth.verifyIdToken(token, true)
  } catch {
    return json({ error: 'unauthenticated' }, 401)
  }
  if (claims.admin !== true) return json({ error: 'forbidden' }, 403)
  try {
    // 이미 발급된 토큰에 admin이 남아 있어도 현재 관리자 권한이 회수됐으면 차단한다.
    const user = await auth.getUser(claims.uid)
    if (user.disabled || user.customClaims?.admin !== true) return json({ error: 'forbidden' }, 403)
  } catch {
    return json({ error: 'unauthenticated' }, 401)
  }
  const body = await request.json().catch(() => null) as { queueId?: unknown } | null
  if (typeof body?.queueId !== 'string' || !/^[a-f0-9]{64}$/.test(body.queueId)) {
    return json({ error: 'invalid-queue-id' }, 400)
  }
  try {
    const status = await retryStorageCleanup(db, getFieldValue(), getAdminBucket(), body.queueId)
    const httpStatus = status === 'pending' ? 503 : status === 'project-exists' ? 409 : status === 'invalid-record' ? 422 : 200
    return json({ ok: status === 'deleted' || status === 'missing', status }, httpStatus)
  } catch {
    return json({ error: 'cleanup-retry-failed' }, 503)
  }
}

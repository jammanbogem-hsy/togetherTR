import { getAdminAuth } from '@/lib/firebase/admin'
import { isSuperAdmin } from './consoleModel'

export const noStoreReply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } })

/** Verify the bearer ID token. Returns the decoded identity or an error response to send back. */
export async function verifyRequestUser(request: Request): Promise<{ uid: string; email?: string; email_verified?: boolean; name?: string } | Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return noStoreReply({ error: '로그인이 필요합니다.' }, 401)
  const auth = getAdminAuth()
  if (!auth) return noStoreReply({ error: '인증을 준비하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503)
  try { return await auth.verifyIdToken(token, true) }
  catch { return noStoreReply({ error: '로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.' }, 401) }
}

/** Same as verifyRequestUser, but only the verified super admin passes. */
export async function verifySuperAdminRequest(request: Request) {
  const identity = await verifyRequestUser(request)
  if (identity instanceof Response) return identity
  if (!isSuperAdmin(identity)) return noStoreReply({ error: '최고관리자만 사용할 수 있습니다.' }, 403)
  return identity
}

// 사용자 피드백(오류 신고) — 저장은 firebase-admin(규칙 변경 없음), 메일은 RESEND_API_KEY 가 있을 때만.
// POST: 로그인 사용자 보내기 · GET: 관리자 목록(?id= 이면 그 건의 캡처 포함) · PATCH: 관리자 처리 상태 변경
import { getAdminAuth, getAdminDb, getFieldValue } from '@/lib/firebase/admin'
import { buildFeedbackEmail, isFeedbackAdmin, nextRateWindow, parseAdminEmails, validateFeedbackInput, type FeedbackStatus } from '@/lib/feedback/feedbackModel'

export const runtime = 'nodejs'
export const maxDuration = 30

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function authenticate(request: Request) {
  const auth = getAdminAuth()
  if (!auth) return { error: json({ error: '서버 설정 문제로 지금은 피드백을 받을 수 없어요.' }, 503) }
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { error: json({ error: '로그인이 필요해요.' }, 401) }
  try {
    return { decoded: await auth.verifyIdToken(token) }
  } catch {
    return { error: json({ error: '로그인 정보를 확인하지 못했어요. 새로고침 뒤 다시 보내 주세요.' }, 401) }
  }
}

async function sendEmail(input: Parameters<typeof buildFeedbackEmail>[0], admins: string[]): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, error: 'RESEND_API_KEY 없음' }
  const mail = buildFeedbackEmail(input)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.FEEDBACK_EMAIL_FROM || 'T-CID 피드백 <onboarding@resend.dev>',
      to: admins,
      ...(input.senderEmail ? { reply_to: input.senderEmail } : {}),
      subject: mail.subject, text: mail.text, html: mail.html,
      attachments: input.images.map((dataUrl, index) => ({
        filename: `capture-${index + 1}.${dataUrl.startsWith('data:image/png') ? 'png' : dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg'}`,
        content: dataUrl.split(',')[1],
      })),
    }),
  }).catch(error => ({ ok: false, status: 0, text: async () => String(error) }) as unknown as Response)
  if (response.ok) return { sent: true }
  return { sent: false, error: `메일 발송 실패(${response.status}): ${(await response.text()).slice(0, 200)}` }
}

export async function POST(request: Request) {
  const authResult = await authenticate(request)
  if ('error' in authResult) return authResult.error
  const { decoded } = authResult
  const db = getAdminDb()!
  const checked = validateFeedbackInput(await request.json().catch(() => null))
  if (!checked.ok) return json({ error: checked.error }, 400)
  const now = Date.now()
  const rateRef = db.collection('feedbackRate').doc(decoded.uid)
  const allowed = await db.runTransaction(async transaction => {
    const snap = await transaction.get(rateRef)
    const next = nextRateWindow(snap.exists ? snap.data() as { windowStart?: number; count?: number } : null, now)
    if (next.allowed) transaction.set(rateRef, { windowStart: next.windowStart, count: next.count })
    return next.allowed
  })
  if (!allowed) return json({ error: '1시간에 보낼 수 있는 피드백 수를 넘었어요. 잠시 뒤 다시 보내 주세요.' }, 429)

  const FieldValue = getFieldValue()
  const { message, images, context, recentErrors } = checked.value
  const ref = db.collection('feedback').doc()
  const senderName = decoded.name
  const senderEmail = decoded.email
  const batch = db.batch()
  batch.set(ref, {
    uid: decoded.uid, senderName: senderName ?? null, senderEmail: senderEmail ?? null,
    message, context, recentErrors, imageCount: images.length,
    status: 'new' satisfies FeedbackStatus, createdAt: FieldValue.serverTimestamp(), createdAtMs: now,
  })
  // 캡처는 한 장씩 하위 문서로(문서 1MB 한도 안)
  images.forEach((dataUrl, index) => batch.set(ref.collection('images').doc(String(index)), { dataUrl, index }))
  try { await batch.commit() }
  catch { return json({ error: '피드백을 저장하지 못했어요. 입력 내용은 유지되니 다시 보내 주세요.' }, 503) }

  const admins = parseAdminEmails(process.env.FEEDBACK_ADMIN_EMAILS)
  const mail = await sendEmail({ ...checked.value, id: ref.id, senderName, senderEmail, appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin }, admins).catch(() => ({ sent: false, error: '메일 발송 실패' }))
  // The submission is already durable; an email receipt failure must not ask users to send it again.
  await ref.update({ emailed: mail.sent, ...(mail.error ? { emailError: mail.error } : {}) }).catch(error => console.error('Feedback email receipt update failed', error))
  return json({ id: ref.id, emailed: mail.sent })
}

async function requireAdmin(request: Request) {
  const authResult = await authenticate(request)
  if ('error' in authResult) return authResult
  if (!isFeedbackAdmin(authResult.decoded, parseAdminEmails(process.env.FEEDBACK_ADMIN_EMAILS))) return { error: json({ error: '관리자만 볼 수 있어요.' }, 403) }
  return authResult
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request)
  if ('error' in admin) return admin.error
  const db = getAdminDb()!
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return json({ error: '잘못된 피드백 번호예요.' }, 400)
    const ref = db.collection('feedback').doc(id)
    const [snap, images] = await Promise.all([ref.get(), ref.collection('images').orderBy('index').get()])
    if (!snap.exists) return json({ error: '피드백을 찾지 못했어요.' }, 404)
    return json({ id, ...snap.data(), images: images.docs.map(doc => (doc.data() as { dataUrl: string }).dataUrl) })
  }
  const cursor = new URL(request.url).searchParams.get('cursor')
  let query = db.collection('feedback').orderBy('createdAtMs', 'desc')
  if (cursor) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) return json({ error: '잘못된 요청이에요.' }, 400)
    const snapshot = await db.collection('feedback').doc(cursor).get()
    if (!snapshot.exists) return json({ error: '목록을 새로고침해 주세요.' }, 400)
    query = query.startAfter(snapshot)
  }
  const list = await query.limit(51).get()
  const page = list.docs.slice(0, 50)
  return json({ items: page.map(doc => ({ id: doc.id, ...doc.data() })), nextCursor: list.docs.length > 50 ? page.at(-1)!.id : null })
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin(request)
  if ('error' in admin) return admin.error
  const body = await request.json().catch(() => null) as { id?: string; status?: FeedbackStatus } | null
  if (!body?.id || !/^[A-Za-z0-9_-]{1,128}$/.test(body.id) || !['new', 'in_progress', 'done'].includes(body.status ?? '')) return json({ error: '잘못된 요청이에요.' }, 400)
  await getAdminDb()!.collection('feedback').doc(body.id).update({ status: body.status, updatedAtMs: Date.now() })
  return json({ ok: true })
}

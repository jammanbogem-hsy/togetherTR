// 사용자 피드백(오류 신고) — 화면 오른쪽 아래 버튼으로 글·오류 화면 캡처·현재 위치·최근 오류 기록을 보낸다.
// 서버(/api/feedback)가 firebase-admin 으로 저장하고, 메일 키가 있으면 관리자에게 메일을 보낸다.
// 규칙 배포 없이 동작하도록 클라이언트는 Firestore 에 직접 쓰지 않는다.

export const FEEDBACK_LIMITS = {
  messageMax: 4000,
  imagesMax: 3,
  /** 클라이언트가 압축한 뒤의 data URL 길이 상한(약 600KB) — Firestore 문서 1MB 한도 안 */
  imageDataUrlMax: 800_000,
  errorsMax: 10,
  errorLineMax: 500,
  perHour: 10,
} as const

export const FEEDBACK_ADMIN_EMAILS_DEFAULT = ['jammanbogem@gmail.com']

export type FeedbackStatus = 'new' | 'in_progress' | 'done'

export interface FeedbackContext {
  path: string
  projectId?: string
  projectTitle?: string
  activityCode?: string
  activityLabel?: string
}

export interface FeedbackInput {
  message: string
  images: string[]          // data:image/jpeg;base64,... (압축본)
  context: FeedbackContext
  recentErrors: string[]
}

export type FeedbackValidation = { ok: true; value: FeedbackInput } | { ok: false; error: string }

const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''

/** 서버에서 받은 본문을 검사·정리한다. 글이나 캡처 중 하나는 있어야 한다. */
export function validateFeedbackInput(raw: unknown): FeedbackValidation {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const message = str(body.message, FEEDBACK_LIMITS.messageMax).trim()
  const images = Array.isArray(body.images) ? body.images.filter((item): item is string => typeof item === 'string') : []
  if (images.length > FEEDBACK_LIMITS.imagesMax) return { ok: false, error: `캡처는 ${FEEDBACK_LIMITS.imagesMax}장까지 보낼 수 있어요.` }
  for (const image of images) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return { ok: false, error: '이미지 형식을 읽지 못했어요.' }
    if (image.length > FEEDBACK_LIMITS.imageDataUrlMax) return { ok: false, error: '캡처 용량이 너무 커요. 화면 일부만 잘라 붙여 주세요.' }
  }
  if (!message && images.length === 0) return { ok: false, error: '내용을 적거나 오류 화면을 붙여 넣어 주세요.' }
  const ctx = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>
  const context: FeedbackContext = {
    path: str(ctx.path, 300) || '/',
    ...(str(ctx.projectId, 100) ? { projectId: str(ctx.projectId, 100) } : {}),
    ...(str(ctx.projectTitle, 200) ? { projectTitle: str(ctx.projectTitle, 200) } : {}),
    ...(str(ctx.activityCode, 20) ? { activityCode: str(ctx.activityCode, 20) } : {}),
    ...(str(ctx.activityLabel, 100) ? { activityLabel: str(ctx.activityLabel, 100) } : {}),
  }
  const recentErrors = (Array.isArray(body.recentErrors) ? body.recentErrors : [])
    .filter((line): line is string => typeof line === 'string')
    .slice(-FEEDBACK_LIMITS.errorsMax)
    .map(line => line.slice(0, FEEDBACK_LIMITS.errorLineMax))
  return { ok: true, value: { message, images, context, recentErrors } }
}

/** 관리자 판정 — 이메일 인증된 계정이 관리자 목록에 있을 때만. */
export function isFeedbackAdmin(token: { email?: string; email_verified?: boolean } | null | undefined, adminEmails: readonly string[]): boolean {
  const email = token?.email?.trim().toLowerCase()
  return !!email && token?.email_verified === true && adminEmails.map(item => item.trim().toLowerCase()).includes(email)
}

export function parseAdminEmails(value: string | undefined): string[] {
  const list = (value ?? '').split(',').map(item => item.trim()).filter(Boolean)
  return list.length ? list : [...FEEDBACK_ADMIN_EMAILS_DEFAULT]
}

/** 1시간 창 안에서 사용자별 보내기 횟수 — 다음 상태와 허용 여부 */
export function nextRateWindow(current: { windowStart?: number; count?: number } | null | undefined, now: number): { allowed: boolean; windowStart: number; count: number } {
  const fresh = !current?.windowStart || now - current.windowStart >= 60 * 60 * 1000
  const windowStart = fresh ? now : current!.windowStart!
  const count = (fresh ? 0 : current?.count ?? 0) + 1
  return { allowed: count <= FEEDBACK_LIMITS.perHour, windowStart, count }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

/** 관리자 메일 — 제목·본문(텍스트/HTML). 캡처는 첨부로 따로 붙인다. */
export function buildFeedbackEmail(input: FeedbackInput & { id: string; senderName?: string; senderEmail?: string; appUrl?: string }): { subject: string; text: string; html: string } {
  const where = [input.context.projectTitle, input.context.activityCode && `${input.context.activityCode}${input.context.activityLabel ? ` ${input.context.activityLabel}` : ''}`].filter(Boolean).join(' · ')
  const subject = `[T-CID 피드백] ${input.message.split('\n')[0].slice(0, 40) || '오류 화면 캡처'}${where ? ` — ${where}` : ''}`
  const lines = [
    `보낸 사람: ${input.senderName ?? '이름 없음'}${input.senderEmail ? ` <${input.senderEmail}>` : ''}`,
    `화면: ${input.context.path}${where ? ` (${where})` : ''}`,
    `캡처: ${input.images.length}장`,
    '',
    input.message || '(글 없음 — 캡처만 보냄)',
    '',
    input.recentErrors.length ? `최근 오류 기록:\n${input.recentErrors.map(line => `- ${line}`).join('\n')}` : '최근 오류 기록: 없음',
    '',
    `피드백 번호: ${input.id}${input.appUrl ? `\n피드백함: ${input.appUrl.replace(/\/$/, '')}/feedback` : ''}`,
  ]
  const text = lines.join('\n')
  const html = `<div style="font-family:Arial,'Apple SD Gothic Neo',sans-serif;font-size:14px;line-height:1.6;color:#1F1F1F">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
  return { subject, text, html }
}

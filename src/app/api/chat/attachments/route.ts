/**
 * POST /api/chat/attachments — read a chat attachment once so the AI can use it as context.
 * Only project members may call it, and only for files they uploaded into that project's chat folder.
 */
import OpenAI from 'openai'
import { getAdminBucket, getAdminDb } from '@/lib/firebase/admin'
import { noStoreReply, verifyRequestUser } from '@/lib/admin/serverAuth'
import { ATTACHMENT_MAX_BYTES, IMAGE_READ_PROMPT, attachmentType, clipExtract, isOwnAttachmentPath } from '@/lib/chat/attachments'
import { extractPdfPagesFromBuffer } from '@/lib/rag/pdfExtract'
import { logLlmUsage } from '@/lib/llm/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Hosting cuts requests at 60s; keep the vision call well inside it. */
const VISION_TIMEOUT_MS = 40_000
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: VISION_TIMEOUT_MS, maxRetries: 0 }) : null

export async function POST(request: Request) {
  const identity = await verifyRequestUser(request)
  if (identity instanceof Response) return identity
  const body = await request.json().catch(() => null) as { projectId?: unknown; path?: unknown; name?: unknown; contentType?: unknown } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const path = typeof body?.path === 'string' ? body.path : ''
  const name = typeof body?.name === 'string' ? body.name : ''
  const type = attachmentType(name, typeof body?.contentType === 'string' ? body.contentType : '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !isOwnAttachmentPath(path, projectId, identity.uid) || !type) {
    return noStoreReply({ error: '읽을 수 없는 첨부 파일입니다.' }, 400)
  }
  const db = getAdminDb()
  const bucket = getAdminBucket()
  if (!db || !bucket) return noStoreReply({ error: '첨부 파일 읽기를 준비하지 못했습니다.' }, 503)
  try {
    const project = await db.collection('projects').doc(projectId).get()
    const data = project.data() ?? {}
    const members: unknown[] = Array.isArray(data.memberUids) ? data.memberUids : []
    if (!project.exists || !(members.includes(identity.uid) || data.createdBy === identity.uid || data.hostUid === identity.uid)) {
      return noStoreReply({ error: '이 프로젝트의 팀원만 첨부 파일을 읽을 수 있습니다.' }, 403)
    }
    const file = bucket.file(path)
    const [metadata] = await file.getMetadata()
    if (Number(metadata.size) > ATTACHMENT_MAX_BYTES) return noStoreReply({ error: '파일이 너무 큽니다.' }, 413)
    const [buffer] = await file.download() as [Buffer]

    let text = ''
    if (type.kind === 'text') {
      text = buffer.toString('utf8')
    } else if (type.kind === 'pdf') {
      const pages = await extractPdfPagesFromBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
      text = pages.map(page => page.text).join('\n\n')
    } else {
      if (!client) return noStoreReply({ text: '', reason: 'no-model' })
      const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o'
      const startedAt = performance.now()
      const completion = await client.chat.completions.create({
        model,
        max_tokens: 1800,
        messages: [{ role: 'user', content: [
          { type: 'text', text: IMAGE_READ_PROMPT },
          { type: 'image_url', image_url: { url: `data:${type.contentType};base64,${buffer.toString('base64')}`, detail: 'high' } },
        ] }],
      })
      logLlmUsage('chat-attachment', model, completion.usage, Math.round(performance.now() - startedAt), { kind: 'image' })
      text = completion.choices[0]?.message?.content ?? ''
    }
    return noStoreReply({ text: clipExtract(text) })
  } catch (error) {
    console.error('[chat-attachments] read failed', error instanceof Error ? error.name : 'Unknown')
    // The file stays attached; the AI is told it could not read it.
    return noStoreReply({ text: '', reason: 'read-failed' })
  }
}

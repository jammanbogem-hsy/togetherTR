/**
 * POST /api/admin/vision-compare — super admin only. Reads one photo or PDF with several models
 * at once so the attachment reader (OPENAI_VISION_MODEL) can be chosen on real teacher material.
 * Nothing is stored; teachers' screens are not affected.
 */
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { noStoreReply, verifySuperAdminRequest } from '@/lib/admin/serverAuth'
import { IMAGE_READ_PROMPT } from '@/lib/chat/attachments'
import { generationParams, logLlmUsage } from '@/lib/llm/openai'
import { claudeJsonParams } from '@/lib/llm/anthropic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Every model runs in parallel; each must finish inside Hosting's 60s request limit. */
const MODEL_TIMEOUT_MS = 50_000
const MAX_BYTES = 8 * 1024 * 1024
export const VISION_CANDIDATES = ['gpt-4o', 'gpt-5.6-luna', 'gpt-6-luna', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'] as const
const PDF_PROMPT = IMAGE_READ_PROMPT.replace('교사 협의 중에 찍은 사진입니다(회의 메모, 칠판·화이트보드, 종이 산출물, 화면 캡처 등).', '교사 협의 자료 PDF입니다. 스캔한 쪽도 있을 수 있습니다.')

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: MODEL_TIMEOUT_MS, maxRetries: 0 }) : null
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: MODEL_TIMEOUT_MS, maxRetries: 0 }) : null

type Result = { model: string; ms: number; text: string; inputTokens: number | null; outputTokens: number | null; error?: string }

async function readWith(model: string, kind: 'image' | 'pdf', contentType: string, base64: string, fileName: string): Promise<Result> {
  const startedAt = performance.now()
  const prompt = kind === 'pdf' ? PDF_PROMPT : IMAGE_READ_PROMPT
  try {
    if (model.startsWith('claude-')) {
      if (!anthropic) throw Error('ANTHROPIC_API_KEY 없음')
      const media = kind === 'pdf'
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: contentType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: base64 } }
      const response = await anthropic.messages.create({ ...claudeJsonParams(model, 2000), messages: [{ role: 'user', content: [media, { type: 'text', text: prompt }] }] })
      const text = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      return { model, ms: Math.round(performance.now() - startedAt), text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    }
    if (!openai) throw Error('OPENAI_API_KEY 없음')
    const part = kind === 'pdf'
      ? { type: 'file', file: { filename: fileName, file_data: `data:application/pdf;base64,${base64}` } }
      : { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}`, detail: 'high' } }
    const completion = await openai.chat.completions.create({
      ...generationParams(model, { maxTokens: 4000, effort: 'light' }),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, part] }],
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
    const ms = Math.round(performance.now() - startedAt)
    logLlmUsage('vision-compare', model, completion.usage, ms, { kind })
    return { model, ms, text: completion.choices[0]?.message?.content ?? '', inputTokens: completion.usage?.prompt_tokens ?? null, outputTokens: completion.usage?.completion_tokens ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { model, ms: Math.round(performance.now() - startedAt), text: '', inputTokens: null, outputTokens: null, error: message.slice(0, 300) }
  }
}

export async function POST(request: Request) {
  const identity = await verifySuperAdminRequest(request)
  if (identity instanceof Response) return identity
  const body = await request.json().catch(() => null) as { fileName?: unknown; contentType?: unknown; data?: unknown; models?: unknown } | null
  const contentType = typeof body?.contentType === 'string' ? body.contentType : ''
  const data = typeof body?.data === 'string' ? body.data : ''
  const fileName = typeof body?.fileName === 'string' ? body.fileName.slice(0, 120) : 'file'
  const kind = contentType === 'application/pdf' ? 'pdf' : /^image\/(png|jpeg|webp|gif)$/.test(contentType) ? 'image' : null
  if (!kind || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) return noStoreReply({ error: '사진(PNG·JPG·WEBP·GIF)이나 PDF를 골라 주세요.' }, 400)
  if (data.length * 0.75 > MAX_BYTES) return noStoreReply({ error: '파일이 8MB보다 큽니다.' }, 413)
  const requested = Array.isArray(body?.models) ? body!.models.filter((m): m is string => typeof m === 'string') : []
  const models = (requested.length ? VISION_CANDIDATES.filter(model => requested.includes(model)) : [...VISION_CANDIDATES])
  if (!models.length) return noStoreReply({ error: '비교할 모델을 골라 주세요.' }, 400)
  const results = await Promise.all(models.map(model => readWith(model, kind, contentType, data, fileName)))
  return noStoreReply({ kind, current: process.env.OPENAI_VISION_MODEL || 'gpt-4o', results })
}

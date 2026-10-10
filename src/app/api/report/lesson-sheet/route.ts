/**
 * POST /api/report/lesson-sheet — 시험판 '수업 실행 나눔 기록지'를 스트리밍으로 만든다.
 * 단계 보고서(/api/analyze/stage)와 같은 SSE 형식이라 화면은 같은 읽기 코드를 쓴다.
 */
import OpenAI from 'openai'
import { generationParams, logLlmUsage, resolveOpenAIModel } from '@/lib/llm/openai'
import { buildLessonSheetPrompt, type LessonSheetInput } from '@/lib/report/lessonSheetPrompt'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  let input: LessonSheetInput
  try {
    const body = await request.json() as Partial<LessonSheetInput>
    if (!body?.project?.title || !body.artifacts || typeof body.artifacts !== 'object') throw Error('invalid')
    input = { project: body.project, members: Array.isArray(body.members) ? body.members.slice(0, 20) : [], artifacts: body.artifacts }
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  const prompt = buildLessonSheetPrompt(input)
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      try {
        const model = resolveOpenAIModel('utility')
        const startedAt = performance.now()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await client.chat.completions.create({
          ...generationParams(model, { maxTokens: 6000, effort: 'light', stream: true }),
          messages: [{ role: 'user', content: prompt }],
        } as never)
        let usage: unknown = null
        for await (const chunk of response) {
          const text = chunk.choices?.[0]?.delta?.content ?? ''
          if (text) send({ type: 'text', text })
          if (chunk.choices?.[0]?.finish_reason) send({ type: 'done' })
          if (chunk.usage) usage = chunk.usage
        }
        logLlmUsage('report/lesson-sheet', model, usage as never, performance.now() - startedAt)
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}

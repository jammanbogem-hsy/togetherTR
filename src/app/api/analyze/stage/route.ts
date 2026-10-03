import OpenAI from 'openai'
import { generationParams, logLlmUsage, resolveOpenAIModel } from '@/lib/llm/openai'
import type { StageCode } from '@/types'
import { buildAnalysisPrompt, buildArtifactAppendix, buildArtifactOriginals } from '@/lib/report/stageReportPrompt'
import { createArtifactPlaceholderExpander } from '@/lib/report/artifactPlaceholders'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  try {
    const { stage, project, artifacts } = await request.json() as {
      stage: StageCode
      project: { title: string; targetGradeGroup: string; targetSubjects?: string[] }
      artifacts: Record<string, { title: string; content: Record<string, unknown> }>
    }

    const prompt = buildAnalysisPrompt(stage, project, artifacts)
    // AI 는 산출물 원문 자리에 {{ARTIFACT:코드}} 만 쓴다 — 내보내기 직전에 원문으로 바꾼다.
    const expander = createArtifactPlaceholderExpander(buildArtifactOriginals(stage, artifacts))
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const model = resolveOpenAIModel('utility')
          const startedAt = performance.now()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response: any = await client.chat.completions.create({
            ...generationParams(model, { maxTokens: 8000, effort: 'light', stream: true }),
            messages: [{ role: 'user', content: prompt }],
          } as never)

          let usage: unknown = null
          const sendText = (text: string) => {
            if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`))
          }
          // 산출물 원문은 본문 뒤 '부록' 섹션으로 서버가 붙인다(한 번만).
          let appendixSent = false
          const sendAppendix = () => {
            if (appendixSent) return
            appendixSent = true
            sendText(expander.push(buildArtifactAppendix(stage)) + expander.flush())
          }
          for await (const chunk of response) {
            sendText(expander.push(chunk.choices?.[0]?.delta?.content ?? ''))
            // 'length'(출력 한도) 등으로 끝나도 done 을 보내 UI 가 멈추지 않게 한다
            if (chunk.choices?.[0]?.finish_reason) {
              sendText(expander.flush())
              sendAppendix()
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            }
            if (chunk.usage) usage = chunk.usage
          }
          // 종료 사유 없이 끝난 스트림도 남은 글자를 내보낸다(이미 내보냈으면 빈 문자열).
          sendText(expander.flush())
          sendAppendix()
          logLlmUsage('analyze/stage', model, usage as never, performance.now() - startedAt)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
}

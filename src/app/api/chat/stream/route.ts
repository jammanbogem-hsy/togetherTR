import OpenAI from 'openai'
import { buildSystemPrompt } from '@/lib/prompts/system'
import type { StageCode, ActivityCode, ActorType, Project } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      messages,
      stage,
      activityCode,
      actorType,
      project,
      learnerProfileSummary,
      currentArtifact,
      confirmedArtifacts,
      teamMembers,
      activityStatus,
    }: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      stage: StageCode
      activityCode: ActivityCode
      actorType: ActorType
      project: Pick<Project, 'title' | 'targetGradeGroup' | 'targetSubjects' | 'mode' | 'isA23Completed' | 'currentCycle'>
      learnerProfileSummary?: string
      currentArtifact?: { title: string; content: Record<string, unknown>; status: string; version: number } | null
      confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>
      teamMembers?: string
      activityStatus?: string
    } = body

    const systemPrompt = buildSystemPrompt(
      stage,
      activityCode,
      project,
      actorType,
      learnerProfileSummary,
      currentArtifact ?? null,
      teamMembers,
      confirmedArtifacts,
      activityStatus
    )

    // SSE 스트리밍
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 2048,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
            stream: true,
          })

          for await (const chunk of response) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) {
              const data = JSON.stringify({ type: 'text', text })
              controller.enqueue(encoder.encode(`data: ${data}\n\n`))
            }
            if (chunk.choices[0]?.finish_reason === 'stop') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`)
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
}

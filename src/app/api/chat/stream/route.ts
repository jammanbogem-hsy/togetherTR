import OpenAI from 'openai'
import { buildSystemPrompt } from '@/lib/prompts/system'
import { buildCurriculumContext } from '@/lib/curriculum/contextInject'
import { buildProjectMaterialContext, searchProjectMaterials } from '@/lib/rag/search'
import type { StageCode, ActivityCode, ActorType, Project } from '@/types'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      messages,
      projectId,
      stage,
      activityCode,
      actorType,
      project,
      learnerProfileSummary,
      currentArtifact,
      confirmedArtifacts,
      teamMembers,
      activityStatus,
      graphSavedData,
    }: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      projectId?: string
      stage: StageCode
      activityCode: ActivityCode
      actorType: ActorType
      project: Pick<Project, 'title' | 'targetGradeGroup' | 'targetSubjects' | 'mode' | 'isA23Completed' | 'currentCycle' | 'previousCycleImprovements'>
      learnerProfileSummary?: string
      currentArtifact?: { title: string; content: Record<string, unknown>; status: string; version: number } | null
      confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>
      teamMembers?: string
      activityStatus?: string
      graphSavedData?: GraphSavedData | null
    } = body

    const baseSystemPrompt = buildSystemPrompt(
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

    // A단계 / Ds단계: 교육과정 온톨로지 컨텍스트 주입
    const curriculumContext = buildCurriculumContext(
      activityCode,
      messages,
      project.targetGradeGroup,
      confirmedArtifacts,
      graphSavedData,
    )
    let materialContext = ''
    if (projectId) {
      try {
        const materialHits = await searchProjectMaterials({
          projectId,
          activityCode,
          messages,
          currentArtifact: currentArtifact ?? null,
          confirmedArtifacts,
          graphSavedData,
        })
        materialContext = buildProjectMaterialContext(materialHits)
      } catch (error) {
        console.error('[stream] material search failed:', error)
      }
    }
    const systemPrompt = baseSystemPrompt + curriculumContext + materialContext

    // SSE 스트리밍
    const encoder = new TextEncoder()
    const KEEP_ALIVE_INTERVAL = 15_000 // 15초마다 ping
    const stream = new ReadableStream({
      async start(controller) {
        // keep-alive: OpenAI 응답이 느릴 때 프록시/CDN이 연결을 끊지 않도록 주기적으로 빈 comment 전송
        const keepAliveTimer = setInterval(() => {
          try { controller.enqueue(encoder.encode(': ping\n\n')) } catch { /* 이미 닫힌 경우 무시 */ }
        }, KEEP_ALIVE_INTERVAL)

        try {
          const response = await client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 8192,
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
            const finishReason = chunk.choices[0]?.finish_reason
            if (finishReason) {
              // 'stop' 뿐 아니라 'length' (max_tokens 초과) 등도 완료 처리
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`)
          )
        } finally {
          clearInterval(keepAliveTimer)
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
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stream] route error:', err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

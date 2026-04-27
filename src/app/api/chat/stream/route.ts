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
      keyNotes,
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
      keyNotes?: Array<{ content: string; sourceActivityCode?: string; sourceRole?: string; sourceDisplayName?: string; savedAt: number }>
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
      project.targetSubjects,
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
    // 중요 노트(KeyNotes) 주입 — 팀이 채팅 중 "중요"로 저장한 메시지 스냅샷.
    // 활동 경계를 넘어 프로젝트 전반의 비공식 합의·관심사를 AI에게 전달.
    //
    // 전략:
    //  - 각 노트에 안정적 번호(#N, savedAt ASC) 부여 → 사용자가 `@노트#N`으로 참조 가능
    //  - 최신 턴의 user 메시지에서 참조된 노트는 **전문**(표·개행 보존) 포함
    //  - 참조되지 않은 나머지 노트는 요약(앞 500자)만 포함해 프롬프트 비대화 방지
    const keyNotesContext = (() => {
      if (!keyNotes || keyNotes.length === 0) return ''
      const sorted = keyNotes.slice().sort((a, b) => a.savedAt - b.savedAt)
      const numbered = sorted.map((n, i) => ({ ...n, number: i + 1 }))

      // 최근 user 메시지들에서 `@노트#N` 패턴 추출 → 해당 번호는 전문 포함
      const recentUserText = messages.filter(m => m.role === 'user').slice(-3).map(m => m.content).join('\n')
      const referencedNumbers = new Set<number>()
      for (const m of recentUserText.matchAll(/@노트\s*#\s*(\d+)/g)) {
        referencedNumbers.add(parseInt(m[1], 10))
      }

      const recent = numbered.slice(-25) // 최근 25개 풀
      const sections = recent.map(n => {
        const where = n.sourceActivityCode ? `[${n.sourceActivityCode}]` : '[메모]'
        const who = n.sourceRole === 'assistant' ? 'AI' : (n.sourceDisplayName || '팀원')
        const isReferenced = referencedNumbers.has(n.number)
        const content = isReferenced ? n.content.trim() : n.content.trim().slice(0, 500)
        const trailing = !isReferenced && n.content.length > 500 ? '\n  ... (이하 생략)' : ''
        // 내용이 여러 줄인 경우 들여쓰기로 가독성 확보 — AI가 표 구조 인식 가능
        const indented = content.split('\n').map(line => `  ${line}`).join('\n')
        return `### @노트#${n.number} ${where} ${who} ${isReferenced ? '🔗(이 메시지에서 참조됨)' : ''}
${indented}${trailing}`
      })

      return `

## 팀 중요 노트 (포스트잇)

팀이 이전 대화 중 "중요"로 저장해둔 발언·산출물 초안들입니다.
사용자가 **@노트#N** 으로 참조하면 그 노트 내용을 **반드시 읽고 반영**한 뒤 답하세요. 참조된 노트는 🔗 표시가 붙어 있으며 전문이 포함됩니다.
표(|로 시작하는 행)가 있으면 표 구조 그대로 읽고 답변에 인용·활용할 것. 같은 제안 반복 금지.

${sections.join('\n\n')}
`
    })()

    const systemPrompt = baseSystemPrompt + curriculumContext + materialContext + keyNotesContext

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

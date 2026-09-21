import OpenAI from 'openai'
import { buildSystemPrompt } from '@/lib/prompts/system'
import { generationParams, logLlmUsage, resolveOpenAIModel, chatEffort } from '@/lib/llm/openai'
import { judgeProgress } from '@/lib/chat/progressJudge'
import { buildCurriculumContext } from '@/lib/curriculum/contextInject'
import { buildA21DirectAnswer } from '@/lib/curriculum/a21DirectAnswer'
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
      project: Pick<Project, 'title' | 'schoolLevel' | 'targetGradeGroup' | 'targetSubjects' | 'mode' | 'isA23Completed' | 'currentCycle' | 'previousCycleImprovements'> & Pick<Partial<Project>, 'teamGradeBands' | 'curriculumSheet'>
      learnerProfileSummary?: string
      currentArtifact?: { title: string; content: Record<string, unknown>; status: string; version: number } | null
      confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown>; status?: string }>
      teamMembers?: string
      activityStatus?: string
      graphSavedData?: GraphSavedData | null
      keyNotes?: Array<{ content: string; sourceActivityCode?: string; sourceRole?: string; sourceDisplayName?: string; savedAt: number }>
    } = body

    const directA21Answer = buildA21DirectAnswer({
      activityCode,
      messages,
      gradeGroup: project.targetGradeGroup,
      // 여러 학년군 팀(1·3·5학년 담임 등)은 학년군별로 성취기준을 나눠 답한다.
      teamGradeBands: project.teamGradeBands,
      sheetRows: project.curriculumSheet,
      targetSubjects: project.targetSubjects,
      confirmedArtifacts,
      graphSavedData,
    })
    if (directA21Answer) {
      return streamPlainText(directA21Answer)
    }

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
      project.teamGradeBands,
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
      // buildApiMessages가 마지막 user 앞에 끼워넣는 합성 '[시스템 리마인더]' user 메시지는
      // 참조 윈도우(slice -3) 한 칸을 잠식하므로 제외해 실효 lookback을 보존한다.
      const recentUserText = messages
        .filter(m => m.role === 'user' && !m.content.startsWith('[시스템 리마인더]'))
        .slice(-3).map(m => m.content).join('\n')
      const referencedNumbers = new Set<number>()
      for (const m of recentUserText.matchAll(/@노트\s*#\s*(\d+)/g)) {
        referencedNumbers.add(parseInt(m[1], 10))
      }

      // 참조된 노트는 최근 25개 윈도우 밖(오래된 낮은 번호)이어도 항상 포함한다.
      // (사용자가 @노트#N으로 명시 참조했는데 slice(-25)에 밀려 전문이 통째 누락되던 버그 차단)
      const referenced = numbered.filter(n => referencedNumbers.has(n.number))
      const recent = [...new Map([...referenced, ...numbered.slice(-25)].map(n => [n.number, n])).values()]
        .sort((a, b) => a.number - b.number)
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
          // 채팅 모델은 env(OPENAI_CHAT_MODEL)로 토글 — 미설정 시 gpt-4o(기존 동작 유지).
          // [2026-09-20] 모델 계열별 파라미터는 lib/llm/openai 가 만든다: gpt-5-mini 는 reasoning 'minimal',
          // gpt-5.6-luna 는 'low'('minimal' 은 400). temperature 는 원래 미사용.
          const chatModel = resolveOpenAIModel('chat')
          const effort = chatEffort(chatModel)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const createParams: any = {
            ...generationParams(chatModel, { maxTokens: 8192, effort: effort ? { raw: effort } : undefined, stream: true, cacheKey: `tcid-chat-${activityCode}` }),
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
          }
          const startedAt = performance.now()
          let finalUsage: unknown = null
          let finishReasonSeen: string | null = null
          let fullText = ''
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response: any = await client.chat.completions.create(createParams)

          for await (const chunk of response) {
            const text = chunk.choices?.[0]?.delta?.content ?? ''
            if (text) {
              fullText += text
              const data = JSON.stringify({ type: 'text', text })
              controller.enqueue(encoder.encode(`data: ${data}\n\n`))
            }
            const finishReason = chunk.choices?.[0]?.finish_reason
            if (finishReason) {
              finishReasonSeen = finishReason
              // 'stop' 뿐 아니라 'length' (max_tokens 초과) 등도 완료 처리
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            }
            // stream_options.include_usage: 마지막 청크에 usage 만 실려 온다(choices 비어 있음)
            if (chunk.usage) finalUsage = chunk.usage
          }
          logLlmUsage('chat/stream', chatModel, finalUsage as never, performance.now() - startedAt, { activity: activityCode, effort: effort ?? null, finish: finishReasonSeen })
          // [2026-09-20] 진행 판정(로그 전용): 'done' 을 보낸 뒤라 UI 지연 없음. 3초 상한.
          const lastUser = [...messages].reverse().find(m => m.role === 'user')
          if (lastUser && fullText) {
            await judgeProgress({ activityCode, userMessage: String(lastUser.content ?? ''), aiText: fullText })
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

function streamPlainText(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

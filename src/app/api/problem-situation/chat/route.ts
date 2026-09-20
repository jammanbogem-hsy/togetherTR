import OpenAI from 'openai'
import { generationParams, logLlmUsage, resolveOpenAIModel } from '@/lib/llm/openai'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      messages,
      currentScenario,
      drivingQuestion,
      essentialQuestions,
      claudeIdeas,
      openaiScenario,
      projectTitle,
      targetGradeGroup,
    } = body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      currentScenario?: { title: string; row1: string; row2: string; row3: string } | null
      drivingQuestion?: string
      essentialQuestions?: string[]
      claudeIdeas?: string
      openaiScenario?: string
      projectTitle: string
      targetGradeGroup: string
    }

    const systemPrompt = `당신은 협력적 수업설계 AI 에이전트입니다. 현재 교사팀의 Ds-1-2 문제 상황 설정을 돕고 있습니다.

프로젝트: ${projectTitle} (${targetGradeGroup})

=== 현재 작업 중인 문제상황 ===
${currentScenario ? `
제목: ${currentScenario.title}
행1 (실제성): ${currentScenario.row1}
행2 (학습+산출물): ${currentScenario.row2}
행3 (청중+행위): ${currentScenario.row3}
` : '(아직 확정된 문제상황 없음)'}

현재 탐구 질문: ${drivingQuestion ?? '(미확정)'}

하위 탐구 질문:
${essentialQuestions?.map((q, i) => `${i + 1}. ${q}`).join('\n') ?? '(미확정)'}

=== Claude 에이전트 제안 아이디어 ===
${claudeIdeas ?? '(생성 중 또는 없음)'}

=== OpenAI 에이전트 추천 시나리오 ===
${openaiScenario ?? '(생성 중 또는 없음)'}

---

역할: 교사의 채팅 요청을 바탕으로 문제상황을 수정·보완·확정하는 것을 돕습니다.

주요 기능:
1. 특정 아이디어를 선택하거나 합치는 방향 제안
2. 시나리오의 특정 행(행1/행2/행3)을 수정
3. 탐구 질문이나 하위 탐구 질문 수정
4. 학년 수준·교과 적합성 검토
5. 저장 준비가 됐을 때 "저장 준비 완료" 신호 포함

저장 준비 신호 형식 (교사가 저장을 요청하거나 확정 의사 표명 시):
[PS_READY: 제목=...|행1=...|행2=...|행3=...|핵심질문=...|탐구1=...|탐구2=...|탐구3=...]

이 신호는 응답 맨 끝에만 포함하세요. 교사가 "저장해줘", "이걸로 확정", "저장하겠습니다" 같은 표현을 하면 발동합니다.

모든 응답은 반드시 한국어로 작성하세요.`

    const encoder = new TextEncoder()
    const KEEP_ALIVE_INTERVAL = 15_000

    const stream = new ReadableStream({
      async start(controller) {
        const keepAliveTimer = setInterval(() => {
          try { controller.enqueue(encoder.encode(': ping\n\n')) } catch { /* ignore */ }
        }, KEEP_ALIVE_INTERVAL)

        try {
          const model = resolveOpenAIModel('utility')
          const startedAt = performance.now()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response: any = await client.chat.completions.create({
            ...generationParams(model, { maxTokens: 2048, effort: 'light', stream: true }),
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
          } as never)

          let usage: unknown = null
          for await (const chunk of response) {
            const text = chunk.choices?.[0]?.delta?.content ?? ''
            if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`))
            }
            if (chunk.choices?.[0]?.finish_reason) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            }
            if (chunk.usage) usage = chunk.usage
          }
          logLlmUsage('problem-situation/chat', model, usage as never, performance.now() - startedAt)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
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
    return Response.json({ error: msg }, { status: 500 })
  }
}

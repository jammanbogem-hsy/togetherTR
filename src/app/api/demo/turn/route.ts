import OpenAI from 'openai'
import {
  isDemoValidationError,
  parseDemoTurnInput,
  parseDemoTurnModelOutput,
} from '@/lib/demo/engine/types'
import {
  buildDemoTurnInput,
  buildDemoTurnInstructions,
  buildDemoTurnResponseSchema,
} from '@/lib/demo/engine/prompts'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_REQUEST_BYTES = 180_000

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function readRequestJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new DemoRequestTooLargeError()
  }
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new DemoRequestTooLargeError()
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new SyntaxError('Invalid JSON body')
  }
}

class DemoRequestTooLargeError extends Error {}

export async function POST(request: Request): Promise<Response> {
  let rawInput: unknown
  try {
    rawInput = await readRequestJson(request)
  } catch (error) {
    if (error instanceof DemoRequestTooLargeError) {
      return jsonResponse({ error: '요청 본문이 너무 큽니다.' }, 413)
    }
    return jsonResponse({ error: '올바른 JSON 요청이 아닙니다.' }, 400)
  }

  let input
  try {
    input = parseDemoTurnInput(rawInput)
  } catch (error) {
    if (isDemoValidationError(error)) {
      return jsonResponse({ error: '요청 값이 올바르지 않습니다.', issues: error.issues }, 400)
    }
    throw error
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return jsonResponse({ error: '데모 생성 모델이 설정되지 않았습니다.' }, 503)
  }

  try {
    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_DEMO_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o'
    const isGpt5 = model.startsWith('gpt-5')
    const maxTokens = input.phase === 'orchestrator-synthesis' ? 8_192 : 2_048
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: buildDemoTurnInstructions(input) },
        { role: 'user', content: buildDemoTurnInput(input) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: `demo_turn_${input.phase.replaceAll('-', '_')}`,
          strict: true,
          schema: buildDemoTurnResponseSchema(input),
        },
      },
      ...(isGpt5
        ? { max_completion_tokens: maxTokens, reasoning_effort: 'minimal' }
        : { max_tokens: maxTokens, temperature: 0.5 }),
    }, { timeout: 110_000 })
    const responseText = response.choices[0]?.message?.content?.trim() ?? ''

    if (!responseText) {
      console.error('[demo/turn] incomplete OpenAI response', {
        responseId: response.id,
        phase: input.phase,
        activityCode: input.activityCode,
        finishReason: response.choices[0]?.finish_reason,
      })
      return jsonResponse({ error: '에이전트 턴을 완성하지 못했습니다. 다시 시도해 주세요.' }, 502)
    }

    let modelJson: unknown
    try {
      modelJson = JSON.parse(responseText) as unknown
    } catch {
      console.error('[demo/turn] OpenAI returned non-JSON output', {
        responseId: response.id,
        phase: input.phase,
        activityCode: input.activityCode,
      })
      return jsonResponse({ error: '에이전트 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.' }, 502)
    }

    try {
      return jsonResponse(parseDemoTurnModelOutput(modelJson, input))
    } catch (error) {
      if (isDemoValidationError(error)) {
        console.error('[demo/turn] invalid structured output', {
          responseId: response.id,
          phase: input.phase,
          activityCode: input.activityCode,
          issues: error.issues,
        })
        return jsonResponse({ error: '에이전트 응답이 검증을 통과하지 못했습니다. 다시 시도해 주세요.' }, 502)
      }
      throw error
    }
  } catch (error) {
    console.error('[demo/turn] OpenAI request failed', error)
    return jsonResponse({ error: '에이전트 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502)
  }
}

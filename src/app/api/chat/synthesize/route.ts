/**
 * Phase 2: /api/chat/synthesize — 팀원 생각 모아보기 API
 *
 * 설계 출처:
 *  - Lead 확정: 클라이언트 body 동봉 방식 (serverDb client SDK는 rules 미평가로 보안 구멍)
 *  - verify/04-pedagogy.md §13 (프롬프트 + user message 빌더)
 *  - verify/02-data-flow.md §10 (본 파일 동시 업데이트)
 *
 * 요청 스키마:
 *   POST body: {
 *     projectId: string                       // rate-limit 키용
 *     activityCode: ActivityCode
 *     members: Array<{ uid, displayName, utterances: string[] }>
 *     topic?: string                          // 현재 버전은 user message에 반영 안 함 (Phase 2 범위 외)
 *   }
 *
 * 흐름:
 *  1. body 검증 (400)
 *  2. rate limit 1분 3회 (429) — 키: `${projectId}:${activityCode}`
 *  3. members → 평탄화 utterances[] + §13-6 절삭 정책 (전체 4000자 초과 시 각 발언 앞 800 + 뒤 200)
 *  4. buildSynthesizeUserMessage로 user 메시지 조립
 *  5. OpenAI gpt-4o, temperature 0.3, max_tokens 800, SSE 스트리밍
 *  6. 응답 스트림 중 ARTIFACT_UPDATE/ACTION_CARD 등 신호 라인 strip (§13-6)
 *
 * 비보유:
 *  - Firestore 조회 없음. 발언은 클라이언트가 이미 필터해서 보냄 → 서버는 rules 우회 불가
 *  - kind: 'synthesis' 저장은 호출자 책임 (§13-6 #5)
 */

import OpenAI from 'openai'
import { ACTIVITY_META, type ActivityCode } from '@/types'
import {
  SYNTHESIZE_SYSTEM_PROMPT,
  buildSynthesizeUserMessage,
} from '@/lib/prompts/synthesize'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── rate limit (모듈 스코프 sliding window) ────────────
// 서버리스 cold start마다 초기화되는 best-effort.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 3
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (rateLimitMap.get(key) ?? []).filter(t => t > windowStart)
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(key, recent)
    return false
  }
  recent.push(now)
  rateLimitMap.set(key, recent)
  return true
}

// ─── body 검증 ──────────────────────────────────────────

interface MemberInput {
  uid: string
  displayName: string
  utterances: string[]
}

interface SynthesizeBody {
  projectId: string
  activityCode: ActivityCode
  members: MemberInput[]
  topic?: string
}

function parseBody(raw: unknown): SynthesizeBody | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (typeof b.projectId !== 'string' || !b.projectId) return null
  if (typeof b.activityCode !== 'string' || !b.activityCode) return null
  if (!ACTIVITY_META[b.activityCode as ActivityCode]) return null
  if (!Array.isArray(b.members) || b.members.length === 0) return null

  const members: MemberInput[] = []
  for (const item of b.members) {
    if (!item || typeof item !== 'object') return null
    const m = item as Record<string, unknown>
    if (typeof m.uid !== 'string' || !m.uid) return null
    if (typeof m.displayName !== 'string') return null
    if (!Array.isArray(m.utterances)) return null
    if (!m.utterances.every(u => typeof u === 'string')) return null
    members.push({
      uid: m.uid,
      displayName: m.displayName,
      utterances: m.utterances as string[],
    })
  }

  if (b.topic !== undefined && typeof b.topic !== 'string') return null
  return {
    projectId: b.projectId,
    activityCode: b.activityCode as ActivityCode,
    members,
    topic: typeof b.topic === 'string' && b.topic.trim() ? b.topic.trim() : undefined,
  }
}

// ─── 발언 평탄화 + §13-6 절삭 정책 ───────────────────────
// 1) members → [{speaker, text}] 평탄화 (members 배열 순서 유지)
// 2) 발언 전체 합이 4000자 초과 시 각 발언을 앞 800 + "..." + 뒤 200으로 절삭
// 3) 빈 문자열/공백만 있는 발언은 제외

const MAX_TOTAL_CHARS = 4000
const TRUNCATE_HEAD = 800
const TRUNCATE_TAIL = 200

function flattenAndTruncate(
  members: MemberInput[]
): Array<{ speaker: string; text: string }> {
  const flattened: Array<{ speaker: string; text: string }> = []
  for (const m of members) {
    const speaker = m.displayName.trim() || m.uid.slice(0, 6)
    for (const u of m.utterances) {
      const t = u.trim()
      if (!t) continue
      flattened.push({ speaker, text: t })
    }
  }

  const totalChars = flattened.reduce((acc, u) => acc + u.text.length, 0)
  if (totalChars <= MAX_TOTAL_CHARS) return flattened

  return flattened.map(u => {
    if (u.text.length <= TRUNCATE_HEAD + TRUNCATE_TAIL) return u
    const head = u.text.slice(0, TRUNCATE_HEAD)
    const tail = u.text.slice(-TRUNCATE_TAIL)
    return { speaker: u.speaker, text: `${head}...${tail}` }
  })
}

// ─── 응답 스트림 후처리 (신호 strip) ────────────────────
// §13-6 #4: synthesize 응답은 순수 텍스트. [ARTIFACT_UPDATE] / [ACTION_CARD] 등 신호
// 라인이 섞여 내려오면 client로 보내기 전에 제거. 청크 경계에 신호가 잘려 도착할 수
// 있으므로 라인 단위로 버퍼링 후 닫힌 라인만 strip + flush.
const SIGNAL_LINE_RE = /^\s*\[(ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTION_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|HELP_CARD|TEAM_DISCUSSION_READY)[\s\S]*?\]\s*$/gm

function stripSignals(text: string): string {
  return text.replace(SIGNAL_LINE_RE, '').replace(/\n{3,}/g, '\n\n')
}

// ─── POST handler ───────────────────────────────────────

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const body = parseBody(raw)
  if (!body) {
    return Response.json({ error: 'Invalid body shape' }, { status: 400 })
  }

  const rateKey = `${body.projectId}:${body.activityCode}`
  if (!checkRateLimit(rateKey)) {
    return Response.json(
      { error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429 }
    )
  }

  const utterances = flattenAndTruncate(body.members)
  if (utterances.length === 0) {
    return Response.json(
      { error: '아직 팀원 발언이 충분하지 않아요. 조금 더 대화한 뒤 다시 시도해 주세요.' },
      { status: 422 }
    )
  }

  const meta = ACTIVITY_META[body.activityCode]
  const userMessage = buildSynthesizeUserMessage({
    stage: meta.stage,
    activity: body.activityCode,
    activityTitle: meta.label,
    utterances,
  })

  const encoder = new TextEncoder()
  const KEEP_ALIVE_INTERVAL = 15_000

  const stream = new ReadableStream({
    async start(controller) {
      const keepAliveTimer = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')) } catch { /* 닫힌 경우 무시 */ }
      }, KEEP_ALIVE_INTERVAL)

      // 라인 경계 기준 버퍼링 → strip → flush.
      // flushAll=true면 버퍼 끝까지 처리 (스트림 종료 시).
      let buffer = ''
      const flushLines = (flushAll: boolean) => {
        const nlIdx = buffer.lastIndexOf('\n')
        if (!flushAll && nlIdx < 0) return
        const cutAt = flushAll ? buffer.length : nlIdx + 1
        const toFlush = buffer.slice(0, cutAt)
        buffer = buffer.slice(cutAt)
        const cleaned = stripSignals(toFlush)
        if (cleaned.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: cleaned })}\n\n`))
        }
      }

      try {
        const response = await client.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0.3,
          max_tokens: 800,
          messages: [
            { role: 'system', content: SYNTHESIZE_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          stream: true,
        })

        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) {
            buffer += text
            flushLines(false)
          }
          if (chunk.choices[0]?.finish_reason) {
            flushLines(true)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[synthesize] LLM error:', err)
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
      Connection: 'keep-alive',
    },
  })
}

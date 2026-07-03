/**
 * Task #23 Phase 3: POST /api/chat/previous-cycle-ref
 *
 * ACTION_CARD primary "이전 주기 반영하기" 클릭 → 이 엔드포인트 호출.
 * P1-I에서 저장된 `project.previousCycleImprovements`를 읽어 systemPrompt에 주입하고
 * OpenAI 응답을 SSE로 스트리밍한다.
 *
 * 주의:
 *  - user 메시지는 클라이언트가 따로 보내지 않는다. 시스템 프롬프트 + 단일 trigger user 메시지만으로 응답 생성.
 *  - admin Firestore 자격증명 없음 → 500 ("firestore-not-configured")
 *  - project 없음 → 404 ("project-not-found")
 *  - previousCycleImprovements 없거나 cycleNumber < 1 → 404 ("no-previous-cycle")
 *  - e11Improvement/e21Improvement 둘 다 없음 → 404 ("no-improvement-content")
 *
 * 교차 감수 (pedagogy-auditor, 2026-04-12) 반영 사항:
 *  - temperature 0.7 → 0.5 (카드용 분산 축소, 톤 안정성 우선)
 *  - 서버측 신호 strip 후처리 추가 — 프롬프트 7번 규칙(신호 금지) 방어선.
 *    LLM이 실수로 [ACTION_CARD: ...] / [ARTIFACT_UPDATE: ...] 출력해도 클라이언트 전송 전 제거.
 */

import OpenAI from 'openai'
import { getAdminDb } from '@/lib/firebase/admin'
import { buildPreviousCycleRefPrompt, type PreviousCycleRefInput } from '@/lib/prompts/previousCycleRef'
import type { ActivityCode, Project } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface RequestBody {
  projectId: string
  currentActivity: ActivityCode
}

export async function POST(request: Request) {
  try {
    const body: RequestBody = await request.json()
    const { projectId, currentActivity } = body

    if (!projectId || !currentActivity) {
      return Response.json(
        { error: 'missing-params', message: 'projectId와 currentActivity가 필요합니다.' },
        { status: 400 }
      )
    }

    const adminDb = getAdminDb()
    if (!adminDb) {
      return Response.json(
        { error: 'firestore-not-configured', message: '서버 Firestore 자격증명이 없습니다 (FIREBASE_SERVICE_ACCOUNT 또는 ADC 필요).' },
        { status: 500 }
      )
    }

    const snap = await adminDb.collection('projects').doc(projectId).get()
    if (!snap.exists) {
      return Response.json(
        { error: 'project-not-found', message: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    const project = snap.data() as Project
    const improvements = project.previousCycleImprovements

    if (!improvements || typeof improvements.cycleNumber !== 'number' || improvements.cycleNumber < 1) {
      return Response.json(
        { error: 'no-previous-cycle', message: '이전 주기 성찰 데이터가 없습니다.' },
        { status: 404 }
      )
    }

    if (!improvements.e11Improvement && !improvements.e21Improvement) {
      return Response.json(
        { error: 'no-improvement-content', message: '이전 주기 개선안 텍스트가 기록되지 않았습니다.' },
        { status: 404 }
      )
    }

    const ref: PreviousCycleRefInput = {
      cycleNumber: improvements.cycleNumber,
      e11Improvement: improvements.e11Improvement,
      e21Improvement: improvements.e21Improvement,
      nextCycleChoice: improvements.nextCycleChoice,
    }

    const systemPrompt = buildPreviousCycleRefPrompt(ref, currentActivity)

    // trigger user 메시지 1개 — 프롬프트는 시스템 쪽에 전부 있으므로 이 메시지는 "시작하세요" 역할만.
    const triggerUserMessage = '위 지침에 따라 이전 주기 참고 제안을 작성해 주세요.'

    const encoder = new TextEncoder()
    const KEEP_ALIVE_INTERVAL = 15_000

    // 교차 감수 권고: 신호 블록 strip. 청크 경계에서 신호가 잘릴 수 있으므로
    // 마지막 미완성 가능 구간(가장 최근의 '['부터 끝까지)은 다음 청크와 합쳐 처리한다.
    // 신호 패턴: [ACTION_CARD: ...] / [ARTIFACT_UPDATE: ...] / [STATUS: ...] 등 대괄호 단일 라인.
    const SIGNAL_RE = /\[(?:ACTION_CARD|ARTIFACT_UPDATE|STATUS|HANDOFF)[^\]]*\]/g
    const stripSignals = (s: string): string => s.replace(SIGNAL_RE, '')

    const stream = new ReadableStream({
      async start(controller) {
        const keepAliveTimer = setInterval(() => {
          try { controller.enqueue(encoder.encode(': ping\n\n')) } catch { /* 이미 닫힌 경우 무시 */ }
        }, KEEP_ALIVE_INTERVAL)

        // 청크 경계 안전 버퍼: 누적된 텍스트의 마지막 '[' 이후 부분은 보류, 그 앞은 strip 후 flush.
        let pending = ''
        const flushSafe = (incoming: string, isFinal: boolean) => {
          pending += incoming
          let flushable: string
          if (isFinal) {
            // 최종: 전체 strip 후 flush.
            flushable = stripSignals(pending)
            pending = ''
          } else {
            const lastOpen = pending.lastIndexOf('[')
            if (lastOpen === -1) {
              flushable = stripSignals(pending)
              pending = ''
            } else {
              // '[' 이후는 신호 시작일 가능성 → 보류. 그 앞은 안전하게 flush.
              flushable = stripSignals(pending.slice(0, lastOpen))
              pending = pending.slice(lastOpen)
            }
          }
          if (flushable) {
            const data = JSON.stringify({ type: 'text', text: flushable })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
        }

        try {
          const response = await client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 512,  // 2~3문장 카드용 — 짧게 제한
            temperature: 0.5, // 교차 감수 권고: 카드용 분산 축소 (synthesize 0.3보다는 약간 여유, 톤 안정 우선)
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: triggerUserMessage },
            ],
            stream: true,
          })

          for await (const chunk of response) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) {
              flushSafe(text, false)
            }
            const finishReason = chunk.choices[0]?.finish_reason
            if (finishReason) {
              flushSafe('', true) // 잔여 pending까지 strip 후 flush
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
    console.error('[previous-cycle-ref] route error:', err)
    return Response.json({ error: 'internal', message: msg }, { status: 500 })
  }
}

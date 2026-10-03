import Anthropic from '@anthropic-ai/sdk'
import { resolveClaudeModel, isClaude5Family } from '@/lib/llm/anthropic'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'
import { validateProblemStandards } from '@/lib/problem-situation/validateStandards'
import { CONVERSATION_CONTEXT_LIMIT, TEAM_PREPARATION_LIMIT } from '@/lib/problem-situation/workshopContext'
import {
  DETAIL_MAX_TOKENS,
  OUTLINE_MAX_TOKENS,
  buildDetailPrompts,
  buildNodeContext,
  buildOutlinePrompts,
  parseCandidateDetail,
  parseOutline,
  resolveGeneratePhase,
  type ProblemSituationContext,
  type ProblemSituationResult,
} from '@/lib/problem-situation/generation'

// 결과 타입은 lib로 옮겼고, 기존 import 경로 호환을 위해 여기서 다시 내보낸다.
export type {
  ProblemCandidateDetail,
  ProblemRealData,
  ProblemScenarioCandidate,
  ProblemSituationResult,
  ProblemStandardAlignment,
} from '@/lib/problem-situation/generation'

export const runtime = 'nodejs'
// Vercel 전용 힌트. Firebase Hosting은 함수 설정과 무관하게 60초에서 요청을 끊으므로
// 이 라우트는 단계(outline / detail)별로 나뉘어 각 요청이 그 안에 끝난다.
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = resolveClaudeModel('suggest')

// 2단계 생성:
//   phase 'outline' → 탐구 질문 + 후보 3개 요약 (ProblemSituationResult, 상세 비어 있음)
//   phase 'detail'  → 후보 하나의 상세 조각 ({ index, part, detail })
//                     part 'scenario'(전문·성취기준·자료) / 'plan'(학습내용·산출물·점검)
//                     클라이언트가 후보 3개 × 조각 2개 = 6요청을 병렬 호출
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const {
      graphSavedData,
      achievementStandardsAnalysis,
      evaluationPlan,
      learningObjective,
      learnerProfile,
      teamPreparation,
      recentConversation,
      projectTitle,
      targetGradeGroup,
      teamGradeBands,
      targetSubjects,
    } = body as {
      graphSavedData?: GraphSavedData | null
      achievementStandardsAnalysis?: string
      evaluationPlan?: string
      learningObjective?: string
      learnerProfile?: string
      teamPreparation?: string
      recentConversation?: string
      projectTitle: string
      targetGradeGroup: string
      teamGradeBands?: string[]
      targetSubjects: string[]
    }

    const resolved = resolveGeneratePhase(body)
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: 400 })
    }

    const ctx: ProblemSituationContext = {
      projectTitle,
      targetGradeGroup,
      teamGradeBands: Array.isArray(teamGradeBands) ? teamGradeBands : undefined,
      targetSubjects: Array.isArray(targetSubjects) ? targetSubjects : [],
      nodeContext: buildNodeContext(
        graphSavedData?.centerNode ?? null,
        graphSavedData?.selectedStandards ?? [],
        graphSavedData?.agentNotes ?? [],
      ),
      achievementStandardsAnalysis,
      evaluationPlan,
      learningObjective,
      learnerProfile,
      // 60초 제한 보호: 클라이언트가 상한을 넘겨 보내도 서버에서 한 번 더 자른다(대화는 최근 쪽을 남긴다).
      teamPreparation: typeof teamPreparation === 'string' ? teamPreparation.slice(0, TEAM_PREPARATION_LIMIT + 1) : undefined,
      recentConversation: typeof recentConversation === 'string' ? recentConversation.slice(-CONVERSATION_CONTEXT_LIMIT) : undefined,
    }

    if (resolved.phase === 'outline') {
      const { system, user } = buildOutlinePrompts(ctx)
      const rawText = await complete(system, user, OUTLINE_MAX_TOKENS)
      const outline = parseOutline(rawText, recoverTruncatedJson)
      if (!outline) {
        return Response.json({ error: 'AI 응답에서 문제상황 후보를 읽지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      return Response.json(outline)
    }

    const outline = body.outline as ProblemSituationResult
    const { system, user } = buildDetailPrompts(ctx, outline, resolved.candidateIndex, resolved.part)
    const rawText = await complete(system, user, DETAIL_MAX_TOKENS)
    const detail = parseCandidateDetail(rawText, resolved.part, recoverTruncatedJson)
    if (!detail) {
      return Response.json({ error: 'AI 응답이 잘려 후보 상세를 읽지 못했습니다. 이 후보만 다시 생성해 주세요.' }, { status: 500 })
    }
    return Response.json({
      index: resolved.candidateIndex,
      part: resolved.part,
      detail: validateProblemStandards(detail, achievementStandardsAnalysis),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

async function complete(system: string, user: string, maxTokens: number): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // Claude 5 계열은 기본 adaptive thinking — JSON 절단 방지를 위해 끔(sonnet-4-6 과 동일 동작)
    ...(isClaude5Family(MODEL) ? { thinking: { type: 'disabled' as const } } : {}),
    system,
    messages: [{ role: 'user', content: user }],
  })
  return response.content[0]?.type === 'text' ? response.content[0].text : ''
}

/**
 * 채팅 진행 판정 (2026-09-20 하이브리드 4단계, 로그 전용).
 *
 * 교사 발화의 의도(진행/저장/복귀/논의/무관)와 AI 응답이 그 의도대로 행동했는지를 Jev 로 판정해
 * 실제로 방출된 신호와 비교·기록한다. 아직 게이팅하지 않는다 — Jev 판정 vs 실제 진행 일치율
 * (게이트 ≥95%)을 로그로 쌓은 뒤 게이팅 여부를 정한다. 응답 지연에 영향을 주지 않도록
 * 스트림 'done' 이후에 호출하고 3초 안에 끝낸다.
 */

import { systemOne, type JevChoiceAnswer, type JevNoulAnswer } from '@/lib/curriculum/jev'
import { jevJudgeEnabled } from '@/lib/curriculum/jevJudge'
import { parseActivityAdvance, parseActivityReturn, parseArtifactUpdates } from '@/lib/chat/signals'

export type TeacherIntent = 'proceed' | 'save' | 'back' | 'discuss' | 'offtopic'

const INTENT_CRITERIA: Record<TeacherIntent, string> = {
  proceed: '다음 활동(또는 다음 단계)으로 넘어가자는 명시적 이동 의사',
  save: '지금까지의 내용을 산출물로 저장·확정해 달라는 요청(A안 선택 포함)',
  back: '이전 활동으로 돌아가 다시 손보자는 요청',
  discuss: '수업 설계 내용에 대한 의견·질문·제안·논의',
  offtopic: '수업 설계와 무관한 잡담이나 운영 외 이야기',
}

export interface ProgressJudgement {
  intent: TeacherIntent
  intentConfidence: number
  /** AI 응답이 교사 요청에 맞게 행동했는가 (0~1) */
  responseFollows: number
  emitted: { advance: string | null; back: string | null; artifact: boolean }
  /** 의도로 기대되는 신호와 실제 방출이 맞는가 (proceed→advance 등). 절차상 체크리스트 선행 등 예외가 있어 참고용. */
  consistent: boolean | null
  elapsedMs: number
}

export async function judgeProgress(params: {
  activityCode: string
  userMessage: string
  aiText: string
}): Promise<ProgressJudgement | null> {
  if (!jevJudgeEnabled()) return null
  const { activityCode, userMessage, aiText } = params
  const advance = parseActivityAdvance(aiText)?.nextActivity || null
  const back = parseActivityReturn(aiText)?.targetActivity || null
  const artifact = parseArtifactUpdates(aiText).updates.length > 0
  const visible = parseArtifactUpdates(aiText).cleanText.replace(/\[(ACTIVITY_ADVANCE|ACTIVITY_RETURN|TEAM_DISCUSSION_READY|HELP_CARD|ACTION_CARD|ARTIFACT_CONFIRM)[^\]]*\]/g, '').trim()
  try {
    const response = await systemOne({
      현재_활동: activityCode,
      교사_발화: userMessage.slice(0, 2000),
      AI_응답: visible.slice(0, 3000),
      AI가_실제로_한_행동: { 다음_활동으로_이동: advance ?? '없음', 이전_활동으로_복귀: back ?? '없음', 산출물_저장: artifact ? '예' : '아니오' },
    }, {
      intent: { type: 'choice', instructions: '`교사_발화` 의 주된 의도는 무엇인가?', criteria: INTENT_CRITERIA },
      follows: { type: 'noul', instructions: '`AI_응답` 과 `AI가_실제로_한_행동` 이 `교사_발화` 의 요청에 맞게 행동했는가? (이동 요청엔 이동 또는 절차상 점검표 제시, 저장 요청엔 저장, 논의엔 논의로 응답)' },
    }, { timeoutMs: 3_000, maxRetries: 0 })
    const intentAnswer = response.answers.intent as JevChoiceAnswer
    const follows = response.answers.follows as JevNoulAnswer
    const intent = intentAnswer.choice as TeacherIntent
    const consistent = intent === 'proceed' ? Boolean(advance) || null
      : intent === 'save' ? artifact
      : intent === 'back' ? Boolean(back)
      : intent === 'discuss' || intent === 'offtopic' ? !advance && !back
      : null
    const judgement: ProgressJudgement = {
      intent, intentConfidence: intentAnswer.confidence, responseFollows: follows.noul,
      emitted: { advance, back, artifact }, consistent, elapsedMs: response.elapsedMs,
    }
    console.log('[jev-progress]', JSON.stringify({ activity: activityCode, ...judgement }))
    return judgement
  } catch (error) {
    console.error('[jev-progress]', error)
    return null
  }
}

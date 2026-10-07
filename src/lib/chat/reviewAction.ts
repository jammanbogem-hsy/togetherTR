import type { ActionCard, ActivityCode } from '@/types'
import { TRAINING_ACTIVITIES } from '@/lib/training/trainingMode'

export const REVIEW_ACTION_RULES = `### 검토·논의 요청의 다음 행동 (일반·연수용 공통)
교사에게 "검토해 주세요", "논의해 주세요", "확인해 주세요"라고 요청할 때는 무엇을 살필지 구체적으로 적고, 본문에 "다음 단계에 필요한 것: …"을 한 줄로 명시한다. …에는 지금 활동에서 합의하거나 보완할 내용·판단 기준을 적는다(예: 역할별 담당자·업무·완료 시점 확인).
이 요청에는 본문 길이에 관계없이 아래 행동 카드를 붙인다. 이 규칙은 아래의 4줄 이상 조건·짧은 응답 금지보다 우선한다. 다른 신호와의 상호배제 규칙은 그대로 지킨다.
[ACTION_CARD: intent=내용을 검토하고 보완할 점을 알려 주세요 | primary=검토 완료 | secondary=추가 내용 입력 | skip=나중에 검토]
"추가 내용 입력"은 작성 안내만 채우며 자동 전송하지 않는다. "검토 완료"는 검토 의사만 전달하며, 산출물 확정·저장·활동 이동에 필요한 기존 명시적 승인이나 필수 조건을 대신하지 않는다.

`

export function isReviewAction(card: ActionCard | null | undefined): boolean {
  return card?.primary === '검토 완료' && card.secondary === '추가 내용 입력'
}

function guidance(text: string, activity: ActivityCode): string {
  const explicit = text.match(/다음 단계에 필요한 것\s*[:：]\s*([^\n]+)/)?.[1]
  if (explicit?.trim()) return explicit.trim()
  const fields = TRAINING_ACTIVITIES[activity]?.fields.filter(field => field.tier === 'A').map(field => field.label)
  return `${fields?.join(', ') || '제안 내용'}을 확인하고, 수정할 내용과 이유를 알려 주세요.`
}

/** A missing model signal must not leave an explicit review request without a next action. */
export function completeReviewAction(parsed: { card: ActionCard; cleanText: string } | null, text: string, activity: ActivityCode) {
  if (parsed && !isReviewAction(parsed.card)) return parsed
  if (!parsed) {
    // Only direct requests outside quoted/code examples; the caller also checks already-parsed signals.
    const prose = text.replace(/```[\s\S]*?```/g, '').split('\n').filter(line => !/^\s*>/.test(line)).join('\n')
    if (!/(?:검토|논의|확인)\s*(?:해\s*주세요|해\s*주십시오|해\s*주시겠어요)/.test(prose)
      || /\[(?:ACTION_CARD|HELP_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|TEAM_DISCUSSION_READY):/.test(text)) return null
  }
  const cleanText = parsed?.cleanText ?? text
  return {
    card: parsed?.card ?? { intent: '내용을 검토하고 보완할 점을 알려 주세요', primary: '검토 완료', secondary: '추가 내용 입력', skip: '나중에 검토' },
    cleanText: /다음 단계에 필요한 것\s*[:：]/.test(cleanText) ? cleanText : `${cleanText.trimEnd()}\n\n다음 단계에 필요한 것: ${guidance(cleanText, activity)}`,
  }
}

export function appendReviewDraft(current: string, text: string, activity: ActivityCode): string {
  const template = `검토 후 추가 의견\n확인할 내용: ${guidance(text, activity)}\n수정하거나 덧붙일 내용과 이유: `
  if (current.includes(template)) return current
  return current.trim() ? `${current}\n\n${template}` : template
}

// 문제상황 워크숍 생성 맥락 보강 — T단계 팀 준비 산출물과 Ds-2(내부 Ds-1-2) 대화의 최근 합의를 프롬프트용 텍스트로 만든다.
// Hosting 60초 제한 때문에 두 블록 모두 글자 수 상한을 둔다.
import { serializeArtifactForPrompt } from '@/lib/artifacts/serializeArtifactForPrompt'
import { cleanPsReady } from '@/lib/problem-situation/readySignal'

export const TEAM_PREPARATION_LIMIT = 2000
export const CONVERSATION_CONTEXT_LIMIT = 6000

// 비전·원칙은 문제상황 방향에 직접 쓰이므로 길게, 역할·규칙·일정은 짧게 싣는다.
const TEAM_PREPARATION_SECTIONS = [
  { code: 'T-1-1', label: '팀 비전 (T-1)', limit: 600 },
  { code: 'T-1-2', label: '설계 원칙 (T-2)', limit: 600 },
  { code: 'T-2-1', label: '역할 분담 (T-3)', limit: 250 },
  { code: 'T-2-2', label: '협력 규칙 (T-4)', limit: 250 },
  { code: 'T-2-3', label: '일정 (T-5)', limit: 250 },
] as const

const SIGNAL_TAG = /\[(?:ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTION_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|HELP_CARD|TEAM_DISCUSSION_READY|TEAM_GRADE_BANDS|STANDARD_SEARCH)[\s\S]*?\]/g

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

/** T단계 산출물(비전·원칙 위주)을 섹션별 상한을 두고 직렬화한다. 산출물이 하나도 없으면 빈 문자열. */
export function buildTeamPreparationContext(artifacts: unknown): string {
  if (!artifacts || typeof artifacts !== 'object') return ''
  const record = artifacts as Record<string, { content?: unknown } | undefined>
  const blocks = TEAM_PREPARATION_SECTIONS.flatMap(({ code, label, limit }) => {
    const text = serializeArtifactForPrompt(record[code]?.content).trim()
    return text ? [`[${label}]\n${clip(text, limit)}`] : []
  })
  return clip(blocks.join('\n\n'), TEAM_PREPARATION_LIMIT)
}

export interface ConversationMessageLike {
  role: string
  content: string
  activityCode?: string
  displayName?: string
}

/** 신호 태그·저장 표시를 지운 대화 본문. */
export function cleanConversationText(text: string): string {
  return cleanPsReady(text.replace(SIGNAL_TAG, '').replace(/\[ARTIFACT_UPDATE\]/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 해당 활동 대화의 최근 메시지를 화자 표시와 함께 이어 붙인다.
 * 상한을 넘으면 오래된 메시지부터 버린다(가장 최근 한 개가 상한보다 길면 그 끝부분만 남긴다).
 */
export function buildRecentConversationContext(
  messages: readonly ConversationMessageLike[],
  activityCode = 'Ds-1-2',
  limit = CONVERSATION_CONTEXT_LIMIT,
): string {
  const lines = messages
    .filter(m => m.activityCode === activityCode && (m.role === 'user' || m.role === 'assistant'))
    .map(m => {
      const text = cleanConversationText(m.content)
      if (!text) return ''
      const speaker = m.role === 'assistant' ? 'AI' : (m.displayName?.trim() || '교사')
      return `${speaker}: ${text}`
    })
    .filter(Boolean)
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const added = line.length + (kept.length ? 2 : 0)
    if (size + added > limit) {
      if (!kept.length) kept.unshift(`…${line.slice(line.length - (limit - 1))}`)
      break
    }
    kept.unshift(line)
    size += added
  }
  return kept.join('\n\n')
}

/** A deferral is not permission to save, advance, or ask the same question again. */
export function isDecisionDeferred(text: string): boolean {
  return /(?:선택|결정|저장|변경).{0,12}(?:않|안\s*할|안\s*하|보류|나중|미루)|(?:현재|기존)\s*내용.{0,5}유지|(?:지금은|이번에는).{0,8}(?:넘기|보류)|다시\s*논의|기본\s*대화.*이어/.test(text)
}

export function hasDeferredDecision(messages: Array<{ role: string; content: string }>): boolean {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue
    if (isDecisionDeferred(message.content)) return true
    if (/(?:선택|결정|저장|확정).{0,8}(?:하겠습니다|해주세요|할게|해줘)|(?:A|B|C|D|E)안을?\s*선택/.test(message.content)) return false
  }
  return false
}

export function deferredResponse(text: string): string {
  const clean = text.replace(/\[(?:ARTIFACT_UPDATE(?:@[^:\]]+)?|ARTIFACT_CONFIRM|ACTIVITY_ADVANCE|ACTIVITY_RETURN|TEAM_DISCUSSION_READY|ACTION_CARD):[^\]]*\]/g, '').trim()
  // Do not show another decision gate after the teacher has declined one.
  if (/(?:A안|B안)/.test(clean)) return '네, 결정은 잠시 미루고 대화를 이어가겠습니다. 산출물과 현재 활동은 변경하지 않겠습니다. 지금 더 이야기하고 싶은 점을 편하게 말씀해 주세요.'
  return clean || '네, 결정은 보류하고 대화를 이어가겠습니다. 산출물과 현재 활동은 그대로 유지합니다.'
}

export function discussionContributions<T extends { role: string; content: string }>(messages: T[], startIndex: number): T[] {
  return messages.filter(m => m.role !== 'system').slice(startIndex)
    .filter(m => m.role === 'user' && m.content.trim().length > 0)
}

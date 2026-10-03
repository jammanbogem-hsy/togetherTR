// 활동 이동·재진입 판정(순수 함수) — #29 단계를 넘는 되돌아가기 대상, #30 환영 메시지 재생성 방지.

/**
 * 단계 이동 창에서 확정할 도착 활동.
 * AI 되돌아가기 신호로 연 창이면(returnActivity 가 대상 단계 안의 활동) 그 활동으로 가고,
 * 새 주기 시작이거나 대상이 없거나 다른 단계면 기존처럼 단계 첫 활동으로 간다.
 */
export function resolveStageMoveTargetActivity(input: {
  toStage: string
  firstActivity: string
  returnActivity?: string | null
  returnActivityStage?: string | null
  isStartingNewCycle: boolean
}): string {
  if (input.isStartingNewCycle || !input.returnActivity) return input.firstActivity
  return input.returnActivityStage === input.toStage ? input.returnActivity : input.firstActivity
}

/**
 * 환영 메시지를 새로 만들지 여부. 방장만, 대화가 완전히 로드된 뒤, 이 활동(현재 주기)에
 * 환영 메시지나 대화가 하나도 없을 때만 만든다(재진입 때 다시 붙지 않게).
 */
export function shouldCreateWelcomeMessage(input: {
  started: boolean
  messagesLoaded: boolean
  isHost: boolean
  hasWelcomeText: boolean
  welcomeId: string
  cycle: number
  messages: ReadonlyArray<{ id: string; role?: string; cycleNumber?: number }>
}): boolean {
  if (!input.started || !input.messagesLoaded || !input.isHost || !input.hasWelcomeText) return false
  const cycleMessages = input.messages.filter(message => (message.cycleNumber ?? 1) === input.cycle)
  if (input.messages.some(message => message.id === input.welcomeId)) return false
  return !cycleMessages.some(message => message.role === 'user' || message.role === 'assistant')
}

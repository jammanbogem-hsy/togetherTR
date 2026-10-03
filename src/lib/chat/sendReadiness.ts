// 채팅 전송 준비 판정 — 페이지 이동 직후(프로젝트·프로필·메시지 구독·현재 활동 동기화 전)에는
// 전송을 막고 입력은 그대로 둔다. 준비 전에 보내면 기본 활동(T-1-1) 경로에 저장되거나,
// 곧이어 활동 동기화로 메시지 목록이 비워져 입력한 글이 사라진 것처럼 보인다(#26).

export interface ChatSendReadinessInput {
  hasProject: boolean
  hasUser: boolean
  messagesLoaded: boolean
  /** 화면(Zustand)의 현재 활동 */
  currentActivity?: string | null
  /** Firestore 프로젝트 문서의 현재 활동 — 없으면 동기화 대상이 아니므로 비교하지 않는다 */
  projectActivity?: string | null
}

/** 전송을 막아야 하면 이유 문구, 보낼 수 있으면 null. */
export function chatSendBlockReason(input: ChatSendReadinessInput): string | null {
  if (!input.hasProject || !input.hasUser) return '프로젝트를 불러오는 중이에요'
  if (input.projectActivity && input.currentActivity !== input.projectActivity) return '현재 활동으로 이동하는 중이에요'
  if (!input.messagesLoaded) return '대화를 불러오는 중이에요'
  return null
}

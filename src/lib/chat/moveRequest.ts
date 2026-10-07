// 교사가 '다음 활동으로 넘어가자'고 분명히 말했는지 — AI 가 이동 신호([ACTIVITY_ADVANCE])를 빠뜨리고
// "넘어가겠습니다"라고만 답해도 화면이 실제로 이동 카드를 띄우거나 권한을 알려 주게 하는 보조 판정.
const EDIT_WORDS = /고쳐|수정|바꿔|보완|전에|돌아가|이전|저장|확정|추가|빼/
const MOVE_WORDS = /이동|넘어가|넘어갈|다음\s*활동|다음\s*단계|다음으로/
const QUESTION_OR_HOLD = /\?|까요|인가요|뭔가요|무엇|어떤|설명|알려|말아|마세요|않|보류|취소|말해/

export function isMoveRequest(text: string): boolean {
  if (QUESTION_OR_HOLD.test(text)) return false
  const t = text.trim().replace(/[.!~\s]+$/, '')
  if (!t || t.length > 40 || EDIT_WORDS.test(t)) return false
  return /^다음(요|이요|이에요|으로|으로 가요|으로 가자|으로 가 주세요)?$/.test(t) || MOVE_WORDS.test(t)
}

/** 기록 담당이 아닌 사람이 이동을 요청했을 때의 고정 안내 */
export const MOVE_NEEDS_RECORDER = '다음 활동으로 넘어가는 것은 기록 담당만 할 수 있어요. 기록 담당 선생님께 위쪽 막대의 "다음 활동" 버튼을 눌러 달라고 하거나, 팀원 목록에서 기록 권한을 요청해 주세요.'

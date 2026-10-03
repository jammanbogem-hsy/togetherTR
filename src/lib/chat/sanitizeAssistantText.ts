// AI 응답 끝에 붙는 깨진 외국 문자 꼬리(예: "азаара", "ેણ") 제거 — 응답 완료 시 한 번 적용한다(#27).
// 한글·라틴·숫자·한자·일본 가나·문장부호·기호·이모지는 정상 문자로 보고 건드리지 않는다.

const ALLOWED_LETTER = /[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const SHORT_TAIL_MAX = 6
const MAX_PASSES = 3

/** 한글·라틴 등 허용 문자 체계 밖의 글자나 결합 부호(구자라트 모음 기호 등)인지 */
function isForeignChar(char: string): boolean {
  return /[\p{L}\p{M}]/u.test(char) && !ALLOWED_LETTER.test(char)
}

/** 끝에서부터 외국 문자만으로 된 덩어리(공백 없이 이어진 부분)의 시작 위치. 없으면 -1. */
function foreignTailStart(chars: string[]): number {
  let i = chars.length
  while (i > 0 && isForeignChar(chars[i - 1])) i--
  return i === chars.length ? -1 : i
}

export function sanitizeAssistantText(text: string): string {
  let chars = Array.from(text.replace(/\s+$/u, ''))
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const start = foreignTailStart(chars)
    if (start < 0) break
    const tailLength = chars.length - start
    const before = chars.slice(0, start)
    const attached = before.length > 0 && !/\s/u.test(before[before.length - 1])
    if (!attached) {
      // 공백으로 떨어진 꼬리는 짧고, 바로 앞 단어가 외국 문자가 아닐 때만 잡음으로 본다(정상 외국어 인용 보존).
      const prefix = before.join('').replace(/\s+$/u, '')
      const prevChar = Array.from(prefix).pop() ?? ''
      if (tailLength > SHORT_TAIL_MAX || isForeignChar(prevChar)) break
    }
    if (before.length === 0) break  // 응답 전체가 외국어면 꼬리가 아니므로 그대로 둔다
    chars = Array.from(before.join('').replace(/\s+$/u, ''))
  }
  const cleaned = chars.join('')
  // 바꾼 것이 없으면 원문(끝 공백 포함)을 그대로 돌려준다.
  return cleaned === text.replace(/\s+$/u, '') ? text : cleaned
}

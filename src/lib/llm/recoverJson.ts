// LLM JSON 응답 복구 유틸.
// max_tokens 초과로 응답이 중간에 잘리면 JSON.parse가 실패한다.
// 끝에서부터 잘린 부분을 버리고 마지막으로 완결된 구조까지만 살려 파싱을 재시도한다.
//
// 동작: 여는 괄호 스택을 추적하며 문자열/이스케이프를 인식해, 파싱 가능한
// 최대 prefix를 찾은 뒤 남은 열린 괄호([ 또는 {)를 순서대로 닫아 본다.
// 배열 원소가 쉼표 뒤에서 잘린 경우(`..., {`)는 그 쉼표 이전까지로 되돌린다.

export function recoverTruncatedJson(raw: string): unknown | null {
  const text = raw.trim()
  if (!text) return null

  // 1차: 그대로 시도 (호출부에서 이미 실패했더라도 방어적으로 한 번 더)
  try {
    return JSON.parse(text)
  } catch {
    // continue
  }

  const stack: string[] = []
  let inString = false
  let escaped = false
  // 마지막으로 "원소 경계"였던 위치 (배열/객체에서 값이 완결된 지점 = 닫는 괄호 또는 쉼표 직전)
  let lastSafe = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }
    if (ch === '}' || ch === ']') {
      stack.pop()
      // 최상위 컨테이너가 한 번이라도 닫혔으면 그 지점이 안전 경계
      lastSafe = i
      continue
    }
    if (ch === ',' && stack.length > 0) {
      // 쉼표는 직전 원소가 완결됐다는 신호 → 쉼표 직전까지가 안전
      lastSafe = i - 1
      continue
    }
  }

  // 안전 경계까지 자른 뒤 열린 괄호를 역순으로 닫아 파싱 재시도
  for (let cut = lastSafe; cut >= 0; cut--) {
    const head = text.slice(0, cut + 1).replace(/,\s*$/, '')
    // head 기준으로 열린 괄호 재계산
    const open: string[] = []
    let s = false
    let e = false
    for (let i = 0; i < head.length; i++) {
      const c = head[i]
      if (s) {
        if (e) e = false
        else if (c === '\\') e = true
        else if (c === '"') s = false
        continue
      }
      if (c === '"') { s = true; continue }
      if (c === '{' || c === '[') open.push(c)
      else if (c === '}' || c === ']') open.pop()
    }
    if (s) continue // 문자열 안에서 잘림 — 더 앞으로
    const closers = open.reverse().map(o => (o === '{' ? '}' : ']')).join('')
    const candidate = head + closers
    try {
      return JSON.parse(candidate)
    } catch {
      // 더 앞쪽 경계로 재시도
    }
  }
  return null
}

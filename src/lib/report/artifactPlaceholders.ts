// 보고서 스트림의 산출물 자리표시 치환. AI 가 산출물 원문을 다시 베껴 쓰지 않고 {{ARTIFACT:코드}} 만 쓰면
// 서버가 스트림을 내보내기 직전에 원문 마크다운으로 바꾼다 — 출력 토큰·시간(Hosting 60초)을 줄이고 원문 손실을 막는다.

const PLACEHOLDER_RE = /\{\{ARTIFACT:([A-Za-z]{1,2}-\d-\d)\}\}/g
const MAX_PENDING = 40

export function artifactPlaceholder(code: string): string {
  return `{{ARTIFACT:${code}}}`
}

/** 청크 경계에서 잘린 자리표시를 모아 두었다가 완성되면 치환해 내보낸다. */
export function createArtifactPlaceholderExpander(originals: Readonly<Record<string, string>>) {
  let pending = ''
  const expand = (text: string) => text.replace(PLACEHOLDER_RE, (whole, code: string) => originals[code] ?? whole)
  return {
    push(chunk: string): string {
      pending += chunk
      const open = pending.lastIndexOf('{{')
      // 닫히지 않은 '{{' 이후는 다음 청크를 기다린다(너무 길면 자리표시가 아니므로 그대로 내보낸다).
      if (open >= 0 && !pending.includes('}}', open) && pending.length - open <= MAX_PENDING) {
        const ready = pending.slice(0, open)
        pending = pending.slice(open)
        return expand(ready)
      }
      // '{' 하나로 끝나면 다음 청크가 '{' 로 이어질 수 있다.
      if (pending.endsWith('{') && !pending.endsWith('{{')) {
        const ready = pending.slice(0, -1)
        pending = '{'
        return expand(ready)
      }
      const out = expand(pending)
      pending = ''
      return out
    },
    flush(): string {
      const out = expand(pending)
      pending = ''
      return out
    },
  }
}

function tableCells(line: string): string[] | null {
  const text = line.trim()
  if (!text.includes('|')) return null
  const cells = text.split(/(?<!\\)\|/)
  if (text.startsWith('|')) cells.shift()
  if (/(?<!\\)\|$/.test(text)) cells.pop()
  return cells.map(cell => cell.trim())
}

function rowKey(cell: string): string {
  return cell
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\*([^*]+)\*|_([^_]+)_/g, (_, star, underscore) => star ?? underscore)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\\\|/g, '|')
    .replace(/\s+/g, ' ')
    .trim()
}

function tableKeys(markdown: string): { isTable: boolean; keys: string[] } {
  const lines = markdown.split(/\r?\n/)
  const keys: string[] = []
  let isTable = false
  let fence: string | null = null
  for (let i = 0; i < lines.length - 1; i++) {
    const marker = lines[i].trim().match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1][0]
      else if (fence === marker[1][0]) fence = null
      continue
    }
    if (fence) continue
    const header = tableCells(lines[i])
    const separator = tableCells(lines[i + 1])
    if (!header || !separator || header.length !== separator.length
      || !separator.every(cell => /^:?-+:?$/.test(cell))) continue
    isTable = true
    i += 2
    while (i < lines.length) {
      const cells = tableCells(lines[i])
      if (!cells || cells.every(cell => /^:?-+:?$/.test(cell))) break
      const key = rowKey(cells[0])
      if (key) keys.push(key)
      i++
    }
    i--
  }
  return { isTable, keys }
}

/** 머리글·구분선을 제외하고, 이전 표에서 빠진 첫 열의 정규화된 값을 반환한다. */
export function findDroppedTableRows(previous: string, next: string): string[] {
  if (!previous.trim()) return []
  const before = tableKeys(previous)
  const after = tableKeys(next)
  if (!before.isTable || !after.isTable) return []
  const remaining = new Set(after.keys)
  return [...new Set(before.keys)].filter(key => !remaining.has(key))
}

/** 코드·문구 삭제와 구분해, 행을 대상으로 한 삭제·병합 요청만 허용한다. */
export function userAskedToDeleteRows(recentUserTexts: string[]): boolean {
  const target = /(?:^|[\s\d'"‘’“”])(?:줄|행)(?=\s|[을를은는이가도의만]|삭제)|항목|확인\s*지점|차시|활동/
  const deletion = /빼|삭제(?!한|된|했던|됐)|지워|지우|없애|줄여|줄이|합쳐|합치|통합|제거/g
  const codeOrWord = /(?:코드|단어|표현|문구|문장|\[[^\]\n]+\])\s*(?:만|은|는|을|를|도)?\s*$/
  return recentUserTexts.some(text => text.split(/[.!?;\n]/).some(clause => {
    for (const match of clause.matchAll(deletion)) {
      const before = clause.slice(Math.max(0, match.index - 40), match.index)
      const after = clause.slice(match.index + match[0].length, match.index + match[0].length + 40)
      if (/^.{0,8}(?:지\s*말|하지\s*않|안\s*(?:하|할)|하지\s*말)/.test(after)) continue
      if (codeOrWord.test(before)) continue
      if (target.test(before) || target.test(after)) return true
    }
    return false
  }))
}

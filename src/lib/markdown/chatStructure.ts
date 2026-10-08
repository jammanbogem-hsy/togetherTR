/** Display-only compatibility for tree diagrams in previously saved AI messages.
 * Use semantic Markdown lists; leave code, tables, and ordinary prose intact.
 */
export function normalizeChatStructure(text: string): string {
  if (!/[├└][─━-]+/.test(text)) return text
  const result: string[] = []
  let fence: { char: string; length: number } | null = null
  let inTree = false
  let indents: number[] = []
  const blank = () => { if (result.length && result[result.length - 1].trim()) result.push('') }
  for (const original of text.split('\n')) {
    const marker = original.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      result.push(original)
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && original.slice(marker[0].length).trim() === '') fence = null
      continue
    }
    if (marker) {
      if (inTree) blank()
      inTree = false; indents = []
      fence = { char: marker[1][0], length: marker[1].length }
      result.push(original)
      continue
    }
    // Some old responses put the entire diagram on one line. Split only repeated
    // box-drawing branches; inline code and table rows must remain untouched.
    const folded = !original.includes('`') && !original.trimStart().startsWith('|') && (original.match(/[├└][─━-]+/g)?.length ?? 0) >= 2
    const lines = folded ? original.replace(/\s+([│┃\s]*[├└][─━-]+)/g, '\n$1').split('\n') : [original]
    for (const line of lines) {
      const branch = line.match(/^([ \t│┃]*)([├└][─━-]+)[ \t]*(.*)$/)
      // Four-space indented code is not a tree unless a preceding branch/root
      // has already established one. Normal trees start at column zero.
      if (branch && (inTree || !/^ {4}|^\t/.test(line))) {
        const width = branch[1].replace(/\t/g, '    ').length
        if (!inTree) { blank(); indents = [width] }
        while (indents.length > 1 && width < indents[indents.length - 1]) indents.pop()
        if (width > indents[indents.length - 1]) indents.push(width)
        result.push(`${'  '.repeat(indents.length - 1)}- ${branch[3]}`)
        inTree = true
      } else if (inTree && /^[ \t│┃]+$/.test(line) && /[│┃]/.test(line)) {
        // Connector-only lines carry no content.
      } else {
        if (inTree && line.trim()) blank()
        if (line.trim()) { inTree = false; indents = [] }
        result.push(line)
      }
    }
  }
  return result.join('\n')
}

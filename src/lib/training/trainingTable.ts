/** A training field stays a Markdown string; this model exists only while editing. */
export interface TrainingTableRow { id: string; cells: string[] }
export interface TrainingTable { kind: 'table'; headers: string[]; separators: string[]; rows: TrainingTableRow[] }
export type TrainingTablePart = TrainingTable | { kind: 'text'; text: string }
let rowSequence = 0
export function trainingTableRow(cells: string[]): TrainingTableRow { return { id: `training-row-${++rowSequence}`, cells } }

function splitRow(line: string): string[] | null {
  const text = line.trim(), cells: string[] = []
  let cell = '', pipes = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '\\' && index + 1 < text.length) { cell += char + text[++index]; continue }
    if (char === '|') { cells.push(cell); cell = ''; pipes++ } else cell += char
  }
  if (!pipes) return null
  cells.push(cell)
  if (text.startsWith('|')) cells.shift()
  if (cells.at(-1) === '') cells.pop()
  return cells.map(value => value.trim())
}
const decodeCell = (text: string) => text.replace(/\\([\\|])/g, '$1').replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/&(amp|lt|gt|#10);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', '#10': '\n' })[entity]!)
// Numeric newlines remain valid Markdown and render as text in existing viewers (no raw HTML tags).
const encodeCell = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '&#10;')

/** Keep prose and fenced code untouched; malformed/ragged tables are never truncated. */
export function parseTrainingTables(value: string): TrainingTablePart[] {
  const lines = value.split(/\r?\n/), parts: TrainingTablePart[] = []
  let text: string[] = [], fence: { char: string; length: number } | null = null
  const flush = () => { if (text.length) { parts.push({ kind: 'text', text: text.join('\n') }); text = [] } }
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].trim().match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length) fence = null
      text.push(lines[index]); continue
    }
    const headers = fence ? null : splitRow(lines[index])
    const separators = headers ? splitRow(lines[index + 1] ?? '') : null
    if (!headers?.length || !separators || separators.length !== headers.length || !separators.every(cell => /^:?-+:?$/.test(cell))) {
      text.push(lines[index]); continue
    }
    const rows: TrainingTableRow[] = []
    let end = index + 2, valid = true
    for (; end < lines.length; end++) {
      const cells = splitRow(lines[end])
      if (!cells) break
      if (cells.length > headers.length) valid = false
      rows.push(trainingTableRow(Array.from({ length: headers.length }, (_, column) => decodeCell(cells[column] ?? ''))))
    }
    if (!valid) { text.push(...lines.slice(index, end)); index = end - 1; continue }
    flush()
    parts.push({ kind: 'table', headers: headers.map(decodeCell), separators, rows })
    index = end - 1
  }
  flush()
  return parts
}

export function emptyTrainingTable(headers: readonly string[]): TrainingTable {
  return { kind: 'table', headers: [...headers], separators: headers.map(() => '---'), rows: [trainingTableRow(headers.map(() => ''))] }
}

/** Empty templates/rows do not become "completed" content just because a table was opened. */
export function serializeTrainingTables(parts: TrainingTablePart[]): string {
  const hasContent = parts.some(part => part.kind === 'text' ? !!part.text.trim() : part.rows.some(row => row.cells.some(cell => !!cell.trim())))
  if (!hasContent) return ''
  return parts.map(part => part.kind === 'text' ? part.text : [
    part.headers.map(encodeCell), part.separators,
    ...part.rows.map(row => part.headers.map((_, column) => encodeCell(row.cells[column] ?? ''))),
  ].map(row => `| ${row.join(' | ')} |`).join('\n')).join('\n')
}

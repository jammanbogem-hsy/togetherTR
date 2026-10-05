import * as Y from 'yjs'
import { getCellText } from './workspace-crdt'

type SharedMap = Y.Map<unknown>
export type SelectionDirection = 'forward' | 'backward' | 'none'
export interface WorkspaceSelection {
  fieldKey: string
  start: string
  end: string
  direction: SelectionDirection
}
interface Field {
  text: Y.Text; key: string; start: number; end: number
  lineStart?: number; lineEnd?: number
}

const entity = (parent: SharedMap | undefined, collection: string, id: string): SharedMap | undefined => {
  const array = parent?.get(collection)
  const item = array instanceof Y.Array ? array.toArray().find(value => value instanceof Y.Map && value.get('id') === id) : undefined
  return item instanceof Y.Map ? item : undefined
}
function checklistLines(text: string) {
  if (!text) return []
  let offset = 0
  return text.split(/\r?\n/).map((line, index) => {
    const marker = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.*)$/)
    const prefix = marker ? line.length - marker[2].length : (line.match(/^\s*[-*]\s*/)?.[0].length ?? 0)
    const result = { index, start: offset + prefix, end: offset + line.length, lineStart: offset }
    offset += line.length + (text.slice(offset + line.length).startsWith('\r\n') ? 2 : 1)
    return result
  })
}

/** Read existing shared text only; stable entity IDs survive row/column/block reorder. */
function field(doc: Y.Doc, key: string, allowMissingChecklistLine = false): Field | undefined {
  const root = doc.getMap<unknown>('workspace'), parts = key.split(':')
  let value: unknown, canonical = key, line: ReturnType<typeof checklistLines>[number] | undefined
  if (parts[0] === 'meta' && parts.length === 2) value = root.get(parts[1])
  else if (parts[0] === 'column' && parts.length === 2) value = entity(root, 'columns', parts[1])?.get('label')
  else if (parts[0] === 'block' && (parts.length === 2 || (parts.length === 4 && parts[2] === 'check'))) {
    value = entity(root, 'blocks', parts[1])?.get('content')
    if (parts.length === 4) {
      if (!/^\d+$/.test(parts[3]) || !(value instanceof Y.Text)) return undefined
      line = checklistLines(value.toString())[Number(parts[3])]
      if (!line && !allowMissingChecklistLine) return undefined
    }
  } else if (parts[0] === 'block-table-column' && parts.length === 3) {
    const table = entity(root, 'blocks', parts[1])?.get('table')
    value = table instanceof Y.Map ? entity(table, 'columns', parts[2])?.get('label') : undefined
  } else if (parts[0] === 'block-table' && parts.length === 4) value = getCellText(doc, parts[2], parts[3], parts[1])
  else if (parts[0] === 'main' && parts.length === 3) { value = getCellText(doc, parts[1], parts[2]); canonical = `${parts[1]}:${parts[2]}` }
  else if (parts.length === 2 && !['meta', 'column', 'block', 'modal'].includes(parts[0])) value = getCellText(doc, parts[0], parts[1])
  else if (parts.length === 3) { value = getCellText(doc, parts[1], parts[2], parts[0]); canonical = `block-table:${key}` }
  if (!(value instanceof Y.Text)) return undefined
  return { text: value, key: canonical, start: line?.start ?? 0, end: line?.end ?? value.length,
    lineStart: line?.lineStart, lineEnd: line?.end }
}

export function workspaceTextForField(doc: Y.Doc, fieldKey: string): Y.Text | undefined {
  return field(doc, fieldKey)?.text
}
export function workspaceFieldValue(doc: Y.Doc, fieldKey: string): string | undefined {
  const found = field(doc, fieldKey)
  return found?.text.toString().slice(found.start, found.end)
}
const relative = (text: Y.Text, index: number, assoc = 0) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index, assoc))
function boundedOffset(value: number, text: string): number {
  let offset = Math.max(0, Math.min(Math.trunc(value), text.length))
  if (offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset] ?? '')) offset--
  return offset
}

/** JSON string is portable between independent docs and safe for ephemeral presence records. */
export function encodeWorkspaceCaret(doc: Y.Doc, fieldKey: string, offset: number, assoc = 0): string | null {
  const found = field(doc, fieldKey)
  if (!found || !Number.isFinite(offset)) return null
  const index = found.start + boundedOffset(offset, found.text.toString().slice(found.start, found.end))
  return JSON.stringify({ version: 1, fieldKey: found.key, position: relative(found.text, index, assoc),
    ...(found.lineStart !== undefined ? { lineStart: relative(found.text, found.lineStart), lineEnd: relative(found.text, found.lineEnd!) } : {}) })
}

export function resolveWorkspaceCaretLocation(doc: Y.Doc, fieldKey: string, encoded: string): { fieldKey: string; caretPos: number } | null {
  try {
    if (!encoded || encoded.length > 8192) return null
    const payload = JSON.parse(encoded), found = field(doc, fieldKey, true)
    if (!found || payload.version !== 1 || payload.fieldKey !== found.key || !payload.position) return null
    const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(payload.position), doc)
    if (!absolute || absolute.type !== found.text) return null
    if (payload.lineStart || payload.lineEnd) {
      if (!payload.lineStart || !payload.lineEnd || !/^block:[^:]+:check:\d+$/.test(fieldKey)) return null
      const start = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(payload.lineStart), doc)
      const end = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(payload.lineEnd), doc)
      if (!start || !end || start.type !== found.text || end.type !== found.text || end.index <= start.index) return null
      const line = checklistLines(found.text.toString()).find(item => item.lineStart === start.index && item.end === end.index)
      if (!line || absolute.index < line.start || absolute.index > line.end) return null
      return { fieldKey: `block:${fieldKey.split(':')[1]}:check:${line.index}`, caretPos: absolute.index - line.start }
    }
    if (absolute.index < found.start || absolute.index > found.end) return null
    return { fieldKey, caretPos: absolute.index - found.start }
  } catch { return null }
}

export function resolveWorkspaceCaret(doc: Y.Doc, fieldKey: string, encoded: string): number | null {
  const location = resolveWorkspaceCaretLocation(doc, fieldKey, encoded)
  return location?.fieldKey === fieldKey ? location.caretPos : null
}

/** A provided unresolved relative caret stays hidden; only legacy records use absolute offsets. */
export function resolveWorkspacePresenceCaret(doc: Y.Doc | null, fieldKey: string, encoded?: string, legacyOffset?: number): number | undefined {
  if (encoded !== undefined) return doc ? resolveWorkspaceCaret(doc, fieldKey, encoded) ?? undefined : undefined
  return typeof legacyOffset === 'number' && Number.isFinite(legacyOffset) ? legacyOffset : undefined
}

export function captureWorkspaceSelection(doc: Y.Doc, fieldKey: string, start: number, end = start, direction: SelectionDirection = 'none'): WorkspaceSelection | null {
  const a = encodeWorkspaceCaret(doc, fieldKey, start)
  const b = encodeWorkspaceCaret(doc, fieldKey, end, start === end ? 0 : -1)
  return a && b ? { fieldKey, start: a, end: b, direction } : null
}

export function resolveWorkspaceSelection(doc: Y.Doc, selection: WorkspaceSelection): { fieldKey: string; start: number; end: number; direction: SelectionDirection } | null {
  const start = resolveWorkspaceCaretLocation(doc, selection.fieldKey, selection.start)
  const end = resolveWorkspaceCaretLocation(doc, selection.fieldKey, selection.end)
  if (!start || !end || start.fieldKey !== end.fieldKey) return null
  return { fieldKey: start.fieldKey, start: Math.min(start.caretPos, end.caretPos), end: Math.max(start.caretPos, end.caretPos), direction: selection.direction }
}

type Selectable = { selectionStart: number | null; selectionEnd: number | null }
/** A programmatic restore can emit trusted select events. Genuine pointer/key/input activity clears this marker. */
export function createSelectionRestoreGuard() {
  const restored = new WeakMap<Selectable, { start: number; end: number }>()
  return {
    mark(input: Selectable, start: number, end: number) { restored.set(input, { start, end }) },
    clear(input: Selectable) { restored.delete(input) },
    shouldSend(input: Selectable): boolean {
      const previous = restored.get(input)
      if (!previous) return true
      if (previous.start === input.selectionStart && previous.end === input.selectionEnd) return false
      restored.delete(input)
      return true
    },
  }
}

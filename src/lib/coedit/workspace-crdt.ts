import * as Y from 'yjs'

export const WORKSPACE_LOCAL_ORIGIN = Symbol('workspace-local')
export interface WorkspaceOptions { excludeFields?: string[]; excludeKeys?: string[] }
export interface TextDelta { index: number; deleteCount: number; insert: string }
type JSONMap = Record<string, unknown>
type SharedMap = Y.Map<unknown>
const ROOT = 'workspace'
const INTERNAL = '__crdt_'
const entityArrays = new Set(['rows', 'columns', 'blocks'])
const record = (value: unknown): value is JSONMap => !!value && typeof value === 'object' && !Array.isArray(value)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const excluded = (options: WorkspaceOptions) => new Set([...(options.excludeFields ?? []), ...(options.excludeKeys ?? [])])
function idArray(ids: unknown[]): Y.Array<unknown> {
  const order = new Y.Array<unknown>()
  order.insert(0, ids)
  return order
}

function shared(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && key !== 'id') return new Y.Text(value)
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>()
    array.insert(0, value.map(item => shared(item)))
    return array
  }
  if (record(value)) {
    const map = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || k.startsWith(INTERNAL)) continue
      map.set(k, shared(v, k))
      if (entityArrays.has(k) && Array.isArray(v)) map.set(`${INTERNAL}order_${k}`, idArray(v.map(item => record(item) ? item.id : null)))
    }
    return map
  }
  return value ?? null
}

function plain(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString()
  if (value instanceof Y.Array) return value.toArray().map(plain)
  if (value instanceof Y.Map) {
    const result: JSONMap = {}
    for (const [key, item] of value.entries()) {
      if (key.startsWith(INTERNAL)) continue
      let converted = plain(item)
      const order = value.get(`${INTERNAL}order_${key}`)
      if (entityArrays.has(key) && Array.isArray(converted)) {
        // Reordering never deletes/recreates a row Y.Map: its Y.Text identity survives.
        const byId = new Map(converted.filter(record).map(row => [row.id, row]))
        const ids = order instanceof Y.Array ? order.toArray() : []
        const seen = new Set<unknown>()
        converted = [...ids, ...byId.keys()].flatMap(id => {
          if (seen.has(id) || !byId.has(id)) return []
          seen.add(id)
          return [byId.get(id)]
        })
      }
      result[key] = converted
    }
    return result
  }
  return value
}

function assertIds(value: unknown, key = ''): void {
  if (Array.isArray(value)) {
    if (entityArrays.has(key)) {
      const ids = new Set<string>()
      for (const item of value) {
        if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error(`${key}: 중복 없는 안정 ID가 필요합니다.`)
        ids.add(item.id)
      }
    }
    for (const item of value) assertIds(item)
  } else if (record(value)) for (const [k, v] of Object.entries(value)) assertIds(v, k)
}

/** Called only for the winning seed transaction; repeat calls leave the document untouched. */
export function seedWorkspace(doc: Y.Doc, workspace: object, options: WorkspaceOptions = {}): void {
  const root = doc.getMap<unknown>(ROOT)
  if (root.get(`${INTERNAL}seeded`)) return
  const values = Object.fromEntries(Object.entries(workspace).filter(([key]) => !excluded(options).has(key)))
  assertIds(values)
  doc.transact(() => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || key.startsWith(INTERNAL)) continue
      root.set(key, shared(value, key))
      if (entityArrays.has(key) && Array.isArray(value)) root.set(`${INTERNAL}order_${key}`, idArray(value.map(item => record(item) ? item.id : null)))
    }
    root.set(`${INTERNAL}seeded`, true)
  }, WORKSPACE_LOCAL_ORIGIN)
}

export function workspaceToJSON<T extends object = JSONMap>(doc: Y.Doc): T {
  return plain(doc.getMap(ROOT)) as T
}
export const serializeWorkspace = workspaceToJSON

/** UTF-16 indices match Y.Text/textarea, but do not split surrogate pairs. */
export function textDelta(before: string, next: string): TextDelta {
  let start = 0, end = 0
  while (start < before.length && start < next.length && before[start] === next[start]) start++
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--
  while (end < before.length - start && end < next.length - start && before[before.length - end - 1] === next[next.length - end - 1]) end++
  if (end > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - end])) end--
  return { index: start, deleteCount: before.length - start - end, insert: next.slice(start, next.length - end) }
}

function changeText(text: Y.Text, before: string, next: string): void {
  if (before === next) return
  const delta = textDelta(before, next)
  if (delta.index > text.length || delta.index + delta.deleteCount > text.length) throw new Error('편집 기준이 달라졌습니다. 최신 화면에서 다시 입력해 주세요.')
  if (delta.deleteCount) text.delete(delta.index, delta.deleteCount)
  if (delta.insert) text.insert(delta.index, delta.insert)
}

function updateArray(parent: SharedMap, key: string, array: Y.Array<unknown>, before: unknown[], next: unknown[]): void {
  if (!entityArrays.has(key)) {
    let start = 0, end = 0
    while (start < before.length && start < next.length && same(before[start], next[start])) start++
    while (end < before.length - start && end < next.length - start && same(before[before.length - end - 1], next[next.length - end - 1])) end++
    const count = before.length - start - end
    if (count) array.delete(start, count)
    const inserted = next.slice(start, next.length - end).map(item => key.startsWith(`${INTERNAL}order_`) ? item : shared(item))
    if (inserted.length) array.insert(start, inserted)
    return
  }
  const oldById = new Map(before.filter(record).map(item => [item.id, item]))
  const newById = new Map(next.filter(record).map(item => [item.id, item]))
  // Delete only IDs the user removed; concurrent remote additions remain present.
  for (let i = array.length - 1; i >= 0; i--) {
    const item = array.get(i)
    if (item instanceof Y.Map && oldById.has(item.get('id')) && !newById.has(item.get('id'))) array.delete(i, 1)
  }
  for (const [id, item] of newById) {
    const existing = array.toArray().find(candidate => candidate instanceof Y.Map && candidate.get('id') === id)
    if (existing instanceof Y.Map) updateMap(existing, oldById.get(id) ?? {}, item)
    else if (!oldById.has(id)) array.push([shared(item)])
    // A concurrently deleted entity is not resurrected by a stale local edit.
  }
  const oldIds = before.filter(record).map(item => item.id)
  const nextIds = next.filter(record).map(item => item.id)
  if (!same(oldIds, nextIds)) {
    const orderKey = `${INTERNAL}order_${key}`
    const order = parent.get(orderKey)
    if (order instanceof Y.Array) updateArray(parent, orderKey, order, oldIds, nextIds)
    else parent.set(orderKey, idArray(nextIds))
  }
}

function updateMap(map: SharedMap, before: JSONMap, next: JSONMap): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (key.startsWith(INTERNAL) || same(before[key], next[key])) continue
    if (next[key] === undefined) { if (Object.hasOwn(before, key)) map.delete(key); continue }
    const current = map.get(key)
    if (current instanceof Y.Text && typeof next[key] === 'string') changeText(current, typeof before[key] === 'string' ? before[key] as string : current.toString(), next[key] as string)
    else if (current instanceof Y.Map && record(next[key])) updateMap(current, record(before[key]) ? before[key] as JSONMap : {}, next[key] as JSONMap)
    else if (current instanceof Y.Array && Array.isArray(next[key])) updateArray(map, key, current, Array.isArray(before[key]) ? before[key] as unknown[] : [], next[key] as unknown[])
    else map.set(key, shared(next[key], key))
  }
}

/** Local user diff only. Remote synchronization must always use Y.applyUpdate. */
export function applyWorkspaceDiff(doc: Y.Doc, before: object, next: object, options: WorkspaceOptions = {}): void {
  const omit = excluded(options)
  const clean = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => !omit.has(key)))
  const previous = clean(before), incoming = clean(next)
  assertIds(incoming)
  doc.transact(() => updateMap(doc.getMap(ROOT), previous, incoming), WORKSPACE_LOCAL_ORIGIN)
}

function table(doc: Y.Doc, blockId?: string): SharedMap | undefined {
  const root = doc.getMap<unknown>(ROOT)
  if (!blockId) return root
  const blocks = root.get('blocks')
  const block = blocks instanceof Y.Array ? blocks.toArray().find(item => item instanceof Y.Map && item.get('id') === blockId) : undefined
  const data = block instanceof Y.Map ? block.get('table') : undefined
  return data instanceof Y.Map ? data : undefined
}

export function getCellText(doc: Y.Doc, rowId: string, columnId: string, blockId?: string): Y.Text | undefined {
  const rows = table(doc, blockId)?.get('rows')
  const row = rows instanceof Y.Array ? rows.toArray().find(item => item instanceof Y.Map && item.get('id') === rowId) : undefined
  const cells = row instanceof Y.Map ? row.get('cells') : undefined
  const text = cells instanceof Y.Map ? cells.get(columnId) : undefined
  return text instanceof Y.Text ? text : undefined
}

export function applyCellDelta(doc: Y.Doc, rowId: string, columnId: string, delta: TextDelta, blockId?: string): void {
  const text = getCellText(doc, rowId, columnId, blockId)
  if (!text) throw new Error('편집할 칸이 없습니다.')
  if (!Number.isInteger(delta.index) || !Number.isInteger(delta.deleteCount) || delta.index < 0 || delta.deleteCount < 0 || delta.index + delta.deleteCount > text.length) throw new Error('문자 편집 범위가 올바르지 않습니다.')
  doc.transact(() => {
    if (delta.deleteCount) text.delete(delta.index, delta.deleteCount)
    if (delta.insert) text.insert(delta.index, delta.insert)
  }, WORKSPACE_LOCAL_ORIGIN)
}

export interface WorkspacePatch {
  type: string; workspace?: object; row?: { id: string; [key: string]: unknown }; rowId?: string
  column?: { id: string; [key: string]: unknown }; columnId?: string; label?: string; color?: string
  block?: { id: string; [key: string]: unknown }; blockId?: string; blockIds?: string[]
  field?: string; value?: unknown; updatedBy?: string
}

/** Compatibility patch adapter; identical replace-all snapshots generate no Yjs update. */
export function applyWorkspacePatch(doc: Y.Doc, patch: WorkspacePatch | object, options: WorkspaceOptions = {}): void {
  const p = patch as WorkspacePatch
  const before = workspaceToJSON(doc), next = structuredClone(before)
  const entities = (key: string) => (next[key] ??= []) as JSONMap[]
  switch (p.type) {
    case 'replace-all': if (!p.workspace) throw new Error('초안이 없습니다.'); applyWorkspaceDiff(doc, before, p.workspace, options); return
    case 'update-cell': {
      const row = entities('rows').find(item => item.id === p.rowId)
      if (row && p.columnId) ((row.cells ??= {}) as JSONMap)[p.columnId] = p.value ?? ''
      break
    }
    case 'add-row': if (p.row && !entities('rows').some(row => row.id === p.row?.id)) entities('rows').push(p.row); break
    case 'delete-row': next.rows = entities('rows').filter(row => row.id !== p.rowId); break
    case 'add-column': if (p.column && !entities('columns').some(column => column.id === p.column?.id)) {
      entities('columns').push(p.column)
      for (const row of entities('rows')) ((row.cells ??= {}) as JSONMap)[p.column.id] ??= ''
    } break
    case 'update-column': {
      const column = entities('columns').find(item => item.id === p.columnId)
      if (column) { if (p.label !== undefined) column.label = p.label; if (p.color !== undefined) column.color = p.color }
      break
    }
    case 'delete-column': next.columns = entities('columns').filter(column => column.id !== p.columnId); for (const row of entities('rows')) if (p.columnId) delete (row.cells as JSONMap)[p.columnId]; break
    case 'update-meta': if (p.field) next[p.field] = p.value; break
    case 'upsert-block': {
      if (!p.block) break
      const blocks = entities('blocks'), at = blocks.findIndex(block => block.id === p.block?.id)
      if (at < 0) blocks.push(p.block); else blocks[at] = p.block
      break
    }
    case 'delete-block': next.blocks = entities('blocks').filter(block => block.id !== p.blockId); break
    case 'reorder-blocks': {
      const blocks = entities('blocks'), ids = p.blockIds ?? []
      next.blocks = [...ids.flatMap(id => blocks.filter(block => block.id === id)), ...blocks.filter(block => typeof block.id !== 'string' || !ids.includes(block.id))]
      break
    }
    default: throw new Error(`지원하지 않는 공동 편집 변경: ${p.type}`)
  }
  applyWorkspaceDiff(doc, before, next, options)
}
export const patchWorkspace = applyWorkspacePatch

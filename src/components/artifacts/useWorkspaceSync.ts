// 공동 편집 창의 로컬 상태 ↔ 원격 스냅숏 동기화.
// 결함(#T7): 칸에서 나가면(blur) editingKey 가 바뀌어 동기화 effect 가 다시 돌고, 아직 반영되지 않은 옛 저장본으로
// 로컬 표를 덮었다. 이어서 '저장하기'가 그 옛 표를 replace-all 로 통째 저장해 방금 고친 칸이 이전 값으로 돌아갔다.
// 원칙: 원격 스냅숏은 들어올 때만 반영하고(편집 칸 이동으로는 반영하지 않음), 편집 중인 칸과 저장 대기 중인 칸은
// 로컬 값을 지킨다. 통째 저장은 대기 중인 칸 저장이 끝난 뒤 최신 로컬 표로 한다.
import { useCallback, useEffect, useRef, useState } from 'react'

export type PreserveFn<W> = (next: W, current: W, key: string) => W

/** 들어온 원격 표(incoming)에 지켜야 할 칸들의 로컬 값(current)을 덮어 돌려준다. */
export function mergeIncomingWorkspace<W>(incoming: W, current: W, keys: Iterable<string>, preserve: PreserveFn<W>): W {
  let next = incoming
  for (const key of new Set(keys)) next = preserve(next, current, key)
  return next
}

/** 저장 대기 동안 지킬 칸 키 — 각 창의 editingKey 형식('행id:열id')과 같다. 칸 patch 가 아니면 null. */
export function pendingKeyOfPatch(patch: unknown): string | null {
  const p = patch as { type?: string; rowId?: string; columnId?: string } | null
  return p?.type === 'update-cell' && p.rowId && p.columnId ? `${p.rowId}:${p.columnId}` : null
}

/**
 * 구조 변경(행·열 추가·삭제) 키 — 서버 스냅숏에 그 변경이 보일 때까지 로컬 구조를 지킨다(#T7b).
 * 'row+:id' / 'row-:id' / 'col+:id' / 'col-:id'
 */
export function structuralKeysOfPatch(patch: unknown): string[] {
  const p = patch as { type?: string; row?: { id?: string }; rowId?: string; column?: { id?: string }; columnId?: string } | null
  switch (p?.type) {
    case 'add-row': return p.row?.id ? [`row+:${p.row.id}`] : []
    case 'delete-row': return p.rowId ? [`row-:${p.rowId}`] : []
    case 'add-column': return p.column?.id ? [`col+:${p.column.id}`] : []
    case 'delete-column': return p.columnId ? [`col-:${p.columnId}`] : []
    default: return []
  }
}

interface StructuredLike { rows?: Array<{ id: string; cells?: Record<string, unknown> }>; columns?: Array<{ id: string }> }

/** 들어온 표에 아직 반영되지 않은 로컬 구조 변경을 덧입힌다. 이미 반영된 키는 confirmed 로 돌려준다. */
export function applyStructuralChanges<W>(incoming: W, current: W, keys: Iterable<string>): { next: W; confirmed: string[] } {
  const inc = incoming as unknown as StructuredLike
  const cur = current as unknown as StructuredLike
  let rows = Array.isArray(inc.rows) ? [...inc.rows] : undefined
  let columns = Array.isArray(inc.columns) ? [...inc.columns] : undefined
  const confirmed: string[] = []
  for (const key of new Set(keys)) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    if (kind === 'row+' && rows) {
      if (rows.some(r => r.id === id)) { confirmed.push(key); continue }
      const mine = cur.rows?.find(r => r.id === id)
      if (!mine) continue
      // 로컬 표에서 바로 앞에 있던 행 뒤에 넣는다(없으면 끝)
      const localIndex = cur.rows!.indexOf(mine)
      const before = cur.rows!.slice(0, localIndex).reverse().find(r => rows!.some(x => x.id === r.id))
      const at = before ? rows.findIndex(r => r.id === before.id) + 1 : (localIndex === 0 ? 0 : rows.length)
      rows.splice(at, 0, mine)
    } else if (kind === 'row-' && rows) {
      if (!rows.some(r => r.id === id)) { confirmed.push(key); continue }
      rows = rows.filter(r => r.id !== id)
    } else if (kind === 'col+' && columns) {
      if (columns.some(c => c.id === id)) { confirmed.push(key); continue }
      const mine = cur.columns?.find(c => c.id === id)
      if (!mine) continue
      columns = [...columns, mine]
      rows = rows?.map(r => ({ ...r, cells: { ...r.cells, [id]: cur.rows?.find(x => x.id === r.id)?.cells?.[id] ?? '' } }))
    } else if (kind === 'col-' && columns) {
      if (!columns.some(c => c.id === id)) { confirmed.push(key); continue }
      columns = columns.filter(c => c.id !== id)
    }
  }
  const next = { ...(incoming as object), ...(rows ? { rows } : {}), ...(columns ? { columns } : {}) } as W
  return { next, confirmed }
}

/**
 * 서버 저장본이 비어 있으면(빈 초안이거나 산출물에서 채워 연 표) 칸·행 단위 patch 는 서버의 빈 표에 적용돼
 * 화면의 행을 잃는다. 이때는 첫 변경을 지금 화면의 표 통째(replace-all)로 보낸다.
 */
export function prepareWorkspacePatch<P, W>(patch: P, next: W, remoteBlank: boolean): P {
  const p = patch as unknown as { type?: string; updatedBy?: string }
  if (!remoteBlank || p?.type === 'replace-all') return patch
  return { type: 'replace-all', workspace: next, updatedBy: p?.updatedBy } as unknown as P
}

/** 칸별 저장 대기 수를 세는 장부(같은 칸에 여러 저장이 겹쳐도 마지막이 끝날 때까지 지킨다). */
export function createPendingLedger() {
  const pending = new Map<string, number>()
  const inflight = new Set<Promise<unknown>>()
  return {
    keys: () => [...pending.keys()],
    track<T>(patch: unknown, promise: Promise<T>): Promise<T> {
      const key = pendingKeyOfPatch(patch)
      if (key) pending.set(key, (pending.get(key) ?? 0) + 1)
      const settled: Promise<T> = promise.finally(() => {
        if (key) {
          const left = (pending.get(key) ?? 1) - 1
          if (left > 0) pending.set(key, left)
          else pending.delete(key)
        }
        inflight.delete(settled)
      })
      inflight.add(settled)
      return settled
    },
    /** 지금 진행 중인 저장이 모두 끝날 때까지 기다린다(실패해도 진행). */
    async settle(): Promise<void> {
      while (inflight.size) await Promise.allSettled([...inflight])
    },
  }
}

export interface WorkspaceSync<W> {
  /** 서버 저장본이 비어 있으면 첫 변경을 화면 표 통째(replace-all)로 바꾼다. */
  prepare<P>(patch: P, next: W): P
  /** 저장 요청을 장부에 올린다 — 끝날 때까지 그 칸은 원격 스냅숏이 덮지 않는다. */
  track<T>(patch: unknown, promise: Promise<T>): Promise<T>
  /** 저장 응답을 반영 — 편집 중·대기 중 칸은 로컬 값 유지. */
  applySaved(saved: W): void
  /** 대기 중인 칸 저장이 끝난 뒤의 최신 로컬 표(통째 저장용). */
  settledLatest(): Promise<W>
}

export function useWorkspaceSync<W>({ open, incoming, workspace, setWorkspace, editingKey, preserve, remoteBlank = false, external = false }: {
  open: boolean
  /** A Yjs connection owns incoming state; never replay a legacy projection into it. */
  external?: boolean
  incoming: W
  /** 서버 저장본이 실질적으로 비어 있는지(isBlankWorkspace) */
  remoteBlank?: boolean
  workspace: W
  setWorkspace: (update: (current: W) => W) => void
  editingKey: string | null
  preserve: PreserveFn<W>
}): WorkspaceSync<W> {
  const [ledger] = useState(createPendingLedger)
  // 서버에 반영이 확인될 때까지 지키는 구조 변경(행·열 추가·삭제)
  const [structural] = useState(() => new Set<string>())
  const remoteBlankRef = useRef(remoteBlank)
  const latestRef = useRef(workspace)
  const editingRef = useRef(editingKey)
  const preserveRef = useRef(preserve)
  useEffect(() => {
    latestRef.current = workspace
    editingRef.current = editingKey
    preserveRef.current = preserve
    remoteBlankRef.current = remoteBlank
  })


  const protectedKeys = useCallback(() => [
    ...ledger.keys(),
    ...(editingRef.current ? [editingRef.current] : []),
  ], [ledger])

  const mergeIncoming = useCallback((next: W, current: W): W => {
    const cells = mergeIncomingWorkspace(next, current, protectedKeys(), preserveRef.current)
    const { next: merged, confirmed } = applyStructuralChanges(cells, current, structural)
    for (const key of confirmed) structural.delete(key)
    return merged
  }, [protectedKeys, structural])

  // 원격 스냅숏이 들어올 때만 반영한다. editingKey 변화(칸 이동·blur)로는 다시 돌지 않는다.
  useEffect(() => {
    if (!open || external) return
    setWorkspace(current => mergeIncoming(incoming, current))
  }, [incoming, open, external, mergeIncoming, setWorkspace])

  return {
    prepare: (patch, next) => {
      for (const key of structuralKeysOfPatch(patch)) structural.add(key)
      const prepared = prepareWorkspacePatch(patch, next, remoteBlankRef.current)
      // 통째로 보낸 뒤에는 서버가 비어 있지 않다 — 응답 전 다음 변경이 또 통째로 가지 않게
      if (prepared !== patch) remoteBlankRef.current = false
      return prepared
    },
    track: (patch, promise) => {
      for (const key of structuralKeysOfPatch(patch)) structural.add(key)
      return ledger.track(patch, promise)
    },
    applySaved: saved => { if (!external) setWorkspace(current => mergeIncoming(saved, current)) },
    settledLatest: async () => {
      await ledger.settle()
      return latestRef.current
    },
  }
}

// ─── 범용 공동 편집 창(CoeditWorkspaceModal) — 칸 키 'main:행:열' / 'blockId:행:열', 보조 표 대기 키는 'blockId' ───

interface CoeditRowLike { id: string; cells?: Record<string, string> }
interface CoeditBlockLike { id: string; table?: { columns: unknown[]; rows: CoeditRowLike[] } }
interface CoeditWorkspaceLike { rows: CoeditRowLike[]; blocks: CoeditBlockLike[] }

/**
 * 원격 스냅숏을 받되, 지켜야 할 키의 로컬 값을 유지한다.
 * - 'main:행:열' / 'blockId:행:열' → 그 칸
 * - 'blockId' → 그 보조 표 전체(보조 표는 표 단위로 저장되므로 대기 중이면 표째로 지킨다)
 */
export function mergeCoeditIncoming<W extends CoeditWorkspaceLike>(incoming: W, current: W, keys: Iterable<string>): W {
  let next = incoming
  for (const key of new Set(keys)) {
    const [scope, rowId, colId] = key.split(':')
    if (!rowId) {
      const mine = current.blocks.find(b => b.id === scope)
      if (mine?.table) next = { ...next, blocks: next.blocks.map(b => b.id === scope ? { ...b, table: mine.table } : b) }
      continue
    }
    const keep = (rows: CoeditRowLike[], src: CoeditRowLike[]) => {
      const mine = src.find(r => r.id === rowId)?.cells?.[colId]
      return mine === undefined ? rows : rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: mine } } : r)
    }
    if (scope === 'main') { next = { ...next, rows: keep(next.rows, current.rows) }; continue }
    const prevBlock = current.blocks.find(b => b.id === scope)
    if (!prevBlock?.table) continue
    next = {
      ...next,
      blocks: next.blocks.map(b => b.id === scope && b.table ? { ...b, table: { ...b.table, rows: keep(b.table.rows, prevBlock.table!.rows) } } : b),
    }
  }
  return next
}

/**
 * 칸별 지연 저장 대기열 — 칸마다 타이머를 따로 두어 400ms 안에 다른 칸으로 옮겨도 앞 칸 저장이 취소되지 않는다.
 * flushAll 은 닫기·구조 변경 전에 대기 중인 저장을 즉시 보낸다(취소하지 않음).
 */
export function createDebouncedPatchQueue<P>(send: (patch: P, key: string) => Promise<unknown>, delayMs = 400) {
  const pending = new Map<string, { patch: P; timer: ReturnType<typeof setTimeout> }>()
  const fire = (key: string) => {
    const item = pending.get(key)
    if (!item) return Promise.resolve()
    clearTimeout(item.timer)
    pending.delete(key)
    return send(item.patch, key)
  }
  return {
    keys: () => [...pending.keys()],
    schedule(key: string, patch: P) {
      const prev = pending.get(key)
      if (prev) clearTimeout(prev.timer)
      pending.set(key, { patch, timer: setTimeout(() => { void fire(key) }, delayMs) })
    },
    flushAll(): Promise<unknown[]> {
      return Promise.all([...pending.keys()].map(fire))
    },
  }
}

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
  /** 저장 요청을 장부에 올린다 — 끝날 때까지 그 칸은 원격 스냅숏이 덮지 않는다. */
  track<T>(patch: unknown, promise: Promise<T>): Promise<T>
  /** 저장 응답을 반영 — 편집 중·대기 중 칸은 로컬 값 유지. */
  applySaved(saved: W): void
  /** 대기 중인 칸 저장이 끝난 뒤의 최신 로컬 표(통째 저장용). */
  settledLatest(): Promise<W>
}

export function useWorkspaceSync<W>({ open, incoming, workspace, setWorkspace, editingKey, preserve }: {
  open: boolean
  incoming: W
  workspace: W
  setWorkspace: (update: (current: W) => W) => void
  editingKey: string | null
  preserve: PreserveFn<W>
}): WorkspaceSync<W> {
  const [ledger] = useState(createPendingLedger)
  const latestRef = useRef(workspace)
  const editingRef = useRef(editingKey)
  const preserveRef = useRef(preserve)
  useEffect(() => {
    latestRef.current = workspace
    editingRef.current = editingKey
    preserveRef.current = preserve
  })

  const protectedKeys = useCallback(() => [
    ...ledger.keys(),
    ...(editingRef.current ? [editingRef.current] : []),
  ], [ledger])

  // 원격 스냅숏이 들어올 때만 반영한다. editingKey 변화(칸 이동·blur)로는 다시 돌지 않는다.
  useEffect(() => {
    if (!open) return
    setWorkspace(current => mergeIncomingWorkspace(incoming, current, protectedKeys(), preserveRef.current))
  }, [incoming, open, protectedKeys, setWorkspace])

  return {
    track: (patch, promise) => ledger.track(patch, promise),
    applySaved: saved => setWorkspace(current => mergeIncomingWorkspace(saved, current, protectedKeys(), preserveRef.current)),
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

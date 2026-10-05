'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import * as Y from 'yjs'
import { useProjectStore } from '@/store/project'
import { connectWorkspace } from '@/lib/coedit/firestore-workspace'
import { applyWorkspaceDiff, getCellText, workspaceToJSON } from '@/lib/coedit/workspace-crdt'

type Status = 'connecting' | 'saved' | 'saving' | 'offline' | 'error'
type Connection = ReturnType<typeof connectWorkspace>
type TextInput = HTMLInputElement | HTMLTextAreaElement
const FROM_PROVIDER = Symbol('workspace-provider')
const FROM_VIEW = Symbol('workspace-view')

/** Each editor keeps its own Y.Doc while an IME composition is in progress.
 * Remote updates wait only in the view; local updates still reach durable storage.
 * Replaying updates afterwards merges character identities instead of replacing text.
 */
export function useRealtimeWorkspace<W extends object>({ open, projectId, workspaceField, workspace, incoming, setWorkspace: setRawWorkspace, editingKey, excludeKeys = [] }: {
  open: boolean
  projectId?: string
  workspaceField: string
  workspace: W
  incoming: W
  setWorkspace: Dispatch<SetStateAction<W>>
  editingKey?: string | null
  excludeKeys?: string[]
}) {
  const project = useProjectStore(state => state.project)
  const enabled = !!projectId && project?.id === projectId && project.trainingMode?.enabled === true
  const cycle = project?.currentCycle ?? 1
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState('')
  const connectionRef = useRef<Connection | null>(null)
  const viewRef = useRef<Y.Doc | null>(null)
  const latestRef = useRef(workspace)
  const incomingRef = useRef(incoming)
  const editingRef = useRef(editingKey)
  const composingRef = useRef(false)
  const queuedRef = useRef<Uint8Array[]>([])
  const completeCompositionRef = useRef<() => void>(() => {})
  const readyRef = useRef(false)
  const selectionRef = useRef<{ input: TextInput; start: number; end: number } | null>(null)
  const excluded = excludeKeys.join(',')
  useLayoutEffect(() => { incomingRef.current = incoming; editingRef.current = editingKey })

  useLayoutEffect(() => {
    const selection = selectionRef.current
    selectionRef.current = null
    if (selection?.input === document.activeElement) {
      selection.input.setSelectionRange(selection.start, selection.end)
    }
  }, [workspace])

  useEffect(() => {
    if (!enabled || !open || !projectId) return
    let active = true
    let unsubscribe = () => {}
    const excludedFields = excluded ? excluded.split(',') : []
    readyRef.current = false
    composingRef.current = false
    queuedRef.current = []
    const provider = connectWorkspace({
      projectId, workspaceField, cycle, initialWorkspace: incomingRef.current,
      excludeKeys: excludedFields,
      onStatus: (next, detail) => {
        if (!active) return
        if (next === 'connecting') setReady(false)
        setStatus(next)
        setError(detail ?? '')
      },
    })
    connectionRef.current = provider

    provider.ready.then(() => {
      if (!active) return
      const view = new Y.Doc()
      Y.applyUpdate(view, Y.encodeStateAsUpdate(provider.ydoc), FROM_PROVIDER)
      viewRef.current = view
      const publish = () => {
        const next = { ...latestRef.current, ...workspaceToJSON<W>(view) }
        for (const key of excludedFields) {
          if (key in incomingRef.current) Object.assign(next, { [key]: (incomingRef.current as Record<string, unknown>)[key] })
        }
        latestRef.current = next
        setRawWorkspace(next)
      }
      const selectedText = () => {
        const key = editingRef.current
        if (!key) return undefined
        const parts = key.split(':')
        if (parts[0] === 'block-table' && parts.length === 4) return getCellText(view, parts[2], parts[3], parts[1])
        if (parts[0] === 'main' && parts.length === 3) return getCellText(view, parts[1], parts[2])
        if (parts.length === 2 && !['meta', 'column', 'block'].includes(parts[0])) return getCellText(view, parts[0], parts[1])
        return undefined
      }
      const receive = (update: Uint8Array) => {
        const input = document.activeElement
        const text = selectedText()
        const canSelect = (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) && input.selectionStart !== null && text
        const start = canSelect ? Y.createRelativePositionFromTypeIndex(text, Math.min(input.selectionStart!, text.length)) : null
        const end = canSelect ? Y.createRelativePositionFromTypeIndex(text, Math.min(input.selectionEnd!, text.length)) : null
        Y.applyUpdate(view, update, FROM_PROVIDER)
        if (start && end && canSelect) {
          const a = Y.createAbsolutePositionFromRelativePosition(start, view)
          const b = Y.createAbsolutePositionFromRelativePosition(end, view)
          if (a && b) selectionRef.current = { input, start: a.index, end: b.index }
        }
        publish()
      }
      const forward = (update: Uint8Array, origin: unknown) => {
        if (origin === FROM_PROVIDER) return
        Y.applyUpdate(provider.ydoc, update, FROM_VIEW)
      }
      const receiveProvider = (update: Uint8Array, origin: unknown) => {
        if (!active || origin === FROM_VIEW) return
        if (composingRef.current) queuedRef.current.push(update)
        else receive(update)
      }
      view.on('update', forward)
      provider.ydoc.on('update', receiveProvider)
      unsubscribe = () => {
        view.off('update', forward)
        provider.ydoc.off('update', receiveProvider)
      }
      completeCompositionRef.current = () => {
        composingRef.current = false
        const updates = queuedRef.current.splice(0)
        if (updates.length) receive(Y.mergeUpdates(updates))
      }
      publish()
      readyRef.current = true
      setReady(true)
    }).catch(cause => {
      if (!active) return
      setStatus('error')
      setError(cause instanceof Error ? cause.message : '공동 편집에 연결하지 못했습니다.')
    })
    const flushOnLeave = () => { void provider.flush().catch(() => {}) }
    const visibility = () => { if (document.visibilityState === 'hidden') flushOnLeave() }
    window.addEventListener('pagehide', flushOnLeave)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      readyRef.current = false
      unsubscribe()
      completeCompositionRef.current = () => {}
      window.removeEventListener('pagehide', flushOnLeave)
      document.removeEventListener('visibilitychange', visibility)
      const view = viewRef.current
      viewRef.current = null
      connectionRef.current = null
      void Promise.resolve(provider.destroy()).catch(() => {}).finally(() => view?.destroy())
    }
  }, [enabled, open, projectId, workspaceField, cycle, excluded, setRawWorkspace])

  useEffect(() => {
    if (!enabled || !open || status === 'saved') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [enabled, open, status])

  // T-2's rich document owns blocks; its projection must remain visible in exports.
  useEffect(() => {
    if (!enabled || !open || !excluded) return
    const fields = Object.fromEntries(excluded.split(',').map(key => [key, (incoming as Record<string, unknown>)[key]]))
    latestRef.current = { ...latestRef.current, ...fields }
    setRawWorkspace(current => ({ ...current, ...fields }))
  }, [enabled, open, excluded, incoming, setRawWorkspace])

  const setWorkspace: Dispatch<SetStateAction<W>> = update => {
    if (!enabled) { setRawWorkspace(update); return }
    const view = viewRef.current
    if (!readyRef.current || !view) return
    const before = typeof update === 'function' ? latestRef.current : workspace
    const next = typeof update === 'function' ? (update as (current: W) => W)(before) : update
    applyWorkspaceDiff(view, before, next, { excludeKeys })
    const projected = { ...next, ...workspaceToJSON<W>(view) }
    latestRef.current = projected
    setRawWorkspace(projected)
  }

  const flush = useCallback(async (): Promise<W> => {
    const provider = connectionRef.current
    if (!provider) throw new Error('공동 편집 연결을 확인해 주세요.')
    await provider.ready
    completeCompositionRef.current()
    await provider.flush()
    return { ...latestRef.current, ...provider.getWorkspace<W>() }
  }, [])

  return {
    enabled, ready: !enabled || ready, status, error, setWorkspace, flush,
    boundaryProps: enabled ? {
      onCompositionStartCapture: () => { composingRef.current = true },
      onCompositionEndCapture: () => { setTimeout(() => completeCompositionRef.current(), 0) },
      onBlurCapture: () => { if (composingRef.current) setTimeout(() => completeCompositionRef.current(), 0) },
    } : {},
  }
}

export function WorkspaceRealtimeStatus({ session, onClose }: {
  session: { enabled: boolean; ready: boolean; status: Status; error: string; flush: () => Promise<object> }
  onClose: () => void
}) {
  if (!session.enabled) return null
  if (!session.ready) return <div onClick={event => event.stopPropagation()} className="absolute inset-0 z-[9500] flex flex-col items-center justify-center gap-4 bg-white/95 p-6" role="status">
    <p>{session.error || '공동 편집 내용을 불러오는 중…'}</p>
    <button type="button" onClick={onClose} className="rounded-full border px-5 py-2">닫기</button>
  </div>
  return <div role="status" onClick={event => event.stopPropagation()} className="fixed bottom-2 left-1/2 z-[9500] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-xl border bg-white px-3 py-1 text-xs text-[#303134] shadow">
    {session.status === 'saved' ? '공동 편집 저장됨' : session.status === 'saving' ? '변경 내용 저장 중…' : session.status === 'offline' ? '연결 대기 · 입력을 기기에 보관 중' : session.error || '공동 편집 연결 중…'}
    {(session.status === 'error' || session.status === 'offline') && <button type="button" onClick={() => void session.flush().catch(() => {})} className="shrink-0 font-semibold text-[#174EA6]">다시 저장</button>}
  </div>
}

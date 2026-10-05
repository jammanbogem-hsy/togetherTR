'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import * as Y from 'yjs'
import { useProjectStore } from '@/store/project'
import { connectWorkspace } from '@/lib/coedit/firestore-workspace'
import { applyWorkspaceDiff, workspaceToJSON } from '@/lib/coedit/workspace-crdt'
import {
  captureWorkspaceSelection, resolveWorkspaceSelection, encodeWorkspaceCaret,
  resolveWorkspaceCaretLocation, resolveWorkspacePresenceCaret, workspaceFieldValue,
  resolveWorkspaceCaret, createSelectionRestoreGuard, type WorkspaceSelection, type SelectionDirection,
} from '@/lib/coedit/workspaceCursor'

type Status = 'connecting' | 'saved' | 'saving' | 'offline' | 'error'
type Connection = ReturnType<typeof connectWorkspace>
type TextInput = HTMLInputElement | HTMLTextAreaElement
const textInput = (element: EventTarget | null): element is TextInput =>
  (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.selectionStart !== null
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
  const selectionRef = useRef<{ input: TextInput; fieldKey: string; relative: WorkspaceSelection | null; start: number; end: number; direction: SelectionDirection } | null>(null)
  const activeFieldRef = useRef<{ input: TextInput; fieldKey: string } | null>(null)
  const selectionGuardRef = useRef(createSelectionRestoreGuard())
  const excluded = excludeKeys.join(',')
  useLayoutEffect(() => { incomingRef.current = incoming; editingRef.current = editingKey })

  const selectionTarget = useCallback(() => {
    const last = activeFieldRef.current
    const focused = (last?.input.ownerDocument ?? document).activeElement
    if (textInput(focused) && focused.isConnected) {
      const fieldKey = focused.dataset.workspaceField ?? (last?.input === focused ? last.fieldKey : undefined)
      if (fieldKey) return { input: focused, fieldKey }
    }
    // 비활성 iframe은 activeElement가 BODY여도 마지막 입력란의 선택을 유지한다.
    return last?.input.isConnected ? last : null
  }, [])

  useLayoutEffect(() => {
    const selection = selectionRef.current
    if (composingRef.current) return
    selectionRef.current = null
    const target = selectionTarget()
    if (selection && target?.input === selection.input && target.fieldKey === selection.fieldKey) {
      const view = viewRef.current
      const resolved = selection.relative && view ? resolveWorkspaceSelection(view, selection.relative) : null
      if (selection.relative && (!view || !resolved || resolveWorkspaceCaret(view, selection.fieldKey, selection.relative.start) === null)) return
      const start = resolved?.start ?? selection.start, end = resolved?.end ?? selection.end
      // Mark before setSelectionRange: some browsers emit select synchronously.
      selectionGuardRef.current.mark(selection.input, start, end)
      selection.input.setSelectionRange(start, end, resolved?.direction ?? selection.direction)
      selectionGuardRef.current.mark(selection.input, selection.input.selectionStart ?? start, selection.input.selectionEnd ?? end)
    }
  }, [workspace, selectionTarget])

  const captureSelection = useCallback((fieldKey: string, input: TextInput) => {
    if (!textInput(input) || !input.isConnected) return
    activeFieldRef.current = { input, fieldKey }
    const view = viewRef.current
    const start = input.selectionStart!, end = input.selectionEnd ?? start
    const direction = input.selectionDirection ?? 'none'
    const relative = view ? captureWorkspaceSelection(view, fieldKey, start, end, direction) : null
    selectionRef.current = { input, fieldKey, relative, start, end, direction }
  }, [])

  const shouldSendPresence = useCallback((input: TextInput) => selectionGuardRef.current.shouldSend(input), [])
  const encodeCaret = useCallback((fieldKey: string, offset: number): string | undefined => {
    const view = viewRef.current
    return view ? encodeWorkspaceCaret(view, fieldKey, offset) ?? undefined : undefined
  }, [])
  const resolveCaret = useCallback((fieldKey: string, relativeCaret?: string, fallbackOffset?: number): number | undefined =>
    resolveWorkspacePresenceCaret(viewRef.current, fieldKey, relativeCaret, fallbackOffset), [])
  const resolveCaretLocation = useCallback((fieldKey: string, encoded: string) =>
    viewRef.current ? resolveWorkspaceCaretLocation(viewRef.current, fieldKey, encoded) : null, [])
  const fieldProps = useCallback((fieldKey: string) => ({ 'data-workspace-field': fieldKey }), [])

  const inputField = (input: TextInput): string | undefined => input.dataset.workspaceField
    ?? (activeFieldRef.current?.input === input ? activeFieldRef.current.fieldKey : undefined)
    ?? editingRef.current ?? undefined
  const captureEvent = (target: EventTarget | null) => {
    if (!textInput(target) || !shouldSendPresence(target)) return
    const key = inputField(target)
    if (!key) return
    const view = viewRef.current, pending = selectionRef.current
    // Several updates may precede React's commit. DOM still has the old value:
    // retain its original relative selection instead of anchoring that old offset twice.
    if (pending?.input === target && pending.fieldKey === key && view && workspaceFieldValue(view, key) !== target.value) return
    captureSelection(key, target)
  }
  const userInputEvent = (target: EventTarget | null) => {
    if (!textInput(target)) return
    selectionGuardRef.current.clear(target)
    selectionRef.current = null
    const key = inputField(target)
    if (key) activeFieldRef.current = { input: target, fieldKey: key }
  }

  useEffect(() => {
    if (!enabled || !open || !projectId) return
    let active = true
    let unsubscribe = () => {}
    const excludedFields = excluded ? excluded.split(',') : []
    readyRef.current = false
    composingRef.current = false
    queuedRef.current = []
    selectionRef.current = null
    activeFieldRef.current = null
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
      const receive = (update: Uint8Array) => {
        const target = selectionTarget()
        if (target) {
          const { input, fieldKey } = target
          if (!(selectionRef.current?.input === input && selectionRef.current.fieldKey === fieldKey)) captureSelection(fieldKey, input)
        }
        Y.applyUpdate(view, update, FROM_PROVIDER)
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
      selectionRef.current = null
      activeFieldRef.current = null
      unsubscribe()
      completeCompositionRef.current = () => {}
      window.removeEventListener('pagehide', flushOnLeave)
      document.removeEventListener('visibilitychange', visibility)
      const view = viewRef.current
      viewRef.current = null
      connectionRef.current = null
      void Promise.resolve(provider.destroy()).catch(() => {}).finally(() => view?.destroy())
    }
  }, [enabled, open, projectId, workspaceField, cycle, excluded, setRawWorkspace, captureSelection, selectionTarget])

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
    selectionRef.current = null
    applyWorkspaceDiff(view, before, next, { excludeKeys })
    const input = document.activeElement
    if (textInput(input)) {
      const key = inputField(input)
      if (key && !composingRef.current) captureSelection(key, input)
    }
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
    encodeCaret, resolveCaret, resolveCaretLocation, captureSelection, shouldSendPresence, fieldProps,
    boundaryProps: enabled ? {
      onFocusCapture: (event: { target: EventTarget | null }) => { userInputEvent(event.target); captureEvent(event.target) },
      onSelectCapture: (event: { target: EventTarget | null }) => captureEvent(event.target),
      onBeforeInputCapture: (event: { target: EventTarget | null }) => userInputEvent(event.target),
      onInputCapture: (event: { target: EventTarget | null }) => userInputEvent(event.target),
      onPointerDownCapture: (event: { target: EventTarget | null }) => userInputEvent(event.target),
      onKeyDownCapture: (event: { target: EventTarget | null }) => userInputEvent(event.target),
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

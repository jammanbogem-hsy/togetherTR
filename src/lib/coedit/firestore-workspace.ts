import * as Y from 'yjs'
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { applyWorkspacePatch, seedWorkspace, workspaceToJSON, type WorkspaceOptions } from './workspace-crdt'
import { isBlankWorkspace } from './workspaceBlank'

export const WORKSPACE_CRDT_FIELD = 'coeditWorkspaceCrdt'
export const WORKSPACE_THROTTLE_MS = 250
export const WORKSPACE_STATE_LIMIT = 240_000
export const WORKSPACE_PROJECT_LIMIT = 900_000
const fields = new Set([
  'teamVisionWorkspace', 'lessonDesignDirectionWorkspace', 'roleDistributionWorkspace', 'teamRulesWorkspace', 'teamScheduleWorkspace',
  'topicSelectionWorkspace', 'integratedGoalWorkspace', 'evaluationPlanWorkspace', 'problemSituationWorkspace', 'learningActivityWorkspace',
  'supportToolWorkspace', 'scaffoldingWorkspace', 'materialDevWorkspace', 'lessonRecordWorkspace', 'lessonReflectionWorkspace', 'collaborationReflectionWorkspace',
])
type ProjectData = Record<string, unknown>
interface StoredState { version: 1; cycle: number; state: string }
export type WorkspaceStatus = 'connecting' | 'saved' | 'saving' | 'offline' | 'error'
export interface WorkspaceTransaction<T> { updates: ProjectData; value: T }
/** Injectable transport for deterministic concurrency/offline tests; production uses Firestore transactions. */
export interface WorkspaceTransport {
  transact<T>(change: (project: ProjectData) => WorkspaceTransaction<T>): Promise<T>
  subscribe(next: (project: ProjectData) => void, error: (error: unknown) => void): () => void
}
export interface ConnectWorkspaceOptions extends WorkspaceOptions {
  projectId: string
  workspaceField: string
  initialWorkspace: object
  cycle?: number
  onStatus?: (status: WorkspaceStatus, detail?: string) => void
  transport?: WorkspaceTransport
  uid?: string
  storage?: Storage | null
  throttleMs?: number
  retryMs?: number
  maxStateBytes?: number
  maxProjectBytes?: number
}

class WorkspaceError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
const object = (value: unknown): ProjectData => value && typeof value === 'object' && !Array.isArray(value) ? value as ProjectData : {}
export function encodeWorkspaceState(bytes: Uint8Array): string {
  // Chunked conversion avoids a call-stack overflow on large updates.
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}
export const decodeWorkspaceState = (state: string): Uint8Array => Uint8Array.from(atob(state), char => char.charCodeAt(0))
function applyStoredState(doc: Y.Doc, state: string): void {
  try { Y.applyUpdate(doc, decodeWorkspaceState(state)) }
  catch { throw new WorkspaceError('invalid-argument', '공동 편집 저장 상태를 읽지 못했습니다. 입력과 임시 기록을 보존한 뒤 관리자에게 문의해 주세요.') }
}

/** Conservative UTF-8 estimate with field/map overhead, below Firestore's 1 MiB document limit. */
export function estimateProjectBytes(project: object): number {
  let nodes = 0
  const count = (value: unknown) => {
    nodes++
    if (Array.isArray(value)) value.forEach(count)
    else if (value && typeof value === 'object' && !(value instanceof Date)) Object.values(value).forEach(count)
  }
  count(project)
  return new TextEncoder().encode(JSON.stringify(project)).length + nodes * 32 + 256
}

function assertAccess(project: ProjectData, uid: string, expectedCycle?: number): number {
  if (!uid || (project.createdBy !== uid && project.hostUid !== uid && !(Array.isArray(project.memberUids) && project.memberUids.includes(uid)))) throw new WorkspaceError('permission-denied', '프로젝트 팀원만 편집할 수 있습니다.')
  if (object(project.trainingMode).enabled !== true) throw new WorkspaceError('disabled', '연수용 프로젝트에서만 실시간 표 편집을 사용할 수 있습니다.')
  const cycle = typeof project.currentCycle === 'number' ? project.currentCycle : 1
  if (expectedCycle !== undefined && cycle !== expectedCycle) throw new WorkspaceError('cycle-changed', '활동 주기가 변경되었습니다. 입력을 복사한 뒤 편집 창을 다시 열어 주세요.')
  return cycle
}

export function firestoreTransport(projectId: string, sdk = { doc, onSnapshot, runTransaction, serverTimestamp }, database = db): WorkspaceTransport {
  const ref = sdk.doc(database, 'projects', projectId)
  return {
    transact: change => sdk.runTransaction(database, async tx => {
      const snapshot = await tx.get(ref)
      if (!snapshot.exists()) throw new WorkspaceError('not-found', '프로젝트가 없습니다.')
      const result = change(snapshot.data())
      if (Object.keys(result.updates).length) tx.update(ref, { ...result.updates, updatedAt: sdk.serverTimestamp() })
      return result.value
    }),
    subscribe: (next, error) => sdk.onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
      // 캐시·미확정 쓰기는 서버 상태로 판정하지 않고, metadata-only ack까지 기다린다.
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
      if (snapshot.exists()) next(snapshot.data())
      else error(new WorkspaceError('not-found', '프로젝트가 없습니다.'))
    }, error),
  }
}

/** Pure transaction body: concurrent writers merge into the current state, never a cached JSON string. */
export function mergeWorkspaceTransaction(project: ProjectData, options: Pick<ConnectWorkspaceOptions, 'workspaceField' | 'initialWorkspace' | 'excludeFields' | 'excludeKeys' | 'maxStateBytes' | 'maxProjectBytes'>, cycle: number, update?: Uint8Array): WorkspaceTransaction<{ state: Uint8Array; workspace: ProjectData; cycle: number }> {
  const all = object(project[WORKSPACE_CRDT_FIELD])
  const current = all[options.workspaceField] as StoredState | undefined
  const merged = new Y.Doc()
  try {
    if (current?.cycle === cycle) {
      if (current.version !== 1 || typeof current.state !== 'string' || !current.state) throw new WorkspaceError('invalid-argument', '공동 편집 저장 형식이 달라 자동으로 초기화하지 않았습니다. 관리자에게 문의해 주세요.')
      applyStoredState(merged, current.state)
    }
    else {
      if (update) throw new WorkspaceError('cycle-changed', '저장 기준이 바뀌었습니다. 편집 창을 다시 열어 주세요.')
      const legacy = object(project[options.workspaceField])
      const ignored = new Set([...(options.excludeFields ?? []), ...(options.excludeKeys ?? [])])
      const owned = Object.fromEntries(Object.entries(legacy).filter(([key]) => !ignored.has(key)))
      seedWorkspace(merged, isBlankWorkspace(owned) ? options.initialWorkspace : legacy, options)
    }
    if (update) Y.applyUpdate(merged, update)
    const state = Y.encodeStateAsUpdate(merged), encoded = encodeWorkspaceState(state)
    if (encoded.length > Math.min(options.maxStateBytes ?? WORKSPACE_STATE_LIMIT, WORKSPACE_STATE_LIMIT)) throw new WorkspaceError('resource-exhausted', '표 편집 용량 한도입니다. 입력을 복사해 보관한 뒤 관리자에게 문의해 주세요.')
    const workspace = workspaceToJSON<ProjectData>(merged)
    const legacy = object(project[options.workspaceField])
    for (const key of [...(options.excludeFields ?? []), ...(options.excludeKeys ?? [])]) {
      delete workspace[key]
      if (Object.hasOwn(legacy, key)) workspace[key] = legacy[key]
    }
    const entry: StoredState = { version: 1, cycle, state: encoded }
    const next = { ...project, [WORKSPACE_CRDT_FIELD]: { ...all, [options.workspaceField]: entry }, [options.workspaceField]: workspace }
    if (estimateProjectBytes(next) > Math.min(options.maxProjectBytes ?? WORKSPACE_PROJECT_LIMIT, WORKSPACE_PROJECT_LIMIT)) throw new WorkspaceError('resource-exhausted', '프로젝트 저장 용량 한도입니다. 입력을 복사해 보관한 뒤 관리자에게 문의해 주세요.')
    const changed = !current || current.cycle !== cycle || current.state !== encoded || JSON.stringify(legacy) !== JSON.stringify(workspace)
    return { updates: changed ? { [`${WORKSPACE_CRDT_FIELD}.${options.workspaceField}`]: entry, [options.workspaceField]: workspace } : {}, value: { state, workspace, cycle } }
  } finally { merged.destroy() }
}

/** Project fields are member-writable under the existing deny-list rules. No subcollection/rule rollout required. */
export function connectWorkspace(options: ConnectWorkspaceOptions) {
  if (!fields.has(options.workspaceField)) throw new WorkspaceError('invalid-argument', '공동 편집 필드가 올바르지 않습니다.')
  const uid = options.uid ?? auth.currentUser?.uid ?? ''
  const transport = options.transport ?? firestoreTransport(options.projectId)
  const ydoc = new Y.Doc()
  const remoteOrigin = Symbol('workspace-remote')
  let storage: Storage | null = options.storage ?? null
  if (options.storage === undefined) { try { storage = typeof localStorage === 'undefined' ? null : localStorage } catch { /* memory queue still works */ } }
  let cycle = options.cycle ?? 1, key = '', initialized = false, closing = false, destroyed = false
  let pending: Uint8Array | null = null, sending: Uint8Array | null = null
  let timer: ReturnType<typeof setTimeout> | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null, initializing: Promise<void> | null = null, destroyPromise: Promise<void> | null = null
  let verifyingSnapshot: Promise<void> | null = null
  let retries = 0, preserved: ProjectData = {}, unsubscribe = () => {}
  const recovered = new Map<string, string>(), listeners = new Set<() => void>()
  let resolveReady!: () => void, rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Mark as handled even if the caller closes before attaching its own catch.
  void ready.catch(() => {})
  const status = (value: WorkspaceStatus, detail?: string) => { if (!closing) options.onStatus?.(value, detail) }
  const notify = () => { if (!closing) for (const listener of listeners) listener() }
  const errorCode = (error: unknown) => typeof object(error).code === 'string' ? object(error).code as string : ''
  const permanent = (error: unknown) => ['permission-denied', 'unauthenticated', 'not-found', 'disabled', 'cycle-changed', 'resource-exhausted', 'invalid-argument'].includes(errorCode(error).replace(/^firestore\//, ''))
  const report = (error: unknown) => status(permanent(error) ? 'error' : 'offline', error instanceof Error ? error.message : '표 저장에 실패했습니다. 연결 후 다시 시도해 주세요.')
  const rememberExcluded = (workspace: ProjectData) => {
    preserved = Object.fromEntries([...(options.excludeFields ?? []), ...(options.excludeKeys ?? [])].filter(field => Object.hasOwn(workspace, field)).map(field => [field, workspace[field]]))
  }
  const getWorkspace = <T extends object = ProjectData>(): T => {
    const workspace = workspaceToJSON<ProjectData>(ydoc)
    for (const field of [...(options.excludeFields ?? []), ...(options.excludeKeys ?? [])]) delete workspace[field]
    return { ...workspace, ...preserved } as T
  }
  const backup = () => {
    if (!storage || !key) return
    try {
      if (pending || sending) storage.setItem(key, encodeWorkspaceState(Y.encodeStateAsUpdate(ydoc)))
      else storage.removeItem(key)
    } catch { status('error', '브라우저 임시 저장 공간이 부족합니다. 창을 닫지 말고 저장을 재시도해 주세요.') }
  }
  const retry = () => {
    if (closing || retryTimer) return
    const delay = Math.min((options.retryMs ?? 1000) * 2 ** retries++, 10_000)
    retryTimer = setTimeout(() => { retryTimer = undefined; void (initialized ? flush() : initialize()).catch(() => {}) }, delay)
  }
  const schedule = () => {
    // Throttle, not debounce: ongoing typing does not keep pushing the deadline back.
    if (closing || timer) return
    timer = setTimeout(() => { timer = undefined; void flush().catch(() => {}) }, Math.min(options.throttleMs ?? WORKSPACE_THROTTLE_MS, WORKSPACE_THROTTLE_MS))
  }
  const handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== remoteOrigin && !closing) {
      pending = pending ? Y.mergeUpdates([pending, update]) : update
      status('saving'); backup()
      if (initialized) schedule()
    }
    notify()
  }
  ydoc.on('update', handleUpdate)

  const verifySnapshot = () => {
    // 서버 표시가 있는 알림도 seed transaction보다 오래된 상태일 수 있다.
    // flush의 권위 transaction에서 재확인하고, 동시 알림은 같은 확인을 기다린다.
    if (closing || verifyingSnapshot) return
    verifyingSnapshot = Promise.resolve().then(() => {
      if (!closing) return flush()
    }).catch(() => { /* flush가 실제 서버 오류를 보고하고 입력을 보존한다. */ })
      .finally(() => { verifyingSnapshot = null })
  }

  async function initialize(): Promise<void> {
    if (closing || initialized) return
    if (initializing) return initializing
    initializing = (async () => {
      try {
        status('connecting')
        const initial = await transport.transact(project => {
          const foundCycle = assertAccess(project, uid, options.cycle)
          return mergeWorkspaceTransaction(project, options, foundCycle)
        })
        if (closing) return
        cycle = initial.cycle
        const prefix = `tcid-workspace:v1:${encodeURIComponent(uid)}:${encodeURIComponent(options.projectId)}:${encodeURIComponent(options.workspaceField)}:${cycle}:`
        key = `${prefix}${ydoc.clientID}`
        rememberExcluded(initial.workspace)
        Y.applyUpdate(ydoc, initial.state, remoteOrigin)
        if (storage) {
          try {
            const keys = Array.from({ length: storage.length }, (_, i) => storage!.key(i)).filter((item): item is string => !!item && item.startsWith(prefix))
            for (const recoveryKey of keys) {
              const value = storage.getItem(recoveryKey)
              if (!value) continue
              try {
                const update = decodeWorkspaceState(value)
                Y.applyUpdate(ydoc, update, remoteOrigin)
                pending = pending ? Y.mergeUpdates([pending, update]) : update
                recovered.set(recoveryKey, value)
              } catch { status('error', '저장되지 않은 편집을 복구하지 못했습니다. 브라우저 임시 기록을 보존했습니다.') }
            }
          } catch { status('error', '브라우저 임시 기록에 접근하지 못했습니다. 창을 닫기 전에 저장해 주세요.') }
        }
        initialized = true; retries = 0
        unsubscribe = transport.subscribe(project => {
          try {
            assertAccess(project, uid, cycle)
            const current = object(project[WORKSPACE_CRDT_FIELD])[options.workspaceField] as StoredState | undefined
            if (current?.version !== 1 || current.cycle !== cycle || !current.state) throw new WorkspaceError('cycle-changed', '편집 상태가 바뀌었습니다. 창을 다시 열어 주세요.')
            rememberExcluded(object(project[options.workspaceField]))
            try { Y.applyUpdate(ydoc, decodeWorkspaceState(current.state), remoteOrigin) }
            catch { throw new WorkspaceError('invalid-argument', '공동 편집 저장 상태를 읽지 못했습니다. 임시 기록을 보존했습니다.') }
            notify()
          } catch { verifySnapshot() }
        }, error => {
          if (errorCode(error).replace(/^firestore\//, '') === 'not-found') verifySnapshot()
          else report(error)
        })
        backup(); resolveReady(); status(pending ? 'saving' : 'saved')
        if (pending) schedule()
      } catch (error) {
        report(error)
        if (permanent(error)) rejectReady(error)
        else retry()
        throw error
      } finally { initializing = null }
    })()
    return initializing
  }

  async function flush(): Promise<void> {
    if (destroyed) throw new WorkspaceError('closed', '편집 연결이 종료되었습니다.')
    if (timer) { clearTimeout(timer); timer = undefined }
    await ready
    if (inFlight) { await inFlight; if (pending) return flush(); return }
    sending = pending; pending = null
    if (sending) status('saving')
    inFlight = (async () => {
      try {
        const result = await transport.transact(project => {
          assertAccess(project, uid, cycle)
          const current = object(project[WORKSPACE_CRDT_FIELD])[options.workspaceField] as StoredState | undefined
          if (current?.version !== 1 || current.cycle !== cycle || !current.state) throw new WorkspaceError('cycle-changed', '편집 기준이 바뀌었습니다. 입력을 복사한 뒤 편집 창을 다시 열어 주세요.')
          return mergeWorkspaceTransaction(project, options, cycle, sending ?? undefined)
        })
        rememberExcluded(result.workspace)
        Y.applyUpdate(ydoc, result.state, remoteOrigin)
        for (const [recoveryKey, value] of recovered) {
          try { if (storage?.getItem(recoveryKey) === value) storage.removeItem(recoveryKey) } catch { /* idempotent recovery is safe next time */ }
        }
        recovered.clear(); retries = 0
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined }
        status(pending ? 'saving' : 'saved')
        notify()
      } catch (error) {
        if (sending) pending = pending ? Y.mergeUpdates([sending, pending]) : sending
        report(error)
        if (!permanent(error)) retry()
        throw error
      } finally { sending = null; inFlight = null; backup() }
    })()
    await inFlight
    if (pending) await flush()
  }

  const online = () => { if (!closing) void (initialized ? flush() : initialize()).catch(() => {}) }
  const pagehide = () => backup()
  if (typeof window !== 'undefined') { window.addEventListener('online', online); window.addEventListener('pagehide', pagehide) }
  void initialize().catch(() => {})
  return {
    ydoc, ready, remoteOrigin, getWorkspace, flush,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    applyPatch(patch: object) {
      if (!initialized || closing) throw new WorkspaceError('not-ready', '표 연결이 완료된 뒤 입력해 주세요.')
      applyWorkspacePatch(ydoc, patch, options)
    },
    destroy(): Promise<void> {
      if (destroyPromise) return destroyPromise
      closing = true; unsubscribe()
      if (timer) clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
      if (typeof window !== 'undefined') { window.removeEventListener('online', online); window.removeEventListener('pagehide', pagehide) }
      if (!initialized) rejectReady(new WorkspaceError('closed', '편집 연결이 종료되었습니다.'))
      destroyPromise = (async () => {
        try { if (initialized && (pending || inFlight)) await flush() }
        finally { backup(); destroyed = true; listeners.clear(); ydoc.off('update', handleUpdate); ydoc.destroy() }
      })()
      return destroyPromise
    },
  }
}

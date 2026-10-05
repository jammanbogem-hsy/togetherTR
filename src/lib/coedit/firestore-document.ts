import * as Y from 'yjs'
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { mergedDocument, seedDocument } from './document'
import type { TeamVisionWorkspaceBlock } from '../../types/index'

const WORKSPACE = 'lessonDesignDirectionWorkspace'
const FIELD = 'lessonDesignDirectionDocument'
const encode = (data: Uint8Array) => btoa(Array.from(data, x => String.fromCharCode(x)).join(''))
const decode = (data: string) => Uint8Array.from(atob(data), x => x.charCodeAt(0))
export type DocumentStatus = 'connecting' | 'saved' | 'saving' | 'error'
export const DOCUMENT_FLUSH_THROTTLE_MS = 250

/**
 * 본문 저장 예약 — throttle: 예약이 없을 때만 ms 뒤 실행을 잡는다(이미 잡혀 있으면 그대로 둠).
 * 예전에는 입력마다 타이머를 지우고 다시 잡아(debounce) 계속 타이핑하면 저장·원격 표시가 멈췄다(#R3 검토).
 */
export function createFlushThrottle(run: () => void, ms = DOCUMENT_FLUSH_THROTTLE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    schedule() {
      if (timer) return
      timer = setTimeout(() => { timer = undefined; run() }, ms)
    },
    /** 바로 저장하기 직전에 부른다 — 잡혀 있던 예약을 지우고 다음 입력이 새로 예약할 수 있게 */
    cancel() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    get scheduled() { return timer !== undefined },
  }
}

/** Transactional Yjs state merge; plain blocks are a compatibility projection,
 * not the source of truth. No overwrite of other workspace cells. */
export function connectDocument(projectId: string, onStatus: (status: DocumentStatus, error?: string) => void) {
  const ydoc = new Y.Doc()
  const ref = doc(db, 'projects', projectId)
  const uid = auth.currentUser?.uid
  let cycle = 1
  let key = ''
  const recoveredKeys = new Map<string, string>()
  let pending: Uint8Array | null = null
  const throttle = createFlushThrottle(() => { void flush().catch(() => {}) })
  let inFlight: Promise<void> | null = null
  let stopped = false
  let unsubscribe = () => {}
  const remote = Symbol('remote')
  const reportError = (error: unknown) => onStatus('error', error instanceof Error ? error.message : '문서 저장 실패')
  const backup = () => {
    if (!key) return
    // Include in-flight changes too, so a reload cannot lose an unacknowledged write.
    if (pending || inFlight) localStorage.setItem(key, encode(Y.encodeStateAsUpdate(ydoc)))
    else localStorage.removeItem(key)
  }

  async function flush(): Promise<void> {
    throttle.cancel()
    if (inFlight) { await inFlight; if (pending) return flush(); return }
    if (!pending) return
    const sending = pending
    pending = null
    onStatus('saving')
    inFlight = (async () => {
      try {
        const committed = await runTransaction(db, async tx => {
          const snap = await tx.get(ref)
          if (!snap.exists()) throw new Error('프로젝트가 없습니다.')
          const data = snap.data()
          if ((data.currentCycle ?? 1) !== cycle) throw new Error('활동 주기가 변경되었습니다. 문서를 다시 열어주세요.')
          const state = data[FIELD]?.state
          if (!state) throw new Error('문서 상태가 없습니다. 문서를 다시 열어주세요.')
          const merged = mergedDocument(decode(state), sending)
          const encoded = encode(merged.state)
          if (encoded.length > 350_000) throw new Error('문서 용량 한도입니다. 입력 내용을 복사한 뒤 관리자에게 문의하세요.')
          tx.update(ref, {
            [`${FIELD}.state`]: encoded,
            [WORKSPACE]: {
              columns: [{ id: 'principle', label: '설계 원칙' }, { id: 'rationale', label: '근거' }],
              rows: [],
              ...data[WORKSPACE],
              blocks: merged.blocks,
            },
            updatedAt: serverTimestamp(),
          })
          return merged.state
        })
        if (!stopped) Y.applyUpdate(ydoc, committed, remote)
        backup()
        for (const [recoveredKey, value] of recoveredKeys) {
          if (localStorage.getItem(recoveredKey) === value) localStorage.removeItem(recoveredKey)
        }
        recoveredKeys.clear()
        onStatus(pending ? 'saving' : 'saved')
      } catch (error) {
        pending = pending ? Y.mergeUpdates([sending, pending]) : sending
        try { backup() } catch { /* pending remains in memory */ }
        reportError(error)
        throw error
      } finally {
        inFlight = null
        try { backup() } catch { /* memory queue remains available for retry */ }
      }
    })()
    await inFlight
    if (pending) await flush()
  }

  const ready = (async () => {
    if (!uid) throw new Error('로그인이 필요합니다.')
    onStatus('connecting')
    const initial = await runTransaction(db, async tx => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('프로젝트가 없습니다.')
      const data = snap.data()
      if (data.createdBy !== uid && data.hostUid !== uid && !(data.memberUids ?? []).includes(uid)) throw new Error('프로젝트 팀원만 편집할 수 있습니다.')
      const currentCycle = data.currentCycle ?? 1
      if (data[FIELD]?.state && data[FIELD]?.cycle === currentCycle) return { state: data[FIELD].state as string, cycle: currentCycle }
      const blocks = (data[WORKSPACE]?.blocks ?? []) as TeamVisionWorkspaceBlock[]
      const state = encode(seedDocument(blocks))
      // The original blocks stay untouched; migration backup is kept separately.
      tx.update(ref, { [FIELD]: { state, cycle: currentCycle, originalBlocks: blocks }, updatedAt: serverTimestamp() })
      return { state, cycle: currentCycle }
    })
    if (stopped) return
    cycle = initial.cycle
    const prefix = `tcid-document:${uid}:${projectId}:${cycle}:`
    key = `${prefix}${ydoc.clientID}`
    Y.applyUpdate(ydoc, decode(initial.state), remote)
    // Each editor owns its recovery key: two offline tabs must not overwrite
    // each other's pending updates. Recover all old keys idempotently.
    for (let i = 0; i < localStorage.length; i++) {
      const recoveredKey = localStorage.key(i)
      if (!recoveredKey?.startsWith(prefix)) continue
      const recovered = localStorage.getItem(recoveredKey)
      if (!recovered) continue
      const update = decode(recovered)
      pending = pending ? Y.mergeUpdates([pending, update]) : update
      Y.applyUpdate(ydoc, update, remote)
      recoveredKeys.set(recoveredKey, recovered)
    }
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === remote) return
      pending = pending ? Y.mergeUpdates([pending, update]) : update
      onStatus('saving')
      try { backup() } catch { onStatus('error', '브라우저 임시 저장 공간이 부족합니다. 창을 닫지 말고 저장을 재시도하세요.') }
      // throttle: 계속 입력해도 250ms마다 저장(보내는 중이면 flush 가 기다렸다 이어서 보냄 — pending 은 합쳐 보존)
      throttle.schedule()
    })
    unsubscribe = onSnapshot(ref, snap => {
      const data = snap.data()
      if ((data?.currentCycle ?? 1) !== cycle) { onStatus('error', '활동 주기가 변경되었습니다. 문서를 다시 열어주세요.'); return }
      if (data?.[FIELD]?.state) Y.applyUpdate(ydoc, decode(data[FIELD].state), remote)
    }, reportError)
    if (pending) await flush()
    else onStatus('saved')
  })()
  ready.catch(reportError)
  return {
    ydoc, ready, flush,
    destroy() {
      stopped = true
      unsubscribe()
      throttle.cancel()
      void flush().catch(() => {}).finally(() => ydoc.destroy())
    },
  }
}

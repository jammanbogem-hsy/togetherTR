export const PRESENCE_THROTTLE_MS = 250

type PresenceEntry = {
  uid?: string; displayName?: string; color?: string; cellKey?: string
  caretPos?: number; updatedAt?: number
}

/** 같은 위치라도 heartbeat·이름·색이 바뀌면 구독 상태를 갱신한다. */
export function samePresenceEntry(a: PresenceEntry | undefined, b: PresenceEntry): boolean {
  return !!a && a.uid === b.uid && a.displayName === b.displayName && a.color === b.color
    && a.cellKey === b.cellKey && a.caretPos === b.caretPos && a.updatedAt === b.updatedAt
}

/** 키별 leading + 최신 trailing 송신. 삭제는 대기 입력을 취소하고 진행 중 쓰기 뒤에 실행한다. */
export function createPresenceThrottle<T>(intervalMs = PRESENCE_THROTTLE_MS) {
  type Waiter = { resolve: () => void; reject: (error: unknown) => void }
  type Batch = { value: T | null; waiters: Waiter[] }
  type Slot = {
    queue: Batch[]; active: boolean; lastStarted: number
    timer?: ReturnType<typeof setTimeout>
    write: (value: T | null) => Promise<void>
  }
  const slots = new Map<string, Slot>()

  function pump(key: string, slot: Slot): void {
    if (slot.active || slot.timer) return
    const next = slot.queue[0]
    const delay = Math.max(0, slot.lastStarted + intervalMs - Date.now())
    if (!next) {
      if (!delay) { slots.delete(key); return }
      slot.timer = setTimeout(() => { slot.timer = undefined; pump(key, slot) }, delay)
      return
    }
    if (next.value !== null && delay) {
      slot.timer = setTimeout(() => { slot.timer = undefined; pump(key, slot) }, delay)
      return
    }
    slot.queue.shift()
    slot.active = true
    if (next.value !== null) slot.lastStarted = Date.now()
    const write = slot.write
    void Promise.resolve().then(() => write(next.value)).then(
      () => { for (const waiter of next.waiters) waiter.resolve() },
      error => { for (const waiter of next.waiters) waiter.reject(error) },
    ).finally(() => { slot.active = false; pump(key, slot) })
  }

  return (key: string, value: T | null, write: (value: T | null) => Promise<void>): Promise<void> => {
    let slot = slots.get(key)
    if (!slot) {
      slot = { queue: [], active: false, lastStarted: -Infinity, write }
      slots.set(key, slot)
    }
    slot.write = write
    if (slot.timer) { clearTimeout(slot.timer); slot.timer = undefined }
    const deleteWaiters: Waiter[] = []
    if (value === null) {
      // 취소된 trailing 호출도 완료시킨다. 삭제 호출은 실제 삭제 완료까지 기다린다.
      for (const batch of slot.queue) {
        if (batch.value === null) deleteWaiters.push(...batch.waiters)
        else for (const waiter of batch.waiters) waiter.resolve()
      }
      slot.queue = []
    }
    const promise = new Promise<void>((resolve, reject) => {
      const previous = slot!.queue.at(-1)
      if (value !== null && previous && previous.value !== null) {
        previous.value = value
        previous.waiters.push({ resolve, reject })
      } else slot!.queue.push({ value, waiters: [...deleteWaiters, { resolve, reject }] })
    })
    pump(key, slot)
    return promise
  }
}

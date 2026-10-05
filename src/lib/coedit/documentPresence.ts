// T-1-2 공동 문서 본문의 '다른 사람 작업 위치'(구글 문서식 커서·선택 영역) — #R3.
// y-tiptap 의 yCursorPlugin 은 y-protocols Awareness 를 기대하지만, 이 앱 문서는 Firestore 로 동기화돼
// awareness 를 실어 나를 통로가 없다. 그래서 같은 인터페이스(getStates·getLocalState·setLocalStateField·on/off)를
// Firestore presence 문서(projects/{id}/lessonDesignDirectionDocumentPresence/{uid})로 구현한 어댑터를 둔다.
// 위치 변환(절대↔Y.RelativePosition)과 Decoration 그리기는 y-tiptap 코드를 그대로 쓴다.
//  - 보내기: 200ms throttle(앞·뒤), 10초 heartbeat, 닫기·페이지 이탈 때 문서 삭제
//  - 받기: 30초 넘게 신호 없는 사람은 시계로 숨김, 한글 조합 중에는 화면 갱신을 미뤘다 끝나면 반영

export const DOCUMENT_PRESENCE_COLLECTION = 'lessonDesignDirectionDocumentPresence'
export const DOCUMENT_PRESENCE_THROTTLE_MS = 200
export const DOCUMENT_PRESENCE_HEARTBEAT_MS = 10_000
export const DOCUMENT_PRESENCE_STALE_MS = 30_000

export interface DocumentCursorJson { anchor: unknown; head: unknown }

/** Firestore 에 저장되는 한 사람의 본문 위치 */
export interface DocumentPresenceRecord {
  uid: string
  displayName: string
  color: string
  cursor: DocumentCursorJson | null
  updatedAt: number
}

export interface DocumentPresenceTransport {
  write(record: DocumentPresenceRecord): Promise<unknown> | void
  remove(): Promise<unknown> | void
  subscribe(onRecords: (records: DocumentPresenceRecord[]) => void): () => void
}

export interface DocumentPresenceUser { uid: string; displayName: string; color: string }

/** uid → 안정적인 정수 id(awareness 의 clientId 자리). 같은 uid 는 늘 같은 값. */
export function presenceClientId(uid: string): number {
  let hash = 2166136261
  for (let i = 0; i < uid.length; i++) hash = Math.imul(hash ^ uid.charCodeAt(i), 16777619) >>> 0
  return hash || 1
}

type Listener = (...args: unknown[]) => void

/**
 * yCursorPlugin 용 awareness 어댑터. 로컬 커서는 throttle 해 transport.write, 원격은 transport.subscribe 로 받는다.
 * now·타이머는 테스트에서 바꿀 수 있게 주입한다.
 */
export class FirestoreDocumentAwareness {
  private local: { user: { name: string; color: string }; cursor: DocumentCursorJson | null }
  private remote: DocumentPresenceRecord[] = []
  private listeners = new Set<Listener>()
  private lastSent = 0
  private trailing: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private clock: ReturnType<typeof setInterval> | null = null
  private unsubscribe: (() => void) | null = null
  private deferred = false
  private lastVisibleKey = ''
  private destroyed = false

  private readonly user: DocumentPresenceUser
  private readonly transport: DocumentPresenceTransport
  private readonly options: { now?: () => number; isComposing?: (() => boolean) }

  constructor(
    user: DocumentPresenceUser,
    transport: DocumentPresenceTransport,
    options: { now?: () => number; isComposing?: (() => boolean) } = {},
  ) {
    this.user = user
    this.transport = transport
    this.options = options
    this.local = { user: { name: user.displayName || '팀원', color: user.color }, cursor: null }
  }

  private now() { return this.options.now?.() ?? Date.now() }

  /** 구독·heartbeat 시작. destroy 뒤 다시 불러도 된다(React 개발 모드의 effect 두 번 실행 대비). */
  start() {
    this.destroyed = false
    this.unsubscribe?.()
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.clock) clearInterval(this.clock)
    this.unsubscribe = this.transport.subscribe(records => {
      if (this.destroyed) return // 정리된 뒤 늦게 도착한 스냅숏은 무시
      this.remote = records.filter(record => record && record.uid !== this.user.uid)
      this.emit()
    })
    this.heartbeat = setInterval(() => { if (this.local.cursor) this.send() }, DOCUMENT_PRESENCE_HEARTBEAT_MS)
    // 신호가 끊긴 사람을 시간이 지나면 숨기려고, 보이는 사람 목록이 바뀔 때만 다시 그린다
    this.clock = setInterval(() => { if (this.visibleKey() !== this.lastVisibleKey) this.emit() }, 5_000)
    return this
  }

  // ── y-protocols Awareness 와 같은 모양 ──
  get clientID() { return presenceClientId(this.user.uid) }
  getLocalState() { return this.local }
  getStates(): Map<number, { user: { name: string; color: string }; cursor: DocumentCursorJson }> {
    const states = new Map<number, { user: { name: string; color: string }; cursor: DocumentCursorJson }>()
    for (const record of this.visible()) {
      states.set(presenceClientId(record.uid), { user: { name: record.displayName || '팀원', color: record.color }, cursor: record.cursor! })
    }
    return states
  }
  setLocalStateField(field: string, value: unknown) {
    if (field !== 'cursor' || this.destroyed) return
    this.local = { ...this.local, cursor: (value as DocumentCursorJson | null) ?? null }
    this.schedule()
  }
  on(event: string, listener: Listener) { if (event === 'change') this.listeners.add(listener) }
  off(event: string, listener: Listener) { if (event === 'change') this.listeners.delete(listener) }

  /** 에디터가 붙은 뒤 조합 중인지 알려 주는 함수를 연결(없으면 미루지 않음) */
  setComposingCheck(check: (() => boolean) | undefined) { this.options.isComposing = check }

  /** 한글 조합이 끝나면 미뤄 둔 원격 커서 갱신을 반영 */
  flushDeferred() {
    if (!this.deferred) return
    this.deferred = false
    this.emit()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.trailing) clearTimeout(this.trailing)
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.clock) clearInterval(this.clock)
    this.unsubscribe?.()
    this.unsubscribe = null
    this.trailing = null
    // 리스너는 지우지 않는다 — 커서 플러그인이 에디터와 함께 off 로 스스로 떼어 낸다
    void Promise.resolve(this.transport.remove()).catch(() => undefined)
  }

  private visible(): DocumentPresenceRecord[] {
    const now = this.now()
    return this.remote.filter(record => record.cursor && now - (record.updatedAt ?? 0) < DOCUMENT_PRESENCE_STALE_MS)
  }

  private visibleKey() { return this.visible().map(record => record.uid).sort().join(',') }

  private emit() {
    // 조합 중에 메타 트랜잭션을 보내면 조합이 깨질 수 있어 미룬다
    if (this.options.isComposing?.()) { this.deferred = true; return }
    this.lastVisibleKey = this.visibleKey()
    for (const listener of this.listeners) listener({ added: [], updated: [], removed: [] }, 'remote')
  }

  private schedule() {
    const elapsed = this.now() - this.lastSent
    if (elapsed >= DOCUMENT_PRESENCE_THROTTLE_MS && !this.trailing) { this.send(); return }
    if (this.trailing) return
    this.trailing = setTimeout(() => { this.trailing = null; this.send() }, Math.max(0, DOCUMENT_PRESENCE_THROTTLE_MS - elapsed))
  }

  private send() {
    if (this.destroyed) return
    this.lastSent = this.now()
    const record: DocumentPresenceRecord = {
      uid: this.user.uid, displayName: this.user.displayName || '팀원', color: this.user.color,
      cursor: this.local.cursor ? JSON.parse(JSON.stringify(this.local.cursor)) : null,
      updatedAt: this.lastSent,
    }
    void Promise.resolve(this.transport.write(record)).catch(() => undefined)
  }
}

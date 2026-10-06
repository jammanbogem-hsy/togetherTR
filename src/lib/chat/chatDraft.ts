import type { Dispatch, SetStateAction } from 'react'

export interface ChatDraftState { input: string; slashQuery: string | null; slashCmdIdx: number }
export function createChatDraft() {
  let state: ChatDraftState = { input: '', slashQuery: null, slashCmdIdx: 0 }
  const listeners = new Set<() => void>()
  const setter = <K extends keyof ChatDraftState>(key: K): Dispatch<SetStateAction<ChatDraftState[K]>> => value => {
    const next = typeof value === 'function' ? (value as (old: ChatDraftState[K]) => ChatDraftState[K])(state[key]) : value
    if (Object.is(state[key], next)) return
    state = { ...state, [key]: next }
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setInput: setter('input'), setSlashQuery: setter('slashQuery'), setSlashCmdIdx: setter('slashCmdIdx'),
  }
}
export type ChatDraft = ReturnType<typeof createChatDraft>

import type { Message } from '@/types'

const serialized = new WeakMap<Message, string>()
function contentKey(message: Message) {
  let key = serialized.get(message)
  if (key === undefined) { key = JSON.stringify(message); serialized.set(message, key) }
  return key
}
/** Firestore makes new data objects per snapshot. Preserve unchanged rows, including nested checklist data. */
export function reconcileMessages(previous: Message[], incoming: Message[]): Message[] {
  const old = new Map(previous.map(message => [message.id, message]))
  const next = Array.from(new Map(incoming.map(message => [message.id, message])).values()).map(message => {
    const existing = old.get(message.id)
    return existing && (existing === message || contentKey(existing) === contentKey(message)) ? existing : message
  })
  return next.length === previous.length && next.every((message, index) => message === previous[index]) ? previous : next
}

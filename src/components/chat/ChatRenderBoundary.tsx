'use client'

import { memo, useCallback, useDeferredValue, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Message } from '@/types'
import type { ChatDraft, ChatDraftState } from '@/lib/chat/chatDraft'
import { startInteraction, finishAfterPaint } from '@/lib/performance/interactionMetrics'

/** Event callbacks keep their identity while reading the latest committed component state. */
export function useStableCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const latest = useRef(callback)
  useLayoutEffect(() => { latest.current = callback })
  return useCallback((...args: Parameters<T>) => latest.current(...args), []) as T
}

export function ChatDraftBoundary({ draft, children }: { draft: ChatDraft; children: (state: ChatDraftState) => ReactNode }) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot)
  return children(state)
}

const MessageRow = memo(function MessageRow({ message, renderMessage }: {
  message: Message; renderMessage: (message: Message) => ReactNode;
}) {
  const content = renderMessage(message)
  return message.role === 'assistant'
    ? <div data-ai-response-id={message.id} data-ai-revision={message.content.length}>{content}</div>
    : content
})

interface MessageListProps {
  messages: Message[]; renderMessage: (message: Message) => ReactNode; onCommit: () => void;
}
const EMPTY_MESSAGES: Message[] = []

// A keyed activity starts with an empty list so navigation paints before Markdown parsing.
// React can interrupt the deferred work when the teacher types or chooses another activity.
export const MessageList = memo(function MessageList({ messages, ...rest }: MessageListProps) {
  const deferredMessages = useDeferredValue(messages, EMPTY_MESSAGES)
  return <RenderedMessages messages={deferredMessages} {...rest} />
})

const RenderedMessages = memo(function RenderedMessages({ messages, renderMessage, onCommit }: MessageListProps) {
  const finish = startInteraction('message-render')
  useLayoutEffect(() => { onCommit(); finish() })
  return <>{messages.map(message => <MessageRow key={message.id} message={message} renderMessage={renderMessage} />)}</>
})

export function markChatInput() { const finish = startInteraction('chat-input'); finishAfterPaint(finish) }

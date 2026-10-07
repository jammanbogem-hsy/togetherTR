'use client'

import { useCallback, useLayoutEffect, useState } from 'react'
import { createResponseScrollController } from '@/lib/chat/responseScroll'

export function useResponseScroll(scopeKey: string, ready: boolean, messages: readonly unknown[], localText: string, remoteText: string) {
  const [hasNewResponse, setHasNewResponse] = useState(false)
  const [{ controller, viewportRef }] = useState(() => {
    let viewport: HTMLDivElement | null = null
    return {
      controller: createResponseScrollController(() => viewport, setHasNewResponse),
      viewportRef: (element: HTMLDivElement | null) => { viewport = element },
    }
  })
  const onCommit = useCallback(() => controller.sync(scopeKey, ready), [controller, scopeKey, ready])
  useLayoutEffect(() => { onCommit() }, [onCommit, messages, localText, remoteText])
  return { viewportRef, hasNewResponse, onCommit, onScroll: controller.onScroll, onUserIntent: controller.onUserIntent, goToLatest: controller.goToLatest }
}

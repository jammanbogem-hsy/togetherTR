type CycleMessage = {
  id: string
  cycleNumber?: number
  createdAt?: unknown
}

function createdAtMillis(value: unknown): number {
  if (typeof value === 'number') return value
  if (
    value
    && typeof value === 'object'
    && 'toMillis' in value
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

/**
 * 활동별 신규/레거시 경로 메시지를 합치고 현재 설계 주기에 속한 것만 남긴다.
 * cycleNumber가 없는 과거 메시지는 마이그레이션 전 데이터이므로 1주기에만 노출한다.
 */
export function mergeMessagesForCycle<T extends CycleMessage>(
  messageGroups: T[][],
  currentCycle = 1,
): T[] {
  const byId = new Map<string, T>()
  for (const messages of messageGroups) {
    for (const message of messages) {
      const belongsToCycle = message.cycleNumber === currentCycle
        || (currentCycle === 1 && message.cycleNumber === undefined)
      if (belongsToCycle) byId.set(message.id, message)
    }
  }
  return [...byId.values()].sort(
    (a, b) => createdAtMillis(a.createdAt) - createdAtMillis(b.createdAt),
  )
}

import type { ArtifactUpdateItem } from './signals'

/** 저장 내용 비교: 객체 키 순서는 무시하고 배열 순서와 실제 값은 보존한다. */
export function artifactContentEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => artifactContentEquals(value, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && artifactContentEquals(a[key], b[key]))
}

interface ArtifactSignalBatchOptions {
  currentActivity: string
  updates: ArtifactUpdateItem[]
  confirmCodes: string[]
  commitUpdate: (
    activityCode: string,
    sections: Record<string, string>,
    confirm: boolean,
  ) => Promise<void>
  confirmExisting: (activityCode: string) => Promise<void>
}

export async function applyArtifactSignalBatch({
  currentActivity,
  updates,
  confirmCodes,
  commitUpdate,
  confirmExisting,
}: ArtifactSignalBatchOptions): Promise<void> {
  const pendingConfirms = new Set(
    confirmCodes.map(code => code || currentActivity),
  )

  for (const update of updates) {
    const activityCode = update.activityCode || currentActivity
    const confirm = pendingConfirms.delete(activityCode)
    await commitUpdate(activityCode, update.sections, confirm)
  }

  for (const activityCode of pendingConfirms) {
    await confirmExisting(activityCode)
  }
}

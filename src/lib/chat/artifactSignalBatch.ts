import type { ArtifactUpdateItem } from './signals'

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

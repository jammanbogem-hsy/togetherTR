import type { CurriculumSheetRow } from '@/types'

/** How many times a resurrected row is deleted again before the sheet shows the server state. */
export const DELETE_RETRY_LIMIT = 3

/** Drops rows the teacher deleted locally until the server confirms they are gone. */
export function withoutDeletedRows<T extends Pick<CurriculumSheetRow, 'id'>>(
  rows: readonly T[],
  deletedIds: ReadonlyMap<string, unknown> | ReadonlySet<string>,
): T[] {
  if (deletedIds.size === 0) return [...rows]
  return rows.filter(row => !deletedIds.has(row.id))
}

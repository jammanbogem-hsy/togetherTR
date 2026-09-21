import type { CurriculumSheetRow } from '@/types'
import { rowGradeBand } from './collaborativeBands'

const SOURCE_FIELDS = ['subject', 'gradeBand', 'coreIdea', 'standard', 'knowledge', 'processFunction', 'valueAttitude'] as const
export type RowDescriptionUpdate = Pick<CurriculumSheetRow, 'id' | 'coreIdea' | 'standard' | 'description'>
  & Partial<Pick<CurriculumSheetRow, typeof SOURCE_FIELDS[number]>>

/** Keep teacher edits and discard a response if its curriculum inputs have changed. */
export function canFillRowDescription(current: CurriculumSheetRow, source: RowDescriptionUpdate): boolean {
  const band = rowGradeBand({ ...current, ...source })
  const comparable = (row: Partial<CurriculumSheetRow>, field: typeof SOURCE_FIELDS[number]) => {
    const value = row[field] ?? ''
    if (!band || !['knowledge', 'processFunction', 'valueAttitude'].includes(field)) return value
    // The UI prefixes legacy content elements with their grade band. That display-only
    // normalization is not an edit; a prefix for a different band remains significant.
    return value.split(' | ').map(part => {
      const text = part.trim()
      return text.startsWith(`${band}:`) ? text.slice(band.length + 1).trim() : text
    }).join(' | ')
  }
  return current.id === source.id && !current.description?.trim()
    && SOURCE_FIELDS.every(field => !(field in source) || comparable(current, field) === comparable(source, field))
}

/** One selected row per request, so another row of the same subject cannot supply its description. */
export async function requestRowDescription(
  row: CurriculumSheetRow,
  context: { targetGradeGroup?: string; a12Artifact?: Record<string, unknown>; chatContext?: string },
  request: typeof fetch = fetch,
): Promise<string | null> {
  if (row.description?.trim() || !row.subject?.trim() || !row.standard?.trim()) return null
  const response = await request('/api/curriculum-sheet/autofill', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...context, mode: 'describe', rows: [row] }),
  })
  const data = await response.json() as { descriptions?: Record<string, string>; error?: string }
  if (!response.ok) throw new Error(data.error || '수업내용 설명을 작성하지 못했습니다. 다시 시도해 주세요.')
  const description = data.descriptions?.[row.id]?.trim()
  if (!description) throw new Error('성취기준은 적용했지만 설명을 작성하지 못했습니다. 다시 시도해 주세요.')
  return description
}

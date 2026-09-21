import { normalizeTeamGradeBands, gradeBandsForSubject, subjectsMissingInGradeBand } from './teamGradeBands'
import { gradeBandFromStandardCode, toGradeBandLabel } from './sheetGradeBands'
import { canonicalSubjectName } from './subjectAliases'

/** A teacher's explicit selection wins; otherwise include the entire team, even in an empty sheet. */
export function resolveAutofillGradeBands(params: {
  subject: string
  selectedBands?: readonly string[]
  rowBands?: readonly (string | undefined)[]
  teamGradeBands?: readonly string[]
  defaultBand?: string
}): string[] {
  const selected = normalizeTeamGradeBands(params.selectedBands)
  const candidates = selected.length ? selected : normalizeTeamGradeBands([
    ...normalizeTeamGradeBands(params.teamGradeBands),
    ...(params.rowBands ?? []).map(band => band || params.defaultBand),
  ])
  const requested = candidates.length ? candidates : normalizeTeamGradeBands([params.defaultBand])
  const allowed = gradeBandsForSubject(params.subject)
  return requested.filter(band => allowed.includes(band))
}

/** Low-grade teachers need actual integrated-subject records when a shared subject starts at grade 3. */
export function includeTeamSubjects(subjects: string[], bands?: readonly string[]): string[] {
  const result = [...new Set(subjects.map(subject => canonicalSubjectName(subject) || subject))]
  if (normalizeTeamGradeBands(bands).includes('1-2학년군')
    && subjectsMissingInGradeBand(result, '1-2학년군').length > 0
    && !result.includes('통합교과')) result.push('통합교과')
  return result
}

export interface BandRow {
  id?: string
  subject: string
  gradeBand?: string
  standard?: string
  coreIdea?: string
  isCenter?: boolean
  knowledge?: string
  processFunction?: string
  valueAttitude?: string
  description?: string
  agentLessonExample?: string
  linkedCoreIdea?: { subject: string; coreIdea: string }
}

export function rowGradeBand(row: BandRow, fallback?: string): string {
  return toGradeBandLabel(row.gradeBand) || gradeBandFromStandardCode(row.standard) || toGradeBandLabel(fallback)
}

/** One center per grade band, not one center across the whole collaborative sheet. */
export function setCenterInGradeBand<T extends BandRow>(rows: T[], rowId: string | null, band?: string): T[] {
  const scope = toGradeBandLabel(band)
  return rows.map(row => scope && rowGradeBand(row, scope) !== scope
    ? row
    : { ...row, isCenter: rowId !== null && row.id === rowId })
}

/** Keep each band's teacher-selected center; default to an available subject in that band. */
export function chooseBandCenters<T extends BandRow>(targets: T[], existingRows: BandRow[], fallback?: string): T[] {
  const centers = new Map<string, T>()
  for (const target of targets) {
    const band = rowGradeBand(target, fallback)
    if (centers.has(band)) continue
    const inBand = targets.filter(row => rowGradeBand(row, fallback) === band)
    const previous = existingRows.find(row => row.isCenter && rowGradeBand(row, fallback) === band)
    const chosen = inBand.find(row => previous && row.subject === previous.subject
      && (!previous.coreIdea || previous.coreIdea === row.coreIdea))
      ?? inBand.find(row => previous && row.subject === previous.subject)
      ?? inBand.find(row => row.isCenter)
      ?? inBand[0]
    if (chosen) centers.set(band, chosen)
  }
  return targets.map(row => ({ ...row, isCenter: centers.get(rowGradeBand(row, fallback)) === row }))
}

/** Adding missing bands must not replace teacher-written rows or their IDs. */
export function mergeAutofillRows<T extends BandRow>(existing: T[], incoming: T[], fallback?: string): T[] {
  const next = existing.filter(row => row.subject || row.coreIdea || row.standard || row.knowledge
    || row.processFunction || row.valueAttitude || row.description || row.agentLessonExample || row.linkedCoreIdea)
    .map(row => ({ ...row }))
  for (const row of incoming) {
    const index = next.findIndex(old => old.subject === row.subject
      && rowGradeBand(old, fallback) === rowGradeBand(row, fallback)
      && (!old.coreIdea || old.coreIdea === row.coreIdea))
    if (index < 0) { next.push({ ...row }); continue }
    const old = next[index]
    const filled = { ...row, ...old }
    for (const key of Object.keys(row) as Array<keyof T>) {
      if (old[key] === undefined || old[key] === '') filled[key] = row[key]
    }
    next[index] = filled
  }
  return chooseBandCenters(next, existing, fallback)
}

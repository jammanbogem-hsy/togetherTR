import type { Project } from '@/types'
import { normalizeTeamGradeBands, toGradeGroupCode } from './teamGradeBands'
import { rowGradeBand } from './collaborativeBands'
import { toGradeBandLabel } from './sheetGradeBands'

/** One atomic project update: recognized bands, representative value, mode and legacy row labels. */
export function buildTeamGradeBandUpdate(project: Partial<Project>, requested: readonly string[]) {
  const bands = normalizeTeamGradeBands(requested)
  if (!bands.length) throw new Error('학년군을 하나 이상 선택해주세요.')
  const previousBand = toGradeBandLabel(project.curriculumSheetGradeBand) || toGradeBandLabel(project.targetGradeGroup)
  const sheetBand = bands.includes(previousBand as typeof bands[number]) ? previousBand : bands[0]
  return {
    teamGradeBands: bands,
    targetGradeGroup: toGradeGroupCode(bands[0]) as Project['targetGradeGroup'],
    curriculumSheetGradeMode: bands.length > 1 ? 'multi' as const : 'single' as const,
    curriculumSheetGradeBand: sheetBand,
    // Label old rows before changing the default; never relabel their standards as a different grade.
    ...(project.curriculumSheet?.length ? {
      curriculumSheet: project.curriculumSheet.map(row => ({
        ...row,
        ...(rowGradeBand(row, previousBand) ? { gradeBand: rowGradeBand(row, previousBand) } : {}),
      })),
    } : {}),
  }
}

export function needsMultiBandModeRepair(project: Partial<Project>): boolean {
  return normalizeTeamGradeBands(project.teamGradeBands).length > 1 && project.curriculumSheetGradeMode !== 'multi'
}

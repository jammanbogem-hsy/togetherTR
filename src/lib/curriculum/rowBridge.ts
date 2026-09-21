import type { CurriculumSheetRow } from '@/types'
import { subjectAvailableInGradeBand } from './teamGradeBands'
import { gradeBandFromStandardCode, toGradeBandLabel } from './sheetGradeBands'
import { canonicalSubjectName } from './subjectAliases'

/** 일반 학년군 줄도 원 교과가 없으면 연결 검색 대상으로 다룬다. */
export function needsRowBridge(row: Pick<CurriculumSheetRow, 'subject' | 'linkedCoreIdea'>, band: string): boolean {
  return Boolean(row.linkedCoreIdea) || !subjectAvailableInGradeBand(row.subject, band)
}

export function rowBridgeSource(row: Pick<CurriculumSheetRow, 'subject' | 'coreIdea' | 'linkedCoreIdea'>) {
  const source = row.linkedCoreIdea ?? row
  return source.subject?.trim() && source.coreIdea?.trim()
    ? { subject: source.subject.trim(), coreIdea: source.coreIdea.trim() }
    : null
}

/** 후보를 기다리는 동안 교과·학년군·핵심아이디어·성취기준·내용 요소가 바뀌면 적용하지 않는다. */
export function canApplyRowBridge(current: CurriculumSheetRow, requested: CurriculumSheetRow): boolean {
  return current.id === requested.id
    && ['subject', 'gradeBand', 'coreIdea', 'standard', 'knowledge', 'processFunction', 'valueAttitude'].every(key =>
      current[key as keyof CurriculumSheetRow] === requested[key as keyof CurriculumSheetRow])
    && JSON.stringify(rowBridgeSource(current)) === JSON.stringify(rowBridgeSource(requested))
}

/** 통합교과는 핵심아이디어·영역이 같아도 바른/슬기로운/즐거운 생활의 내용 요소가 다르다. */
export function filterContentByStandardCourse<T extends { course: string }>(
  items: T[], row: Pick<CurriculumSheetRow, 'subject' | 'standard'>,
): T[] {
  if (canonicalSubjectName(row.subject) !== '통합교과') return items
  const names: Record<string, string> = { 바: '바른생활', 슬: '슬기로운생활', 즐: '즐거운생활' }
  const courses = new Set([...row.standard.matchAll(/[12](바|슬|즐)\d{2}-\d{2}/g)].map(match => names[match[1]]))
  if (!courses.size) return items
  return items.filter(item => courses.has(item.course.replace(/\s+/g, '')))
}

export function rowBridgeSelection(row: CurriculumSheetRow, candidate: {
  subject: string; coreIdea: string; contentCoreIdea?: string; standard: string
}, band: string) {
  const gradeBand = toGradeBandLabel(band)
  const subject = canonicalSubjectName(candidate.subject)
  const linkedCoreIdea = rowBridgeSource(row)
  if (!(candidate.contentCoreIdea || candidate.coreIdea).trim() || !gradeBand || !subject || !linkedCoreIdea
    || !subjectAvailableInGradeBand(subject, gradeBand)
    || gradeBandFromStandardCode(candidate.standard) !== gradeBand) return null
  return {
    subject, gradeBand, linkedCoreIdea,
    coreIdea: candidate.contentCoreIdea || candidate.coreIdea,
    standard: candidate.standard,
  }
}

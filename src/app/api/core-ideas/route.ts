import { NextResponse } from 'next/server'
import { isElementaryGradeGroup, loadContentSystemsForGradeGroup } from '@/lib/curriculum/contentSystemReader'
import { filterContentItemsByGrade, gradeBandNeedle, sliceContentItemsPerBand } from '@/lib/curriculum/curriculumFilters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Per-category caps. With allBands they apply per 학년군, otherwise globally. */
const LIMITS = { knowledge: 15, functions: 10, attitudes: 8 } as const

function recordMatchesGrade(gradeBands: string[], gradeGroup: string | null): boolean {
  const needle = gradeBandNeedle(gradeGroup)
  if (!needle) return true
  if (gradeBands.length === 0) return true
  return gradeBands.some(gradeBand => gradeBand.includes(needle))
}

function filterValuesByGrade(items: string[], gradeGroup: string | null): string[] {
  return filterContentItemsByGrade(items, gradeGroup)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gradeGroup = searchParams.get('gradeGroup')
  /**
   * allBands=1: the curriculum analysis sheet picks a 학년군 per row, so a mixed
   * 1st/3rd/5th-grade team needs every elementary band in one response — the
   * project's own 학년군 is only the default for new rows. Records are therefore
   * not band-filtered (that is what dropped 통합교과, a 1-2학년군-only subject,
   * from a 3-4학년군 project), items keep their band prefixes, and the caps
   * apply per band so later bands are not crowded out by the earlier ones.
   */
  const allBands = ['1', 'true', 'yes'].includes((searchParams.get('allBands') ?? '').toLowerCase())
  const records = loadContentSystemsForGradeGroup(gradeGroup)
  const matchingRecords = allBands
    ? records
    : records.filter(r => recordMatchesGrade(r.gradeBands, gradeGroup))
  const items = matchingRecords.map(r => ({
    id: r.id,
    subject: r.subject,
    course: r.course,
    area: r.area,
    gradeBands: r.gradeBands,
    coreIdeas: r.coreIdeas,
    knowledge: allBands
      ? sliceContentItemsPerBand(r.knowledge, LIMITS.knowledge)
      : filterValuesByGrade(r.knowledge, gradeGroup).slice(0, LIMITS.knowledge),
    functions: allBands
      ? sliceContentItemsPerBand(r.functions, LIMITS.functions)
      : filterValuesByGrade(r.functions, gradeGroup).slice(0, LIMITS.functions),
    attitudes: allBands
      ? sliceContentItemsPerBand(r.attitudes, LIMITS.attitudes)
      : filterValuesByGrade(r.attitudes, gradeGroup).slice(0, LIMITS.attitudes),
  }))

  return NextResponse.json({
    items,
    dataAvailable: items.length > 0,
    guidance: items.length === 0 && gradeGroup && !isElementaryGradeGroup(gradeGroup)
      ? '해당 학교급의 검증된 내용체계 자료가 없어 초등 자료로 대체하지 않았습니다. 성취기준과 내용 요소를 교사가 직접 입력해 주세요.'
      : undefined,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

import { NextResponse } from 'next/server'
import { isElementaryGradeGroup, loadContentSystemsForGradeGroup } from '@/lib/curriculum/contentSystemReader'
import { filterContentItemsByGrade, gradeBandNeedle } from '@/lib/curriculum/curriculumFilters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const records = loadContentSystemsForGradeGroup(gradeGroup)
  const matchingRecords = records
    .filter(r => recordMatchesGrade(r.gradeBands, gradeGroup))
  const items = matchingRecords.map(r => ({
    id: r.id,
    subject: r.subject,
    course: r.course,
    area: r.area,
    gradeBands: r.gradeBands,
    coreIdeas: r.coreIdeas,
    knowledge: filterValuesByGrade(r.knowledge, gradeGroup).slice(0, 15),
    functions: filterValuesByGrade(r.functions, gradeGroup).slice(0, 10),
    attitudes: filterValuesByGrade(r.attitudes, gradeGroup).slice(0, 8),
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

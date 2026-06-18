import { NextResponse } from 'next/server'
import { isElementaryGradeGroup, loadContentSystems, loadElementaryContentSystems } from '@/lib/curriculum/contentSystemReader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function gradeNeedle(gradeGroup: string | null): string {
  return (gradeGroup ?? '').replace(/^초/, '').replace(/~/g, '-').trim()
}

function recordMatchesGrade(gradeBands: string[], gradeGroup: string | null): boolean {
  const needle = gradeNeedle(gradeGroup)
  if (!needle) return true
  if (gradeBands.length === 0) return true
  return gradeBands.some(gradeBand => gradeBand.includes(needle))
}

function filterValuesByGrade(items: string[], gradeGroup: string | null): string[] {
  const needle = gradeNeedle(gradeGroup)
  if (!needle) return items
  const prefixed = items.filter(item => /^\d+-\d+학년군:/.test(item))
  if (prefixed.length === 0) return items
  return prefixed.filter(item => item.includes(needle))
}

function isSelectionCurriculum(curriculum: string): boolean {
  return curriculum.trim().startsWith('선택 중심 교육과정')
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gradeGroup = searchParams.get('gradeGroup')
  // [strict-elementary 2026-05-14] 초등 전용 웹앱 — 비초등 gradeGroup이 와도 강제로 초등 데이터만.
  const records = loadElementaryContentSystems()
  const elementary = records
    .filter(r => !isSelectionCurriculum(r.curriculum))
    .filter(r =>
      r.curriculum === '공통 교육과정' ||
      r.gradeBands.some(gb => /초|1-2|3-4|5-6/.test(gb)) ||
      r.gradeBands.length === 0
    )
    .filter(r => recordMatchesGrade(r.gradeBands, gradeGroup))
  const items = elementary.map(r => ({
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

  return NextResponse.json({ items }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

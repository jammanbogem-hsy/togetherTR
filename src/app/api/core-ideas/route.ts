import { NextResponse } from 'next/server'
import { loadContentSystems } from '@/lib/curriculum/contentSystemReader'

export const runtime = 'nodejs'

export async function GET() {
  const records = loadContentSystems()
  // 초등학교 항목만 필터 (공통 교육과정 중 초등 학년군)
  const elementary = records.filter(r =>
    r.curriculum === '공통 교육과정' ||
    r.gradeBands.some(gb => /초|1-2|3-4|5-6/.test(gb)) ||
    r.gradeBands.length === 0 // 학년군 미지정은 포함
  ).filter(r =>
    !r.gradeBands.some(gb => /중|고|7-9|10/.test(gb))
  )
  const items = elementary.map(r => ({
    id: r.id,
    subject: r.subject,
    course: r.course,
    area: r.area,
    gradeBands: r.gradeBands,
    coreIdeas: r.coreIdeas,
    knowledge: r.knowledge.slice(0, 15),
    functions: r.functions.slice(0, 10),
    attitudes: r.attitudes.slice(0, 8),
  }))
  return NextResponse.json({ items })
}

import { NextResponse } from 'next/server'
import { loadContentSystems } from '@/lib/curriculum/contentSystemReader'

export const runtime = 'nodejs'

export async function GET() {
  const records = loadContentSystems()
  // 클라이언트에 필요한 필드만 전달
  const items = records.map(r => ({
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

/**
 * POST /api/ontology/search
 *
 * 8단계 교육 온톨로지 검색 알고리즘 실행
 *
 * Request:
 * {
 *   theme: string          수업 주제
 *   gradeGroup?: string    학년군 ('초5-6' 등)
 *   centerId?: string      중심 성취기준 ID (교사가 직접 지정 시)
 * }
 *
 * Response:
 * {
 *   structuredTopic: StructuredTopic
 *   center: OntologyNode
 *   connections: OntologyNode[]
 *   graphNodes: GraphNode[]
 *   graphEdges: GraphEdge[]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { searchOntology } from '@/lib/curriculum/ontologySearch'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      theme: string
      gradeGroup?: string
      centerId?: string
    }

    const { theme, gradeGroup, centerId } = body
    if (!theme?.trim()) {
      return NextResponse.json({ error: 'theme 필수' }, { status: 400 })
    }

    const result = await searchOntology(theme.trim(), gradeGroup, centerId)
    if (!result) {
      return NextResponse.json({ error: '성취기준을 찾을 수 없습니다' }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

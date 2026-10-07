/**
 * POST /api/ontology/relate
 *
 * Claude를 사용해 성취기준 쌍의 교육적 관계를 분류합니다.
 * 결과는 relation_cache.json에 캐싱됩니다.
 *
 * Request body:
 * {
 *   theme: string              // 수업 주제
 *   gradeGroup: string         // '초5-6' 등
 *   centerId: string           // 중심 성취기준 ID
 *   candidateIds: string[]     // 분류할 후보 ID 목록 (최대 8개)
 * }
 *
 * Response:
 * {
 *   relations: RelationResult[]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph } from '@/lib/curriculum/graphReader'
import { classifyRelations, type StandardMeta } from '@/lib/curriculum/ontologyRelation'

export const runtime = 'nodejs'
export const maxDuration = 60

// 핵심아이디어 텍스트 조합
function getCoreIdeaText(
  coreIdeaId: string | undefined,
  coreIdeas: Array<{ id: string; area: string; ideas: string[] }>
): string {
  if (!coreIdeaId) return ''
  const ci = coreIdeas.find(c => c.id === coreIdeaId)
  if (!ci) return ''
  return ci.ideas.slice(0, 2).join(' / ')
}

// 교과 ID → 이름
const SUBJECT_NAMES: Record<string, string> = {
  sub_kor: '국어', sub_math: '수학', sub_sci: '과학', sub_soc: '사회',
  sub_mor: '도덕', sub_art: '미술', sub_mus: '음악', sub_pe: '체육',
  sub_eng: '영어', sub_prac: '실과', sub_int: '통합교과', sub_extra: '창체',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      theme: string
      gradeGroup?: string
      centerId: string
      candidateIds: string[]
      artifactContext?: string
      force?: boolean
    }

    const { theme, gradeGroup, centerId, candidateIds, artifactContext, force } = body
    if (!theme || !centerId || !candidateIds?.length) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })
    }

    const graph = loadGraph()
    if (!graph) {
      return NextResponse.json({ error: '그래프 로드 실패' }, { status: 500 })
    }

    // 성취기준 → StandardMeta 변환
    const stdById = new Map(graph.achievementStandards.map(s => [s.id, s]))

    const toMeta = (id: string): StandardMeta | null => {
      const std = stdById.get(id)
      if (!std) return null
      return {
        id: std.id,
        code: std.code,
        gradeBand: std.grade_band,
        subjectId: std.subject_id,
        subjectName: SUBJECT_NAMES[std.subject_id] ?? std.subject_id,
        coreIdea: getCoreIdeaText(std.core_idea_id, graph.coreIdeas),
        text: std.text,
        keywords: std.keywords ?? [],
        functions: std.functions ?? [],
        values: std.competencies ?? [],
      }
    }

    const center = toMeta(centerId)
    if (!center) {
      return NextResponse.json({ error: `중심 성취기준 없음: ${centerId}` }, { status: 404 })
    }

    // 최대 8개 후보
    const candidates = candidateIds
      .slice(0, 8)
      .map(toMeta)
      .filter((m): m is StandardMeta => m !== null)

    const relations = await classifyRelations(theme, center, candidates, artifactContext, { force, gradeGroup })

    // 클라이언트는 rel.standardId (= 상대 성취기준 id) 를 기대한다.
    // center 기준으로 반대편 id를 standardId로 노출한다.
    const shaped = relations.map(r => ({
      ...r,
      standardId: r.sourceId === center.id ? r.targetId : r.sourceId,
    }))

    return NextResponse.json({ relations: shaped })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/curriculum-map/related — 노드 하나를 클릭했을 때의 관련 성취기준.
 *
 * 후보 = search_index 의 사전 이웃 8개 ∪ 그 노드의 교과 간 링크 ∪ 실시간 코사인
 * 상위 15개 → 중복 제거 후 24개 상한(교과 간 링크는 교육과정이 직접 연결한 쌍이라
 * 우선 보존). 후보마다 Jev 가 관계 유형(Choice) + 관계 강도(Score)를 한 번의
 * fan-out 으로 판정한다.
 *
 * Jev 가 꺼져 있거나 실패·시한 초과면 관계 유형은 교과 간 링크의 relation_edu
 * (없으면 '의미연결'), 강도는 코사인으로 채운다(judge:'embedding').
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph, type CurriculumStandard, type KnowledgeGraph } from '@/lib/curriculum/graphReader'
import { jevJudgeEnabled, judgeRelations, RELATION_TYPE_CRITERIA } from '@/lib/curriculum/jevJudge'
import {
  clamp01,
  coreIdeaSentence,
  cosineSim,
  levelForScore,
  loadStandardEmbeddings,
  normalizeRelationType,
  toStandardSummary,
  unionCandidates,
  withDeadline,
  type CandidateInput,
  type CandidateSource,
  type RelevanceLevel,
  type StandardSummary,
} from '@/lib/curriculum/curriculumMap'

export const runtime = 'nodejs'
export const maxDuration = 30

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 20
/** Jev 에 넘길 후보 상한. 후보당 질문 2개 → 최대 48문항 1회 fan-out. */
const CANDIDATE_CAP = 24
/** 실시간 코사인으로 보강할 후보 수. */
const EMBEDDING_CANDIDATES = 15
/** UX 목표 2초 중 Jev 에 허용하는 시간. */
const JUDGE_DEADLINE_MS = 6_000

const DEFAULT_RELATION_TYPE = '의미연결'

interface RelatedRequestBody {
  id?: unknown
  query?: unknown
  limit?: unknown
}

interface RelatedItem extends StandardSummary {
  sim: number
  relationType: string
  strength: number
  level: RelevanceLevel
  source: CandidateSource
}

function resolveLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, n)
}

/** 관계 유형이 RELATION_TYPE_CRITERIA 의 키인지 확인하고 아니면 기본값으로. */
function safeRelationType(value?: string | null): string {
  if (value && Object.prototype.hasOwnProperty.call(RELATION_TYPE_CRITERIA, value)) return value
  return DEFAULT_RELATION_TYPE
}

/** Jev 판정용 성취기준 블록. */
function toRelationStandard(std: CurriculumStandard, graph: KnowledgeGraph) {
  const summary = toStandardSummary(std, graph)
  return {
    id: std.id,
    code: std.code,
    subjectName: summary.subject,
    text: std.text ?? '',
    coreIdea: coreIdeaSentence(std, graph),
  }
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now()
  const noStore = { 'Cache-Control': 'no-store' }

  try {
    const body = (await request.json().catch(() => ({}))) as RelatedRequestBody
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) {
      return NextResponse.json({ error: '성취기준 id 가 필요합니다.' }, { status: 400, headers: noStore })
    }

    const graphStartedAt = performance.now()
    const graph = loadGraph()
    const graphMs = Math.round(performance.now() - graphStartedAt)
    if (!graph) {
      console.error('[curriculum-map/related] knowledge graph unavailable')
      return NextResponse.json({ error: '지식 그래프를 불러올 수 없습니다.' }, { status: 503, headers: noStore })
    }

    const byId = new Map(graph.achievementStandards.map(std => [std.id, std]))
    const center = byId.get(id)
    if (!center) {
      return NextResponse.json({ error: `성취기준을 찾을 수 없습니다: ${id}` }, { status: 404, headers: noStore })
    }

    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const limit = resolveLimit(body.limit)

    // ── 1. 후보 수집 (사전 이웃 · 교과 간 링크 · 실시간 코사인) ──
    const inputs: CandidateInput[] = []

    const neighbours = graph.search_index?.find(entry => entry.id === id)?.top_similar ?? []
    for (const neighbour of neighbours) {
      if (!byId.has(neighbour.id) || neighbour.id === id) continue
      inputs.push({ id: neighbour.id, origin: 'similar', sim: clamp01(neighbour.score) })
    }

    for (const link of graph.links_cross_subject ?? []) {
      const other = link.source_id === id ? link.target_id : link.target_id === id ? link.source_id : ''
      if (!other || other === id || !byId.has(other)) continue
      inputs.push({
        id: other,
        origin: 'cross',
        sim: clamp01(link.weight ?? 0),
        relation: normalizeRelationType(link.relation_edu ?? link.relation),
      })
    }

    const embeddings = loadStandardEmbeddings()
    const centerVector = embeddings[id]
    if (centerVector) {
      const live = graph.achievementStandards
        .filter(std => std.id !== id && embeddings[std.id])
        .map(std => ({ id: std.id, sim: clamp01(cosineSim(centerVector, embeddings[std.id])) }))
        .sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : 1))
        .slice(0, EMBEDDING_CANDIDATES)
      for (const entry of live) inputs.push({ id: entry.id, origin: 'embedding', sim: entry.sim })
    }

    const candidates = unionCandidates(inputs, CANDIDATE_CAP)
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          center: { ...toStandardSummary(center, graph), coreIdea: coreIdeaSentence(center, graph) },
          related: [],
          judge: 'embedding',
          elapsedMs: Math.round(performance.now() - startedAt),
        },
        { headers: noStore },
      )
    }

    // ── 2. Jev 관계 판정 (유형 Choice + 강도 Score, 1회 fan-out) ──
    let judge: 'jev' | 'embedding' = 'embedding'
    let judged: Record<string, { relationType: string; strength: number }> = {}
    const judgeStartedAt = performance.now()
    if (jevJudgeEnabled()) {
      const judgement = await withDeadline(
        judgeRelations(
          query || center.text || '',
          toRelationStandard(center, graph),
          candidates.map(candidate => toRelationStandard(byId.get(candidate.id)!, graph)),
        ),
        JUDGE_DEADLINE_MS,
        'related',
      )
      if (judgement && Object.keys(judgement.byCandidateId).length > 0) {
        judge = 'jev'
        judged = judgement.byCandidateId
      }
    }
    const judgeMs = Math.round(performance.now() - judgeStartedAt)

    // ── 3. 정렬 · 응답 ──
    const related: RelatedItem[] = candidates
      .map(candidate => {
        const std = byId.get(candidate.id)!
        const verdict = judged[candidate.id]
        // Jev 판정이 없으면 교과 간 링크의 관계 유형, 그것도 없으면 '의미연결'.
        const relationType = safeRelationType(verdict?.relationType ?? candidate.relation)
        const strength = clamp01(verdict?.strength ?? candidate.sim)
        return {
          ...toStandardSummary(std, graph),
          sim: Math.round(candidate.sim * 1000) / 1000,
          relationType,
          strength: Math.round(strength * 1000) / 1000,
          level: levelForScore(strength),
          source: candidate.source,
        }
      })
      .sort((a, b) => b.strength - a.strength || b.sim - a.sim || (a.id < b.id ? -1 : 1))
      .slice(0, limit)

    const elapsedMs = Math.round(performance.now() - startedAt)
    console.log('[curriculum-map/related]', JSON.stringify({
      id,
      code: center.code,
      judge,
      candidates: candidates.length,
      returned: related.length,
      elapsedMs,
      graphMs,
      judgeMs,
    }))

    return NextResponse.json(
      {
        center: { ...toStandardSummary(center, graph), coreIdea: coreIdeaSentence(center, graph) },
        related,
        judge,
        elapsedMs,
      },
      { headers: noStore },
    )
  } catch (error) {
    console.error('[curriculum-map/related] failed', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    return NextResponse.json({ error: '관련 성취기준 조회에 실패했습니다.' }, { status: 500, headers: noStore })
  }
}

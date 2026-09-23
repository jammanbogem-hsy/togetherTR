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
 *
 * 후보마다 "왜 연결됐는가"를 결정적으로 계산해 함께 준다(추가 LLM 호출 없음):
 * 공통 키워드·같은 영역/핵심아이디어·교과 간 링크 근거를 모아 reason 한 줄로
 * 조립한다. 사용자 피드백("연결 근거가 불분명하다")에 대한 응답이다.
 *
 * 성취수준(2026-09-23 교사 피드백 "성취기준 속 성취수준까지 고려"): 양쪽 성취기준의
 * A·B·C 원문을 Jev 관계 판정(유형·강도)의 근거로 함께 넘긴다. 수준별 연계 라벨은
 * 변별력이 없어 싣지 않는다(curriculumMap.ts 의 기록 참고) — 화면은 두 원문을 나란히 보여 준다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph, type CurriculumStandard, type KnowledgeGraph } from '@/lib/curriculum/graphReader'
import { jevJudgeEnabled, judgeRelations, RELATION_TYPE_CRITERIA } from '@/lib/curriculum/jevJudge'
import {
  buildRelationReason,
  clamp01,
  coreIdeaSentence,
  cosineSim,
  formatLinkEvidence,
  levelForScore,
  loadStandardLevelsById,
  normalizeRelationType,
  resolveVectorTables,
  sharedKeywordTerms,
  toStandardSummary,
  unionCandidates,
  withDeadline,
  type CandidateInput,
  type CandidateSource,
  type RelevanceLevel,
  type StandardLevels,
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
  /** Jev 원점수 0~1. 판정이 없으면 생략(UI 가 '유사도만' 으로 표시). */
  jevScore?: number
  /** 두 성취기준의 공통 키워드 어간(최대 6). */
  sharedKeywords: string[]
  sameArea: boolean
  sameCoreIdea: boolean
  /** 후보의 핵심아이디어 영역명. */
  coreIdeaArea: string
  /** 교과 간 링크가 있을 때의 근거 문구. 없으면 ''. */
  linkEvidence: string
  /** 위 근거를 우선순위로 조립한 한 줄 설명. 항상 비어 있지 않다. */
  reason: string
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

/** Jev 판정용 성취기준 블록. 성취수준 원문이 있으면 함께 싣는다. */
function toRelationStandard(std: CurriculumStandard, graph: KnowledgeGraph, levels?: StandardLevels) {
  const summary = toStandardSummary(std, graph)
  return {
    id: std.id,
    code: std.code,
    subjectName: summary.subject,
    text: std.text ?? '',
    coreIdea: coreIdeaSentence(std, graph),
    ...(levels ? { levels: { A: levels.A, B: levels.B, C: levels.C } } : {}),
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

    // 링크 원본을 후보 id 로 보관한다 — relation 뿐 아니라 evidence 문구도 필요하다.
    const linkByCandidateId = new Map<string, (typeof graph.links_cross_subject)[number]>()
    for (const link of graph.links_cross_subject ?? []) {
      const other = link.source_id === id ? link.target_id : link.target_id === id ? link.source_id : ''
      if (!other || other === id || !byId.has(other)) continue
      // 같은 쌍에 링크가 여러 개면 가중치가 큰 것을 근거로 쓴다.
      const existing = linkByCandidateId.get(other)
      if (!existing || (link.weight ?? 0) > (existing.weight ?? 0)) linkByCandidateId.set(other, link)
      inputs.push({
        id: other,
        origin: 'cross',
        sim: clamp01(link.weight ?? 0),
        relation: normalizeRelationType(link.relation_edu ?? link.relation),
      })
    }

    // 실시간 코사인 후보: 고르는 건 v2(수업 문서), 응답에 실리는 sim 은 v1.
    //
    // v2 는 같은 교과·영역 이웃을 0.93~0.96 로 뭉쳐 놓아 후보를 모으는 데는 좋지만
    // ([6과06-02] 이웃 6건이 모두 과학 지구·우주) 화면의 "의미 유사도" 로는 아무
    // 것도 구분하지 못한다. 게다가 사전 이웃(search_index)과 교과 간 링크 가중치는
    // 모두 v1 계열 값이라, sim 을 v1 으로 통일해야 세 출처가 같은 척도가 된다.
    const { poolSource, poolVectors, displaySource, displayVectors } = resolveVectorTables()
    const poolCenter = poolVectors[id]
    const displayCenter = displayVectors[id]
    const displaySimOf = (otherId: string): number =>
      displayCenter && displayVectors[otherId]
        ? clamp01(cosineSim(displayCenter, displayVectors[otherId]))
        : 0
    if (poolCenter) {
      const live = graph.achievementStandards
        .filter(std => std.id !== id && poolVectors[std.id])
        .map(std => ({ id: std.id, poolSim: clamp01(cosineSim(poolCenter, poolVectors[std.id])) }))
        .sort((a, b) => b.poolSim - a.poolSim || (a.id < b.id ? -1 : 1))
        .slice(0, EMBEDDING_CANDIDATES)
      for (const entry of live) {
        inputs.push({ id: entry.id, origin: 'embedding', sim: displaySimOf(entry.id) })
      }
    }

    const candidates = unionCandidates(inputs, CANDIDATE_CAP)
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          center: { ...toStandardSummary(center, graph), coreIdea: coreIdeaSentence(center, graph) },
          related: [],
          judge: 'embedding',
          embeddings: poolSource,
          simSource: displaySource,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
        { headers: noStore },
      )
    }

    // ── 2. Jev 관계 판정 (유형 Choice + 강도 Score, 1회 fan-out) ──
    let judge: 'jev' | 'embedding' = 'embedding'
    let judged: Record<string, {
      relationType: string
      strength: number
    }> = {}
    const levelsById = loadStandardLevelsById()
    const judgeStartedAt = performance.now()
    if (jevJudgeEnabled()) {
      const judgement = await withDeadline(
        judgeRelations(
          query || center.text || '',
          toRelationStandard(center, graph, levelsById.get(center.id)),
          candidates.map(candidate => toRelationStandard(byId.get(candidate.id)!, graph, levelsById.get(candidate.id))),
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
        const link = linkByCandidateId.get(candidate.id)
        const linkEvidence = link ? formatLinkEvidence(link) : ''
        const sharedKeywords = sharedKeywordTerms(center.keywords ?? [], std.keywords ?? [], 6)
        const sameCoreIdea = Boolean(center.core_idea_id && center.core_idea_id === std.core_idea_id)
        const sameArea = Boolean(center.area && center.area === std.area)
        const coreIdeaArea = std.area ?? ''
        const sim = Math.round(candidate.sim * 1000) / 1000
        const jevScore = verdict ? Math.round(verdict.strength * 1000) / 1000 : undefined
        return {
          ...toStandardSummary(std, graph),
          sim,
          relationType,
          strength: Math.round(strength * 1000) / 1000,
          level: levelForScore(strength),
          source: candidate.source,
          ...(jevScore === undefined ? {} : { jevScore }),
          sharedKeywords,
          sameArea,
          sameCoreIdea,
          coreIdeaArea,
          linkEvidence,
          reason: buildRelationReason({
            linkEvidence,
            sameCoreIdea,
            sameArea,
            coreIdeaArea,
            sharedKeywords,
            sim,
            jevScore,
          }),
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
      withLevels: levelsById.has(id) ? candidates.filter(candidate => levelsById.has(candidate.id)).length : 0,
      embeddings: poolSource,
      simSource: displaySource,
      elapsedMs,
      graphMs,
      judgeMs,
    }))

    return NextResponse.json(
      {
        center: { ...toStandardSummary(center, graph), coreIdea: coreIdeaSentence(center, graph) },
        related,
        judge,
        embeddings: poolSource,
        simSource: displaySource,
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

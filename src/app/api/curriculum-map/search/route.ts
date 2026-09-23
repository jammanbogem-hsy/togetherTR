/**
 * POST /api/curriculum-map/search — 키워드·주제로 초등 성취기준을 찾는다.
 *
 * 설계 원칙: 순위는 Jev 가 정하고 임베딩·키워드는 후보를 모으는 데만 쓴다.
 *
 * 왜 이렇게 바뀌었나(2026-09-21 실측): '이슬' 검색에서 임베딩 상위 40을 그대로
 * 목록에 쓰면 정답(0.468) 다음이 영어·음악(0.200)이라 잡음이 자리를 채웠다.
 * Jev 는 그 잡음을 전부 '약함' 으로 맞게 판정하고 있었으므로, 판정을 순위의
 * 근거로 올리고 임베딩은 재현율(recall) 담당으로 내렸다.
 *
 * 파이프라인
 *  1. 짧은 질의 확장(보조 모델 1회) + 질의 임베딩을 동시 실행
 *  2. 후보 풀 = 임베딩 상위(학년군별 라운드로빈) ∪ 글자 적중 전부 → 최대 120
 *     (풀 선별은 v2 문서 임베딩, 화면에 보이는 sim·동점 처리는 v1 코사인)
 *  3. Jev 주제 관련도를 30문항씩 병렬 fan-out 으로 전부 판정(성취수준 A 원문을 근거로 함께 넘김)
 *  4. score = Jev(판정 실패 시 코사인), 0.02 이내 동점은 코사인으로 가름
 *  5. 학년군별 상위 perBand 개를 먼저 확보한 뒤 남는 자리를 점수 순으로 채움
 *
 * 글자 적중 보장: 질의 토큰(2자 이상)이 성취기준 문장·키워드·영역·핵심아이디어·성취수준(A·B·C)에
 * 글자로 들어 있으면 임베딩 순위와 무관하게 후보에 들어간다('이슬' → [6과06-02]).
 *
 * Jev 가 꺼져 있거나 전 조각이 실패하면 코사인 점수로 응답한다(judge:'embedding').
 * OpenAI 키가 없으면 그래프 키워드 점수로 후보를 만든다(빈 결과보다 낫다).
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph, scoreStandard, type CurriculumStandard } from '@/lib/curriculum/graphReader'
import { CANONICAL_GRADE_BANDS, toCanonicalGradeBand } from '@/lib/curriculum/curriculumFilters'
import {
  balanceByBand,
  buildSearchReason,
  clamp01,
  compareJevFirst,
  coreIdeaSentence,
  embedTexts,
  expandShortQuery,
  expandedQuerySimilarity,
  filterStandards,
  isShortQuery,
  judgeTopicRelevanceChunked,
  keywordHit,
  levelForScore,
  loadStandardLevelsById,
  matchedQueryTerms,
  mergeSearchPool,
  resolvePerBand,
  resolveVectorTables,
  searchTokens,
  similarityFloor,
  standardBandLabel,
  toStandardSummary,
  type EmbeddingSource,
  type KeywordHit,
  type RelevanceLevel,
  type SearchCandidateSource,
  type StandardSummary,
} from '@/lib/curriculum/curriculumMap'

export const runtime = 'nodejs'
export const maxDuration = 30

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 30
/** Jev 가 판정할 후보 풀의 상한. 30문항씩 4회 병렬 fan-out. */
const POOL_CAP = 120
/** 전체 대상일 때 임베딩에서 가져오는 상위 개수. */
const EMBEDDING_TOP_GLOBAL = 100
/** 학년군이 지정됐을 때 학년군마다 가져오는 상위 개수(굶는 학년군 방지). */
const EMBEDDING_TOP_PER_BAND = 40
/** Jev 조각 하나에 허용하는 시간. */
const JUDGE_DEADLINE_MS = 6_000
/**
 * 짧은 질의 확장 시한.
 *
 * 확장 모델 실측: gpt-4o-mini 1136ms · gpt-4o 1530ms · gpt-5.6-luna 1645ms.
 * 1초로는 어떤 모델도 확실하지 않아 1.4초로 두고 질의 임베딩과 나란히 돌린다.
 * 시한을 넘겨도 글자 적중 보장이 정답을 후보에 넣으므로 확장은 재현율 보너스다.
 * 같은 질의는 캐시되어 두 번째 호출부터 0ms.
 */
const EXPANSION_DEADLINE_MS = 1_400
/** 키워드 폴백 점수 정규화 상수 — graphReader.scoreStandard 의 실질 최대치. */
const KEYWORD_SCORE_MAX = 15
/** results(관련·핵심) / weak(약함·무관) 경계. level 과 같은 기준이다. */
const WEAK_SCORE_CUTOFF = 0.5

interface ScoredCandidate {
  std: CurriculumStandard
  /** 후보 선별용(v2). 응답에 나가지 않는다. */
  poolSim: number
  /** 화면 표시·동점 처리용(v1). */
  sim: number
  matchedExpansion?: string
  hit: KeywordHit | null
}

interface SearchRequestBody {
  query?: unknown
  subjects?: unknown
  bands?: unknown
  limit?: unknown
  perBand?: unknown
}

interface SearchResult extends StandardSummary {
  sim: number
  score: number
  level: RelevanceLevel
  /** 후보가 된 경로. */
  source: SearchCandidateSource
  /** Jev 원점수 0~1. 판정이 없으면 생략. */
  jevScore?: number
  /** 이 성취기준에 실제로 걸린 질의어(최대 6). */
  matchedTerms: string[]
  /** 글자 그대로 걸린 토큰과 자리. */
  keywordHit?: KeywordHit
  /** 이 성취기준을 끌어올린 확장어(있을 때만). */
  matchedExpansion?: string
  /** 근거 한 줄. 항상 비어 있지 않다. */
  reason: string
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function resolveLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, n)
}

/** 키워드 폴백(임베딩 불가)용 토큰. 조사·어미만 떼고 쓴다. */
const PARTICLES = new Set(['이', '가', '은', '는', '을', '를', '의', '에', '로', '와', '과', '도', '만'])

function keywordsOf(query: string): string[] {
  return query
    .split(/[\s,·]+/)
    .map(token => token.replace(/(하는|하기|하여|에서|에게|으로|이라)$/, ''))
    .filter(token => token.length >= 1 && !PARTICLES.has(token))
}

/**
 * 학년군별 순위를 라운드로빈으로 섞어 하나의 임베딩 후보 순서를 만든다.
 * 상한에서 잘릴 때 특정 학년군만 통째로 사라지지 않게 하기 위함이다.
 */
function interleaveByBand(ranked: Map<string, string[]>, bands: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const depth = Math.max(0, ...bands.map(band => ranked.get(band)?.length ?? 0))
  for (let i = 0; i < depth; i++) {
    for (const band of bands) {
      const id = ranked.get(band)?.[i]
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now()
  const noStore = { 'Cache-Control': 'no-store' }

  try {
    const body = (await request.json().catch(() => ({}))) as SearchRequestBody
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!query) {
      return NextResponse.json({ error: '검색어(query)가 필요합니다.' }, { status: 400, headers: noStore })
    }

    const graphStartedAt = performance.now()
    const graph = loadGraph()
    const graphMs = Math.round(performance.now() - graphStartedAt)
    if (!graph) {
      console.error('[curriculum-map/search] knowledge graph unavailable')
      return NextResponse.json({ error: '지식 그래프를 불러올 수 없습니다.' }, { status: 503, headers: noStore })
    }

    const subjects = asStringArray(body.subjects)
    const requestedBands = asStringArray(body.bands)
    const limit = resolveLimit(body.limit)
    const perBand = resolvePerBand(body.perBand)
    const pool = filterStandards(graph.achievementStandards, { subjects, bands: requestedBands })

    // 대상 학년군: 요청이 있으면 그것, 없으면 초등 세 학년군 전부.
    const bandsRestricted = requestedBands.length > 0
    const targetBands = (bandsRestricted
      ? requestedBands.map(band => toCanonicalGradeBand(band) || band)
      : [...CANONICAL_GRADE_BANDS]
    ).filter((band, index, all) => band && all.indexOf(band) === index)

    const emptyResponse = (source: EmbeddingSource) => NextResponse.json({
      results: [],
      weak: [],
      byBand: Object.fromEntries(targetBands.map(band => [band, []])),
      emptyBands: targetBands,
      expandedTerms: [],
      judge: 'embedding',
      embeddings: source,
      simSource: source,
      elapsedMs: Math.round(performance.now() - startedAt),
    }, { headers: noStore })

    if (pool.length === 0) return emptyResponse('v1')

    // ── 1. 짧은 질의 확장 + 질의 임베딩 (동시 실행) ──
    const { poolSource, poolVectors, displaySource, displayVectors } = resolveVectorTables()
    const hasVectors = Object.keys(poolVectors).length > 0
    const expandStartedAt = performance.now()
    const [expandedTerms, baseEmbedding] = await Promise.all([
      isShortQuery(query) ? expandShortQuery(query, EXPANSION_DEADLINE_MS) : Promise.resolve([]),
      hasVectors ? embedTexts([query]) : Promise.resolve(null),
    ])
    const expandMs = Math.round(performance.now() - expandStartedAt)

    const embedStartedAt = performance.now()
    const queryVector = baseEmbedding?.[0] ?? null
    const expansionEmbedding = queryVector && expandedTerms.length > 0
      ? await embedTexts(expandedTerms)
      : null
    const embedMs = Math.round(performance.now() - embedStartedAt)
    const expansionVectors = (expansionEmbedding ?? []).map((vector, index) => ({
      term: expandedTerms[index],
      vector,
    }))

    // ── 2. 후보 풀 = 임베딩 상위 ∪ 글자 적중 ──
    const tokens = searchTokens(query, expandedTerms)
    const levelsById = loadStandardLevelsById()
    const scoredById = new Map<string, ScoredCandidate>()
    for (const std of pool) {
      let poolSim = 0
      let sim = 0
      let matchedExpansion: string | undefined
      if (queryVector && poolVectors[std.id]) {
        // 풀 선별은 v2, 표시·동점은 v1 — 같은 공식을 서로 다른 벡터 표에 적용한다.
        poolSim = expandedQuerySimilarity(poolVectors[std.id], queryVector, expansionVectors).sim
        const shown = displayVectors[std.id]
          ? expandedQuerySimilarity(displayVectors[std.id], queryVector, expansionVectors)
          : { sim: 0, matchedTerm: undefined }
        sim = shown.sim
        matchedExpansion = shown.matchedTerm
      } else if (!queryVector) {
        poolSim = clamp01(scoreStandard(std, keywordsOf(query)) / KEYWORD_SCORE_MAX)
        sim = poolSim
      }
      scoredById.set(std.id, {
        std,
        poolSim,
        sim,
        ...(matchedExpansion ? { matchedExpansion } : {}),
        hit: keywordHit(std, coreIdeaSentence(std, graph), tokens, levelsById.get(std.id)),
      })
    }

    // 모든 id 는 pool 에서 왔으므로 반드시 있다. 비어 있으면 코드 결함이므로
    // 조용히 넘기지 않고 예외로 드러낸다(라우트의 try/catch 가 500 으로 처리).
    const entryOf = (id: string): ScoredCandidate => {
      const entry = scoredById.get(id)
      if (!entry) throw new Error(`unknown candidate id: ${id}`)
      return entry
    }

    /** 후보 선별 순서 — v2 기준. */
    const byPoolSimDesc = (a: string, b: string) => {
      const diff = entryOf(b).poolSim - entryOf(a).poolSim
      return diff !== 0 ? diff : (a < b ? -1 : 1)
    }

    // 임베딩 후보: 학년군이 지정되면 학년군별 상위를 라운드로빈, 아니면 전체 상위.
    const withSim = pool.filter(std => entryOf(std.id).poolSim > 0)
    const floor = withSim.length > 0
      ? similarityFloor(Math.max(...withSim.map(std => entryOf(std.id).poolSim)))
      : 0
    const aboveFloor = withSim.filter(std => entryOf(std.id).poolSim >= floor).map(std => std.id)
    let embeddingIds: string[]
    if (bandsRestricted && targetBands.length > 1) {
      const ranked = new Map<string, string[]>()
      for (const band of targetBands) {
        ranked.set(band, aboveFloor
          .filter(id => standardBandLabel(entryOf(id).std) === band)
          .sort(byPoolSimDesc)
          .slice(0, EMBEDDING_TOP_PER_BAND))
      }
      embeddingIds = interleaveByBand(ranked, targetBands)
    } else {
      embeddingIds = [...aboveFloor].sort(byPoolSimDesc).slice(0, EMBEDDING_TOP_GLOBAL)
    }

    const keywordIds = pool
      .filter(std => entryOf(std.id).hit)
      .map(std => std.id)
      .sort(byPoolSimDesc)

    const poolEntries = mergeSearchPool({ embeddingIds, keywordIds, cap: POOL_CAP })
    if (poolEntries.length === 0) return emptyResponse(poolSource)

    // ── 3. Jev 판정 (30문항씩 병렬) ──
    const singleBand = targetBands.length === 1 ? targetBands[0] : undefined
    const judgement = await judgeTopicRelevanceChunked(
      query,
      singleBand,
      poolEntries.map(entry => {
        const { std } = entryOf(entry.id)
        const levelA = levelsById.get(std.id)?.A
        return {
          id: std.id,
          code: std.code,
          subject: toStandardSummary(std, graph).subject,
          text: std.text,
          ...(levelA ? { levelA } : {}),
        }
      }),
      { deadlineMs: JUDGE_DEADLINE_MS },
    )
    const jevScores = judgement?.scores ?? {}
    const judge: 'jev' | 'embedding' = Object.keys(jevScores).length > 0 ? 'jev' : 'embedding'

    // ── 4. Jev 우선 순위 ──
    const ranked: SearchResult[] = poolEntries
      .map(entry => {
        const { std, sim, matchedExpansion, hit } = entryOf(entry.id)
        const jev = jevScores[std.id]
        const hasJev = typeof jev === 'number'
        // Jev 가 판정한 것은 Jev 점수가 곧 최종 점수다(임베딩은 동점 처리용).
        const score = hasJev ? clamp01(jev) : clamp01(sim)
        const matchedTerms = matchedQueryTerms(query, std.keywords ?? [], std.text ?? '', 6)
        return {
          ...toStandardSummary(std, graph),
          sim: Math.round(sim * 1000) / 1000,
          score: Math.round(score * 1000) / 1000,
          level: levelForScore(score),
          source: entry.source,
          ...(hasJev ? { jevScore: Math.round(jev * 1000) / 1000 } : {}),
          matchedTerms,
          ...(hit ? { keywordHit: hit } : {}),
          ...(matchedExpansion ? { matchedExpansion } : {}),
          reason: buildSearchReason({
            matchedTerms,
            sim,
            jevScore: hasJev ? jev : undefined,
            matchedExpansion,
            keywordHit: hit,
          }),
        }
      })
      .sort(compareJevFirst)

    // ── 5. 학년군 균형 ──
    const relevant = ranked.filter(item => item.score >= WEAK_SCORE_CUTOFF)
    const { byBand, emptyBands, picks } = balanceByBand(relevant, targetBands, perBand)
    const results: SearchResult[] = [...picks]
    for (const item of relevant) {
      if (results.length >= limit) break
      if (!results.includes(item)) results.push(item)
    }
    results.splice(limit)
    results.sort(compareJevFirst)
    const weak = ranked.filter(item => item.score < WEAK_SCORE_CUTOFF).slice(0, limit)

    const elapsedMs = Math.round(performance.now() - startedAt)
    console.log('[curriculum-map/search]', JSON.stringify({
      query: query.slice(0, 40),
      judge,
      embeddings: poolSource,
      simSource: displaySource,
      pool: pool.length,
      candidates: poolEntries.length,
      keywordHits: keywordIds.length,
      chunks: judgement?.chunks,
      returned: results.length,
      weak: weak.length,
      emptyBands,
      expandedTerms,
      floor: Math.round(floor * 1000) / 1000,
      elapsedMs,
      graphMs,
      expandMs,
      embedMs,
      judgeMs: judgement?.elapsedMs ?? 0,
    }))

    return NextResponse.json({
      results,
      weak,
      byBand,
      emptyBands,
      expandedTerms,
      judge,
      embeddings: poolSource,
      simSource: displaySource,
      elapsedMs,
    }, { headers: noStore })
  } catch (error) {
    console.error('[curriculum-map/search] failed', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    return NextResponse.json({ error: '검색에 실패했습니다.' }, { status: 500, headers: noStore })
  }
}

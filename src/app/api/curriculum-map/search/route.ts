/**
 * POST /api/curriculum-map/search — 키워드·주제로 초등 성취기준을 찾는다.
 *
 * 파이프라인: 질의 임베딩 → 627개(필터 적용) 코사인 상위 40 → Jev 한 번의
 * fan-out 으로 주제 관련도 재순위 → score = 0.7·Jev + 0.3·코사인.
 *
 * 재순위는 `judgeTopicRelevance` 를 쓴다. `judgeStandards` 는 "선택한 핵심
 * 아이디어" 를 전제로 묻기 때문에 자유 키워드 검색에는 가짜 핵심아이디어를
 * 끼워 넣어야 하는데, judgeTopicRelevance 는 (주제 ↔ 성취기준) 관련도를 바로
 * 0~1 로 판정하는 같은 fan-out 구조라 그대로 맞는다.
 *
 * Jev 가 꺼져 있거나 실패·시한 초과면 임베딩 점수만으로 응답한다(judge:'embedding').
 * OpenAI 키가 없으면 그래프의 키워드 점수로 후보를 만든다(빈 결과보다 낫다).
 *
 * 결과마다 근거(matchedTerms·reason)와 원점수(jevScore·sim)를 함께 준다.
 * 또 상위 limit 개를 level 로 갈라 `results`(관련·핵심)와 `weak`(약함·무관)로
 * 나눠 보낸다 — 화면이 약한 결과를 접어둘 수 있게.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph, scoreStandard, type CurriculumStandard } from '@/lib/curriculum/graphReader'
import { jevJudgeEnabled, judgeTopicRelevance } from '@/lib/curriculum/jevJudge'
import { toCanonicalGradeBand } from '@/lib/curriculum/curriculumFilters'
import {
  blendJevAndSim,
  buildSearchReason,
  clamp01,
  cosineSim,
  embedQuery,
  filterStandards,
  levelForScore,
  loadStandardEmbeddings,
  matchedQueryTerms,
  toStandardSummary,
  withDeadline,
  type RelevanceLevel,
  type StandardSummary,
} from '@/lib/curriculum/curriculumMap'

export const runtime = 'nodejs'
export const maxDuration = 30

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 30
/** Jev 재순위에 넘길 후보 수. 질문 40개 = 1회 fan-out. */
const RERANK_CANDIDATES = 40
/** UX 목표 2.5초 중 Jev 에 허용하는 시간. 넘기면 임베딩 점수로 응답한다. */
const JUDGE_DEADLINE_MS = 6_000
/** 키워드 폴백 점수 정규화 상수 — graphReader.scoreStandard 의 실질 최대치. */
const KEYWORD_SCORE_MAX = 15

interface SearchRequestBody {
  query?: unknown
  subjects?: unknown
  bands?: unknown
  limit?: unknown
}

interface SearchResult extends StandardSummary {
  sim: number
  score: number
  level: RelevanceLevel
  /** Jev 원점수 0~1. 판정이 없으면 생략. */
  jevScore?: number
  /** 이 성취기준에 실제로 걸린 질의어(최대 6). */
  matchedTerms: string[]
  /** 근거 한 줄. 항상 비어 있지 않다. */
  reason: string
}

/** results(관련·핵심) / weak(약함·무관) 경계. level 과 같은 기준이다. */
const WEAK_SCORE_CUTOFF = 0.5

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function resolveLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, n)
}

/** 키워드 추출(임베딩 없이 후보를 만들 때만). 조사·어미를 떼고 1글자 이상 남긴다. */
const PARTICLES = new Set(['이', '가', '은', '는', '을', '를', '의', '에', '로', '와', '과', '도', '만'])

function keywordsOf(query: string): string[] {
  return query
    .split(/[\s,·]+/)
    .map(token => token.replace(/(하는|하기|하여|에서|에게|으로|이라)$/, ''))
    .filter(token => token.length >= 1 && !PARTICLES.has(token))
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
    const bands = asStringArray(body.bands)
    const limit = resolveLimit(body.limit)
    const pool = filterStandards(graph.achievementStandards, { subjects, bands })
    if (pool.length === 0) {
      return NextResponse.json(
        { results: [], weak: [], judge: 'embedding', elapsedMs: Math.round(performance.now() - startedAt) },
        { headers: noStore },
      )
    }

    // ── 1. 후보 선별 (임베딩 우선, 키 없으면 키워드 점수) ──
    const embedStartedAt = performance.now()
    const embeddings = loadStandardEmbeddings()
    const queryVector = Object.keys(embeddings).length > 0 ? await embedQuery(query) : null
    const embedMs = Math.round(performance.now() - embedStartedAt)

    let scored: Array<{ std: CurriculumStandard; sim: number }>
    if (queryVector) {
      scored = pool.map(std => ({
        std,
        sim: embeddings[std.id] ? clamp01(cosineSim(queryVector, embeddings[std.id])) : 0,
      }))
    } else {
      const keywords = keywordsOf(query)
      scored = pool.map(std => ({
        std,
        sim: clamp01(scoreStandard(std, keywords) / KEYWORD_SCORE_MAX),
      }))
    }
    const candidates = scored
      .filter(entry => entry.sim > 0)
      .sort((a, b) => b.sim - a.sim || (a.std.id < b.std.id ? -1 : 1))
      .slice(0, RERANK_CANDIDATES)

    // ── 2. Jev 재순위 (한 번의 fan-out) ──
    let judge: 'jev' | 'embedding' = 'embedding'
    let jevScores: Record<string, number> = {}
    const judgeStartedAt = performance.now()
    if (jevJudgeEnabled() && candidates.length > 0) {
      // 학년군이 하나로 좁혀졌을 때만 판정 맥락에 넣는다(여러 개면 오히려 오해를 준다).
      const singleBand = bands.length === 1 ? toCanonicalGradeBand(bands[0]) || bands[0] : undefined
      const judgement = await withDeadline(
        judgeTopicRelevance(
          query,
          singleBand,
          candidates.map(entry => ({
            id: entry.std.id,
            code: entry.std.code,
            subject: toStandardSummary(entry.std, graph).subject,
            text: entry.std.text,
          })),
        ),
        JUDGE_DEADLINE_MS,
        'search',
      )
      if (judgement && Object.keys(judgement.scores).length > 0) {
        judge = 'jev'
        jevScores = judgement.scores
      }
    }
    const judgeMs = Math.round(performance.now() - judgeStartedAt)

    // ── 3. 점수 혼합 · 근거 · 정렬 ──
    const ranked: SearchResult[] = candidates
      .map(entry => {
        const jev = jevScores[entry.std.id]
        const hasJev = typeof jev === 'number'
        const sim = Math.round(entry.sim * 1000) / 1000
        const score = Math.round((hasJev ? blendJevAndSim(jev, entry.sim) : clamp01(entry.sim)) * 1000) / 1000
        const jevScore = hasJev ? Math.round(jev * 1000) / 1000 : undefined
        const matchedTerms = matchedQueryTerms(query, entry.std.keywords ?? [], entry.std.text ?? '', 6)
        return {
          ...toStandardSummary(entry.std, graph),
          sim,
          score,
          // 등급은 최종 점수(혼합) 기준 — results/weak 경계와 어긋나지 않게 한다.
          // Jev 원점수는 jevScore 로 따로 노출한다.
          level: levelForScore(score),
          ...(jevScore === undefined ? {} : { jevScore }),
          matchedTerms,
          reason: buildSearchReason({ matchedTerms, sim, jevScore }),
        }
      })
      .sort((a, b) => b.score - a.score || b.sim - a.sim || (a.id < b.id ? -1 : 1))
      // limit 은 종전처럼 합집합에 적용하고, 그 뒤에 강·약으로 가른다.
      .slice(0, limit)

    const results = ranked.filter(item => item.score >= WEAK_SCORE_CUTOFF)
    const weak = ranked.filter(item => item.score < WEAK_SCORE_CUTOFF)

    const elapsedMs = Math.round(performance.now() - startedAt)
    console.log('[curriculum-map/search]', JSON.stringify({
      query: query.slice(0, 40),
      judge,
      pool: pool.length,
      candidates: candidates.length,
      returned: results.length,
      weak: weak.length,
      elapsedMs,
      graphMs,
      embedMs,
      judgeMs,
    }))

    return NextResponse.json({ results, weak, judge, elapsedMs }, { headers: noStore })
  } catch (error) {
    console.error('[curriculum-map/search] failed', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    return NextResponse.json({ error: '검색에 실패했습니다.' }, { status: 500, headers: noStore })
  }
}

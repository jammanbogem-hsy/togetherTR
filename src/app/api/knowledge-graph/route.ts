/**
 * /api/knowledge-graph
 *
 * GET  ?keyword=기후&gradeGroup=초3-4&subjects=sub_kor,sub_sci&topK=30
 *   → 키워드로 관련 성취기준 + 연결 엣지 서브그래프 반환
 *
 * GET  ?all=true
 *   → 전체 그래프 메타데이터 반환 (standards 제외한 경량 버전)
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { searchStandardsSemantic } from '@/lib/curriculum/graphReader'
import type { GraphRelationType } from '@/lib/knowledge-graph/domain'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType } from '@/lib/knowledge-graph/domain'

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string
  type: 'subject' | 'core_idea' | 'standard'
  label: string
  text?: string
  subject_id?: string
  grade_band?: string
  area?: string
  keywords?: string[]
  competencies?: string[]
  group: string
  similarityScore?: number  // 0.1–1.0, 가장 관련도 높은 노드가 1.0
}

interface GraphEdge {
  id: string
  source: string
  target: string
  relation: GraphRelationType
  weight: number
  method: string
}

interface AchievementStandard {
  id: string
  code: string
  subject_id: string
  core_idea_id?: string
  grade_band: string
  area: string
  text: string
  keywords?: string[]
  concepts?: string[]
  functions?: string[]
  competencies?: string[]
  themes?: string[]
  normalized_text_for_similarity?: string
}

interface SearchIndexEntry {
  id: string
  top_similar: Array<{ id: string; score: number }>
}

interface KnowledgeGraph {
  metadata: Record<string, unknown>
  subjects: Array<{ id: string; name_ko: string }>
  coreIdeas: Array<{ id: string; subject_id: string; area: string; ideas: string[] }>
  achievementStandards: AchievementStandard[]
  links_cross_subject: Array<{
    id: string
    source_id: string
    target_id: string
    source_subject: string
    target_subject: string
    relation: string
    weight: number
    evidence: Record<string, unknown>
  }>
  search_index: SearchIndexEntry[]
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─── 그래프 캐시 (서버 메모리) ──────────────────────────────────────────────

let cachedGraph: KnowledgeGraph | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5분

function getGraph(): KnowledgeGraph {
  const now = Date.now()
  if (cachedGraph && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedGraph
  }

  const candidates = [
    path.join(process.cwd(), 'public/elementary_knowledge_graph.json'),
    path.join(process.cwd(), 'data/elementary_knowledge_graph.json'),
    path.join(process.cwd(), '../교육과정/curri/output/elementary_knowledge_graph.json'),
    path.join(process.cwd(), '../교육과정/curri/output/knowledge_graph_multi.json'),
  ]
  const graphPath = candidates.find(p => fs.existsSync(p))
  if (!graphPath) {
    throw new Error('지식 그래프 파일을 찾을 수 없습니다')
  }

  const raw = fs.readFileSync(graphPath, 'utf-8')
  cachedGraph = JSON.parse(raw) as KnowledgeGraph
  cacheTimestamp = now
  return cachedGraph
}

// ─── 한국어 어절 경계 매칭 ───────────────────────────────────────────────────
// "법" 검색 시 "방법", "법칙" 등 다른 단어에 포함된 경우를 걸러냄

const KO_PARTICLE_SET = new Set([
  '이','가','은','는','을','를','의','에','로','으','와','과','도','만',
  '서','게','며','고','나','라','야','아','랑','한','할','해','도','까',
])

function koreanWordMatch(stored: string, query: string): boolean {
  const s = stored.toLowerCase()
  const q = query.toLowerCase()
  let idx = s.indexOf(q)
  while (idx !== -1) {
    const before = idx > 0 ? s[idx - 1] : ''
    const beforeOk = !before || !/[\uAC00-\uD7A3]/.test(before)
    if (beforeOk) {
      const after = s[idx + q.length] ?? ''
      const afterIsKorean = /[\uAC00-\uD7A3]/.test(after)
      const afterOk = !afterIsKorean || KO_PARTICLE_SET.has(after)
      if (afterOk) return true
    }
    idx = s.indexOf(q, idx + 1)
  }
  return false
}

// ─── TF-IDF 스코어링 (런타임 키워드 검색) ──────────────────────────────────

function scoreStandard(std: AchievementStandard, keywords: string[]): number {
  if (keywords.length === 0) return 1

  const textLower = (std.normalized_text_for_similarity || std.text || '').toLowerCase()

  let score = 0
  for (const kw of keywords) {
    const k = kw.toLowerCase()
    const kwExact  = (arr: string[]) => arr.some(s => koreanWordMatch(s, k))
    const kwSubstr = (arr: string[]) => arr.some(s => s.toLowerCase().includes(k))

    if (kwExact(std.keywords  ?? [])) score += 5
    else if (kwSubstr(std.keywords ?? [])) score += 1

    if (kwExact([...(std.concepts ?? []), ...(std.functions ?? [])]))  score += 4
    else if (kwSubstr([...(std.concepts ?? []), ...(std.functions ?? [])])) score += 1

    if (koreanWordMatch(textLower, k)) score += 2
  }
  return score
}

// ─── 서브그래프 추출 ────────────────────────────────────────────────────────

function extractSubgraph(
  graph: KnowledgeGraph,
  matchedIds: Set<string>,
  topK: number,
  allowedBands: string[],
  focused = false,
): { nodes: GraphNode[]; edges: GraphEdge[]; standards: AchievementStandard[] } {
  // 학년군 필터 헬퍼 — 확장 단계에서도 동일하게 적용
  const bandOk = (std: AchievementStandard) =>
    allowedBands.length === 0 || allowedBands.some(b => (std.grade_band ?? '').includes(b))

  const stdById = new Map(graph.achievementStandards.map(s => [s.id, s]))
  const expandedIds = new Set(matchedIds)

  if (!focused) {
    // search_index에서 연결된 이웃 추가 (1-hop 확장, 같은 학년군만)
    const searchMap = new Map(graph.search_index.map(e => [e.id, e.top_similar]))
    for (const id of matchedIds) {
      const neighbors = searchMap.get(id) || []
      for (const { id: nid, score } of neighbors.slice(0, 3)) {
        const neighbor = stdById.get(nid)
        if (score >= 0.25 && neighbor && bandOk(neighbor)) expandedIds.add(nid)
      }
    }

    // 교과 간 링크로 다른 교과 성취기준 추가 (같은 학년군만)
    const crossLinkedIds = new Set<string>()
    for (const link of graph.links_cross_subject) {
      if (expandedIds.has(link.source_id)) {
        const tgt = stdById.get(link.target_id)
        if (tgt && bandOk(tgt)) crossLinkedIds.add(link.target_id)
      }
      if (expandedIds.has(link.target_id)) {
        const src = stdById.get(link.source_id)
        if (src && bandOk(src)) crossLinkedIds.add(link.source_id)
      }
    }
    for (const id of crossLinkedIds) expandedIds.add(id)
  }

  // 노드 필터링 (학년군 재확인)
  const filteredStandards = graph.achievementStandards.filter(s => expandedIds.has(s.id) && bandOk(s))

  // ── 교과 다양성 제어: 동일 교과 최대 3개 (matched 우선) ──────────────────
  const subjectCount: Record<string, number> = {}
  const MAX_PER_SUBJECT = 3
  const diverseStandards: AchievementStandard[] = []
  // matched 노드 먼저
  for (const s of filteredStandards) {
    if (matchedIds.has(s.id)) {
      subjectCount[s.subject_id] = (subjectCount[s.subject_id] ?? 0) + 1
      diverseStandards.push(s)
    }
  }
  // 확장 노드: 교과 쿼터 초과 제외
  for (const s of filteredStandards) {
    if (matchedIds.has(s.id)) continue
    const cnt = subjectCount[s.subject_id] ?? 0
    if (cnt < MAX_PER_SUBJECT) {
      subjectCount[s.subject_id] = cnt + 1
      diverseStandards.push(s)
    }
  }

  // topK 제한
  const limitedStandards = diverseStandards.slice(0, topK)
  const limitedIds = new Set(limitedStandards.map(s => s.id))

  // 관련 subject / core_idea 노드 수집
  const relatedSubjectIds = new Set(limitedStandards.map(s => s.subject_id))
  const relatedCoreIdeaIds = new Set(
    limitedStandards.map(s => s.core_idea_id).filter(Boolean) as string[]
  )

  const allNodeIds = new Set([...limitedIds, ...relatedSubjectIds, ...relatedCoreIdeaIds])

  const filteredNodes = graph.nodes.filter(n => allNodeIds.has(n.id))

  // graph.edges는 계층 엣지 위주 — 성취기준 간 교과 연결은 links_cross_subject에서 명시적으로 추출
  const hierarchyEdges = graph.edges.filter(
    e => allNodeIds.has(e.source) && allNodeIds.has(e.target)
  )

  const crossLinks: GraphEdge[] = graph.links_cross_subject
    .filter(lk => limitedIds.has(lk.source_id) && limitedIds.has(lk.target_id))
    .map(lk => ({
      id: `csl_${lk.source_id}_${lk.target_id}`,
      source: lk.source_id,
      target: lk.target_id,
      relation: normalizeGraphRelationType(((lk as Record<string, unknown>).relation_edu as string | undefined) ?? lk.relation)
        ?? DEFAULT_GRAPH_RELATION_TYPE,
      weight: lk.weight,
      method: 'hybrid',
    }))

  // 중복 없이 병합 (교과 간 연결 우선)
  const edgeSeen = new Set(crossLinks.map(e => `${e.source}>${e.target}`))
  const mergedEdges: GraphEdge[] = [...crossLinks]
  for (const e of hierarchyEdges) {
    const k = `${e.source}>${e.target}`
    if (!edgeSeen.has(k)) { mergedEdges.push(e); edgeSeen.add(k) }
  }

  return {
    nodes: filteredNodes,
    edges: mergedEdges,
    standards: limitedStandards,
  }
}

// ─── 핸들러 ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const graph = getGraph()
    const { searchParams } = req.nextUrl

    // 전체 메타데이터 요청
    if (searchParams.get('all') === 'true') {
      return NextResponse.json({
        metadata: graph.metadata,
        subjects: graph.subjects,
        coreIdeas: graph.coreIdeas.map(ci => ({
          id: ci.id,
          subject_id: ci.subject_id,
          area: ci.area,
        })),
        stats: {
          standardsCount: graph.achievementStandards.length,
          crossEdgesCount: graph.links_cross_subject.length,
          nodesCount: graph.nodes.length,
          edgesCount: graph.edges.length,
        },
      })
    }

    // 전체 성취기준 브라우저 요청 (초등만, 교과·학년 필터 가능)
    if (searchParams.get('browseAll') === 'true') {
      const subjectId = searchParams.get('subject') || ''
      const gradeBand = searchParams.get('gradeBand') || ''
      const ELEMENTARY_BANDS = ['초1-2', '초3-4', '초5-6']
      const standards = graph.achievementStandards.filter(s => {
        if (!ELEMENTARY_BANDS.some(b => (s.grade_band ?? '').includes(b))) return false
        if (subjectId && s.subject_id !== subjectId) return false
        if (gradeBand && !(s.grade_band ?? '').includes(gradeBand)) return false
        return true
      })
      return NextResponse.json({
        standards: standards.map(s => ({
          id: s.id,
          code: s.code,
          subject_id: s.subject_id,
          grade_band: s.grade_band,
          area: s.area,
          text: s.text,
          keywords: s.keywords,
        })),
        total: standards.length,
      })
    }

    // 코드별 성취기준 직접 조회 (AI 언급 코드 → 그래프 노드 매핑)
    const codesParam = searchParams.get('codes')
    if (codesParam) {
      const codeList = codesParam.split(',').map(c => c.trim()).filter(Boolean)
      // 대괄호 유무 모두 매칭 (채팅 추출: "6영02-07", DB: "[6영02-07]")
      const normCode = (c: string) => c.replace(/[\[\]]/g, '').trim()
      const codeSet = new Set(codeList.map(normCode))
      const found = graph.achievementStandards.filter(s => codeSet.has(normCode(s.code)))
      const nodes: GraphNode[] = found.map(s => ({
        id: s.id,
        type: 'standard',
        label: s.code.startsWith('[') ? s.code : `[${s.code}]`,
        text: s.text,
        subject_id: s.subject_id,
        grade_band: s.grade_band,
        area: s.area,
        keywords: s.keywords ?? [],
        competencies: s.competencies ?? [],
        group: s.subject_id,
      }))
      return NextResponse.json({ nodes })
    }

    // 키워드 검색 + 서브그래프
    const rawKeyword  = searchParams.get('keyword') || ''
    const gradeGroup  = searchParams.get('gradeGroup') || ''
    const subjectList = searchParams.get('subjects') || ''
    const topK        = Math.min(parseInt(searchParams.get('topK') || '40', 10), 100)
    const focused     = searchParams.get('focused') === 'true'
    // algorithm: 'keyword' | 'semantic' | 'hybrid' (default)
    const algorithm   = searchParams.get('algorithm') || 'hybrid'

    const keywords = rawKeyword
      .split(/[\s,]+/)
      .map(k => k.trim())
      .filter(Boolean)

    const allowedSubjects = subjectList ? subjectList.split(',').map(s => s.trim()) : []

    // 학년군 → grade_band 매핑
    const gradeBandMap: Record<string, string[]> = {
      '초1-2': ['초1-2'],
      '초3-4': ['초3-4'],
      '초5-6': ['초5-6'],
      '중1-3': ['중1-3'],
      '고공통': ['고'],
      '고선택': ['고'],
    }
    const allowedBands = gradeGroup ? (gradeBandMap[gradeGroup] || [gradeGroup]) : []

    // ── 알고리즘별 검색 ──────────────────────────────────────────────────────
    // 키워드/형태소 기반 스코어링 (채팅 agent와 동일 알고리즘)
    const keywordSearch = (): Array<{ std: AchievementStandard; score: number }> => {
      if (keywords.length === 0) return []
      const filtered = graph.achievementStandards.filter(std => {
        if (allowedSubjects.length > 0 && !allowedSubjects.includes(std.subject_id)) return false
        if (allowedBands.length > 0 && !allowedBands.some(b => std.grade_band?.includes(b))) return false
        return true
      })
      return filtered
        .map(std => ({ std, score: Math.min(1, scoreStandard(std, keywords) / 15) }))  // 정규화 0~1 (클램핑)
        .filter(({ score }) => score >= 3 / 15)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
    }

    let matchedWithScore: Array<{ id: string; score: number }>

    if (algorithm === 'keyword') {
      matchedWithScore = keywordSearch().map(({ std, score }) => ({ id: std.id, score }))
    } else if (algorithm === 'semantic') {
      const semanticResults = await searchStandardsSemantic(rawKeyword, gradeGroup || undefined, 30)
      matchedWithScore = semanticResults
        .filter(std => allowedSubjects.length === 0 || allowedSubjects.includes(std.subject_id))
        .map(std => ({ id: std.id, score: std._searchScore }))
    } else {
      // hybrid (기본): 양쪽 결과 병합 (union) + 점수 합산
      const semanticResults = await searchStandardsSemantic(rawKeyword, gradeGroup || undefined, 30)
      const semanticFiltered = semanticResults
        .filter(std => allowedSubjects.length === 0 || allowedSubjects.includes(std.subject_id))
      const kwResults = keywordSearch()

      // 양쪽 결과를 ID 기준으로 합산 (시맨틱·키워드 양쪽에 있으면 높은 점수 사용)
      const mergedMap = new Map<string, number>()
      for (const std of semanticFiltered) {
        mergedMap.set(std.id, std._searchScore)
      }
      for (const { std, score } of kwResults) {
        const existing = mergedMap.get(std.id) ?? 0
        mergedMap.set(std.id, Math.max(existing, score))
      }
      matchedWithScore = [...mergedMap.entries()]
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
    }

    // 실제 유사도 점수 사용 (순위 기반 제거)
    matchedWithScore = matchedWithScore.slice(0, 20)
    const scoreMap = new Map(matchedWithScore.map(m => [m.id, m.score]))
    const matchedIds = new Set(matchedWithScore.map(m => m.id))

    const subgraph = extractSubgraph(graph, matchedIds, topK, allowedBands, focused)

    // 노드에 유사도 점수 첨부 + 엣지에 weight 정보 추가
    const scoredNodes = subgraph.nodes.map(n => ({
      ...n,
      similarityScore: scoreMap.get(n.id) ?? undefined,
    }))

    const enrichedEdges = subgraph.edges.map(e => ({ ...e }))

    return NextResponse.json({
      query: { keyword: rawKeyword, gradeGroup, subjects: allowedSubjects, topK, algorithm },
      nodes: scoredNodes,
      edges: enrichedEdges,
      standards: subgraph.standards,
      totalMatched: matchedIds.size,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

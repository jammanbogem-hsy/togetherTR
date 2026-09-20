/**
 * 지식 그래프 파일 리더 (서버 전용)
 * API 라우트와 chat/stream 양쪽에서 공유 사용
 */

import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { applyElementaryContentLists } from './elementaryContentLists'

export interface CurriculumStandard {
  id: string
  code: string
  subject_id: string
  core_idea_id?: string
  grade_band: string          // '초3-4', '중1-3', '고' 등
  grade_band_raw?: string     // '3~4학년군' 원문
  school_level?: string
  area: string
  curriculum_category?: string
  course?: string
  text: string
  keywords: string[]
  concepts: string[]
  functions: string[]
  knowledge: string[]
  competencies: string[]
  normalized_text_for_similarity: string
}

export interface CrossSubjectLink {
  id: string
  source_id: string
  target_id: string
  source_subject: string
  target_subject: string
  relation: string
  relation_edu?: string   // 도구-활용 | 현상-가치 | 내용-표현 | 의미-연결
  relation_sem?: string
  same_grade_band?: boolean
  grade_band?: string
  weight: number
  evidence: {
    shared_keywords: string[]
    shared_concepts?: string[]
    shared_functions: string[]
    shared_competencies?: string[]
    shared_knowledge?: string[]
    similarity_score: number
  }
}

export interface KnowledgeGraph {
  metadata: Record<string, unknown>
  subjects: Array<{ id: string; name_ko: string }>
  coreIdeas: Array<{ id: string; subject_id: string; area: string; ideas: string[]; knowledge?: string[]; functions?: string[] }>
  achievementStandards: CurriculumStandard[]
  links_cross_subject: CrossSubjectLink[]
  search_index: Array<{ id: string; top_similar: Array<{ id: string; score: number }> }>
}

// ─── 캐시 ──────────────────────────────────────────────────────────────────
let _cache: KnowledgeGraph | null = null
let _cacheAt = 0
const TTL = 10 * 60 * 1000

// ─── 임베딩 캐시 (embeddings_cache.json, standard_id → vector) ──────────────
let _embCache: Record<string, number[]> | null = null

function loadEmbeddings(): Record<string, number[]> {
  if (_embCache) return _embCache
  const candidates = [
    path.join(process.cwd(), 'public/embeddings_cache.json'),
    path.join(process.cwd(), 'data/embeddings_cache.json'),
    path.join(process.cwd(), '../교육과정/curri/output/embeddings_cache.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _embCache = JSON.parse(fs.readFileSync(p, 'utf-8'))
        return _embCache!
      }
    } catch { /* ignore */ }
  }
  _embCache = {}
  return _embCache
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// 쿼리 임베딩 인메모리 캐시 (동일 키워드 재요청 방지)
const _queryEmbCache = new Map<string, number[]>()

// [strict-elementary 2026-05-14] 이 웹앱은 초등 전용 — multi(중·고 포함) 그래프 fallback 제거.
// Why: 사용자 보고로 초등 프로젝트에 중학교 내용("대푯값/도수분포/경우의 수와 확률") 매핑됨.
function findGraphPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public/elementary_knowledge_graph.json'),
    path.join(process.cwd(), 'data/elementary_knowledge_graph.json'),
    path.join(process.cwd(), '../교육과정/curri/output/elementary_knowledge_graph.json'),
    path.join(process.cwd(), 'public', 'elementary_knowledge_graph.json'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// 초등 판정: 비어 있거나(메타 부족 표준 허용 X — strict 모드에서 명시 안 된 것은 제외) 정확히 초등 접두사
function isElementaryLevel(schoolLevel?: string, gradeBand?: string): boolean {
  // school_level이 있으면 그것이 진실의 근원
  if (schoolLevel) return /^초/.test(schoolLevel)
  // school_level이 없으면 grade_band로 판단 (초1-2/초3-4/초5-6)
  if (gradeBand) return /^초/.test(gradeBand)
  // 둘 다 없으면 strict 모드에서는 제외
  return false
}

export function loadGraph(): KnowledgeGraph | null {
  // [2026-05-14] dev 환경에선 매번 reload (JSON 수정 즉시 반영). prod는 TTL 캐시 유지.
  const cacheActive = process.env.NODE_ENV !== 'development' && _cache && Date.now() - _cacheAt < TTL
  if (cacheActive) return _cache

  const graphPath = findGraphPath()
  if (!graphPath) return null

  try {
    const raw = fs.readFileSync(graphPath, 'utf-8')
    const parsed = JSON.parse(raw) as KnowledgeGraph
    // [strict-elementary] 안전망: 그래프 파일에 비초등 항목이 섞여 있어도 강제 제거
    if (Array.isArray(parsed.achievementStandards)) {
      parsed.achievementStandards = parsed.achievementStandards.filter(s => isElementaryLevel(s.school_level, s.grade_band))
    }
    if (Array.isArray(parsed.links_cross_subject)) {
      parsed.links_cross_subject = parsed.links_cross_subject.filter(l => isElementaryLevel(undefined, l.grade_band))
    }
    // [strict-elementary 2026-09-18] 그래프 파일의 knowledge/functions/competencies는
    // 초·중 공통 핵심아이디어 그룹 목록(대부분 중학교 열)을 복사한 것이라 신뢰하지 않는다.
    // 내용체계(학년군별) 항목으로 강제 교체 — scripts/verify-curriculum-linkage.mjs가 검증.
    applyElementaryContentLists(parsed)
    _cache = parsed
    _cacheAt = Date.now()
    return _cache
  } catch {
    return null
  }
}

// ─── 검색 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * 한국어 어절 경계 매칭.
 * "법" 검색 시 "방법", "법칙" 등 다른 단어에 포함된 경우를 걸러냅니다.
 *
 * 규칙:
 *  - query 앞: 문자열 시작이거나 한글이 아닌 문자(공백·숫자·기호)
 *  - query 뒤: 문자열 끝, 공백, 조사(이/가/은/는/을/를/의/에/로/와/과/도/만/도), 또는 한글 아닌 문자
 *    → "법칙"의 "칙"처럼 조사가 아닌 한글이 바로 이어지면 매칭 실패
 */
const KO_PARTICLE_SET = new Set([
  '이','가','은','는','을','를','의','에','로','으','와','과','도','만',
  '서','게','며','고','나','라','야','아','랑','한','할','해','도','까',
])

function koreanWordMatch(stored: string, query: string): boolean {
  const s = stored.toLowerCase()
  const q = query.toLowerCase()
  let idx = s.indexOf(q)
  while (idx !== -1) {
    // 앞 경계 확인: 시작이거나 비한글
    const before = idx > 0 ? s[idx - 1] : ''
    const beforeOk = !before || !/[\uAC00-\uD7A3]/.test(before)
    if (beforeOk) {
      // 뒤 경계 확인: 끝, 공백, 비한글, 또는 조사 1글자
      const after = s[idx + q.length] ?? ''
      const afterIsKorean = /[\uAC00-\uD7A3]/.test(after)
      const afterOk = !afterIsKorean || KO_PARTICLE_SET.has(after)
      if (afterOk) return true
    }
    idx = s.indexOf(q, idx + 1)
  }
  return false
}

export function scoreStandard(std: CurriculumStandard, keywords: string[]): number {
  if (keywords.length === 0) return 0

  let score = 0
  const textLower = (std.normalized_text_for_similarity || std.text || '').toLowerCase()

  for (const kw of keywords) {
    const k = kw.toLowerCase()
    // 어절 경계 매칭(고점) + substring 폴백(저점)으로 점수 분리
    const kwExact  = (arr: string[]) => arr.some(s => koreanWordMatch(s, k))
    const kwSubstr = (arr: string[]) => arr.some(s => s.toLowerCase().includes(k))

    if (kwExact(std.keywords  ?? [])) score += 5
    else if (kwSubstr(std.keywords ?? [])) score += 1   // 가능성 낮은 매칭 — 매우 낮은 점수

    if (kwExact(std.concepts  ?? [])) score += 4
    else if (kwSubstr(std.concepts ?? [])) score += 1

    if (kwExact(std.functions ?? [])) score += 4
    else if (kwSubstr(std.functions ?? [])) score += 1

    if (kwExact(std.knowledge ?? [])) score += 3
    else if (kwSubstr(std.knowledge ?? [])) score += 1

    if (koreanWordMatch(textLower, k)) score += 2
    else if (textLower.includes(k))    score += 0      // 본문 substring은 점수 없음
  }
  return score
}

/**
 * 키워드로 관련 성취기준 검색.
 * @param keywords  검색 키워드 배열
 * @param gradeGroup 예: '초3-4'
 * @param topK      반환 개수 (기본 10)
 */
/**
 * 키워드로 관련 성취기준 검색.
 * @param minScore 최소 점수 (기본 3 — keywords/concepts 배열에서 실제 매칭 필요)
 */
export function searchStandards(
  keywords: string[],
  gradeGroup?: string,
  topK = 10,
  minScore = 3,
): CurriculumStandard[] {
  const graph = loadGraph()
  if (!graph || keywords.length === 0) return []

  const gradeBandMap: Record<string, string[]> = {
    '초1-2': ['초1-2'], '초3-4': ['초3-4'], '초5-6': ['초5-6'],
    '중1-3': ['중1-3'], '고공통': ['고'], '고선택': ['고'],
  }
  const allowedBands = gradeGroup ? (gradeBandMap[gradeGroup] ?? [gradeGroup]) : []

  return graph.achievementStandards
    .filter(std => {
      if (allowedBands.length === 0) return true
      return allowedBands.some(b => (std.grade_band ?? '').includes(b))
    })
    .map(std => ({ std, score: scoreStandard(std, keywords) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ std }) => std)
}

/**
 * 시맨틱 검색: OpenAI 임베딩 + 저장된 임베딩 벡터의 코사인 유사도로 검색.
 * "법" vs "법칙"처럼 표면적으로 비슷하지만 의미가 다른 경우를 걸러냅니다.
 * (knowledge-graph API 라우트 전용 — contextInject는 동기 searchStandards 사용)
 */
export interface ScoredStandard extends CurriculumStandard {
  _searchScore: number  // 0~1 실제 하이브리드 유사도 점수
}

export async function searchStandardsSemantic(
  queryText: string,
  gradeGroup?: string,
  topK = 10,
): Promise<ScoredStandard[]> {
  const graph = loadGraph()
  if (!graph || !queryText.trim()) return []

  const gradeBandMap: Record<string, string[]> = {
    '초1-2': ['초1-2'], '초3-4': ['초3-4'], '초5-6': ['초5-6'],
    '중1-3': ['중1-3'], '고공통': ['고'], '고선택': ['고'],
  }
  const allowedBands = gradeGroup ? (gradeBandMap[gradeGroup] ?? [gradeGroup]) : []

  const embeddings = loadEmbeddings()
  const hasEmbeddings = Object.keys(embeddings).length > 0

  // 쿼리 임베딩 — 캐시 우선
  let queryEmb: number[] | null = _queryEmbCache.get(queryText) ?? null
  if (!queryEmb && hasEmbeddings && process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const resp = await client.embeddings.create({
        input: queryText,
        model: 'text-embedding-3-small',
      })
      queryEmb = resp.data[0].embedding
      _queryEmbCache.set(queryText, queryEmb)
    } catch { /* OpenAI 실패 시 keyword fallback */ }
  }

  const filtered = graph.achievementStandards.filter(std =>
    allowedBands.length === 0 || allowedBands.some(b => (std.grade_band ?? '').includes(b))
  )

  // 형태소 기반 키워드 추출 — 조사·어미 제거 후 1글자 의미어 허용
  const STRIP_SUFFIXES = [
    '하는', '하기', '하여', '한다', '에서', '에게', '으로', '이라', '이고', '이며',
    '이나', '라고', '까지', '부터', '보다', '의', '을', '를', '이', '가', '은',
    '는', '과', '와', '도', '로', '에', '고', '나', '라', '야', '아',
  ]
  const SINGLE_CHAR_PARTICLES = new Set(['이','가','은','는','을','를','의','에','로','와','과','도','만','서','게','며','고','나','라','야','아'])

  const keywords = queryText.split(/[\s,]+/).filter(Boolean).map(token => {
    let w = token
    for (const suf of STRIP_SUFFIXES.sort((a, b) => b.length - a.length)) {
      if (w.endsWith(suf) && w.length - suf.length >= 1) {
        w = w.slice(0, w.length - suf.length)
        break
      }
    }
    return w
  }).filter(w => w.length >= 1 && !SINGLE_CHAR_PARTICLES.has(w))

  return filtered
    .map(std => {
      const rawKwScore = scoreStandard(std, keywords)
      const kwScore = rawKwScore / 15  // 정규화 (max ~15)
      const embScore = queryEmb && embeddings[std.id]
        ? cosineSim(queryEmb, embeddings[std.id])
        : 0
      // 임베딩 사용 가능하면 60:40 하이브리드, 아니면 키워드만
      const score = embScore > 0
        ? 0.6 * embScore + 0.4 * kwScore
        : kwScore
      return { std, score, embScore, rawKwScore }
    })
    .filter(({ embScore, rawKwScore }) => {
      // 매우 높은 임베딩 신뢰도 (>0.42): 단독으로 포함 (교과서 핵심 성취기준)
      if (embScore > 0.42) return true
      // 중간 임베딩 + 키워드 배열 강매칭: 양쪽 모두 확인된 경우만
      // → "유지하다", "수행하다" 같은 표면적 유사어로 인한 오탐 방지
      if (embScore > 0.30 && rawKwScore >= 5) return true
      // 임베딩 없음 (API 키 미설정): 키워드 배열 매칭만으로 판단
      if (embScore === 0 && rawKwScore >= 5) return true
      return false
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ std, score }) => ({ ...std, _searchScore: Math.round(score * 100) / 100 }) as ScoredStandard)
}

/**
 * 성취기준 ID 목록에서 교과 간 링크 추출
 */
export function getCrossLinks(stdIds: string[]): CrossSubjectLink[] {
  const graph = loadGraph()
  if (!graph) return []

  const idSet = new Set(stdIds)
  return graph.links_cross_subject.filter(
    lk => idSet.has(lk.source_id) || idSet.has(lk.target_id)
  )
}

/**
 * 교과 ID → 이름
 */
export function getSubjectName(subjectId: string): string {
  const graph = loadGraph()
  if (!graph) return subjectId
  return graph.subjects.find(s => s.id === subjectId)?.name_ko ?? subjectId
}

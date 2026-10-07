/**
 * 교육 온톨로지 8단계 검색 알고리즘
 * ────────────────────────────────
 * Stage 1  주제 구조화 (Claude Haiku → concept_anchors, function_intents, value_intents)
 * Stage 2  핵심아이디어 유사도 계산 (텍스트 기반)
 * Stage 3  다중 임베딩 검색 (standard + coreidea + anchor 결합)
 * Stage 4  교육적 적합성 필터 (AnchorFit 하한 제거)
 * Stage 5  중심 성취기준 선정 (CenterScore 공식)
 * Stage 6  연결 후보 LinkScore (FunctionComplement + ValueBridge 중시)
 * Stage 7  Claude 직접관련/간접관련/비관련 판정 → 비관련 제거
 * Stage 8  의미망 최적화 (교과 다양성, 기능 역할 균형)
 *
 * OpenAI: 임베딩 검색 엔진
 * Claude:  교육적 관계 판정기
 */

import Anthropic from '@anthropic-ai/sdk'
import { resolveClaudeModel } from '@/lib/llm/anthropic'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { LESSON_AUDIENCE_VERSION, lessonAudiencePrompt, lessonDifficultyIssues } from './lessonAudience'
import { loadGraph, type CurriculumStandard, type CrossSubjectLink } from './graphReader'
import { jevJudgeEnabled, judgeTopicRelevance } from '@/lib/curriculum/jevJudge'
import type { GraphRelationType } from '@/lib/knowledge-graph/domain'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType } from '@/lib/knowledge-graph/domain'

// ─── 상수 / 설정 ──────────────────────────────────────────────────────────────

function resolveCachePath(filename: string): string {
  const candidates = [
    path.join(process.cwd(), 'public', filename),
    path.join(process.cwd(), 'data', filename),
    path.join(process.cwd(), '../교육과정/curri/output', filename),
  ]
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0]
}
const TOPIC_CACHE_PATH    = resolveCachePath('topic_structure_cache.json')
const EMBED_CACHE_PATH    = resolveCachePath('embeddings_cache.json')
const RELATION_CACHE_PATH = resolveCachePath('relation_cache.json')

// 기능 카테고리 (FunctionComplement 계산용)
const INQUIRY_KW   = ['탐구', '조사', '관찰', '분석', '비교', '실험', '탐색', '측정']
const EXPRESSION_KW = ['표현', '쓰기', '글쓰기', '발표', '말하기', '설명', '이야기', '묘사', '기술']
const DISCUSSION_KW = ['토론', '토의', '논의', '협의', '대화', '협력', '소통', '공유']
const VALUE_KW     = ['성찰', '판단', '평가', '가치', '태도', '실천', '공감', '존중', '배려']
const TOOL_KW      = ['계산', '통계', '데이터', '자료', '정보처리', '코딩', '프로그래밍', '설계']
const PRACTICE_KW  = ['제작', '만들기', '수행', '실천', '활동', '프로젝트', '창작']

const SUBJECT_NAMES: Record<string, string> = {
  sub_kor: '국어', sub_math: '수학', sub_sci: '과학', sub_soc: '사회',
  sub_mor: '도덕', sub_art: '미술', sub_mus: '음악', sub_pe: '체육',
  sub_eng: '영어', sub_prac: '실과', sub_int: '통합교과', sub_extra: '창체',
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface StructuredTopic {
  raw: string
  concept_anchors: string[]   // 핵심 개념어
  function_intents: string[]  // 목표 기능 (탐구, 토론, 표현…)
  value_intents: string[]     // 가치·태도 (정의, 시민성…)
  context_terms: string[]     // 맥락 어휘
  output_hints: string[]      // 산출물 힌트 (보고서, 포스터…)
}

export interface OntologyNode {
  standard: CurriculumStandard
  subjectId: string
  subjectName: string
  coreIdeaText: string        // 핵심아이디어 요약 텍스트
  // 단계별 점수
  semanticScore:  number      // OpenAI cosine similarity
  anchorFit:      number      // 개념 앵커 일치도
  functionFit:    number      // 기능 의도 일치도
  valueFit:       number      // 가치 일치도
  coreIdeaFit:    number      // 핵심아이디어 일치도
  centerScore:    number      // Stage 5 종합
  // Stage 6 (연결 노드)
  linkScore?:     number
  functionRole?:  string      // 이 노드의 기능 역할 (inquiry/expression/value/tool/practice)
  // Stage 7 (Claude)
  relevance?:     'direct' | 'indirect' | 'unrelated'
  relationType?:  GraphRelationType
  relationScore?: number
  explanation?:   string
  teachingNote?:  string
}

// ─── 캐시 유틸 ───────────────────────────────────────────────────────────────

function loadJSON<T>(p: string, def: T): T {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as T }
  catch { /* ignore */ }
  return def
}
function saveJSON(p: string, data: unknown): void {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8') } catch { /* ignore */ }
}

// ─── 코사인 유사도 ────────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ─── 한국어 어절 경계 매칭 ────────────────────────────────────────────────────

const KO_PARTICLE = new Set(['이','가','은','는','을','를','의','에','로','와','과','도','만','서','게','며','고'])

function koMatch(stored: string, query: string): boolean {
  const s = stored.toLowerCase()
  const q = query.toLowerCase()
  let idx = s.indexOf(q)
  while (idx !== -1) {
    const before = idx > 0 ? s[idx - 1] : ''
    if (!before || !/[\uAC00-\uD7A3]/.test(before)) {
      const after = s[idx + q.length] ?? ''
      const afterKo = /[\uAC00-\uD7A3]/.test(after)
      if (!afterKo || KO_PARTICLE.has(after)) return true
    }
    idx = s.indexOf(q, idx + 1)
  }
  return false
}

function overlapScore(haystack: string[], needles: string[]): number {
  if (!needles.length || !haystack.length) return 0
  let hits = 0
  for (const needle of needles) {
    if (haystack.some(h => koMatch(h, needle))) hits++
  }
  return hits / needles.length
}

function textContainsAny(text: string, terms: string[]): number {
  if (!terms.length) return 0
  const t = text.toLowerCase()
  let hits = 0
  for (const term of terms) { if (koMatch(t, term)) hits++ }
  return hits / terms.length
}

// ─── 기능 역할 분류 ───────────────────────────────────────────────────────────

function classifyFunctionRole(fns: string[]): string {
  const text = fns.join(' ').toLowerCase()
  const score = (kws: string[]) => kws.filter(k => text.includes(k)).length
  const scores: Record<string, number> = {
    expression: score(EXPRESSION_KW) + score(DISCUSSION_KW),
    inquiry:    score(INQUIRY_KW),
    value:      score(VALUE_KW),
    tool:       score(TOOL_KW),
    practice:   score(PRACTICE_KW),
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
}

function functionComplement(roleA: string, roleB: string): number {
  // 탐구↔표현, 탐구↔도구, 현상↔가치 조합이 가장 교육적으로 보완적
  const pairs: Record<string, string[]> = {
    inquiry:    ['expression', 'value', 'tool'],
    expression: ['inquiry', 'practice'],
    value:      ['inquiry', 'practice'],
    tool:       ['inquiry', 'expression'],
    practice:   ['inquiry', 'value'],
  }
  return (pairs[roleA]?.includes(roleB) || pairs[roleB]?.includes(roleA)) ? 1.0 : 0.2
}

// ─── Stage 1: 주제 구조화 (Claude Haiku, 캐시) ──────────────────────────────

export async function structureTopic(theme: string): Promise<StructuredTopic> {
  const cache = loadJSON<Record<string, StructuredTopic>>(TOPIC_CACHE_PATH, {})
  const cacheKey = theme.trim()
  if (cache[cacheKey]) return cache[cacheKey]

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallbackStructure(theme)

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: resolveClaudeModel('relation'),
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `초등학교 교과 융합 수업 주제를 구조화하라. 반드시 JSON만 출력하라.

주제: "${theme}"

출력 형식:
{
  "concept_anchors": ["핵심 개념어 3~6개"],
  "function_intents": ["학습 기능 2~4개 (탐구/비교/토론/표현 등 단어로)"],
  "value_intents": ["가치·태도 1~3개"],
  "context_terms": ["맥락 어휘 2~4개"],
  "output_hints": ["산출물 힌트 1~3개 (보고서/포스터/토론 등)"]
}`
      }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('no json')
    const parsed = JSON.parse(jsonMatch[0])
    const result: StructuredTopic = {
      raw: theme,
      concept_anchors: parsed.concept_anchors ?? [],
      function_intents: parsed.function_intents ?? [],
      value_intents: parsed.value_intents ?? [],
      context_terms: parsed.context_terms ?? [],
      output_hints: parsed.output_hints ?? [],
    }
    cache[cacheKey] = result
    saveJSON(TOPIC_CACHE_PATH, cache)
    return result
  } catch {
    return fallbackStructure(theme)
  }
}

function fallbackStructure(theme: string): StructuredTopic {
  const words = theme.split(/[\s,·]+/).filter(w => w.length >= 2)
  return {
    raw: theme,
    concept_anchors: words.slice(0, 5),
    function_intents: ['탐구', '이해', '표현'],
    value_intents: [],
    context_terms: [],
    output_hints: [],
  }
}

// ─── Stage 2+3: 핵심아이디어 + 다중 임베딩 검색 ──────────────────────────────

async function getTopicEmbedding(theme: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  try {
    const client = new OpenAI({ apiKey })
    const resp = await client.embeddings.create({ input: theme, model: 'text-embedding-3-small' })
    return resp.data[0].embedding
  } catch { return null }
}

// ─── Stage 4+5: 점수 계산 ────────────────────────────────────────────────────

function computeAnchorFit(std: CurriculumStandard, topic: StructuredTopic): number {
  const anchors = topic.concept_anchors
  if (!anchors.length) return 0.5

  // 키워드 배열 매칭 (고점)
  const kwHit = overlapScore(std.keywords ?? [], anchors)
  // 성취기준 원문 매칭 (중간)
  const textHit = textContainsAny(std.text, anchors)
  // knowledge 배열 매칭
  const knHit = overlapScore(std.knowledge ?? [], anchors)

  return Math.min(1, kwHit * 0.5 + textHit * 0.3 + knHit * 0.2)
}

function computeFunctionFit(std: CurriculumStandard, topic: StructuredTopic): number {
  const intents = topic.function_intents
  if (!intents.length) return 0.5
  const fnText = (std.functions ?? []).join(' ')
  return textContainsAny(fnText, intents)
}

function computeValueFit(std: CurriculumStandard, topic: StructuredTopic): number {
  const values = topic.value_intents
  if (!values.length) return 0.3
  const compText = (std.competencies ?? []).join(' ')
  const kwHit = overlapScore(std.keywords ?? [], values)
  const textHit = textContainsAny(std.text + ' ' + compText, values)
  return Math.min(1, kwHit * 0.6 + textHit * 0.4)
}

function computeCoreIdeaFit(
  std: CurriculumStandard,
  topic: StructuredTopic,
  coreIdeaMap: Map<string, string>
): number {
  const ciText = std.core_idea_id ? (coreIdeaMap.get(std.core_idea_id) ?? '') : ''
  if (!ciText) return 0.3
  const anchors = [...topic.concept_anchors, ...topic.context_terms]
  return textContainsAny(ciText, anchors)
}

function centerScore(
  semantic: number, coreIdeaFit: number, anchorFit: number,
  subjectFit: number, functionFit: number, valueFit: number
): number {
  return (
    0.20 * semantic +
    0.20 * coreIdeaFit +
    0.20 * anchorFit +
    0.15 * subjectFit +
    0.15 * functionFit +
    0.10 * valueFit
  )
}

function linkScore(
  pairSemantic: number,
  functionComplement: number,
  valueBridge: number,
  coreIdeaBridge: number,
  anchorFit: number,
  crossSubjectBonus: number,
  teachability: number
): number {
  return (
    0.15 * pairSemantic +
    0.20 * functionComplement +
    0.20 * valueBridge +
    0.15 * coreIdeaBridge +
    0.15 * anchorFit +
    0.10 * crossSubjectBonus +
    0.05 * teachability
  )
}

// ─── Stage 7: Claude 직접/간접/비관련 판정 ──────────────────────────────────

export type RelevanceLevel = 'direct' | 'indirect' | 'unrelated'

interface ClaudeJudgment {
  relevance: RelevanceLevel
  relationType?: GraphRelationType
  score: number
  explanation: string
  teachingNote?: string
}

interface RelationCacheEntry extends ClaudeJudgment {
  source: 'claude' | 'rule'
}

function buildFallbackJudgmentTeachingNote(
  center: CurriculumStandard,
  cand: CurriculumStandard,
  relationType: GraphRelationType,
): string {
  const centerSubject = SUBJECT_NAMES[center.subject_id] ?? center.subject_id
  const candidateSubject = SUBJECT_NAMES[cand.subject_id] ?? cand.subject_id
  switch (relationType) {
    case '도구-활용':
      return `${centerSubject} 학습 내용을 바탕으로 ${candidateSubject} 기능을 활용해 근거를 정리하고 표현하는 활동을 설계합니다.`
    case '현상-가치':
      return `${centerSubject}에서 탐구한 현상을 ${candidateSubject} 관점에서 해석하고 가치 판단으로 연결하는 토론 활동을 설계합니다.`
    case '내용-표현':
      return `${centerSubject}에서 다룬 내용을 ${candidateSubject} 활동으로 재구성해 표현하는 산출물 제작 활동을 설계합니다.`
    case '문제-해결':
      return `${centerSubject}와 ${candidateSubject} 관점을 함께 활용해 공통 문제 해결안을 만드는 협력 활동을 설계합니다.`
    case '탐구-실천':
      return `${centerSubject}의 탐구 결과를 ${candidateSubject}의 실천 활동으로 이어가는 프로젝트를 설계합니다.`
    case '개념-적용':
      return `${centerSubject} 핵심 개념을 ${candidateSubject} 맥락에 적용해 보는 수행 과제를 설계합니다.`
    case '원인-결과':
      return `${centerSubject}와 ${candidateSubject} 내용을 연결해 원인과 결과를 추론하는 분석 활동을 설계합니다.`
    case '의미연결':
    default:
      return `${centerSubject}와 ${candidateSubject}의 공통 개념을 비교하고 통합적으로 설명하는 활동을 설계합니다.`
  }
}

function buildFallbackJudgmentExplanation(
  center: CurriculumStandard,
  cand: CurriculumStandard,
  relationType: GraphRelationType,
): string {
  const candidateKeyword = cand.keywords?.[0] ?? cand.code
  const centerSubject = SUBJECT_NAMES[center.subject_id] ?? center.subject_id
  const candidateSubject = SUBJECT_NAMES[cand.subject_id] ?? cand.subject_id
  switch (relationType) {
    case '도구-활용':
      return `${centerSubject}에서 다루는 내용을 ${candidateSubject}의 기능과 방법으로 수행하도록 연결할 수 있습니다.`
    case '현상-가치':
      return `${centerSubject}에서 탐구한 내용을 ${candidateSubject}의 가치 판단과 성찰로 확장할 수 있습니다.`
    case '내용-표현':
      return `${centerSubject}에서 다룬 내용을 ${candidateSubject} 활동으로 재구성해 표현할 수 있습니다.`
    case '문제-해결':
      return `${centerSubject}와 ${candidateSubject}가 '${candidateKeyword}' 맥락에서 공통 문제 해결을 함께 다룹니다.`
    case '탐구-실천':
      return `${centerSubject}의 탐구 결과를 ${candidateSubject}의 실천 활동으로 이어갈 수 있습니다.`
    case '개념-적용':
      return `${centerSubject}에서 이해한 개념을 ${candidateSubject} 맥락에 적용해 볼 수 있습니다.`
    case '원인-결과':
      return `${centerSubject}와 ${candidateSubject}를 연결해 원인과 결과를 추론할 수 있습니다.`
    case '의미연결':
    default:
      return `${centerSubject}와 ${candidateSubject}가 '${candidateKeyword}'와 관련된 공통 의미를 중심으로 연결됩니다.`
  }
}

function ruleBasedJudgment(
  center: CurriculumStandard,
  cand: CurriculumStandard,
  topic: StructuredTopic,
  anchorFit: number
): ClaudeJudgment {
  const sameSubject = center.subject_id === cand.subject_id
  if (anchorFit < 0.05 && !sameSubject) {
    return { relevance: 'unrelated', score: 0, explanation: '주제와 개념 연결이 낮습니다.' }
  }
  const SUBJECT_ROLE: Record<string, string> = {
    sub_math: 'tool', sub_prac: 'tool',
    sub_sci: 'phenomenon', sub_soc: 'phenomenon',
    sub_mor: 'value',
    sub_kor: 'expression', sub_art: 'expression', sub_mus: 'expression', sub_pe: 'expression',
  }
  const cr = SUBJECT_ROLE[center.subject_id] ?? 'other'
  const tr = SUBJECT_ROLE[cand.subject_id] ?? 'other'
  let relType: GraphRelationType = DEFAULT_GRAPH_RELATION_TYPE
  if ((cr === 'tool') !== (tr === 'tool') && (cr === 'tool' || tr === 'tool')) relType = '도구-활용'
  else if ((cr === 'phenomenon' && tr === 'value') || (cr === 'value' && tr === 'phenomenon')) relType = '현상-가치'
  else if (tr === 'expression' || cr === 'expression') relType = '내용-표현'
  return {
    relevance: anchorFit >= 0.15 ? 'direct' : 'indirect',
    relationType: relType,
    score: 0.5,
    explanation: `${SUBJECT_NAMES[cand.subject_id] ?? cand.subject_id}의 활동으로 연결 가능합니다.`,
    teachingNote: buildFallbackJudgmentTeachingNote(center, cand, relType),
  }
}

export async function judgeRelations(
  theme: string,
  center: CurriculumStandard,
  candidates: CurriculumStandard[],
  topic: StructuredTopic,
  anchorFitMap: Map<string, number>,
  coreIdeaMap: Map<string, string>,
): Promise<Map<string, ClaudeJudgment>> {
  const results = new Map<string, ClaudeJudgment>()
  const cache = loadJSON<Record<string, RelationCacheEntry>>(RELATION_CACHE_PATH, {})
  const cacheKey = (themeText: string, a: string, b: string) =>
    `search-${LESSON_AUDIENCE_VERSION}::${themeText.toLowerCase().trim().replace(/\s+/g, ' ')}::${a}→${b}`

  const toJudge: CurriculumStandard[] = []
  for (const cand of candidates) {
    const ck = cacheKey(theme, center.id, cand.id)
    if (cache[ck]) {
      const relationType = normalizeGraphRelationType(cache[ck].relationType)
      const fallback = ruleBasedJudgment(center, cand, topic, anchorFitMap.get(cand.id) ?? 0)
      results.set(cand.id, {
        ...cache[ck],
        relationType,
        explanation: cache[ck].explanation?.trim()
          || (relationType ? buildFallbackJudgmentExplanation(center, cand, relationType) : fallback.explanation),
        teachingNote: cache[ck].teachingNote ?? (relationType
          ? buildFallbackJudgmentTeachingNote(center, cand, relationType)
          : undefined),
      })
    } else {
      toJudge.push(cand)
    }
  }

  if (toJudge.length === 0) return results

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    for (const cand of toJudge) {
      results.set(cand.id, ruleBasedJudgment(center, cand, topic, anchorFitMap.get(cand.id) ?? 0))
    }
    return results
  }

  const client = new Anthropic({ apiKey })

  // 배치 처리: 4개씩 묶어서 호출
  const BATCH = 4
  for (let i = 0; i < toJudge.length; i += BATCH) {
    const batch = toJudge.slice(i, i + BATCH)

    const candidateList = batch.map((c, idx) => {
      const ciText = c.core_idea_id ? (coreIdeaMap.get(c.core_idea_id) ?? '') : ''
      return `[후보 ${idx + 1}] ${c.code} (${SUBJECT_NAMES[c.subject_id] ?? c.subject_id})
핵심아이디어: ${ciText.slice(0, 80)}
성취기준: ${c.text}
개념: ${(c.keywords ?? []).slice(0, 4).join(', ')}
기능: ${(c.functions ?? []).join('; ').slice(0, 100)}
가치·태도: ${(c.competencies ?? []).slice(0, 2).join(', ')}`
    }).join('\n\n')

    const centerCiText = center.core_idea_id ? (coreIdeaMap.get(center.core_idea_id) ?? '') : ''
    const prompt = `당신은 초등 교과 융합 수업 전문가입니다. 각 후보 성취기준이 중심 성취기준과 교육적으로 얼마나 연결되는지 판정하라.

수업 주제: "${theme}"
주제 핵심개념: ${topic.concept_anchors.join(', ')}
주제 기능의도: ${topic.function_intents.join(', ')}
${lessonAudiencePrompt(center.grade_band, [center, ...batch].map(std => ({ code: std.code, gradeBand: std.grade_band })))}

중심 성취기준: ${center.code} (${SUBJECT_NAMES[center.subject_id] ?? center.subject_id})
핵심아이디어: ${centerCiText.slice(0, 80)}
성취기준: ${center.text}
개념: ${(center.keywords ?? []).slice(0, 4).join(', ')}
기능: ${(center.functions ?? []).join('; ').slice(0, 100)}

후보 성취기준:
${candidateList}

각 후보에 대해:
1. 관련성 판정: "직접관련"(주제와 직접 연결) / "간접관련"(주제 맥락에서 연결 가능) / "비관련"(주제와 연결 어려움)
2. 관련인 경우만: 관계유형 (의미연결/도구-활용/현상-가치/내용-표현/문제-해결/탐구-실천/개념-적용/원인-결과)
3. 설명 (1문장, 실제 성취기준 내용 언급)
4. 수업활동 제안 (1문장, 구체적 활동)

반드시 JSON만 출력:
{
  "judgments": [
    {
      "index": 1,
      "relevance": "직접관련",
      "relationType": "내용-표현",
      "score": 0.85,
      "explanation": "...",
      "teachingNote": "..."
    }
  ]
}`

    try {
      const msg = await client.messages.create({
        model: resolveClaudeModel('relation'),
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('no json')
      const parsed = JSON.parse(jsonMatch[0]) as {
        judgments: Array<{
          index: number
          relevance: string
          relationType?: GraphRelationType
          score: number
          explanation: string
          teachingNote?: string
        }>
      }

      const handled = new Set<string>()
      for (const j of parsed.judgments) {
        const cand = batch[j.index - 1]
        if (!cand) continue
        handled.add(cand.id)
        const relevanceMap: Record<string, RelevanceLevel> = {
          '직접관련': 'direct', '간접관련': 'indirect', '비관련': 'unrelated',
        }
        const relevance = relevanceMap[j.relevance] ?? 'indirect'
        const relationType = normalizeGraphRelationType(j.relationType)
        const fallback = ruleBasedJudgment(center, cand, topic, anchorFitMap.get(cand.id) ?? 0)
        const entry: RelationCacheEntry = {
          relevance,
          relationType: relevance === 'unrelated' ? undefined : (relationType ?? fallback.relationType),
          score: Math.min(1, Math.max(0, j.score)),
          explanation: j.explanation?.trim()
            || (relevance === 'unrelated'
              ? fallback.explanation
              : buildFallbackJudgmentExplanation(center, cand, relationType ?? fallback.relationType ?? DEFAULT_GRAPH_RELATION_TYPE)),
          teachingNote: relevance === 'unrelated'
            ? undefined
            : (j.teachingNote?.trim() || (relationType ?? fallback.relationType
              ? buildFallbackJudgmentTeachingNote(center, cand, relationType ?? fallback.relationType ?? DEFAULT_GRAPH_RELATION_TYPE)
              : undefined)),
          source: 'claude',
        }
        if (lessonDifficultyIssues(entry.teachingNote ?? '', center.grade_band, [{ code: center.code, gradeBand: center.grade_band }, { code: cand.code, gradeBand: cand.grade_band }]).length) {
          entry.teachingNote = '학년군과 수업 주제에 맞는 수업 예시를 만들지 못했습니다. 다시 생성해 주세요.'
          entry.source = 'rule'
          results.set(cand.id, entry)
        } else {
          results.set(cand.id, entry)
          cache[cacheKey(theme, center.id, cand.id)] = entry
        }
      }

      for (const cand of batch) {
        if (handled.has(cand.id)) continue
        const fallback = ruleBasedJudgment(center, cand, topic, anchorFitMap.get(cand.id) ?? 0)
        results.set(cand.id, fallback)
        cache[cacheKey(theme, center.id, cand.id)] = { ...fallback, source: 'rule' }
      }
    } catch (err) {
      console.error('[ontologySearch] Claude 판정 실패:', err)
      for (const cand of batch) {
        if (!results.has(cand.id)) {
          const r = ruleBasedJudgment(center, cand, topic, anchorFitMap.get(cand.id) ?? 0)
          results.set(cand.id, r)
          cache[cacheKey(theme, center.id, cand.id)] = { ...r, source: 'rule' }
        }
      }
    }
  }

  saveJSON(RELATION_CACHE_PATH, cache)
  return results
}

// ─── Stage 8: 의미망 최적화 ──────────────────────────────────────────────────

function optimizeGraph(
  center: OntologyNode,
  candidates: OntologyNode[],
  maxNodes = 8,
): OntologyNode[] {
  // 비관련 제거
  const relevant = candidates.filter(c => c.relevance !== 'unrelated')

  // 동일 교과 최대 2개 제약
  const subjectCount: Record<string, number> = { [center.subjectId]: 1 }
  const MAX_SAME = 2
  const selected: OntologyNode[] = []

  // linkScore 내림차순 정렬
  const sorted = [...relevant].sort((a, b) => (b.linkScore ?? 0) - (a.linkScore ?? 0))

  // 역할 균형 추적
  const roleSet = new Set<string>([center.functionRole ?? 'other'])

  for (const node of sorted) {
    if (selected.length >= maxNodes) break
    const cnt = subjectCount[node.subjectId] ?? 0
    if (cnt >= MAX_SAME) continue
    subjectCount[node.subjectId] = cnt + 1
    selected.push(node)
    if (node.functionRole) roleSet.add(node.functionRole)
  }

  // 가치 노드 최소 1개 보장
  const hasValue = selected.some(n => n.functionRole === 'value' || n.subjectId === 'sub_mor')
  if (!hasValue) {
    const valueNode = sorted.find(
      n => !selected.includes(n) && (n.functionRole === 'value' || n.subjectId === 'sub_mor')
    )
    if (valueNode) { selected.pop(); selected.push(valueNode) }
  }

  // 표현/실천 노드 최소 1개 보장
  const hasExpr = selected.some(n => ['expression', 'practice'].includes(n.functionRole ?? ''))
  if (!hasExpr) {
    const exprNode = sorted.find(
      n => !selected.includes(n) && ['expression', 'practice'].includes(n.functionRole ?? '')
    )
    if (exprNode) { selected.pop(); selected.push(exprNode) }
  }

  return selected
}

// ─── 메인 함수: searchOntology ─────────────────────────────────────────────────

export interface OntologySearchResult {
  structuredTopic: StructuredTopic
  center: OntologyNode
  connections: OntologyNode[]
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
}

export interface GraphNode {
  id: string
  type: 'standard' | 'subject' | 'core_idea'
  label: string
  text?: string
  subject_id?: string
  grade_band?: string
  area?: string
  keywords?: string[]
  competencies?: string[]
  group: string
  similarityScore?: number
  isCenter?: boolean
  relevance?: RelevanceLevel
  functionRole?: string
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  relation: GraphRelationType
  weight: number
  method: string
  explanation?: string
  teachingNote?: string
}

export async function searchOntology(
  theme: string,
  gradeGroup?: string,
  forcedCenterId?: string,
): Promise<OntologySearchResult | null> {
  const graph = loadGraph()
  if (!graph) return null

  // ── 학년군 필터 ──────────────────────────────────────────────────────────
  const BAND_MAP: Record<string, string[]> = {
    '초1-2': ['초1-2'], '초3-4': ['초3-4'], '초5-6': ['초5-6'],
    '중1-3': ['중1-3'], '고공통': ['고'], '고선택': ['고'],
  }
  const allowedBands = gradeGroup ? (BAND_MAP[gradeGroup] ?? [gradeGroup]) : []
  const bandOk = (std: CurriculumStandard) =>
    allowedBands.length === 0 || allowedBands.some(b => (std.grade_band ?? '').includes(b))

  // ── 핵심아이디어 맵 ──────────────────────────────────────────────────────
  const coreIdeaMap = new Map<string, string>()
  for (const ci of graph.coreIdeas) {
    coreIdeaMap.set(ci.id, ci.ideas.slice(0, 2).join(' '))
  }

  // ── Stage 1: 주제 구조화 ─────────────────────────────────────────────────
  const topic = await structureTopic(theme)

  // ── Stage 3: 임베딩 기반 후보 검색 ──────────────────────────────────────
  const embedCache = loadJSON<Record<string, number[]>>(EMBED_CACHE_PATH, {})
  const topicEmb = await getTopicEmbedding(theme)

  const filtered = graph.achievementStandards.filter(bandOk)

  // ── Stage 4: 다중 점수 계산 (AnchorFit 하한 필터) ────────────────────────
  const scored = filtered.map(std => {
    const embScore = topicEmb && embedCache[std.id]
      ? cosine(topicEmb, embedCache[std.id])
      : 0

    const anchorFit   = computeAnchorFit(std, topic)
    const functionFit = computeFunctionFit(std, topic)
    const valueFit    = computeValueFit(std, topic)
    const coreIdeaFit = computeCoreIdeaFit(std, topic, coreIdeaMap)
    const ciText      = std.core_idea_id ? (coreIdeaMap.get(std.core_idea_id) ?? '') : ''
    const coreEmbScore = topicEmb && std.core_idea_id
      ? textContainsAny(ciText, topic.concept_anchors)
      : 0

    const semantic = embScore > 0
      ? 0.45 * embScore + 0.35 * coreEmbScore + 0.20 * anchorFit
      : anchorFit * 0.5 + functionFit * 0.3 + valueFit * 0.2

    const cs = centerScore(semantic, coreIdeaFit, anchorFit, 0.5, functionFit, valueFit)

    return {
      std, embScore, anchorFit, functionFit, valueFit,
      coreIdeaFit, semantic, cs, ciText,
    }
  })

  // Stage 4: AnchorFit < 0.05 AND embScore < 0.30 → 제거
  const filtered2 = scored.filter(s =>
    s.anchorFit >= 0.05 || s.embScore >= 0.30
  )

  // Stage 5: 상위 20개 CenterScore 기준
  let top20 = filtered2
    .sort((a, b) => b.cs - a.cs)
    .slice(0, 20)

  if (top20.length === 0) return null

  // [2026-09-20] Stage 5b: Jev 재순위 — 임베딩·규칙 점수는 후보를 좁히는 데만 쓰고,
  // 중심 성취기준 선택 순서는 Jev 관련도(0~1)와 정규화한 cs 를 절반씩 섞어 정한다.
  // 실측에서 임베딩 순위는 교과별 기본값 쏠림이 있었다(docs/eval-2026-09-20). 실패 시 그대로.
  if (jevJudgeEnabled()) {
    const subjectName = new Map(graph.subjects.map(s => [s.id, s.name_ko]))
    // 창체(sub_extra) 노드는 핵심아이디어가 없어 그래프 중심으로 부적합 — 재순위 대상에서 제외(원래 순위 유지).
    const judgeable = top20.filter(s => s.std.subject_id !== 'sub_extra')
    const judgement = await judgeTopicRelevance(theme, gradeGroup, judgeable.map(s => ({
      id: s.std.id, code: s.std.code, subject: subjectName.get(s.std.subject_id) ?? s.std.subject_id, text: s.std.text,
    })))
    if (judgement) {
      const maxCs = Math.max(...top20.map(s => s.cs)) || 1
      top20 = top20
        .map(s => ({ ...s, cs: 0.5 * (s.cs / maxCs) + 0.5 * (judgement.scores[s.std.id] ?? (s.std.subject_id === 'sub_extra' ? 0 : 0)) }))
        .sort((a, b) => b.cs - a.cs)
      console.log('[ontology-search] jev rerank', JSON.stringify({ theme: theme.slice(0, 40), ms: judgement.elapsedMs, top: top20.slice(0, 3).map(s => s.std.code) }))
    }
  }

  // ── 중심 성취기준 결정 ───────────────────────────────────────────────────
  let centerEntry = top20[0]
  if (forcedCenterId) {
    const forced = top20.find(s => s.std.id === forcedCenterId)
      ?? scored.find(s => s.std.id === forcedCenterId)
    if (forced) centerEntry = forced
  }
  const centerStd = centerEntry.std

  // ── Stage 6: LinkScore 계산 ──────────────────────────────────────────────
  const centerRole = classifyFunctionRole(centerStd.functions ?? [])

  const linkScored = top20
    .filter(s => s.std.id !== centerStd.id)
    .map(s => {
      const candRole = classifyFunctionRole(s.std.functions ?? [])
      const fnComp   = functionComplement(centerRole, candRole)

      // 가치 브리지: candidate가 가치/태도 관련이거나 topic value와 겹치면 높음
      const valueBridge = computeValueFit(s.std, topic) * 0.6 +
        (s.std.subject_id === 'sub_mor' || s.std.subject_id === 'sub_soc' ? 0.4 : 0)

      // CoreIdeaBridge: 핵심아이디어 텍스트가 겹치는 정도
      const centerCiText = centerStd.core_idea_id ? (coreIdeaMap.get(centerStd.core_idea_id) ?? '') : ''
      const candCiText   = s.std.core_idea_id ? (coreIdeaMap.get(s.std.core_idea_id) ?? '') : ''
      const ciOverlap = topic.concept_anchors.filter(a =>
        koMatch(centerCiText, a) && koMatch(candCiText, a)
      ).length / Math.max(topic.concept_anchors.length, 1)

      // 교과 다양성 보너스
      const crossBonus = centerStd.subject_id !== s.std.subject_id ? 1.0 : 0.2

      const ls = linkScore(
        s.semantic, fnComp, valueBridge, ciOverlap, s.anchorFit, crossBonus, 0.5
      )

      return { ...s, ls, candRole, fnComp }
    })
    .sort((a, b) => b.ls - a.ls)

  // ── Stage 7: Claude 판정 (상위 10개만) ──────────────────────────────────
  const top10Cands = linkScored.slice(0, 10).map(s => s.std)
  const anchorFitMap = new Map(linkScored.map(s => [s.std.id, s.anchorFit]))
  const judgments = await judgeRelations(theme, centerStd, top10Cands, topic, anchorFitMap, coreIdeaMap)

  // ── OntologyNode 조립 ────────────────────────────────────────────────────
  const toNode = (s: typeof scored[0], ls?: number, candRole?: string): OntologyNode => {
    const j = judgments.get(s.std.id)
    return {
      standard: s.std,
      subjectId: s.std.subject_id,
      subjectName: SUBJECT_NAMES[s.std.subject_id] ?? s.std.subject_id,
      coreIdeaText: s.ciText,
      semanticScore: s.semantic,
      anchorFit: s.anchorFit,
      functionFit: s.functionFit,
      valueFit: s.valueFit,
      coreIdeaFit: s.coreIdeaFit,
      centerScore: s.cs,
      linkScore: ls,
      functionRole: candRole ?? classifyFunctionRole(s.std.functions ?? []),
      relevance: j?.relevance,
      relationType: j?.relationType,
      relationScore: j?.score,
      explanation: j?.explanation,
      teachingNote: j?.teachingNote,
    }
  }

  const centerNode: OntologyNode = toNode(centerEntry, undefined, centerRole)
  centerNode.relevance = 'direct'

  const allCandNodes = linkScored.map(s =>
    toNode(s, s.ls, s.candRole)
  )

  // ── Stage 8: 의미망 최적화 ──────────────────────────────────────────────
  const optimized = optimizeGraph(centerNode, allCandNodes, 8)

  // ── GraphNode / GraphEdge 생성 ───────────────────────────────────────────
  const visibleIds = new Set([centerStd.id, ...optimized.map(n => n.standard.id)])

  const graphNodes: GraphNode[] = []
  const graphEdges: GraphEdge[] = []

  for (const node of [centerNode, ...optimized]) {
    const std = node.standard
    graphNodes.push({
      id: std.id,
      type: 'standard',
      label: std.code,
      text: std.text,
      subject_id: std.subject_id,
      grade_band: std.grade_band,
      area: std.area,
      keywords: std.keywords,
      competencies: std.competencies,
      group: 'standard',
      similarityScore: node.semanticScore,
      isCenter: std.id === centerStd.id,
      relevance: node.relevance,
      functionRole: node.functionRole,
    })
    if (std.id !== centerStd.id) {
      const relType = normalizeGraphRelationType(node.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE
      graphEdges.push({
        id: `e_${centerStd.id}_${std.id}`,
        source: centerStd.id,
        target: std.id,
        relation: relType,
        weight: node.relationScore ?? node.linkScore ?? 0,
        method: node.relevance === 'direct' ? 'claude' : 'ontology',
        explanation: node.explanation,
        teachingNote: node.teachingNote,
      })
    }
  }

  // cross-subject links between connected nodes
  const crossLinks: CrossSubjectLink[] = graph.links_cross_subject.filter(
    lk => visibleIds.has(lk.source_id) && visibleIds.has(lk.target_id) &&
          lk.source_id !== centerStd.id && lk.target_id !== centerStd.id
  )
  for (const lk of crossLinks) {
    const relEdu = normalizeGraphRelationType((lk as unknown as Record<string, unknown>).relation_edu as string | undefined)
    graphEdges.push({
      id: `csl_${lk.source_id}_${lk.target_id}`,
      source: lk.source_id,
      target: lk.target_id,
      relation: relEdu ?? DEFAULT_GRAPH_RELATION_TYPE,
      weight: lk.weight,
      method: 'hybrid',
    })
  }

  return { structuredTopic: topic, center: centerNode, connections: optimized, graphNodes, graphEdges }
}

/**
 * 성취기준 간 교육적 관계 분류 — Claude API 기반
 *
 * MVP 관계 유형 (4종 우선, 8종 확장 가능):
 *   의미연결 / 도구-활용 / 현상-가치 / 내용-표현
 *   문제-해결 / 탐구-실천 / 개념-적용 / 원인-결과
 *
 * 캐시: ../교육과정/curri/output/relation_cache.json
 *   → 동일 (sourceId, targetId) 쌍은 재호출 없이 재사용
 */

import Anthropic from '@anthropic-ai/sdk'
import { resolveClaudeModel } from '@/lib/llm/anthropic'
import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import { LESSON_AUDIENCE_VERSION, lessonAudiencePrompt, lessonDifficultyIssues } from './lessonAudience'
import type { GraphRelationType } from '@/lib/knowledge-graph/domain'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType } from '@/lib/knowledge-graph/domain'
import { jevJudgeEnabled, judgeRelations, verifyTeachingNotes, type RelationJudgement } from '@/lib/curriculum/jevJudge'

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type RelationType = GraphRelationType

export interface StandardMeta {
  id: string
  code: string
  subjectId: string
  subjectName: string
  gradeBand?: string
  coreIdea?: string   // 핵심아이디어 텍스트
  text: string        // 성취기준 원문
  keywords: string[]  // concepts/keywords
  functions: string[]
  values: string[]    // competencies/attitudes
}

export interface RelationResult {
  sourceId: string
  targetId: string
  relationType: RelationType
  score: number          // 0–1 (Claude 판단 강도)
  explanation: string    // 관계 근거 (1문장)
  ideas?: string[]       // 수업 아이디어 2~3개 (콘텐츠 접근: 보편/창의 혼합)
  teachingNote?: string  // 수업 제안: 차시·역할·산출물이 있는 융합 수업 구조
  source: 'claude' | 'rule'
  /** [2026-09-20] 관계 유형·강도를 Jev 가 판정했으면 'jev'. LLM 은 설명·아이디어·수업 제안만 썼다. */
  judge?: 'jev'
  /** Jev Noul: 수업 제안이 두 성취기준을 실제로 다루는 정도(0~1). 재작성 후 값. */
  verified?: number
}

// ─── 캐시 ────────────────────────────────────────────────────────────────────

const CACHE_PATH = [
  path.join(process.cwd(), 'public/relation_cache.json'),
  path.join(process.cwd(), 'data/relation_cache.json'),
  path.join(process.cwd(), '../교육과정/curri/output/relation_cache.json'),
].find(p => fs.existsSync(p)) ?? path.join(process.cwd(), 'public/relation_cache.json')

let _cache: Record<string, RelationResult> | null = null

function cacheKey(theme: string, center: StandardMeta, candidate: StandardMeta, gradeGroup?: string, artifactContext?: string): string {
  // Curriculum, audience, topic and teacher context all affect the lesson. Old unscoped examples are not reused.
  return `${LESSON_AUDIENCE_VERSION}::${createHash('sha256').update(JSON.stringify({
    theme: theme.trim(), center, candidate, gradeGroup: gradeGroup ?? '', artifactContext: artifactContext ?? '',
  })).digest('hex')}`
}

function loadCache(): Record<string, RelationResult> {
  if (_cache) return _cache
  try {
    if (fs.existsSync(CACHE_PATH)) {
      _cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'))
      return _cache!
    }
  } catch { /* ignore */ }
  _cache = {}
  return _cache
}

function saveCache(cache: Record<string, RelationResult>): void {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

// ─── 규칙 기반 폴백 ──────────────────────────────────────────────────────────

const SUBJECT_ROLE: Record<string, string> = {
  sub_math: 'tool',  sub_prac: 'tool',
  sub_sci:  'phenomenon', sub_soc: 'phenomenon',
  sub_mor:  'value',
  sub_kor:  'expression', sub_art: 'expression',
  sub_mus:  'expression', sub_pe:  'expression', sub_eng: 'expression',
  sub_int:  'integrated', sub_extra: 'integrated',
}

function buildFallbackTeachingNote(
  center: StandardMeta,
  cand: StandardMeta,
  relationType: RelationType,
): string {
  switch (relationType) {
    case '도구-활용':
      return `${center.subjectName} 탐구 내용을 바탕으로 ${cand.subjectName}의 기능을 활용해 결과를 정리하거나 발표하는 활동을 설계합니다.`
    case '현상-가치':
      return `${center.subjectName}에서 다룬 현상을 ${cand.subjectName} 관점에서 토론하고 가치 판단으로 연결하는 활동을 설계합니다.`
    case '내용-표현':
      return `${center.subjectName}에서 탐구한 내용을 ${cand.subjectName} 활동으로 표현하는 산출물 제작 활동을 설계합니다.`
    case '문제-해결':
      return `${center.subjectName}와 ${cand.subjectName} 관점을 함께 활용해 공통 문제 해결 방안을 만드는 협력 활동을 설계합니다.`
    case '탐구-실천':
      return `${center.subjectName} 탐구 결과를 ${cand.subjectName}의 실천 활동으로 이어가는 프로젝트를 설계합니다.`
    case '개념-적용':
      return `${center.subjectName}의 핵심 개념을 ${cand.subjectName} 맥락에 적용해 보는 수행 활동을 설계합니다.`
    case '원인-결과':
      return `${center.subjectName}와 ${cand.subjectName} 내용을 연결해 원인과 결과를 추론하는 분석 활동을 설계합니다.`
    case '의미연결':
    default:
      return `${center.subjectName}와 ${cand.subjectName}의 공통 개념을 비교하며 통합적으로 이해하는 활동을 설계합니다.`
  }
}

function buildFallbackExplanation(
  center: StandardMeta,
  cand: StandardMeta,
  relationType: RelationType,
): string {
  const candidateKeyword = cand.keywords[0] ?? cand.code
  switch (relationType) {
    case '도구-활용':
      return `${center.subjectName}에서 다루는 내용을 ${cand.subjectName}의 기능과 방법으로 수행하도록 연결할 수 있습니다.`
    case '현상-가치':
      return `${center.subjectName}에서 탐구한 내용을 ${cand.subjectName}의 가치 판단과 성찰로 확장할 수 있습니다.`
    case '내용-표현':
      return `${center.subjectName}에서 다룬 내용을 ${cand.subjectName} 활동으로 재구성해 표현할 수 있습니다.`
    case '문제-해결':
      return `${center.subjectName}와 ${cand.subjectName}가 '${candidateKeyword}' 맥락에서 공통 문제 해결을 함께 다룹니다.`
    case '탐구-실천':
      return `${center.subjectName}의 탐구 결과를 ${cand.subjectName}의 실천 활동으로 이어갈 수 있습니다.`
    case '개념-적용':
      return `${center.subjectName}에서 이해한 개념을 ${cand.subjectName} 맥락에 적용해 볼 수 있습니다.`
    case '원인-결과':
      return `${center.subjectName}와 ${cand.subjectName}를 연결해 원인과 결과를 추론할 수 있습니다.`
    case '의미연결':
    default:
      return `${center.subjectName}와 ${cand.subjectName}가 '${candidateKeyword}'와 관련된 공통 의미를 중심으로 연결됩니다.`
  }
}

function ruleBasedRelation(center: StandardMeta, cand: StandardMeta): RelationResult {
  const sr = SUBJECT_ROLE[center.subjectId] ?? 'other'
  const tr = SUBJECT_ROLE[cand.subjectId] ?? 'other'

  let relationType: RelationType = '의미연결'
  if ((sr === 'tool') !== (tr === 'tool') && (sr === 'tool' || tr === 'tool')) {
    relationType = '도구-활용'
  } else if (
    (sr === 'phenomenon' && tr === 'value') ||
    (sr === 'value' && tr === 'phenomenon')
  ) {
    relationType = '현상-가치'
  } else if (sr === 'expression' || tr === 'expression') {
    relationType = '내용-표현'
  }

  const explanations: Record<RelationType, string> = {
    '도구-활용': `${cand.subjectName}의 기능과 방법을 ${center.subjectName} 탐구에 도구로 활용할 수 있습니다.`,
    '현상-가치': `${center.subjectName}에서 탐구한 현상을 ${cand.subjectName}에서 가치·윤리적 관점으로 성찰할 수 있습니다.`,
    '내용-표현': `${center.subjectName}에서 탐구한 내용을 ${cand.subjectName}의 활동으로 창의적으로 표현할 수 있습니다.`,
    '의미연결': `두 성취기준이 공통 개념·주제를 중심으로 연결됩니다.`,
    '문제-해결': `두 교과가 동일한 문제를 서로 다른 방식으로 함께 해결합니다.`,
    '탐구-실천': `탐구 활동이 실천 활동으로 이어지는 관계입니다.`,
    '개념-적용': `한 쪽은 개념 이해, 다른 쪽은 그 개념의 적용·실천입니다.`,
    '원인-결과': `인과 구조로 이어지는 관계입니다.`,
  }

  return {
    sourceId: center.id,
    targetId: cand.id,
    relationType,
    score: 0.5,
    explanation: explanations[relationType],
    teachingNote: buildFallbackTeachingNote(center, cand, relationType),
    source: 'rule',
  }
}

/** LLM 이 실패해도 Jev 판정(유형·강도)은 살린 규칙 폴백. */
function ruleWithJudgement(
  center: StandardMeta,
  cand: StandardMeta,
  verdict?: RelationJudgement['byCandidateId'][string],
): RelationResult {
  const base = ruleBasedRelation(center, cand)
  if (!verdict) return base
  const relationType = normalizeGraphRelationType(verdict.relationType) ?? base.relationType
  return {
    ...base,
    relationType,
    score: verdict.strength,
    explanation: buildFallbackExplanation(center, cand, relationType),
    teachingNote: buildFallbackTeachingNote(center, cand, relationType),
    judge: 'jev',
  }
}

// ─── Claude 분류 ──────────────────────────────────────────────────────────────

// Reserve up to 20s for one repair and 8s for rechecking within the 60s route budget.
const REWRITE_DEADLINE_MS = 30_000
const VERIFY_THRESHOLD = 0.5

async function verifyAndRewrite(params: {
  client: Anthropic
  theme: string
  center: StandardMeta
  toClassify: StandardMeta[]
  results: RelationResult[]
  artifactContext?: string
  gradeGroup?: string
  startedAt: number
}): Promise<void> {
  const { client, theme, center, toClassify, results, artifactContext, gradeGroup, startedAt } = params
  const byTarget = new Map(results.filter(r => r.source === 'claude').map(r => [r.targetId, r]))
  const candById = new Map(toClassify.map(c => [c.id, c]))
  const items = [...byTarget.values()].map(r => ({
    candidate: candById.get(r.targetId)!, relationType: r.relationType,
    teachingNote: r.teachingNote ?? '', ideas: r.ideas,
  })).filter(item => item.candidate)
  const useJudge = jevJudgeEnabled()
  const check = (target: typeof items) => useJudge
    ? verifyTeachingNotes(theme, center, target, gradeGroup, artifactContext)
    : Promise.resolve(null)
  const applyVerdict = (verdict: Awaited<ReturnType<typeof verifyTeachingNotes>>) => {
    for (const [id, score] of Object.entries(verdict?.byCandidateId ?? {})) {
      const result = byTarget.get(id)
      if (result) result.verified = score
    }
  }
  applyVerdict(await check(items))
  const issuesFor = (id: string) => {
    const result = byTarget.get(id)!, candidate = candById.get(id)!
    return lessonDifficultyIssues([result.teachingNote, ...(result.ideas ?? [])].join('\n'), gradeGroup, [center, candidate])
  }
  const failing = items.filter(item => issuesFor(item.candidate.id).length > 0
    || (byTarget.get(item.candidate.id)?.verified ?? 1) < VERIFY_THRESHOLD)
  if (failing.length === 0) return
  const rewrittenIds = new Set<string>()

  if (performance.now() - startedAt <= REWRITE_DEADLINE_MS) {
    const rewritePrompt = `당신은 초등 교육과정 융합 수업 설계 전문가입니다.
아래 예시는 학년 수준·수업 주제·성취기준 연결 중 하나가 부적합합니다. 선택한 성취기준과 관계 유형을 유지하면서 학생이 실제로 수행할 수 있게 한 번만 다시 쓰십시오.
${lessonAudiencePrompt(gradeGroup, [center, ...failing.map(item => item.candidate)])}
## 수업 주제
${theme || '(미지정)'}
## 교사가 정한 수업 맥락
${artifactContext || '(추가 맥락 없음)'}
## 중심 성취기준
${center.code} (${center.subjectName}) ${center.text}
## 다시 쓸 후보
${failing.map((item, i) => `[후보 ${i + 1}] ${item.candidate.code} (${item.candidate.subjectName}) ${item.candidate.text}
- 관계 유형: ${item.relationType}
- 수정 사유: ${issuesFor(item.candidate.id).join(', ') || '학년 수준·주제·두 성취기준을 실제로 다루는지 재검토 필요'}
- 직전 제안: ${item.teachingNote}
- 직전 아이디어: ${(item.ideas ?? []).join(' / ')}`).join('\n\n')}
## 출력(JSON만)
{ "relations": [ { "index": 1, "explanation": "두 성취기준의 연결 근거", "ideas": ["학년 수준의 구체적 활동"], "teachingNote": "교사 준비 자료, 짧은 학생 활동 단계, 산출물과 확인 방법" } ] }`
    try {
      const msg = await client.messages.create({
        model: resolveClaudeModel('relation'), max_tokens: 2500, temperature: 0.4,
        messages: [{ role: 'user', content: rewritePrompt }],
      }, { timeout: 20_000 })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const json = text.match(/\{[\s\S]*\}/)?.[0]
      const parsed = json ? JSON.parse(json) as { relations?: Array<{ index: number; explanation?: string; ideas?: string[]; teachingNote?: string }> } : null
      const rewritten: typeof items = []
      for (const rel of parsed?.relations ?? []) {
        const item = failing[rel.index - 1], result = item && byTarget.get(item.candidate.id)
        if (!item || !result || typeof rel.teachingNote !== 'string' || !rel.teachingNote.trim()) continue
        result.teachingNote = rel.teachingNote.trim()
        if (rel.explanation?.trim()) result.explanation = rel.explanation.trim()
        result.ideas = Array.isArray(rel.ideas) ? rel.ideas.filter(s => typeof s === 'string' && s.trim()).slice(0, 3) : []
        rewrittenIds.add(item.candidate.id)
        rewritten.push({ candidate: item.candidate, relationType: result.relationType, teachingNote: result.teachingNote, ideas: result.ideas })
      }
      if (rewritten.length) applyVerdict(await check(rewritten))
    } catch (err) {
      console.error('[ontologyRelation] 학년 수준 재작성 실패:', err)
    }
  }
  // A failed repair is not a usable lesson and must not be cached as a successful generation.
  for (const item of failing) {
    const result = byTarget.get(item.candidate.id)!
    if (!rewrittenIds.has(item.candidate.id) || issuesFor(item.candidate.id).length
      || (result.verified ?? 1) < VERIFY_THRESHOLD) {
      result.teachingNote = '학년군과 수업 주제에 맞는 수업 예시를 만들지 못했습니다. 다시 생성해 주세요.'
      result.ideas = []
      result.source = 'rule'
      result.verified = 0
    }
  }
}

export async function classifyRelations(
  theme: string,
  center: StandardMeta,
  candidates: StandardMeta[],
  artifactContext?: string,
  options?: { force?: boolean; gradeGroup?: string },
): Promise<RelationResult[]> {
  const cache = loadCache()
  const results: RelationResult[] = []
  const toClassify: StandardMeta[] = []

  // 캐시 확인 (force=true 면 전부 재호출)
  for (const cand of candidates) {
    const key = cacheKey(theme, center, cand, options?.gradeGroup, artifactContext)
    if (!options?.force && cache[key]) {
      const relationType = normalizeGraphRelationType(cache[key].relationType) ?? DEFAULT_GRAPH_RELATION_TYPE
      const fallback = ruleBasedRelation(center, cand)
      results.push({
        ...cache[key],
        relationType,
        explanation: cache[key].explanation?.trim() || buildFallbackExplanation(center, cand, relationType) || fallback.explanation,
        teachingNote: cache[key].teachingNote ?? buildFallbackTeachingNote(center, cand, relationType),
      })
    } else {
      toClassify.push(cand)
    }
  }

  if (toClassify.length === 0) return results

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    for (const cand of toClassify) results.push(ruleBasedRelation(center, cand))
    return results
  }

  const client = new Anthropic({ apiKey, timeout: 40_000, maxRetries: 0 })
  const startedAt = performance.now()

  // [1] 관계 유형·강도 판정은 Jev. LLM 이 관계까지 정하면 후보마다 유형이 흔들리고 코드가 지어낸 근거가 섞였다.
  //     Jev 미설정·실패면 예전처럼 LLM 이 관계도 정한다(폴백).
  const judgement: RelationJudgement | null = jevJudgeEnabled()
    ? await judgeRelations(theme, center, toClassify, artifactContext)
    : null
  const judged = (cand: StandardMeta) => judgement?.byCandidateId[cand.id]

  const candidatesList = toClassify
    .map(
      (c, i) => `[후보 ${i + 1}] ${c.code} (${c.subjectName})
- 핵심아이디어: ${c.coreIdea || '없음'}
- 성취기준: ${c.text}
- 개념: ${c.keywords.slice(0, 5).join(', ')}
- 기능: ${c.functions.slice(0, 4).join(', ')}
- 가치·태도: ${c.values.slice(0, 3).join(', ')}${judged(c) ? `
- ★ 확정된 관계 유형: ${judged(c)!.relationType} (강도 ${judged(c)!.strength.toFixed(2)}) — 바꾸지 말 것` : ''}`
    )
    .join('\n\n')

  const judgedNote = judgement
    ? `
## 확정 사실 (교육과정 판정기 결과 — 이 범위 밖으로 나가지 마시오)
각 후보의 관계 유형과 강도는 이미 판정되어 위 목록에 ★로 표시되어 있습니다. 당신은 유형을 고르지 않습니다.
확정된 유형에 맞게 explanation·ideas·teachingNote 만 작성하고, JSON 의 relationType·score 에는 확정값을 그대로 적으십시오.
중심·후보 성취기준 문장에 없는 다른 성취기준의 내용을 끌어오지 마십시오.
`
    : ''

  const prompt = `당신은 초등 교육과정 융합 수업 설계 전문가입니다.
목적은 선택한 성취기준을 실제 초등 학생이 수행할 수 있는 수업으로 연결하는 것입니다. 학년 수준과 현재 주제의 적합성을 최우선으로 하고, 구체적인 자료·학생 행동·교사 도움을 제시하십시오.
${lessonAudiencePrompt(options?.gradeGroup, [center, ...toClassify])}

## 수업 주제
${theme || '(주제 미지정 — 두 성취기준의 교차점을 직접 포착하라)'}
${artifactContext ? `\n## 수업 설계 맥락\n${artifactContext}\n` : ''}

## 중심 성취기준
${center.code} (${center.subjectName})
- 핵심아이디어: ${center.coreIdea || '없음'}
- 성취기준: ${center.text}
- 개념: ${center.keywords.slice(0, 5).join(', ')}
- 기능: ${center.functions.slice(0, 4).join(', ')}
- 가치·태도: ${center.values.slice(0, 3).join(', ')}

## 연결 후보 성취기준
${candidatesList}
${judgedNote}
## 출력 스펙
각 후보마다 다음 JSON 필드를 생성하라.

### explanation (1문장, 관계 근거)
두 성취기준의 **실제 문장에서 구절을 각각 인용**하여 왜 이 관계 유형인지 한 문장으로. 교과명만 반복하는 추상적 설명 금지.

### ideas (배열, 2~3개의 수업 아이디어)
각 아이디어는 교사가 제공할 자료와 학생이 할 일을 쉽게 그릴 수 있는 짧은 문장으로. 주제와 성취기준에 맞는 일상 사례를 쓰고 어려운 활동으로 차별화하지 마십시오.

### teachingNote (수업 제안: 2~3문장)
교사가 준비할 학년 수준의 자료 → 학생이 할 짧은 활동 2~3단계 → 산출물과 간단한 확인 방법을 적습니다. 읽기·쓰기 지원이 필요하면 교사 질문이나 문장 틀을 포함하십시오.
교과별 역할은 성취기준의 실제 행동에 근거합니다. 활동 형태나 산출물의 다양성보다 학년 수준·주제·성취기준의 연결을 우선합니다.

## 관계 유형 (필수 선택)
의미연결 / 도구-활용 / 현상-가치 / 내용-표현 / 문제-해결 / 탐구-실천 / 개념-적용 / 원인-결과

## 출력 형식 (JSON만, 주석·설명 금지)
{
  "relations": [
    {
      "index": 1,
      "relationType": "관계유형",
      "score": 0.78,
      "explanation": "두 성취기준의 실문을 인용하며 관계 유형 근거를 한 문장으로.",
      "ideas": ["아이디어1 (보편형, 15~40자)", "아이디어2 (창의형)", "아이디어3 (선택)"],
      "teachingNote": "차시·역할·산출물·평가가 드러나는 2~3문장 수업 구조."
    }
  ]
}`

  try {
    const msg = await client.messages.create({
      model: resolveClaudeModel('relation'),
      // 후보 8개 × (근거+아이디어 3개+수업 제안) 이 2500 토큰에서 잘려 JSON 파싱이 깨지던 문제 → 4000.
      max_tokens: 4000,
      temperature: 0.5,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in Claude response')

    const parsed = JSON.parse(jsonMatch[0]) as {
      relations: Array<{
        index: number
        relationType: RelationType
        score: number
        explanation: string
        ideas?: string[]
        teachingNote?: string
      }>
    }

    const handled = new Set<string>()
    for (const rel of parsed.relations) {
      const cand = toClassify[rel.index - 1]
      if (!cand) continue
      handled.add(cand.id)
      // 판정값이 있으면 LLM 이 JSON 에 뭐라고 적었든 Jev 의 유형·강도를 쓴다.
      const verdict = judged(cand)
      const relationType = normalizeGraphRelationType(verdict?.relationType ?? rel.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE
      const fallback = ruleBasedRelation(center, cand)
      const cleanedIdeas = Array.isArray(rel.ideas)
        ? rel.ideas.map(s => String(s).trim()).filter(Boolean).slice(0, 3)
        : undefined

      const result: RelationResult = {
        sourceId: center.id,
        targetId: cand.id,
        relationType,
        score: verdict ? verdict.strength : Math.min(1, Math.max(0, rel.score)),
        explanation: rel.explanation?.trim() || buildFallbackExplanation(center, cand, relationType) || fallback.explanation,
        ideas: cleanedIdeas && cleanedIdeas.length > 0 ? cleanedIdeas : undefined,
        teachingNote: rel.teachingNote?.trim() || buildFallbackTeachingNote(center, cand, relationType),
        source: 'claude',
        ...(verdict ? { judge: 'jev' as const } : {}),
      }
      results.push(result)
    }

    await verifyAndRewrite({ client, theme, center, toClassify, results, artifactContext, gradeGroup: options?.gradeGroup, startedAt })
    for (const result of results.filter(r => r.source === 'claude')) {
      const candidate = toClassify.find(c => c.id === result.targetId)
      if (candidate) cache[cacheKey(theme, center, candidate, options?.gradeGroup, artifactContext)] = result
    }

    // Claude가 인덱스를 빠뜨린 후보는 룰 폴백을 돌려주되, 다음 호출에서 재시도되도록 캐시에 남기지 않는다.
    for (const cand of toClassify) {
      if (handled.has(cand.id)) continue
      results.push(ruleWithJudgement(center, cand, judged(cand)))
    }
  } catch (err) {
    console.error('[ontologyRelation] Claude 오류, 규칙 기반 폴백:', err)
    // 전역 실패는 캐시하지 않음 — 이후 호출에서 Claude 재시도 기회를 열어둔다.
    for (const cand of toClassify) {
      results.push(ruleWithJudgement(center, cand, judged(cand)))
    }
  }

  saveCache(cache)
  return results
}

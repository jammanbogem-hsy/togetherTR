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
import fs from 'fs'
import path from 'path'
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

function cacheKey(theme: string, a: string, b: string): string {
  const themeKey = theme.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 120)
  return `${themeKey}::${[a, b].sort().join('||')}`
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

const REWRITE_DEADLINE_MS = 35_000
const VERIFY_THRESHOLD = 0.5

async function verifyAndRewrite(params: {
  client: Anthropic
  theme: string
  center: StandardMeta
  toClassify: StandardMeta[]
  results: RelationResult[]
  cache: Record<string, RelationResult>
  artifactContext?: string
  startedAt: number
}): Promise<void> {
  const { client, theme, center, toClassify, results, cache, artifactContext, startedAt } = params
  const byTarget = new Map(results.filter(r => r.source === 'claude').map(r => [r.targetId, r]))
  const candById = new Map(toClassify.map(c => [c.id, c]))
  const items = [...byTarget.values()].map(r => ({
    candidate: candById.get(r.targetId)!,
    relationType: r.relationType,
    teachingNote: r.teachingNote ?? '',
    ideas: r.ideas,
  })).filter(item => item.candidate)
  const verdict = await verifyTeachingNotes(theme, center, items)
  if (!verdict) return
  for (const [id, noul] of Object.entries(verdict.byCandidateId)) {
    const result = byTarget.get(id)
    if (result) result.verified = noul
  }

  const failing = items.filter(item => (verdict.byCandidateId[item.candidate.id] ?? 1) < VERIFY_THRESHOLD)
  if (failing.length === 0 || performance.now() - startedAt > REWRITE_DEADLINE_MS) return

  const rewritePrompt = `당신은 초등 교육과정 융합 수업 설계 전문가입니다.
아래 후보들의 직전 수업 제안이 "두 성취기준을 실제로 다루지 않는다"고 판정되었습니다.
중심 성취기준과 후보 성취기준 **둘 다의 문장에 있는 활동**이 수업 시퀀스 안에 드러나도록 다시 쓰십시오.
다른 성취기준의 내용을 끌어오지 말고, 확정된 관계 유형을 바꾸지 마십시오.

## 수업 주제
${theme || '(주제 미지정)'}
${artifactContext ? `\n## 수업 설계 맥락\n${artifactContext}\n` : ''}
## 중심 성취기준
${center.code} (${center.subjectName}) ${center.text}

## 다시 쓸 후보
${failing.map((item, i) => `[후보 ${i + 1}] ${item.candidate.code} (${item.candidate.subjectName}) ${item.candidate.text}
- 확정된 관계 유형: ${item.relationType}
- 직전 수업 제안(부적합): ${item.teachingNote}`).join('\n\n')}

## 출력 형식 (JSON만)
{ "relations": [ { "index": 1, "explanation": "두 성취기준 실문을 인용한 관계 근거 1문장", "ideas": ["아이디어1", "아이디어2"], "teachingNote": "차시·역할·산출물·평가가 드러나는 2~3문장" } ] }`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      temperature: 0.6,
      messages: [{ role: 'user', content: rewritePrompt }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return
    const parsed = JSON.parse(jsonMatch[0]) as { relations: Array<{ index: number; explanation?: string; ideas?: string[]; teachingNote?: string }> }
    const rewritten: typeof items = []
    for (const rel of parsed.relations ?? []) {
      const item = failing[rel.index - 1]
      const result = item && byTarget.get(item.candidate.id)
      if (!item || !result) continue
      if (rel.teachingNote?.trim()) result.teachingNote = rel.teachingNote.trim()
      if (rel.explanation?.trim()) result.explanation = rel.explanation.trim()
      const ideas = Array.isArray(rel.ideas) ? rel.ideas.map(s => String(s).trim()).filter(Boolean).slice(0, 3) : []
      if (ideas.length > 0) result.ideas = ideas
      rewritten.push({ candidate: item.candidate, relationType: result.relationType, teachingNote: result.teachingNote ?? '', ideas: result.ideas })
      cache[cacheKey(theme, center.id, item.candidate.id)] = result
    }
    const recheck = rewritten.length > 0 ? await verifyTeachingNotes(theme, center, rewritten) : null
    if (recheck) {
      for (const [id, noul] of Object.entries(recheck.byCandidateId)) {
        const result = byTarget.get(id)
        if (result) result.verified = noul
      }
    }
  } catch (err) {
    console.error('[ontologyRelation] 재작성 실패 — 직전 제안 유지:', err)
  }
}

export async function classifyRelations(
  theme: string,
  center: StandardMeta,
  candidates: StandardMeta[],
  artifactContext?: string,
  options?: { force?: boolean },
): Promise<RelationResult[]> {
  const cache = loadCache()
  const results: RelationResult[] = []
  const toClassify: StandardMeta[] = []

  // 캐시 확인 (force=true 면 전부 재호출)
  for (const cand of candidates) {
    const key = cacheKey(theme, center.id, cand.id)
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

  const client = new Anthropic({ apiKey })
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
이 요청의 목적은 두 성취기준을 묶었을 때 **교사에게 인사이트를 주는 구체적인 수업 설계**를 제시하는 것입니다. 상식적이고 보편적인 문장(예: "~탐구 후 ~로 표현한다")만 내놓으면 실패입니다.

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
각 아이디어는 **구체적 콘텐츠**(무엇을 다룰지 — 사례, 소재, 질문, 데이터)를 15~40자로. "보편형 1개 + 창의형 1~2개" 혼합 필수. 교사가 "오 이건 생각 못 했는데" 할 만한 앵글을 적어도 하나 포함.
- 예 좋은 형태: "TV 시청률 Top10을 원그래프로 그리고 상위 3개 프로그램의 광고 노출 빈도 비교"
- 예 나쁜 형태: "미디어 자료를 조사해 그래프로 나타낸다" (너무 보편, 인사이트 없음)

### teachingNote (수업 제안: 2~3문장, 융합 구조)
두 성취기준을 **한 수업 시퀀스로 엮는 구조**를 설계. 반드시 포함:
(1) 차시 수 또는 단계 (예: "3차시 프로젝트")
(2) 각 차시/단계의 역할 (중심 교과 ↔ 후보 교과)
(3) 최종 산출물과 공유 방식
같은 세트 안에서 **후보마다 다른 수업 형태**를 쓸 것: 프로젝트·토론·현장조사·제작전시·시뮬레이션·데이터시각화·캠페인·역할극 중 선택.
- 예 좋은 형태: "3차시 구성. 1차시 사회에서 가짜뉴스 사례 3건을 비판적으로 분석해 '의심 지점' 목록 작성 → 2차시 수학에서 반 친구들의 SNS 정보 신뢰 설문을 띠그래프로 시각화 → 3차시 두 결과를 결합한 '우리 반 미디어 리터러시 지도'를 공동 전시, 루브릭으로 상호평가."
- 예 나쁜 형태: "사회에서 탐구한 후 수학으로 표현한다" (구조 없음, 평가 없음)

## 천편일률 금지 (강한 제약)
- 같은 동사구("탐구한다", "발표한다", "조사한다")를 세트 전체에서 2회 이상 쓰지 말 것
- 산출물을 후보별로 다르게 선택: 포스터·영상·그래프·모형·공연·전시·정책제안서·인포그래픽·지도·데이터대시보드 등
- 평가 방식도 달리 언급: 루브릭·자기평가·동료평가·체크리스트·포트폴리오·관찰기록 등

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
      model: 'claude-haiku-4-5-20251001',
      // 후보 8개 × (근거+아이디어 3개+수업 제안) 이 2500 토큰에서 잘려 JSON 파싱이 깨지던 문제 → 4000.
      max_tokens: 4000,
      temperature: 0.8,
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
      cache[cacheKey(theme, center.id, cand.id)] = result
    }

    // [4] Jev 로 수업 제안 검증 → 두 성취기준을 실제로 안 다루는 후보만 1회 재작성.
    //     60초 제한 안에 끝나도록 35초를 넘겼으면 재작성은 건너뛰고 검증값만 남긴다.
    if (judgement) {
      await verifyAndRewrite({ client, theme, center, toClassify, results, cache, artifactContext, startedAt })
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

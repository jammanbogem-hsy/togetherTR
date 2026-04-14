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
  explanation: string    // 교육적 연결 이유 (1~2문장)
  teachingNote?: string  // 수업 설계 제안 (1문장)
  source: 'claude' | 'rule'
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

// ─── Claude 분류 ──────────────────────────────────────────────────────────────

export async function classifyRelations(
  theme: string,
  center: StandardMeta,
  candidates: StandardMeta[],
  artifactContext?: string,
): Promise<RelationResult[]> {
  const cache = loadCache()
  const results: RelationResult[] = []
  const toClassify: StandardMeta[] = []

  // 캐시 확인
  for (const cand of candidates) {
    const key = cacheKey(theme, center.id, cand.id)
    if (cache[key]) {
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

  const candidatesList = toClassify
    .map(
      (c, i) => `[후보 ${i + 1}] ${c.code} (${c.subjectName})
- 핵심아이디어: ${c.coreIdea || '없음'}
- 성취기준: ${c.text}
- 개념: ${c.keywords.slice(0, 5).join(', ')}
- 기능: ${c.functions.slice(0, 4).join(', ')}
- 가치·태도: ${c.values.slice(0, 3).join(', ')}`
    )
    .join('\n\n')

  const prompt = `당신은 초등 교육과정 융합 수업 설계 전문가입니다.

## 수업 주제
${theme}
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

## 과제
각 후보와 중심 성취기준의 교육적 관계를 판별하고, 이 수업 주제에 맞는 **구체적인 수업 시나리오**를 제안하십시오.

⚠️ 중요 규칙:
- 성취기준의 실제 내용(시대, 주제, 개념)을 정확히 확인하고 수업 주제와의 연결이 자연스러운지 판단하라
- 수업 주제와 시대·맥락이 맞지 않는 성취기준은 score를 낮게 부여하라 (예: "세종대왕" 주제에 "조선 후기" 성취기준은 부적합)
- teachingNote에 반드시 학생이 수행할 **구체적인 활동 시나리오**를 포함하라 (예: "모둠별로 ~를 조사한 뒤 ~를 만들어 발표한다")

관계 유형 (반드시 아래 중 하나 선택):
- 의미연결: 개념이나 주제가 본질적으로 가까운 관계
- 도구-활용: 한 교과의 기능이 다른 교과의 수행 도구가 되는 관계
- 현상-가치: 현상 분석이 가치 판단과 연결되는 관계
- 내용-표현: 한 교과의 탐구 내용을 다른 교과가 표현하는 관계
- 문제-해결: 여러 교과가 동일 문제를 함께 해결하는 관계
- 탐구-실천: 탐구가 실천 활동으로 이어지는 관계
- 개념-적용: 한쪽 개념 이해 ↔ 다른 쪽 적용·실천
- 원인-결과: 인과 구조로 이어지는 관계

다음 JSON만 출력하십시오 (설명 없이):
{
  "relations": [
    {
      "index": 1,
      "relationType": "관계유형",
      "score": 0.75,
      "explanation": "이 두 성취기준이 수업 주제 안에서 어떻게 연결되는지 구체적으로 서술 (2~3문장, 실제 성취기준 내용과 수업 주제 맥락 언급)",
      "teachingNote": "학생들이 수행할 구체적인 수업 활동 시나리오 (2~3문장, 예: '모둠별로 ~를 조사한 뒤 ~그래프를 그리고, 분석 결과를 바탕으로 ~를 발표한다')"
    }
  ]
}`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
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
        teachingNote?: string
      }>
    }

    const handled = new Set<string>()
    for (const rel of parsed.relations) {
      const cand = toClassify[rel.index - 1]
      if (!cand) continue
      handled.add(cand.id)
      const relationType = normalizeGraphRelationType(rel.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE
      const fallback = ruleBasedRelation(center, cand)

      const result: RelationResult = {
        sourceId: center.id,
        targetId: cand.id,
        relationType,
        score: Math.min(1, Math.max(0, rel.score)),
        explanation: rel.explanation?.trim() || buildFallbackExplanation(center, cand, relationType) || fallback.explanation,
        teachingNote: rel.teachingNote?.trim() || buildFallbackTeachingNote(center, cand, relationType),
        source: 'claude',
      }
      results.push(result)
      cache[cacheKey(theme, center.id, cand.id)] = result
    }

    for (const cand of toClassify) {
      if (handled.has(cand.id)) continue
      const fallback = ruleBasedRelation(center, cand)
      results.push(fallback)
      cache[cacheKey(theme, center.id, cand.id)] = fallback
    }
  } catch (err) {
    console.error('[ontologyRelation] Claude 오류, 규칙 기반 폴백:', err)
    for (const cand of toClassify) {
      const fallback = ruleBasedRelation(center, cand)
      results.push(fallback)
      cache[cacheKey(theme, center.id, cand.id)] = fallback
    }
  }

  saveCache(cache)
  return results
}

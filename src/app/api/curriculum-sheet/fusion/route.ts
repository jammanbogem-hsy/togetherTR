/**
 * /api/curriculum-sheet/fusion
 *
 * 교육과정 분석 시트의 교과 간 융합 분석 API
 * ──────────────────────────────────────────
 * 1. 각 행의 핵심아이디어/지식이해/과정기능 텍스트를 OpenAI 임베딩으로 벡터화
 * 2. 교과 간 코사인 유사도 매트릭스 생성
 * 3. 고유사도 쌍을 기반으로 Claude가 융합 수업 아이디어 생성
 */

import { NextRequest, NextResponse } from 'next/server'
import { generationParams, logLlmUsage, resolveOpenAIModel } from '@/lib/llm/openai'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface SheetRow {
  subject: string
  coreIdea: string
  standard: string
  knowledge: string
  processFunction: string
  agentLessonExample?: string
  description: string
}

interface SimilarityPair {
  subjectA: string
  subjectB: string
  similarity: number
  sharedConcepts: string[]
  elementA: string
  elementB: string
}

interface FusionIdea {
  title: string
  concept: string
  subjects: string[]
  activities: string[]
  assessment: string
  connectionPoints: string[]
}

// ─── 유틸 ─────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const batchSize = 20
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const resp = await client.embeddings.create({
      input: batch,
      model: 'text-embedding-3-small',
    })
    results.push(...resp.data.map(d => d.embedding))
  }
  return results
}

// ─── 메인 핸들러 ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { rows } = await request.json() as { rows: SheetRow[] }

    // 유효한 행만 필터 (과목 + 최소 1개 내용)
    const validRows = rows.filter(r => r.subject && (r.coreIdea || r.standard || r.knowledge || r.processFunction))
    if (validRows.length < 2) {
      return NextResponse.json({ error: '융합 분석을 위해 최소 2개 교과의 데이터가 필요합니다.' }, { status: 400 })
    }

    // ─── Step 1: 텍스트 결합 + 임베딩 ───
    const combinedTexts = validRows.map(r => {
      const parts = []
      if (r.coreIdea) parts.push(`핵심아이디어: ${r.coreIdea}`)
      if (r.standard) parts.push(`성취기준: ${r.standard}`)
      if (r.knowledge) parts.push(`지식이해: ${r.knowledge}`)
      if (r.processFunction) parts.push(`과정기능: ${r.processFunction}`)
      if (r.agentLessonExample) parts.push(`Agent 추천 수업 예시: ${r.agentLessonExample}`)
      if (r.description) parts.push(`수업내용: ${r.description}`)
      return `[${r.subject}] ${parts.join('. ')}`
    })

    // 세부 요소별 임베딩 (핵심아이디어, 지식이해, 과정기능 각각)
    const elementTexts: { rowIdx: number; type: string; text: string }[] = []
    validRows.forEach((r, i) => {
      if (r.coreIdea) elementTexts.push({ rowIdx: i, type: '핵심아이디어', text: r.coreIdea })
      // 다중 값 분리
      const knowledge = r.knowledge ? r.knowledge.split(' | ') : []
      const functions = r.processFunction ? r.processFunction.split(' | ') : []
      knowledge.forEach(k => elementTexts.push({ rowIdx: i, type: '지식이해', text: k.trim() }))
      functions.forEach(f => elementTexts.push({ rowIdx: i, type: '과정기능', text: f.trim() }))
    })

    // 행 전체 임베딩 + 요소별 임베딩 동시 생성
    const allTexts = [...combinedTexts, ...elementTexts.map(e => e.text)]
    const allEmbeddings = await embedTexts(allTexts)

    const rowEmbeddings = allEmbeddings.slice(0, combinedTexts.length)
    const elementEmbeddings = allEmbeddings.slice(combinedTexts.length)

    // ─── Step 2: 교과 간 유사도 매트릭스 ───
    const similarities: SimilarityPair[] = []

    // 행 간 유사도 (교과가 다른 쌍만)
    for (let i = 0; i < validRows.length; i++) {
      for (let j = i + 1; j < validRows.length; j++) {
        if (validRows[i].subject === validRows[j].subject) continue
        const sim = cosineSim(rowEmbeddings[i], rowEmbeddings[j])
        if (sim > 0.3) {
          similarities.push({
            subjectA: validRows[i].subject,
            subjectB: validRows[j].subject,
            similarity: Math.round(sim * 100) / 100,
            sharedConcepts: [],
            elementA: combinedTexts[i],
            elementB: combinedTexts[j],
          })
        }
      }
    }

    // 요소 간 교차 유사도 (다른 교과의 요소끼리)
    const crossElementPairs: { a: typeof elementTexts[0]; b: typeof elementTexts[0]; sim: number }[] = []
    for (let i = 0; i < elementTexts.length; i++) {
      for (let j = i + 1; j < elementTexts.length; j++) {
        const a = elementTexts[i], b = elementTexts[j]
        if (validRows[a.rowIdx].subject === validRows[b.rowIdx].subject) continue
        const sim = cosineSim(elementEmbeddings[i], elementEmbeddings[j])
        if (sim > 0.35) {
          crossElementPairs.push({ a, b, sim })
        }
      }
    }

    // 상위 연결점 추출
    crossElementPairs.sort((a, b) => b.sim - a.sim)
    const topConnections = crossElementPairs.slice(0, 15).map(p => ({
      subjectA: validRows[p.a.rowIdx].subject,
      subjectB: validRows[p.b.rowIdx].subject,
      typeA: p.a.type,
      typeB: p.b.type,
      textA: p.a.text,
      textB: p.b.text,
      similarity: Math.round(p.sim * 100) / 100,
    }))

    // ─── Step 3: Claude 융합 아이디어 생성 ───
    const subjectList = [...new Set(validRows.map(r => r.subject))].join(', ')

    const prompt = `당신은 초등학교 교사를 위한 교과 융합 수업 설계 전문가입니다.

## 교과 분석 시트 데이터
${validRows.map(r => `### ${r.subject}
- 핵심아이디어: ${r.coreIdea || '(미입력)'}
- 성취기준: ${r.standard || '(미입력)'}
- 지식·이해: ${r.knowledge || '(미입력)'}
- 과정·기능: ${r.processFunction || '(미입력)'}
- Agent 추천 수업 예시: ${r.agentLessonExample || '(미입력)'}
- 수업내용: ${r.description || '(미입력)'}`).join('\n\n')}

## AI 임베딩 분석 결과 — 교과 간 의미적 연결점 (유사도 높은 순)
${topConnections.map((c, i) => `${i + 1}. [${c.subjectA}] ${c.typeA} "${c.textA}" ↔ [${c.subjectB}] ${c.typeB} "${c.textB}" (유사도 ${(c.similarity * 100).toFixed(0)}%)`).join('\n')}

## 요청
위 교과(${subjectList})의 내용을 융합한 수업 아이디어 3개를 아래 JSON 형식으로 생성하세요.

각 아이디어는:
- 실제 초등학교 교실에서 실행 가능한 구체적 활동
- 위 임베딩 분석에서 발견된 교과 간 연결점을 활용
- 학생 참여형 (PBL, 체인지메이커, 탐구학습 등)
- 2~3차시 분량

JSON:
{
  "fusionIdeas": [
    {
      "title": "융합 수업 제목 (한 줄)",
      "concept": "핵심 융합 컨셉 설명 (2~3문장)",
      "subjects": ["참여 교과1", "참여 교과2"],
      "activities": ["1차시: 구체적 활동", "2차시: 구체적 활동", "3차시: 구체적 활동"],
      "assessment": "평가 방법 (1~2문장)",
      "connectionPoints": ["교과A의 X와 교과B의 Y가 연결되는 지점 설명"]
    }
  ]
}`

    const model = resolveOpenAIModel('utility')
    const startedAt = performance.now()
    const completion = await client.chat.completions.create({
      ...generationParams(model, { maxTokens: 2500, temperature: 0.7, effort: 'light', json: true }),
      messages: [{ role: 'user', content: prompt }],
    } as never)
    logLlmUsage('curriculum-sheet/fusion', model, completion.usage, performance.now() - startedAt)

    const result = JSON.parse(completion.choices[0]?.message?.content ?? '{}') as { fusionIdeas?: FusionIdea[] }

    return NextResponse.json({
      similarities: similarities.sort((a, b) => b.similarity - a.similarity).slice(0, 10),
      crossConnections: topConnections,
      fusionIdeas: result.fusionIdeas ?? [],
      subjectCount: new Set(validRows.map(r => r.subject)).size,
    })
  } catch (err) {
    console.error('[fusion analysis]', err)
    return NextResponse.json({ error: 'fusion analysis failed' }, { status: 500 })
  }
}

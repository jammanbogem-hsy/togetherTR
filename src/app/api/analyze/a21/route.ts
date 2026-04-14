/**
 * A-2-1 핵심아이디어 선정 API
 * ─────────────────────────────
 * 중심 성취기준의 핵심아이디어 목록과 연관 성취기준들을 받아,
 * Claude API를 통해 가장 밀접한 핵심아이디어를 선정하고
 * 지식·이해 / 과정·기능 / 가치·태도 분석 초안을 반환합니다.
 */

import OpenAI from 'openai'
import { loadGraph } from '@/lib/curriculum/graphReader'
import type { GraphCenterNode, GraphRelationType, GraphSelectedStandard } from '@/lib/knowledge-graph/domain'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface CoreIdeaResult {
  subjectId: string
  subjectName: string
  selectedIdea: string
  allIdeas: string[]
  justification: string
}

interface StandardAnalysis {
  standardId: string
  standardLabel: string
  subjectName: string
  coreIdea: string                   // 이 성취기준에 해당하는 핵심아이디어
  knowledgeUnderstanding: string[]   // 지식·이해
  processFunction: string[]          // 과정·기능
  valueAttitude: string[]            // 가치·태도
  relationType?: GraphRelationType
  isCenterStandard: boolean
}

export async function POST(request: Request) {
  try {
    const { centerNode, selectedStandards }: {
      centerNode: GraphCenterNode | null
      selectedStandards: GraphSelectedStandard[]
    } = await request.json()

    if (!centerNode && selectedStandards.length === 0) {
      return Response.json({ error: 'No standards provided' }, { status: 400 })
    }

    const graph = loadGraph()
    if (!graph) {
      return Response.json({ error: 'Graph not loaded' }, { status: 500 })
    }

    // 교과 이름 맵
    const subjectNameMap = new Map(graph.subjects.map(s => [s.id, s.name_ko]))

    // 모든 성취기준 (중심 + 연관)
    const allStandards: GraphSelectedStandard[] = [
      ...(centerNode ? [{ ...centerNode }] : []),
      ...selectedStandards.filter(s => s.id !== centerNode?.id),
    ]

    // 성취기준 ID → core_idea_id 맵
    const stdCoreIdeaMap = new Map(
      graph.achievementStandards
        .filter(s => s.core_idea_id)
        .map(s => [s.id, s.core_idea_id!])
    )

    // 교과별로 핵심아이디어 수집 (해당 표준과 연결된 영역 우선)
    function getCoreIdeasForSubject(subjectId: string, standardId?: string): { areaId: string; ideas: string[] }[] {
      // 해당 표준의 core_idea_id가 있으면 그 영역 우선
      const coreIdeaId = standardId ? stdCoreIdeaMap.get(standardId) : undefined
      const subjectIdeas = graph!.coreIdeas.filter(ci => ci.subject_id === subjectId)
      if (coreIdeaId) {
        const matched = subjectIdeas.filter(ci => ci.id === coreIdeaId)
        if (matched.length > 0) return matched.map(ci => ({ areaId: ci.id, ideas: ci.ideas }))
      }
      return subjectIdeas.map(ci => ({ areaId: ci.id, ideas: ci.ideas }))
    }

    // 교과별 핵심아이디어 수집
    const subjectIdSet = new Set(allStandards.map(s => s.subjectId))
    const subjectCoreIdeasMap = new Map<string, string[]>()
    for (const subjectId of subjectIdSet) {
      const stdForSubject = allStandards.find(s => s.subjectId === subjectId)
      const areaIdeas = getCoreIdeasForSubject(subjectId, stdForSubject?.id)
      const flatIdeas = areaIdeas.flatMap(ai => ai.ideas)
      if (flatIdeas.length > 0) subjectCoreIdeasMap.set(subjectId, flatIdeas)
    }

    // Claude 프롬프트 구성
    const centerText = centerNode
      ? `[중심 성취기준] ${centerNode.label}: "${centerNode.text}"`
      : ''
    const connectedText = selectedStandards
      .filter(s => s.id !== centerNode?.id)
      .map(s => `• ${s.label} (${subjectNameMap.get(s.subjectId) ?? s.subjectId}${s.relationType ? `, ${s.relationType}` : ''}): "${s.text}"`)
      .join('\n')

    const coreIdeasSection = [...subjectCoreIdeasMap.entries()]
      .map(([subjId, ideas]) => {
        const name = subjectNameMap.get(subjId) ?? subjId
        return `[${name} 핵심아이디어 후보]\n${ideas.map((idea, i) => `  ${i + 1}. ${idea}`).join('\n')}`
      })
      .join('\n\n')

    const prompt = `당신은 교육과정 전문가입니다. 아래 정보를 바탕으로 JSON을 정확히 반환하세요.

## 분석 대상

${centerText}

연관 성취기준:
${connectedText || '(없음)'}

## 교과별 핵심아이디어 후보

${coreIdeasSection}

## 요청 사항

1. **핵심아이디어 선정**: 각 교과별로 후보 핵심아이디어 중 중심 성취기준 + 연관 성취기준들과 가장 밀접하게 부합하는 핵심아이디어 1개를 선정하세요. 특히 중심 성취기준 교과의 핵심아이디어는 이 통합 수업 전체를 관통하는 개념을 담아야 합니다.

2. **성취기준별 분석**: 각 성취기준(중심 + 연관)에 대해 아래 3요소를 **루브릭 기준으로 활용 가능한 수준**으로 서술하세요:
   - 지식·이해: 학생이 알아야 할 핵심 개념·원리 (명사구, 지필 평가 기준 수준, 2-3항목)
   - 과정·기능: "~하기" 형식의 수행 동사 (수행평가 행동 지표 수준, 2-3개)
   - 가치·태도: 이 학습을 통해 기대되는 정의적 요소 (루브릭 태도 영역 기준 수준, 1-2항목)

반드시 아래 JSON 형식으로만 응답하세요:

{
  "coreIdeas": [
    {
      "subjectId": "교과 ID",
      "subjectName": "교과명",
      "selectedIdea": "선정된 핵심아이디어 원문",
      "allIdeas": ["후보1", "후보2"],
      "justification": "선정 이유 1-2문장"
    }
  ],
  "standardAnalyses": [
    {
      "standardId": "성취기준 ID",
      "standardLabel": "성취기준 코드",
      "subjectName": "교과명",
      "isCenterStandard": true,
      "coreIdea": "이 성취기준에 해당하는 선정된 핵심아이디어 원문 (위 coreIdeas 중 같은 교과의 selectedIdea와 동일해야 함)",
      "knowledgeUnderstanding": ["개념1", "개념2"],
      "processFunction": ["~하기1", "~하기2"],
      "valueAttitude": ["태도1"],
      "relationType": null
    }
  ]
}`

    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw) as {
      coreIdeas: CoreIdeaResult[]
      standardAnalyses: StandardAnalysis[]
    }

    return Response.json(parsed)
  } catch (err) {
    console.error('[analyze/a21]', err)
    return Response.json({ error: 'analysis failed' }, { status: 500 })
  }
}

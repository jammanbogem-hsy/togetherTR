import Anthropic from '@anthropic-ai/sdk'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'

export const runtime = 'nodejs'
export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildNodeContext(
  centerNode: GraphSavedData['centerNode'],
  selectedStandards: GraphSavedData['selectedStandards'],
  agentNotes: GraphSavedData['agentNotes'],
): string {
  if (!centerNode && selectedStandards.length === 0) return '(성취기준 데이터 없음)'
  const noteMap = Object.fromEntries(agentNotes.map(n => [n.standardId, n]))
  const lines: string[] = []
  if (centerNode) {
    lines.push(`중심 성취기준: [${centerNode.id}] ${centerNode.label} (${centerNode.subjectId})`)
    lines.push(`  내용: ${centerNode.text}`)
    lines.push('')
    lines.push('연결된 성취기준:')
  }
  for (const s of selectedStandards) {
    if (centerNode && s.id === centerNode.id) continue
    const note = noteMap[s.id]
    lines.push(`  - [${s.id}] ${s.label} (${s.subjectId})`)
    if (note?.explanation) lines.push(`    교육적 연결: ${note.explanation}`)
    if (note?.teachingNote) lines.push(`    수업 팁: ${note.teachingNote}`)
  }
  return lines.join('\n')
}

export interface ProblemSituationResult {
  candidates: Array<{
    title: string
    scenario: string      // 2-3문장 요약
    dataSources: string   // 활용 데이터/자료
  }>
  recommended: {
    index: number         // candidates 인덱스 (0-2)
    title: string
    fullScenario: string  // 완전한 문제 상황 서술
    standardsAlignment: Array<{  // 성취기준 연결
      standardId: string   // 성취기준 코드
      subject: string      // 교과명
      isCenter: boolean    // 중심 성취기준 여부
      connection: string   // 문제상황 내 구체적 연결 설명
    }>
    realData: Array<{    // 실제 데이터 출처 (링크 포함)
      label: string        // 출처명 및 설명
      url?: string         // 공개 URL (있는 경우)
    }>
    learningContent: string  // 교과별 학습 내용
    artifacts: string        // 산출물 목록
    alignmentCheck: string   // AI 점검: 성취기준·평가 정합성
  }
  drivingQuestion: string
  essentialQuestions: string[]
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      graphSavedData,
      achievementStandardsAnalysis,
      evaluationPlan,
      learningObjective,
      learnerProfile,
      projectTitle,
      targetGradeGroup,
      targetSubjects,
    } = body as {
      graphSavedData?: GraphSavedData | null
      achievementStandardsAnalysis?: string
      evaluationPlan?: string
      learningObjective?: string
      learnerProfile?: string
      projectTitle: string
      targetGradeGroup: string
      targetSubjects: string[]
    }

    const nodeContext = buildNodeContext(
      graphSavedData?.centerNode ?? null,
      graphSavedData?.selectedStandards ?? [],
      graphSavedData?.agentNotes ?? [],
    )

    const systemPrompt = `당신은 초·중등 교과 융합 PBL 수업설계 전문가입니다.
교사팀이 제공한 성취기준, 평가 계획, 학습자 특성을 분석하여 교실 내 협력 학습을 위한 문제상황을 설계합니다.

중요: 이 문제상황은 교실 내 학생들의 협력적 수업 활동을 위한 것입니다. 외부 청중 발표보다 학생들의 탐구 과정과 교과 융합 학습에 초점을 맞추세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "candidates": [
    {
      "title": "제목 (10자 이내 키워드 형식)",
      "scenario": "문제 상황 요약. 학생들이 해결해야 할 실제적 맥락을 2-3문장으로 서술. 반드시 완전한 문장으로 작성.",
      "dataSources": "활용할 실제 데이터·자료 출처 (쉼표로 구분)"
    },
    { ... },
    { ... }
  ],
  "recommended": {
    "index": 0,
    "title": "선정된 제목",
    "fullScenario": "완전한 문제 상황 서술. 학생들이 처한 실제적 맥락에서 출발하여 탐구해야 할 문제를 3-5문장으로 완전하게 서술. 반드시 완전한 문장으로 끝내세요.",
    "standardsAlignment": [
      {
        "standardId": "입력받은 성취기준 코드 그대로 (예: 6사03-01)",
        "subject": "교과명 (예: 사회)",
        "isCenter": true,
        "connection": "이 성취기준이 문제상황 어디에서 어떻게 구현되는지 1-2문장으로 구체적 설명"
      },
      {
        "standardId": "연계 성취기준 코드",
        "subject": "교과명",
        "isCenter": false,
        "connection": "연계 방식 설명"
      }
    ],
    "realData": [
      {
        "label": "출처명: 활용 방법 설명",
        "url": "https://실제공개URL (없으면 null)"
      }
    ],
    "learningContent": "각 교과에서 배울 핵심 개념·기능을 교과별로 구분하여 서술",
    "artifacts": "학생들이 제작할 산출물 목록 (단계별로 구분)",
    "alignmentCheck": "선정된 문제 상황이 성취기준·평가 계획과 어떻게 연결되는지, 교과 융합의 자연스러움, 학습자 특성 적합성을 분석한 AI 점검 내용"
  },
  "drivingQuestion": "단원 전체를 관통하는 핵심 질문 1문장 (완전한 문장으로 작성)",
  "essentialQuestions": [
    "탐구 질문 1 (완전한 문장)",
    "탐구 질문 2 (완전한 문장)",
    "탐구 질문 3 (완전한 문장)"
  ]
}

standardsAlignment 작성 규칙:
- 입력된 모든 성취기준에 대해 항목을 생성할 것 (누락 금지)
- standardId는 입력된 코드에서 숫자+영문 부분만 추출 (예: sub_soc_6A03-01 → 6사03-01 형태로 교과 약어 포함)
- isCenter: true인 항목을 반드시 첫 번째에 배치
- connection은 "학생들이 ~함으로써 ~를 달성한다" 형태로 구체적으로 작성

realData 작성 규칙:
- 실제로 존재하는 공개 데이터·자료만 포함 (가상의 URL 금지)
- 국가기관(교육부, 국가인권위원회 등) 공식 사이트 URL은 정확하게 기재
- URL이 불확실하면 null로 설정 (틀린 URL보다 null이 낫다)`

    const userPrompt = `다음 정보를 바탕으로 교과 융합 PBL 문제상황을 설계해주세요:

프로젝트 제목: ${projectTitle}
학년군: ${targetGradeGroup}
교과: ${targetSubjects.join(', ')}

=== A-2-1 교과 융합 성취기준 분석 (팀이 도출한 분석 결과) ===
${achievementStandardsAnalysis ?? '(없음)'}

=== A-2-1 교과 융합 성취기준 (지식 그래프 노드) ===
${nodeContext}

=== A-2-2 통합 수업목표 ===
${learningObjective ?? '(없음)'}

=== A-2-3 학습자·맥락 프로필 ===
${learnerProfile ?? '(없음)'}

=== Ds-1-1 평가 계획 ===
${evaluationPlan ?? '(아직 수립되지 않음)'}

⚠️ 위 A단계 분석 결과(성취기준 분석, 수업목표, 학습자 프로필)와 평가 계획을 문제상황 설계의 핵심 근거로 삼으세요.
문제상황은 반드시 위 성취기준들이 자연스럽게 융합되고, 수업목표를 달성할 수 있으며, 학습자 특성에 맞아야 합니다.

JSON 형식으로만 응답하세요.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    // JSON 블록 추출 (마크다운 코드 블록 제거)
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText

    const result: ProblemSituationResult = JSON.parse(jsonStr.trim())
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

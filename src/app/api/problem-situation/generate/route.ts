import Anthropic from '@anthropic-ai/sdk'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

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

export interface ProblemStandardAlignment {
  standardId: string   // 성취기준 코드
  subject: string      // 교과명
  isCenter: boolean    // 중심 성취기준 여부
  connection: string   // 문제상황 내 구체적 연결 설명
}
export interface ProblemRealData {
  label: string        // 출처명 및 설명
  url?: string         // 공개 URL (있는 경우)
}

// 각 후보가 모두 완전한 상세를 가진다 (책갈피 전환 시 재생성 없이 즉시 표시).
// 상세 필드는 옛 저장 데이터 호환을 위해 optional — 신규 생성분은 3개 후보 전부 채워진다.
export interface ProblemScenarioCandidate {
  title: string
  scenario: string      // 2-3문장 요약 (탭/테이블 미리보기용)
  dataSources: string   // 활용 데이터/자료
  fullScenario?: string                          // 완전한 문제 상황 서술
  standardsAlignment?: ProblemStandardAlignment[] // 성취기준 연결
  realData?: ProblemRealData[]                    // 실제 데이터 출처
  learningContent?: string                        // 교과별 학습 내용
  artifacts?: string                              // 산출물 목록
  alignmentCheck?: string                         // AI 점검: 성취기준·평가 정합성
}

export interface ProblemSituationResult {
  candidates: ProblemScenarioCandidate[]
  recommended: {
    index: number         // candidates 인덱스 (0-2) — 추천 후보
    title: string
    fullScenario: string
    standardsAlignment: ProblemStandardAlignment[]
    realData: ProblemRealData[]
    learningContent: string
    artifacts: string
    alignmentCheck: string
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

⚠️ 매우 중요 — 작성 순서를 반드시 지키세요: drivingQuestion → essentialQuestions → recommended → candidates 순서로, 탐구 질문과 하위 탐구 질문을 **가장 먼저** 작성하세요. 이 두 필드는 산출물의 핵심이므로 절대 비워두거나 누락하면 안 됩니다.

{
  "drivingQuestion": "단원 전체를 관통하는 탐구 질문 1문장. 학생의 언어로 된 개방형 질문이며 완전한 물음표 문장으로 작성. (절대 비워두지 말 것)",
  "essentialQuestions": [
    "하위 탐구 질문 1 (완전한 물음표 문장)",
    "하위 탐구 질문 2 (완전한 물음표 문장)",
    "하위 탐구 질문 3 (완전한 물음표 문장)"
  ],
  "recommended": { "index": 0 },
  "candidates": [
    {
      "title": "제목 (10자 이내 키워드 형식)",
      "scenario": "문제 상황 요약. 학생들이 해결해야 할 실제적 맥락을 2-3문장으로 서술. 반드시 완전한 문장으로 작성.",
      "dataSources": "활용할 실제 데이터·자료 출처 (쉼표로 구분)",
      "fullScenario": "완전한 문제 상황 서술. 학생들이 처한 실제적 맥락에서 출발하여 탐구해야 할 문제를 3-5문장으로 완전하게 서술. 반드시 완전한 문장으로 끝내세요.",
      "standardsAlignment": [
        {
          "standardId": "입력받은 성취기준 코드 그대로 (예: 6사03-01)",
          "subject": "교과명 (예: 사회)",
          "isCenter": true,
          "connection": "이 성취기준이 이 후보의 문제상황 어디에서 어떻게 구현되는지 1-2문장으로 구체적 설명"
        },
        {
          "standardId": "연계 성취기준 코드",
          "subject": "교과명",
          "isCenter": false,
          "connection": "연계 방식 설명"
        }
      ],
      "realData": [
        { "label": "출처명: 활용 방법 설명", "url": "https://실제공개URL (없으면 null)" }
      ],
      "learningContent": "이 후보에서 각 교과가 배울 핵심 개념·기능을 교과별로 구분하여 서술",
      "artifacts": "이 후보에서 학생들이 제작할 산출물 목록 (단계별로 구분)",
      "alignmentCheck": "이 후보가 성취기준·평가 계획과 어떻게 연결되는지, 교과 융합의 자연스러움, 학습자 특성 적합성을 분석한 AI 점검 내용"
    },
    { "title": "...", "scenario": "...", "dataSources": "...", "fullScenario": "...", "standardsAlignment": [...], "realData": [...], "learningContent": "...", "artifacts": "...", "alignmentCheck": "..." },
    { "title": "...", "scenario": "...", "dataSources": "...", "fullScenario": "...", "standardsAlignment": [...], "realData": [...], "learningContent": "...", "artifacts": "...", "alignmentCheck": "..." }
  ]
}

⚠️ recommended는 추천 후보의 candidates 인덱스(0~2)만 적으세요. 상세 내용은 복제하지 마세요 (시스템이 자동으로 채웁니다).
⚠️ 중요: candidates 배열의 **3개 후보 모두** fullScenario·standardsAlignment·realData·learningContent·artifacts·alignmentCheck를 빠짐없이 완전하게 작성하세요. 교사가 책갈피로 후보를 전환하며 각 후보의 상세를 비교하므로, 추천 후보만 상세하고 나머지가 비면 안 됩니다.

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
      // 후보 3개 모두 완전한 상세를 생성하므로 응답이 매우 길다 — 잘림 방지를 위해 넉넉히 확보.
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    // JSON 블록 추출 (마크다운 코드 블록 제거)
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText

    let result: ProblemSituationResult
    try {
      result = JSON.parse(jsonStr.trim())
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      result = recovered as ProblemSituationResult
    }

    // recommended를 candidates[index] 상세로 자동 확장 (AI는 index만 응답)
    const candidates = Array.isArray(result.candidates) ? result.candidates : []
    const recIdxRaw = (result.recommended && typeof result.recommended.index === 'number') ? result.recommended.index : 0
    const recIdx = Math.min(Math.max(0, recIdxRaw), Math.max(0, candidates.length - 1))
    const recCand = candidates[recIdx]
    if (recCand) {
      result.recommended = {
        index: recIdx,
        title: recCand.title ?? '',
        fullScenario: recCand.fullScenario ?? recCand.scenario ?? '',
        standardsAlignment: recCand.standardsAlignment ?? [],
        realData: recCand.realData ?? [],
        learningContent: recCand.learningContent ?? '',
        artifacts: recCand.artifacts ?? '',
        alignmentCheck: recCand.alignmentCheck ?? '',
      }
    }

    // 탐구 질문(drivingQuestion)·하위 탐구 질문(essentialQuestions) 누락 방어 — 잘림/누락 시 빈 배열로라도 정규화 (renderer 가드 + 사용자 재생성 유도)
    result.drivingQuestion = (typeof result.drivingQuestion === 'string' ? result.drivingQuestion : '').trim()
    result.essentialQuestions = Array.isArray(result.essentialQuestions)
      ? result.essentialQuestions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      : []

    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

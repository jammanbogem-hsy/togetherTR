import Anthropic from '@anthropic-ai/sdk'
import { contextFromBody, verifySuggestion } from '@/lib/curriculum/suggestVerify'
import { buildAchievementLevelContext, knownStandardCodesIn } from '@/lib/curriculum/achievementLevels'
import { claudeJsonParams, resolveClaudeModel } from '@/lib/llm/anthropic'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Ds-1-1 "평가 설계" 산출물용 AI 제안 API. (2-mode + basedOn + customPrompts)
//  - artifact: 채팅에서 이미 생성된 Ds-1-1 산출물(existingArtifact)을 출발점으로 정교화
//  - chat:    빈 워크스페이스 — 팀 채팅 대화(chatContext)에서 평가 아이디어 단서를 읽고 반영
// Backward Design: A-2-2 통합 수업목표 ↔ 평가 요소 1:1 대응 필수.

export interface EvaluationPlanRubricRow {
  checkpoint: string
  item: string
  method: string
  timing: string
  actor: string
  high?: string
  mid?: string
  low?: string
}

export interface EvaluationPlanSuggestRequest {
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이전 단계 산출물 */
  integratedGoal?: string          // A-2-2 통합 수업목표
  subjectGoals?: Array<{ subject: string; goal: string }>  // A-2-2 교과별 목표
  learnerProfile?: string          // A-2-3 학습자·맥락 요약
  /** 성취기준 코드를 찾을 글(A-2-1 산출물·교육과정 시트) — 서버가 코드를 뽑아 공식 성취수준을 붙인다 */
  standardSources?: string[]
  /** 현재 워크스페이스 초안 */
  currentDraft?: { rubric?: EvaluationPlanRubricRow[] }
  mode?: 'artifact' | 'chat'
  existingArtifact?: { rubric?: Array<Partial<EvaluationPlanRubricRow>> }
  chatContext?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  customPrompts?: Array<{ teacherName: string; text: string }>
}

export interface EvaluationPlanSuggestResult {
  rubric: EvaluationPlanRubricRow[]
  rationale?: string
  basedOn?: {
    mode: 'artifact' | 'chat'
    summary: string
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중·고 협력적 수업설계의 평가 설계 코치입니다.
Ds-1 "평가 설계"의 최신 기본 형식(확인 지점·평가 요소·평가 방법·평가 시점·평가 주체)에 맞춰 두 가지 모드 중 하나로 제안합니다.
협력적 수업설계에서 평가는 수업이 끝난 뒤 확인하는 절차가 아니라 방향을 정하는 설계의 출발점입니다(Backward Design). 평가는 학생이 수업 말미에 보여야 할 '결과 평가'(산출물·발표·수행)와, 산출물에 이르기까지의 탐색·협의·자료 해석·자기점검을 확인하는 '과정 평가'로 나뉩니다. '협력'·'참여' 같은 추상어는 '역할을 맡아 수행하고 진행 상황을 공유함'처럼 관찰 가능한 행동 문장으로 바꿔 적고, 각 요소를 언제·누가·어떤 방법으로 기록할지 정할 때는 교사가 실제로 감당할 기록량인지 끝까지 점검해 시점과 주체를 분산합니다. AI가 내놓는 평가 계획은 결론이 아니라 후보·초안이며, 최종 확정은 교사팀의 몫입니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 각 평가 항목을 존중하되 확인 지점·방법·시점·주체가 모호한 부분을 정교화하고, 누락된 결과 평가·과정 평가 관점이 있으면 1-2개 보강합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀 채팅 대화(chatContext)에서 어떤 평가 아이디어·성공 기준·과정 요소가 언급됐는지 읽고, A-2-2 통합 수업목표와 결합해 평가 계획 초안을 작성합니다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "rubric": [
    { "checkpoint": "확인할 학습 장면 — 예: 최종 제안서, 자료 해석 토의", "item": "평가 요소 (수업목표와 연결된 관찰 가능한 행동)", "method": "평가 방법 — 포트폴리오/구술발표/관찰 기록/체크리스트/자기점검표 등", "timing": "구체적 평가 시점 — 예: 발표 차시, 중간 점검 직후", "actor": "평가 주체 — 교사/동료/자기 또는 조합" }
  ],
  "rationale": "이 평가 계획이 A-2-2 수업목표와 어떻게 연결되는지 1-2문장 (선택)",
  "basedOn": {
    "mode": "artifact 또는 chat",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영', 산출물 모드면 '기존 산출물의 ~항목을 정교화' 식.",
    "references": [ { "source": "채팅: 김나희 / 산출물: 항목2 등", "text": "구체 인용 한두 줄" } ]
  }
}

작성 규칙:
- 각 평가 항목은 A-2-2의 각 수업목표와 1:1 대응. 모든 수업목표가 빠짐없이 1개 이상의 평가 항목으로 등장.
- 결과 평가(최종 산출물·발표·수행)와 과정 평가(탐색·협의·자료 해석·자기점검 등)가 모두 포함되어야 하며, timing에 '결과' 시점과 '과정' 시점이 고르게 나타나게 함.
- 과정 평가 항목은 추상어('협력·참여·노력·태도')를 관찰 가능한 행동 문장으로 변환합니다.
- 교사가 감당할 기록량인지 점검해 actor와 timing을 분산하고 한 교사에게 관찰·기록 부담이 쏠리지 않게 합니다.
- 상·중·하 루브릭은 기본 응답에 만들지 않습니다. 팀이 별도로 상세 기준을 요청했을 때만 high·mid·low를 선택적으로 추가합니다.
- "성취기준별 성취수준" 자료가 주어지면: item 끝에 근거 성취기준 코드를 괄호로 적고(예: "(… [4사03-02])"), 그 성취기준의 A·B·C 원문에 쓰인 행동을 확인할 수 있는 평가 요소로 씁니다. high·mid·low를 채울 때는 해당 코드의 A·B·C 원문에서 출발해 과제 장면에 맞게 구체화하고, 일반 문구로 새로 지어내지 않습니다.
- 추상적 표현('열심히 함') 금지.
- 학습자 다양성(learnerProfile)을 고려해 평가 접근성을 반영.
- 항목 수는 과도하지 않게(통상 4~7개). 실제 차시 수업에서 운영 가능한 수준.
- 본문에 마크다운·코드 블록·추가 설명 절대 금지 (JSON만).
- 존중하는 동료 교사 어조.
`

function resolveMode(body: EvaluationPlanSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  return (body.existingArtifact?.rubric && body.existingArtifact.rubric.length > 0) ? 'artifact' : 'chat'
}

function buildUserPrompt(body: EvaluationPlanSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에 어느 항목을 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 채팅 대화에서 누가 무엇을 언급했는지 읽고 반영하세요.')
  lines.push('')

  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }
  if (body.integratedGoal?.trim()) {
    lines.push('### A-2-2 통합 수업목표 (평가 요소와 1:1 대응)')
    lines.push(body.integratedGoal.trim())
    lines.push('')
  }
  if (body.subjectGoals?.length) {
    lines.push('### A-2-2 교과별 수업목표')
    for (const sg of body.subjectGoals) {
      if (!sg.subject && !sg.goal) continue
      lines.push(`- ${sg.subject || '(교과)'}: ${sg.goal || ''}`)
    }
    lines.push('')
  }
  if (body.learnerProfile?.trim()) {
    lines.push('### A-2-3 학습자·맥락 (평가 접근성 고려)')
    lines.push(body.learnerProfile.trim().slice(0, 800))
    lines.push('')
  }
  if (mode === 'artifact' && body.existingArtifact?.rubric && body.existingArtifact.rubric.length > 0) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 이 항목들을 정교화)')
    body.existingArtifact.rubric.forEach((r, idx) => {
      lines.push(`- 항목${idx + 1}: 지점:${r.checkpoint ?? ''} / 요소:${r.item ?? ''} / 방법:${r.method ?? ''} / 시점:${r.timing ?? ''} / 주체:${r.actor ?? ''}`)
    })
    lines.push('')
  }
  if (mode === 'chat' && body.chatContext && body.chatContext.length > 0) {
    lines.push('### 팀 채팅 대화 (시간순)')
    for (const msg of body.chatContext) {
      const speaker = msg.role === 'assistant' ? 'AI' : (msg.displayName?.trim() || '팀원')
      const text = (msg.content ?? '').trim().slice(0, 500)
      if (text) lines.push(`- [${speaker}] ${text}`)
    }
    lines.push('')
  }
  if (body.currentDraft?.rubric?.length) {
    const meaningful = body.currentDraft.rubric.filter(r => r.item?.trim() || r.method?.trim())
    if (meaningful.length > 0) {
      lines.push('### 현재 워크스페이스 초안 (중복/누락 참고)')
      for (const r of meaningful) lines.push(`- ${r.item || '(항목 미작성)'} / ${r.method || ''}`)
      lines.push('')
    }
  }
  if (body.customPrompts && body.customPrompts.length > 0) {
    const meaningful = body.customPrompts.filter(p => (p.text ?? '').trim().length > 0)
    if (meaningful.length > 0) {
      lines.push('### 팀원별 추가 요청 (협업 프롬프트 — 각 팀원이 자기 의견을 직접 적은 것)')
      lines.push('이 의견들을 모두 의미 있게 반영하되, 충돌하면 다수 의견 또는 수업목표와의 정합성을 우선으로 합의안을 만드세요. basedOn에 어떤 팀원의 의견을 어떻게 반영했는지 명시하세요.')
      for (const p of meaningful) lines.push(`- ${p.teacherName || '팀원'}: ${p.text.trim()}`)
      lines.push('')
    }
  }
  const levelContext = buildAchievementLevelContext('Ds-1-1', knownStandardCodesIn(body.standardSources ?? []))
  if (levelContext) {
    lines.push(levelContext.trim())
    lines.push('')
  }
  lines.push('위 정보를 종합하여 최신 5항목 평가 계획 산출물 형식의 JSON으로만 응답하세요. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EvaluationPlanSuggestRequest
    const hasContext = !!body.integratedGoal?.trim() ||
      !!(body.subjectGoals && body.subjectGoals.length > 0) ||
      !!(body.currentDraft?.rubric && body.currentDraft.rubric.length > 0) ||
      !!(body.existingArtifact?.rubric && body.existingArtifact.rubric.length > 0) ||
      !!(body.chatContext && body.chatContext.length > 0)
    if (!hasContext) {
      return Response.json({ error: 'A-2-2 통합 수업목표가 아직 준비되지 않아 평가 계획을 제안할 수 없습니다.' }, { status: 400 })
    }
    const mode = resolveMode(body)
    const response = await anthropic.messages.create({
      ...claudeJsonParams(resolveClaudeModel('suggest'), 4096),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })
    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText
    let result: EvaluationPlanSuggestResult
    try {
      result = JSON.parse(jsonStr.trim()) as EvaluationPlanSuggestResult
    } catch {
      // max_tokens 초과 등으로 JSON이 잘린 경우 — 마지막 완결 객체까지만 복구 시도.
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답이 잘려 JSON으로 파싱하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 })
      }
      result = recovered as EvaluationPlanSuggestResult
    }
    result.rubric = Array.isArray(result.rubric) ? result.rubric : []
    // [2026-09-20] 사후 검증(차단 없음): 성취기준 코드 대조 + Jev 정합·적정성. 응답 메타로만 붙인다.
    const verification = await verifySuggestion('evaluation-plan', result, contextFromBody(body as unknown as Record<string, unknown>, {}))
    return Response.json({ ...result, verification })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

import Anthropic from '@anthropic-ai/sdk'
import { claudeJsonParams, resolveClaudeModel } from '@/lib/llm/anthropic'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'
import { buildAchievementLevelContext, knownStandardCodesIn } from '@/lib/curriculum/achievementLevels'
import { RUBRIC_COLUMNS, isRubricActivity, normalizeRubricRows, type RubricRow } from '@/lib/rubric/rubric'
import { ACTIVITY_META, displayActivityCode, type ActivityCode } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 설계 단계(Ds-1~Ds-5) 평가 루브릭 AI 제안.
// 상·중·하는 이 설계 성취기준의 공식 성취수준 A·B·C 원문에서 출발하고, 팀 산출물·대화의 과제 장면으로 구체화한다.

export interface RubricSuggestRequest {
  activityCode: ActivityCode
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이 활동과 앞 활동 산출물·분석표 (label + 본문) */
  priorArtifacts?: Array<{ label: string; text: string }>
  chatContext?: Array<{ role: string; content: string; displayName?: string }>
  existingRows?: Array<Partial<RubricRow>>
}

export interface RubricSuggestResult {
  rows: RubricRow[]
  rationale?: string
  /** 참고한 공식 성취수준 코드 */
  levelCodes: string[]
}

const FOCUS: Partial<Record<ActivityCode, string>> = {
  'Ds-1-1': '평가 계획의 결과 평가·과정 평가 항목마다 한 행. 수업목표와 1:1로 대응시킨다.',
  'Ds-1-2': '문제 상황(실제성·산출물·청중)이 요구하는 최종 산출물과 수행을 평가하는 행. 산출물의 질과 청중 앞 수행을 구분한다.',
  'Ds-1-3': '핵심 학습활동마다 학생이 보여 주는 행동을 평가하는 행. 활동 이름과 장면을 평가 요소에 드러낸다.',
  'Ds-2-1': '지원 도구(활동지·디지털 도구 등)를 써서 학생이 만들어 내는 결과·과정을 평가하는 행. 도구 사용 자체가 아니라 학습 행동을 본다.',
  'Ds-2-2': '스캐폴딩으로 지원하는 활동에서의 도달 정도를 평가하는 행. 하 수준은 어떤 지원이 있으면 할 수 있는지가 드러나게 쓴다.',
}

const SYSTEM = `당신은 초등 교사팀의 협력적 수업설계를 돕는 평가 설계 파트너입니다.
교사팀의 산출물과 대화를 근거로 평가 루브릭 초안을 제안합니다. 최종 판단은 교사팀의 몫이므로 고칠 여지를 남기는 초안으로 씁니다.

규칙:
- 상·중·하는 반드시 아래 "성취기준별 성취수준" 원문에서 출발합니다(상↔A, 중↔B, 하↔C). 원문의 핵심 동사와 조건을 유지한 채 이 수업의 과제·산출물 장면으로만 구체화합니다.
- 성취수준 원문이 없는 과정 평가(협력·자기점검 등)는 관찰 가능한 행동 문장으로 쓰고, 근거 성취기준 칸에 "과정 평가"라고 적습니다.
- 근거 성취기준 칸에는 산출물에 실제로 나온 코드만 "[4사10-02]"처럼 적습니다. 코드를 지어내지 않습니다.
- 상·중·하는 서로 행동의 차이가 분명해야 합니다("잘함/보통/부족" 같은 정도어만 바꾸지 않습니다).
- 학생 이름·개인정보는 쓰지 않습니다.
- 3~6행을 제안합니다. 이미 있는 행과 같은 평가 요소는 다시 만들지 않습니다.

응답은 JSON만 출력합니다:
{"rows":[{"element":"평가 요소","standard":"근거 성취기준","method":"평가 방법","timing":"평가 시점","high":"상","mid":"중","low":"하"}],"rationale":"근거 2~3문장"}`

function buildUserPrompt(body: RubricSuggestRequest, levelBlock: string): string {
  const meta = ACTIVITY_META[body.activityCode]
  const lines: string[] = [
    `## 대상 활동: ${displayActivityCode(body.activityCode)} ${meta?.label ?? ''}`,
    FOCUS[body.activityCode] ?? '',
    '',
  ]
  if (body.projectTitle) lines.push(`- 프로젝트: ${body.projectTitle}`)
  if (body.targetGradeGroup) lines.push(`- 대상 학년군: ${body.targetGradeGroup}`)
  if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
  lines.push('')
  for (const a of body.priorArtifacts ?? []) {
    const t = (a.text ?? '').trim()
    if (t) lines.push(`### ${a.label}`, t.slice(0, 4000), '')
  }
  const existing = (body.existingRows ?? []).map(r => (r.element ?? '').trim()).filter(Boolean)
  if (existing.length) lines.push(`### 이미 있는 평가 요소 (다시 만들지 말 것)`, ...existing.map(e => `- ${e}`), '')
  if (body.chatContext?.length) {
    lines.push('### 팀 대화 (시간순 — 맥락 단서)')
    for (const m of body.chatContext.slice(-24)) {
      const who = m.role === 'assistant' ? 'AI' : (m.displayName?.trim() || '팀원')
      const t = (m.content ?? '').trim().slice(0, 500)
      if (t) lines.push(`- [${who}] ${t}`)
    }
    lines.push('')
  }
  lines.push(levelBlock || '\n(이 설계의 산출물에서 공식 성취수준이 있는 성취기준 코드를 찾지 못했습니다. 상·중·하는 과제 장면의 행동 차이로 쓰고, rationale에 공식 수준이 아님을 밝히세요.)')
  lines.push('', `열: ${RUBRIC_COLUMNS.map(c => `${c.id}=${c.label}`).join(', ')}`)
  lines.push('위 정보를 근거로 루브릭 행을 JSON으로만 응답하세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RubricSuggestRequest
    if (!isRubricActivity(body?.activityCode)) {
      return Response.json({ error: '루브릭을 지원하지 않는 활동입니다.' }, { status: 400 })
    }
    const texts = [
      ...(body.priorArtifacts ?? []).map(a => a.text ?? ''),
      ...(body.chatContext ?? []).map(m => m.content ?? ''),
    ]
    const levelCodes = knownStandardCodesIn(texts)
    // Ds-1-1 사용 지침(상↔A·중↔B·하↔C)이 루브릭 작성 규칙이므로 활동과 무관하게 그 블록을 쓴다.
    const levelBlock = buildAchievementLevelContext('Ds-1-1', levelCodes)

    const response = await anthropic.messages.create({
      ...claudeJsonParams(resolveClaudeModel('suggest'), 4096),
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(body, levelBlock) }],
    })
    const rawText = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = (jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText).trim()
    let parsed: { rows?: unknown; rationale?: unknown }
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      const recovered = recoverTruncatedJson(jsonStr)
      if (!recovered) return Response.json({ error: 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 })
      parsed = recovered as typeof parsed
    }
    const result: RubricSuggestResult = {
      rows: normalizeRubricRows(parsed.rows),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : undefined,
      levelCodes,
    }
    return Response.json(result)
  } catch (error) {
    console.error('[rubric/suggest]', error)
    return Response.json({ error: 'AI 제안을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, { status: 500 })
  }
}

import Anthropic from '@anthropic-ai/sdk'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Ds-2-1 "지원 도구(자료) 설계" 산출물용 AI 제안 API. (2-mode + basedOn + customPrompts)
//  - artifact: 채팅에서 이미 생성된 Ds-2-1 산출물(existingArtifact)을 출발점으로 정교화
//  - chat:    빈 워크스페이스 — 팀 채팅 대화(chatContext)에서 맥락 단서를 읽고 자료/도구 목록 초안 작성
// 지원 도구(자료) = Ds-1-3 학습활동별로 필요한 자료/도구를 ❶나열 ❷탐색/개발 ❸공동/개별 ❹일정·역할 4단계로 설계.

export interface Ds21Material {
  activity: string     // 대상 학습활동 (Ds-1-3 활동명 + 누적 차시)
  name: string         // 자료/도구명 + 핵심 기능
  purpose: string      // 활용 이유 — 학생의 어떤 수행을 지원하는지
  sourceType: string   // "탐색" | "개발"
  devScope: string     // (개발 자료) "공동" | "개별"
  owner: string        // 담당 교사
  schedule: string     // 일정 — 마감 / 중간 공유 / 최종 검토
}

export interface SupportToolSuggestRequest {
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이전 단계 산출물 */
  integratedGoal?: string         // A-2-2 통합 수업목표
  subjectGoals?: Array<{ subject: string; goal: string }>
  learnerProfile?: string         // A-2-3 학습자·맥락 요약
  learningActivities?: string     // Ds-1-3 학습활동 표 요약 (자료/도구가 이 활동들을 지원해야 함)
  evaluationPlan?: string         // Ds-1-1 평가 계획 요약
  currentDraft?: { materials?: Partial<Ds21Material>[] }
  mode?: 'artifact' | 'chat'
  existingArtifact?: { materials?: Partial<Ds21Material>[] }
  chatContext?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  customPrompts?: Array<{ teacherName: string; text: string }>
}

export interface SupportToolSuggestResult {
  materials: Ds21Material[]
  rationale?: string
  basedOn?: {
    mode: 'artifact' | 'chat'
    summary: string
    references?: Array<{ source: string; text: string }>
  }
}

const SYSTEM_PROMPT = `당신은 초·중등 협력적 수업설계의 자료와 도구 연결 코치입니다.
Ds-2-1 "자료와 도구 연결" 산출물의 추천 형식(자료/도구 목록 표)에 맞춰 두 가지 모드 중 하나로 제안합니다.
자료와 도구는 지식 구성을 돕고 학습 활동을 확장합니다. 같은 활동이라도 어떤 자료·도구를 쓰느냐에 따라 결과가 달라지므로 활동과 자료를 함께 설계하되, 양보다 기능을 기준으로 고릅니다('기사 10개'보다 '우리 동네 대기질 공공데이터 1건'). 특히 반응형 학습지·간단 시뮬레이션·데이터 분석 도구 같은 AI·디지털 도구를 적극 고려합니다. 각 자료는 이미 있는 것을 쓸 '탐색', 학생 수준·목표에 맞게 고쳐 쓸 '재구성', 새로 만들 '개발'로 나누고, 재구성·개발 자료는 수업 전체에 영향을 주는지에 따라 공동/개별을 정합니다. 자료를 정할 때는 학생 수준·출처·저작권·개인정보·접근성을 함께 확인합니다. AI가 내놓는 자료 목록은 결론이 아니라 후보·초안이며, 최종 선별과 확정은 교사팀의 몫입니다.

[mode='artifact'] — 채팅에서 이미 만들어진 산출물(existingArtifact)이 출발점입니다. 기존 자료/도구 목록을 존중하되, 누락된 활동·모호한 활용 이유·미정 일정/역할을 정교화합니다.

[mode='chat'] — 빈 워크스페이스에서 시작합니다. 팀 채팅 대화(chatContext)에서 언급된 자료·도구·역할 단서를 읽고, Ds-1-3 학습활동·A-2-2 통합 목표·Ds-1-1 평가와 결합해 자료/도구 목록 초안을 작성합니다.

설계는 다음 4단계 흐름을 반영하세요:
❶ 나열 — Ds-1-3의 각 학습활동마다 학생 수행에 필요한 자료/도구를 빠짐없이 나열한다. 양보다 기능 중심으로, 반응형 학습지 등 AI·디지털 도구도 적극 포함한다.
❷ 탐색/재구성/개발 — 각 자료를 이미 있는 것을 쓸 '탐색', 기존 자료를 학생 수준·목표에 맞게 고쳐 쓸 '재구성', 새로 만들 '개발'로 구분한다.
❸ 공동/개별 — '재구성'·'개발' 자료는 교사들이 '공동' 제작할지 '개별' 제작할지 정한다. 루브릭·공통 안내문처럼 수업 전체에 영향을 주는 자료는 '공동'으로.
❹ 일정·역할 — 담당 교사와 일정(마감 / 중간 공유 / 최종 검토)을 배정한다.

반드시 아래 JSON 형식으로만 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요.

{
  "materials": [
    {
      "activity": "대상 활동 — Ds-1-3 활동명 + 누적 차시 (예: '데이터 수집·정리 (3~4차시)')",
      "name": "자료/도구명 + 핵심 기능. 양보다 기능 중심으로, 반응형 학습지·간단 시뮬레이션·공공데이터·데이터 분석 도구 등 AI·디지털 도구도 적극 포함 (예: '우리 동네 대기질 공공데이터 — 학생이 직접 통계로 실태 규명')",
      "purpose": "활용 이유 — 학생의 어떤 수행을 어떻게 지원하는지 1~2문장",
      "sourceType": "탐색 / 재구성 / 개발 중 하나 (재구성=기존 자료를 학생 수준·목표에 맞게 고쳐 씀)",
      "devScope": "재구성·개발 자료면 공동 또는 개별, 탐색 자료면 빈 문자열",
      "owner": "담당 교사 (탐색이면 검수 담당 / 개발이면 제작 담당)",
      "schedule": "일정 — 마감 / 중간 공유 / 최종 검토 시점"
    }
  ],
  "rationale": "이 자료/도구 목록이 Ds-1-3 학습활동·A-2-2 목표·Ds-1-1 평가와 어떻게 연결되는지 1-2문장 (선택)",
  "basedOn": {
    "mode": "artifact 또는 chat",
    "summary": "이 제안이 무엇에 근거했는지 2-3문장. 채팅 모드면 '~팀원이 ~을 강조한 흐름을 반영', 산출물 모드면 '기존 산출물의 ~을 정교화' 식.",
    "references": [ { "source": "채팅: 김나희 / 산출물: 3행 등", "text": "구체 인용 한두 줄" } ]
  }
}

작성 규칙:
- Ds-1-3의 모든 학습활동을 점검해 활동마다 필요한 자료/도구가 빠지지 않도록 한다. 한 활동에 자료가 여러 개면 행을 나눠 적는다.
- 자료는 양보다 기능 — 활동 목적을 가장 잘 받쳐 주는 자료를 고른다('기사 10개'보다 핵심 데이터 1건). 반응형 학습지·간단 시뮬레이션·데이터 분석 도구 등 AI·디지털 도구를 적극 포함한다.
- 활용 이유는 '학생이 무엇을 더 잘 할 수 있게 되는가'로 서술한다. 교사 편의가 아니라 학생 수행 지원 관점.
- 자료를 정할 때 학생 수준(난이도·읽기 부담), 출처·저작권, 개인정보, 접근성(기기·장애 학생·저시력 등)을 함께 점검해 활용 이유나 일정에 위험 요인을 반영한다.
- '탐색' 자료는 devScope를 비우고 owner에 검수 담당을 둔다. '재구성'·'개발' 자료는 반드시 공동/개별을 정한다. 루브릭·공통 안내문처럼 수업 전체에 영향을 주는 자료는 '공동'으로.
- 일정은 막연한 '추후'가 아니라 마감·중간 공유·최종 검토 시점이 드러나게 적는다.
- 본문에 마크다운·코드 블록·추가 설명 절대 금지 (JSON만).
- 존중하는 동료 교사 어조.
`

function resolveMode(body: SupportToolSuggestRequest): 'artifact' | 'chat' {
  if (body.mode) return body.mode
  const ea = body.existingArtifact
  const has = !!(ea?.materials && ea.materials.length > 0)
  return has ? 'artifact' : 'chat'
}

function describeMaterials(materials: Partial<Ds21Material>[]): string[] {
  const out: string[] = []
  materials.forEach((m, i) => {
    const parts: string[] = []
    if (m.activity) parts.push(`활동: ${m.activity}`)
    if (m.name) parts.push(`자료/도구: ${m.name}`)
    if (m.purpose) parts.push(`활용 이유: ${m.purpose}`)
    if (m.sourceType) parts.push(`탐색/개발: ${m.sourceType}`)
    if (m.devScope) parts.push(`공동/개별: ${m.devScope}`)
    if (m.owner) parts.push(`담당: ${m.owner}`)
    if (m.schedule) parts.push(`일정: ${m.schedule}`)
    if (parts.length > 0) out.push(`- (${i + 1}) ${parts.join(' / ')}`)
  })
  return out
}

function buildUserPrompt(body: SupportToolSuggestRequest, mode: 'artifact' | 'chat'): string {
  const lines: string[] = []
  lines.push(`### 모드: ${mode}`)
  lines.push(mode === 'artifact'
    ? '→ 기존 산출물을 출발점으로 보강·정교화합니다. basedOn에 어느 행을 어떻게 다듬었는지 인용하세요.'
    : '→ 빈 워크스페이스 초안입니다. 채팅 대화에서 누가 어떤 맥락을 언급했는지 읽고 반영하세요.')
  lines.push('')
  if (body.projectTitle || body.targetGradeGroup || (body.targetSubjects && body.targetSubjects.length)) {
    lines.push('### 프로젝트 메타')
    if (body.projectTitle) lines.push(`- 제목: ${body.projectTitle}`)
    if (body.targetGradeGroup) lines.push(`- 학년군: ${body.targetGradeGroup}`)
    if (body.targetSubjects?.length) lines.push(`- 교과: ${body.targetSubjects.join(', ')}`)
    lines.push('')
  }
  if (body.integratedGoal?.trim()) {
    lines.push('### A-2-2 통합 수업목표 (자료/도구가 이 목표 달성을 지원해야 함)')
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
  if (body.learningActivities?.trim()) {
    lines.push('### Ds-1-3 학습활동 (이 활동들을 자료/도구로 지원해야 함 — 활동마다 점검)')
    lines.push(body.learningActivities.trim().slice(0, 1500))
    lines.push('')
  }
  if (body.evaluationPlan?.trim()) {
    lines.push('### Ds-1-1 평가 계획 (자료/도구가 이 평가 수행을 지원해야 함)')
    lines.push(body.evaluationPlan.trim().slice(0, 1000))
    lines.push('')
  }
  if (body.learnerProfile?.trim()) {
    lines.push('### A-2-3 학습자·맥락 (학생 수준·접근성 판단 기준)')
    lines.push(body.learnerProfile.trim().slice(0, 800))
    lines.push('')
  }
  if (mode === 'artifact' && body.existingArtifact?.materials && body.existingArtifact.materials.length > 0) {
    lines.push('### 채팅에서 만들어진 기존 산출물 (출발점 — 정교화)')
    for (const l of describeMaterials(body.existingArtifact.materials)) lines.push(l)
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
  if (body.currentDraft && body.currentDraft.materials && body.currentDraft.materials.length > 0) {
    lines.push('### 현재 워크스페이스 초안 (중복/누락 참고)')
    for (const l of describeMaterials(body.currentDraft.materials)) lines.push(l)
    lines.push('')
  }
  if (body.customPrompts && body.customPrompts.length > 0) {
    const meaningful = body.customPrompts.filter(p => (p.text ?? '').trim().length > 0)
    if (meaningful.length > 0) {
      lines.push('### 팀원별 추가 요청 (협업 프롬프트 — 각 팀원이 자기 의견을 직접 적은 것)')
      lines.push('이 의견들을 모두 의미 있게 반영하되, 충돌하면 다수 의견 또는 학습활동·평가와의 정합성을 우선으로 합의안을 만드세요. basedOn에 어떤 팀원의 의견을 어떻게 반영했는지 명시하세요.')
      for (const p of meaningful) lines.push(`- ${p.teacherName || '팀원'}: ${p.text.trim()}`)
      lines.push('')
    }
  }
  lines.push('위 정보를 종합하여 지원 도구(자료) 설계 산출물 형식의 JSON으로만 응답하세요. basedOn 필드를 반드시 채우세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SupportToolSuggestRequest
    const hasContext = !!body.integratedGoal?.trim() ||
      !!(body.subjectGoals && body.subjectGoals.length > 0) ||
      !!body.learningActivities?.trim() ||
      !!body.evaluationPlan?.trim() ||
      !!(body.currentDraft && body.currentDraft.materials && body.currentDraft.materials.length > 0) ||
      !!(body.existingArtifact && body.existingArtifact.materials && body.existingArtifact.materials.length > 0) ||
      !!(body.chatContext && body.chatContext.length > 0)
    if (!hasContext) {
      return Response.json({ error: 'Ds-1-3 학습활동·A-2-2 통합 수업목표가 아직 준비되지 않아 지원 도구(자료)를 제안할 수 없습니다.' }, { status: 400 })
    }
    const mode = resolveMode(body)
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3072,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, mode) }],
    })
    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText
    let result: SupportToolSuggestResult
    try {
      result = JSON.parse(jsonStr.trim()) as SupportToolSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr.trim())
      if (!recovered) {
        return Response.json({ error: 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 })
      }
      result = recovered as SupportToolSuggestResult
    }
    result.materials = Array.isArray(result.materials) ? result.materials : []
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

import Anthropic from '@anthropic-ai/sdk'
import { claudeJsonParams, resolveClaudeModel } from '@/lib/llm/anthropic'
import { recoverTruncatedJson } from '@/lib/llm/recoverJson'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// DI·E 공동 편집 세션(DI-1/DI-2/E-1/E-2) 공용 AI 제안 API.
// 기존 12개 활동은 활동마다 라우트를 따로 뒀지만, 신규 4종은 요청·응답 형태가 같고
// 활동별 지침만 다르므로 activityCode로 분기하는 단일 라우트로 둔다.
// 표의 컬럼 정의를 클라이언트가 그대로 보내므로, 응답 행의 키는 항상 컬럼 id와 일치한다.

export type CoeditSuggestActivity = 'DI-1-1' | 'DI-2-1' | 'E-1-1' | 'E-2-1'

export interface CoeditSuggestRequest {
  activityCode: CoeditSuggestActivity
  /** 채울 표의 컬럼 (id가 응답 행의 키가 된다) */
  columns: Array<{ id: string; label: string }>
  /** 현재 워크스페이스에 이미 있는 행 — 중복 제안 방지 */
  existingRows?: Array<Record<string, string>>
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  teamMembers?: string[]
  /** 이전 활동 산출물 요약 (label + 본문) */
  priorArtifacts?: Array<{ label: string; text: string }>
  chatContext?: Array<{ role: string; content: string; displayName?: string }>
}

export interface CoeditSuggestResult {
  rows: Array<Record<string, string>>
  rationale?: string
}

const BASE_SYSTEM = `당신은 초·중·고 교사팀의 협력적 수업설계를 돕는 설계 파트너입니다.
협력적 수업설계 가이드(3장)의 개발·실행(DI)·평가(E) 단계 원칙을 따릅니다.

공통 원칙:
- AI가 내놓는 것은 결론이 아니라 **후보이자 초안**입니다. 최종 판단은 교사팀의 몫이므로 단정적으로 쓰지 말고 팀이 고칠 여지를 남깁니다.
- 학생 이름·개인정보·민감정보는 절대 생성하지 않습니다. 필요하면 "학생 A"처럼 익명으로 씁니다.
- 팀이 실제로 쓸 수 있게 **구체적으로** 씁니다. "더 자주 소통하자" 같은 다짐이 아니라 확인 가능한 행동으로 적습니다.
- 이전 단계 산출물이 주어지면 반드시 그것에 근거해 씁니다. 근거가 없으면 빈 문자열로 두고 지어내지 않습니다.

응답은 반드시 JSON만 출력합니다:
{"rows":[{"<컬럼id>":"<값>", ...}, ...],"rationale":"<이 제안을 만든 근거 2~3문장>"}
rows의 각 객체는 제공된 컬럼 id를 키로 씁니다. 정의되지 않은 키는 넣지 않습니다.`

const ACTIVITY_GUIDE: Record<CoeditSuggestActivity, string> = {
  'DI-1-1': `## DI-1 자료 탐색·개발
목적: 설계 단계에서 합의한 학습활동·평가를 실제 수업으로 옮기기 위해 "무엇이 필요한가"를 구체화합니다.
- 학습활동(Ds-3)과 스캐폴딩(Ds-5) 각각에 대해 필요한 자료(활동지·읽기자료·평가지·안내문)를 떠올립니다.
- **설계 단계에서 정한 도구를 여기서 새로 고르지 않습니다.** 계획대로 준비·점검하는 단계입니다.
- 확보 방법은 '탐색'(이미 있는 것을 찾아 씀)과 '개발'(새로 만듦)로 나눕니다.
- 개발 자료는 수업 전체에 영향을 주면 '공동', 한 교과에만 쓰이면 '개별'로 나눕니다.
- **중복 제작을 덜어내는 것이 이 활동의 핵심**입니다. 여러 교과가 같이 쓸 수 있는 자료는 하나로 묶어 '공동'으로 제안하세요.
- '완료' 칸은 아직 비워 둡니다(팀이 진행하며 채웁니다).
- '학생 관점 검토' 칸에는 동료가 학생인 척 따라갈 때 **막힐 만한 지점을 예상해** 한 줄로 적습니다. 칭찬이 아니라 걸림돌을 씁니다.
5~8행 정도 제안하세요.`,

  'DI-2-1': `## DI-2 수업 실행·기록
목적: 설계와 실제 교실이 달라지는 장면을 근거로 남겨 평가(E) 단계의 재료로 삼습니다.
- **해석과 판단을 하지 않습니다.** 이 단계는 "사실과 증거"만 남깁니다. 성공/실패 원인, 개선안을 쓰면 안 됩니다.
- '학생 반응'은 관찰 가능한 발화·행동으로 씁니다. 추상적 평가("이해도가 낮았다")가 아니라 구체적 사실("여러 모둠이 같은 단계에서 질문을 멈췄다")로 씁니다.
- 'E단계 확인 질문'에는 지금 답하지 말고 **평가 단계에서 팀이 확인해야 할 질문**을 적습니다. 깊은 분석은 평가 단계에서 합니다.
- 예상과 달랐던 장면, 인상적인 발화, 뜻밖의 질문 세 갈래를 고루 담습니다.
- 학습활동과 자료 목록이 주어졌다면 그 차시에서 실제로 일어날 법한 장면을 씁니다.
4~6행 정도 제안하되, 팀이 실제 관찰을 채워 넣을 **관찰 틀**로 제안한다는 점을 rationale에 밝히세요.`,

  'E-1-1': `## E-1 수업 성찰과 공동 개선
목적: 학생의 결과물과 형성평가 자료를 근거로 설계 의도와 실제 배움의 차이를 확인하고 설계안을 고칩니다.
- 샘플은 **세 갈래**로 봅니다: 목표에 잘 도달한 사례 / 자주 보인 오개념 / 예상 밖의 창의적 반응. '샘플 유형' 칸에는 이 셋 중 하나를 씁니다.
- 같은 학생 결과물도 교과마다 다르게 읽힙니다. 교과별 관점(데이터 해석의 정확성, 실현 가능성, 주장·근거의 설득력 등)이 드러나게 씁니다.
- '루브릭 도달 정도'는 평가 계획이 주어졌을 때만 그 기준에 비추어 씁니다.
- 교사의 직관이 아니라 **관찰 가능한 근거**로 씁니다.
4~6행 정도 제안하고, 팀이 실제 학생 자료로 대체할 초안임을 rationale에 밝히세요.`,

  'E-2-1': `## E-2 협력 과정 성찰
목적: 준비 단계(T)에서 합의한 비전·설계 방향·역할·규칙·일정이 실제 협력에서 어떻게 지켜졌는지 돌아봅니다.
- **문제의 원인을 개인이 아니라 구조에서 찾습니다.** "확인이 늦었다"가 아니라 "확인 여부를 알 수 있는 장치가 없었다"로 씁니다.
- 특정 교사를 지목하거나 잘잘못을 가리지 않습니다. 의사소통·업무 분배·시간 관리 세 측면으로 봅니다.
- '다음 협력 운영 원칙'은 **바로 실행할 수 있고 지켰는지 확인할 수 있는 행동**으로 씁니다.
  나쁜 예: "앞으로 더 자주 소통하자" / 좋은 예: "공유 문서에 의견을 남기면 팀 대화방으로 알리고, 24시간 안에 확인 댓글을 단다"
- '초기 합의' 칸은 이미 채워져 있으면 **그대로 두고** 나머지 칸만 채웁니다.
주어진 행 수만큼만 제안하고 새 행을 늘리지 마세요.`,
}

function buildUserPrompt(body: CoeditSuggestRequest): string {
  const lines: string[] = []
  lines.push(ACTIVITY_GUIDE[body.activityCode])
  lines.push('')
  lines.push('### 채울 표의 컬럼 (응답 행의 키로 이 id를 그대로 사용)')
  for (const c of body.columns) lines.push(`- ${c.id}: ${c.label}`)
  lines.push('')

  if (body.projectTitle?.trim()) lines.push(`### 수업 주제\n${body.projectTitle.trim()}\n`)
  const meta = [
    body.targetGradeGroup?.trim() && `학년군: ${body.targetGradeGroup.trim()}`,
    body.targetSubjects?.length && `교과: ${body.targetSubjects.join(', ')}`,
    body.teamMembers?.length && `팀원: ${body.teamMembers.join(', ')}`,
  ].filter(Boolean)
  if (meta.length) lines.push(`### 팀 정보\n${meta.join(' / ')}\n`)

  for (const a of body.priorArtifacts ?? []) {
    const text = (a.text ?? '').trim()
    if (!text) continue
    lines.push(`### ${a.label}`)
    lines.push(text.slice(0, 1500))
    lines.push('')
  }

  if (body.existingRows?.length) {
    lines.push('### 현재 표에 이미 있는 행 (중복 제안 금지 · 빈 칸만 채우기)')
    for (const r of body.existingRows) {
      const s = body.columns.map(c => `${c.label}: ${(r[c.id] ?? '').trim() || '-'}`).join(' / ')
      lines.push(`- ${s}`)
    }
    lines.push('')
  }

  if (body.chatContext?.length) {
    lines.push('### 팀 대화 (시간순 — 맥락 단서)')
    for (const m of body.chatContext.slice(-20)) {
      const who = m.role === 'assistant' ? 'AI' : (m.displayName?.trim() || '팀원')
      const t = (m.content ?? '').trim().slice(0, 400)
      if (t) lines.push(`- [${who}] ${t}`)
    }
    lines.push('')
  }

  lines.push('위 정보를 근거로 표를 채울 행을 JSON으로만 응답하세요.')
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CoeditSuggestRequest
    if (!body?.activityCode || !ACTIVITY_GUIDE[body.activityCode]) {
      return Response.json({ error: '지원하지 않는 활동입니다.' }, { status: 400 })
    }
    if (!Array.isArray(body.columns) || body.columns.length === 0) {
      return Response.json({ error: '표 컬럼 정보가 없습니다.' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      ...claudeJsonParams(resolveClaudeModel('suggest'), 3072),
      system: BASE_SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(body) }],
    })
    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/)
    const jsonStr = (jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : rawText).trim()

    let result: CoeditSuggestResult
    try {
      result = JSON.parse(jsonStr) as CoeditSuggestResult
    } catch {
      const recovered = recoverTruncatedJson(jsonStr)
      if (!recovered) {
        return Response.json({ error: 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 })
      }
      result = recovered as CoeditSuggestResult
    }

    // 정의되지 않은 키·비문자열 값을 걸러 표 구조를 보호한다
    const allowed = new Set(body.columns.map(c => c.id))
    result.rows = (Array.isArray(result.rows) ? result.rows : [])
      .map(row => {
        const clean: Record<string, string> = {}
        for (const [k, v] of Object.entries(row ?? {})) {
          if (allowed.has(k) && typeof v === 'string') clean[k] = v.trim()
        }
        return clean
      })
      .filter(row => Object.values(row).some(v => v))

    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

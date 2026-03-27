import OpenAI from 'openai'
import type { StageCode, ActivityCode } from '@/types'
import { STAGES, ACTIVITY_META } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const STAGE_LABELS: Record<StageCode, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

function buildAnalysisPrompt(
  stage: StageCode,
  project: { title: string; targetGradeGroup: string; targetSubjects?: string[] },
  artifacts: Record<string, { title: string; content: Record<string, unknown> }>,
): string {
  const stageInfo = STAGES.find(s => s.code === stage)!
  const artifactSections = stageInfo.activities.map(code => {
    const meta = ACTIVITY_META[code]
    const art = artifacts[code]
    if (!art) return `### ${meta.label} (${code})\n산출물 없음\n`
    const contentStr = Object.entries(art.content)
      .map(([k, v]) => `- **${k}**: ${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`)
      .join('\n')
    return `### ${meta.label} (${code})\n${contentStr}\n`
  }).join('\n')

  return `당신은 T-CID(팀 협력 수업설계) 모델 전문가입니다. 아래 팀 산출물을 분석해 마크다운 보고서를 작성하세요.

**핵심 원칙**: 팀이 실제로 만들어낸 내용(비전, 결정, 합의, 아이디어)을 구체적으로 드러내는 것이 최우선입니다. 평가보다 내용 해석에 집중하세요.

**마크다운 규칙** (반드시 준수):
- 각 섹션은 ## 헤더로 구분
- 핵심 문장·인용·결정사항은 반드시 > blockquote로 표시
- 산출물 소제목은 ### 으로, 그 아래 핵심 결정은 > 로 표시
- bold(**텍스트**)는 팀이 실제로 결정한 핵심 키워드에만 사용
- 준비도는 반드시 표(table)로

## 프로젝트
- 제목: ${project.title} | 대상: ${project.targetGradeGroup} | 교과: ${project.targetSubjects?.join(', ') ?? '미지정'} | 단계: ${STAGE_LABELS[stage]}

## 산출물
${artifactSections}

---

아래 구조 그대로 보고서를 작성하세요:

# ${project.title} · ${STAGE_LABELS[stage]} 분석 보고서

## 🎯 이 팀이 만들어낸 것

(이 팀이 이 단계에서 협의·결정한 핵심 내용을 3~4문장 서술. 팀의 고유한 비전·방향·합의사항을 구체적 내용 기반으로. 이 단락만 읽어도 이 팀이 무엇을 만들었는지 알 수 있어야 함)

> (이 팀의 가장 핵심적인 결정이나 비전 문장을 그대로 인용하거나 핵심 요약으로 한 줄)

---

## 📋 산출물별 핵심 내용

### [활동명] (코드)
(이 팀이 이 활동에서 실제로 결정한 내용을 2~3문장으로 해석. "~를 ~로 결정했다", "특히 ~가 주목된다" 형식)

> (해당 산출물에서 가장 중요한 결정 또는 내용을 1~2문장으로 요약)

(나머지 활동도 동일 형식 반복)

---

## ✅ 이 팀의 강점

- **[강점 키워드]**: 실제 산출물 내용에서 드러나는 구체적 근거와 함께 서술
(3가지)

---

## 💡 다음 단계를 위한 제언

- **[제언 키워드]**: 실질적이고 구체적인 제안
(2~3가지)

---

## 📊 준비도

| 항목 | 점수 | 근거 |
|------|------|------|
| 산출물 완성도 | X / 5 | 한 줄 근거 |
| 팀 협력 수준 | X / 5 | 한 줄 근거 |
| 다음 단계 준비도 | X / 5 | 한 줄 근거 |

> 총평: (한 문장으로 이 팀의 이 단계 핵심 특징을 담은 총평)

---
*T-CID 협력 수업설계 모델 기반 AI 분석 보고서*`
}

export async function POST(request: Request) {
  try {
    const { stage, project, artifacts } = await request.json() as {
      stage: StageCode
      project: { title: string; targetGradeGroup: string; targetSubjects?: string[] }
      artifacts: Record<string, { title: string; content: Record<string, unknown> }>
    }

    const prompt = buildAnalysisPrompt(stage, project, artifacts)
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 3000,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
          })

          for await (const chunk of response) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`))
            }
            if (chunk.choices[0]?.finish_reason === 'stop') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
}

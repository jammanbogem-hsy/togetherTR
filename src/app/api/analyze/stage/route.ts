import OpenAI from 'openai'
import type { StageCode } from '@/types'
import { STAGES, ACTIVITY_META } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const STAGE_LABELS: Record<StageCode, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

// 단계별 심층 분석 섹션 정의
const STAGE_DEEP_ANALYSIS: Record<StageCode, string> = {
  T: `## 🔍 팀 역학 심층 분석

팀의 역할 분배, 공통 비전, 운영 규칙이 실제로 협력 수업설계를 지탱할 수 있는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **비전 정합성**: 팀이 수립한 비전이 교과 융합 수업설계의 방향성으로 충분한가? 구체성과 공유 가능성 측면에서 분석
2. **역할 설계의 적절성**: 각 교사의 역할이 T-CID 협력 모델에서 요구하는 역할(교과 전문가·코디네이터·성찰자)과 어떻게 연결되는가?
3. **팀 규칙의 실효성**: 수립된 규칙이 Ds·DI 단계의 갈등 상황에서 실제로 작동할 수 있는 구체성을 갖추고 있는가?
4. **잠재적 긴장 요소**: 역할 경계 불명확, 의사결정 구조 미비, 일정 충돌 가능성 등 향후 단계에서 문제가 될 수 있는 요소 진단`,

  A: `## 🔍 분석 단계 심층 분석

성취기준 선택, 내용·기능요소 추출, 통합 목표 수립, 학습자 분석이 설계(Ds) 단계의 견고한 토대가 될 수 있는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **교과 통합의 깊이**: 선택된 성취기준들이 단순 병렬 나열인가, 아니면 공통 개념·기능을 중심으로 진정한 융합 가능성을 보이는가? 교과 간 연결의 강도와 취약점을 분석
2. **내용·기능요소의 균형**: 내용요소(지식)와 기능요소(과정)의 비율이 적절한가? 특정 교과에 치우친 요소가 있다면 그 영향을 분석
3. **통합 목표의 ABCD 완성도**: 수립된 목표가 Audience(대상)·Behavior(행동)·Condition(조건)·Degree(수준)를 얼마나 구체적으로 담고 있는가? 달성 가능성과 평가 가능성 측면 분석
4. **학습자 분석과 목표의 정합성**: 파악된 학습자 특성(선수지식, 오개념, 환경 제약)이 수업 목표와 실제로 연결되어 있는가? 가드레일로서의 실효성 평가
5. **설계 단계 진입 위험 요소**: 현재 분석 결과를 바탕으로 Ds 단계에서 예상되는 설계 실패 위험 요소(지나치게 광범위한 목표, 학습자 수준 과대평가, 교과 간 연결 고리 부재 등)를 구체적으로 진단`,

  Ds: `## 🔍 설계 단계 심층 분석

평가 계획, 문제상황, 학습활동, 지원도구, 스캐폴딩이 통합 수업의 실현 가능성을 갖추고 있는지 Backward Design 원칙과 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **Backward Design 충실도**: 평가 계획이 학습 목표를 진정으로 역방향으로 설계하고 있는가? 평가와 학습활동의 정렬 수준 분석
2. **문제상황의 진정성**: 설계된 문제상황이 학생들의 실제 삶과 연결되는가? A-2-3에서 파악한 학습자 맥락을 반영하고 있는가?
3. **학습활동 구조의 타당성**: 각 교과의 기능요소가 학습활동 안에서 실제로 구현될 수 있는가? 교과 융합이 활동 수준에서 실질적으로 이루어지는가?
4. **지원도구와 스캐폴딩의 적절성**: 학습자 수준(특히 취약 학생)을 고려한 지원 구조가 갖춰져 있는가? 점진적 독립을 지원하는 설계인가?
5. **개발·실행 단계 진입 위험 요소**: 자료 개발 부담, 교과 간 시간 조율, 평가 실행 가능성 등 DI 단계에서 예상되는 구체적 위험 진단`,

  DI: `## 🔍 개발·실행 단계 심층 분석

개발된 자료와 수업 기록이 설계 의도를 충실히 구현하고 있는지, 팀 협력의 실질적 효과가 드러났는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **설계-실행 정합성**: 실제 수업이 Ds 단계의 설계(문제상황·학습활동·평가)를 얼마나 충실히 구현했는가? 이탈이 발생했다면 그 원인과 의미는?
2. **교과 융합의 실제 구현**: 수업 현장에서 교과 간 연결이 학생들에게 실제로 경험되었는가? 융합의 질적 수준 분석
3. **학습자 반응과 설계 타당성 검증**: 수업 기록에서 드러난 학생 반응이 A-2-3 학습자 분석의 예측과 어떻게 일치/불일치했는가?
4. **팀 협력의 실질적 효과**: 개별 교사가 혼자 진행했을 때와 비교해 팀 협력이 수업의 어떤 측면을 실질적으로 개선했는가?`,

  E: `## 🔍 평가·성찰 단계 심층 분석

수업 성찰과 팀 성찰이 다음 주기의 개선으로 이어질 수 있는 깊이와 구체성을 갖추고 있는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **성찰의 깊이**: 수업 성찰이 표면적 관찰(잘됨/안됨)을 넘어 원인 분석과 이론적 해석까지 이르고 있는가?
2. **팀 학습의 증거**: 팀 성찰에서 개인 성장을 넘어 팀 전체의 집단 학습이 일어났다는 증거가 있는가?
3. **다음 주기 설계 함의**: 성찰 내용이 다음 T→A→Ds 주기에서 구체적으로 무엇을 바꿔야 하는지를 충분히 안내하고 있는가?
4. **T-CID 모델 성숙도**: 이번 주기를 통해 팀의 T-CID 실천 역량이 어떻게 성장했는가? 다음 주기에서 기대할 수 있는 발전 방향`,
}

// 산출물 content를 사람이 읽기 좋은 마크다운으로 변환
function renderArtifactContent(content: Record<string, unknown>): string {
  // 구조화 스키마 → 읽기 좋은 마크다운 변환
  if (content._schema === 'T-1-1') {
    const parts: string[] = []
    const pv = content.personalVisions as Array<{ teacherName: string; keywords: string[]; refinedVision: string }> | undefined
    if (pv?.length) parts.push('**개인 비전**\n\n| 교사명 | 키워드 | AI 정교화 비전 |\n| --- | --- | --- |\n' + pv.map(p => `| ${p.teacherName} 선생님 | ${p.keywords?.join(', ') || '-'} | ${p.refinedVision} |`).join('\n'))
    if (content.teamVision) parts.push(`**팀 공통 비전**\n\n${content.teamVision}`)
    const kw = content.coreKeywords as string[] | undefined
    if (kw?.length) parts.push(`**핵심 키워드**\n\n${kw.join(', ')}`)
    return parts.join('\n\n')
  }
  if (content._schema === 'T-1-2') {
    const dp = content.designPrinciples as Array<{ principle: string; rationale: string }> | undefined
    if (dp?.length) return '**설계 원칙**\n\n| 설계 원칙 | 근거 |\n| --- | --- |\n' + dp.map(d => `| ${d.principle} | ${d.rationale} |`).join('\n')
    return ''
  }
  if (content._schema === 'T-2-1') {
    const roles = content.roles as Array<{ teacherName: string; subject: string; strengths: string; role: string; responsibilities: string }> | undefined
    if (roles?.length) return '**역할 배분**\n\n| 교사명 | 담당 교과 | 강점·전문성 | 팀 내 역할 | 담당 업무 |\n| --- | --- | --- | --- | --- |\n' + roles.map(r => `| ${r.teacherName} | ${r.subject || '-'} | ${r.strengths || '-'} | ${r.role} | ${r.responsibilities} |`).join('\n')
    return ''
  }
  if (content._schema === 'T-2-2') {
    const rules = content.rules as Array<{ category: string; name: string; description: string; violation: string }> | undefined
    if (rules?.length) return '**팀 규칙**\n\n| 범주 | 규칙명 | 설명 | 위반 시 |\n| --- | --- | --- | --- |\n' + rules.map(r => `| ${r.category || '-'} | ${r.name} | ${r.description} | ${r.violation || '-'} |`).join('\n')
    return ''
  }
  if (content._schema === 'T-2-3') {
    const sched = content.schedule as Array<{ period: string; activity: string; deliverable: string; assignee: string }> | undefined
    if (sched?.length) return '**팀 일정**\n\n| 기간 | 활동 내용 | 마감·산출물 | 담당자 |\n| --- | --- | --- | --- |\n' + sched.map(s => `| ${s.period} | ${s.activity} | ${s.deliverable || '-'} | ${s.assignee || '-'} |`).join('\n')
    return ''
  }

  if (content._schema === 'A-1-2') {
    const parts: string[] = []
    const crit = content.criteria as Array<{ criterion: string; description: string; priority: string }> | undefined
    if (crit?.length) parts.push('**주제 선정 기준**\n\n| 기준 | 설명 | 우선순위 |\n| --- | --- | --- |\n' + crit.map(c => `| ${c.criterion} | ${c.description || '-'} | ${c.priority || '-'} |`).join('\n'))
    if (content.selectedTopic) parts.push(`**선정 주제**: ${content.selectedTopic}`)
    if (content.topicType) parts.push(`**주제 유형**: ${content.topicType}`)
    if (content.rationale) parts.push(`**선정 근거**: ${content.rationale}`)
    return parts.join('\n\n')
  }
  if (content._schema === 'A-2-1') {
    const rows = content.rows as Array<{ subject: string; coreIdea: string; knowledgeUnderstanding: string; processFunction: string; isCommon?: boolean }> | undefined
    if (rows?.length) return '**핵심아이디어 분석표**\n\n| 교과 | 핵심 아이디어 | 지식·이해 | 과정·기능 |\n| --- | --- | --- | --- |\n' + rows.map(r => `| ${r.isCommon ? '**' + (r.subject || '공통') + '**' : r.subject} | ${r.coreIdea} | ${r.knowledgeUnderstanding || '-'} | ${r.processFunction || '-'} |`).join('\n')
    return ''
  }
  if (content._schema === 'A-2-2') {
    const parts: string[] = []
    const sg = content.subjectGoals as Array<{ subject: string; goal: string }> | undefined
    if (sg?.length) parts.push('**교과별 세부 목표**\n\n| 교과 | 학습 목표 |\n| --- | --- |\n' + sg.map(g => `| ${g.subject} | ${g.goal} |`).join('\n'))
    const ig = content.integratedGoals as string[] | undefined
    if (ig?.length) parts.push('**통합 학습목표**\n\n' + ig.map((g, i) => `${i + 1}. ${g}`).join('\n'))
    return parts.join('\n\n')
  }
  if (content._schema === 'A-2-3') {
    const parts: string[] = []
    const cp = content.commonProfile as Array<{ item: string; content: string }> | undefined
    if (cp?.length) parts.push('**학습자 프로필**\n\n| 항목 | 내용 |\n| --- | --- |\n' + cp.map(p => `| ${p.item} | ${p.content} |`).join('\n'))
    const tn = content.teacherNotes as Array<{ teacherName: string; note: string }> | undefined
    if (tn?.length) parts.push('**교사별 맞춤 포인트**\n\n' + tn.map(t => `- **${t.teacherName}**: ${t.note}`).join('\n'))
    return parts.join('\n\n')
  }

  // 비구조화(레거시) 산출물
  return Object.entries(content)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== '_schema' && k !== '_schemaVersion')
    .map(([k, v]) => {
      if (typeof v === 'string') {
        return `**${k}**\n\n${v.trim()}`
      }
      if (Array.isArray(v)) {
        const items = (v as unknown[]).map(i => `- ${typeof i === 'object' ? JSON.stringify(i) : i}`).join('\n')
        return `**${k}**\n\n${items}`
      }
      if (typeof v === 'object') {
        return `**${k}**\n\n${JSON.stringify(v, null, 2)}`
      }
      return `**${k}**: ${v}`
    })
    .join('\n\n')
}

function buildAnalysisPrompt(
  stage: StageCode,
  project: { title: string; targetGradeGroup: string; targetSubjects?: string[] },
  artifacts: Record<string, { title: string; content: Record<string, unknown> }>,
): string {
  const stageInfo = STAGES.find(s => s.code === stage)!
  const deepAnalysisGuide = STAGE_DEEP_ANALYSIS[stage]

  // 각 활동별 산출물 원문 + 분석 지시 블록 (산출물 원문은 정적으로 삽입)
  const activityBlocks = stageInfo.activities.map(code => {
    const meta = ACTIVITY_META[code]
    const art = artifacts[code]

    const contentBlock = art
      ? renderArtifactContent(art.content)
      : '*산출물이 아직 작성되지 않았습니다.*'

    return `### ${meta.label} (${code})

#### 📄 산출물 원문

${contentBlock}

#### 🔍 분석 및 인사이트

(위 산출물 원문을 교육과정 설계 전문가 관점에서 3~5문장으로 분석. 팀의 결정이 갖는 의미, 강점, 개선 지점을 구체적으로 해석. "~를 선택한 것은 ~를 의미한다", "~라는 결정에서 주목할 점은 ~이다" 형식 사용)

> (이 활동에서 가장 주목할 결정·내용을 전문가 시각으로 압축한 한 문장)`
  }).join('\n\n---\n\n')

  return `당신은 T-CID(팀 협력 수업설계) 모델 전문가이자 교육과정 설계 분석가입니다.

**보고서 작성 원칙**:
- 보고서는 반드시 **산출물 원문 그대로 + 전문가 분석** 두 파트로 구성됩니다.
- 산출물 원문은 이미 아래 각 활동 블록에 삽입되어 있습니다. 절대 요약하거나 생략하지 마세요. 그대로 출력에 포함하세요.
- 분석은 산출물을 읽은 뒤 교육 전문가가 덧붙이는 해석·인사이트여야 합니다. 단순 재서술 금지.
- 각 분석 섹션은 최소 3문장 이상. 팀이 미처 인식 못한 구조적 문제나 기회를 짚어주세요.
- 마크다운 표가 있으면 표 형식 유지.

**마크다운 규칙**:
- 섹션: ## 헤더, 소섹션: ### / #### 헤더
- 핵심 인용·압축: > blockquote
- 강조 키워드: **bold** (남용 금지)
- 준비도 평가: 반드시 table 형식

---

## 프로젝트 정보
- **제목**: ${project.title}
- **대상**: ${project.targetGradeGroup}
- **교과**: ${project.targetSubjects?.join(', ') ?? '미지정'}
- **분석 단계**: ${STAGE_LABELS[stage]}(${stage})

---

아래 구조를 그대로 사용해 보고서를 완성하세요. #### 📄 산출물 원문 블록의 내용은 수정 없이 그대로 출력하고, #### 🔍 분석 및 인사이트 블록만 채워 넣으세요:

# ${project.title} · ${STAGE_LABELS[stage]}(${stage}) 단계 분석 보고서

## 🎯 이 단계 핵심 요약

(이 팀이 이 단계에서 만들어낸 것을 4~6문장으로 서술. 단순 나열 아닌 팀의 설계 철학·방향성이 드러나도록. 다른 팀과 어떻게 다른지 알 수 있어야 함)

> (이 팀의 이 단계를 대표하는 핵심 결정을 한 문장으로 압축)

---

## 📋 활동별 산출물 및 분석

${activityBlocks}

---

${deepAnalysisGuide}

---

## ✅ 설계 강점 (산출물 근거 기반)

(각 강점은 위 산출물의 구체적 내용을 근거로 제시. 3가지, 각 3~4문장)

- **[강점 1 키워드]**: 구체적 근거 + T-CID 관점 해석
- **[강점 2 키워드]**: 구체적 근거 + 해석
- **[강점 3 키워드]**: 구체적 근거 + 해석

---

## ⚠️ 다음 단계 진입 전 점검 사항

(이 팀의 실제 산출물에서 발견된 구체적 위험·공백. 3가지, 각 3~4문장)

- **[점검 1]**: 무엇이 문제이고, 왜 중요하며, 어떻게 보완할 수 있는지
- **[점검 2]**: 동일 형식
- **[점검 3]**: 동일 형식

---

## 💡 전문가 인사이트

(팀이 미처 인식 못했을 수 있는 구조적 통찰 2~3가지. 4~6문장씩)

---

## 📊 단계 완성도 평가

| 평가 항목 | 점수 (5점) | 근거 |
|-----------|-----------|------|
| 산출물 완성도 | ? | |
| 교과 융합 깊이 | ? | |
| 학습자 중심성 | ? | |
| 다음 단계 준비도 | ? | |
| 팀 협력 수준 | ? | |

> **종합**: (이 팀의 이 단계를 한 문장으로 압축하는 전문가 총평. 격려가 아닌 정확한 진단)

---
*T-CID 협력 수업설계 모델 기반 분석 보고서*`
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
            max_tokens: 8000,
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

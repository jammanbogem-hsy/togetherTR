import Anthropic from '@anthropic-ai/sdk'
import { resolveClaudeModel } from '@/lib/llm/anthropic'
import { ACTIVITY_META, displayActivityCode } from '@/types'
import type { ActivityCode } from '@/types'
import { displayArtifactContent, isInternalArtifactKey } from '@/lib/artifacts/internalKeys'

export const runtime = 'nodejs'
export const maxDuration = 300

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// DI-1-1 이전까지의 활동 순서
const REPORT_ACTIVITIES: ActivityCode[] = [
  'T-1-1', 'T-1-2', 'T-2-1', 'T-2-2', 'T-2-3',
  'A-1-1', 'A-1-2', 'A-2-1', 'A-2-2', 'A-2-3',
  'Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2',
  'DI-1-1',
]

const STAGE_LABELS: Record<string, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행',
}

const STAGE_DESCRIPTIONS: Record<string, string> = {
  T: '팀 비전·역할·규칙·일정 수립',
  A: '주제 선정·성취기준 분석·통합 목표·학습자 분석',
  Ds: '평가 계획·문제상황·학습활동·지원도구·스캐폴딩 설계',
  DI: '개발 자료 목록 수립',
}

function reportTableCell(value?: string): string {
  const cleaned = (value || '-')
    .replace(/&(?:#124|124);/g, ' / ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s*\|\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || '-'
}

function renderArtifactContent(content: Record<string, unknown>): string {
  if (content._schema === 'A-2-1' && Array.isArray(content.rows)) {
    const rows = content.rows as Array<{
      subject?: string
      coreIdea?: string
      standard?: string
      knowledgeUnderstanding?: string
      processFunction?: string
      agentLessonExample?: string
      description?: string
    }>
    const table = [
      '| 교과 | 핵심 아이디어 | 성취기준 | 지식·이해 | 과정·기능 | Agent 추천 수업아이디어 | 수업내용 설명 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map(row => `| ${[
        row.subject,
        row.coreIdea,
        row.standard,
        row.knowledgeUnderstanding,
        row.processFunction,
        row.agentLessonExample,
        row.description,
      ].map(reportTableCell).join(' | ')} |`),
    ].join('\n')
    const hasRowAgentIdeas = rows.some(row => row.agentLessonExample?.trim())
    const agentLessonIdeas = !hasRowAgentIdeas && typeof content.agentLessonIdeas === 'string' && content.agentLessonIdeas.trim()
      ? `\n\n**Agent 추천 수업아이디어**\n\n${content.agentLessonIdeas.trim()}`
      : ''
    return `**성취기준분석표**\n\n${table}${agentLessonIdeas}`
  }

  return Object.entries(content)
    .filter(([k, v]) => !isInternalArtifactKey(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      if (typeof v === 'string') return `**${k}**\n\n${v.trim()}`
      if (Array.isArray(v)) {
        const items = (v as unknown[]).map(i => `- ${typeof i === 'object' ? JSON.stringify(i) : i}`).join('\n')
        return `**${k}**\n\n${items}`
      }
      if (typeof v === 'object') return `**${k}**\n\n${JSON.stringify(v, null, 2)}`
      return `**${k}**: ${v}`
    })
    .join('\n\n')
}

function buildCumulativeReportPrompt(
  project: { title: string; targetGradeGroup: string; targetSubjects?: string[] },
  artifacts: Record<string, { title: string; content: Record<string, unknown> }>,
): string {
  // 단계별로 활동 블록 그룹핑
  const stageGroups = ['T', 'A', 'Ds', 'DI'] as const
  const stageBlocks = stageGroups.map(stage => {
    const stageActivities = REPORT_ACTIVITIES.filter(code => {
      const meta = ACTIVITY_META[code]
      return meta?.stage === stage
    })
    if (stageActivities.length === 0) return null

    const activityBlocks = stageActivities.map(code => {
      const meta = ACTIVITY_META[code]
      const art = artifacts[code]
      const contentBlock = art && Object.keys(art.content ?? {}).length > 0
        ? renderArtifactContent(displayArtifactContent(art.content, code).content)
        : '*산출물 없음*'

      return `#### ${meta?.label ?? code} (${displayActivityCode(code)})\n\n${contentBlock}`
    }).join('\n\n---\n\n')

    return `### ${STAGE_LABELS[stage]}(${stage}) 단계 — ${STAGE_DESCRIPTIONS[stage]}\n\n${activityBlocks}`
  }).filter(Boolean).join('\n\n====\n\n')

  return `당신은 T-CID(팀 협력 수업설계) 모델 전문가이자 현장 교사의 성장을 돕는 교육과정 코치입니다.

아래는 한 교사팀의 T(팀준비) → A(분석) → Ds(설계) → DI-1(자료 탐색·개발)까지의 산출물 전체입니다.
이 모든 산출물을 바탕으로 **종합 설계 보고서**를 작성하세요.

**보고서 작성 원칙**:
1. 산출물 원문은 각 활동 섹션에 그대로 포함 (요약·생략 절대 금지)
2. 각 활동마다 AI 피드백 추가 — **격려+코칭 혼합 구조**로 작성:
   - **형식**: 문단+개조식 혼합 (단순 장문 나열 금지)
     * 첫 문장: 이 팀이 이 활동에서 핵심적으로 잘 해낸 것을 1문장으로 압축 인정
     * 이후 2~4개 개조식 항목 (- **핵심어**: 구체적 내용) — 강점과 발전 방향을 교차 배치
     * 마지막 1문장: 앞으로 나아갈 방향을 따뜻하게 제안
   - 어조: 평가가 아닌 코칭 ("~을 잘 실현했습니다", "~을 함께 고려해볼 수 있습니다")
   - 단순 재서술 금지 — 팀이 미처 인식 못한 강점이나 발전 가능성만 짚기
3. 단계 간 연계성 분석 — 잘 연결된 부분을 먼저 충분히 인정하고, 보완할 수 있는 연결점을 제안
4. 전체 종합 인사이트 — 이 팀이 만들어낸 고유한 가치와 앞으로의 성장 방향 중심
5. 각 피드백 섹션 최소 4문장 이상
6. 마크다운 표가 있으면 표 형식 그대로 유지
7. 전문가 총평: 점수 숫자보다 이 팀의 설계가 지닌 가능성과 다음 단계 성장 방향을 서술 중심으로

---

## 프로젝트 정보
- **제목**: ${project.title}
- **대상**: ${project.targetGradeGroup}
- **교과**: ${project.targetSubjects?.join(', ') ?? '미지정'}

---

## 산출물 전체

${stageBlocks}

---

위 산출물을 바탕으로 아래 구조로 보고서를 작성하세요:

# ${project.title}
## T-CID 협력 수업설계 종합 보고서 (팀준비 → 분석 → 설계 → 자료 개발)

---

## 🎯 프로젝트 개요 및 설계 철학

(이 팀이 만들어낸 수업 프로젝트를 처음 접하는 사람도 이해할 수 있도록 6~8문장으로 소개. 단순 나열이 아닌, 이 팀의 설계 철학과 지향점이 드러나야 함)

> (이 수업 설계를 대표하는 핵심 문장 한 줄)

---

## 📋 팀준비(T) 단계

### T-1 공동 비전 설정

#### 📄 산출물

(T-1 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀의 비전 문장이 담고 있는 교육적 가치와 팀 합의의 의미를 먼저 인정하기. 비전이 가진 구체성과 공유 가능성의 강점, 이 비전이 A·Ds 단계에서 어떤 든든한 방향타로 작동할 수 있는지. 더 풍성해질 수 있다면 어떤 요소를 함께 살펴볼 수 있는지 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

> (T-1에서 가장 주목할 결정을 한 문장으로)

---

### T-2 수업설계 방향 설정

#### 📄 산출물

(T-2 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 선택한 교수학습 방향들의 조합이 만들어내는 시너지와 그 교육적 의미를 먼저 인정하기. 비전과의 연결 강도, 이 방향이 Ds 단계 설계에서 어떻게 아름답게 구현될 수 있는지. 더 선명해질 수 있다면 어떤 부분을 함께 점검해볼 수 있는지 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

> (T-2에서 가장 주목할 결정을 한 문장으로)

---

### T-3 역할 배분

#### 📄 산출물

(T-3 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀의 역할 배분이 각 교사의 강점을 어떻게 살리고 있는지 먼저 인정하기. 이 협력 구조가 T-CID에서 가져올 시너지, 함께하기에 든든한 부분. 앞으로 실행 과정에서 서로 챙겨줄 수 있는 부분이 있다면 어떤 것인지 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

---

### T-4 팀 규칙

#### 📄 산출물

(T-4 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 만든 규칙들이 팀 신뢰와 협력의 기반으로 어떻게 작동할 수 있는지 인정하기. 구체적이고 실효성 있는 부분들의 가치. 실행 과정에서 이 규칙들이 더 빛날 수 있도록 함께 생각해볼 수 있는 보완 지점 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

---

### T-5 팀 일정

#### 📄 산출물

(T-5 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 세운 일정의 현실적인 흐름과 단계별 완료 목표의 균형감을 인정하기. 계획적으로 접근한 것의 가치. 실행하면서 팀이 함께 유연하게 조정해볼 수 있는 지점이 있다면 어떤 것인지 — 형식: 첫 문장+개조식 2항+마지막 문장)

---

## 📋 분석(A) 단계

### A-1 주제 선정 기준

#### 📄 산출물

(A-1 산출물 원문 그대로 — 산출물이 없으면(건너뛴 팀) 이 절 전체를 생략)

#### 🔍 AI 분석

(주제를 고르기 전에 기준부터 합의한 접근이 팀 비전과 어떻게 맞닿는지, 이 기준이 이후 주제 선정에 어떻게 작동했는지 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

> (A-1에서 가장 주목할 결정을 한 문장으로)

---

### A-2 주제 선정

#### 📄 산출물

(A-2 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 선정한 주제가 지닌 실제성과 학생 삶과의 연결 강점을 먼저 인정하기. 교과 융합의 잠재력과 T-1 비전과의 연결고리. 이 주제로 아이들이 어떤 의미 있는 경험을 하게 될지. 더 선명히 할 수 있다면 어떤 방향인지 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

> (A-2에서 가장 주목할 결정을 한 문장으로)

---

### A-3 성취기준 재구조화

#### 📄 산출물

(A-3 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 선정한 성취기준들이 교과 융합의 가능성을 어떻게 열어두고 있는지 인정하기. 내용·기능·가치 차원에서 균형 있게 접근한 부분. 이 성취기준 조합이 Ds 단계에서 어떤 풍성한 설계 기회를 만들어주는지. 더 깊은 융합을 위해 함께 살펴볼 수 있는 부분 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

> (A-3에서 가장 주목할 결정을 한 문장으로)

---

### A-4 통합 수업목표

#### 📄 산출물

(A-4 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀의 통합 수업목표가 담고 있는 학습자 중심의 교육적 지향을 먼저 인정하기. 교과별 세부 목표와의 연결 구조에서 잘 된 부분. Backward Design 관점에서 이 목표가 Ds-1 평가 설계로 이어질 때의 가능성. 목표를 더 선명히 할 수 있다면 어떤 방향인지 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

> (A-4에서 가장 주목할 결정을 한 문장으로)

---

### A-5 학습자·맥락 분석

#### 📄 산출물

(A-5 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 학습자를 얼마나 구체적으로 이해하고 설계에 반영했는지 인정하기. 파악된 학습자 특성이 Ds 단계 설계의 든든한 토대가 되는 부분. Ds-5 스캐폴딩과의 연결 가능성. 학습자를 더 깊이 품을 수 있다면 어떤 부분을 함께 살펴볼 수 있는지 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

---

## 📋 설계(Ds) 단계

### Ds-1 평가 설계

#### 📄 산출물

(Ds-1 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 만든 평가 계획이 Backward Design의 정신을 어떻게 구현하고 있는지 인정하기. 루브릭의 구체성과 학생 안내 기능에서의 강점. A-4 통합 목표와의 연결에서 잘 된 부분. 평가가 더 학습자 성장 도구로 기능하도록 함께 살펴볼 수 있는 방향 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

> (Ds-1에서 가장 주목할 결정을 한 문장으로)

---

### Ds-2 문제 상황 설정

#### 📄 산출물

(Ds-2 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 만든 문제상황의 실제성과 학생 삶과의 연결이 얼마나 생생한지 인정하기. 탐구 질문이 단원 전체를 이끌어가는 힘. 학생들이 이 문제상황을 만났을 때 어떤 설렘을 느낄 수 있는지. 더 깊은 실제성을 위해 함께 고민해볼 수 있는 부분 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

> (Ds-2에서 가장 주목할 결정을 한 문장으로)

---

### Ds-3 학습활동 설계

#### 📄 산출물

(Ds-3 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 설계한 학습활동의 흐름이 학생의 성장 여정을 어떻게 그리고 있는지 인정하기. WHERETO 원칙이 구현된 부분과 차시 배분의 균형감. A-5 학습자 분석이 활동 설계에 살아있는 흔적. 교과 간 대화가 더 풍성해질 수 있다면 어떤 방향인지 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

> (Ds-3에서 가장 주목할 결정을 한 문장으로)

---

### Ds-4 자료와 도구 연결

#### 📄 산출물

(Ds-4 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 선정한 도구들이 학습 경험을 어떻게 풍부하게 할 수 있는지 인정하기. 도구 선정의 의도와 학습 목표와의 연결. 학생들이 도구를 통해 어떤 가능성을 열어갈 수 있는지. 실행 과정에서 학생 경험을 중심에 두고 함께 점검해볼 수 있는 부분 — 형식: 첫 문장+개조식 2~3항+마지막 문장)

---

### Ds-5 스캐폴딩 설계

#### 📄 산출물

(Ds-5 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 설계한 스캐폴딩이 GRR 원칙을 어떻게 살리고 있는지, 학습자를 배려한 섬세함을 인정하기. 다양한 학습자를 품으려는 노력과 그 가치. 스캐폴딩이 학생 자율성으로 이어지는 흐름. 더 촘촘한 지원을 위해 함께 살펴볼 수 있는 방향 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

> (Ds-5에서 가장 주목할 결정을 한 문장으로)

---

## 📋 개발·실행(DI) 단계

### DI-1 자료 탐색·개발

#### 📄 산출물

(DI-1 산출물 원문 그대로)

#### 🔍 AI 분석

(이 팀이 설계를 자료로 구체화하기 위해 얼마나 체계적으로 준비했는지 인정하기. 우선순위 배분과 담당자 분배에서 팀 협력의 흔적. Ds 단계 설계를 구현하는 자료들의 연결. 개발 과정을 더 든든하게 하기 위해 함께 살펴볼 수 있는 부분 — 형식: 첫 문장+개조식 2~4항+마지막 문장)

---

## 🔗 단계 간 연계성 분석

(T→A→Ds→DI-1의 흐름이 만들어내는 하나의 설계 여정을 먼저 그려주기. 각 단계 산출물이 다음 단계의 기반이 되어 쌓아온 것들의 가치를 충분히 인정하기. 이 팀의 설계 여정에서 빛나는 연결 지점들. 앞으로 더 단단한 연결을 위해 함께 살펴볼 수 있는 부분 — 형식: 첫 문장+개조식 3~5항+마지막 문장)

> (이 팀의 전체 설계 여정을 한 문장으로 압축)

---

## ✅ 전체 설계 강점 (Top 3)

(각 강점은 반드시 위 산출물의 구체적 섹션·내용을 근거로 제시. 이 팀이 이 강점을 만들어내기까지의 과정과 그것이 수업에서 어떤 의미를 갖는지)

- **[강점 1 키워드]**: 어느 활동의 어떤 내용이 이 강점을 보여주는지 + T-CID 관점 해석 + 이 강점이 실제 수업에서 어떤 아름다운 장면을 만들어낼 수 있는지 (3~4문장)
- **[강점 2 키워드]**: 동일 형식 (3~4문장)
- **[강점 3 키워드]**: 동일 형식 (3~4문장)

---

## 💡 함께 다듬으면 더 빛날 부분 (Top 3)

(이 팀의 산출물에서 조금만 더 다듬으면 훨씬 강해질 수 있는 부분들. "문제"가 아닌 "성장의 기회"로 제시. 해결 방향을 함께 제안)

- **[성장 포인트 1]**: 어떤 부분이고, 왜 중요하며, 어떻게 함께 발전시킬 수 있는지 — "이미 ~을 잘 하고 있기 때문에, ~도 함께 고려하면 더욱 ~해질 것입니다" 형식 (3~4문장)
- **[성장 포인트 2]**: 동일 형식 (3~4문장)
- **[성장 포인트 3]**: 동일 형식 (3~4문장)

---

## 💡 전문가 종합 인사이트

(이 팀의 전체 설계를 관통하는 고유한 통찰 3가지. 팀이 만들어낸 것의 의미와 가능성, 이 팀이 가진 고유한 강점 패턴, 앞으로의 여정에서 빛날 수 있는 방향. 각 인사이트 5~7문장)

### 인사이트 1: [제목]
(내용)

### 인사이트 2: [제목]
(내용)

### 인사이트 3: [제목]
(내용)

---

## 📊 종합 설계 완성도 평가

| 설계 영역 | 이 팀이 잘 한 것 | 함께 성장할 수 있는 방향 |
|-----------|----------------|------------------------|
| 비전-목표 연결 | (강점 서술) | (코칭 방향) |
| 교과 융합 설계 | (강점 서술) | (코칭 방향) |
| Backward Design | (강점 서술) | (코칭 방향) |
| 학습자 이해 | (강점 서술) | (코칭 방향) |
| 실행 준비도 | (강점 서술) | (코칭 방향) |

> **코치의 말**: (이 팀이 여기까지 만들어온 것에 대한 진심 어린 인정 + 수업이 아이들에게 어떤 선물이 될 수 있을지 + 앞으로의 DI 단계를 응원하는 격려 2~3문장)

---

## 🚀 다음 단계 함께 준비하기

**개발 우선순위** (DI-1 목록 기준)
- [ ] (가장 먼저 만들면 다른 자료들이 더 쉬워지는 핵심 자료 2~3가지와 그 이유)

**수업 전 팀 점검**
- [ ] (팀이 함께 확인하면 더 든든해질 사항 2~3가지)
- [ ] (수업 당일 서로 챙겨줄 수 있는 사항 1~2가지)

---

*T-CID 협력 수업설계 모델 기반 종합 분석 보고서*`
}

export async function POST(request: Request) {
  try {
    const { project, artifacts } = await request.json() as {
      project: { title: string; targetGradeGroup: string; targetSubjects?: string[] }
      artifacts: Record<string, { title: string; content: Record<string, unknown> }>
    }

    const prompt = buildCumulativeReportPrompt(project, artifacts)
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await client.messages.create({
            model: resolveClaudeModel('analysis'),
            max_tokens: 32000,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
          })

          for await (const event of response) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`))
            }
            if (event.type === 'message_stop') {
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
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
}

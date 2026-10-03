// 단계 분석 보고서 생성 프롬프트 — analyze/stage 라우트가 쓴다(라우트는 OpenAI 클라이언트를 만들므로 테스트용으로 분리).
import type { StageCode } from '@/types'
import { STAGES, ACTIVITY_META, displayActivityCode } from '@/types'
import { serializeArtifactForPrompt } from '@/lib/artifacts/serializeArtifactForPrompt'
import { artifactPlaceholder } from './artifactPlaceholders'
import { normalizeArtifactText } from './artifactToMarkdown'
import { REPORT_SECTIONS, reportSectionsFor } from './reportSections'

const STAGE_LABELS: Record<StageCode, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

// 단계별 심층 분석 섹션 정의
const STAGE_DEEP_ANALYSIS: Record<StageCode, string> = {
  T: `## 팀 역학 심층 분석

팀의 역할 분배, 공통 비전, 운영 규칙이 실제로 협력 수업설계를 지탱할 수 있는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **비전 정합성**: 팀이 수립한 비전이 교과 융합 수업설계의 방향성으로 충분한가? 구체성과 공유 가능성 측면에서 분석
2. **역할 설계의 적절성**: 각 교사의 역할이 T-CID 협력 모델에서 요구하는 역할(교과 전문가·코디네이터·성찰자)과 어떻게 연결되는가?
3. **팀 규칙의 실효성**: 수립된 규칙이 Ds·DI 단계의 갈등 상황에서 실제로 작동할 수 있는 구체성을 갖추고 있는가?
4. **잠재적 긴장 요소**: 역할 경계 불명확, 의사결정 구조 미비, 일정 충돌 가능성 등 향후 단계에서 문제가 될 수 있는 요소 진단`,

  A: `## 분석 단계 심층 분석

성취기준 선택, 내용·기능요소 추출, 통합 목표 수립, 학습자 분석이 설계(Ds) 단계의 견고한 토대가 될 수 있는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **교과 통합의 깊이**: 선택된 성취기준들이 단순 병렬 나열인가, 아니면 공통 개념·기능을 중심으로 진정한 융합 가능성을 보이는가? 교과 간 연결의 강도와 취약점을 분석
2. **내용·기능요소의 균형**: 내용요소(지식)와 기능요소(과정)의 비율이 적절한가? 특정 교과에 치우친 요소가 있다면 그 영향을 분석
3. **통합 목표의 ABCD 완성도**: 수립된 목표가 Audience(대상)·Behavior(행동)·Condition(조건)·Degree(수준)를 얼마나 구체적으로 담고 있는가? 달성 가능성과 평가 가능성 측면 분석
4. **학습자 분석과 목표의 정합성**: 파악된 학습자 특성(선수지식, 오개념, 환경 제약)이 수업 목표와 실제로 연결되어 있는가? 가드레일로서의 실효성 평가
5. **설계 단계 진입 위험 요소**: 현재 분석 결과를 바탕으로 Ds 단계에서 예상되는 설계 실패 위험 요소(지나치게 광범위한 목표, 학습자 수준 과대평가, 교과 간 연결 고리 부재 등)를 구체적으로 진단`,

  Ds: `## 설계 단계 심층 분석

평가 계획, 문제상황, 학습활동, 지원도구, 스캐폴딩이 통합 수업의 실현 가능성을 갖추고 있는지 Backward Design 원칙과 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **Backward Design 충실도**: 평가 계획이 학습 목표를 진정으로 역방향으로 설계하고 있는가? 평가와 학습활동의 정렬 수준 분석
2. **문제상황의 진정성**: 설계된 문제상황이 학생들의 실제 삶과 연결되는가? 학습자·맥락 분석(A-5)에서 파악한 학습자 맥락을 반영하고 있는가?
3. **학습활동 구조의 타당성**: 각 교과의 기능요소가 학습활동 안에서 실제로 구현될 수 있는가? 교과 융합이 활동 수준에서 실질적으로 이루어지는가?
4. **지원도구와 스캐폴딩의 적절성**: 학습자 수준(특히 취약 학생)을 고려한 지원 구조가 갖춰져 있는가? 점진적 독립을 지원하는 설계인가?
5. **개발·실행 단계 진입 위험 요소**: 자료 개발 부담, 교과 간 시간 조율, 평가 실행 가능성 등 DI 단계에서 예상되는 구체적 위험 진단`,

  DI: `## 개발·실행 단계 심층 분석

개발된 자료와 수업 기록이 설계 의도를 충실히 구현하고 있는지, 팀 협력의 실질적 효과가 드러났는지 T-CID 관점에서 심층 분석한다.

### 분석 포인트 (각 항목 3~5문장):
1. **설계-실행 정합성**: 실제 수업이 Ds 단계의 설계(문제상황·학습활동·평가)를 얼마나 충실히 구현했는가? 이탈이 발생했다면 그 원인과 의미는?
2. **교과 융합의 실제 구현**: 수업 현장에서 교과 간 연결이 학생들에게 실제로 경험되었는가? 융합의 질적 수준 분석
3. **학습자 반응과 설계 타당성 검증**: 수업 기록에서 드러난 학생 반응이 학습자·맥락 분석(A-5)의 예측과 어떻게 일치/불일치했는가?
4. **팀 협력의 실질적 효과**: 개별 교사가 혼자 진행했을 때와 비교해 팀 협력이 수업의 어떤 측면을 실질적으로 개선했는가?`,

  E: `## 평가·성찰 단계 심층 분석

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
    const roles = content.roles as Array<{ teacherName: string; subject: string; strengths: string; role: string; responsibilities: string; deadline?: string }> | undefined
    if (roles?.length) return '**역할 배분**\n\n| 교사명 | 담당 교과 | 강점·전문성 | 팀 내 역할 | 담당 업무 | 완료 시점 |\n| --- | --- | --- | --- | --- | --- |\n' + roles.map(r => `| ${r.teacherName} | ${r.subject || '-'} | ${r.strengths || '-'} | ${r.role} | ${r.responsibilities} | ${r.deadline || '-'} |`).join('\n')
    return ''
  }
  if (content._schema === 'T-2-2') {
    const rules = content.rules as Array<{ category: string; name: string; description: string; feasibility?: string; violation?: string }> | undefined
    if (rules?.length) return '**팀 규칙**\n\n| 범주 | 규칙명 | 설명 | 실천 방법 |\n| --- | --- | --- | --- |\n' + rules.map(r => `| ${r.category || '-'} | ${r.name} | ${r.description} | ${r.feasibility || r.violation || '-'} |`).join('\n')
    return ''
  }
  if (content._schema === 'T-2-3') {
    const sched = content.schedule as Array<{ period: string; activity: string; content?: string; deliverable?: string; assignee: string }> | undefined
    if (sched?.length) return '**팀 일정**\n\n| 기간 | 활동 | 내용 | 담당자 |\n| --- | --- | --- | --- |\n' + sched.map(s => `| ${s.period} | ${s.activity} | ${s.content || s.deliverable || '-'} | ${s.assignee || '-'} |`).join('\n')
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
    const parts: string[] = []
    const rows = content.rows as Array<{ subject: string; standard?: string; coreIdea: string; knowledgeUnderstanding: string; processFunction: string; valueAttitude?: string; contribution?: string; isCommon?: boolean }> | undefined
    if (rows?.length) parts.push('**주제의 상세 내용 분석표**\n\n| 교과 | 성취기준·핵심 아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 공통·고유 기여 |\n| --- | --- | --- | --- | --- | --- |\n' + rows.map(r => `| ${r.subject} | ${[r.standard, r.coreIdea].filter(Boolean).join(' / ') || '-'} | ${r.knowledgeUnderstanding || '-'} | ${r.processFunction || '-'} | ${r.valueAttitude || '-'} | ${r.contribution || (r.isCommon ? '공통 요소' : '교과 고유 요소')} |`).join('\n'))
    if (content.commonElements) parts.push(`**공통 요소**\n\n${content.commonElements}`)
    if (content.reconstructedStandard) parts.push(`**재구성 성취기준**\n\n${content.reconstructedStandard}`)
    return parts.join('\n\n')
  }
  if (content._schema === 'A-2-2') {
    const parts: string[] = []
    const cci = (content.commonCoreIdea as string | undefined)?.trim()
    if (cci) parts.push(`**공통 핵심 아이디어**\n\n${cci}`)
    const inquiryQuestion = (content.inquiryQuestion as string | undefined)?.trim()
    if (inquiryQuestion) parts.push(`**탐구 질문**\n\n${inquiryQuestion}`)
    // 신규 single-string 형식과 레거시 array 형식 모두 수용
    const integratedSingle = (content.integratedGoal as string | undefined)?.trim()
    const integratedLegacy = content.integratedGoals as string[] | undefined
    if (integratedSingle) {
      parts.push(`**통합 수업목표**\n\n${integratedSingle}`)
    } else if (integratedLegacy?.length) {
      parts.push('**통합 학습목표**\n\n' + integratedLegacy.map((g, i) => `${i + 1}. ${g}`).join('\n'))
    }
    const kws = content.convergentKeywords as string[] | undefined
    if (kws?.length) parts.push(`**핵심 키워드**\n\n${kws.join(', ')}`)
    const sg = content.subjectGoals as Array<{ subject: string; goal: string }> | undefined
    if (sg?.length) parts.push('**교과별 수업목표**\n\n| 교과 | 수업목표 |\n| --- | --- |\n' + sg.map(g => `| ${g.subject} | ${g.goal} |`).join('\n'))
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

  // 비구조화(레거시) 산출물 — 문자열은 그대로, 표 행 배열은 마크다운 표로, 그 밖의 객체는 serializeArtifactForPrompt 로 읽기 좋게 푼다.
  // (예전에는 JSON.stringify 원문이 그대로 보고서·AI 입력에 들어갔다)
  return Object.entries(content)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && !k.startsWith('_') && !HIDDEN_KEYS.has(k))
    .map(([k, v]) => {
      if (typeof v === 'string') return `**${k}**\n\n${v.trim()}`
      if (Array.isArray(v) && v.some(isRecord)) {
        const table = recordsToMarkdownTable(v.filter(isRecord))
        return table ? `**${k}**\n\n${table}` : ''
      }
      if (Array.isArray(v)) {
        const items = v.map(item => serializeArtifactForPrompt(item).trim()).filter(Boolean).map(item => `- ${item}`).join('\n')
        return items ? `**${k}**\n\n${items}` : ''
      }
      if (typeof v === 'object') {
        const text = serializeArtifactForPrompt(v).trim()
        return text ? `**${k}**\n\n${text}` : ''
      }
      return `**${k}**: ${v}`
    })
    .filter(Boolean)
    .join('\n\n')
}

/** 공동 편집 원본 등 보고서에 원문으로 싣지 않는 내부 키 */
const HIDDEN_KEYS = new Set(['manualWorkspace'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const tableCell = (value: unknown) => serializeArtifactForPrompt(value).replace(/\s*\n\s*/g, ' / ').replace(/\|/g, '\\|').trim() || '-'

/** 객체 행 배열 → 마크다운 표(내부 '_' 키 제외, 셀 안 줄바꿈은 ' / '). */
export function recordsToMarkdownTable(rows: readonly Record<string, unknown>[]): string {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('_'))))]
  if (!keys.length) return ''
  return [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${keys.map(key => tableCell(row[key])).join(' | ')} |`),
  ].join('\n')
}

/** 활동 코드별 산출물 원문 마크다운 — 스트림의 {{ARTIFACT:코드}} 자리에 들어간다. */
export function buildArtifactOriginals(
  stage: StageCode,
  artifacts: Record<string, { content?: Record<string, unknown> | null } | undefined>,
): Record<string, string> {
  const stageInfo = STAGES.find(s => s.code === stage)
  return Object.fromEntries((stageInfo?.activities ?? []).map(code => {
    const content = artifacts[code]?.content
    // 굵은 라벨 문단·성취기준 줄·여러 줄 문단을 표·목록으로 정규화한다(보고서·PDF·MD 내보내기 공통).
    const text = content ? normalizeArtifactText(renderArtifactContent(content)) : ''
    return [code, text || '*산출물이 아직 작성되지 않았습니다.*']
  }))
}

/** 한눈에 보기 표 — 활동별 산출물 유무와 항목 수를 코드로 센다(AI 가 지어내지 않게). */
export function buildOverviewTable(
  stage: StageCode,
  artifacts: Record<string, { content?: Record<string, unknown> | null; status?: string } | undefined>,
): string {
  const stageInfo = STAGES.find(s => s.code === stage)
  const rows = (stageInfo?.activities ?? []).map(code => {
    const art = artifacts[code]
    const content = art?.content
    const items = content
      ? Object.entries(content)
        .filter(([k]) => !k.startsWith('_') && !HIDDEN_KEYS.has(k))
        .reduce((sum, [, v]) => sum + (Array.isArray(v) ? v.length : 0), 0)
      : 0
    const state = !content ? '미작성' : art?.status === 'confirmed' ? '확정' : '작성됨'
    return `| ${ACTIVITY_META[code].label} (${displayActivityCode(code)}) | ${state} | ${items > 0 ? `${items}개` : '-'} |`
  })
  return ['| 활동 | 산출물 | 표·목록 항목 수 |', '| --- | --- | --- |', ...rows].join('\n')
}

/** 단계 심층 분석 지침에서 '## …' 머리글을 떼고 점검 항목만 남긴다(고정 섹션 머리글을 쓰기 위해). */
function deepAnalysisPoints(stage: StageCode): string {
  return STAGE_DEEP_ANALYSIS[stage].replace(/^##[^\n]*\n+/, '').replace(/^###\s*분석 포인트[^\n]*\n/m, '').trim()
}

/**
 * 보고서 끝 '## 부록: 산출물 원문' — AI 가 아니라 서버가 스트림 끝에 붙인다(본문은 대시보드처럼 짧게,
 * 원문은 화면에서 접어 둔다). 자리표시로 만들어 스트림의 치환기가 원문으로 바꾼다.
 */
export function buildArtifactAppendix(stage: StageCode): string {
  const stageInfo = STAGES.find(s => s.code === stage)
  const appendix = REPORT_SECTIONS.find(section => section.key === 'appendix')!
  const blocks = (stageInfo?.activities ?? []).map(code =>
    `### ${ACTIVITY_META[code].label} (${displayActivityCode(code)})\n\n${artifactPlaceholder(code)}`)
  return `\n\n## ${appendix.title}\n\n${blocks.join('\n\n')}\n`
}

export function buildAnalysisPrompt(
  stage: StageCode,
  project: { title: string; targetGradeGroup: string; targetSubjects?: string[] },
  artifacts: Record<string, { title?: string; content?: Record<string, unknown> | null; status?: string }>,
): string {
  const stageInfo = STAGES.find(s => s.code === stage)!
  const [summary, overview, activities, alignment, strengths, improvements, next] = reportSectionsFor(stage)
  const originals = buildArtifactOriginals(stage, artifacts)

  // AI 입력용 산출물 원문(읽기용) — 출력에는 쓰지 않는다. 원문은 서버가 부록으로 붙인다.
  const sourceBlocks = stageInfo.activities.map(code =>
    `### ${ACTIVITY_META[code].label} (${displayActivityCode(code)})\n\n${originals[code]}`).join('\n\n')

  const activityTemplate = stageInfo.activities.map(code => `### ${ACTIVITY_META[code].label} (${displayActivityCode(code)})

- (이 활동에서 팀이 정한 핵심과 그 의미 — 40자 안팎)
- (잘 설계된 점, 또는 '~하면 더 좋아질 수 있어요' 제안 — 40자 안팎)

> (이 활동의 핵심을 교사 눈높이로 한 줄)`).join('\n\n')

  return `당신은 T-CID(팀 협력 수업설계)를 잘 아는 수업설계 동료입니다. 교사팀이 만든 설계를 평가하거나 채점하는 사람이 아니라, 설계의 핵심을 한눈에 정리해 주고 잘한 점을 짚어 주며 다음 걸음을 함께 고민하는 지원자입니다. 아래 산출물을 읽고 교사가 한눈에 보는 대시보드형 보고서를 씁니다.

**어조 원칙**:
- 판정·채점·등급을 매기지 않는다. 점수, '충분/부족', '미흡', '위험' 같은 평가어를 쓰지 않는다.
- '~해야 한다', '~가 필요하다', '~를 확보해야 한다' 같은 단정·지시 대신 '~하면 더 좋아질 수 있어요', '~를 더해 보면 어떨까요' 같은 제안형으로 쓴다.
- 칭찬은 산출물의 구체적 근거(코드·활동명·장면)와 함께 쓴다. 막연한 칭찬은 쓰지 않는다.
- 존중하는 말투(해요체)로 쓴다.
- ❌ 쓰지 말 것: "문제상황의 실제성은 강력하지만 학년군별 평가 근거를 확보해야 한다."
- ✅ 이렇게: "학년군마다 실제 동네 장면이 살아 있어요. 평가 요소마다 근거 코드를 한 줄씩 붙이면 연결이 더 또렷해질 수 있어요."

**작성 원칙**:
- 아래 출력 형식의 머리글(#, ##, ###)을 이름·순서 그대로 쓴다. 머리글을 바꾸거나 빼거나 새로 만들지 않는다.
- 문단을 쓰지 않는다. 모든 내용은 짧은 글머리(항목당 40자 안팎) 또는 짧은 표 칸으로 쓴다.
- 표는 열 3~4개, 칸마다 한 구절. 칸 안에서 줄을 바꾸지 않는다.
- 핵심 메시지는 '> ' 인용 한 줄로 압축한다.
- 내용은 산출물의 구체적 내용을 근거로 한다. 일반론 금지.
- 산출물 원문은 출력하지 않는다(서버가 보고서 끝 부록으로 붙인다). '${next.title}' 다음에는 아무것도 쓰지 않는다.
- **굵게**는 핵심 키워드에만 쓴다.
- 성취기준 코드는 [2국03-02]처럼 코드만 쓴다. 코드 뒤에 A·B·C 같은 수준 글자를 붙이지 않는다(산출물 원문에 있어도 옮기지 않는다).

## 프로젝트 정보
- 제목: ${project.title}
- 대상: ${project.targetGradeGroup}
- 교과: ${project.targetSubjects?.join(', ') ?? '미지정'}
- 분석 단계: ${STAGE_LABELS[stage]}(${stage})

## 산출물 원문 (읽기용 — 출력하지 말 것)

${sourceBlocks}

## ${alignment.title} — 살펴볼 관점 (판정하지 말고, 잘 이어진 곳과 다음에 이어 볼 곳을 찾는 데만 쓴다)

${deepAnalysisPoints(stage)}

---

아래 출력 형식을 그대로 채워 보고서만 출력하세요. ( ) 안의 지시는 지우고 내용으로 바꿉니다.

# ${project.title} · ${STAGE_LABELS[stage]}(${stage}) 단계 분석 보고서

## ${summary.title}

(팀이 만든 설계의 핵심을 교사 눈높이로 한 문장 — 60자 이내)
키워드: (핵심 키워드 3~5개를 ' · '로 구분)

## ${overview.title}

${buildOverviewTable(stage, artifacts)}

| 핵심 수치 | 값 | 의미 |
| --- | --- | --- |
| (산출물에서 셀 수 있는 수치 3~4개: 예) 연결 성취기준 수, 학년군 수, 총 차시, 평가 장면 수) | (숫자) | (10자 안팎) |

## ${activities.title}

${activityTemplate}

## ${alignment.title}

| 연결이 잘 된 곳 | 무엇과 무엇이 | 근거 |
| --- | --- | --- |
| (잘 이어진 곳 2~3개, 짧게) | (예: 성취기준 ↔ 평가 요소) | (한 구절) |

다음에 연결해 볼 곳:
- (아직 이어지지 않은 곳과 이어 볼 방법 — 제안형, 40자 안팎)
- (같은 형식, 1~2개)

## ${strengths.title}

- **(키워드)**: (구체적 근거와 함께 칭찬 — 40자 안팎)
- **(키워드)**: (같은 형식)
- **(키워드)**: (같은 형식)

## ${improvements.title}

- **(아이디어)**: (제안 한 줄 — '~하면 더 좋아질 수 있어요') · 이유: (한 구절)
- **(아이디어)**: (같은 형식)
- **(아이디어)**: (같은 형식)

## ${next.title}

> (다음 단계를 시작하는 팀을 응원하는 한 줄)

1. (바로 해 볼 일 — 40자 안팎)
2. (같은 형식)
3. (같은 형식)`
}

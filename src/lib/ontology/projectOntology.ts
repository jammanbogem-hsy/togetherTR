/**
 * 프로젝트 온톨로지 데이터 빌더.
 *
 * 한 프로젝트를 T-CID 모형 구조로 노드·엣지 그래프화한다.
 * T→A→Ds→DI→E 5단계를 가로 컬럼으로 배치, 각 단계 내 활동은 세로 슬롯.
 *
 * 교육적 관계:
 *  - sequential : 단계 내 이웃 활동 (T-1-1 → T-1-2)
 *  - stage      : 단계 전환 (T 마지막 → A 첫 활동)
 *  - guardrail  : A-2-3 학습자·맥락 분석이 Ds 전체에 가드레일
 *  - backward   : Ds-1-1 평가 계획이 이후 Ds 설계의 기준 (Backward Design)
 *  - cycle      : E-2-1 → T-1-1 다음 주기 순환
 *
 * 공개 모드: project.artifacts 같은 민감 정보 없이 구조만 노출.
 */

import { STAGES, ACTIVITY_META, type Project, type StageCode, type ActivityCode } from '@/types'
import { isEffectivelyDone } from '@/lib/activity/completion'

export interface ArtifactSectionSnapshot {
  key: string
  value: string
}

/**
 * 산출물에서 구조화된 교육 정보 추출.
 *  - 성취기준 코드: `[6과03-01]` 같은 대괄호 코드
 *  - 핵심아이디어: `> ★` 또는 `> 핵심아이디어` 로 시작하는 blockquote
 *  - 차시: `N차시`, `N-M차시`, `총 N차시` 같은 패턴
 *
 * A-2-1 (핵심아이디어·성취기준 분석) / Ds-* (설계 단계)에서 특히 가치 있음.
 */
export interface StructuredInfo {
  standardCodes: string[]      // 예: ['6과03-01', '9국04-02']
  coreIdeas: string[]          // 예: ['데이터 리터러시는 …']
  classHourPlan: string[]      // 예: ['총 8차시', '1-2차시: 탐구 도입', ...]
}

export interface OntologyNode {
  id: ActivityCode
  label: string
  stage: StageCode
  stageIdx: number          // 0~4 (T=0, A=1, Ds=2, DI=3, E=4)
  slot: number              // 단계 내 순서 (0부터)
  x: number                 // SVG 좌표
  y: number
  hasArtifact: boolean
  isDone: boolean           // checkEffectivelyDone 기반
  isCurrent: boolean        // 현재 활성 활동
  isGuardrailSource: boolean
  isBackwardFirst: boolean
  hasStageReport: boolean   // 공개 링크용 — 해당 단계의 분석 보고서 저장 여부
  sections?: ArtifactSectionSnapshot[]   // 드로어에서 펼치기 위한 전체 섹션
  keywords?: string[]       // 상위 N개 핵심 개념 (해시태그로 노출, 랭킹 순)
  structured?: StructuredInfo  // 성취기준 코드·핵심아이디어·차시 등 구조화된 교육 정보
}

export type EdgeKind = 'sequential' | 'stage' | 'guardrail' | 'backward' | 'cycle' | 'concept'

export interface OntologyEdge {
  source: ActivityCode
  target: ActivityCode
  kind: EdgeKind
  strength?: number           // concept edge 가중치 (겹친 키워드 수)
  sharedKeywords?: string[]   // 공유 키워드 (툴팁용)
}

export interface OntologyGraph {
  nodes: OntologyNode[]
  edges: OntologyEdge[]
  width: number
  height: number
}

// 레이아웃 상수 — SVG viewBox 기준
export const ONTOLOGY_LAYOUT = {
  COL_WIDTH: 190,
  COL_START: 105,          // 첫 컬럼 중심 x
  ROW_HEIGHT: 92,          // 노드 + 라벨 + 핵심어 카운터 1줄
  ROW_START: 115,          // 첫 활동 y
  HEADER_Y: 40,            // 단계 헤더 y
  NODE_RADIUS: 24,
  PADDING_BOTTOM: 100,     // cycle 곡선을 그릴 여백
}

// 키워드 추출용 한국어 불용어 — 개념 연결에서 의미 없는 조사·접속사·일반동사 제외.
// 주의: T-CID 도메인 용어(방향·목표·평가·성찰·비전 등)는 핵심 개념이므로 **불용어에 넣지 않는다**.
const KOREAN_STOP_WORDS = new Set([
  // 서술어
  '있다', '없다', '하다', '되다', '이다', '아니다', '같다', '만들다', '받다', '주다', '가다', '오다',
  '대하다', '위하다', '통하다', '따르다',
  // 대명사·의존명사
  '것이', '것', '수', '때', '그', '이', '저', '그것', '이것', '저것', '무엇', '어떤', '어느',
  // 접속어
  '그리고', '또한', '또는', '혹은', '그래서', '따라서', '하지만', '그러나', '즉', '예를', '예로',
  // 조사 덩어리
  '위해', '통해', '대한', '관한', '위한', '따른', '함께', '모두', '각자', '서로', '서로서로',
  // 정도부사
  '등', '및', '더', '덜', '많이', '조금', '아주', '매우', '너무', '정말', '진짜', '항상', '늘', '거의',
  // 일반화된 보통명사 (도메인 가치 낮음)
  '학생', '학생들', '교사', '교사들', '선생님', '우리', '저희', '여러분',
  '내용', '방법', '부분', '전체', '개념', '중심', '기준', '필요', '가능', '관련', '중요', '자체',
  '과정', '결과', '경우', '종류', '형태', '모습', '상황', '수준',
  // 무의미한 빈번어 (T-CID 사례 기반 경험)
  '이후', '이전', '다음', '지금', '이번', '처음', '마지막',
])

/**
 * 섹션들에서 **가중 점수 기반**으로 상위 N개 핵심 개념을 추출한다.
 *
 * 가중치 전략:
 *  - `**bold**` 강조: +4 (AI가 일부러 강조한 개념)
 *  - 테이블 셀 내부 토큰: +2 (표 형태는 개념이 정리되어 있는 경향)
 *  - 리스트(-, *, 숫자.) 시작 토큰: +2
 *  - 본문 일반 토큰: +1
 *
 * 필터:
 *  - 한글 포함 2~6자 (너무 짧으면 조사/어미, 너무 길면 구문)
 *  - 한국어 조사 꼬리 제거 (~의/을/를/이/가/은/는/에/과/와/로/으로 등)
 *  - 불용어 제외
 */
function scoreKeywords(sections: ArtifactSectionSnapshot[]): Map<string, number> {
  const scores = new Map<string, number>()
  const add = (raw: string, weight: number) => {
    const stripped = stripKoreanParticles(raw.trim())
    if (stripped.length < 2 || stripped.length > 6) return
    if (!/[가-힣]/.test(stripped)) return
    if (KOREAN_STOP_WORDS.has(stripped)) return
    if (isLowValueKeyword(stripped)) return
    if (/^\d+$/.test(stripped)) return
    scores.set(stripped, (scores.get(stripped) ?? 0) + weight)
  }

  for (const sec of sections) {
    const text = sec.value
    // 1) **bold** — 가중치 최상
    for (const m of text.matchAll(/\*\*([^*\n]{2,20})\*\*/g)) {
      // bold 전체가 그대로 개념일 수도 있고, 내부 복수 토큰일 수도 있음
      const full = m[1].trim()
      if (full.length >= 2 && full.length <= 10 && /[가-힣]/.test(full)) {
        add(full, 4)
      }
      for (const tok of tokenizeKorean(full)) add(tok, 3)
    }
    // 2) 테이블 셀
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('|') || !t.includes('|')) continue
      const cells = t.split('|').map(c => c.trim()).filter(Boolean)
      for (const cell of cells) {
        if (/^-+$/.test(cell)) continue   // 구분 행
        if (cell.length <= 8 && /[가-힣]/.test(cell)) {
          add(cell, 2)                     // 짧은 셀은 그대로 개념일 확률 높음
        }
        for (const tok of tokenizeKorean(cell)) add(tok, 2)
      }
    }
    // 3) 리스트 항목의 첫 토큰
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)/)
      if (!m) continue
      const head = m[1].trim().split(/[:·,]/)[0]
      for (const tok of tokenizeKorean(head)) add(tok, 2)
    }
    // 4) 본문 일반 토큰
    for (const tok of tokenizeKorean(text)) add(tok, 1)
  }
  return scores
}

function tokenizeKorean(text: string): string[] {
  return text
    .replace(/[*`#_~\[\]()<>{}|"']/g, ' ')
    .split(/[\s,.!?·…/:;\n\t·]+/)
    .filter(Boolean)
}

function stripKoreanParticles(token: string): string {
  let t = token.trim()
  // 1) 서술어 어미·종결형 (형태소 분석기 없이 커버하는 범위) — 가장 긴 패턴부터
  t = t.replace(
    /(있습니다|없습니다|되었습니다|하였습니다|이었습니다|했습니다|됐습니다|았습니다|었습니다|됩니다|입니다|합니다|봅니다|드립니다|있었다|없었다|되었다|하였다|이었다|했다|됐다|이다|있다|없다|하다|되다|봅시다|해봅|합시다|돼요|이에요|예요|있어요|없어요|해요|봐요|할지|할까|하면|하고|하며|하다가|하지만|되지만|이지만)$/,
    '',
  )
  // 2) 조사 꼬리
  t = t.replace(
    /(의|을|를|이|가|은|는|도|만|에|에서|으로|로|과|와|이나|나|부터|까지|마다|밖에|뿐|만큼|처럼|보다|라고|이라고|이라는|라는|에게|한테|에는|에서는|으로는|으로써|으로서|처럼)$/,
    '',
  )
  return t.trim()
}

// 후처리 추가 필터 — `다`로 끝나는 일반 동사 어간, 숫자+한글 혼합 등 저품질 토큰 차단
function isLowValueKeyword(k: string): boolean {
  // 'X다' 형태 (이다, 좋다, 맞다 등) — 불용어 처리 (2글자 동사형)
  if (k.length <= 3 && /다$/.test(k)) return true
  // 숫자 포함 혼합
  if (/\d/.test(k) && k.length <= 4) return true
  // '합/됩/있/없' 로 시작하는 짧은 조각
  if (/^(합|됩|있|없|하|되|이|않)/.test(k) && k.length <= 3) return true
  return false
}

function extractStructuredInfo(sections: ArtifactSectionSnapshot[]): StructuredInfo {
  const allText = sections.map(s => s.value).join('\n')

  // 1) 성취기준 코드 — `[6과03-01]`, `[9국04-02]`, `[6수01-02]` 형태
  const codeSet = new Set<string>()
  for (const m of allText.matchAll(/\[([가-힣0-9]{2,10}-\d{2})\]/g)) {
    codeSet.add(m[1])
  }
  // 대괄호 없는 형태도 커버: 숫자+한글+숫자-숫자 패턴
  for (const m of allText.matchAll(/(?<![\w가-힣])(\d+[가-힣]{1,5}\d{2}-\d{2})(?![\w가-힣])/g)) {
    codeSet.add(m[1])
  }

  // 2) 핵심아이디어 — `> ★` 또는 blockquote + 핵심아이디어 키워드
  const coreIdeas: string[] = []
  for (const line of allText.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('>')) continue
    if (!(t.includes('★') || t.includes('핵심아이디어') || t.includes('핵심 아이디어'))) continue
    const clean = t.replace(/^>\s*★?\s*\*?\*?/, '').replace(/\*\*/g, '').trim()
    if (clean.length > 6 && clean.length < 200) coreIdeas.push(clean)
  }

  // 3) 차시 — `N차시`, `1-2차시`, `총 N차시`, `N시간`
  const classHourSet = new Set<string>()
  for (const m of allText.matchAll(/(총|전체)\s*(\d{1,3})\s*차시/g)) {
    classHourSet.add(`${m[1]} ${m[2]}차시`)
  }
  for (const m of allText.matchAll(/(?<![\d.])(\d{1,3}(?:[-~]\d{1,3})?)\s*차시(?![가-힣])/g)) {
    classHourSet.add(`${m[1]}차시`)
  }
  // 테이블 셀에서 「X차시 | 활동명」 형태 더 풍부히 잡기 — 첫 셀이 N차시면 행 전체 요약 저장
  for (const line of allText.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|') || !t.includes('|')) continue
    const cells = t.split('|').map(c => c.trim()).filter(Boolean)
    if (cells.length < 2) continue
    const first = cells[0]
    if (/^\d{1,3}(?:[-~]\d{1,3})?\s*차시$/.test(first)) {
      const desc = cells[1].slice(0, 40)
      classHourSet.add(`${first}: ${desc}`)
    }
  }

  return {
    standardCodes: Array.from(codeSet).slice(0, 12),
    coreIdeas: coreIdeas.slice(0, 5),
    classHourPlan: Array.from(classHourSet).slice(0, 10),
  }
}

function extractArtifactSnapshot(artifact: { content?: Record<string, unknown> } | undefined): {
  sections?: ArtifactSectionSnapshot[]
  keywords?: string[]
  structured?: StructuredInfo
} {
  if (!artifact?.content) return {}
  const DISPLAY_BLOCKED = new Set(['_schemaVersion', '_schema', 'status', 'version', 'title'])
  const sections: ArtifactSectionSnapshot[] = []

  // 구조화 스키마 → 읽기 좋은 섹션으로 변환
  const c = artifact.content as Record<string, unknown>
  if (c._schema === 'T-1-1') {
    const pv = c.personalVisions as Array<{ teacherName: string; keywords: string[]; refinedVision: string }> | undefined
    if (pv?.length) sections.push({ key: '개인 비전', value: '| 교사명 | 키워드 | AI 정교화 비전 |\n| --- | --- | --- |\n' + pv.map(p => `| ${p.teacherName} 선생님 | ${p.keywords?.join(', ') || '-'} | ${p.refinedVision} |`).join('\n') })
    if (typeof c.teamVision === 'string' && c.teamVision) sections.push({ key: '팀 공통 비전', value: c.teamVision })
    const kw = c.coreKeywords as string[] | undefined
    if (kw?.length) sections.push({ key: '핵심 키워드', value: kw.join(', ') })
  } else if (c._schema === 'T-1-2') {
    const dp = c.designPrinciples as Array<{ principle: string; rationale: string }> | undefined
    if (dp?.length) sections.push({ key: '설계 원칙', value: '| 설계 원칙 | 근거 |\n| --- | --- |\n' + dp.map(d => `| ${d.principle} | ${d.rationale} |`).join('\n') })
  } else if (c._schema === 'T-2-1') {
    const roles = c.roles as Array<{ teacherName: string; subject: string; strengths: string; role: string; responsibilities: string; deadline?: string }> | undefined
    if (roles?.length) sections.push({ key: '역할 배분', value: '| 교사명 | 담당 교과 | 강점·전문성 | 팀 내 역할 | 담당 업무 | 완료 시점 |\n| --- | --- | --- | --- | --- | --- |\n' + roles.map(r => `| ${r.teacherName} | ${r.subject || '-'} | ${r.strengths || '-'} | ${r.role} | ${r.responsibilities} | ${r.deadline || '-'} |`).join('\n') })
  } else if (c._schema === 'T-2-2') {
    const rules = c.rules as Array<{ category: string; name: string; description: string; feasibility?: string; violation?: string }> | undefined
    if (rules?.length) sections.push({ key: '팀 규칙', value: '| 범주 | 규칙명 | 설명 | 실천 방법 |\n| --- | --- | --- | --- |\n' + rules.map(r => `| ${r.category || '-'} | ${r.name} | ${r.description} | ${r.feasibility || r.violation || '-'} |`).join('\n') })
  } else if (c._schema === 'T-2-3') {
    const sched = c.schedule as Array<{ period: string; activity: string; content?: string; deliverable?: string; assignee: string }> | undefined
    if (sched?.length) sections.push({ key: '팀 일정', value: '| 기간 | 활동 | 내용 | 담당자 |\n| --- | --- | --- | --- |\n' + sched.map(s => `| ${s.period} | ${s.activity} | ${s.content || s.deliverable || '-'} | ${s.assignee || '-'} |`).join('\n') })
  } else if (c._schema === 'A-1-2') {
    const crit = c.criteria as Array<{ criterion: string; description: string; priority: string }> | undefined
    if (crit?.length) sections.push({ key: '주제 선정 기준', value: '| 기준 | 설명 | 우선순위 |\n| --- | --- | --- |\n' + crit.map(cr => `| ${cr.criterion} | ${cr.description || '-'} | ${cr.priority || '-'} |`).join('\n') })
    if (typeof c.selectedTopic === 'string' && c.selectedTopic) sections.push({ key: '선정 주제', value: c.selectedTopic })
    if (typeof c.topicType === 'string' && c.topicType) sections.push({ key: '주제 유형', value: c.topicType })
    if (typeof c.rationale === 'string' && c.rationale) sections.push({ key: '선정 근거', value: c.rationale })
  } else if (c._schema === 'A-2-1') {
    const rows = c.rows as Array<{ subject: string; standard?: string; coreIdea: string; knowledgeUnderstanding: string; processFunction: string; valueAttitude?: string; contribution?: string; isCommon?: boolean }> | undefined
    if (rows?.length) sections.push({ key: '주제의 상세 내용 분석', value: '| 교과 | 성취기준·핵심 아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 공통·고유 기여 |\n| --- | --- | --- | --- | --- | --- | --- |\n' + rows.map(r => `| ${r.subject} | ${[r.standard, r.coreIdea].filter(Boolean).join(' / ') || '-'} | ${r.knowledgeUnderstanding || '-'} | ${r.processFunction || '-'} | ${r.valueAttitude || '-'} | ${r.contribution || (r.isCommon ? '공통 요소' : '교과 고유 요소')} |`).join('\n') })
    if (typeof c.commonElements === 'string' && c.commonElements) sections.push({ key: '공통 요소', value: c.commonElements })
    if (typeof c.reconstructedStandard === 'string' && c.reconstructedStandard) sections.push({ key: '재구성 성취기준', value: c.reconstructedStandard })
  } else if (c._schema === 'A-2-2') {
    const cci = (c.commonCoreIdea as string | undefined)?.trim()
    if (cci) sections.push({ key: '공통 핵심 아이디어', value: cci })
    const inquiryQuestion = (c.inquiryQuestion as string | undefined)?.trim()
    if (inquiryQuestion) sections.push({ key: '탐구 질문', value: inquiryQuestion })
    const integratedSingle = (c.integratedGoal as string | undefined)?.trim()
    const integratedLegacy = c.integratedGoals as string[] | undefined
    if (integratedSingle) {
      sections.push({ key: '통합 수업목표', value: integratedSingle })
    } else if (integratedLegacy?.length) {
      sections.push({ key: '통합 학습목표', value: integratedLegacy.map((g, i) => `${i + 1}. ${g}`).join('\n') })
    }
    const kws = c.convergentKeywords as string[] | undefined
    if (kws?.length) sections.push({ key: '핵심 키워드', value: kws.join(', ') })
    const sg = c.subjectGoals as Array<{ subject: string; goal: string }> | undefined
    if (sg?.length) sections.push({ key: '교과별 수업목표', value: '| 교과 | 수업목표 |\n| --- | --- |\n' + sg.map(g => `| ${g.subject} | ${g.goal} |`).join('\n') })
    const method = (c.method as string | undefined)
    if (method) sections.push({ key: '진술 방식', value: method === 'deductive' ? '연역적' : '귀납적' })
  } else if (c._schema === 'A-2-3') {
    const cp = c.commonProfile as Array<{ item: string; content: string }> | undefined
    if (cp?.length) sections.push({ key: '학습자 프로필', value: '| 항목 | 내용 |\n| --- | --- |\n' + cp.map(p => `| ${p.item} | ${p.content} |`).join('\n') })
    const tn = c.teacherNotes as Array<{ teacherName: string; note: string }> | undefined
    if (tn?.length) sections.push({ key: '교사별 맞춤', value: tn.map(t => `- **${t.teacherName}**: ${t.note}`).join('\n') })
  }

  // 비구조화(레거시) 산출물
  if (sections.length === 0) {
    for (const [key, value] of Object.entries(artifact.content)) {
      if (DISPLAY_BLOCKED.has(key)) continue
      const v = typeof value === 'string' ? value : ''
      if (!v.trim()) continue
      sections.push({ key, value: v.trim() })
    }
  }
  if (sections.length === 0) return {}
  // 상위 N개 개념만 보존 — 해시태그 식으로 표시될 것
  const scores = scoreKeywords(sections)
  const keywords = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(e => e[0])
  // 구조화된 정보 (성취기준 코드·핵심아이디어·차시)
  const structured = extractStructuredInfo(sections)
  const hasStructured = structured.standardCodes.length > 0 || structured.coreIdeas.length > 0 || structured.classHourPlan.length > 0
  return { sections, keywords, structured: hasStructured ? structured : undefined }
}

// 인라인 프로젝트 스냅샷 타입 (공개 모드에서 최소 정보만 받기 위함)
export interface OntologyProjectLike {
  artifacts?: Project['artifacts']
  activityStatuses?: Project['activityStatuses']
  currentActivity?: ActivityCode | undefined
  stageReports?: Partial<Record<StageCode, unknown>>
}

export function buildProjectOntology(project: OntologyProjectLike | null | undefined): OntologyGraph {
  const L = ONTOLOGY_LAYOUT
  const nodes: OntologyNode[] = []
  const edges: OntologyEdge[] = []

  for (let stageIdx = 0; stageIdx < STAGES.length; stageIdx++) {
    const stage = STAGES[stageIdx]
    const x = L.COL_START + stageIdx * L.COL_WIDTH
    const activities = stage.activities

    const stageHasReport = !!project?.stageReports?.[stage.code]

    activities.forEach((code, slot) => {
      const meta = ACTIVITY_META[code]
      if (!meta) return
      const artifact = project?.artifacts?.[code]
      const done = project
        ? isEffectivelyDone(code, project.activityStatuses ?? {}, project.artifacts)
        : false
      const snapshot = extractArtifactSnapshot(artifact)
      nodes.push({
        id: code,
        label: meta.label,
        stage: stage.code,
        stageIdx,
        slot,
        x,
        y: L.ROW_START + slot * L.ROW_HEIGHT,
        hasArtifact: !!artifact,
        isDone: done,
        isCurrent: project?.currentActivity === code,
        isGuardrailSource: !!meta.isGuardrailSource,
        isBackwardFirst: !!meta.isBackwardDesignFirst,
        hasStageReport: stageHasReport,
        sections: snapshot.sections,
        keywords: snapshot.keywords,
        structured: snapshot.structured,
      })
    })

    // sequential — 같은 단계 내 이웃
    for (let i = 0; i < activities.length - 1; i++) {
      edges.push({
        source: activities[i],
        target: activities[i + 1],
        kind: 'sequential',
      })
    }

    // stage transition — 현 단계 마지막 → 다음 단계 첫 활동
    if (stageIdx < STAGES.length - 1 && activities.length > 0) {
      const nextActivities = STAGES[stageIdx + 1].activities
      if (nextActivities.length > 0) {
        edges.push({
          source: activities[activities.length - 1],
          target: nextActivities[0],
          kind: 'stage',
        })
      }
    }
  }

  // guardrail: A-2-3 → 모든 Ds 활동
  const dsStage = STAGES.find(s => s.code === 'Ds')
  if (dsStage && nodes.some(n => n.id === 'A-2-3')) {
    for (const dsCode of dsStage.activities) {
      edges.push({ source: 'A-2-3', target: dsCode, kind: 'guardrail' })
    }
  }

  // backward: Ds-1-1(평가 먼저) → 나머지 Ds 활동
  if (dsStage) {
    const backwardSource: ActivityCode = 'Ds-1-1'
    for (const dsCode of dsStage.activities) {
      if (dsCode === backwardSource) continue
      edges.push({ source: backwardSource, target: dsCode, kind: 'backward' })
    }
  }

  // cycle: E-2-1 → T-1-1 (다음 주기)
  if (nodes.some(n => n.id === 'E-2-1') && nodes.some(n => n.id === 'T-1-1')) {
    edges.push({ source: 'E-2-1', target: 'T-1-1', kind: 'cycle' })
  }

  // concept edges — 산출물 핵심 개념(상위 N 키워드) 교집합 ≥ 2 인 활동 쌍을 dotted 연결.
  // 팀이 실제로 기록한 용어들이 어떤 활동들에 공유되는지 시각화.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      if (!a.keywords || !b.keywords || a.keywords.length === 0 || b.keywords.length === 0) continue
      if (a.stageIdx === b.stageIdx && Math.abs(a.slot - b.slot) === 1) continue
      const bSet = new Set(b.keywords)
      const shared = a.keywords.filter(k => bSet.has(k)).slice(0, 5)
      if (shared.length >= 2) {
        edges.push({
          source: a.id,
          target: b.id,
          kind: 'concept',
          strength: shared.length,
          sharedKeywords: shared,
        })
      }
    }
  }

  const maxSlot = nodes.reduce((m, n) => Math.max(m, n.slot), 0)
  const width = L.COL_START + (STAGES.length - 1) * L.COL_WIDTH + L.COL_START
  const height = L.ROW_START + (maxSlot + 1) * L.ROW_HEIGHT + L.PADDING_BOTTOM

  return { nodes, edges, width, height }
}

// 엣지별 비주얼 스타일 — 그래프 컴포넌트에서 그대로 사용
export const EDGE_STYLE: Record<EdgeKind, { color: string; width: number; dashed?: boolean; label: string }> = {
  sequential: { color: '#DADCE0', width: 2, label: '순차 진행' },
  stage:      { color: '#5F6368', width: 2.5, label: '단계 전환' },
  guardrail:  { color: '#7B1FA2', width: 1.5, dashed: true, label: '가드레일 (A-2-3 → Ds)' },
  backward:   { color: '#E65100', width: 1.5, dashed: true, label: '백워드 디자인 (Ds-1-1 기준)' },
  cycle:      { color: '#F9AB00', width: 2.5, label: '주기 순환 (E → T)' },
  concept:    { color: '#00897B', width: 1.2, dashed: true, label: '개념 연결 (공유 키워드)' },
}

/**
 * 개념 계승 흐름 — 각 노드의 키워드를 이전/이후 활동과 비교해
 *  incoming  : 이전 활동에서 처음 등장해 이 활동에 이어진 키워드 + 출처 노드
 *  unique    : 이 활동에서 처음 등장한 키워드 (이전에는 없었음)
 *  outgoing  : 이 활동의 키워드 중 이후 활동에도 등장하는 것 + 도달 노드
 *
 * 정렬 기준: stageIdx ASC → slot ASC (프로젝트 진행 순서와 일치)
 */
export interface InheritanceLink {
  keyword: string
  activity: ActivityCode
}
export interface NodeInheritance {
  incoming: InheritanceLink[]
  unique: string[]
  outgoing: InheritanceLink[]
}

export function computeInheritance(nodes: OntologyNode[]): Map<ActivityCode, NodeInheritance> {
  const ordered = [...nodes].sort((a, b) => a.stageIdx - b.stageIdx || a.slot - b.slot)
  const firstSeen = new Map<string, ActivityCode>()   // keyword → 최초 출현 노드
  const perNodeKws = new Map<ActivityCode, string[]>()
  const result = new Map<ActivityCode, NodeInheritance>()

  // 1pass: incoming / unique
  for (const n of ordered) {
    const kws = n.keywords ?? []
    perNodeKws.set(n.id, kws)
    const incoming: InheritanceLink[] = []
    const unique: string[] = []
    for (const kw of kws) {
      const src = firstSeen.get(kw)
      if (src && src !== n.id) {
        incoming.push({ keyword: kw, activity: src })
      } else {
        unique.push(kw)
        firstSeen.set(kw, n.id)
      }
    }
    result.set(n.id, { incoming, unique, outgoing: [] })
  }

  // 2pass: outgoing (이 노드 이후에 이 키워드가 다시 등장하는 최초 노드만)
  for (const n of ordered) {
    const myKws = perNodeKws.get(n.id) ?? []
    const outgoing: InheritanceLink[] = []
    const seenLater = new Set<string>()
    for (const later of ordered) {
      if (later.stageIdx < n.stageIdx || (later.stageIdx === n.stageIdx && later.slot <= n.slot)) continue
      const laterKws = perNodeKws.get(later.id) ?? []
      for (const kw of laterKws) {
        if (myKws.includes(kw) && !seenLater.has(kw)) {
          outgoing.push({ keyword: kw, activity: later.id })
          seenLater.add(kw)
        }
      }
    }
    const entry = result.get(n.id)!
    result.set(n.id, { ...entry, outgoing })
  }

  return result
}

/**
 * 이전 맥락 계산 — 현재 활동이 참조할 수 있는 "앞선 산출물" 목록.
 * 스테이지 순서 상 앞선 + 완료된 활동 중, 가드레일·백워드·직전 단계 등 명시 규칙으로 필터.
 */
export function computePreviousContext(
  currentCode: ActivityCode,
  nodes: OntologyNode[],
): Array<{ node: OntologyNode; relation: 'guardrail' | 'backward' | 'basis' | 'prev_step' }> {
  const curr = nodes.find(n => n.id === currentCode)
  if (!curr) return []
  const result: Array<{ node: OntologyNode; relation: 'guardrail' | 'backward' | 'basis' | 'prev_step' }> = []

  // guardrail: Ds* 이면 A-2-3
  if (curr.stage === 'Ds') {
    const a23 = nodes.find(n => n.id === 'A-2-3')
    if (a23?.hasArtifact) result.push({ node: a23, relation: 'guardrail' })
  }
  // backward: Ds-1-2,3 / Ds-2-* 이면 Ds-1-1
  if (curr.stage === 'Ds' && curr.id !== 'Ds-1-1') {
    const ds11 = nodes.find(n => n.id === 'Ds-1-1')
    if (ds11?.hasArtifact) result.push({ node: ds11, relation: 'backward' })
  }
  // basis: T-1-1 비전은 모든 후속의 근간 (단, T-1-1 자신 제외)
  if (currentCode !== 'T-1-1') {
    const t11 = nodes.find(n => n.id === 'T-1-1')
    if (t11?.hasArtifact) result.push({ node: t11, relation: 'basis' })
  }
  // prev_step: 같은 단계 내 직전 활동
  const stageNodes = nodes.filter(n => n.stageIdx === curr.stageIdx).sort((a, b) => a.slot - b.slot)
  const idxInStage = stageNodes.findIndex(n => n.id === currentCode)
  if (idxInStage > 0) {
    const prev = stageNodes[idxInStage - 1]
    if (prev.hasArtifact && !result.some(r => r.node.id === prev.id)) {
      result.push({ node: prev, relation: 'prev_step' })
    }
  } else if (curr.stageIdx > 0) {
    // 단계 경계: 이전 단계 마지막 활동
    const prevStageNodes = nodes.filter(n => n.stageIdx === curr.stageIdx - 1).sort((a, b) => a.slot - b.slot)
    const last = prevStageNodes[prevStageNodes.length - 1]
    if (last?.hasArtifact && !result.some(r => r.node.id === last.id)) {
      result.push({ node: last, relation: 'prev_step' })
    }
  }
  return result
}

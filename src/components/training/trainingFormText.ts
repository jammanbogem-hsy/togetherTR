import type { ActivityCode } from '@/types'

// 기존 구조화 산출물 렌더러의 열 이름을 사용한다. 프롬프트 직렬화와 분리해 화면에 내부 키를 노출하지 않는다.
const LABELS: Record<string, string> = {
  teacherName: '교사명', subject: '담당 교과', strengths: '강점·전문성', role: '팀 내 역할', responsibilities: '담당 업무', deadline: '완료 시점',
  teamVision: '팀 공통 비전', coreKeywords: '핵심 키워드', personalVisions: '개인 비전', keywords: '개인 비전 키워드', refinedVision: 'AI 정교화 비전',
  designPrinciples: '설계 방향', principle: '설계 원칙', rationale: '근거', roles: '역할 배분',
  rules: '팀 규칙', category: '구분', name: '이름', description: '설명', feasibility: '실천 방법', violation: '위반 시 대응',
  schedule: '팀 일정', period: '기간', activity: '활동', content: '내용', assignee: '담당자', deliverable: '내용',
  criteria: '주제 선정 기준', criterion: '기준', priority: '우선순위', selectedTopic: '선정 주제', topicType: '주제 유형', linkedSubjects: '관련 교과', focus: '기여 내용',
  rows: '성취기준 분석', gradeBand: '학년군', coreIdea: '핵심 아이디어', standard: '성취기준', knowledgeUnderstanding: '지식·이해', processFunction: '과정·기능', valueAttitude: '가치·태도',
  contribution: '교과의 고유 기여', agentLessonExample: '수업 아이디어', commonElements: '공통 요소', reconstructedStandard: '재구조화 성취기준',
  integratedGoal: '통합 수업목표', commonCoreIdea: '공통 핵심 아이디어', inquiryQuestion: '탐구 질문', subjectGoals: '교과별 수업목표', goal: '교과별 수업목표', knowledge: '지식·이해', process: '과정·기능', attitude: '가치·태도',
  convergentKeywords: '융합 키워드', commonProfile: '학습자 프로필', teacherNotes: '교사별 고려사항', item: '항목', note: '고려사항',
  rubric: '평가 계획', checkpoint: '확인 지점', method: '평가 방법', timing: '평가 시점', actor: '평가 주체', high: '상', mid: '중', low: '하',
  scenario: '문제상황', title: '제목', authenticity: '실제성', contentProduct: '학습 내용+산출물', audienceAction: '청중+행위', drivingQuestion: '핵심 질문',
  fullScenario: '문제상황 본문', candidates: '문제상황 후보', standardsAlignment: '성취기준 연결', standardId: '성취기준', connection: '연결 근거', realData: '데이터 출처', label: '이름', url: '주소', source: '출처',
  activities: '학습 활동', order: '순서', phase: '흐름 단계', coreType: '핵심/부가', session: '누적 차시', operation: '차시 운영 메모', review: 'AI 점검',
  materials: '활동별 자료 설계', purpose: '활용 이유', sourceType: '탐색/개발', devScope: '개발 범위', owner: '담당 교사', envCheck: 'AI 점검', humanAIAgency: '학생·AI·교사의 역할 경계',
  scaffolds: '스캐폴딩 계획', targetActivity: '대상 학습활동', type: '유형', level: '대상 수준', fadeOut: '점진적 제거', supportPlans: '지원 방안 정리', support: '지원 방안',
}

const ACTIVITY_LABELS: Partial<Record<ActivityCode, Record<string, string>>> = {
  'T-2-2': { name: '규칙명' },
  'A-2-1': { subject: '교과', description: '교사 수업내용 설명', contribution: '공통 요소·고유 기여', agentLessonExample: 'Agent 추천 수업아이디어' },
  'A-2-2': { subject: '교과' },
  'A-2-3': { content: '공통 내용' },
  'Ds-1-1': { item: '평가 요소' },
  'Ds-1-3': { name: '활동명', description: '활동 설명', operation: '차시 운영' },
  'Ds-2-1': { activity: '대상 활동', name: '자료/도구명', schedule: '일정', owner: '담당' },
  'Ds-2-2': { targetActivity: '대상 활동', type: '스캐폴딩 유형', content: '구체적 내용', fadeOut: '점진적 제거 계획' },
}

const COLUMN_ORDER: Partial<Record<ActivityCode, string[]>> = {
  'T-1-1': ['teacherName', 'subject', 'keywords', 'refinedVision'],
  'T-1-2': ['principle', 'rationale'],
  'T-2-1': ['teacherName', 'subject', 'strengths', 'role', 'responsibilities', 'deadline'],
  'T-2-3': ['period', 'activity', 'content', 'assignee'],
  'A-2-1': ['gradeBand', 'subject', 'coreIdea', 'standard', 'knowledgeUnderstanding', 'processFunction', 'valueAttitude'],
  'Ds-1-1': ['checkpoint', 'item', 'method', 'timing', 'actor', 'high', 'mid', 'low'],
  'Ds-1-3': ['order', 'phase', 'name', 'description', 'coreType', 'subject', 'session', 'operation'],
  'Ds-2-1': ['activity', 'name', 'purpose', 'sourceType', 'devScope', 'owner', 'schedule'],
  'Ds-2-2': ['targetActivity', 'type', 'content', 'level', 'fadeOut'],
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const visibleKey = (key: string) => !key.startsWith('_') && !['id', 'manualWorkspace', 'isCommon', 'isCenter', 'groupWithPrevious'].includes(key)
function columnLabel(code: ActivityCode, key: string): string {
  return ACTIVITY_LABELS[code]?.[key] ?? LABELS[key] ?? (/[가-힣]/.test(key) ? key : '추가 내용')
}
function filled(text: string): boolean {
  return !/^(?:\s*|미입력|\(미입력\)|[-–—])$/.test(text.replace(/\*\*/g, '').trim())
}
const cell = (text: string) => text.trim().replace(/(?<!\\)\|/g, '\\|').replace(/\r?\n/g, ' · ')

function tableCells(line: string): string[] | null {
  const text = line.trim()
  if (!text.includes('|')) return null
  const cells = text.split(/(?<!\\)\|/)
  if (text.startsWith('|')) cells.shift()
  if (/(?<!\\)\|$/.test(text)) cells.pop()
  return cells.map(value => value.trim())
}

/** 이전 양식 직렬화로 저장된 영어 머리글 표만 정리한다. 평문·교사 작성 표·코드 블록은 보존한다. */
function legacyTableText(text: string, code: ActivityCode): string {
  const lines = text.split(/\r?\n/)
  const result: string[] = []
  let changed = false
  let fence: string | null = null
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].trim().match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1][0]
      else if (fence === marker[1][0]) fence = null
    }
    const headers = fence ? null : tableCells(lines[index])
    const keys = headers?.map(header => header.replace(/\*\*|__|`/g, '').trim())
    // 구분선이 없는 옛 프롬프트용 표도 포함하되, 알려진 구조화 키를 가진 머리행만 변환한다.
    if (!keys || keys.length < 2 || !keys.some(key => Object.hasOwn(LABELS, key))
      || !keys.every(key => Object.hasOwn(LABELS, key) || /[가-힣]/.test(key))) {
      result.push(lines[index])
      continue
    }
    let end = index + 1
    const separator = tableCells(lines[end] ?? '')
    if (separator?.length === keys.length && separator.every(value => /^:?-+:?$/.test(value))) end++
    const rows: string[][] = []
    while (end < lines.length) {
      const row = tableCells(lines[end])
      if (!row || row.length !== keys.length || row.every(value => /^:?-+:?$/.test(value))) break
      rows.push(row)
      end++
    }
    if (!rows.length) {
      result.push(lines[index])
      continue
    }
    const columns = keys.map((key, position) => ({ key, position })).filter(({ position }) => rows.some(row => filled(row[position])))
    const data = rows.map(row => columns.map(({ position }) => filled(row[position]) ? row[position] : '')).filter(row => row.some(Boolean))
    if (columns.length && data.length) {
      const table = [columns.map(({ key }) => Object.hasOwn(LABELS, key) ? columnLabel(code, key) : key), columns.map(() => '---'), ...data]
      result.push(...table.map(row => `| ${row.join(' | ')} |`))
    }
    changed = true
    index = end - 1
  }
  return changed ? result.join(text.includes('\r\n') ? '\r\n' : '\n') : text
}

/** 공동 편집 columns/rows 및 머리글+행 배열도 기존 문자열 양식으로 받는다. */
function structuredTableText(value: Record<string, unknown>, code: ActivityCode): string | null {
  const columns = value.columns ?? value.headers
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(value.rows)) return null
  const definitions = columns.map(column => typeof column === 'string' ? { id: column, label: column }
    : record(column) && typeof column.id === 'string' && typeof column.label === 'string' ? { id: column.id, label: column.label } : null)
  if (definitions.some(column => !column)) return null
  const validColumns = definitions.filter((column): column is { id: string; label: string } => column !== null)
  const rows: string[][] = []
  for (const row of value.rows) {
    if (Array.isArray(row)) {
      if (row.length > validColumns.length) return null // 알 수 없는 추가 칸을 버리지 않는다.
      rows.push(validColumns.map((_, index) => cell(structuredText(row[index], code))))
    } else if (record(row) && record(row.cells)) {
      const cells = row.cells
      rows.push(validColumns.map(column => cell(structuredText(cells[column.id], code))))
    } else return null
  }
  if (!rows.some(row => row.some(Boolean))) return ''
  return [validColumns.map(column => cell(column.label)), validColumns.map(() => '---'), ...rows]
    .map(row => `| ${row.join(' | ')} |`).join('\n')
}

function structuredText(value: unknown, code: ActivityCode): string {
  if (value == null) return ''
  if (typeof value === 'string') return filled(value) ? value : ''
  if (Array.isArray(value)) {
    const rows = value.filter(record)
    if (!rows.length) return value.map(item => structuredText(item, code)).filter(Boolean).join('\n')
    const keys = [...new Set(rows.flatMap(row => Object.keys(row).filter(visibleKey)))]
      .filter(key => rows.some(row => filled(structuredText(row[key], code))))
    const order = COLUMN_ORDER[code] ?? []
    keys.sort((a, b) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length))
    const data = rows.map(row => keys.map(key => cell(structuredText(row[key], code)))).filter(row => row.some(Boolean))
    const table = keys.length && data.length ? [keys.map(key => columnLabel(code, key)), keys.map(() => '---'), ...data].map(row => `| ${row.join(' | ')} |`).join('\n') : ''
    const others = value.filter(item => !record(item)).map(item => structuredText(item, code)).filter(Boolean).join('\n')
    return [table, others].filter(Boolean).join('\n\n')
  }
  if (record(value)) {
    const table = structuredTableText(value, code)
    if (table !== null) return table
    const entries = Object.entries(value).filter(([key]) => visibleKey(key))
    const rows = entries.map(([key, item]) => [columnLabel(code, key), structuredText(item, code)])
      .filter(([, text]) => filled(text))
    if (!rows.length) return ''
    if (entries.some(([, item]) => Array.isArray(item) || record(item))) {
      return rows.map(([label, text]) => `${label}\n${text}`).join('\n\n')
    }
    return ['| 구분 | 내용 |', '| --- | --- |', ...rows.map(([label, text]) => `| ${label} | ${cell(text)} |`)].join('\n')
  }
  return typeof value === 'boolean' ? value ? '예' : '아니요' : String(value)
}

/** 평문은 그대로, 구조화 데이터와 예전에 영어 키 표로 저장된 문자열은 한국어로 표시한다. */
export function trainingFormText(value: unknown, code: ActivityCode): string {
  return typeof value === 'string' ? legacyTableText(value, code) : structuredText(value, code)
}

export { columnLabel as trainingFieldLabel }

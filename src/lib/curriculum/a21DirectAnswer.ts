import type { ActivityCode, Project } from '@/types'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'
import { extractKeywords } from './contextInject'
import { loadGraph, searchStandards, type CurriculumStandard } from './graphReader'
import { isElementaryGradeGroup } from './contentSystemReader'

interface BuildA21DirectAnswerParams {
  activityCode: ActivityCode
  messages: Array<{ role: string; content: string }>
  gradeGroup?: string
  targetSubjects?: string[]
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>
  graphSavedData?: GraphSavedData | null
}

type ProjectTargetSubjects = Pick<Project, 'targetSubjects'>

const MAX_STANDARDS = 6
const SUBJECT_ALIASES: Record<string, string[]> = {
  국어: ['국어', '국어과'],
  사회: ['사회', '사회과'],
  수학: ['수학', '수학과'],
  과학: ['과학', '과학과'],
  도덕: ['도덕', '도덕과'],
  실과: ['실과', '기술가정', '기술·가정', '정보'],
  체육: ['체육', '체육과'],
  음악: ['음악', '음악과'],
  미술: ['미술', '미술과'],
  영어: ['영어', '영어과'],
}

export function buildA21DirectAnswer({
  activityCode,
  messages,
  gradeGroup,
  targetSubjects = [],
  confirmedArtifacts,
  graphSavedData,
}: BuildA21DirectAnswerParams): string {
  if (activityCode !== 'A-2-1') return ''

  const latestUser = [...messages].reverse().find(message => message.role === 'user')?.content ?? ''
  if (!isCoreIdeaStandardsQuestion(latestUser)) return ''

  if (gradeGroup && !isElementaryGradeGroup(gradeGroup)) {
    return `### 학교급 교육과정 자료 확인 필요

현재 검증된 지식 그래프는 초등학교 전용이어서 **${gradeGroup} 성취기준을 초등 자료로 대체하지 않습니다.**

> **지금 할 일**
> 담당 교과의 성취기준 코드와 원문을 입력하거나 교육과정 자료를 첨부해 주세요.`
  }

  const graph = loadGraph()
  if (!graph) {
    return [
      '성취기준과 핵심아이디어를 확인하려면 교육과정 지식 그래프 데이터가 필요합니다.',
      '현재 서버에서 지식 그래프 파일을 불러오지 못해 임의로 핵심아이디어를 생성하지 않겠습니다.',
    ].join('\n')
  }

  const subjectNameMap = new Map(graph.subjects.map(subject => [subject.id, subject.name_ko]))
  const a12Context = extractA12Context(messages, confirmedArtifacts)
  const standards = collectStandardsFromGraphData(graphSavedData)
    || collectStandardsFromSearch(messages, gradeGroup, targetSubjects, confirmedArtifacts, a12Context)
  const expectedSubjects = !graphSavedData && a12Context.subjectPlans.size > 0
    ? [...a12Context.subjectPlans.keys()]
    : []

  if (standards.length === 0) {
    return [
      '현재 주제와 학년군에서 교육과정 데이터에 매핑된 성취기준을 찾지 못했습니다.',
      '',
      '핵심아이디어는 교육과정에 제시된 표현만 사용할 수 있으므로 임의 문장을 만들지 않겠습니다.',
      '지식 그래프에서 성취기준을 선택하거나, 교과와 학년군을 더 구체적으로 지정해 주세요.',
    ].join('\n')
  }

  const rows = standards.map(standard => {
    const coreIdea = standard.core_idea_id
      ? graph.coreIdeas.find(item => item.id === standard.core_idea_id)
      : undefined
    const subjectName = subjectNameMap.get(standard.subject_id) ?? standard.subject_id
    const subjectFocus = a12Context.subjectPlans.get(canonicalSubject(subjectName)) ?? ''
    return {
      subjectName,
      standard,
      coreIdea: selectCoreIdea(coreIdea?.ideas ?? [], [
        a12Context.selectedTopic,
        subjectFocus,
        standard.text,
        standard.area,
        ...(standard.keywords ?? []),
      ].join(' ')),
    }
  })

  const lines: string[] = [
    '아래는 교육과정 지식 그래프에서 조회한 성취기준과 핵심아이디어입니다.',
    '핵심아이디어는 수업 아이디어를 새로 만든 것이 아니라, 교육과정에 제시된 표현만 표시합니다.',
    '',
  ]

  rows.forEach((row, index) => {
    lines.push(`${index + 1}. **${row.subjectName}**`)
    lines.push(`- 성취기준: ${formatCode(row.standard.code)} ${row.standard.text}`)
    lines.push(`- 영역: ${row.standard.area}`)
    lines.push(`- 핵심아이디어: ${row.coreIdea || '미매핑'}`)
    lines.push('')
  })

  const matchedSubjects = new Set(rows.map(row => canonicalSubject(row.subjectName)).filter(Boolean))
  const unmatchedSubjects = expectedSubjects.filter(subject => !matchedSubjects.has(subject))
  if (unmatchedSubjects.length > 0) {
    lines.push(`다음 연계 교과는 현재 주제·학년군 조건에서 충분히 관련된 성취기준을 찾지 못해 제외했습니다: ${unmatchedSubjects.join(', ')}`)
  }

  lines.push('교육과정 데이터에 매핑되지 않은 핵심아이디어는 표시하지 않았습니다. 필요한 경우 지식 그래프에서 성취기준을 먼저 선택한 뒤 분석표를 생성해야 합니다.')
  return lines.join('\n')
}

function isCoreIdeaStandardsQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, '')
  return /성취기준/.test(normalized) && /핵심아이디어|핵심아이디어는|핵심아이디어가/.test(normalized)
}

function selectCoreIdea(ideas: string[], queryText: string): string {
  const candidates = normalizeCoreIdeaCandidates(ideas)
  if (candidates.length === 0) return ''
  if (candidates.length === 1) return candidates[0]

  const queryTerms = extractTerms(queryText)
  let best = candidates[0]
  let bestScore = -1

  for (const candidate of candidates) {
    const candidateTerms = extractTerms(candidate)
    const score = [...candidateTerms].reduce((sum, term) => {
      if (queryTerms.has(term)) return sum + 3
      for (const q of queryTerms) {
        if (q.includes(term) || term.includes(q)) return sum + 1
      }
      return sum
    }, 0)

    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}

function normalizeCoreIdeaCandidates(ideas: string[]): string[] {
  const cleaned = [...new Set(ideas.map(cleanText).filter(Boolean))]
  const sentenceLike = cleaned.filter(idea =>
    idea.length >= 20 &&
    !idea.startsWith('[별표') &&
    !/권장 언어 형식|기본 어휘|예시문|소재$/.test(idea) &&
    /(다\.?|한다\.?|된다\.?|준다\.?|갖는다\.?)$/.test(idea)
  )

  return (sentenceLike.length > 0 ? sentenceLike : cleaned)
    .filter(idea => !idea.startsWith('[별표'))
    .slice(0, 4)
}

function extractTerms(text: string): Set<string> {
  const stopwords = new Set([
    '성취기준', '핵심아이디어', '교육과정', '학생', '수업', '교과', '관련', '활용',
    '이해', '분석', '탐구', '표현', '과정', '내용', '방법', '주제', '영역',
  ])

  return new Set(
    (text.match(/[가-힣A-Za-z0-9]+/g) ?? [])
      .map(token => normalize(token))
      .map(token => stripKoreanSuffix(token))
      .filter(token => token.length >= 2 && !stopwords.has(token))
  )
}

function stripKoreanSuffix(value: string): string {
  const suffixes = ['에서', '으로', '에게', '까지', '부터', '보다', '이나', '이며', '이고', '하는', '하기', '한다', '하여', '하며', '의', '을', '를', '이', '가', '은', '는', '도', '와', '과', '에', '로']
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 2) {
      return value.slice(0, -suffix.length)
    }
  }
  return value
}

function collectStandardsFromGraphData(graphSavedData?: GraphSavedData | null): CurriculumStandard[] | null {
  if (!graphSavedData) return null

  const graph = loadGraph()
  if (!graph) return null

  const ids = [
    graphSavedData.centerNode?.id,
    ...graphSavedData.selectedStandards.map(standard => standard.id),
  ].filter((id): id is string => Boolean(id))

  if (ids.length === 0) return null

  const seen = new Set<string>()
  const standards: CurriculumStandard[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const standard = graph.achievementStandards.find(item => item.id === id)
    if (!standard) continue
    seen.add(id)
    standards.push(standard)
  }

  return standards.length > 0 ? standards.slice(0, MAX_STANDARDS) : null
}

function collectStandardsFromSearch(
  messages: Array<{ role: string; content: string }>,
  gradeGroup?: string,
  targetSubjects: ProjectTargetSubjects['targetSubjects'] = [],
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>,
  a12Context: A12Context = { selectedTopic: '', subjectPlans: new Map() },
): CurriculumStandard[] {
  const graph = loadGraph()
  if (!graph) return []

  const subjectNameMap = new Map(graph.subjects.map(subject => [subject.id, subject.name_ko]))
  const constrainedSubjects = a12Context.subjectPlans.size > 0
    ? [...a12Context.subjectPlans.keys()]
    : targetSubjects

  if (constrainedSubjects.length > 0) {
    return collectOneStandardPerSubject(constrainedSubjects, a12Context, gradeGroup, subjectNameMap)
  }

  const keywords = extractKeywords(messages, confirmedArtifacts)
  if (keywords.length === 0) return []

  const filtered = searchStandards(keywords, gradeGroup, 40, 5)
  const bySubject = new Map<string, CurriculumStandard>()
  for (const standard of filtered) {
    if (bySubject.has(standard.subject_id)) continue
    bySubject.set(standard.subject_id, standard)
  }

  return [...bySubject.values()].slice(0, MAX_STANDARDS)
}

interface A12Context {
  selectedTopic: string
  subjectPlans: Map<string, string>
}

function collectOneStandardPerSubject(
  subjects: string[],
  a12Context: A12Context,
  gradeGroup: string | undefined,
  subjectNameMap: Map<string, string>,
): CurriculumStandard[] {
  const selected: CurriculumStandard[] = []
  const seenSubjectIds = new Set<string>()

  for (const subject of subjects) {
    const subjectQuery = [
      a12Context.selectedTopic,
      a12Context.subjectPlans.get(subject) ?? '',
      subject,
    ].filter(Boolean).join(' ')
    const keywords = extractKeywords([{ role: 'user', content: subjectQuery }])
    if (keywords.length === 0) continue

    const match = searchStandards(keywords, gradeGroup, 30, 3)
      .find(standard => {
        const subjectName = subjectNameMap.get(standard.subject_id) ?? ''
        return matchesTargetSubject(subjectName, [subject]) && !seenSubjectIds.has(standard.subject_id)
      })

    if (!match) continue
    seenSubjectIds.add(match.subject_id)
    selected.push(match)
  }

  return selected.slice(0, MAX_STANDARDS)
}

function extractA12Context(
  messages: Array<{ role: string; content: string }>,
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>,
): A12Context {
  const subjectPlans = new Map<string, string>()
  let selectedTopic = ''

  const a12Content = confirmedArtifacts?.['A-1-2']?.content
  if (a12Content) {
    selectedTopic = readFirstString(a12Content, ['selectedTopic', '최종 선정 주제', '선정 주제', '주제'])
    const linkedSubjects = Array.isArray(a12Content['linkedSubjects'])
      ? a12Content['linkedSubjects']
      : []
    linkedSubjects.forEach(item => {
      if (!item || typeof item !== 'object') return
      const subject = canonicalSubject(String((item as { subject?: unknown }).subject ?? ''))
      const focus = cleanText(String((item as { focus?: unknown }).focus ?? ''))
      if (subject && focus && !subjectPlans.has(subject)) subjectPlans.set(subject, focus)
    })
    const artifactText = Object.values(a12Content)
      .map(value => typeof value === 'string' ? value : JSON.stringify(value))
      .join('\n')
    parseSubjectPlans(artifactText, subjectPlans)
  }

  for (const message of messages) {
    if (!selectedTopic) {
      const match = message.content.match(/(?:최종\s*선정\s*주제|선정\s*주제)\s*[:：]\s*([^\n]+)/)
      if (match) selectedTopic = cleanText(match[1])
    }
    parseSubjectPlans(message.content, subjectPlans)
  }

  return { selectedTopic, subjectPlans }
}

function parseSubjectPlans(text: string, out: Map<string, string>): void {
  const lines = text.split('\n').map(line => cleanText(line)).filter(Boolean)
  const subjectNames = Object.keys(SUBJECT_ALIASES)
  for (const line of lines) {
    const withoutBullet = line.replace(/^[-•*\d.\s]+/, '').trim()
    const match = withoutBullet.match(/^([가-힣·]+)\s*[:：]\s*(.+)$/)
    if (!match) continue

    const subject = canonicalSubject(match[1])
    if (!subject || !subjectNames.includes(subject)) continue
    if (!out.has(subject)) out.set(subject, cleanText(match[2]))
  }
}

function canonicalSubject(value: string): string {
  const normalized = normalize(value)
  for (const [subject, aliases] of Object.entries(SUBJECT_ALIASES)) {
    if (aliases.some(alias => normalize(alias) === normalized)) return subject
  }
  return ''
}

function readFirstString(content: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = content[key]
    if (typeof value === 'string' && value.trim()) return cleanText(value)
  }
  return ''
}

function matchesTargetSubject(subjectName: string, targetSubjects: string[]): boolean {
  if (targetSubjects.length === 0) return true
  const normalizedSubject = normalize(subjectName)
  return targetSubjects.some(target => {
    const canonical = canonicalSubject(target)
    const normalizedTarget = normalize(canonical || target)
    return normalizedSubject.includes(normalizedTarget) || normalizedTarget.includes(normalizedSubject)
  })
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').replace(/[·⋅]/g, '').replace(/과$/, '')
}

function cleanText(value: string): string {
  return value.replace(/\*\*/g, '').replace(/`/g, '').trim()
}

function formatCode(code: string): string {
  return code.startsWith('[') ? code : `[${code}]`
}

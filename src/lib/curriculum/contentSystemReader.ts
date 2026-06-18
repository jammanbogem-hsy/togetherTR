/**
 * Curriculum content-system reader (server only).
 *
 * This module is intentionally additive. It reads the extracted content-system
 * JSON files and can provide optional prompt context, but it does not replace
 * achievement-standard search or knowledge-graph behavior.
 */

import fs from 'fs'
import path from 'path'
import type { ActivityCode } from '@/types'
import { loadGraph } from './graphReader'

type CategoryKey = '지식⋅이해' | '과정⋅기능' | '가치⋅태도'

const CATEGORY_KEYS: CategoryKey[] = ['지식⋅이해', '과정⋅기능', '가치⋅태도']

export interface ContentSystemRecord {
  id: string
  sourceFile: string
  sourcePages: number[]
  curriculum: string
  subject: string
  course: string
  area: string
  gradeBands: string[]
  coreIdeas: string[]
  knowledge: string[]
  functions: string[]
  attitudes: string[]
}

export interface ContentSystemHit extends ContentSystemRecord {
  score: number
  matchedKeywords: string[]
}

interface SearchContentSystemsOptions {
  keywords: string[]
  gradeGroup?: string
  targetSubjects?: string[]
  topK?: number
  minScore?: number
}

type RawObject = Record<string, unknown>

let contentSystemCache: ContentSystemRecord[] | null = null
let elementaryContentSystemCache: ContentSystemRecord[] | null = null
// [2026-05-14] dev 환경에선 JSON 수정 즉시 반영을 위해 캐시 비활성. prod는 그대로.
const CACHE_ENABLED = process.env.NODE_ENV !== 'development'

const GRAPH_SUBJECT_NAME: Record<string, string> = {
  sub_kor: '국어',
  sub_math: '수학',
  sub_sci: '과학',
  sub_soc: '사회',
  sub_mor: '도덕',
  sub_art: '미술',
  sub_mus: '음악',
  sub_pe: '체육',
  sub_eng: '영어',
  sub_prac: '실과',
  sub_int: '통합교과',
}

export function isContentSystemContextEnabled(): boolean {
  // 기본 활성화 — 내용체계 데이터가 있으면 자동으로 AI 컨텍스트에 주입
  const value = process.env.CURRICULUM_CONTENT_SYSTEM_CONTEXT?.trim().toLowerCase()
  if (value === '0' || value === 'false' || value === 'off') return false
  return true
}

function findContentSystemDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data/curriculum-content-systems'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

export function loadContentSystems(): ContentSystemRecord[] {
  if (CACHE_ENABLED && contentSystemCache) return contentSystemCache

  const dir = findContentSystemDir()
  if (!dir) {
    contentSystemCache = []
    return contentSystemCache
  }

  const records: ContentSystemRecord[] = []
  for (const fileName of fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, fileName), 'utf-8')) as RawObject
      const metadata = asObject(raw['메타'])
      const subjectFromMetadata = asString(metadata?.['교과'])
      const entries = Array.isArray(raw['내용체계']) ? raw['내용체계'] : []

      entries.forEach((entryValue, index) => {
        const entry = asObject(entryValue)
        if (!entry) return

        const categories = extractCategories(entry)
        records.push({
          id: `${fileName}#${index}`,
          sourceFile: fileName,
          sourcePages: asNumberArray(entry['출처쪽']),
          curriculum: asString(entry['교육과정']),
          subject: subjectFromMetadata || asString(entry['과목']),
          course: asString(entry['과목']),
          area: asString(entry['영역']),
          gradeBands: extractGradeBands(entry),
          coreIdeas: normalizeCoreIdeas(asStringArray(entry['핵심아이디어'])),
          knowledge: categories['지식⋅이해'],
          functions: categories['과정⋅기능'],
          attitudes: categories['가치⋅태도'],
        })
      })
    } catch {
      // Ignore a single malformed file. The validation script is responsible
      // for failing CI or local checks when source JSON is invalid.
    }
  }

  contentSystemCache = records
  return contentSystemCache
}

export function loadElementaryContentSystems(): ContentSystemRecord[] {
  if (CACHE_ENABLED && elementaryContentSystemCache) return elementaryContentSystemCache

  const rawRecords = loadContentSystems()
  const graphRecords = buildElementaryGraphContentSystems(rawRecords)
  const graphSubjects = new Set(graphRecords.map(record => normalizeSubject(record.subject)))
  const supplementalRecords = rawRecords
    .filter(record => !record.curriculum.trim().startsWith('선택 중심 교육과정'))
    .filter(record => !graphSubjects.has(normalizeSubject(record.subject)))

  elementaryContentSystemCache = [...graphRecords, ...supplementalRecords]
  return elementaryContentSystemCache
}

function buildElementaryGraphContentSystems(rawRecords: ContentSystemRecord[] = []): ContentSystemRecord[] {
  const graph = loadGraph()
  if (!graph) return []

  const standardsByCoreIdea = new Map<string, typeof graph.achievementStandards>()
  for (const standard of graph.achievementStandards ?? []) {
    if (!standard.core_idea_id) continue
    const current = standardsByCoreIdea.get(standard.core_idea_id) ?? []
    current.push(standard)
    standardsByCoreIdea.set(standard.core_idea_id, current)
  }

  // 같은 (subject, area)에 학년군별로 쪼개진 coreIdea들을 단일 record로 병합.
  // 그렇지 않으면 lookup에서 첫 매칭(예: 3-4 학년군 record)을 잡고 filterByGrade('초5-6')하면
  // 빈 결과가 되어 5-6학년 사용자가 빈 셀을 보거나 검증 오류를 만남.
  type Group = {
    subject: string
    area: string
    coreIdeaIds: string[]
    ideas: string[]
    standards: typeof graph.achievementStandards
  }
  const groups = new Map<string, Group>()
  for (const coreIdea of graph.coreIdeas ?? []) {
    const subject = GRAPH_SUBJECT_NAME[coreIdea.subject_id] ?? graph.subjects.find(item => item.id === coreIdea.subject_id)?.name_ko ?? coreIdea.subject_id
    if (subject === '창의적 체험활동') continue
    const area = normalizeAreaLabel(coreIdea.area)
    const key = `${subject}::${area}`
    const standards = standardsByCoreIdea.get(coreIdea.id) ?? []
    const existing = groups.get(key)
    if (existing) {
      existing.coreIdeaIds.push(coreIdea.id)
      existing.ideas.push(...(coreIdea.ideas ?? []))
      existing.standards.push(...standards)
    } else {
      groups.set(key, {
        subject,
        area,
        coreIdeaIds: [coreIdea.id],
        ideas: [...(coreIdea.ideas ?? [])],
        standards: [...standards],
      })
    }
  }

  return [...groups.values()]
    .map((group): ContentSystemRecord | null => {
      const coreIdeas = unique(normalizeCoreIdeas(group.ideas))
      if (coreIdeas.length === 0) return null
      const gradeBands = unique(group.standards.map(s => formatGradeBand(s.grade_band)).filter(Boolean))
      const rawRecord = findRawContentSystemRecord(rawRecords, group.subject, group.area)
      // [절대 규칙 2026-05-14] graph의 standard-레벨 knowledge/functions는 학년군 매핑이 부정확하다.
      // 예: data/elementary_knowledge_graph.json의 모든 수학 standards(초1-2/3-4/5-6)에 동일하게
      //     ['대푯값','도수분포표와 상대도수','경우의 수와 확률','산포도','상자그림과 산점도'](중학교 내용)
      //     이 잘못 복제되어 있어, prefixedContentByGrade가 "5-6학년군: 대푯값" 같이 잘못 라벨링.
      // → 큐레이션된 PDF 데이터(rawRecord = data/curriculum-content-systems/*.json)만 사용.
      //   rawRecord가 없으면 빈 배열을 반환해 자동 매핑을 안 함이 잘못된 자동 매핑보다 안전.
      const rawKnowledge = cleanContentItems(rawRecord?.knowledge ?? [])
      const rawFunctions = cleanContentItems(rawRecord?.functions ?? [])
      const rawAttitudes = cleanContentItems(rawRecord?.attitudes ?? [])

      return {
        id: `elementary_knowledge_graph.json#${group.coreIdeaIds.join('+')}`,
        sourceFile: 'elementary_knowledge_graph.json',
        sourcePages: [],
        curriculum: '공통 교육과정',
        subject: group.subject,
        course: group.subject,
        area: group.area,
        gradeBands,
        coreIdeas,
        knowledge: rawKnowledge,
        functions: rawFunctions,
        attitudes: rawAttitudes,
      }
    })
    .filter((record): record is ContentSystemRecord => Boolean(record))
}

function findRawContentSystemRecord(
  records: ContentSystemRecord[],
  subject: string,
  area: string,
): ContentSystemRecord | undefined {
  return records.find(record =>
    !record.curriculum.trim().startsWith('선택 중심 교육과정') &&
    sameSubject(record.subject || record.course, subject) &&
    sameArea(record.area, area)
  )
}

function sameSubject(a: string, b: string): boolean {
  const na = normalizeSubject(a)
  const nb = normalizeSubject(b)
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na))
}

function sameArea(a: string, b: string): boolean {
  const na = normalizeAreaForMatch(a)
  const nb = normalizeAreaForMatch(b)
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na))
}

function normalizeAreaForMatch(value: string): string {
  return normalizeKeyword(value.replace(/\([^)]*\)/g, ''))
}

function cleanContentItems(items: string[]): string[] {
  return unique(items.map(cleanContentText).filter(Boolean))
}

function prefixedContentByGrade(
  standards: Array<{ grade_band?: string; knowledge?: string[]; functions?: string[]; competencies?: string[] }>,
  field: 'knowledge' | 'functions' | 'competencies',
  fallback: string[],
): string[] {
  const byGrade = new Map<string, string[]>()
  for (const standard of standards) {
    const gradeBand = formatGradeBand(standard.grade_band)
    if (!gradeBand) continue
    const current = byGrade.get(gradeBand) ?? []
    current.push(...((standard[field] ?? []) as string[]))
    byGrade.set(gradeBand, unique(current.map(cleanContentText).filter(Boolean)))
  }

  const prefixed = [...byGrade.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .flatMap(([gradeBand, items]) => items.map(item => `${gradeBand}: ${item}`))

  if (prefixed.length > 0) return prefixed
  return unique(fallback.map(cleanContentText).filter(Boolean))
}

function formatGradeBand(value?: string): string {
  const normalized = (value ?? '').replace(/^초/, '').replace(/~/g, '-').trim()
  if (!normalized) return ''
  if (/^\d-\d$/.test(normalized)) return `${normalized}학년군`
  if (/^\d-\d학년군$/.test(normalized)) return normalized
  return normalized
}

function normalizeAreaLabel(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/·/g, '⋅').trim()
}

function cleanContentText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/·/g, '⋅')
    .replace(/\s+([,.)])/g, '$1')
    .trim()
}

function normalizeCoreIdeas(items: string[]): string[] {
  const out: string[] = []
  let pending = ''

  for (const item of items) {
    const cleaned = cleanCoreIdeaFragment(item)
    if (!cleaned) continue

    if (!pending) {
      pending = cleaned
    } else if (isCompleteCoreIdea(pending)) {
      pushCoreIdea(out, pending)
      pending = cleaned
    } else {
      pending = joinCoreIdeaFragments(pending, cleaned)
    }

    if (isCompleteCoreIdea(pending)) {
      pushCoreIdea(out, pending)
      pending = ''
    }
  }

  if (isCompleteCoreIdea(pending)) pushCoreIdea(out, pending)
  return unique(out)
}

function cleanCoreIdeaFragment(value: string): string {
  let cleaned = value
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/·/g, '⋅')
    .replace(/\s+([,.)])/g, '$1')
    .trim()

  if (!cleaned) return ''
  if (/^\[별표\s*\d+\]/.test(cleaned)) return ''
  if (/^(핵심\s*아이디어|핵심아이디어|내용\s*요소|지식\s*⋅?\s*이해|과정\s*⋅?\s*기능|가치\s*⋅?\s*태도)$/.test(cleaned)) return ''
  if (/^(초등학교|중학교|고등학교|\d~\d학년|\d-\d학년)/.test(cleaned)) return ''

  const schoolHeaderIndex = cleaned.search(/\s+(초등학교|중학교|고등학교)\s+/)
  if (schoolHeaderIndex > 0) cleaned = cleaned.slice(0, schoolHeaderIndex).trim()

  return cleaned
}

function joinCoreIdeaFragments(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  if (/^\d/.test(right) && /^\d+$/.test(left)) return `${left}⋅${right}`
  if (/([가-힣]+적|분석|해석|판단|평가|연구|개발|제작|활용|교통|사회|문화|과학|기술|산화|환원)$/.test(left) && /^[가-힣]+/.test(right)) {
    return `${left}⋅${right}`
  }
  return `${left} ${right}`
}

function isCompleteCoreIdea(value: string): boolean {
  const cleaned = value.trim()
  if (cleaned.length < 18) return false
  return /다[.!?]?$/.test(cleaned)
}

function pushCoreIdea(out: string[], value: string) {
  const cleaned = cleanCoreIdeaFragment(value)
  if (!isCompleteCoreIdea(cleaned)) return
  if (!out.includes(cleaned)) out.push(cleaned)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function searchContentSystems({
  keywords,
  gradeGroup,
  targetSubjects = [],
  topK = 8,
  minScore = 4,
}: SearchContentSystemsOptions): ContentSystemHit[] {
  const normalizedKeywords = [...new Set(keywords.map(normalizeKeyword).filter(Boolean))]
  if (normalizedKeywords.length === 0) return []

  // [strict-elementary 2026-05-14] 이 웹앱은 초등 전용 — gradeGroup이 비초등이라도 강제로 초등 사용.
  // Why: 사용자가 초등 프로젝트에 중·고 내용이 매핑되는 사례를 보고. content systems 단계에서 차단.
  const records = loadElementaryContentSystems()

  return records
    .filter(record => matchesGradeGroup(record, gradeGroup))
    .map(record => scoreRecord(record, normalizedKeywords, targetSubjects))
    .filter((hit): hit is ContentSystemHit => !!hit && hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export function isElementaryGradeGroup(gradeGroup?: string | null): boolean {
  return !!gradeGroup?.replace(/^초/, '').replace(/~/g, '-').trim().match(/^(1-2|3-4|5-6)/)
}

export function buildContentSystemContext(
  activityCode: ActivityCode,
  keywords: string[],
  gradeGroup?: string,
  targetSubjects?: string[],
): string {
  if (!isContentSystemContextEnabled()) return ''

  const hits = searchContentSystems({ keywords, gradeGroup, targetSubjects })
  if (hits.length === 0) return ''

  return `\n\n---\n${formatContentSystemContext(activityCode, hits)}`
}

function formatContentSystemContext(activityCode: ActivityCode, hits: ContentSystemHit[]): string {
  const guidance = getActivityGuidance(activityCode)
  const blocks = hits.map(hit => {
    const pages = hit.sourcePages.length > 0 ? ` / 출처쪽: ${hit.sourcePages.join(', ')}` : ''
    const gradeBands = hit.gradeBands.length > 0 ? ` / 학년군: ${hit.gradeBands.join(', ')}` : ''
    return `[${hit.subject} / ${hit.course} / ${hit.area}${gradeBands}${pages}]
핵심아이디어: ${take(hit.coreIdeas, 2).join(' / ') || '(없음)'}
지식⋅이해: ${take(hit.knowledge, 6).join(', ') || '(없음)'}
과정⋅기능: ${take(hit.functions, 6).join(', ') || '(없음)'}
가치⋅태도: ${take(hit.attitudes, 5).join(', ') || '(없음)'}
매칭 키워드: ${hit.matchedKeywords.join(', ')}`
  })

  return `## 내용체계 기반 보조 근거

아래 정보는 성취기준 검색과 지식 그래프를 대체하지 않는 보조 근거입니다.
기존 성취기준 코드, 지식 그래프 선택 결과, A-2-1 표 형식을 우선 유지하세요.
${guidance}

${blocks.join('\n\n')}`
}

function getActivityGuidance(activityCode: ActivityCode): string {
  switch (activityCode) {
    case 'A-1-2':
      return '주제 후보를 비교할 때 핵심아이디어의 공통 문제의식과 과목별 기여 가능성을 근거로만 활용하세요.'
    case 'A-2-1':
      return '⛔ 핵심아이디어는 [📋 사전 구축된 분석표]의 값을 그대로 사용하세요 (AI 생성·의역 금지). 지식⋅이해, 과정⋅기능, 가치⋅태도 칸도 아래 내용체계 원문에서 선택하여 인용하세요.'
    case 'A-2-2':
      return '통합 수업목표가 지식, 수행, 태도 차원을 모두 포함하는지 점검하는 근거로 활용하세요.'
    case 'Ds-1-1':
      return '평가 계획에서는 지식⋅이해, 과정⋅기능, 가치⋅태도를 루브릭 축으로 전환할 때 참고하세요.'
    case 'Ds-1-3':
      return '학습활동 설계에서는 과정⋅기능을 활동 동사와 수행 절차로 전환할 때 참고하세요.'
    default:
      return '설계 단계에서는 기존 A단계 산출물과 충돌하지 않는 범위에서 보조 검산 자료로만 활용하세요.'
  }
}

function scoreRecord(
  record: ContentSystemRecord,
  keywords: string[],
  targetSubjects: string[],
): ContentSystemHit | null {
  let score = 0
  const matchedKeywords = new Set<string>()

  const subjectMatched = targetSubjects.some(subject => matchesSubject(record, subject))
  if (subjectMatched) score += 4

  for (const keyword of keywords) {
    let keywordScore = 0
    keywordScore += scoreTexts([record.subject, record.course], keyword, 2)
    keywordScore += scoreTexts([record.area], keyword, 4)
    keywordScore += scoreTexts(record.coreIdeas, keyword, 6)
    keywordScore += scoreTexts(record.knowledge, keyword, 4)
    keywordScore += scoreTexts(record.functions, keyword, 4)
    keywordScore += scoreTexts(record.attitudes, keyword, 3)
    if (keywordScore > 0) matchedKeywords.add(keyword)
    score += keywordScore
  }

  if (score === 0) return null
  return { ...record, score, matchedKeywords: [...matchedKeywords] }
}

function scoreTexts(texts: string[], keyword: string, weight: number): number {
  for (const text of texts) {
    const normalized = normalizeKeyword(text)
    if (normalized === keyword) return weight + 3
    if (normalized.includes(keyword) || keyword.includes(normalized)) return weight
  }
  return 0
}

function extractCategories(entry: RawObject): Record<CategoryKey, string[]> {
  const out: Record<CategoryKey, string[]> = {
    '지식⋅이해': [],
    '과정⋅기능': [],
    '가치⋅태도': [],
  }

  const contentElements = asObject(entry['내용요소'])
  if (contentElements) {
    for (const key of CATEGORY_KEYS) {
      out[key].push(...asStringArray(contentElements[key]))
    }
  }

  const gradeBands = asObject(entry['학년군별'])
  if (gradeBands) {
    for (const [gradeBand, categoriesValue] of Object.entries(gradeBands)) {
      const categories = asObject(categoriesValue)
      if (!categories) continue
      for (const key of CATEGORY_KEYS) {
        out[key].push(...asStringArray(categories[key]).map(item => `${gradeBand}: ${item}`))
      }
    }
  }

  return out
}

function extractGradeBands(entry: RawObject): string[] {
  const gradeBands = asObject(entry['학년군별'])
  return gradeBands ? Object.keys(gradeBands) : []
}

function matchesGradeGroup(record: ContentSystemRecord, gradeGroup?: string): boolean {
  if (!gradeGroup) return true
  if (record.gradeBands.length === 0) {
    return !record.curriculum.trim().startsWith('선택 중심 교육과정')
  }

  const aliases: Record<string, string[]> = {
    '초1-2': ['초1-2', '1-2', '1~2'],
    '초3-4': ['초3-4', '3-4', '3~4'],
    '초5-6': ['초5-6', '5-6', '5~6'],
    '중1-3': ['중1-3', '1-3', '1~3', '중학교'],
    '고공통': ['고공통', '고등학교', '공통'],
    '고선택': ['고선택', '고등학교', '선택'],
  }
  const targets = aliases[gradeGroup] ?? [gradeGroup]
  const normalizedBands = record.gradeBands.map(normalizeKeyword)
  return targets.some(target => normalizedBands.some(band => band.includes(normalizeKeyword(target))))
}

function matchesSubject(record: ContentSystemRecord, targetSubject: string): boolean {
  const target = normalizeSubject(targetSubject)
  if (!target) return false
  const candidates = [record.subject, record.course].map(normalizeSubject)
  if (target === '창체') return candidates.some(candidate => candidate.includes('창의적체험활동'))
  if (target === '통합교과') {
    return candidates.some(candidate =>
      candidate.includes('통합교과') ||
      candidate.includes('바른생활') ||
      candidate.includes('슬기로운생활') ||
      candidate.includes('즐거운생활')
    )
  }
  return candidates.some(candidate => candidate.includes(target) || target.includes(candidate))
}

function normalizeSubject(value: string): string {
  return normalizeKeyword(value).replace(/과$/, '')
}

function normalizeKeyword(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()[\]{}"'`.,:;!?/\\|_-]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function asObject(value: unknown): RawObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawObject : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : []
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .flatMap(item => {
      if (typeof item === 'string') return [item.trim()]
      const object = asObject(item)
      if (!object) return []

      const question = asString(object['질문'])
      const elements = asStringArray(object['요소'])
      if (question && elements.length > 0) return [`${question}: ${elements.join(', ')}`]
      if (elements.length > 0) return elements
      return []
    })
    .filter(Boolean)
}

function take(items: string[], max: number): string[] {
  return items.slice(0, max)
}

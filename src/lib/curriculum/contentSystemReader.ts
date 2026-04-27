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

export function isContentSystemContextEnabled(): boolean {
  const value = process.env.CURRICULUM_CONTENT_SYSTEM_CONTEXT?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'enabled' || value === 'on'
}

function findContentSystemDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data/curriculum-content-systems'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

export function loadContentSystems(): ContentSystemRecord[] {
  if (contentSystemCache) return contentSystemCache

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
          coreIdeas: asStringArray(entry['핵심아이디어']),
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

export function searchContentSystems({
  keywords,
  gradeGroup,
  targetSubjects = [],
  topK = 8,
  minScore = 4,
}: SearchContentSystemsOptions): ContentSystemHit[] {
  const normalizedKeywords = [...new Set(keywords.map(normalizeKeyword).filter(Boolean))]
  if (normalizedKeywords.length === 0) return []

  return loadContentSystems()
    .filter(record => matchesGradeGroup(record, gradeGroup))
    .map(record => scoreRecord(record, normalizedKeywords, targetSubjects))
    .filter((hit): hit is ContentSystemHit => !!hit && hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
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
      return '성취기준 분석표의 핵심아이디어, 지식⋅이해, 과정⋅기능, 가치⋅태도 칸을 채울 때만 참고하고 표의 열 구조는 바꾸지 마세요.'
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
  if (!gradeGroup || record.gradeBands.length === 0) return true

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

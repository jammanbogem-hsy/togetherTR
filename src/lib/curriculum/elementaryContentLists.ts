/**
 * Elementary content-system lists (server only).
 *
 * Single source of truth for 지식⋅이해 / 과정⋅기능 / 가치⋅태도 per
 * (subject, area, 학년군), read from data/curriculum-content-systems/*.json
 * (`학년군별` key, elementary bands only).
 *
 * Why this module exists: elementary_knowledge_graph.json and
 * public/curriculum_json copy the 초·중 common core-idea group lists, which are
 * mostly 중학교 1~3학년 items (e.g. 과학 '옴의 법칙', 수학 '소인수분해'). This
 * web app is elementary-only, so every reader replaces those lists with the
 * band-specific content-system items via `applyElementaryContentLists`, and
 * scripts/verify-curriculum-linkage.mjs fails if a 중학교 item ever surfaces.
 */

import fs from 'fs'
import path from 'path'
import { readOncePerCurriculumContext } from './readCache'

export const ELEMENTARY_BANDS = ['1-2학년군', '3-4학년군', '5-6학년군'] as const
export type ElementaryBand = (typeof ELEMENTARY_BANDS)[number]

export interface BandLists {
  knowledge: string[]
  functions: string[]
  attitudes: string[]
}

export interface ElementaryContentEntry {
  file: string
  subject: string
  course: string
  area: string
  pages: number[]
  coreIdeas: string[]
  bands: Partial<Record<ElementaryBand, BandLists>>
}

const CATEGORY_TO_FIELD: Record<string, keyof BandLists> = {
  '지식⋅이해': 'knowledge',
  '과정⋅기능': 'functions',
  '가치⋅태도': 'attitudes',
}

/** Graph subject id → content-system 교과 name (메타.교과). */
export const GRAPH_SUBJECT_TO_CONTENT_SUBJECT: Record<string, string> = {
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
  sub_extra: '창의적 체험활동',
}

/**
 * Graph areas that are a merge/rename of content-system areas.
 * Key: `${content subject}::${normalized graph area}`.
 */
const AREA_ALIAS: Record<string, string[]> = {
  '사회::자연인문환경과인간생활': ['자연환경과 인간생활', '인문환경과 인간생활'],
  '사회::인문환경지속가능한세계': ['인문환경과 인간생활', '지속가능한 세계'],
  '영어::이해': ['이해(reception)'],
  '영어::표현': ['표현(production)'],
}

const CACHE_ENABLED = process.env.NODE_ENV !== 'development'
let entriesCache: ElementaryContentEntry[] | null = null

export function normalizeCurriculumKey(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[()[\]{}"'`.,:;!?/\\|_\-·⋅•・]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function normalizeSubjectKey(value: string): string {
  return normalizeCurriculumKey(value).replace(/과$/, '')
}

/** '초3-4' | '3-4학년군' | '3~4학년군' | '초등학교 3-4학년' → '3-4학년군'; non-elementary → null. */
export function toElementaryBand(gradeBand?: string | null): ElementaryBand | null {
  const raw = (gradeBand ?? '').trim()
  if (!raw || /중|고/.test(raw)) return null
  const match = raw.match(/(\d)\s*[-~]\s*(\d)/)
  if (!match) return null
  const band = `${match[1]}-${match[2]}학년군`
  return (ELEMENTARY_BANDS as readonly string[]).includes(band) ? (band as ElementaryBand) : null
}

function findContentSystemDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data/curriculum-content-systems'),
    path.join(process.cwd(), 'public/curriculum-content-systems'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

type RawObject = Record<string, unknown>

function asObject(value: unknown): RawObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawObject) : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanItem(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/·/g, '⋅').replace(/\s+([,.)])/g, '$1').trim()
}

function asItemList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      const cleaned = cleanItem(item)
      if (cleaned && !out.includes(cleaned)) out.push(cleaned)
      continue
    }
    const object = asObject(item)
    if (!object) continue
    const question = asString(object['질문'])
    const elements = asItemList(object['요소'])
    if (question && elements.length > 0) out.push(`${question}: ${elements.join(', ')}`)
    else out.push(...elements.filter(element => !out.includes(element)))
  }
  return out
}

export function loadElementaryContentEntries(): ElementaryContentEntry[] {
  return readOncePerCurriculumContext('elementary-content-entries', readElementaryContentEntries)
}

function readElementaryContentEntries(): ElementaryContentEntry[] {
  if (CACHE_ENABLED && entriesCache) return entriesCache

  const dir = findContentSystemDir()
  const entries: ElementaryContentEntry[] = []
  if (!dir) {
    entriesCache = entries
    return entries
  }

  for (const fileName of fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
    let raw: RawObject | null
    try {
      raw = asObject(JSON.parse(fs.readFileSync(path.join(dir, fileName), 'utf-8')))
    } catch {
      continue
    }
    if (!raw) continue
    const subject = asString(asObject(raw['메타'])?.['교과'])
    const records = Array.isArray(raw['내용체계']) ? raw['내용체계'] : []

    for (const recordValue of records) {
      const record = asObject(recordValue)
      if (!record) continue
      if (asString(record['교육과정']).startsWith('선택 중심 교육과정')) continue
      const bandsRaw = asObject(record['학년군별'])
      if (!bandsRaw) continue

      const bands: Partial<Record<ElementaryBand, BandLists>> = {}
      for (const [bandName, categoriesValue] of Object.entries(bandsRaw)) {
        const band = toElementaryBand(bandName)
        const categories = asObject(categoriesValue)
        if (!band || !categories) continue
        const lists: BandLists = { knowledge: [], functions: [], attitudes: [] }
        for (const [category, field] of Object.entries(CATEGORY_TO_FIELD)) {
          lists[field] = asItemList(categories[category])
        }
        bands[band] = lists
      }
      if (Object.keys(bands).length === 0) continue

      entries.push({
        file: fileName,
        subject: subject || asString(record['과목']),
        course: asString(record['과목']),
        area: asString(record['영역']),
        pages: Array.isArray(record['출처쪽']) ? record['출처쪽'].filter((p): p is number => typeof p === 'number') : [],
        coreIdeas: Array.isArray(record['핵심아이디어']) ? record['핵심아이디어'].filter((s): s is string => typeof s === 'string') : [],
        bands,
      })
    }
  }

  entriesCache = entries
  return entries
}

function resolveSubjectName(subjectIdOrName: string): string {
  return GRAPH_SUBJECT_TO_CONTENT_SUBJECT[subjectIdOrName] ?? subjectIdOrName
}

/**
 * Content-system entries for a graph (subject, area). Exact normalized area
 * match first, then alias table, then containment either way.
 */
export function findElementaryContentEntries(subjectIdOrName: string, area: string): ElementaryContentEntry[] {
  const subjectKey = normalizeSubjectKey(resolveSubjectName(subjectIdOrName))
  if (!subjectKey) return []
  const entries = loadElementaryContentEntries().filter(entry => {
    const entrySubject = normalizeSubjectKey(entry.subject)
    return entrySubject === subjectKey || entrySubject.includes(subjectKey) || subjectKey.includes(entrySubject)
  })
  if (entries.length === 0) return []

  const areaKey = normalizeCurriculumKey(area)
  const wanted = AREA_ALIAS[`${resolveSubjectName(subjectIdOrName)}::${areaKey}`]?.map(normalizeCurriculumKey) ?? [areaKey]

  const out: ElementaryContentEntry[] = []
  for (const wantedKey of wanted) {
    if (!wantedKey) continue
    let hits = entries.filter(entry => normalizeCurriculumKey(entry.area) === wantedKey)
    if (hits.length === 0) {
      hits = entries.filter(entry => {
        const entryKey = normalizeCurriculumKey(entry.area)
        return entryKey.length >= 2 && (entryKey.includes(wantedKey) || wantedKey.includes(entryKey))
      })
    }
    for (const hit of hits) if (!out.includes(hit)) out.push(hit)
  }
  return out
}

function mergeLists(target: BandLists, source: BandLists): void {
  for (const field of ['knowledge', 'functions', 'attitudes'] as const) {
    for (const item of source[field]) if (!target[field].includes(item)) target[field].push(item)
  }
}

/** Unprefixed lists for exactly one elementary band. Empty lists when nothing matches. */
export function getElementaryContentLists(subjectIdOrName: string, area: string, gradeBand?: string | null): BandLists {
  const out: BandLists = { knowledge: [], functions: [], attitudes: [] }
  const band = toElementaryBand(gradeBand)
  if (!band) return out
  for (const entry of findElementaryContentEntries(subjectIdOrName, area)) {
    const lists = entry.bands[band]
    if (lists) mergeLists(out, lists)
  }
  return out
}

/** Union over the elementary bands (1-2 → 3-4 → 5-6 order), unprefixed. */
export function getElementaryContentListsAllBands(subjectIdOrName: string, area: string): BandLists {
  const out: BandLists = { knowledge: [], functions: [], attitudes: [] }
  for (const band of ELEMENTARY_BANDS) {
    for (const entry of findElementaryContentEntries(subjectIdOrName, area)) {
      const lists = entry.bands[band]
      if (lists) mergeLists(out, lists)
    }
  }
  return out
}

/** Band-prefixed lists ("3-4학년군: 무게") in the shape contentSystemReader/curriculumFilters expect. */
export function getPrefixedElementaryLists(subjectIdOrName: string, area: string): BandLists {
  const out: BandLists = { knowledge: [], functions: [], attitudes: [] }
  const entries = findElementaryContentEntries(subjectIdOrName, area)
  for (const band of ELEMENTARY_BANDS) {
    for (const entry of entries) {
      const lists = entry.bands[band]
      if (!lists) continue
      for (const field of ['knowledge', 'functions', 'attitudes'] as const) {
        for (const item of lists[field]) {
          const prefixed = `${band}: ${item}`
          if (!out[field].includes(prefixed)) out[field].push(prefixed)
        }
      }
    }
  }
  return out
}

interface GraphStandardLike {
  subject_id: string
  area: string
  grade_band: string
  knowledge?: string[]
  functions?: string[]
  competencies?: string[]
}

interface GraphCoreIdeaLike {
  subject_id: string
  area: string
  knowledge?: string[]
  functions?: string[]
}

interface GraphLike {
  achievementStandards?: GraphStandardLike[]
  coreIdeas?: GraphCoreIdeaLike[]
}

/**
 * Replace every standard's / core idea's 지식⋅이해·과정⋅기능·가치⋅태도 with the
 * band-specific elementary content-system items. Subjects without a
 * content-system record (창의적 체험활동) keep their own lists only when they
 * carry no curriculum content (functions there are example activity names).
 * Mutates and returns the graph. Idempotent.
 */
export function applyElementaryContentLists<T extends GraphLike>(graph: T): T {
  for (const standard of graph.achievementStandards ?? []) {
    if (standard.subject_id === 'sub_extra') {
      standard.knowledge = []
      standard.competencies = []
      continue
    }
    const lists = getElementaryContentLists(standard.subject_id, standard.area, standard.grade_band)
    standard.knowledge = lists.knowledge
    standard.functions = lists.functions
    standard.competencies = lists.attitudes
  }
  for (const coreIdea of graph.coreIdeas ?? []) {
    if (coreIdea.subject_id === 'sub_extra') continue
    const lists = getElementaryContentListsAllBands(coreIdea.subject_id, coreIdea.area)
    coreIdea.knowledge = lists.knowledge
    coreIdea.functions = lists.functions
  }
  return graph
}

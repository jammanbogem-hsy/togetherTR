/**
 * JSON 교육과정 파일 리더 (서버 전용)
 * ─────────────────────────────────────
 * /public/curriculum_json/*.json에서 성취기준을 로드하고 검색합니다.
 * knowledge_graph.json보다 교육과정 원본에 가깝고,
 * 초·중·고 전학년 2600+ 성취기준을 포함합니다.
 */

import fs from 'fs'
import path from 'path'
import { getElementaryContentLists } from './elementaryContentLists'
import type { CurriculumStandard } from './graphReader'

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface JsonStandard {
  code: string
  text: string
  concepts?: string[]
}

interface StandardSet {
  school_level: string
  grade_band: string
  standard_count: number
  standards: JsonStandard[]
}

interface CoreIdeaGroup {
  id: string
  group_label: string
  curriculum_category: string
  course: string | null
  area: string
  school_levels: string[]
  core_ideas: string[]
  knowledge: string[]
  functions: string[]
  attitudes: string[]
  standard_sets: StandardSet[]
}

interface CurriculumJson {
  metadata: Record<string, unknown>
  subject: { id: string; name: string; school_levels: string[] }
  core_idea_groups: CoreIdeaGroup[]
}

// subject_id 매핑 (JSON subject.id → KG subject_id)
const SUBJECT_ID_MAP: Record<string, string> = {
  math: 'sub_math',
  korean: 'sub_kor',
  science: 'sub_sci',
  social_studies: 'sub_soc',
  moral_education: 'sub_mor',
  art: 'sub_art',
  music: 'sub_mus',
  physical_education: 'sub_pe',
  english: 'sub_eng',
  practical_arts: 'sub_prac',
  integrated_subjects: 'sub_int',
  creative_experiential: 'sub_extra',
}

// 학년군 정규화 (JSON "5~6학년군" → KG "초5-6")
function normalizeGradeBand(schoolLevel: string, gradeBand: string): string {
  const prefix = schoolLevel.includes('초') ? '초'
    : schoolLevel.includes('중') ? '중'
    : schoolLevel.includes('고') ? '고'
    : ''
  const match = gradeBand.match(/(\d+)~?(\d+)?/)
  if (match) {
    const start = match[1]
    const end = match[2] || start
    return `${prefix}${start}-${end}`
  }
  return `${prefix}${gradeBand}`
}

// ─── 캐시 ──────────────────────────────────────────────────────────────────

let _allStandards: CurriculumStandard[] | null = null

function findJsonDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public/curriculum_json'),
    path.join(process.cwd(), '../협력적수업설계/json'),
  ]
  return candidates.find(p => fs.existsSync(p)) ?? null
}

export function loadAllJsonStandards(): CurriculumStandard[] {
  if (_allStandards) return _allStandards

  const dir = findJsonDir()
  if (!dir) { _allStandards = []; return _allStandards }

  const standards: CurriculumStandard[] = []

  for (const fname of fs.readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue
    try {
      const raw = fs.readFileSync(path.join(dir, fname), 'utf-8')
      const data = JSON.parse(raw) as CurriculumJson
      const subjectId = SUBJECT_ID_MAP[data.subject?.id] ?? data.subject?.id ?? ''

      for (const cig of data.core_idea_groups ?? []) {
        for (const ss of cig.standard_sets ?? []) {
          const gradeBand = normalizeGradeBand(ss.school_level, ss.grade_band)

          // [strict-elementary 2026-09-18] cig.knowledge/functions는 초·중 공통 그룹 목록(대부분 중학교).
          // 초등 학년군의 내용체계 항목으로 대체하고, 비초등 학년군은 빈 목록.
          const contentLists = getElementaryContentLists(subjectId, cig.area, gradeBand)

          for (const std of ss.standards ?? []) {
            const code = std.code.replace(/[\[\]]/g, '')
            standards.push({
              id: `json_${code}`,
              code,
              subject_id: subjectId,
              core_idea_id: cig.id,
              grade_band: gradeBand,
              school_level: ss.school_level,
              area: cig.area,
              text: std.text,
              keywords: std.concepts ?? [],
              concepts: std.concepts ?? [],
              functions: contentLists.functions,
              knowledge: contentLists.knowledge,
              competencies: contentLists.attitudes,
              normalized_text_for_similarity: std.text,
            })
          }
        }
      }
    } catch { /* skip corrupt files */ }
  }

  _allStandards = standards
  return _allStandards
}

// ─── 검색 ──────────────────────────────────────────────────────────────────

const KO_PARTICLE_SET = new Set([
  '이','가','은','는','을','를','의','에','로','으','와','과','도','만',
  '서','게','며','고','나','라','야','아','랑','한','할','해','까',
])

function koreanWordMatch(stored: string, query: string): boolean {
  const s = stored.toLowerCase()
  const q = query.toLowerCase()
  let idx = s.indexOf(q)
  while (idx !== -1) {
    const before = idx > 0 ? s[idx - 1] : ''
    const beforeOk = !before || !/[\uAC00-\uD7A3]/.test(before)
    if (beforeOk) {
      const after = s[idx + q.length] ?? ''
      const afterIsKorean = /[\uAC00-\uD7A3]/.test(after)
      const afterOk = !afterIsKorean || KO_PARTICLE_SET.has(after)
      if (afterOk) return true
    }
    idx = s.indexOf(q, idx + 1)
  }
  return false
}

function scoreStandard(std: CurriculumStandard, keywords: string[]): number {
  if (keywords.length === 0) return 0
  let score = 0
  const textLower = std.text.toLowerCase()
  for (const kw of keywords) {
    const k = kw.toLowerCase()
    const kwExact  = (arr: string[]) => arr.some(s => koreanWordMatch(s, k))
    const kwSubstr = (arr: string[]) => arr.some(s => s.toLowerCase().includes(k))
    if (kwExact(std.keywords ?? [])) score += 5
    else if (kwSubstr(std.keywords ?? [])) score += 1
    if (kwExact(std.concepts ?? [])) score += 4
    else if (kwSubstr(std.concepts ?? [])) score += 1
    if (kwExact(std.functions ?? [])) score += 4
    else if (kwSubstr(std.functions ?? [])) score += 1
    if (kwExact(std.knowledge ?? [])) score += 3
    else if (kwSubstr(std.knowledge ?? [])) score += 1
    if (koreanWordMatch(textLower, k)) score += 2
    else if (textLower.includes(k)) score += 0
  }
  return score
}

/**
 * JSON 교육과정에서 키워드로 관련 성취기준 검색.
 */
export function searchJsonStandards(
  keywords: string[],
  gradeGroup?: string,
  topK = 15,
  minScore = 3,
): CurriculumStandard[] {
  const all = loadAllJsonStandards()
  if (keywords.length === 0) return []

  const gradeBandMap: Record<string, string[]> = {
    '초1-2': ['초1-2'], '초3-4': ['초3-4'], '초5-6': ['초5-6'],
    '중1-3': ['중1-3'], '고공통': ['고'], '고선택': ['고'],
  }
  const allowedBands = gradeGroup ? (gradeBandMap[gradeGroup] ?? [gradeGroup]) : []

  return all
    .filter(std => {
      if (allowedBands.length === 0) return true
      return allowedBands.some(b => (std.grade_band ?? '').includes(b))
    })
    .map(std => ({ std, score: scoreStandard(std, keywords) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ std }) => std)
}

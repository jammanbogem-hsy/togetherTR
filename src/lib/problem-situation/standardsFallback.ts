// 지식 그래프 없이 분석시트·A-2-1 분석표로 진행한 팀을 위한 성취기준 목록 대체 표시.

export interface FallbackStandard {
  code: string
  text: string
  subject: string
  gradeBand: string
}

interface StandardSourceRow {
  subject?: string
  gradeBand?: string
  standard?: string
}

interface StandardsFallbackInput {
  /** A-2-1 산출물 rows (subject 예: "1-2학년군 국어") */
  analysisRows?: unknown
  /** 프로젝트 curriculumSheet 행 */
  sheetRows?: unknown
  /** A-2-1 산출물 텍스트 — 행 데이터가 없을 때 코드만 추출 */
  analysisText?: string
}

const CODE_RE = /\[?(\d[가-힣]{1,3}\d{2}-\d{2})\]?/g
const BAND_PREFIX_RE = /^\s*(\d-\d)학년군\s*/
const BAND_ORDER = ['1-2학년군', '3-4학년군', '5-6학년군']

function gradeBandOfCode(code: string): string {
  const level = code.charAt(0)
  if (level === '2') return '1-2학년군'
  if (level === '4') return '3-4학년군'
  if (level === '6') return '5-6학년군'
  return ''
}

function toRows(value: unknown): StandardSourceRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is StandardSourceRow => !!row && typeof row === 'object')
    : []
}

/** 문장 안의 성취기준 코드와 그 뒤 원문(다음 코드 전까지)을 순서대로 읽는다. */
function readCodes(text: string): Array<{ code: string; text: string }> {
  const matches = [...text.matchAll(CODE_RE)]
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    return { code: match[1], text: text.slice(start, end).replace(/[\s|,/·]+$/, '').trim() }
  })
}

export function extractFallbackStandards(input: StandardsFallbackInput): FallbackStandard[] {
  const byCode = new Map<string, FallbackStandard>()
  const add = (code: string, text: string, subject: string, gradeBand: string) => {
    const existing = byCode.get(code)
    if (existing) {
      if (!existing.text && text) existing.text = text
      if (!existing.subject && subject) existing.subject = subject
      return
    }
    byCode.set(code, { code, text, subject, gradeBand })
  }

  for (const rows of [toRows(input.analysisRows), toRows(input.sheetRows)]) {
    for (const row of rows) {
      const rawSubject = (row.subject ?? '').trim()
      const bandMatch = rawSubject.match(BAND_PREFIX_RE)
      const subject = rawSubject.replace(BAND_PREFIX_RE, '').trim()
      const rowBand = (row.gradeBand ?? '').trim() || (bandMatch ? `${bandMatch[1]}학년군` : '')
      for (const item of readCodes(row.standard ?? '')) {
        add(item.code, item.text, subject, gradeBandOfCode(item.code) || rowBand)
      }
    }
  }

  if (byCode.size === 0 && input.analysisText) {
    for (const item of readCodes(input.analysisText)) add(item.code, item.text, '', gradeBandOfCode(item.code))
  }

  return [...byCode.values()].sort((a, b) => {
    const band = BAND_ORDER.indexOf(a.gradeBand) - BAND_ORDER.indexOf(b.gradeBand)
    return band !== 0 ? band : a.code.localeCompare(b.code)
  })
}

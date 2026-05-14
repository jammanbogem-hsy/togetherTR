import type { CurriculumSheetRow } from '@/types'
import type { GraphSavedData, GraphAgentNote } from '@/lib/knowledge-graph/domain'

const SEP = ' | '
const STD_CODE_RE = /\[?(\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2})\]?/g

export interface GraphCodesFromSheet {
  codes: Array<{ code: string; addedBy: string }>
  centerCode?: string
}

export interface SheetMergeResult {
  rows: CurriculumSheetRow[]
  changed: boolean
}

export interface CurriculumSheetArtifactProposal {
  title: string
  sections: Record<string, string>
}

export function extractStandardCodes(text: string): string[] {
  if (!text) return []
  const matches = [...text.matchAll(STD_CODE_RE)]
  return matches.map(match => match[1]).filter(Boolean)
}

export function normalizeStandardCode(value?: string | null): string {
  return extractStandardCodes(value ?? '')[0] ?? ''
}

export function buildGraphCodesFromSheet(rows: CurriculumSheetRow[]): GraphCodesFromSheet {
  const codeMap = new Map<string, { code: string; addedBy: string }>()
  let centerCode = ''

  for (const row of rows) {
    if (!row.standard) continue
    const codes = row.standard
      .split(SEP)
      .flatMap(part => extractStandardCodes(part))

    if (row.isCenter && !centerCode) centerCode = codes[0] ?? ''

    for (const code of codes) {
      if (codeMap.has(code)) continue
      codeMap.set(code, {
        code,
        addedBy: `분석시트(${row.subject}${row.isCenter ? ' 중심' : ''})`,
      })
    }
  }

  return { codes: [...codeMap.values()], ...(centerCode ? { centerCode } : {}) }
}

function noteBody(note: GraphAgentNote): string {
  const main = note.teachingNote?.trim()
    || note.ideas?.filter(Boolean).slice(0, 2).join(' / ')
    || note.explanation?.trim()
    || ''

  if (!main) return ''
  if (!note.explanation?.trim() || main.includes(note.explanation.trim())) return main
  return `${main}\n근거: ${note.explanation.trim()}`
}

function compactText(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength - 1).trim()}…`
}

function inferGradeLabelFromStandard(standard?: string | null): string {
  const code = normalizeStandardCode(standard)
  const firstGrade = code.match(/^(\d)/)?.[1]
  if (!firstGrade) return ''
  if (firstGrade === '1' || firstGrade === '2') return '1-2학년군'
  if (firstGrade === '3' || firstGrade === '4') return '3-4학년군'
  if (firstGrade === '5' || firstGrade === '6') return '5-6학년군'
  return ''
}

function ensureGradePrefixes(value?: string | null, standard?: string | null): string {
  const gradeLabel = inferGradeLabelFromStandard(standard)
  const text = stripDisplayMarkup(value)
  if (!gradeLabel || !text) return text
  return text
    .split(SEP)
    .map(part => {
      const trimmed = part.trim()
      if (!trimmed || /^\d-\d학년군:/.test(trimmed)) return trimmed
      return `${gradeLabel}: ${trimmed}`
    })
    .filter(Boolean)
    .join(SEP)
}

function centerLessonExample(data: Omit<GraphSavedData, 'savedAt'>): string {
  if (!data.centerNode || data.selectedStandards.length === 0) return ''
  const relationTypes = [
    ...new Set(data.selectedStandards.map(standard => standard.relationType).filter(Boolean)),
  ].slice(0, 3)
  const relationPhrase = relationTypes.length > 0
    ? `${relationTypes.join(', ')} 관계로 들어온 연결 교과 결과를`
    : '연결 교과의 탐구 결과와 산출물을'
  const centerTask = compactText(data.centerNode.text, 90)

  return [
    `중심 교과에서는 "${centerTask}"를 핵심 탐구 과제로 삼습니다.`,
    `${relationPhrase} 비교·종합해 원인, 쟁점, 해결 방안을 정리하고 최종 판단이나 실천 방안을 도출하는 활동을 설계합니다.`,
  ].join('\n')
}

export function stripDisplayMarkup(value?: string | null): string {
  return (value ?? '')
    .replace(/&(?:#124|124);/g, ' / ')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim()
}

function mdCell(value?: string | null): string {
  const cleaned = stripDisplayMarkup(value)
  if (!cleaned) return '-'
  return cleaned
    .replace(/\r?\n+/g, ' ')
    .replace(/\s*\|\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildCurriculumSheetArtifactProposal(
  rows: CurriculumSheetRow[],
): CurriculumSheetArtifactProposal | null {
  const validRows = rows.filter(row =>
    row.subject || row.coreIdea || row.standard || row.knowledge || row.processFunction || row.agentLessonExample || row.description
  )
  if (validRows.length === 0) return null

  const analysisTable = [
    '| 교과 | 핵심 아이디어 | 성취기준 | 지식·이해 | 과정·기능 | Agent 추천 수업아이디어 | 수업내용 설명 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...validRows.map(row => [
      row.isCenter ? `${row.subject || '-'} ★중심` : row.subject || '-',
      row.coreIdea,
      row.standard,
      ensureGradePrefixes(row.knowledge, row.standard),
      ensureGradePrefixes(row.processFunction, row.standard),
      row.agentLessonExample,
      row.description,
    ].map(mdCell).join(' | ')).map(line => `| ${line} |`),
  ].join('\n')

  const lessonIdeas = validRows
    .filter(row => row.agentLessonExample?.trim())
    .map(row => `- **${row.subject || '교과 미지정'}${row.isCenter ? ' ★중심' : ''}**: ${stripDisplayMarkup(row.agentLessonExample).replace(/\r?\n+/g, '\n  ')}`)
    .join('\n')

  return {
    title: '핵심아이디어 및 성취기준 분석표',
    sections: {
      '성취기준분석표': analysisTable,
      ...(lessonIdeas ? { 'Agent 추천 수업아이디어': lessonIdeas } : {}),
    },
  }
}

export function mergeGraphAgentExamplesIntoRows(
  rows: CurriculumSheetRow[],
  data: Omit<GraphSavedData, 'savedAt'>,
): SheetMergeResult {
  if (!rows.length || (!data.centerNode && data.selectedStandards.length === 0)) {
    return { rows, changed: false }
  }

  const standardIdByCode = new Map<string, string>()
  const centerCode = normalizeStandardCode(data.centerNode?.label)
  if (centerCode && data.centerNode) standardIdByCode.set(centerCode, data.centerNode.id)

  for (const standard of data.selectedStandards) {
    const code = normalizeStandardCode(standard.label)
    if (code) standardIdByCode.set(code, standard.id)
  }

  const noteByStandardId = new Map(data.agentNotes.map(note => [note.standardId, note]))
  const centerExample = centerLessonExample(data)

  let changed = false
  const mergedRows = rows.map(row => {
    const codes = extractStandardCodes(row.standard)
    const matchedId = codes.map(code => standardIdByCode.get(code)).find(Boolean)
    const note = matchedId ? noteByStandardId.get(matchedId) : undefined
    const nextExample = row.isCenter && centerExample
      ? centerExample
      : note
        ? noteBody(note)
        : row.agentLessonExample ?? ''

    if ((row.agentLessonExample ?? '') === nextExample) return row
    changed = true
    return { ...row, agentLessonExample: nextExample, updatedAt: Date.now() }
  })

  return { rows: mergedRows, changed }
}

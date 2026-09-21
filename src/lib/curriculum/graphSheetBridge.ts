import type { CurriculumSheetRow } from '@/types'
import type { GraphSavedData, GraphAgentNote } from '@/lib/knowledge-graph/domain'
import { defaultGradeMode, distinctGradeBands, resolveGradePrefixBandForMode } from './sheetGradeBands'
import type { SheetGradeMode } from './sheetGradeBands'

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

function ensureGradePrefixes(value: string | null | undefined, gradeLabel: string): string {
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

/** 시트 학년군 설정 — 산출물 표의 학년군 표기를 화면과 일치시키기 위해 받는다. */
export interface SheetGradeSettings {
  gradeMode?: SheetGradeMode
  sheetGradeBand?: string
}

/**
 * 같은 핵심아이디어 묶음의 둘째 줄부터 교과 칸에 붙이는 표시.
 * 마크다운 표의 열 구성을 바꾸지 않고 "앞 줄과 한 묶음"이라는 정보만 실어 보낸다 —
 * 파서(schemas.ts parseA21Table)가 이 접두어를 떼고 groupWithPrevious로 되살린다.
 */
export const A21_GROUP_MARKER = '↳ '

/**
 * 두 행이 같은 핵심아이디어 묶음인지 — 시트(CurriculumSheetModal.isSameCoreIdeaGroup)와 같은 규칙.
 * 학년군만 다른 줄(같은 교과·핵심아이디어), 또는 그 핵심아이디어에 붙은 연결 줄
 * (교과·핵심아이디어는 달라도 linkedCoreIdea가 원본을 가리킨다)을 한 묶음으로 본다.
 * 규칙이 바뀌면 시트 쪽 함수와 함께 수정해야 한다.
 */
function isSameCoreIdeaGroup(row: CurriculumSheetRow, prevRow?: CurriculumSheetRow): boolean {
  if (!prevRow) return false
  const rowIdea = (row.coreIdea ?? '').trim()
  const prevIdea = (prevRow.coreIdea ?? '').trim()
  if (row.subject && rowIdea && prevRow.subject === row.subject && prevIdea === rowIdea) return true
  const link = row.linkedCoreIdea
  if (!link) return false
  if (prevRow.subject === link.subject && prevIdea === link.coreIdea.trim()) return true
  const prevLink = prevRow.linkedCoreIdea
  return !!prevLink && prevLink.subject === link.subject && prevLink.coreIdea.trim() === link.coreIdea.trim()
}

export function buildCurriculumSheetArtifactProposal(
  rows: CurriculumSheetRow[],
  gradeSettings?: SheetGradeSettings,
): CurriculumSheetArtifactProposal | null {
  const validRows = rows.filter(row =>
    row.subject || row.coreIdea || row.standard || row.knowledge || row.processFunction || row.valueAttitude || row.agentLessonExample || row.description
  )
  if (validRows.length === 0) return null

  // 학년군이 섞인 시트(1·3·5학년 혼성 팀)에서만 교과 칸에 학년군을 덧붙인다.
  // 열 구성은 그대로 두고 교과명만 '국어 (3-4학년군)' 형태로 확장한다 —
  // A-2-1 표 파서(schemas.ts parseA21Table)는 교과 칸 문자열을 그대로 보존한다.
  // 모드를 받지 못하면 시트 내용으로 판정한다(한 학년군 시트는 기존 표 그대로).
  const gradeMode = gradeSettings?.gradeMode ?? defaultGradeMode(validRows)
  const sheetGradeBand = gradeSettings?.sheetGradeBand
  const isMixedGradeSheet = distinctGradeBands(validRows, gradeMode, sheetGradeBand).length >= 2

  const analysisTable = [
    '| 교과 | 핵심 아이디어 | 성취기준 | 지식·이해 | 과정·기능 | 가치·태도 | Agent 추천 수업아이디어 | 수업내용 설명 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...validRows.map((row, index) => {
      const gradeLabel = resolveGradePrefixBandForMode(row, gradeMode, sheetGradeBand)
      // 앞 줄과 한 묶음인 학년군 줄·연결 줄은 교과 칸에 '↳ '를 붙인다 — 산출물 렌더러가
      // 시트처럼 교과·핵심아이디어 칸을 묶어(rowSpan) 한 줄로 보여주기 위한 표시.
      const subjectCell = [
        isSameCoreIdeaGroup(row, validRows[index - 1]) ? A21_GROUP_MARKER : '',
        row.subject || '-',
        isMixedGradeSheet && gradeLabel ? ` (${gradeLabel})` : '',
        row.isCenter ? ' ★중심' : '',
      ].join('')
      // 연결 줄(다른 교과 성취기준을 팀 핵심아이디어에 붙인 줄)은 핵심아이디어 칸을 그대로 두고
      // 수업내용 설명 앞에 연결을 적는다 — 열 구성과 파서 동작을 바꾸지 않기 위해.
      const link = row.linkedCoreIdea
      const description = link
        ? `(${link.subject} 핵심아이디어 '${compactText(link.coreIdea, 40)}'와 연결) ${stripDisplayMarkup(row.description)}`.trim()
        : row.description
      return [
        subjectCell,
        row.coreIdea,
        row.standard,
        ensureGradePrefixes(row.knowledge, gradeLabel),
        ensureGradePrefixes(row.processFunction, gradeLabel),
        ensureGradePrefixes(row.valueAttitude, gradeLabel),
        row.agentLessonExample,
        description,
      ].map(mdCell).join(' | ')
    }).map(line => `| ${line} |`),
  ].join('\n')

  const lessonIdeas = validRows
    .filter(row => row.agentLessonExample?.trim())
    .map(row => `- **${row.subject || '교과 미지정'}${row.isCenter ? ' ★중심' : ''}**: ${stripDisplayMarkup(row.agentLessonExample).replace(/\r?\n+/g, '\n  ')}`)
    .join('\n')

  return {
    title: '주제의 상세 내용 분석표',
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

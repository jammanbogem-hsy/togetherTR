// 설계 단계(Ds-1~Ds-5) 평가 루브릭 — 산출물 본문과 따로 저장하고 산출물 아래에 붙여 보여 준다.
// 저장: projects/{id}.evaluationRubrics.{activityCode} (팀원도 쓸 수 있는 필드 — artifacts 는 방장 전용).
// 산출물을 다시 저장해도 루브릭이 지워지지 않도록 artifacts.content 에 섞지 않는다.

import type { ActivityCode } from '@/types'

export interface RubricRow {
  id: string
  /** 평가 요소 */
  element: string
  /** 근거 성취기준 — "[4사10-02]" 또는 "과정 평가" */
  standard: string
  method: string
  timing: string
  high: string
  mid: string
  low: string
}

export interface ActivityRubric {
  rows: RubricRow[]
  updatedAt?: number
  updatedBy?: string
}

export type RubricField = Exclude<keyof RubricRow, 'id'>

/** minPx: 좁은 산출물 패널에서도 칸이 글자 단위로 쪼개지지 않게 하는 최소 폭 */
export const RUBRIC_COLUMNS: ReadonlyArray<{ id: RubricField; label: string; wide?: boolean; minPx: number }> = [
  { id: 'element', label: '평가 요소', minPx: 120 },
  { id: 'standard', label: '근거 성취기준', minPx: 104 },
  { id: 'method', label: '평가 방법', minPx: 112 },
  { id: 'timing', label: '평가 시점', minPx: 92 },
  { id: 'high', label: '상', wide: true, minPx: 200 },
  { id: 'mid', label: '중', wide: true, minPx: 200 },
  { id: 'low', label: '하', wide: true, minPx: 200 },
]

/** 루브릭을 붙일 수 있는 활동 — 설계 단계 Ds-1~Ds-5. */
export const RUBRIC_ACTIVITIES: readonly ActivityCode[] = ['Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2']

export function isRubricActivity(code: string | null | undefined): code is ActivityCode {
  return !!code && (RUBRIC_ACTIVITIES as readonly string[]).includes(code)
}

export function newRubricRowId(): string {
  return `rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function emptyRubricRow(): RubricRow {
  return { id: newRubricRowId(), element: '', standard: '', method: '', timing: '', high: '', mid: '', low: '' }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '').trim()

/** 저장본·AI 응답을 표 행으로 정리한다. 모르는 키는 버리고, 비어 있는 행은 뺀다. */
export function normalizeRubricRows(raw: unknown): RubricRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(item => {
      const r = (item ?? {}) as Record<string, unknown>
      return {
        id: text(r.id) || newRubricRowId(),
        element: text(r.element),
        standard: text(r.standard),
        method: text(r.method),
        timing: text(r.timing),
        high: text(r.high),
        mid: text(r.mid),
        low: text(r.low),
      }
    })
    .filter(row => !isBlankRubricRow(row))
}

export function isBlankRubricRow(row: RubricRow): boolean {
  return RUBRIC_COLUMNS.every(c => !row[c.id].trim())
}

export function hasRubric(rubric: ActivityRubric | null | undefined): boolean {
  return !!rubric && rubric.rows.some(row => !isBlankRubricRow(row))
}

const mdCell = (value: string) => value.replace(/\|/g, '｜').replace(/\s*\n\s*/g, ' ').trim() || ' '

/** 마크다운 표 — 산출물 복사 글과 HWPX 파일에 쓴다. */
export function rubricToMarkdown(rows: readonly RubricRow[]): string {
  const filled = rows.filter(row => !isBlankRubricRow(row))
  if (filled.length === 0) return ''
  const header = `| ${RUBRIC_COLUMNS.map(c => c.label).join(' | ')} |`
  const divider = `|${RUBRIC_COLUMNS.map(() => '---').join('|')}|`
  const body = filled.map(row => `| ${RUBRIC_COLUMNS.map(c => mdCell(row[c.id])).join(' | ')} |`)
  return [header, divider, ...body].join('\n')
}

/** 탭 구분 글 — 표를 모르는 곳에 붙여 넣을 때. */
export function rubricToTsv(rows: readonly RubricRow[]): string {
  const filled = rows.filter(row => !isBlankRubricRow(row))
  const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim()
  return [RUBRIC_COLUMNS.map(c => c.label), ...filled.map(row => RUBRIC_COLUMNS.map(c => clean(row[c.id])))]
    .map(cells => cells.join('\t'))
    .join('\n')
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * 한글(HWP)에 붙여 넣으면 표로 들어가는 HTML. 한글은 클립보드의 text/html 표를 표 개체로 바꾸며,
 * 선·배경은 인라인 style 만 읽으므로 클래스 대신 칸마다 style 을 단다.
 */
/**
 * 한글 기본 A4(좌우 여백 30mm)의 본문 폭 150mm ≈ 425pt.
 * 표 폭과 열 폭을 이 안에 고정해 붙여넣은 표가 쪽 오른쪽 밖으로 나가지 않게 한다.
 */
export const RUBRIC_PASTE_WIDTH_PT = 425

/** 열별 폭 비율(합 100) — 짧은 정보 열은 좁게, 상·중·하 서술 열은 넓게. */
const RUBRIC_PASTE_WEIGHTS: Record<RubricField, number> = {
  element: 14, standard: 12, method: 13, timing: 10, high: 17, mid: 17, low: 17,
}

export function rubricColumnWidthsPt(totalPt = RUBRIC_PASTE_WIDTH_PT): number[] {
  const sum = RUBRIC_COLUMNS.reduce((acc, c) => acc + RUBRIC_PASTE_WEIGHTS[c.id], 0)
  return RUBRIC_COLUMNS.map(c => Math.round((RUBRIC_PASTE_WEIGHTS[c.id] / sum) * totalPt * 10) / 10)
}

export function rubricToClipboardHtml(rows: readonly RubricRow[], title?: string): string {
  const filled = rows.filter(row => !isBlankRubricRow(row))
  const widths = rubricColumnWidthsPt()
  const border = 'border:1px solid #000000;'
  const cell = 'padding:2pt 3pt;vertical-align:middle;font-size:9pt;line-height:130%;word-break:keep-all;'
  // width 속성은 단위 없는 px만 표준이라 pt×4/3 로 함께 적는다(속성만 읽는 편집기 대비).
  const px = (pt: number) => Math.round((pt * 4) / 3)
  const colgroup = `<colgroup>${widths.map(w => `<col width="${px(w)}" style="width:${w}pt;">`).join('')}</colgroup>`
  const head = RUBRIC_COLUMNS
    .map((c, i) => `<th width="${px(widths[i])}" style="${border}${cell}width:${widths[i]}pt;background:#E7E6E6;font-weight:bold;text-align:center;">${escapeHtml(c.label)}</th>`)
    .join('')
  const body = filled
    .map(row => `<tr>${RUBRIC_COLUMNS.map((c, i) => `<td width="${px(widths[i])}" style="${border}${cell}width:${widths[i]}pt;">${escapeHtml(row[c.id]).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
    .join('')
  const caption = title ? `<p style="font-weight:bold;font-size:11pt;">${escapeHtml(title)}</p>` : ''
  const table = `<table width="${px(RUBRIC_PASTE_WIDTH_PT)}" style="width:${RUBRIC_PASTE_WIDTH_PT}pt;table-layout:fixed;border-collapse:collapse;${border}">`
  return `<html><body>${caption}${table}${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
}

/**
 * 예전 AI 루브릭 표의 머리글 '평가 항목'을 '평가 요소'로 바꿔 보여 준다(저장본은 그대로).
 * 상·중·하 열이 함께 있는 표 머리글 줄에서만 바꿔 다른 표·문장은 건드리지 않는다.
 */
export function renameLegacyRubricHeader(markdown: string): string {
  if (!markdown.includes('평가 항목')) return markdown
  return markdown
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('|')) return line
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const isRubricHeader = cells.includes('상') && cells.includes('중') && cells.includes('하')
      return isRubricHeader ? line.replace(/(\|\s*)평가\s*항목(\s*\|)/, '$1평가 요소$2') : line
    })
    .join('\n')
}

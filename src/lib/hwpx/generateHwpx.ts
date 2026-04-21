import JSZip from 'jszip'
import { escapeXml, validateXml } from './xml'
import { CharPr, ParShape, StyleId, BorderFill, resolveCharPrId } from './refs'
import { createHeaderXml } from './header'
import {
  HWPX_MIMETYPE, REQUIRED_ENTRIES,
  CONTAINER_XML, VERSION_XML, MANIFEST_XML, SETTINGS_XML, CONTAINER_RDF,
  createContentHpf, createSectionXml,
} from './boilerplate'

// ─── 타입 ────────────────────────────────────────────────────────────────

type Run = { text: string; bold?: boolean; italic?: boolean; code?: boolean }

type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'bullet'; runs: Run[]; prefix?: string }
  | { type: 'ordered'; runs: Run[]; index: number }
  | { type: 'blockquote'; runs: Run[] }
  | { type: 'rule' }
  | { type: 'table'; rows: Run[][][] }

// ─── 상수 ────────────────────────────────────────────────────────────────

const TOTAL_TABLE_WIDTH = 45128
const DEFAULT_ROW_HEIGHT = 1800
const MAX_TABLE_CHUNK_HEIGHT = 62000

// ─── 마크다운 파서 ──────────────────────────────────────────────────────

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .split('\n')
    .map(line => line.startsWith('|')
      ? line.replace(/<br\s*\/?>/gi, '\u2028')
      : line.replace(/<br\s*\/?>/gi, '\n')
    )
    .join('\n')
}

function parseInline(text: string): Run[] {
  const runs: Run[] = []
  const pattern = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push({ text: text.slice(lastIndex, match.index) })
    const token = match[0]
    if (token.startsWith('***')) runs.push({ text: token.slice(3, -3), bold: true, italic: true })
    else if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true })
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true })
    else runs.push({ text: token.slice(1, -1), italic: true })
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) })
  return runs.filter(r => r.text.length > 0)
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = normalizeMarkdown(markdown).split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) { index++; continue }
    if (/^---+$/.test(trimmed)) { blocks.push({ type: 'rule' }); index++; continue }

    const hm = line.match(/^(#{1,4})\s+(.+)$/)
    if (hm) { blocks.push({ type: 'heading', level: hm[1].length as 1|2|3|4, text: hm[2].trim() }); index++; continue }

    if (line.startsWith('|')) {
      const tl: string[] = []
      while (index < lines.length && lines[index].startsWith('|')) { tl.push(lines[index]); index++ }
      const isSep = (v: string) => /^\|[\s\-:|]+\|$/.test(v)
      const rows = tl.filter(v => !isSep(v)).map(v =>
        v.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => parseInline(c.trim().replace(/\u2028/g, '\n')))
      )
      if (rows.length > 0) blocks.push({ type: 'table', rows })
      continue
    }

    if (line.startsWith('> ')) {
      const ql: string[] = []
      while (index < lines.length && lines[index].startsWith('> ')) { ql.push(lines[index].slice(2)); index++ }
      blocks.push({ type: 'blockquote', runs: parseInline(ql.join(' ')) })
      continue
    }

    const om = line.match(/^(\d+)\.\s+(.+)$/)
    if (om) { blocks.push({ type: 'ordered', runs: parseInline(om[2]), index: Number.parseInt(om[1], 10) }); index++; continue }

    const cbm = line.match(/^[-*]\s+\[( |x)\]\s+(.+)$/)
    if (cbm) { blocks.push({ type: 'bullet', runs: parseInline(cbm[2]), prefix: cbm[1] === 'x' ? '☑ ' : '☐ ' }); index++; continue }

    const bm = line.match(/^[-*]\s+(.+)$/)
    if (bm) { blocks.push({ type: 'bullet', runs: parseInline(bm[1]), prefix: '• ' }); index++; continue }

    const pl: string[] = []
    while (index < lines.length && lines[index].trim() !== '' &&
      !/^#{1,4}\s+/.test(lines[index]) && !lines[index].startsWith('|') &&
      !lines[index].startsWith('> ') && !/^(\d+)\.\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) && !/^---+$/.test(lines[index].trim())
    ) { pl.push(lines[index]); index++ }
    if (pl.length > 0) blocks.push({ type: 'paragraph', runs: parseInline(pl.join(' ')) })
  }
  return blocks
}

// ─── Run 유틸 ────────────────────────────────────────────────────────────

function mergeRuns(runs: Run[]): { text: string; bold: boolean; italic: boolean; code: boolean }[] {
  const merged: { text: string; bold: boolean; italic: boolean; code: boolean }[] = []
  for (const run of runs) {
    if (!run.text) continue
    const b = Boolean(run.bold), i = Boolean(run.italic), c = Boolean(run.code)
    const prev = merged.at(-1)
    if (prev && prev.bold === b && prev.italic === i && prev.code === c) prev.text += run.text
    else merged.push({ text: run.text, bold: b, italic: i, code: c })
  }
  return merged.length === 0 ? [{ text: ' ', bold: false, italic: false, code: false }] : merged
}

function splitRunsIntoLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    parts.forEach((part, i) => {
      if (part) lines.at(-1)!.push({ text: part, bold: run.bold, italic: run.italic, code: run.code })
      if (i < parts.length - 1) lines.push([])
    })
  }
  return lines.map(l => l.filter(r => r.text.length > 0))
}

// ─── 단락/제목/구분선 생성 ──────────────────────────────────────────────

function makeSingleParagraph(runs: Run[], charPrId: number, paraPrId = 0, styleId = 0, pageBreak = false): string {
  const xmlRuns = mergeRuns(runs.length > 0 ? runs : [{ text: ' ' }])
    .map(r => `<hp:run charPrIDRef="${resolveCharPrId(r, charPrId)}"><hp:t>${escapeXml(r.text)}</hp:t></hp:run>`)
    .join('')
  return `<hp:p id="0" paraPrIDRef="${paraPrId}" styleIDRef="${styleId}" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${xmlRuns}</hp:p>`
}

function makeParagraph(runs: Run[], opts?: { charPrId?: number; prefix?: string; paraPrId?: number; styleId?: number; pageBreak?: boolean }): string {
  const prefixed = opts?.prefix ? [{ text: opts.prefix }, ...runs] : runs
  return splitRunsIntoLines(prefixed)
    .map((line, i) => makeSingleParagraph(line, opts?.charPrId ?? CharPr.BODY, opts?.paraPrId ?? ParShape.BODY, opts?.styleId ?? StyleId.NORMAL, Boolean(opts?.pageBreak) && i === 0))
    .join('\n')
}

function makeEmptyParagraph(paraPrId = ParShape.BODY): string {
  return `<hp:p id="0" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"/></hp:p>`
}

function isStageBoundaryHeading(level: 1|2|3|4, text: string): boolean {
  if (level !== 2) return false
  return /(팀준비|분석|설계|개발.?실행|평가).+단계/.test(text.replace(/\s+/g, ''))
}

/**
 * H2/H3/H4를 1x1 표 박스로 감싸서 좌측 바 / 배경색 효과를 구현.
 * 화면 보고서의 badge(H2) / left-bar(H3/H4) 스타일을 재현.
 */
function makeHeadingBox(text: string, charPrId: number, borderFillId: number, boxId: number, pageBreak = false): string {
  const w = TOTAL_TABLE_WIDTH
  const lineCount = Math.max(1, Math.ceil(getTextDisplayUnits(text) / 40))
  const h = Math.max(1600, 1200 + lineCount * 800)
  const para = makeSingleParagraph([{ text }], charPrId, ParShape.BODY, StyleId.NORMAL)
    .replace('<hp:p id="0"', '<hp:p id="2147483648"')
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${300000 + boxId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="${borderFillId}" noAdjust="0"><hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="80" bottom="80"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:tr><hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${borderFillId}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${para}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="280" right="200" top="160" bottom="160"/></hp:tc></hp:tr></hp:tbl><hp:t/></hp:run></hp:p>`
}

let _headingBoxCounter = 0

function makeHeading(level: 1|2|3|4, text: string): string {
  const pageBreak = isStageBoundaryHeading(level, text)
  switch (level) {
    case 1:
      return makeParagraph([{ text }], { charPrId: CharPr.H1, paraPrId: ParShape.H1, pageBreak })
    case 2:
      // H2 → 배지 박스 (연블루 배경 + 좌측 파란 바 + 하단 파란선)
      return makeHeadingBox(text, CharPr.H2_BADGE, BorderFill.H2_BADGE, _headingBoxCounter++, pageBreak)
    case 3:
      // H3 → 좌측 파란 바
      return makeHeadingBox(text, CharPr.H3_BAR, BorderFill.H3_BAR, _headingBoxCounter++)
    case 4:
      // H4 → 좌측 회색 바
      return makeHeadingBox(text, CharPr.H4, BorderFill.H4_BAR, _headingBoxCounter++)
  }
}

function makeRule(): string {
  return makeParagraph([{ text: '────────────────────────' }], { charPrId: CharPr.BODY })
}

// ─── 표 레이아웃 ────────────────────────────────────────────────────────

function getTextDisplayUnits(text: string): number {
  return [...text].reduce((sum, ch) => {
    if (ch === '\n') return sum
    if (/\s/.test(ch)) return sum + 0.6
    if (/[A-Za-z0-9]/.test(ch)) return sum + 0.9
    if (/[.,()[\]{}:;/\\'"!?+\-=_*@#$%^&<>|~]/.test(ch)) return sum + 0.75
    return sum + 1.8
  }, 0)
}

function getRunsText(runs: Run[]): string { return runs.map(r => r.text).join('') }

function detectColumnProfile(headerText: string, columnTexts: string[]): 'narrow' | 'medium' | 'wide' {
  const nh = headerText.replace(/\s+/g, '')
  const avg = columnTexts.length > 0
    ? columnTexts.reduce((s, v) => s + getTextDisplayUnits(v), 0) / columnTexts.length
    : getTextDisplayUnits(headerText)
  if (/(단계|교과|번호|비고|유형|관계|점수|완료일|날짜|차시)/.test(nh)) return 'narrow'
  if (/(내용|설명|성취기준|활동|분석|제안|근거|맥락|수업|핵심|질문|산출물|지원|스캐폴딩)/.test(nh)) return 'wide'
  if (/코드/.test(nh)) return 'medium'
  if (avg <= 10) return 'narrow'
  if (avg >= 22) return 'wide'
  return 'medium'
}

function calculateColumnWidths(rows: Run[][][]): number[] {
  if (rows.length === 0) return [TOTAL_TABLE_WIDTH]
  const colCount = Math.max(...rows.map(r => r.length))
  if (colCount <= 1) return [TOTAL_TABLE_WIDTH]
  const profiles = Array.from({ length: colCount }, (_, ci) => {
    const texts = rows.map(r => getRunsText(r[ci] ?? [])).filter(Boolean)
    return detectColumnProfile(texts[0] ?? '', texts)
  })
  const weights = Array.from({ length: colCount }, (_, ci) => {
    const texts = rows.map(r => getRunsText(r[ci] ?? [])).filter(Boolean)
    const body = texts.slice(1)
    const top = body.map(t => Math.min(getTextDisplayUnits(t), 40)).sort((a, b) => b - a).slice(0, 3)
    const avgTop = top.length > 0 ? top.reduce((s, v) => s + v, 0) / top.length : Math.min(getTextDisplayUnits(texts[0] ?? ''), 24)
    let w = Math.max(getTextDisplayUnits(texts[0] ?? '') * 1.25, avgTop, 8)
    if (profiles[ci] === 'narrow') w *= 0.82
    else if (profiles[ci] === 'wide') w *= 1.28
    return Math.max(6, w)
  })
  const mins = profiles.map(p => p === 'narrow' ? 2800 : p === 'wide' ? 6500 : 4200)
  const minT = mins.reduce((s, v) => s + v, 0)
  const safeMins = minT >= TOTAL_TABLE_WIDTH ? mins.map(v => Math.floor((v / minT) * TOTAL_TABLE_WIDTH)) : mins
  const safeT = safeMins.reduce((s, v) => s + v, 0)
  const rem = Math.max(0, TOTAL_TABLE_WIDTH - safeT)
  const totalW = weights.reduce((s, v) => s + v, 0)
  const raw = safeMins.map((v, i) => v + Math.floor((rem * weights[i]) / totalW))
  raw[raw.length - 1] += TOTAL_TABLE_WIDTH - raw.reduce((s, v) => s + v, 0)
  return raw
}

function estimateWrappedLines(runs: Run[], colWidth: number): number {
  const text = getRunsText(runs) || ' '
  const maxU = Math.max(8, Math.floor(colWidth / 560))
  return text.split('\n').reduce((s, line) => s + Math.max(1, Math.ceil(Math.max(getTextDisplayUnits(line), 1) / maxU)), 0)
}

function estimateRowHeight(row: Run[][], colWidths: number[]): number {
  const maxL = Math.max(1, ...row.map((cell, i) => estimateWrappedLines(cell, colWidths[i] ?? colWidths.at(-1) ?? TOTAL_TABLE_WIDTH)))
  return Math.max(DEFAULT_ROW_HEIGHT, 1100 + maxL * 900)
}

function splitTableRows(rows: Run[][][], colWidths: number[]): Run[][][][] {
  if (rows.length <= 3) return [rows]
  const header = rows[0]
  const chunks: Run[][][][] = []
  let chunk: Run[][][] = [header]
  let h = estimateRowHeight(header, colWidths)
  for (const row of rows.slice(1)) {
    const rh = estimateRowHeight(row, colWidths)
    if (chunk.length > 1 && h + rh > MAX_TABLE_CHUNK_HEIGHT) {
      chunks.push(chunk)
      chunk = [header, row]
      h = estimateRowHeight(header, colWidths) + rh
    } else {
      chunk.push(row)
      h += rh
    }
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

function selectTableTypography(rows: Run[][][], colWidths: number[]) {
  const colCount = Math.max(...rows.map(r => r.length))
  const dense = rows.flatMap(r => r.map((c, i) => {
    const w = colWidths[i] ?? colWidths.at(-1) ?? TOTAL_TABLE_WIDTH
    return w === 0 ? 0 : getTextDisplayUnits(getRunsText(c)) / w
  })).reduce((m, v) => Math.max(m, v), 0)
  const isDense = colCount >= 6 || dense > 0.0065
  return {
    headerCharPrId: isDense ? CharPr.TH_WHITE_SM : CharPr.TH_WHITE,
    bodyCharPrId: isDense ? CharPr.TABLE_DENSE : CharPr.BODY,
    headerParaPrId: ParShape.TH_CENTER,
    bodyParaPrId: ParShape.TD,
  }
}

// ─── 표 XML 생성 ────────────────────────────────────────────────────────

function makeTable(rows: Run[][][], tableIdx: number, colWidths: number[]): string {
  if (rows.length === 0) return ''
  const colCount = Math.max(...rows.map(r => r.length))
  const nw = Array.from({ length: colCount }, (_, i) => colWidths[i] ?? colWidths.at(-1) ?? Math.floor(TOTAL_TABLE_WIDTH / Math.max(colCount, 1)))
  const typo = selectTableTypography(rows, nw)
  const totalH = rows.reduce((s, r) => s + estimateRowHeight(r, nw), 0)
  const trs = rows.map((row, ri) => {
    const rh = ri === 0 ? Math.max(estimateRowHeight(row, nw), 2200) : estimateRowHeight(row, nw)
    const cells = Array.from({ length: colCount }, (_, ci) => {
      const runs = row[ci] ?? [{ text: '' }]
      const cpr = ri === 0 ? typo.headerCharPrId : typo.bodyCharPrId
      const ppr = ri === 0 ? typo.headerParaPrId : typo.bodyParaPrId
      const sid = ri === 0 ? StyleId.TABLE_HEADER : StyleId.NORMAL
      const paras = splitRunsIntoLines(runs).map(l =>
        makeSingleParagraph(l, cpr, ppr, sid).replace('<hp:p id="0"', '<hp:p id="2147483648"')
      ).join('')
      const bfId = ri === 0 ? BorderFill.TABLE_HEADER : BorderFill.TABLE
      const cm = ri === 0
        ? '<hp:cellMargin left="150" right="150" top="150" bottom="150"/>'
        : '<hp:cellMargin left="120" right="120" top="90" bottom="90"/>'
      const va = ri === 0 ? 'CENTER' : 'TOP'
      return `<hp:tc name="" header="${ri === 0 ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${va}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList><hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${nw[ci]}" height="${rh}"/>${cm}</hp:tc>`
    }).join('')
    return `<hp:tr>${cells}</hp:tr>`
  }).join('')
  const tw = nw.reduce((s, v) => s + v, 0)
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${100000 + tableIdx}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="1" rowCnt="${rows.length}" colCnt="${colCount}" cellSpacing="0" borderFillIDRef="${BorderFill.TABLE}" noAdjust="0"><hp:sz width="${tw}" widthRelTo="ABSOLUTE" height="${Math.max(totalH, DEFAULT_ROW_HEIGHT)}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="320" right="320" top="120" bottom="120"/>${trs}</hp:tbl><hp:t/></hp:run></hp:p>`
}

function makeBlockquoteBox(runs: Run[], boxIdx: number): string {
  const w = TOTAL_TABLE_WIDTH
  const lc = estimateWrappedLines(runs, w)
  const h = Math.max(DEFAULT_ROW_HEIGHT, 1400 + lc * 850)
  const paras = splitRunsIntoLines(runs)
    .map(l => makeSingleParagraph(l, CharPr.BODY, ParShape.BODY).replace('<hp:p id="0"', '<hp:p id="2147483648"'))
    .join('')
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${200000 + boxIdx}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="${BorderFill.BLOCKQUOTE}" noAdjust="0"><hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="120" bottom="120"/><hp:inMargin left="320" right="320" top="120" bottom="120"/><hp:tr><hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${BorderFill.BLOCKQUOTE}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="320" right="240" top="220" bottom="220"/></hp:tc></hp:tr></hp:tbl><hp:t/></hp:run></hp:p>`
}

// ─── Block → XML 변환 ───────────────────────────────────────────────────

function blocksToXml(blocks: Block[]): string {
  let tableIdx = 0, bqIdx = 0
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(makeHeading(b.level, b.text), makeEmptyParagraph())
        if (b.level <= 2) out.push(makeEmptyParagraph())
        break
      case 'paragraph':
        out.push(makeParagraph(b.runs), makeEmptyParagraph())
        break
      case 'bullet':
        out.push(makeParagraph(b.runs, { prefix: b.prefix ?? '• ', paraPrId: ParShape.LIST }))
        break
      case 'ordered':
        out.push(makeParagraph(b.runs, { prefix: `${b.index}. `, paraPrId: ParShape.LIST }))
        break
      case 'blockquote':
        out.push(makeBlockquoteBox(b.runs, bqIdx++), makeEmptyParagraph())
        break
      case 'rule':
        out.push(makeRule(), makeEmptyParagraph())
        break
      case 'table': {
        const cw = calculateColumnWidths(b.rows)
        for (const chunk of splitTableRows(b.rows, cw)) {
          out.push(makeTable(chunk, tableIdx++, cw), makeEmptyParagraph())
        }
        break
      }
    }
  }
  if (out.length === 0) out.push(makeParagraph([{ text: '보고서 내용이 없습니다.' }]))
  return out.join('\n')
}

// ─── 미리보기 텍스트 ────────────────────────────────────────────────────

function createPreviewText(blocks: Block[]): string {
  return blocks.flatMap(b => {
    switch (b.type) {
      case 'heading': return [b.text]
      case 'paragraph': case 'bullet': case 'blockquote': return [b.runs.map(r => r.text).join('')]
      case 'ordered': return [`${b.index}. ${b.runs.map(r => r.text).join('')}`]
      case 'rule': return ['']
      case 'table': return b.rows.flatMap(row => row.map(cell => cell.map(r => r.text).join(' ')))
    }
  }).filter(Boolean).join('\n').slice(0, 2000)
}

// ─── ZIP 무결성 검증 ────────────────────────────────────────────────────

async function validateZipStructure(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  for (const path of REQUIRED_ENTRIES) {
    if (!zip.file(path)) throw new Error(`HWPX 필수 파일 누락: ${path}`)
  }
  const mime = await zip.file('mimetype')!.async('string')
  if (mime.trim() !== HWPX_MIMETYPE) throw new Error('HWPX mimetype이 올바르지 않습니다.')
}

// ─── Public API (시그니처 불변) ──────────────────────────────────────────

export async function generateHwpx(markdown: string, title: string): Promise<Blob> {
  _headingBoxCounter = 0
  const blocks = parseMarkdown(markdown)
  const bodyXml = blocksToXml(blocks)
  const headerXml = createHeaderXml()
  const sectionXml = createSectionXml(bodyXml)
  const contentHpf = createContentHpf(title)
  const previewText = createPreviewText(blocks)

  // dev-only XML 검증
  validateXml(CONTAINER_XML, 'container')
  validateXml(contentHpf, 'content')
  validateXml(headerXml, 'header')
  validateXml(sectionXml, 'section')

  // rhwp 패턴: mimetype은 OPC 스펙상 STORED (비압축)
  const zip = new JSZip()
  zip.file('mimetype', HWPX_MIMETYPE, { compression: 'STORE' })
  zip.file('META-INF/container.xml', CONTAINER_XML)
  zip.file('META-INF/container.rdf', CONTAINER_RDF)
  zip.file('META-INF/manifest.xml', MANIFEST_XML)
  zip.file('Contents/content.hpf', contentHpf)
  zip.file('Contents/header.xml', headerXml)
  zip.file('Contents/section0.xml', sectionXml)
  zip.file('Contents/BodyText/Section0.xml', sectionXml)
  zip.file('Preview/PrvText.txt', previewText)
  zip.file('settings.xml', SETTINGS_XML)
  zip.file('version.xml', VERSION_XML)

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: HWPX_MIMETYPE,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  await validateZipStructure(blob)
  return blob
}

import JSZip from 'jszip'

type Run = {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'bullet'; runs: Run[]; prefix?: string }
  | { type: 'ordered'; runs: Run[]; index: number }
  | { type: 'blockquote'; runs: Run[] }
  | { type: 'rule' }
  | { type: 'table'; rows: Run[][][] }

const HWPX_MIMETYPE = 'application/hwp+zip'
const TOTAL_TABLE_WIDTH = 45128
const DEFAULT_ROW_HEIGHT = 1800
const MAX_TABLE_CHUNK_HEIGHT = 62000
const TABLE_BORDER_FILL_ID = 3
const TABLE_HEADER_BORDER_FILL_ID = 4
const BLOCKQUOTE_BORDER_FILL_ID = 5
const REQUIRED_ENTRIES = [
  'mimetype',
  'META-INF/container.xml',
  'META-INF/container.rdf',
  'META-INF/manifest.xml',
  'Contents/content.hpf',
  'Contents/header.xml',
  'Contents/section0.xml',
  'Contents/BodyText/Section0.xml',
  'Preview/PrvText.txt',
  'settings.xml',
  'version.xml',
] as const

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

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
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index) })
    }

    const token = match[0]
    if (token.startsWith('***')) {
      runs.push({ text: token.slice(3, -3), bold: true, italic: true })
    } else if (token.startsWith('**')) {
      runs.push({ text: token.slice(2, -2), bold: true })
    } else if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), code: true })
    } else {
      runs.push({ text: token.slice(1, -1), italic: true })
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex) })
  }

  return runs.filter(run => run.text.length > 0)
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = normalizeMarkdown(markdown).split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4,
        text: headingMatch[2].trim(),
      })
      index += 1
      continue
    }

    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].startsWith('|')) {
        tableLines.push(lines[index])
        index += 1
      }

      const isSeparator = (value: string) => /^\|[\s\-:|]+\|$/.test(value)
      const rows = tableLines
        .filter(value => !isSeparator(value))
        .map(value =>
          value
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map(cell => parseInline(cell.trim().replace(/\u2028/g, '\n')))
        )

      if (rows.length > 0) {
        blocks.push({ type: 'table', rows })
      }
      continue
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].startsWith('> ')) {
        quoteLines.push(lines[index].slice(2))
        index += 1
      }
      blocks.push({ type: 'blockquote', runs: parseInline(quoteLines.join(' ')) })
      continue
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/)
    if (orderedMatch) {
      blocks.push({
        type: 'ordered',
        runs: parseInline(orderedMatch[2]),
        index: Number.parseInt(orderedMatch[1], 10),
      })
      index += 1
      continue
    }

    const checkboxMatch = line.match(/^[-*]\s+\[( |x)\]\s+(.+)$/)
    if (checkboxMatch) {
      blocks.push({
        type: 'bullet',
        runs: parseInline(checkboxMatch[2]),
        prefix: checkboxMatch[1] === 'x' ? '☑ ' : '☐ ',
      })
      index += 1
      continue
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      blocks.push({ type: 'bullet', runs: parseInline(bulletMatch[1]), prefix: '• ' })
      index += 1
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^#{1,4}\s+/.test(lines[index]) &&
      !lines[index].startsWith('|') &&
      !lines[index].startsWith('> ') &&
      !/^(\d+)\.\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^---+$/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', runs: parseInline(paragraphLines.join(' ')) })
    }
  }

  return blocks
}

function mergeRuns(runs: Run[]): { text: string; bold: boolean; italic: boolean; code: boolean }[] {
  const merged: { text: string; bold: boolean; italic: boolean; code: boolean }[] = []

  for (const run of runs) {
    if (!run.text) continue
    const bold = Boolean(run.bold)
    const italic = Boolean(run.italic)
    const code = Boolean(run.code)
    const previous = merged.at(-1)
    if (previous && previous.bold === bold && previous.italic === italic && previous.code === code) {
      previous.text += run.text
    } else {
      merged.push({ text: run.text, bold, italic, code })
    }
  }

  if (merged.length === 0) {
    return [{ text: ' ', bold: false, italic: false, code: false }]
  }

  return merged
}

function resolveCharPrId(run: { bold?: boolean; italic?: boolean; code?: boolean }, charPrId: number) {
  if (run.code) return 6
  if (run.bold && run.italic) return 7
  if (run.bold) return 14
  if (run.italic) return 5
  return charPrId
}

function splitRunsIntoLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]]

  for (const run of runs) {
    const parts = run.text.split('\n')
    parts.forEach((part, index) => {
      if (part) {
        lines.at(-1)!.push({
          text: part,
          bold: run.bold,
          italic: run.italic,
          code: run.code,
        })
      }
      if (index < parts.length - 1) {
        lines.push([])
      }
    })
  }

  return lines.map(line => line.filter(item => item.text.length > 0))
}

function makeSingleParagraph(runs: Run[], charPrId: number, paraPrId = 0, styleId = 0, pageBreak = false): string {
  const safeRuns = runs.length > 0 ? runs : [{ text: ' ' }]

  const xmlRuns = mergeRuns(safeRuns)
    .map(run => `<hp:run charPrIDRef="${resolveCharPrId(run, charPrId)}"><hp:t>${escapeXml(run.text)}</hp:t></hp:run>`)
    .join('')

  return `<hp:p id="0" paraPrIDRef="${paraPrId}" styleIDRef="${styleId}" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${xmlRuns}</hp:p>`
}

function makeParagraph(runs: Run[], options?: { charPrId?: number; prefix?: string; paraPrId?: number; styleId?: number; pageBreak?: boolean }): string {
  const charPrId = options?.charPrId ?? 0
  const paraPrId = options?.paraPrId ?? 0
  const styleId = options?.styleId ?? 0
  const pageBreak = Boolean(options?.pageBreak)
  const prefixedRuns = options?.prefix
    ? [{ text: options.prefix }, ...runs]
    : runs

  return splitRunsIntoLines(prefixedRuns)
    .map((line, index) => makeSingleParagraph(line, charPrId, paraPrId, styleId, pageBreak && index === 0))
    .join('\n')
}

function makeEmptyParagraph(paraPrId = 0): string {
  return `<hp:p id="0" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"/></hp:p>`
}

function isStageBoundaryHeading(level: 1 | 2 | 3 | 4, text: string): boolean {
  if (level !== 2) return false
  const normalized = text.replace(/\s+/g, '')
  return /(팀준비|분석|설계|개발.?실행|평가).+단계/.test(normalized)
}

function makeHeading(level: 1 | 2 | 3 | 4, text: string): string {
  const charPrId = level === 1 ? 10 : level === 2 ? 11 : level === 3 ? 12 : 13
  const paraPrId = level === 1 ? 1 : level === 2 ? 2 : level === 3 ? 3 : 4
  return makeParagraph([{ text }], { charPrId, paraPrId, pageBreak: isStageBoundaryHeading(level, text) })
}

function makeRule(): string {
  return makeParagraph([{ text: '────────────────────────' }], { charPrId: 0 })
}

function getTextDisplayUnits(text: string): number {
  return [...text].reduce((sum, char) => {
    if (char === '\n') return sum
    if (/\s/.test(char)) return sum + 0.6
    if (/[A-Za-z0-9]/.test(char)) return sum + 0.9
    if (/[.,()[\]{}:;/\\'"!?+\-=_*@#$%^&<>|~]/.test(char)) return sum + 0.75
    return sum + 1.8
  }, 0)
}

function getRunsText(runs: Run[]): string {
  return runs.map(run => run.text).join('')
}

function detectColumnProfile(headerText: string, columnTexts: string[]): 'narrow' | 'medium' | 'wide' {
  const normalizedHeader = headerText.replace(/\s+/g, '')
  const joined = columnTexts.join(' ')
  const averageUnits = columnTexts.length > 0
    ? columnTexts.reduce((sum, value) => sum + getTextDisplayUnits(value), 0) / columnTexts.length
    : getTextDisplayUnits(headerText)

  if (/(단계|교과|번호|비고|유형|관계|점수|완료일|날짜|차시)/.test(normalizedHeader)) {
    return 'narrow'
  }

  if (/(내용|설명|성취기준|활동|분석|제안|근거|맥락|수업|핵심|질문|산출물|지원|스캐폴딩)/.test(normalizedHeader)) {
    return 'wide'
  }

  if (/코드/.test(normalizedHeader)) {
    return 'medium'
  }

  if (averageUnits <= 10) return 'narrow'
  if (averageUnits >= 22) return 'wide'
  if (joined.includes('[[') || joined.includes('【')) return 'narrow'
  return 'medium'
}

function calculateColumnWidths(rows: Run[][][]): number[] {
  if (rows.length === 0) return [TOTAL_TABLE_WIDTH]

  const columnCount = Math.max(...rows.map(row => row.length))
  if (columnCount <= 1) return [TOTAL_TABLE_WIDTH]

  const profiles = Array.from({ length: columnCount }, (_, columnIndex) => {
    const columnTexts = rows
      .map(row => getRunsText(row[columnIndex] ?? []))
      .filter(Boolean)

    const headerText = columnTexts[0] ?? ''
    return detectColumnProfile(headerText, columnTexts)
  })

  const weights = Array.from({ length: columnCount }, (_, columnIndex) => {
    const columnTexts = rows
      .map(row => getRunsText(row[columnIndex] ?? []))
      .filter(Boolean)

    const headerText = columnTexts[0] ?? ''
    const bodyTexts = columnTexts.slice(1)
    const topUnits = bodyTexts
      .map(text => Math.min(getTextDisplayUnits(text), 40))
      .sort((a, b) => b - a)
      .slice(0, 3)
    const averageTopUnits = topUnits.length > 0
      ? topUnits.reduce((sum, value) => sum + value, 0) / topUnits.length
      : Math.min(getTextDisplayUnits(headerText), 24)

    let weight = Math.max(getTextDisplayUnits(headerText) * 1.25, averageTopUnits, 8)

    switch (profiles[columnIndex]) {
      case 'narrow':
        weight *= 0.82
        break
      case 'wide':
        weight *= 1.28
        break
      default:
        weight *= 1.0
    }

    return Math.max(6, weight)
  })

  const minimumWidths = profiles.map(profile => {
    switch (profile) {
      case 'narrow':
        return 2800
      case 'wide':
        return 6500
      default:
        return 4200
    }
  })

  const minTotal = minimumWidths.reduce((sum, width) => sum + width, 0)
  const safeMinWidths = minTotal >= TOTAL_TABLE_WIDTH
    ? minimumWidths.map(width => Math.floor((width / minTotal) * TOTAL_TABLE_WIDTH))
    : minimumWidths
  const safeMinTotal = safeMinWidths.reduce((sum, width) => sum + width, 0)
  const remaining = Math.max(0, TOTAL_TABLE_WIDTH - safeMinTotal)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const widthExtras = weights.map(weight => Math.floor((remaining * weight) / totalWeight))
  const rawWidths = safeMinWidths.map((width, index) => width + widthExtras[index])
  const diff = TOTAL_TABLE_WIDTH - rawWidths.reduce((sum, width) => sum + width, 0)
  rawWidths[rawWidths.length - 1] += diff
  return rawWidths
}

function estimateWrappedLines(runs: Run[], columnWidth: number): number {
  const text = getRunsText(runs)
  const logicalLines = (text || ' ').split('\n')
  const maxUnitsPerLine = Math.max(8, Math.floor(columnWidth / 560))

  return logicalLines.reduce((sum, line) => {
    const units = Math.max(getTextDisplayUnits(line), 1)
    return sum + Math.max(1, Math.ceil(units / maxUnitsPerLine))
  }, 0)
}

function estimateRowHeight(row: Run[][], columnWidths: number[]): number {
  const maxLines = Math.max(
    1,
    ...row.map((cell, index) => estimateWrappedLines(cell, columnWidths[index] ?? columnWidths[columnWidths.length - 1] ?? TOTAL_TABLE_WIDTH))
  )

  return Math.max(DEFAULT_ROW_HEIGHT, 1100 + (maxLines * 900))
}

function splitTableRows(rows: Run[][][], columnWidths: number[]): Run[][][][] {
  if (rows.length <= 3) return [rows]

  const header = rows[0]
  const chunks: Run[][][][] = []
  let currentChunk: Run[][][] = [header]
  let currentHeight = estimateRowHeight(header, columnWidths)

  for (const row of rows.slice(1)) {
    const rowHeight = estimateRowHeight(row, columnWidths)
    if (currentChunk.length > 1 && currentHeight + rowHeight > MAX_TABLE_CHUNK_HEIGHT) {
      chunks.push(currentChunk)
      currentChunk = [header, row]
      currentHeight = estimateRowHeight(header, columnWidths) + rowHeight
    } else {
      currentChunk.push(row)
      currentHeight += rowHeight
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

function selectTableTypography(rows: Run[][][], columnWidths: number[]) {
  const columnCount = Math.max(...rows.map(row => row.length))
  const longestCellUnits = rows
    .flatMap(row => row.map((cell, index) => {
      const width = columnWidths[index] ?? columnWidths[columnWidths.length - 1] ?? TOTAL_TABLE_WIDTH
      const text = getRunsText(cell)
      return width === 0 ? 0 : getTextDisplayUnits(text) / width
    }))
    .reduce((max, value) => Math.max(max, value), 0)

  const isDense = columnCount >= 6 || longestCellUnits > 0.0065
  return {
    headerCharPrId: isDense ? 16 : 15,
    bodyCharPrId: isDense ? 8 : 0,
    headerParaPrId: 7,
    bodyParaPrId: 8,
  }
}

function makeTable(rows: Run[][][], tableIndex: number, columnWidths: number[]): string {
  if (rows.length === 0) return ''

  const columnCount = Math.max(...rows.map(row => row.length))
  const normalizedWidths = Array.from({ length: columnCount }, (_, index) =>
    columnWidths[index] ?? columnWidths[columnWidths.length - 1] ?? Math.floor(TOTAL_TABLE_WIDTH / Math.max(columnCount, 1))
  )
  const typography = selectTableTypography(rows, normalizedWidths)
  const totalHeight = rows.reduce((sum, row) => sum + estimateRowHeight(row, normalizedWidths), 0)

  const tableRows = rows.map((row, rowIndex) => {
    const rowHeight = rowIndex === 0
      ? Math.max(estimateRowHeight(row, normalizedWidths), 2200)
      : estimateRowHeight(row, normalizedWidths)
    const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
      const cellRuns = row[columnIndex] ?? [{ text: '' }]
      const charPrId = rowIndex === 0 ? typography.headerCharPrId : typography.bodyCharPrId
      const paraPrId = rowIndex === 0 ? typography.headerParaPrId : typography.bodyParaPrId
      const cellLines = splitRunsIntoLines(cellRuns)
      // 헤더 셀은 styleIDRef=1 (표 머리글 — parPrIDRef=7 CENTER) 적용해 셀 내부 중앙정렬 보장
      const cellStyleId = rowIndex === 0 ? 1 : 0
      const paragraphs = cellLines
        .map(line => makeSingleParagraph(line, charPrId, paraPrId, cellStyleId).replace('<hp:p id="0"', '<hp:p id="2147483648"'))
        .join('')
      const columnWidth = normalizedWidths[columnIndex]

      const borderFillId = rowIndex === 0 ? TABLE_HEADER_BORDER_FILL_ID : TABLE_BORDER_FILL_ID

      const cellMargin = rowIndex === 0
        ? '<hp:cellMargin left="150" right="150" top="150" bottom="150"/>'
        : '<hp:cellMargin left="120" right="120" top="90" bottom="90"/>'

      // 헤더 셀 vertAlign="CENTER" — 짧은 헤더 텍스트가 셀 높이 중앙에 오도록
      const subListVertAlign = rowIndex === 0 ? 'CENTER' : 'TOP'
      return `<hp:tc name="" header="${rowIndex === 0 ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${borderFillId}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${subListVertAlign}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paragraphs}</hp:subList><hp:cellAddr colAddr="${columnIndex}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${columnWidth}" height="${rowHeight}"/>${cellMargin}</hp:tc>`
    }).join('')

    return `<hp:tr>${cells}</hp:tr>`
  }).join('')

  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${100000 + tableIndex}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="1" rowCnt="${rows.length}" colCnt="${columnCount}" cellSpacing="0" borderFillIDRef="${TABLE_BORDER_FILL_ID}" noAdjust="0"><hp:sz width="${normalizedWidths.reduce((sum, width) => sum + width, 0)}" widthRelTo="ABSOLUTE" height="${Math.max(totalHeight, DEFAULT_ROW_HEIGHT)}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="320" right="320" top="120" bottom="120"/>${tableRows}</hp:tbl><hp:t/></hp:run></hp:p>`
}

/**
 * Blockquote 박스 — 1x1 표로 구현.
 * 좌측 두꺼운 파란 bar + 나머지는 연한 회색 경계 + 연블루 배경.
 * 화면 상의 블록쿼트 박스와 시각적으로 유사한 효과.
 */
function makeBlockquoteBox(runs: Run[], boxIndex: number): string {
  const width = TOTAL_TABLE_WIDTH
  const lineCount = estimateWrappedLines(runs, width)
  const height = Math.max(DEFAULT_ROW_HEIGHT, 1400 + lineCount * 850)

  const cellLines = splitRunsIntoLines(runs)
  const paragraphs = cellLines
    .map(line => makeSingleParagraph(line, 0, 0).replace('<hp:p id="0"', '<hp:p id="2147483648"'))
    .join('')

  const cellMargin = '<hp:cellMargin left="320" right="240" top="220" bottom="220"/>'

  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${200000 + boxIndex}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="${BLOCKQUOTE_BORDER_FILL_ID}" noAdjust="0"><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="120" bottom="120"/><hp:inMargin left="320" right="320" top="120" bottom="120"/><hp:tr><hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${BLOCKQUOTE_BORDER_FILL_ID}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paragraphs}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="${height}"/>${cellMargin}</hp:tc></hp:tr></hp:tbl><hp:t/></hp:run></hp:p>`
}

function blocksToXml(blocks: Block[]): string {
  let tableIndex = 0
  let blockquoteIndex = 0
  const xmlBlocks: string[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        xmlBlocks.push(makeHeading(block.level, block.text))
        // H2 뒤에는 여유 공간 하나 더 (섹션 구분 강조)
        xmlBlocks.push(makeEmptyParagraph())
        if (block.level === 1 || block.level === 2) {
          xmlBlocks.push(makeEmptyParagraph())
        }
        break
      case 'paragraph':
        xmlBlocks.push(makeParagraph(block.runs))
        xmlBlocks.push(makeEmptyParagraph())
        break
      case 'bullet':
        xmlBlocks.push(makeParagraph(block.runs, { prefix: block.prefix ?? '• ', paraPrId: 5 }))
        break
      case 'ordered':
        xmlBlocks.push(makeParagraph(block.runs, { prefix: `${block.index}. `, paraPrId: 5 }))
        break
      case 'blockquote':
        xmlBlocks.push(makeBlockquoteBox(block.runs, blockquoteIndex))
        xmlBlocks.push(makeEmptyParagraph())
        blockquoteIndex += 1
        break
      case 'rule':
        xmlBlocks.push(makeRule())
        xmlBlocks.push(makeEmptyParagraph())
        break
      case 'table':
        {
          const columnWidths = calculateColumnWidths(block.rows)
          for (const chunk of splitTableRows(block.rows, columnWidths)) {
            xmlBlocks.push(makeTable(chunk, tableIndex, columnWidths))
            xmlBlocks.push(makeEmptyParagraph())
            tableIndex += 1
          }
        }
        break
    }
  }

  if (xmlBlocks.length === 0) {
    xmlBlocks.push(makeParagraph([{ text: '보고서 내용이 없습니다.' }]))
  }

  return xmlBlocks.join('\n')
}

function validateXml(xml: string, label: string) {
  if (typeof DOMParser === 'undefined') return

  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = parsed.querySelector('parsererror')
  if (parserError) {
    throw new Error(`${label} XML 생성 실패`)
  }
}

function createHeaderXml(): string {
  const baseHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="1.5" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces itemCnt="7"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface><hh:fontface lang="LATIN" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface><hh:fontface lang="HANJA" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface><hh:fontface lang="JAPANESE" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface><hh:fontface lang="OTHER" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface><hh:fontface lang="SYMBOL" fontCnt="1"><hh:font id="0" face="Symbol" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface><hh:fontface lang="USER" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface></hh:fontfaces><hh:borderFills itemCnt="2"><hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/></hh:borderFill><hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/></hh:borderFill></hh:borderFills><hh:charProperties itemCnt="5"><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr><hh:charPr id="1" height="1800" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr><hh:charPr id="2" height="1400" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr><hh:charPr id="3" height="1200" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr><hh:charPr id="4" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr></hh:charProperties><hh:parShapes itemCnt="1"><hh:parShape id="0" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="0" next="0" indent="0"/><hh:lineSpacing type="PERCENT" value="160"/><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape></hh:parShapes><hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" parPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langIDRef="0" lockForm="0"/></hh:styles></hh:refList><hh:compatibleDocument targetProgram="HWP2014"/><hh:docOption><hh:linkinfo path="" pageInherit="1" footnoteInherit="0"/></hh:docOption></hh:head>`

  const extraBorderFills = [
    '<hh:borderFill id="3" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="SOLID" width="0.18 mm" color="#B8C1D1"/><hh:rightBorder type="SOLID" width="0.18 mm" color="#B8C1D1"/><hh:topBorder type="SOLID" width="0.18 mm" color="#8B96A8"/><hh:bottomBorder type="SOLID" width="0.18 mm" color="#8B96A8"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/></hh:borderFill>',
    '<hh:borderFill id="4" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="SOLID" width="0.22 mm" color="#1557B0"/><hh:rightBorder type="SOLID" width="0.22 mm" color="#1557B0"/><hh:topBorder type="SOLID" width="0.22 mm" color="#0D47A1"/><hh:bottomBorder type="SOLID" width="0.22 mm" color="#0D47A1"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="#1A73E8" hatchColor="#1A73E8"/></hc:fillBrush></hh:borderFill>',
    // id=5 — blockquote 박스용 (좌측 파란 바 + 연한 블루 배경)
    '<hh:borderFill id="5" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="SOLID" width="1.0 mm" color="#1A73E8"/><hh:rightBorder type="SOLID" width="0.15 mm" color="#DADCE0"/><hh:topBorder type="SOLID" width="0.15 mm" color="#DADCE0"/><hh:bottomBorder type="SOLID" width="0.15 mm" color="#DADCE0"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="#F1F8FF" hatchColor="#F1F8FF"/></hc:fillBrush></hh:borderFill>',
  ].join('')

  const extraCharProperties = [
    '<hh:charPr id="5" height="1000" textColor="#5F6368" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:italic/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="6" height="950" textColor="#0B57D0" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="7" height="1000" textColor="#202124" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:italic/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="8" height="900" textColor="#202124" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="9" height="900" textColor="#202124" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    // H1 — 프로젝트/보고서 대표 제목: 아주 크고 진한 네이비 + 볼드 + 밑줄 효과
    '<hh:charPr id="10" height="2600" textColor="#0D47A1" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="BOTTOM" shape="DOUBLE" color="#0D47A1"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    // H2 — 섹션 제목: 크게, 브랜드 블루, 볼드, 얇은 밑줄
    '<hh:charPr id="11" height="2000" textColor="#1A73E8" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="BOTTOM" shape="SOLID" color="#1A73E8"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    // H3 — 서브 제목: 중간 크기, 짙은 블루, 볼드
    '<hh:charPr id="12" height="1500" textColor="#1557B0" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    // H4 — 최소 제목: 본문보다 약간 큰 진한 회색, 볼드
    '<hh:charPr id="13" height="1250" textColor="#3C4043" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="14" height="1000" textColor="#0B57D0" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="15" height="1000" textColor="#FFFFFF" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    '<hh:charPr id="16" height="900" textColor="#FFFFFF" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
  ].join('')

  const extraParShapes = [
    '<hh:parShape id="1" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="0" next="520" indent="0"/><hh:lineSpacing type="PERCENT" value="140"/><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="2" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="280" next="340" indent="0"/><hh:lineSpacing type="PERCENT" value="145"/><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="3" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="220" next="220" indent="0"/><hh:lineSpacing type="PERCENT" value="150"/><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="4" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="180" next="180" indent="0"/><hh:lineSpacing type="PERCENT" value="155"/><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="5" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="1200" right="0" prev="0" next="80" indent="-420"/><hh:lineSpacing type="PERCENT" value="160"/><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="6" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="900" right="300" prev="80" next="180" indent="0"/><hh:lineSpacing type="PERCENT" value="160"/><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="7" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="0" next="0" indent="0"/><hh:lineSpacing type="PERCENT" value="135"/><hh:align horizontal="CENTER" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
    '<hh:parShape id="8" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="0" right="0" prev="0" next="0" indent="0"/><hh:lineSpacing type="PERCENT" value="138"/><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>',
  ].join('')

  // 표 헤더 중앙정렬 전용 스타일 — paraPrIDRef만으로 셀 내부 정렬이 잘 먹지 않는 이슈를 style 경유로 우회
  const extraStyles = [
    '<hh:style id="1" type="PARA" name="표 머리글" engName="TableHeader" parPrIDRef="7" charPrIDRef="15" nextStyleIDRef="0" langIDRef="0" lockForm="0"/>',
  ].join('')

  return baseHeader
    .replace('hh:borderFills itemCnt="2"', 'hh:borderFills itemCnt="5"')
    .replace('</hh:borderFills>', `${extraBorderFills}</hh:borderFills>`)
    .replace('hh:charProperties itemCnt="5"', 'hh:charProperties itemCnt="17"')
    .replace('</hh:charProperties>', `${extraCharProperties}</hh:charProperties>`)
    .replace('hh:parShapes itemCnt="1"', 'hh:parShapes itemCnt="9"')
    .replace('</hh:parShapes>', `${extraParShapes}</hh:parShapes>`)
    .replace('hh:styles itemCnt="1"', 'hh:styles itemCnt="2"')
    .replace('</hh:styles>', `${extraStyles}</hh:styles>`)
}

function createContentHpf(title: string): string {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="" unique-identifier="" id="">
  <opf:metadata>
    <opf:title>${escapeXml(title)}</opf:title>
    <opf:language>ko</opf:language>
    <opf:meta name="CreatedDate" content="text">${now}</opf:meta>
    <opf:meta name="ModifiedDate" content="text">${now}</opf:meta>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    <opf:item id="settings" href="settings.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="header" linear="yes"/>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`
}

function createContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </rootfiles>
</container>`
}

function createSectionXml(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="PORTRAIT" width="59528" height="84188" gutterType="LEFT_ONLY"><hp:margin header="4819" footer="4819" gutter="0" left="7200" right="7200" top="7200" bottom="7200"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr></hp:secPr></hp:run></hp:p>
${bodyXml}
</hs:sec>`
}

function createVersionXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="12, 0, 0, 0 WIN32LEWindows_10"/>'
}

function createManifestXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'
}

function createSettingsXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>'
}

function createContainerRdf(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description></rdf:RDF>'
}

function createPreviewText(blocks: Block[]): string {
  const plain = blocks.flatMap(block => {
    switch (block.type) {
      case 'heading':
        return [block.text]
      case 'paragraph':
      case 'bullet':
      case 'blockquote':
        return [block.runs.map(run => run.text).join('')]
      case 'ordered':
        return [`${block.index}. ${block.runs.map(run => run.text).join('')}`]
      case 'rule':
        return ['']
      case 'table':
        return block.rows.flatMap(row => row.map(cell => cell.map(run => run.text).join(' ')))
    }
  }).filter(Boolean)

  return plain.join('\n').slice(0, 2000)
}

async function validateZipStructure(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())

  for (const path of REQUIRED_ENTRIES) {
    if (!zip.file(path)) {
      throw new Error(`HWPX 필수 파일 누락: ${path}`)
    }
  }

  const mimetype = await zip.file('mimetype')!.async('string')
  if (mimetype.trim() !== HWPX_MIMETYPE) {
    throw new Error('HWPX mimetype이 올바르지 않습니다.')
  }
}

export async function generateHwpx(markdown: string, title: string): Promise<Blob> {
  const blocks = parseMarkdown(markdown)
  const bodyXml = blocksToXml(blocks)
  const containerXml = createContainerXml()
  const contentHpf = createContentHpf(title)
  const headerXml = createHeaderXml()
  const sectionXml = createSectionXml(bodyXml)
  const versionXml = createVersionXml()
  const manifestXml = createManifestXml()
  const settingsXml = createSettingsXml()
  const containerRdf = createContainerRdf()
  const previewText = createPreviewText(blocks)

  validateXml(containerXml, 'container')
  validateXml(contentHpf, 'content')
  validateXml(headerXml, 'header')
  validateXml(sectionXml, 'section')
  validateXml(settingsXml, 'settings')
  validateXml(containerRdf, 'container.rdf')

  const zip = new JSZip()
  zip.file('mimetype', HWPX_MIMETYPE, { compression: 'STORE' })
  zip.file('META-INF/container.xml', containerXml)
  zip.file('META-INF/container.rdf', containerRdf)
  zip.file('META-INF/manifest.xml', manifestXml)
  zip.file('Contents/content.hpf', contentHpf)
  zip.file('Contents/header.xml', headerXml)
  zip.file('Contents/section0.xml', sectionXml)
  zip.file('Contents/BodyText/Section0.xml', sectionXml)
  zip.file('Preview/PrvText.txt', previewText)
  zip.file('settings.xml', settingsXml)
  zip.file('version.xml', versionXml)

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: HWPX_MIMETYPE,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  await validateZipStructure(blob)

  return blob
}

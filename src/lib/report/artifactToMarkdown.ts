// 산출물 섹션 글을 보고서·내보내기(PDF·MD)용 마크다운으로 정규화한다.
//  ① '**라벨**: 내용' 줄이 2개 이상 이어지면 '| 구분 | 내용 |' 표 (라벨의 '행1 (실제성)' → '실제성')
//  ② '**1-2학년군 국어 [2국03-02]**: …' / '[2국03-02] (국어/중심): …' 꼴이 2줄 이상이면 '| 학년군 | 교과 | 성취기준 | 평가 내용 |' 표
//  ③ 이미 표인 블록은 그대로
//  ④ 그 외 여러 줄 문단은 줄마다 목록(단일 줄바꿈이 한 문단으로 뭉치지 않게)

const LABEL_LINE_RE = /^\*\*([^*\n]{1,40}?)\*\*\s*[:：]\s*(.*)$/
const BAND_STANDARD_RE = /^\*\*(\d-\d학년군)\s+([^[\]*]+?)\s+((?:\[[^\]\n]+\][\s·,]*)+)\*\*\s*[:：]\s*(.+)$/
const CODE_FIRST_STANDARD_RE = /^((?:\[\d[가-힣]{1,3}\d{2}-\d{2}\][\s·,]*)+)\s*\(([^/)]+)(?:\/[^)]*)?\)\s*[:：]\s*(.+)$/
const LIST_LINE_RE = /^\s*(?:[-*+]\s|\d+[.)]\s)/
const BAND_BY_LEVEL: Record<string, string> = { '2': '1-2학년군', '4': '3-4학년군', '6': '5-6학년군' }

export interface StandardsAlignmentRow {
  gradeBand: string
  subject: string
  standards: string
  content: string
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim() || '-'

/** '행1 (실제성)' → '실제성', '행2 (학습 내용+산출물)' → '학습 내용+산출물'. 그 밖의 라벨은 그대로. */
export function cleanRowLabel(label: string): string {
  const match = label.trim().match(/^행\s*\d+\s*[(（]\s*(.+?)\s*[)）]$/)
  return match ? match[1] : label.trim()
}

function parseStandardsLine(line: string): StandardsAlignmentRow | null {
  const band = line.match(BAND_STANDARD_RE)
  if (band) {
    return { gradeBand: band[1], subject: band[2].trim(), standards: band[3].replace(/[\s,]+$/, '').trim(), content: band[4].trim() }
  }
  const codeFirst = line.replace(/^\*\*|\*\*(?=\s*\()/g, '').match(CODE_FIRST_STANDARD_RE)
  if (codeFirst) {
    const standards = codeFirst[1].replace(/[\s,]+$/, '').trim()
    return { gradeBand: BAND_BY_LEVEL[standards.charAt(1)] ?? '-', subject: codeFirst[2].trim(), standards, content: codeFirst[3].trim() }
  }
  return null
}

/** 성취기준 연결 글을 행으로 읽는다. 2줄 이상 읽혀야 표로 본다(그 외 줄이 섞여 있으면 null). */
export function parseStandardsAlignmentLines(text: string): StandardsAlignmentRow[] | null {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const rows = lines.map(parseStandardsLine)
  if (rows.length < 2 || rows.some(row => !row)) return null
  return rows as StandardsAlignmentRow[]
}

export function standardsAlignmentTable(rows: readonly StandardsAlignmentRow[]): string {
  return [
    '| 학년군 | 교과 | 성취기준 | 평가 내용 |',
    '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${cell(row.gradeBand)} | ${cell(row.subject)} | ${cell(row.standards)} | ${cell(row.content)} |`),
  ].join('\n')
}

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line)

/** 라벨 줄과 그 뒤에 이어지는(라벨이 아닌) 줄을 한 항목으로 묶는다. */
function readLabelItems(lines: string[]): Array<{ label: string; content: string }> | null {
  const items: Array<{ label: string; content: string }> = []
  for (const line of lines) {
    const match = line.match(LABEL_LINE_RE)
    if (match) items.push({ label: cleanRowLabel(match[1]), content: match[2].trim() })
    else if (items.length) items[items.length - 1].content += ` ${line.trim()}`
    else return null
  }
  return items
}

/**
 * 산출물 섹션 글 → 보고서용 마크다운. 빈 줄로 나뉜 블록 단위로 판단하되,
 * '라벨: 내용' 블록과 성취기준 블록은 빈 줄을 건너 이어져도 하나의 표로 모은다.
 */
export function normalizeArtifactText(text: string): string {
  const source = text.replace(/\r\n?/g, '\n').trim()
  if (!source) return ''
  const blocks = source.split(/\n\s*\n/).map(block => block.split('\n').map(line => line.trimEnd()).filter(line => line.trim()))

  const out: string[] = []
  let i = 0
  while (i < blocks.length) {
    // ② 성취기준 연결 — 연속 블록을 모아 판단
    let j = i
    const standardLines: string[] = []
    while (j < blocks.length && blocks[j].every(line => parseStandardsLine(line.trim()))) {
      standardLines.push(...blocks[j]); j++
    }
    if (standardLines.length >= 2) {
      out.push(standardsAlignmentTable(standardLines.map(line => parseStandardsLine(line.trim())!)))
      i = j
      continue
    }
    // ① 라벨: 내용 — 각 블록이 라벨 줄로 시작하면 이어서 모은다
    j = i
    const labelItems: Array<{ label: string; content: string }> = []
    while (j < blocks.length && LABEL_LINE_RE.test(blocks[j][0].trim()) && !blocks[j].some(isTableLine)) {
      const items = readLabelItems(blocks[j].map(line => line.trim()))
      if (!items) break
      labelItems.push(...items); j++
    }
    if (labelItems.length >= 2) {
      out.push(['| 구분 | 내용 |', '| --- | --- |', ...labelItems.map(item => `| ${cell(item.label)} | ${cell(item.content)} |`)].join('\n'))
      i = j
      continue
    }
    const block = blocks[i]
    i++
    // ③ 표·목록·머리글·인용은 그대로, 한 줄 문단도 그대로
    if (block.some(isTableLine) || block.length === 1 || block.every(line => LIST_LINE_RE.test(line) || /^\s{2,}/.test(line))
      || /^\s*(?:#{1,6}\s|>)/.test(block[0])) {
      out.push(block.join('\n'))
      continue
    }
    // ④ 여러 줄 문단 → 줄마다 목록
    out.push(block.map(line => (LIST_LINE_RE.test(line) ? line.trim() : `- ${line.trim()}`)).join('\n'))
  }
  return out.join('\n\n')
}

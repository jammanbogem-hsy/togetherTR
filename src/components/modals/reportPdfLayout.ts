export const REPORT_PDF_PAGE = { widthMm: 210, heightMm: 297, marginMm: 12, captureWidthPx: 794, gapPx: 16 } as const

export interface PdfBlockLayout {
  height: number
  breakpoints?: number[]
  startNewPage?: boolean
  headers?: Array<{ start: number; end: number; tableEnd: number }>
}
export interface PdfPageSlice {
  block: number
  page: number
  start: number
  height: number
  top: number
  scale: number
  header?: number
}

export function reportPdfFilename(projectTitle: string, stageLabel: string): string {
  const clean = (value: string, fallback: string) => Array.from(value).map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
    .replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || fallback
  return `${clean(projectTitle, '프로젝트')} ${clean(stageLabel, '단계')} 보고서.pdf`
}

/** 섹션은 통째로 배치하고, 긴 섹션은 행·문단 경계에서 나눈다. 큰 단일 행은 축소해 보존한다. */
export function layoutReportPdf(blocks: PdfBlockLayout[], options: Partial<Record<keyof typeof REPORT_PDF_PAGE, number>> = {}): PdfPageSlice[] {
  const { widthMm, heightMm, marginMm, captureWidthPx, gapPx } = { ...REPORT_PDF_PAGE, ...options }
  if (![widthMm, heightMm, marginMm, captureWidthPx, gapPx].every(Number.isFinite) || marginMm < 0 || widthMm <= marginMm * 2 || heightMm <= marginMm * 2) throw new Error('잘못된 PDF 페이지 크기입니다.')
  const pageHeight = (heightMm - marginMm * 2) * captureWidthPx / (widthMm - marginMm * 2)
  if (!Number.isFinite(pageHeight) || pageHeight <= 0 || captureWidthPx <= 0 || gapPx < 0) throw new Error('잘못된 PDF 페이지 크기입니다.')
  const slices: PdfPageSlice[] = []
  let page = 1, top = 0
  blocks.forEach((block, index) => {
    if (!Number.isFinite(block.height) || block.height < 0) throw new Error('잘못된 보고서 높이입니다.')
    if (!block.height) return
    if (top > 0 && (block.startNewPage || top + block.height > pageHeight + 0.001)) { page++; top = 0 }
    const boundaries = [...new Set([...(block.breakpoints ?? []).filter(point => Number.isFinite(point) && point > 0 && point < block.height), block.height])].sort((a, b) => a - b)
    let start = 0
    while (start < block.height - 0.001) {
      const header = (block.headers ?? []).findIndex(item => start > 0 && start >= item.end - 0.001 && start < item.tableEnd - 0.001)
      const headerHeight = header < 0 ? 0 : block.headers![header].end - block.headers![header].start
      const available = pageHeight - top - headerHeight
      const fitting = boundaries.filter(end => end > start + 0.001 && end - start <= available + 0.001)
      const end = fitting.at(-1) ?? boundaries.find(point => point > start + 0.001)!
      const height = end - start
      const scale = Math.min(1, (pageHeight - top) / (height + headerHeight))
      slices.push({ block: index, page, start, height, top, scale, ...(header >= 0 ? { header } : {}) })
      top += (height + headerHeight) * scale
      start = end
      if (start < block.height - 0.001) { page++; top = 0 }
    }
    top += gapPx
  })
  return slices
}

import type { Options as CanvasOptions } from 'html2canvas-pro'
import { buildReportPrintDocument, cloneReportForPrint } from './printReport'
import { layoutReportPdf, reportPdfFilename, REPORT_PDF_PAGE, type PdfBlockLayout } from './reportPdfLayout'

interface MeasuredBlock extends PdfBlockLayout {
  element: HTMLElement
  headerElements: HTMLElement[]
}

function reportBlocks(root: HTMLElement): HTMLElement[] {
  if (root.matches('.report-hero,.report-section')) return [root]
  const children = Array.from(root.children).filter((child): child is HTMLElement => child instanceof root.ownerDocument.defaultView!.HTMLElement && !['STYLE', 'SCRIPT'].includes(child.tagName))
  if (root.matches('.report-dashboard')) return children
  if (root.querySelector('.report-hero,.report-dashboard,.report-section')) return children.flatMap(reportBlocks)
  return [root]
}

/** 소제목처럼 쓰인 문단 — 굵은 글씨 한 줄만 있는 짧은 문단('**AI 점검**'). */
export function isLabelParagraph(text: string, strongText: string): boolean {
  const t = text.trim()
  return !!t && t.length <= 40 && t === strongText.trim()
}

/**
 * 소제목과 그 뒤 첫 내용 사이에서는 페이지를 나누지 않는다 — 제목만 앞 페이지 끝에 남던 결함.
 * keep: [소제목 위쪽, 뒤따르는 첫 행·문단의 아래쪽) 구간 안의 경계는 버린다.
 */
export function keepHeadingsWithNext(breakpoints: readonly number[], keep: ReadonlyArray<{ start: number; end: number }>): number[] {
  return breakpoints.filter(point => !keep.some(range => point > range.start + 0.5 && point < range.end - 0.5))
}

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'
function isHeadingLike(element: HTMLElement): boolean {
  if (element.matches(HEADING_SELECTOR)) return true
  if (element.tagName !== 'P') return false
  const strong = Array.from(element.querySelectorAll('strong,b')).map(item => item.textContent ?? '').join('')
  return isLabelParagraph(element.textContent ?? '', strong)
}

function measureBlock(element: HTMLElement): MeasuredBlock {
  const bounds = element.getBoundingClientRect()
  // 표의 내부 문단을 경계로 쓰면 한 행이 잘리므로 최상위 행·문단만 사용한다. 내용 없는 빈 문단은 경계가 아니다.
  const candidates = Array.from(element.querySelectorAll<HTMLElement>('tr,p,li,pre,blockquote')).filter(child => {
    if (child.closest('thead')) return false
    if (child.tagName !== 'TR' && child.closest('tr')) return false
    if (child.tagName !== 'LI' && child.closest('li')) return false
    return child.getBoundingClientRect().height > 0 && !!child.textContent?.trim()
  })
  // 소제목(h1~h6·굵은 한 줄 문단)은 뒤따르는 첫 행·문단과 한 묶음으로 둔다.
  const headings = Array.from(element.querySelectorAll<HTMLElement>(`${HEADING_SELECTOR},p`)).filter(item => isHeadingLike(item) && item.getBoundingClientRect().height > 0)
  const keep = headings.map(heading => {
    const top = heading.getBoundingClientRect().top - bounds.top
    const next = candidates.find(child => child !== heading && !isHeadingLike(child)
      && (heading.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
    return { start: top, end: next ? next.getBoundingClientRect().bottom - bounds.top : top }
  })
  const breakpoints = keepHeadingsWithNext(candidates.map(child => child.getBoundingClientRect().bottom - bounds.top), keep)
  const headerElements = Array.from(element.querySelectorAll<HTMLElement>('thead')).filter(header => !header.closest('.report-table-wide') && header.getBoundingClientRect().height > 0)
  const headers = headerElements.map(header => {
    const rectangle = header.getBoundingClientRect()
    return { start: rectangle.top - bounds.top, end: rectangle.bottom - bounds.top, tableEnd: header.closest('table')!.getBoundingClientRect().bottom - bounds.top }
  })
  return { element, height: bounds.height, breakpoints, headers, headerElements, startNewPage: element.matches('.report-appendix') }
}

/** 버튼을 누른 순간에만 캡처/PDF 라이브러리를 읽고, 원본 화면을 변경하지 않고 파일을 저장한다. */
export async function downloadReportPdf(content: HTMLElement, projectTitle: string, stageLabel: string): Promise<void> {
  const clean = cloneReportForPrint(content)
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.title = 'PDF 생성 임시 문서'
  frame.tabIndex = -1
  // 인쇄 창 CSS가 앱의 모달·스크롤에 영향을 주지 않도록 독립 문서에서 캡처한다.
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: `${REPORT_PDF_PAGE.captureWidthPx}px`, height: '1200px', border: '0', pointerEvents: 'none' })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const ready = new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve()
      frame.onerror = () => reject(new Error('PDF 문서를 준비하지 못했습니다.'))
      timeout = setTimeout(() => reject(new Error('PDF 문서 준비 시간이 초과됐습니다.')), 20000)
    })
    frame.srcdoc = buildReportPrintDocument(clean.innerHTML, reportPdfFilename(projectTitle, stageLabel))
    document.body.appendChild(frame)
    await ready
    clearTimeout(timeout)
    const doc = frame.contentDocument
    if (!doc) throw new Error('PDF 문서에 접근하지 못했습니다.')
    Object.assign(doc.body.style, { width: `${REPORT_PDF_PAGE.captureWidthPx}px`, padding: '0', margin: '0', maxWidth: 'none' })
    await doc.fonts.ready
    const measured = reportBlocks(doc.body).map(measureBlock).filter(block => block.height > 0)
    const slices = layoutReportPdf(measured)
    if (!slices.length) throw new Error('PDF로 저장할 보고서 내용이 없습니다.')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    const { widthMm, marginMm, captureWidthPx } = REPORT_PDF_PAGE
    const contentWidth = widthMm - marginMm * 2
    const mmPerPx = contentWidth / captureWidthPx
    const base: Partial<CanvasOptions> = { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: captureWidthPx, scrollX: 0, scrollY: 0 }
    let page = 1
    for (const slice of slices) {
      while (page < slice.page) { pdf.addPage(); page++ }
      const block = measured[slice.block]
      let y = marginMm + slice.top * mmPerPx
      if (slice.header !== undefined) {
        const header = block.headerElements[slice.header]
        const height = block.headers![slice.header].end - block.headers![slice.header].start
        const canvas = await html2canvas(header, { ...base, width: captureWidthPx, height })
        pdf.addImage(canvas, 'PNG', marginMm, y, contentWidth * slice.scale, height * mmPerPx * slice.scale, undefined, 'FAST')
        canvas.width = canvas.height = 0
        y += height * mmPerPx * slice.scale
      }
      // 페이지만 캡처해 긴 부록을 거대한 단일 캔버스로 만들지 않는다.
      const canvas = await html2canvas(block.element, { ...base, width: captureWidthPx, y: slice.start, height: slice.height })
      pdf.addImage(canvas, 'PNG', marginMm, y, contentWidth * slice.scale, slice.height * mmPerPx * slice.scale, undefined, 'FAST')
      canvas.width = canvas.height = 0
    }
    await pdf.save(reportPdfFilename(projectTitle, stageLabel), { returnPromise: true })
  } finally {
    clearTimeout(timeout)
    frame.remove()
  }
}

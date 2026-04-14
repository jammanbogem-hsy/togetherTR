export interface ExtractedPdfPage {
  pageNumber: number
  text: string
  charCount: number
  hasText: boolean
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

type TextItem = {
  str?: string
  transform?: number[]
  width?: number
}

export async function extractPdfPagesFromBuffer(buffer: ArrayBuffer): Promise<ExtractedPdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  })

  const pdf = await loadingTask.promise
  const pages: ExtractedPdfPage[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const textItems = (content.items as TextItem[])
      .filter(item => typeof item.str === 'string' && item.str.trim().length > 0)
      .map(item => ({
        text: item.str!.replace(/\s+/g, ' ').trim(),
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
      }))
      .sort((a, b) => {
        if (Math.abs(b.y - a.y) > 2) return b.y - a.y
        return a.x - b.x
      })

    const lines: string[] = []
    let currentY: number | null = null
    let currentLine: string[] = []

    for (const item of textItems) {
      if (currentY === null || Math.abs(item.y - currentY) <= 2) {
        currentLine.push(item.text)
        currentY = currentY ?? item.y
        continue
      }

      lines.push(currentLine.join(' ').replace(/\s{2,}/g, ' ').trim())
      currentLine = [item.text]
      currentY = item.y
    }

    if (currentLine.length > 0) {
      lines.push(currentLine.join(' ').replace(/\s{2,}/g, ' ').trim())
    }

    const text = normalizeWhitespace(lines.join('\n'))
    pages.push({
      pageNumber,
      text,
      charCount: text.length,
      hasText: text.length > 0,
    })
  }

  return pages
}


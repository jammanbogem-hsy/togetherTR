import type { MaterialChunkType, TextExtractQuality } from '@/types'
import type { ExtractedPdfPage } from './pdfExtract'

export interface PreparedMaterialChunk {
  chunkIndex: number
  chunkType: MaterialChunkType
  pageStart: number
  pageEnd: number
  unitTitle?: string
  topicTitle?: string
  text: string
  keywords: string[]
  tokenCount: number
}

export interface ChunkMaterialResult {
  chunks: PreparedMaterialChunk[]
  pageCount: number
  textPageCount: number
  imageOnlyPageCount: number
  textExtractQuality: TextExtractQuality
  summary: string
}

const FRONT_MATTER_HINTS = ['차례', '들어가며', '단원', '학습 목표', '학습목표']
const ACTIVITY_HINTS = ['활동', '정리', '탐구', '해보기', '자료', '실천', '토의', '토론', '써 보기', '만들기']
const APPENDIX_HINTS = ['판권', '부록', '찾아보기', '정답', '참고문헌']

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function pickKeywordCandidates(text: string): string[] {
  const tokens = text.match(/[가-힣A-Za-z0-9]{2,12}/g) ?? []
  const stopwords = new Set(['그리고', '하지만', '입니다', '합니다', '학생', '교과서', '활동', '학습', '내용', '단원', '이해', '우리'])
  const counts = new Map<string, number>()

  for (const token of tokens) {
    if (stopwords.has(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([token]) => token)
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function detectPageType(page: ExtractedPdfPage, totalPages: number): MaterialChunkType {
  const text = page.text
  if (!text) return 'activity_material'
  if (page.pageNumber <= 12 || FRONT_MATTER_HINTS.some(hint => text.includes(hint))) return 'front_matter'
  if (page.pageNumber >= totalPages - 4 || APPENDIX_HINTS.some(hint => text.includes(hint))) return 'appendix'
  if (ACTIVITY_HINTS.some(hint => text.includes(hint)) && text.length < 900) return 'activity_material'
  return 'body'
}

function detectHeading(text: string): { unitTitle?: string; topicTitle?: string } {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const shortLines = lines.filter(line => line.length >= 2 && line.length <= 30)

  const unitTitle = shortLines.find(line =>
    /(대단원|중단원|소단원|단원|\d+\.\s*[가-힣A-Za-z])/.test(line)
  )
  const topicTitle = shortLines.find(line =>
    line !== unitTitle && /(생각해|알아보|탐구|살펴보|활동|이해해|문제)/.test(line)
  )

  return {
    unitTitle,
    topicTitle,
  }
}

function buildSummary(pages: ExtractedPdfPage[], chunks: PreparedMaterialChunk[]): string {
  const nonEmptyPages = pages.filter(page => page.hasText)
  const unitTitles = [...new Set(chunks.map(chunk => chunk.unitTitle).filter(Boolean))].slice(0, 4)
  const chunkTypes = new Set(chunks.map(chunk => chunk.chunkType))
  const labels: string[] = []

  if (unitTitles.length > 0) labels.push(`주요 단원: ${unitTitles.join(', ')}`)
  if (chunkTypes.has('activity_material')) labels.push('활동자료 포함')
  labels.push(`텍스트 추출 페이지 ${nonEmptyPages.length}쪽`)

  return labels.join(' · ')
}

export function chunkPdfPages(pages: ExtractedPdfPage[]): ChunkMaterialResult {
  const totalPages = pages.length
  const textPageCount = pages.filter(page => page.hasText).length
  const imageOnlyPageCount = totalPages - textPageCount
  const ratio = totalPages > 0 ? textPageCount / totalPages : 0
  const textExtractQuality: TextExtractQuality = ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'medium' : 'low'

  const chunks: PreparedMaterialChunk[] = []
  let current: {
    pages: ExtractedPdfPage[]
    type: MaterialChunkType
    unitTitle?: string
    topicTitle?: string
    text: string[]
  } | null = null

  const flush = () => {
    if (!current || current.text.length === 0) return
    const text = normalizeText(current.text.join('\n\n'))
    if (!text) {
      current = null
      return
    }

    chunks.push({
      chunkIndex: chunks.length,
      chunkType: current.type,
      pageStart: current.pages[0].pageNumber,
      pageEnd: current.pages[current.pages.length - 1].pageNumber,
      unitTitle: current.unitTitle,
      topicTitle: current.topicTitle,
      text,
      keywords: pickKeywordCandidates(text),
      tokenCount: estimateTokenCount(text),
    })
    current = null
  }

  for (const page of pages) {
    if (!page.hasText) continue

    const pageType = detectPageType(page, totalPages)
    const heading = detectHeading(page.text)
    const pageText = normalizeText(page.text)

    const shouldStartNewChunk = !current
      || current.type !== pageType
      || current.text.join('\n\n').length > 1600
      || (heading.unitTitle && heading.unitTitle !== current.unitTitle)
      || (heading.topicTitle && current.text.join('\n\n').length > 700)

    if (shouldStartNewChunk) {
      flush()
      current = {
        pages: [page],
        type: pageType,
        unitTitle: heading.unitTitle,
        topicTitle: heading.topicTitle,
        text: [pageText],
      }
      continue
    }

    current!.pages.push(page)
    if (!current!.unitTitle && heading.unitTitle) current!.unitTitle = heading.unitTitle
    if (!current!.topicTitle && heading.topicTitle) current!.topicTitle = heading.topicTitle
    current!.text.push(pageText)
  }

  flush()

  return {
    chunks,
    pageCount: totalPages,
    textPageCount,
    imageOnlyPageCount,
    textExtractQuality,
    summary: buildSummary(pages, chunks),
  }
}


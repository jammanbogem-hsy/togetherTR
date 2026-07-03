import OpenAI from 'openai'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase/admin'
import { chunkPdfPages } from '@/lib/rag/chunking'
import { extractPdfPagesFromBuffer } from '@/lib/rag/pdfExtract'

export const runtime = 'nodejs'
export const maxDuration = 300

const embeddingClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!embeddingClient) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const batchSize = 32
  const embeddings: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const response = await embeddingClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    })
    embeddings.push(...response.data.map((item) => item.embedding))
  }

  return embeddings
}

async function clearExistingChunks(projectId: string, materialId: string): Promise<void> {
  const db = getAdminDb()
  if (!db) return
  const snap = await db
    .collection('projects').doc(projectId)
    .collection('materialChunks')
    .where('materialId', '==', materialId)
    .get()
  if (snap.empty) return

  let batch = db.batch()
  let opCount = 0

  for (const chunkDoc of snap.docs) {
    batch.delete(chunkDoc.ref)
    opCount += 1

    if (opCount === 400) {
      await batch.commit()
      batch = db.batch()
      opCount = 0
    }
  }

  if (opCount > 0) {
    await batch.commit()
  }
}

export async function POST(request: Request) {
  const db = getAdminDb()
  if (!db) {
    return Response.json(
      { error: '서버 Firestore 자격증명이 없습니다. FIREBASE_SERVICE_ACCOUNT env 또는 배포 환경 ADC가 필요합니다.' },
      { status: 500 }
    )
  }
  let parsedBody:
    | {
        projectId?: string
        materialId?: string
        downloadURL?: string
        fileName?: string
      }
    | null = null

  try {
    const body = await request.json()
    parsedBody = body
    const {
      projectId,
      materialId,
      downloadURL,
      fileName,
    }: {
      projectId?: string
      materialId?: string
      downloadURL?: string
      fileName?: string
    } = body

    if (!projectId || !materialId || !downloadURL || !fileName) {
      return Response.json({ error: 'projectId, materialId, downloadURL, fileName are required' }, { status: 400 })
    }

    const materialRef = db.collection('projects').doc(projectId).collection('materials').doc(materialId)
    await materialRef.update({
      status: 'processing',
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const response = await fetch(downloadURL, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`PDF download failed (${response.status})`)
    }

    const pdfBuffer = await response.arrayBuffer()
    const pages = await extractPdfPagesFromBuffer(pdfBuffer)
    const chunked = chunkPdfPages(pages)
    const embeddings = await embedTexts(chunked.chunks.map((chunk) => chunk.text))

    await clearExistingChunks(projectId, materialId)

    const chunkCollection = db.collection('projects').doc(projectId).collection('materialChunks')
    let batch = db.batch()
    let opCount = 0

    for (const [index, chunk] of chunked.chunks.entries()) {
      const chunkRef = chunkCollection.doc()
      batch.set(chunkRef, {
        projectId,
        materialId,
        fileName,
        chunkIndex: chunk.chunkIndex,
        chunkType: chunk.chunkType,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        unitTitle: chunk.unitTitle ?? null,
        topicTitle: chunk.topicTitle ?? null,
        text: chunk.text,
        keywords: chunk.keywords,
        embedding: embeddings[index],
        tokenCount: chunk.tokenCount,
        createdAt: FieldValue.serverTimestamp(),
      })
      opCount += 1
      if (opCount === 400) {
        await batch.commit()
        batch = db.batch()
        opCount = 0
      }
    }

    if (opCount > 0) {
      await batch.commit()
    }

    await materialRef.update({
      status: 'ready',
      pageCount: chunked.pageCount,
      chunkCount: chunked.chunks.length,
      textPageCount: chunked.textPageCount,
      imageOnlyPageCount: chunked.imageOnlyPageCount,
      textExtractQuality: chunked.textExtractQuality,
      summary: chunked.summary,
      readyAt: Date.now(),
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return Response.json({
      ok: true,
      pageCount: chunked.pageCount,
      chunkCount: chunked.chunks.length,
      summary: chunked.summary,
      textExtractQuality: chunked.textExtractQuality,
    })
  } catch (error) {
    const projectId = typeof parsedBody?.projectId === 'string' ? parsedBody.projectId : null
    const materialId = typeof parsedBody?.materialId === 'string' ? parsedBody.materialId : null

    if (projectId && materialId) {
      await db
        .collection('projects').doc(projectId)
        .collection('materials').doc(materialId)
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[materials/process] failed:', error)
    return Response.json({ error: message }, { status: 500 })
  }
}

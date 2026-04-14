import OpenAI from 'openai'
import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { serverDb } from '@/lib/firebase/server'
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
  if (!serverDb) return
  const chunkQuery = query(
    collection(serverDb, 'projects', projectId, 'materialChunks'),
    where('materialId', '==', materialId)
  )
  const snap = await getDocs(chunkQuery)
  if (snap.empty) return

  let batch = writeBatch(serverDb)
  let opCount = 0

  for (const chunkDoc of snap.docs) {
    batch.delete(chunkDoc.ref)
    opCount += 1

    if (opCount === 400) {
      await batch.commit()
      batch = writeBatch(serverDb)
      opCount = 0
    }
  }

  if (opCount > 0) {
    await batch.commit()
  }
}

export async function POST(request: Request) {
  if (!serverDb) {
    return Response.json({ error: 'Firebase server configuration is not available' }, { status: 500 })
  }
  const db = serverDb
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

    const materialRef = doc(db, 'projects', projectId, 'materials', materialId)
    await updateDoc(materialRef, {
      status: 'processing',
      error: deleteField(),
      updatedAt: serverTimestamp(),
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

    let batch = writeBatch(db)
    let opCount = 0

    for (const [index, chunk] of chunked.chunks.entries()) {
      const chunkRef = doc(collection(db, 'projects', projectId, 'materialChunks'))
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
        createdAt: serverTimestamp(),
      })
      opCount += 1
      if (opCount === 400) {
        await batch.commit()
        batch = writeBatch(db)
        opCount = 0
      }
    }

    if (opCount > 0) {
      await batch.commit()
    }

    await updateDoc(materialRef, {
      status: 'ready',
      pageCount: chunked.pageCount,
      chunkCount: chunked.chunks.length,
      textPageCount: chunked.textPageCount,
      imageOnlyPageCount: chunked.imageOnlyPageCount,
      textExtractQuality: chunked.textExtractQuality,
      summary: chunked.summary,
      readyAt: Date.now(),
      error: deleteField(),
      updatedAt: serverTimestamp(),
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

    if (projectId && materialId && serverDb) {
      await updateDoc(doc(serverDb, 'projects', projectId, 'materials', materialId), {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: serverTimestamp(),
      }).catch(() => undefined)
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[materials/process] failed:', error)
    return Response.json({ error: message }, { status: 500 })
  }
}

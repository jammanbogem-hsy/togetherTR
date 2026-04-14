import OpenAI from 'openai'
import { collection, getDocs } from 'firebase/firestore'
import { serverDb } from '@/lib/firebase/server'
import type { ActivityCode, MaterialChunk, MaterialSearchHit } from '@/types'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'

const embeddingClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

type ChatLikeMessage = { role: 'user' | 'assistant'; content: string }

interface SearchProjectMaterialsParams {
  projectId: string
  activityCode: ActivityCode
  messages: ChatLikeMessage[]
  currentArtifact?: { title: string; content: Record<string, unknown> } | null
  confirmedArtifacts?: Record<string, { title: string; content: Record<string, unknown> }>
  graphSavedData?: GraphSavedData | null
  topK?: number
}

function flattenUnknown(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(flattenUnknown).filter(Boolean).join(' ')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key} ${flattenUnknown(nested)}`)
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

function buildQueryText({
  activityCode,
  messages,
  currentArtifact,
  confirmedArtifacts,
  graphSavedData,
}: Omit<SearchProjectMaterialsParams, 'projectId' | 'topK'>): string {
  const recentMessages = messages.slice(-8).map((message) => message.content).join('\n')
  const artifactText = currentArtifact
    ? `${currentArtifact.title}\n${flattenUnknown(currentArtifact.content)}`
    : ''
  const confirmedText = confirmedArtifacts
    ? Object.entries(confirmedArtifacts)
        .slice(-4)
        .map(([code, artifact]) => `${code} ${artifact.title}\n${flattenUnknown(artifact.content)}`)
        .join('\n\n')
    : ''
  const graphText = graphSavedData
    ? [
        graphSavedData.centerNode?.text ?? '',
        graphSavedData.selectedStandards.map((standard) => standard.text).join('\n'),
        graphSavedData.agentNotes
          .map((note) => `${note.standardId} ${note.teachingNote ?? ''} ${note.explanation ?? ''}`)
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  return [
    `현재 활동: ${activityCode}`,
    recentMessages,
    artifactText,
    confirmedText,
    graphText,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function tokenize(text: string): string[] {
  return [...new Set((text.match(/[가-힣A-Za-z0-9]{2,20}/g) ?? []).map((token) => token.toLowerCase()))]
}

function lexicalScore(queryText: string, chunk: MaterialChunk): number {
  const queryTokens = tokenize(queryText)
  if (queryTokens.length === 0) return 0
  const haystack = `${chunk.text}\n${chunk.keywords.join(' ')}\n${chunk.unitTitle ?? ''}\n${chunk.topicTitle ?? ''}`.toLowerCase()
  const hits = queryTokens.filter((token) => haystack.includes(token)).length
  return hits / queryTokens.length
}

function activityTypeBoost(activityCode: ActivityCode, chunk: MaterialChunk): number {
  if (chunk.chunkType === 'appendix') return -0.04

  if (activityCode === 'A-2-1' || activityCode === 'A-2-2' || activityCode === 'A-2-3') {
    if (chunk.chunkType === 'body') return 0.1
    if (chunk.chunkType === 'front_matter') return 0.03
  }

  if (activityCode === 'Ds-1-3' || activityCode === 'Ds-2-1' || activityCode === 'Ds-2-2') {
    if (chunk.chunkType === 'activity_material') return 0.11
    if (chunk.chunkType === 'body') return 0.05
  }

  if (activityCode.startsWith('T-') && chunk.chunkType === 'front_matter') {
    return 0.04
  }

  return 0
}

function trimForPrompt(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420)
}

export async function searchProjectMaterials(
  params: SearchProjectMaterialsParams
): Promise<MaterialSearchHit[]> {
  if (!serverDb || !embeddingClient || !params.projectId) return []

  const queryText = buildQueryText(params)
  if (!queryText.trim()) return []

  const chunkSnap = await getDocs(collection(serverDb, 'projects', params.projectId, 'materialChunks'))
  const chunks = chunkSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as MaterialChunk)
  if (chunks.length === 0) return []

  const embeddingResp = await embeddingClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: queryText,
  })
  const queryEmbedding = embeddingResp.data[0]?.embedding ?? []

  const ranked = chunks
    .map((chunk) => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding)
      const lexical = lexicalScore(queryText, chunk)
      const score = similarity * 0.76 + lexical * 0.17 + activityTypeBoost(params.activityCode, chunk)

      return {
        materialId: chunk.materialId,
        fileName: chunk.fileName,
        chunkIndex: chunk.chunkIndex,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        chunkType: chunk.chunkType,
        score,
        text: trimForPrompt(chunk.text),
        unitTitle: chunk.unitTitle,
        topicTitle: chunk.topicTitle,
      } satisfies MaterialSearchHit
    })
    .sort((a, b) => b.score - a.score)

  const uniqueHits: MaterialSearchHit[] = []
  const seenRanges = new Set<string>()
  for (const hit of ranked) {
    const rangeKey = `${hit.materialId}:${hit.pageStart}-${hit.pageEnd}`
    if (seenRanges.has(rangeKey)) continue
    seenRanges.add(rangeKey)
    uniqueHits.push(hit)
    if (uniqueHits.length >= (params.topK ?? 4)) break
  }

  return uniqueHits
}

export function buildProjectMaterialContext(hits: MaterialSearchHit[]): string {
  if (hits.length === 0) return ''

  const lines = [
    '',
    '## 프로젝트 PDF 근거 자료',
    '아래 자료는 팀이 업로드한 프로젝트 자료에서 검색된 근거입니다.',
    '이 자료를 현재 활동의 참고 근거로 활용하되, 팀의 합의와 학습자 맥락보다 우선시하지 마세요.',
    '자료를 활용한 경우 가능한 한 페이지를 언급하세요.',
    '',
  ]

  hits.forEach((hit, index) => {
    const pageLabel = hit.pageStart === hit.pageEnd ? `p.${hit.pageStart}` : `p.${hit.pageStart}-${hit.pageEnd}`
    const heading = [hit.unitTitle, hit.topicTitle].filter(Boolean).join(' · ')
    lines.push(`[자료 ${index + 1}] ${hit.fileName} ${pageLabel}`)
    if (heading) lines.push(`소주제: ${heading}`)
    lines.push(hit.text)
    lines.push('')
  })

  return lines.join('\n')
}

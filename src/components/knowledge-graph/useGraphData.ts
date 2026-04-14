import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType, toUnitGraphScore } from '@/lib/knowledge-graph/domain'
import type { GraphRelationType, GraphSavedData } from '@/lib/knowledge-graph/domain'
import type { GNode, GEdge, GraphRelationAnalysis } from './types'
import { normCode } from './constants'

// ─── Hook ─────────────────────────────────────────────────────────────────

interface UseGraphDataOptions {
  keyword: string
  gradeGroup?: string
  algoMode: 'keyword' | 'semantic' | 'hybrid'
  svgWidth: number
  svgHeight: number
  nodesRef: React.MutableRefObject<GNode[]>
  edgesRef: React.MutableRefObject<GEdge[]>
  chatMentionedCodes: Array<{ code: string; addedBy: string }>
  savedData?: GraphSavedData | null
  applyCheckedStandards: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  artifactContext?: string
}

interface PendingData {
  edges: GEdge[]
  connections: Array<{
    standardId: string
    relationType?: GraphRelationType
    relationScore?: number
    explanation?: string
    teachingNote?: string
  }>
  centerStdId: string | null
}

export function useGraphData({
  keyword,
  gradeGroup,
  algoMode,
  svgWidth,
  svgHeight,
  nodesRef,
  edgesRef,
  chatMentionedCodes,
  savedData,
  applyCheckedStandards,
  artifactContext,
}: UseGraphDataOptions) {
  const [rawNodes, setRawNodes] = useState<GNode[]>([])
  const [rawEdges, setRawEdges] = useState<GEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [claudeRelations, setClaudeRelations] = useState<Map<string, GraphRelationAnalysis>>(new Map())
  const [claudeLoading, setClaudeLoading] = useState(false)
  const [popupAnalysisLoading, setPopupAnalysisLoading] = useState(false)

  const [onboardingVisible, setOnboardingVisible] = useState(false)

  // 중복 방지 refs
  const claudeAnalyzedCenters = useRef<Set<string>>(new Set())
  const fetchedPopupKeys = useRef<Set<string>>(new Set())
  const fetchedAIMentionedCodesRef = useRef<Set<string>>(new Set())
  const pendingRef = useRef<PendingData>({ edges: [], connections: [], centerStdId: null })
  const lastAnalyzedNodeCountRef = useRef(0)

  // ── 메인 데이터 페치 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!keyword.trim()) return
    let cancelled = false

    setLoading(true)
    setClaudeLoading(true)
    setError(null)
    setClaudeRelations(new Map())
    fetchedPopupKeys.current.clear()
    claudeAnalyzedCenters.current.clear()
    fetchedAIMentionedCodesRef.current.clear()
    pendingRef.current = { edges: [], connections: [], centerStdId: null }

    async function loadGraphData() {
      try {
        let graphNodes: Array<{
          id: string
          type: 'standard' | 'subject' | 'core_idea'
          label: string
          text?: string
          subject_id?: string
          grade_band?: string
          area?: string
          keywords?: string[]
          competencies?: string[]
          group: string
          similarityScore?: number
          isCenter?: boolean
        }> = []
        let graphEdges: GEdge[] = []
        let centerStdId: string | null = null
        let pendingConnections: PendingData['connections'] = []

        if (algoMode === 'semantic') {
          const response = await fetch('/api/ontology/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: keyword, gradeGroup }),
          })
          const data = await response.json()
          if (data.error) throw new Error(data.error)

          graphNodes = data.graphNodes ?? []
          graphEdges = ((data.graphEdges ?? []) as GEdge[]).map((edge) => ({
            ...edge,
            relation: normalizeGraphRelationType(edge.relation) ?? DEFAULT_GRAPH_RELATION_TYPE,
          }))
          const stdNodes = graphNodes.filter((node) => node.type === 'standard')
          centerStdId = (data.center as { standard?: { id?: string } } | undefined)?.standard?.id
            ?? stdNodes[0]?.id
            ?? null
          const connections = (data.connections as Array<{
            standard: { id: string }
            relationType?: string
            relationScore?: number
            explanation?: string
            teachingNote?: string
          }> | undefined) ?? []
          pendingConnections = connections.map((conn) => ({
            standardId: conn.standard.id,
            relationType: normalizeGraphRelationType(conn.relationType),
            relationScore: conn.relationScore,
            explanation: conn.explanation,
            teachingNote: conn.teachingNote,
          }))
        } else {
          const params = new URLSearchParams({ keyword, topK: '30', algorithm: algoMode })
          if (gradeGroup) params.set('gradeGroup', gradeGroup)

          const response = await fetch(`/api/knowledge-graph?${params}`)
          const data = await response.json()
          if (data.error) throw new Error(data.error)

          graphNodes = data.nodes ?? []
          graphEdges = ((data.edges ?? []) as GEdge[]).map((edge) => ({
            ...edge,
            relation: normalizeGraphRelationType(edge.relation) ?? DEFAULT_GRAPH_RELATION_TYPE,
          }))
          const stdNodes = graphNodes.filter((node) => node.type === 'standard')
          centerStdId = [...stdNodes]
            .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))[0]?.id
            ?? null
        }

        if (cancelled) return

        const stdNodes = graphNodes.filter((node) => node.type === 'standard')
        const cx = svgWidth / 2
        const cy = svgHeight / 2
        const ringR = Math.max(260, Math.min(svgWidth, svgHeight) * 0.42)

        let stdPosIdx = 0
        const nodes: GNode[] = graphNodes.map((node) => {
          if (node.type !== 'standard') return { ...node, x: cx, y: cy, vx: 0, vy: 0 }
          const posIdx = stdPosIdx++
          const angle = (2 * Math.PI * posIdx) / Math.max(stdNodes.length, 1) - Math.PI / 2
          return {
            ...node,
            x: cx + ringR * Math.cos(angle),
            y: cy + ringR * Math.sin(angle),
            vx: 0,
            vy: 0,
          }
        })

        nodesRef.current = nodes
        edgesRef.current = []
        setRawNodes(nodes)
        setRawEdges([])

        pendingRef.current = { edges: graphEdges, connections: pendingConnections, centerStdId }
        // chatMentionedCodes가 있으면 온보딩 건너뜀 (AI 추천 코드로 바로 시작)
        if (chatMentionedCodes.length === 0) setOnboardingVisible(true)
        setLoading(false)
        setClaudeLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
        setClaudeLoading(false)
      }
    }

    void loadGraphData()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, gradeGroup, algoMode])

  // ── AI 언급 성취기준: rawNodes에 있는 것 즉시 토글 ON ──────────────────────
  // rawNodes가 채워질 때마다 (메인 fetch 완료 등) 재실행
  useEffect(() => {
    if (chatMentionedCodes.length === 0 || rawNodes.length === 0) return
    const chatCodes = new Set(chatMentionedCodes.map(c => normCode(c.code)))
    const matchIds = rawNodes
      .filter(n => n.type === 'standard' && chatCodes.has(normCode(n.label)))
      .map(n => n.id)
    if (matchIds.length === 0) return
    applyCheckedStandards(prev => {
      const next = new Set(prev)
      for (const id of matchIds) next.add(id)
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMentionedCodes, rawNodes.length])

  // ── AI 언급 성취기준: rawNodes에 없는 코드 → API로 가져오기 ──────────────
  // DB에 없는 코드는 폴백 노드를 직접 생성 (AI 환각 대응)
  useEffect(() => {
    if (chatMentionedCodes.length === 0) return
    const loadedCodeSet = new Set(nodesRef.current.map(n => normCode(n.label)))
    const missingCodes = chatMentionedCodes
      .map(c => normCode(c.code))
      .filter(code => !loadedCodeSet.has(code) && !fetchedAIMentionedCodesRef.current.has(code))

    if (missingCodes.length === 0) return
    for (const code of missingCodes) fetchedAIMentionedCodesRef.current.add(code)

    const cx = svgWidth / 2
    const cy = svgHeight / 2
    const ringR = Math.max(140, Math.min(svgWidth, svgHeight) * 0.25)

    // 교과 코드 → subject_id 매핑
    const SUBJ_MAP: Record<string, string> = {
      '국': 'sub_kor', '수': 'sub_math', '과': 'sub_sci', '사': 'sub_soc',
      '도': 'sub_mor', '미': 'sub_art', '음': 'sub_mus', '체': 'sub_pe',
      '영': 'sub_eng', '실': 'sub_prac', '통': 'sub_int',
    }

    fetch(`/api/knowledge-graph?codes=${missingCodes.join(',')}`)
      .then(r => r.json())
      .then(data => {
        const apiNodes: GNode[] = (data.nodes ?? []) as GNode[]
        const returnedCodes = new Set(apiNodes.map(n => normCode(n.label)))
        const existingIds = new Set(nodesRef.current.map(n => n.id))

        // API에서 반환된 노드
        const newFromApi = apiNodes
          .filter(n => !existingIds.has(n.id))
          .map((n, i) => ({
            ...n,
            x: cx + ringR * Math.cos((2 * Math.PI * i) / Math.max(missingCodes.length, 1) - Math.PI / 2 + Math.PI),
            y: cy + ringR * Math.sin((2 * Math.PI * i) / Math.max(missingCodes.length, 1) - Math.PI / 2 + Math.PI),
            vx: 0, vy: 0,
          }))

        // DB에 없는 코드 → 폴백 노드 생성 (채팅 내용 기반)
        const stillMissing = missingCodes.filter(code => !returnedCodes.has(code))
        const fallbackNodes: GNode[] = stillMissing.map((code, i) => {
          const subjChar = code.match(/\d([가-힣])/)?.[1] ?? ''
          const subjectId = SUBJ_MAP[subjChar] ?? 'default'
          const offset = newFromApi.length + i
          return {
            id: `chat_${code}`,
            type: 'standard' as const,
            label: `[${code}]`,
            text: `채팅에서 AI가 추천한 성취기준 (DB 미등록)`,
            subject_id: subjectId,
            group: subjectId,
            keywords: [],
            x: cx + ringR * Math.cos((2 * Math.PI * offset) / Math.max(missingCodes.length, 1) - Math.PI / 2 + Math.PI),
            y: cy + ringR * Math.sin((2 * Math.PI * offset) / Math.max(missingCodes.length, 1) - Math.PI / 2 + Math.PI),
            vx: 0, vy: 0,
          }
        })

        const allNew = [...newFromApi, ...fallbackNodes]
        if (allNew.length === 0) return
        nodesRef.current = [...nodesRef.current, ...allNew]
        setRawNodes(prev => [...prev, ...allNew])
        applyCheckedStandards(prev => {
          const next = new Set(prev)
          for (const n of allNew) next.add(n.id)
          return next
        })
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMentionedCodes, rawNodes.length])

  // ── Claude 관계 분석 (중심 노드 변경 시) ──────────────────────────────
  const runClaudeAnalysis = useCallback((centerNodeId: string) => {
    if (!keyword.trim()) return
    if (claudeAnalyzedCenters.current.has(centerNodeId)) return

    const connectedIds = nodesRef.current
      .filter(n => n.type === 'standard' && n.id !== centerNodeId)
      .map(n => n.id)
      .slice(0, 8)

    if (connectedIds.length === 0) return

    claudeAnalyzedCenters.current.add(centerNodeId)
    setClaudeLoading(true)
    fetch('/api/ontology/relate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: keyword, gradeGroup, centerId: centerNodeId, candidateIds: connectedIds }),
    })
      .then(r => r.json())
      .then((data: { relations?: Array<{ sourceId: string; targetId: string; relationType: GraphRelationType; score: number; explanation: string; teachingNote?: string; source: 'claude' | 'rule' }> }) => {
        if (!data.relations) return
        const next = new Map<string, GraphRelationAnalysis>()
        for (const r of data.relations) {
          const key = [r.sourceId, r.targetId].sort().join('||')
          next.set(key, {
            relationType: normalizeGraphRelationType(r.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE,
            score: r.score,
            explanation: r.explanation,
            teachingNote: r.teachingNote,
            source: r.source,
          })
        }
        setClaudeRelations(next)
      })
      .catch(console.error)
      .finally(() => setClaudeLoading(false))
  }, [keyword, gradeGroup, nodesRef])

  // ── 수동 분석 실행 (확인 배너/재분석 버튼) ──────────────────────────────
  const runAnalysis = useCallback((centerNodeId: string) => {
    if (!centerNodeId) return

    const allCandidates = nodesRef.current
      .filter(n => n.type === 'standard' && n.id !== centerNodeId)
      .map(n => n.id)
    if (allCandidates.length === 0) return

    fetchedPopupKeys.current.clear()
    for (const id of allCandidates) {
      fetchedPopupKeys.current.add([centerNodeId, id].sort().join('||'))
    }
    lastAnalyzedNodeCountRef.current = allCandidates.length

    const CHUNK = 8
    const chunks: string[][] = []
    for (let i = 0; i < allCandidates.length; i += CHUNK) {
      chunks.push(allCandidates.slice(i, i + CHUNK))
    }
    setClaudeLoading(true)
    setClaudeRelations(new Map())
    const theme = keyword.trim() || '융합 수업'
    Promise.all(
      chunks.map(chunk =>
        fetch('/api/ontology/relate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme, gradeGroup, centerId: centerNodeId, candidateIds: chunk, artifactContext }),
        })
          .then(r => r.json())
          .then(data => {
            if (!data.relations) return
            setClaudeRelations(prev => {
              const next = new Map(prev)
              for (const rel of data.relations as Array<{ standardId: string; relationType: GraphRelationType; score: number; explanation: string; teachingNote?: string }>) {
                const key = [centerNodeId, rel.standardId].sort().join('||')
                next.set(key, {
                  relationType: normalizeGraphRelationType(rel.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE,
                  score: rel.score,
                  explanation: rel.explanation,
                  teachingNote: rel.teachingNote,
                  source: 'claude' as const,
                })
              }
              return next
            })
          })
          .catch(() => {})
      )
    ).finally(() => setClaudeLoading(false))
  }, [keyword, gradeGroup, nodesRef, artifactContext])

  // ── 팝업 단건 분석 ────────────────────────────────────────────────────
  const analyzePopupNode = useCallback((popupId: string, centerNodeId: string) => {
    if (!keyword.trim()) return
    const claudeKey = [centerNodeId, popupId].sort().join('||')
    if (claudeRelations.get(claudeKey)?.explanation) return
    fetchedPopupKeys.current.add(claudeKey)
    setPopupAnalysisLoading(true)
    fetch('/api/ontology/relate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: keyword, gradeGroup, centerId: centerNodeId, candidateIds: [popupId] }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.relations) return
        setClaudeRelations(prev => {
          const next = new Map(prev)
          for (const rel of data.relations as Array<{ standardId: string; relationType: GraphRelationType; score: number; explanation: string; teachingNote?: string }>) {
            const key = [centerNodeId, rel.standardId].sort().join('||')
            next.set(key, {
              relationType: normalizeGraphRelationType(rel.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE,
              score: rel.score,
              explanation: rel.explanation,
              teachingNote: rel.teachingNote,
              source: 'claude' as const,
            })
          }
          return next
        })
      })
      .catch(() => {})
      .finally(() => setPopupAnalysisLoading(false))
  }, [keyword, gradeGroup, claudeRelations])

  // ── 저장 데이터 복원 ──────────────────────────────────────────────────
  const restoreFromSavedData = useCallback((centerNodeId: string) => {
    if (!savedData || claudeRelations.size > 0) return
    const relTypeMap = new Map(
      savedData.selectedStandards.map((standard) => [
        standard.id,
        {
          relationType: normalizeGraphRelationType(standard.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE,
          score: toUnitGraphScore(standard.score) ?? 0.7,
        },
      ])
    )
    const noteMap = new Map(
      savedData.agentNotes.map((note) => [note.standardId, note])
    )
    const restoredMap = new Map<string, GraphRelationAnalysis>()
    // 모든 selectedStandards에 대해 관계 엔트리 생성 (agentNotes 없어도)
    for (const [stdId, meta] of relTypeMap) {
      if (stdId === centerNodeId) continue
      const key = [centerNodeId, stdId].sort().join('||')
      const note = noteMap.get(stdId)
      restoredMap.set(key, {
        relationType: meta.relationType,
        score: meta.score,
        explanation: note?.explanation ?? '',
        teachingNote: note?.teachingNote,
        source: 'claude',
      })
    }
    if (restoredMap.size > 0) setClaudeRelations(restoredMap)
  }, [savedData, claudeRelations.size])

  return {
    rawNodes,
    setRawNodes,
    rawEdges,
    setRawEdges,
    loading,
    error,
    claudeRelations,
    setClaudeRelations,
    claudeLoading,
    setClaudeLoading,
    popupAnalysisLoading,
    onboardingVisible,
    setOnboardingVisible,
    pendingRef,
    claudeAnalyzedCenters,
    fetchedPopupKeys,
    lastAnalyzedNodeCountRef,
    runClaudeAnalysis,
    runAnalysis,
    analyzePopupNode,
    restoreFromSavedData,
  }
}

'use client'

/**
 * 융합 교육과정 지식 그래프 뷰어
 * ─────────────────────────────
 * 좌측: 교과 필터 + 성취기준 검색 + 체크박스 목록
 * 우측: SVG 포스 레이아웃
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType, toStoredGraphScore } from '@/lib/knowledge-graph/domain'
import type { GraphRelationFilter, GraphSelectedStandard } from '@/lib/knowledge-graph/domain'

import type { GNode, GEdge, KnowledgeGraphViewerProps, RecommendedStandard } from './types'
import {
  normCode, classifyRelation, normalizedEdgeWeight,
} from './constants'
import { useForceSimulation } from './useForceSimulation'
import { useGraphData } from './useGraphData'

import LeftPanel from './LeftPanel'
import GraphCanvas from './GraphCanvas'
import StandardsBrowser from './StandardsBrowser'
import NodePopup from './NodePopup'
import ContextMenu from './ContextMenu'
import Tooltip from './Tooltip'
import { GraphToolbar } from './GraphToolbar'
import { MD3Button } from '@/components/ui/MD3Button'
import SaveButtons from './SaveButtons'

// ─── CSS 주입 (무지개 애니메이션) ─────────────────────────────────────────
function useRainbowCSS() {
  useEffect(() => {
    const id = 'kg-rainbow-anim'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      @keyframes kg-spotlight-pulse {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        50%       { opacity: 1;   transform: scale(1.04); }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(id)?.remove() }
  }, [])
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────

export default function KnowledgeGraphViewer({
  keyword,
  gradeGroup,
  onSelectStandard,
  height,
  currentUserName,
  isLeader = false,
  chatMentionedCodes = [],
  pinnedStandards = [],
  onPinChange,
  externalCheckedStandardIds,
  onCheckedStandardsChange,
  onClose,
  externalRecommendations,
  onRecommendCenter,
  externalCenterNodeId,
  preferredCenterCode,
  onSetCenter,
  onSaveGraph,
  savedData,
  artifactContext,
  curriculumSheet,
}: KnowledgeGraphViewerProps) {
  useRainbowCSS()

  // ── Refs ─────────────────────────────────────────────────────────────
  const nodesRef = useRef<GNode[]>([])
  const edgesRef = useRef<GEdge[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const graphAreaRef = useRef<HTMLDivElement>(null)

  // ── SVG 크기 ─────────────────────────────────────────────────────────
  const [svgWidth, setSvgWidth] = useState(700)
  const [svgHeight, setSvgHeight] = useState(540)

  useLayoutEffect(() => {
    const el = graphAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setSvgWidth(entries[0].contentRect.width)
      setSvgHeight(entries[0].contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── 체크 상태 ────────────────────────────────────────────────────────
  const [checkedStandards, setCheckedStandards] = useState<Set<string>>(new Set())
  const isLocalUpdateRef = useRef(false)

  const applyCheckedStandards = useCallback((
    updater: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => {
    setCheckedStandards(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      // 부모 알림을 다음 마이크로태스크로 지연 (렌더 중 setState 방지)
      isLocalUpdateRef.current = true
      queueMicrotask(() => {
        onCheckedStandardsChange?.([...next])
        // 에코 방지 타이머 (복원 시 중심 설정까지 ~200ms 소요)
        setTimeout(() => { isLocalUpdateRef.current = false }, 500)
      })
      return next
    })
  }, [onCheckedStandardsChange])

  useEffect(() => {
    if (!externalCheckedStandardIds) return
    // 로컬 업데이트의 에코인 경우 무시 (부모 → 자식 되돌아오기 방지)
    if (isLocalUpdateRef.current) return
    setCheckedStandards(new Set(externalCheckedStandardIds))
  }, [externalCheckedStandardIds])

  // ── 알고리즘/필터 ────────────────────────────────────────────────────
  const [algoMode, setAlgoMode] = useState<'keyword' | 'semantic' | 'hybrid'>('hybrid')
  const [relFilter, setRelFilter] = useState<GraphRelationFilter>('all')

  // ── 데이터 훅 ────────────────────────────────────────────────────────
  const graphData = useGraphData({
    keyword, gradeGroup, algoMode, svgWidth, svgHeight,
    nodesRef, edgesRef, chatMentionedCodes, savedData, applyCheckedStandards, artifactContext,
  })
  const {
    rawNodes, setRawNodes, rawEdges, setRawEdges,
    loading, error, claudeRelations, setClaudeRelations, claudeLoading,
    popupAnalysisLoading, onboardingVisible, setOnboardingVisible,
    pendingRef, claudeAnalyzedCenters, lastAnalyzedNodeCountRef,
    runClaudeAnalysis, runAnalysis, analyzePopupNode, restoreFromSavedData,
  } = graphData

  // ── UI 상태 ──────────────────────────────────────────────────────────
  const [popup, setPopup] = useState<GNode | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [centerNodeId, setCenterNodeId] = useState<string | null>(null)
  const [manualEdges, setManualEdges] = useState<GEdge[]>([])
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [recommendedCenterIds, setRecommendedCenterIds] = useState<Map<string, string>>(new Map())
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [nodesChangedAfterAnalysis, setNodesChangedAfterAnalysis] = useState(false)
  const [showAnalysisBanner, setShowAnalysisBanner] = useState(false)
  const [showStandardsBrowser, setShowStandardsBrowser] = useState(false)
  const [layoutKey, setLayoutKey] = useState(0)

  const prevCenterNodeIdRef = useRef<string | null>(null)

  // ── Force 시뮬레이션 훅 ──────────────────────────────────────────────
  const { resume: resumeSimulation } = useForceSimulation({
    nodesRef, edgesRef, svgWidth, svgHeight,
    rawNodesLength: rawNodes.length, layoutKey,
  })

  // ── 키워드 변경 시 상태 리셋 ────────────────────────────────────────
  useEffect(() => {
    setPopup(null)
    setCenterNodeId(null)
    setManualEdges([])
    setContextMenu(null)
    setRecommendedCenterIds(new Map())
    setSelectedCardId(null)
    setNodesChangedAfterAnalysis(false)
    setShowAnalysisBanner(false)
    prevCenterNodeIdRef.current = null
    savedDataRestoredRef.current = false
  }, [keyword, gradeGroup, algoMode])

  // ── 중심 노드 설정 시 분석 확인 배너 표시 ─────────────────────────────
  useEffect(() => {
    if (!centerNodeId || centerNodeId === prevCenterNodeIdRef.current) return
    prevCenterNodeIdRef.current = centerNodeId
    if (claudeRelations.size > 0) return
    setNodesChangedAfterAnalysis(false)
    setShowAnalysisBanner(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerNodeId])

  // ── 팝업 열릴 때 단건 분석 (팀장만 — 팀원은 저장된 분석만 열람) ──────
  useEffect(() => {
    if (!isLeader) return
    if (!popup || !centerNodeId) return
    if (popup.id === centerNodeId) return
    analyzePopupNode(popup.id, centerNodeId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup?.id, centerNodeId, isLeader])

  // ── 저장 데이터 복원: 노드 로드 + 관계 복원 ──────────────────────────────
  // savedData가 있고 chatMentionedCodes가 비어있으면 (헤더 버튼으로 열었을 때) 저장된 노드를 로드
  const savedDataRestoredRef = useRef(false)
  useEffect(() => {
    if (!savedData || savedDataRestoredRef.current) return
    if (chatMentionedCodes.length > 0) return  // 반영하기 버튼으로 열었을 때는 새 코드 우선
    if (rawNodes.length > 0) return  // 이미 노드가 있으면 건너뜀

    savedDataRestoredRef.current = true
    // savedData에서 성취기준 코드 추출 → API로 노드 로드
    const codes = savedData.selectedStandards.map(s => s.label.replace(/[\[\]]/g, '').trim()).filter(Boolean)
    if (savedData.centerNode) {
      codes.unshift(savedData.centerNode.label.replace(/[\[\]]/g, '').trim())
    }
    if (codes.length === 0) return

    fetch(`/api/knowledge-graph?codes=${codes.join(',')}`)
      .then(r => r.json())
      .then(data => {
        if (!data.nodes || data.nodes.length === 0) return
        const cx = svgWidth / 2
        const cy = svgHeight / 2
        const ringR = Math.max(140, Math.min(svgWidth, svgHeight) * 0.25)
        const newNodes: GNode[] = (data.nodes as GNode[]).map((n, i) => ({
          ...n,
          x: cx + ringR * Math.cos((2 * Math.PI * i) / Math.max(data.nodes.length, 1) - Math.PI / 2),
          y: cy + ringR * Math.sin((2 * Math.PI * i) / Math.max(data.nodes.length, 1) - Math.PI / 2),
          vx: 0, vy: 0,
        }))
        nodesRef.current = newNodes
        edgesRef.current = []
        setRawNodes(newNodes)
        // 모든 노드 토글 ON — applyCheckedStandards로 부모에도 동기화
        const allIds = new Set(newNodes.map(n => n.id))
        applyCheckedStandards(allIds)
        // 중심 노드 직접 설정 (applyCenterNode 대신 — 관계 리셋 방지)
        if (savedData.centerNode) {
          const normLabel = savedData.centerNode.label.replace(/[\[\]]/g, '')
          const cNode = newNodes.find(n => n.label.includes(normLabel))
          if (cNode) {
            setTimeout(() => {
              setCenterNodeId(cNode.id)
              const cx2 = svgWidth / 2
              const cy2 = svgHeight / 2
              cNode.fx = cx2; cNode.fy = cy2; cNode.x = cx2; cNode.y = cy2
              if (isLeader && onSetCenter) onSetCenter(cNode.id)
              // 중심 설정 후 토글이 리셋될 수 있으므로 한번 더 보장
              setTimeout(() => applyCheckedStandards(allIds), 50)
            }, 100)
          }
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedData, chatMentionedCodes.length, rawNodes.length])

  // 중심 노드 설정 후 claudeRelations 복원
  useEffect(() => {
    if (!savedData || !centerNodeId || rawNodes.length === 0) return
    restoreFromSavedData(centerNodeId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerNodeId, rawNodes.length])

  // ── 노드 수 변화 감지 → 재분석 버튼 ─────────────────────────────────
  useEffect(() => {
    if (!centerNodeId || claudeLoading || lastAnalyzedNodeCountRef.current === 0) return
    const currentCount = nodesRef.current.filter(n => n.type === 'standard' && n.id !== centerNodeId).length
    if (currentCount !== lastAnalyzedNodeCountRef.current) setNodesChangedAfterAnalysis(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedStandards, rawNodes.length, centerNodeId, claudeLoading])

  // ── 외부 추천 → 내부 동기화 ──────────────────────────────────────────
  useEffect(() => {
    if (!externalRecommendations) return
    if (centerNodeId) return
    setRecommendedCenterIds(new Map(externalRecommendations.map(r => [r.nodeId, r.recommenderName])))
  }, [externalRecommendations, centerNodeId])

  // ── 중심 노드 적용 ──────────────────────────────────────────────────
  const applyCenterNode = useCallback((nodeId: string) => {
    if (centerNodeId) {
      const prev = nodesRef.current.find(nd => nd.id === centerNodeId)
      if (prev) { prev.fx = undefined; prev.fy = undefined }
    }
    setCenterNodeId(nodeId)
    setManualEdges([])

    const pending = pendingRef.current
    const canApplyPending = pending.centerStdId === nodeId || !pending.centerStdId

    if (canApplyPending && pending.edges.length > 0) {
      edgesRef.current = pending.edges
      setRawEdges(pending.edges)
    } else {
      setRawEdges([])
      edgesRef.current = []
    }

    if (canApplyPending && pending.connections.length > 0) {
      const next = new Map<string, import('./types').GraphRelationAnalysis>()
      for (const conn of pending.connections) {
        const key = [nodeId, conn.standardId].sort().join('||')
        next.set(key, {
          relationType: normalizeGraphRelationType(conn.relationType) ?? DEFAULT_GRAPH_RELATION_TYPE,
          score: conn.relationScore ?? 0.5,
          explanation: conn.explanation ?? '',
          ideas: conn.ideas,
          teachingNote: conn.teachingNote,
          source: 'claude',
        })
      }
      setClaudeRelations(next)
      claudeAnalyzedCenters.current.add(nodeId)
    } else {
      setClaudeRelations(new Map())
    }

    setRecommendedCenterIds(new Map())
    if (isLeader && onSetCenter) onSetCenter(nodeId)
  }, [centerNodeId, isLeader, onSetCenter, pendingRef, setRawEdges, setClaudeRelations, claudeAnalyzedCenters])

  // 분석시트에서 지정한 중심 교과의 첫 성취기준을 그래프 중심 노드로 자동 적용
  const preferredCenterCodeNorm = useMemo(() => preferredCenterCode ? normCode(preferredCenterCode) : '', [preferredCenterCode])
  useEffect(() => {
    if (!preferredCenterCodeNorm || centerNodeId || rawNodes.length === 0) return
    const node = nodesRef.current.find(n => n.type === 'standard' && normCode(n.label) === preferredCenterCodeNorm)
    if (!node) return
    applyCenterNode(node.id)
  }, [preferredCenterCodeNorm, centerNodeId, rawNodes.length, applyCenterNode])

  // ── Firestore 중심 노드 동기화 ──────────────────────────────────────
  useEffect(() => {
    if (!externalCenterNodeId) return
    if (externalCenterNodeId === centerNodeId) return
    if (isLeader && centerNodeId) return
    if (rawNodes.length === 0) return
    const node = nodesRef.current.find(n => n.id === externalCenterNodeId)
    if (!node) return
    applyCenterNode(externalCenterNodeId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalCenterNodeId, centerNodeId, rawNodes.length])

  // ── Claude 분석 (중심 변경 시 자동) ──────────────────────────────────
  useEffect(() => {
    if (!centerNodeId) return
    runClaudeAnalysis(centerNodeId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerNodeId])

  // ── 중심 노드 변경 시 레이아웃 ─────────────────────────────────────
  useEffect(() => {
    if (!centerNodeId) { setManualEdges([]); return }
    const center = nodesRef.current.find(n => n.id === centerNodeId)
    if (!center) return
    const cx = svgWidth / 2
    const cy = svgHeight / 2
    const ringR = Math.max(260, Math.min(svgWidth, svgHeight) * 0.42)

    nodesRef.current.forEach(n => { if (n.id !== centerNodeId) { n.fx = undefined; n.fy = undefined } })
    center.fx = cx; center.fy = cy; center.x = cx; center.y = cy

    const others = nodesRef.current.filter(n => n.type === 'standard' && n.id !== centerNodeId)
    others.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(others.length, 1) - Math.PI / 2
      n.x = cx + ringR * Math.cos(angle)
      n.y = cy + ringR * Math.sin(angle)
      n.vx = 0; n.vy = 0
    })
    setLayoutKey(k => k + 1)
  }, [centerNodeId, svgWidth, svgHeight])

  // ── Claude 결과 반영: 클러스터 + 엣지 재생성 ──────────────────────────
  useEffect(() => {
    if (!centerNodeId) return
    const center = nodesRef.current.find(n => n.id === centerNodeId)
    if (!center) return

    const cx = svgWidth / 2
    const cy = svgHeight / 2
    const others = nodesRef.current.filter(n => n.type === 'standard' && n.id !== centerNodeId)

    if (claudeRelations.size > 0) {
      const SECTOR_ANGLES: Record<string, number> = {
        '내용-표현': -Math.PI / 2 + Math.PI * 0.1,
        '도구-활용': Math.PI / 2 - Math.PI * 0.1,
        '현상-가치': Math.PI * 0.1,
        '의미연결': -Math.PI * 0.8,
        '문제-해결': Math.PI * 0.5,
        '탐구-실천': -Math.PI * 0.4,
        '개념-적용': Math.PI * 0.3,
        '원인-결과': -Math.PI * 0.6,
      }
      const SECTOR_SPREAD = 0.55
      const minRingR = Math.max(180, Math.min(svgWidth, svgHeight) * 0.24)
      const maxRingDelta = Math.max(90, Math.min(svgWidth, svgHeight) * 0.14)

      const groups: Record<string, typeof others> = {}
      for (const other of others) {
        const ck = [centerNodeId, other.id].sort().join('||')
        const cr = claudeRelations.get(ck)
        const rel = cr?.relationType ?? classifyRelation(center, other)
        if (!groups[rel]) groups[rel] = []
        groups[rel].push(other)
      }

      for (const [rel, nodes] of Object.entries(groups)) {
        const baseAngle = SECTOR_ANGLES[rel] ?? 0
        const sortedNodes = [...nodes].sort((a, b) => {
          const aScore = claudeRelations.get([centerNodeId, a.id].sort().join('||'))?.score ?? 0
          const bScore = claudeRelations.get([centerNodeId, b.id].sort().join('||'))?.score ?? 0
          return bScore - aScore || a.label.localeCompare(b.label, 'ko')
        })
        const n = sortedNodes.length
        sortedNodes.forEach((node, i) => {
          const relationScore = normalizedEdgeWeight(claudeRelations.get([centerNodeId, node.id].sort().join('||'))?.score)
          const offset = n === 1 ? 0 : SECTOR_SPREAD * (i / (n - 1) - 0.5)
          const angle = baseAngle + offset
          const r = minRingR + (1 - relationScore) * maxRingDelta + (n > 2 ? (i % 2) * 30 : 0)
          node.x = cx + r * Math.cos(angle)
          node.y = cy + r * Math.sin(angle)
          node.vx = 0; node.vy = 0
        })
      }
    }

    const edges: GEdge[] = others.map(other => {
      const ck = [centerNodeId, other.id].sort().join('||')
      const cr = claudeRelations.get(ck)
      return {
        id: `manual_${centerNodeId}_${other.id}`,
        source: centerNodeId,
        target: other.id,
        relation: cr?.relationType ?? classifyRelation(center, other),
        weight: cr?.score ?? 0,
        method: 'manual',
      }
    })
    edgesRef.current = edges
    setManualEdges(edges)
    setLayoutKey(k => k + 1)
  }, [centerNodeId, claudeRelations, svgWidth, svgHeight])

  // ── Derived: visibleIds ──────────────────────────────────────────────
  const visibleIds = useMemo(() => {
    const chatCodeSet = new Set(chatMentionedCodes.map(c => normCode(c.code)))
    const ids = new Set<string>()

    for (const n of rawNodes) {
      if (n.type !== 'standard') continue
      if (chatCodeSet.has(normCode(n.label)) || pinnedStandards.some(p => p.stdId === n.id)) ids.add(n.id)
    }
    if (centerNodeId) ids.add(centerNodeId)

    for (const [key, rel] of claudeRelations.entries()) {
      if (rel.score >= 0.5) {
        const [a, b] = key.split('||')
        if (ids.has(a) || a === centerNodeId) ids.add(b)
        if (ids.has(b) || b === centerNodeId) ids.add(a)
      }
    }

    // 명시적으로 체크된 노드는 항상 표시 (저장 복원 및 토글 활성화 지원)
    for (const id of checkedStandards) {
      ids.add(id)
    }

    for (const n of rawNodes) {
      if (n.type !== 'standard') continue
      if (n.id === centerNodeId) continue
      if (ids.has(n.id) && !checkedStandards.has(n.id)) ids.delete(n.id)
    }
    return ids
  }, [rawNodes, pinnedStandards, chatMentionedCodes, centerNodeId, claudeRelations, checkedStandards])

  const visibleNodes = useMemo(
    () => nodesRef.current.filter(n => n.type === 'standard' && visibleIds.has(n.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleIds, rawNodes]
  )

  const visibleEdges = useMemo(() => {
    if (!centerNodeId) return []
    const hasManual = manualEdges.length > 0
    const baseEdges = hasManual
      ? manualEdges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
      : rawEdges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
    if (relFilter === 'all') return baseEdges
    return baseEdges.filter(e => (e.relation || '') === relFilter)
  }, [centerNodeId, rawEdges, manualEdges, visibleIds, relFilter])

  // ── 추천 목록 ────────────────────────────────────────────────────────
  const recommendedStandards: RecommendedStandard[] = useMemo(() => {
    const chatCodeSet = new Set(chatMentionedCodes.map(c => normCode(c.code)))
    const centerNode = centerNodeId ? rawNodes.find(n => n.id === centerNodeId) : null

    return rawNodes
      .filter(n => n.type === 'standard')
      .map(n => {
        const isAIMentioned = chatCodeSet.has(normCode(n.label))
        const isPinned = pinnedStandards.some(p => p.stdId === n.id)
        const isCenter = n.id === centerNodeId
        const claudeKey = [centerNodeId ?? '', n.id].sort().join('||')
        const claudeRel = claudeRelations.get(claudeKey)
        const baseScore = n.similarityScore ?? 0
        const claudeScore = claudeRel?.score ?? 0
        const finalScore = claudeScore > 0 ? 0.4 * baseScore + 0.6 * claudeScore : baseScore
        return {
          node: n, isAIMentioned, isPinned, isCenter, score: finalScore,
          relation: centerNode && n.id !== centerNodeId ? classifyRelation(centerNode, n) : null,
        }
      })
      .sort((a, b) => {
        if (a.isCenter && !b.isCenter) return -1
        if (!a.isCenter && b.isCenter) return 1
        if (a.isAIMentioned && !b.isAIMentioned) return -1
        if (!a.isAIMentioned && b.isAIMentioned) return 1
        return b.score - a.score
      })
  }, [rawNodes, chatMentionedCodes, pinnedStandards, centerNodeId, claudeRelations])

  const subjectsWithResults = useMemo(() => {
    const s = new Set<string>()
    rawNodes.forEach(n => { if (n.type === 'standard' && n.subject_id) s.add(n.subject_id) })
    return s
  }, [rawNodes])

  // ── 노드 추가 헬퍼 ──────────────────────────────────────────────────
  const autoAnalyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addNode = useCallback((newNode: GNode) => {
    nodesRef.current = [...nodesRef.current, newNode]
    setRawNodes(prev => [...prev, newNode])
    // 중심 노드가 있으면 추가된 노드의 관계를 자동 재분석한다 (수동 '노드 재분석' 클릭 불필요).
    // 디바운스로 연속 추가를 한 번에 묶고, runAnalysis가 lastAnalyzedNodeCountRef를 현재 수로
    // 갱신하므로 변경 감지 effect가 재트리거되지 않아 루프가 없다.
    if (isLeader && centerNodeId) {
      if (autoAnalyzeTimerRef.current) clearTimeout(autoAnalyzeTimerRef.current)
      autoAnalyzeTimerRef.current = setTimeout(() => {
        autoAnalyzeTimerRef.current = null
        setNodesChangedAfterAnalysis(false)
        runAnalysis(centerNodeId)
      }, 1200)
    }
  }, [setRawNodes, isLeader, centerNodeId, runAnalysis])
  useEffect(() => () => { if (autoAnalyzeTimerRef.current) clearTimeout(autoAnalyzeTimerRef.current) }, [])

  // ── 이벤트 핸들러 ────────────────────────────────────────────────────
  const onNodeClick = useCallback((node: GNode) => {
    if (node.type !== 'standard') return
    setPopup(node)
    setContextMenu(null)
    if (onSelectStandard) {
      onSelectStandard({ code: node.label, text: node.text ?? '', subject_id: node.subject_id ?? '', keywords: node.keywords ?? [] })
    }
  }, [onSelectStandard])

  const onRightClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setOnboardingVisible(false)
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId })
  }, [setOnboardingVisible])

  // ── 빈 상태 ──────────────────────────────────────────────────────────
  // chatMentionedCodes, savedData, rawNodes 중 하나라도 있으면 그래프 표시
  const hasContent = chatMentionedCodes.length > 0 || !!savedData || rawNodes.length > 0 || keyword.trim().length > 0
  if (!hasContent) return (
    <div className="flex items-center justify-center h-full text-sm text-gray-400">
      대화에서 주제 키워드가 감지되면 그래프가 표시됩니다
    </div>
  )

  // ── 저장 데이터 빌드 ─────────────────────────────────────────────────
  const buildSaveData = () => {
    const centerN = centerNodeId ? rawNodes.find(n => n.id === centerNodeId) : null
    const selectedStds: GraphSelectedStandard[] = recommendedStandards
      .filter(({ node }) => visibleIds.has(node.id))
      .map(({ node, score, relation }) => {
        const ck = [centerNodeId ?? '', node.id].sort().join('||')
        const cr = claudeRelations.get(ck)
        const rt = normalizeGraphRelationType(cr?.relationType ?? relation)
        const entry: GraphSelectedStandard = {
          id: node.id, label: node.label, subjectId: node.subject_id ?? '', text: node.text ?? '',
          score: toStoredGraphScore(score),
        }
        if (rt) entry.relationType = rt
        return entry
      })
    const agentNotes = [...claudeRelations.entries()]
      .filter(([, rel]) => rel.explanation)
      .map(([key, rel]) => {
        const [a, b] = key.split('||')
        const nodeId = a === centerNodeId ? b : a
        const note: { standardId: string; explanation: string; ideas?: string[]; teachingNote?: string } = { standardId: nodeId, explanation: rel.explanation }
        if (rel.ideas && rel.ideas.length > 0) note.ideas = rel.ideas
        if (rel.teachingNote) note.teachingNote = rel.teachingNote
        return note
      })
    return {
      centerNode: centerN ? { id: centerN.id, label: centerN.label, subjectId: centerN.subject_id ?? '', text: centerN.text ?? '' } : null,
      selectedStandards: selectedStds,
      agentNotes,
    }
  }

  return (
    <div
      className="m3-sheet m3-graph m3-shell flex flex-col w-full overflow-hidden"
      style={{ height: height ?? '100%' }}
    >
      <GraphToolbar
        algoMode={algoMode} relFilter={relFilter} helpOpen={onboardingVisible} isLeader={isLeader}
        onAlgoModeChange={setAlgoMode} onRelFilterChange={setRelFilter}
        onToggleHelp={() => setOnboardingVisible(open => !open)}
      />
      <div className="kg-workspace-body relative flex min-h-0 flex-1 overflow-hidden">
      {/* 좌측 패널 */}
      <LeftPanel
        loading={loading}
        claudeLoading={claudeLoading}
        centerNodeId={centerNodeId}
        isLeader={isLeader}
        rawNodes={rawNodes}
        visibleIds={visibleIds}
        checkedStandards={checkedStandards}
        recommendedStandards={recommendedStandards}
        claudeRelations={claudeRelations}
        recommendedCenterIds={recommendedCenterIds}
        pinnedStandards={pinnedStandards}
        subjectsWithResults={subjectsWithResults}
        svgWidth={svgWidth}
        svgHeight={svgHeight}
        keyword={keyword}
        gradeGroup={gradeGroup}
        algoMode={algoMode}
        currentUserName={currentUserName}
        selectedCardId={selectedCardId}
        onSetSelectedCardId={setSelectedCardId}
        onApplyCenterNode={applyCenterNode}
        applyCheckedStandards={applyCheckedStandards}
        onPinChange={onPinChange}
        onAddNode={addNode}
        onShowStandardsBrowser={() => setShowStandardsBrowser(true)}
      />

      {/* 우측 그래프 영역 — 측정 영역(graphAreaRef)의 flex/position/overflow는 불변, 배경색만 토큰화 */}
      <div ref={graphAreaRef} className="min-w-0 flex-1 relative overflow-hidden" style={{ background: 'var(--md-sys-surface-container-low)' }}>

        {/* 전체 성취기준 브라우저 */}
        {showStandardsBrowser && (
          <StandardsBrowser
            onClose={() => setShowStandardsBrowser(false)}
            rawNodes={rawNodes}
            checkedStandards={checkedStandards}
            nodesRef={nodesRef}
            svgWidth={svgWidth}
            svgHeight={svgHeight}
            pinnedStandards={pinnedStandards}
            currentUserName={currentUserName}
            onAddNode={addNode}
            onPinChange={onPinChange}
            applyCheckedStandards={applyCheckedStandards}
          />
        )}

        {/* 분석 중 오버레이 */}
        {claudeLoading && centerNodeId && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none" style={{ background: 'color-mix(in srgb, var(--md-sys-surface) 70%, transparent)' }} role="status" aria-live="polite">
            <div className="m3-card md-shadow-3 flex items-center gap-3 px-6 py-4" style={{ borderRadius: 'var(--md-sys-radius-lg)', background: 'var(--md-sys-surface-container-high)' }}>
              <div className="w-8 h-8 rounded-full animate-spin shrink-0" style={{ border: '3px solid var(--md-sys-primary-container)', borderTopColor: 'var(--md-sys-primary)' }} />
              <div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--md-sys-on-surface)' }}>관계 분석 중…</p>
                <p className="text-[12px]" style={{ color: 'var(--md-sys-on-surface-variant)' }}>성취기준 간 교육적 관계를 분류하고 있습니다</p>
              </div>
            </div>
          </div>
        )}

        {/* 로딩/에러/빈 상태 */}
        {loading && <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--md-sys-on-surface-variant)' }} role="status" aria-live="polite"><span className="animate-pulse">&ldquo;{keyword.slice(0, 20)}&rdquo; 검색 중…</span></div>}
        {!loading && error && <div className="absolute inset-0 flex items-center justify-center text-sm px-3 text-center" style={{ color: 'var(--md-sys-error)' }} role="alert">{error}</div>}
        {!loading && !error && rawNodes.length === 0 && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm" style={{ color: 'var(--md-sys-on-surface-variant)' }}><span>&ldquo;{keyword.slice(0, 24)}&rdquo;와 관련된 성취기준 없음</span></div>}
        {!loading && !error && rawNodes.length > 0 && visibleNodes.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--md-sys-on-surface-variant)' }}>표시할 노드가 없습니다</div>}

        {/* SVG 그래프 캔버스 */}
        <GraphCanvas
          svgRef={svgRef}
          nodesRef={nodesRef}
          svgWidth={svgWidth}
          svgHeight={svgHeight}
          height={height}
          visibleNodes={visibleNodes}
          visibleEdges={visibleEdges}
          centerNodeId={centerNodeId}
          popup={popup}
          claudeRelations={claudeRelations}
          chatMentionedCodes={chatMentionedCodes}
          pinnedStandards={pinnedStandards}
          recommendedCenterIds={recommendedCenterIds}
          onNodeClick={onNodeClick}
          onRightClick={onRightClick}
          hoveredNodeId={hoveredNodeId}
          onSetHoveredNodeId={setHoveredNodeId}
          onSetTooltip={setTooltip}
          onDragStart={() => setContextMenu(null)}
          onDragEnd={resumeSimulation}
        />

        {/* 컨텍스트 메뉴 */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            nodeId={contextMenu.nodeId}
            visibleNodes={visibleNodes}
            centerNodeId={centerNodeId}
            isLeader={isLeader}
            recommendedCenterIds={recommendedCenterIds}
            currentUserName={currentUserName}
            onClose={() => setContextMenu(null)}
            onSetCenter={(nodeId) => {
              applyCenterNode(nodeId)
              setRecommendedCenterIds(prev => { const next = new Map(prev); next.delete(nodeId); return next })
            }}
            onUnsetCenter={(nodeId) => {
              const n = nodesRef.current.find(nd => nd.id === nodeId)
              if (n) { n.fx = undefined; n.fy = undefined }
              setCenterNodeId(null)
              setManualEdges([])
            }}
            onRecommendCenter={onRecommendCenter}
            onLocalRecommend={(nodeId, name) => {
              setRecommendedCenterIds(prev => { const next = new Map(prev); next.set(nodeId, name); return next })
            }}
            onShowPopup={(node) => setPopup(node)}
          />
        )}

        {/* 툴팁 */}
        {tooltip && <Tooltip nodeId={tooltip.nodeId} x={tooltip.x} y={tooltip.y} rawNodes={rawNodes} />}

        {/* 노드 상세 팝업 */}
        {popup && (
          <NodePopup
            node={popup}
            centerNodeId={centerNodeId}
            rawNodes={rawNodes}
            visibleNodes={visibleNodes}
            visibleEdges={visibleEdges}
            claudeRelations={claudeRelations}
            claudeLoading={claudeLoading}
            popupAnalysisLoading={popupAnalysisLoading}
            onClose={() => setPopup(null)}
            curriculumSheetContext={(() => {
              if (!curriculumSheet || !popup.label) return null
              const code = popup.label.replace(/[\[\]]/g, '')
              const row = curriculumSheet.find(r => r.standard && r.standard.includes(code))
              if (!row) return null
              return { coreIdea: row.coreIdea, knowledge: row.knowledge, processFunction: row.processFunction, agentLessonExample: row.agentLessonExample, description: row.description, subject: row.subject }
            })()}
            onReanalyze={isLeader ? (popupId, cId) => {
              setClaudeRelations(prev => {
                const next = new Map(prev)
                next.delete([cId, popupId].sort().join('||'))
                return next
              })
              analyzePopupNode(popupId, cId, true)
            } : undefined}
          />
        )}
      </div>
      </div>
      <footer aria-label="그래프 저장 및 수업 예시" className="kg-bottom-bar shrink-0 border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-4 py-3">
        <div className="min-w-0 flex-1">
          {isLeader && centerNodeId && (showAnalysisBanner || nodesChangedAfterAnalysis || claudeLoading) ? (
            <div className="flex flex-wrap items-center gap-2" role="region" aria-label="수업 예시 생성 제안">
              <span className="text-[13px] text-[var(--md-on-surface-variant)]">
                {claudeLoading ? '성취기준의 연결을 분석하고 있습니다.' : nodesChangedAfterAnalysis ? '연결이 바뀌었습니다. 수업 예시를 갱신하세요.' : '연결을 바탕으로 수업 예시를 만들어 보세요.'}
              </span>
              <MD3Button variant="tonal" disabled={claudeLoading} onClick={() => { setShowAnalysisBanner(false); runAnalysis(centerNodeId) }}>
                {claudeLoading ? '분석 중…' : nodesChangedAfterAnalysis ? '수업 예시 다시 생성' : '수업 예시 생성'}
              </MD3Button>
              {showAnalysisBanner && !claudeLoading && <MD3Button variant="text" tone="neutral" onClick={() => setShowAnalysisBanner(false)}>나중에</MD3Button>}
            </div>
          ) : (
            <p className="text-[13px] leading-5 text-[var(--md-on-surface-variant)]">
              {onSaveGraph ? '저장하면 그래프와 수업 예시가 교육과정 분석시트에 반영됩니다.' : '팀장이 그래프와 수업 예시를 저장하면 분석시트에 반영됩니다.'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {onClose && <MD3Button variant="outlined" tone="neutral" onClick={onClose}>분석시트로</MD3Button>}
          {onSaveGraph && <SaveButtons onSaveGraph={onSaveGraph} buildData={buildSaveData} disabled={loading || claudeLoading} />}
        </div>
      </footer>
    </div>
  )
}

export type { GNode, GEdge } from './types'

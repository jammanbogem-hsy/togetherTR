import { useCallback, useEffect, useRef, useState } from 'react'
import type { GNode, GEdge } from './types'
import { normalizedEdgeWeight } from './constants'

// ─── 물리 상수 ────────────────────────────────────────────────────────────

const REPULSION   = 42000
const SPRING_K    = 0.018
const REST_LEN    = 220
const FRICTION    = 0.72
const CENTER_PULL = 0.004
const MIN_DIST    = 140

// 운동 에너지 자동 정지 임계값
const KE_THRESHOLD = 0.5
const MIN_STEPS_BEFORE_STOP = 30
const MAX_STEPS = 600

// ─── Spring-Verlet 틱 ────────────────────────────────────────────────────

function tick(nodes: GNode[], edges: GEdge[], width: number, height: number): number {
  const cx = width / 2
  const cy = height / 2
  const n = nodes.length

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = nodes[j].x - nodes[i].x
      const dy = nodes[j].y - nodes[i].y
      const dist2 = dx * dx + dy * dy + 1
      const dist  = Math.sqrt(dist2)

      if (dist < MIN_DIST) {
        const overlap = (MIN_DIST - dist) * 0.5
        const mx = (dx / dist) * overlap
        const my = (dy / dist) * overlap
        if (!nodes[i].fx) { nodes[i].x -= mx; nodes[i].y -= my }
        if (!nodes[j].fx) { nodes[j].x += mx; nodes[j].y += my }
      }

      const force = dist < MIN_DIST
        ? REPULSION * 4 / (dist2 + 1)
        : REPULSION / dist2
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      nodes[i].vx -= fx; nodes[i].vy -= fy
      nodes[j].vx += fx; nodes[j].vy += fy
    }
  }

  const nodeMap = new Map(nodes.map(nd => [nd.id, nd]))
  for (const edge of edges) {
    const a = nodeMap.get(edge.source)
    const b = nodeMap.get(edge.target)
    if (!a || !b) continue
    const dx   = b.x - a.x
    const dy   = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) + 1
    const weight = normalizedEdgeWeight(edge.weight)
    const restLen = edge.method === 'rule_based'
      ? REST_LEN
      : REST_LEN - weight * 90
    const springK = SPRING_K * (0.9 + weight * 0.8)
    const force = springK * (dist - restLen)
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    if (!a.fx) { a.vx += fx; a.vy += fy }
    if (!b.fx) { b.vx -= fx; b.vy -= fy }
  }

  let totalKE = 0
  for (const node of nodes) {
    if (node.fx !== undefined) { node.x = node.fx; node.vx = 0; node.vy = 0; continue }
    node.vx = (node.vx + (cx - node.x) * CENTER_PULL) * FRICTION
    node.vy = (node.vy + (cy - node.y) * CENTER_PULL) * FRICTION
    node.x += node.vx
    node.y += node.vy
    totalKE += node.vx * node.vx + node.vy * node.vy
  }

  return totalKE
}

// ─── Hook ─────────────────────────────────────────────────────────────────

interface UseForceSimulationOptions {
  nodesRef: React.MutableRefObject<GNode[]>
  edgesRef: React.MutableRefObject<GEdge[]>
  svgWidth: number
  svgHeight: number
  /** rawNodes 변경 시 감지용 (length 등) */
  rawNodesLength: number
  /** 레이아웃 변경 시 재시작용 카운터 */
  layoutKey: number
}

export function useForceSimulation({
  nodesRef,
  edgesRef,
  svgWidth,
  svgHeight,
  rawNodesLength,
  layoutKey,
}: UseForceSimulationOptions) {
  const rafRef = useRef<number>(0)
  const [, setFrame] = useState(0)

  const resume = useCallback(() => {
    // 현재 실행 중이면 취소 후 재시작
    cancelAnimationFrame(rafRef.current)
    nodesRef.current.forEach(n => { n.vx = 0; n.vy = 0 })

    let active = true
    let step = 0

    function animate() {
      if (!active) return
      const stdNodes = nodesRef.current.filter(n => n.type === 'standard')
      const stdEdges = edgesRef.current.filter(
        e => stdNodes.some(n => n.id === e.source) && stdNodes.some(n => n.id === e.target)
      )
      const totalKE = tick(stdNodes, stdEdges, svgWidth, svgHeight)
      step++
      setFrame(f => f + 1)

      // 운동 에너지 기반 자동 정지
      if (totalKE < KE_THRESHOLD && step > MIN_STEPS_BEFORE_STOP) {
        return // 안정화됨
      }
      if (step < MAX_STEPS) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [nodesRef, edgesRef, svgWidth, svgHeight])

  // rawNodes 변경 또는 layoutKey 변경 시 자동 시작
  useEffect(() => {
    if (rawNodesLength === 0) return
    const cleanup = resume()
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodesLength, layoutKey, svgWidth, svgHeight])

  return { resume, setFrame }
}

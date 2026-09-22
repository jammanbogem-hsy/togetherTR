'use client'

// 교육과정 분석맵 — 연속 힘 레이아웃 훅 (Obsidian 스타일).
//
// 에셋 좌표에서 시드하므로 첫 화면부터 정돈된 상태이고, alpha 가 ALPHA_MIN 아래로
// 내려가지 않아 미세한 움직임이 계속 남는다. 렌더는 이 훅의 rAF 루프가 onTick 으로
// 호출하며, 좌표는 SimNode 객체를 제자리 갱신하므로 프레임당 할당이 없다.
// 에셋의 x,y 는 homeX/homeY 로 복사만 하고 절대 변형하지 않는다.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ALPHA_MIN,
  ALPHA_START,
  DEFAULT_PARAMS,
  REHEAT_CHANGE,
  REHEAT_DRAG,
  alphaStep,
  createSimLinks,
  createSimNodes,
  layoutSpread,
  simulationTick,
  subjectCentroids,
  type SimLink,
  type SimNode,
  type SimParams,
} from './forceMath'
import type { MapEdge, MapNode } from './types'

export interface ForceLayoutOptions {
  nodes: readonly MapNode[]
  edges: readonly MapEdge[]
  /** 월드 단위 반지름 — 렌더러와 같은 규칙을 쓴다 */
  radiusOf: (node: MapNode) => number
  /** 움직임 사용 여부 (사용자 토글 · reduced-motion 반영 후의 값) */
  enabled: boolean
  /** 매 프레임 렌더 요청 */
  onTick: () => void
}

export interface ForceLayout {
  /** id → 시뮬레이션 노드. 객체가 제자리 갱신되므로 참조는 유지된다. */
  nodeMapRef: React.RefObject<Map<string, SimNode>>
  reheat: (alpha?: number) => void
  pinNode: (id: string, x: number, y: number) => void
  unpinNode: (id: string) => void
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useForceLayout({ nodes, edges, radiusOf, enabled, onTick }: ForceLayoutOptions): ForceLayout {
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map())
  const alphaRef = useRef(ALPHA_START)
  const rafRef = useRef(0)
  const onTickRef = useRef(onTick)
  const radiusOfRef = useRef(radiusOf)
  const paramsRef = useRef<SimParams | null>(null)

  useEffect(() => {
    onTickRef.current = onTick
    radiusOfRef.current = radiusOf
  }, [onTick, radiusOf])

  // 에셋 배치에서 파생되는 고정 목표들 — 노드 집합이 바뀔 때만 다시 계산
  const layout = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
    }
    if (!Number.isFinite(minX)) {
      return { center: { x: 0, y: 0 }, spread: 1, centroids: new Map<string, { x: number; y: number }>() }
    }
    return {
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      spread: layoutSpread(Math.max(maxX - minX, maxY - minY)),
      centroids: subjectCentroids(nodes),
    }
  }, [nodes])

  // ── 시뮬레이션 상태 구성 (노드·엣지 집합이 바뀔 때) ─────────────────────
  useEffect(() => {
    const previous = nodeMapRef.current
    const byId = new Map(nodes.map(n => [n.id, n]))
    const simNodes = createSimNodes(nodes, id => {
      const node = byId.get(id)
      return node ? radiusOfRef.current(node) : 8
    })
    // 필터로 노드가 들어오고 나갈 때 기존 노드가 순간이동하지 않도록 좌표를 물려받는다
    for (const sn of simNodes) {
      const prev = previous.get(sn.id)
      if (!prev) continue
      sn.x = prev.x
      sn.y = prev.y
      sn.vx = prev.vx
      sn.vy = prev.vy
      sn.fx = prev.fx
      sn.fy = prev.fy
    }
    const index = new Map<string, number>()
    simNodes.forEach((sn, i) => index.set(sn.id, i))
    simNodesRef.current = simNodes
    simLinksRef.current = createSimLinks(edges, index, simNodes, layout.spread)
    nodeMapRef.current = new Map(simNodes.map(sn => [sn.id, sn]))
    paramsRef.current = {
      ...DEFAULT_PARAMS,
      alpha: alphaRef.current,
      center: layout.center,
      subjectCentroids: layout.centroids,
    }
    alphaRef.current = Math.max(alphaRef.current, REHEAT_CHANGE)
    onTickRef.current()
  }, [nodes, edges, layout])

  const reheat = useCallback((alpha: number = REHEAT_CHANGE) => {
    alphaRef.current = Math.max(alphaRef.current, alpha)
  }, [])

  const pinNode = useCallback((id: string, x: number, y: number) => {
    const node = nodeMapRef.current.get(id)
    if (!node) return
    node.fx = x
    node.fy = y
    node.x = x
    node.y = y
    node.vx = 0
    node.vy = 0
    alphaRef.current = Math.max(alphaRef.current, REHEAT_DRAG)
    // 움직임이 꺼져 있어도 끌어 놓은 위치는 즉시 보여야 한다
    onTickRef.current()
  }, [])

  const unpinNode = useCallback((id: string) => {
    const node = nodeMapRef.current.get(id)
    if (!node) return
    node.fx = null
    node.fy = null
    alphaRef.current = Math.max(alphaRef.current, REHEAT_DRAG)
  }, [])

  // ── rAF 루프 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return
    let stopped = false

    const step = (): void => {
      if (stopped) return
      const params = paramsRef.current
      if (params) {
        alphaRef.current = alphaStep(alphaRef.current)
        params.alpha = alphaRef.current
        params.center = layout.center
        params.subjectCentroids = layout.centroids
        simulationTick(simNodesRef.current, simLinksRef.current, params)
      }
      onTickRef.current()
      rafRef.current = requestAnimationFrame(step)
    }

    const start = (): void => {
      if (stopped || rafRef.current !== 0) return
      rafRef.current = requestAnimationFrame(step)
    }
    const stop = (): void => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    // 탭이 가려지면 계산을 멈춘다
    const onVisibility = (): void => {
      if (document.hidden) stop()
      else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, layout])

  // 움직임을 끄면 alpha 를 최소로 내려 두어 다시 켤 때 폭발하지 않게 한다
  useEffect(() => {
    if (!enabled) alphaRef.current = ALPHA_MIN
  }, [enabled])

  return { nodeMapRef, reheat, pinNode, unpinNode }
}

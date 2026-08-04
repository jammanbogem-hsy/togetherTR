import { useCallback, useEffect, useRef, useState } from 'react'
import type { GNode, GEdge } from './types'
import { normalizedEdgeWeight, nodeRadius } from './constants'

// ─── 물리 상수 (부드럽고 유연한 감쇠 지향) ────────────────────────────────
// d3-force 계열의 alpha 냉각 모델을 의존성 없이 이식.
// 힘은 alpha에 비례해 서서히 사라지므로, 높은 속도 보존율에서도 반드시 안정 정착한다.

const CHARGE           = 24000   // 반발력(전하) 세기 — 부드럽게
const CHARGE_MAX_DIST  = 660     // 반발 컷오프(성능 + 국소성): 먼 노드 쌍은 무시
const LINK_BASE_DIST   = 188     // 기본 링크 길이 (여기에 양끝 반경이 더해짐)
const LINK_DIST_SPAN   = 78      // 가중치가 클수록(관계가 강할수록) 링크가 짧아진다
const LINK_RULE_DIST   = 224     // 규칙 기반(위계) 링크는 조금 더 길게 고정
const LINK_STRENGTH    = 0.030   // 스프링 기본 강도 (가중치로 가감)
const CENTER_GRAVITY   = 0.012   // 중심으로의 완만한 인력 (연결 없는 노드 이탈 방지)
const COLLIDE_PAD      = 10      // 충돌 여백
const COLLIDE_STRENGTH = 0.8     // 충돌 분리 강도 (속도 임펄스 기반 → 하드 점프 없음)
const VELOCITY_DECAY   = 0.22    // 속도 감쇠(=1-보존율). 낮을수록 더 부드럽고 탄력적
const MAX_VELOCITY     = 30      // 폭주 방지 클램프

const ALPHA_START      = 1       // 재시작 시 초기 온도
const ALPHA_DECAY      = 0.030   // 냉각 속도 (~120틱, 약 2초 후 정착)
const ALPHA_MIN        = 0.02    // 이 아래로 냉각되면 정지
const REDUCED_STEPS    = 240     // reduced-motion: 동기 스텝 수(렌더 1회)

interface SimLink {
  a: GNode
  b: GNode
  rest: number
  k: number
}

interface Scene {
  nodes: GNode[]
  links: SimLink[]
  radii: Map<GNode, number>
}

// ─── 장면 사전 계산 ───────────────────────────────────────────────────────
// resume 1회당 한 번만 수행. 매 프레임 filter/find/Map 재생성을 제거해 성능을 확보한다.

function buildScene(nodesRef: GNode[], edgesRef: GEdge[], cx: number, cy: number): Scene {
  const nodes = nodesRef.filter(n => n.type === 'standard')
  const byId = new Map<string, GNode>()
  for (const n of nodes) byId.set(n.id, n)

  // 반경(=질량 대용) 사전 계산. 중심 노드는 캔버스 중앙에 고정(fx)된 노드로 추정.
  const radii = new Map<GNode, number>()
  for (const n of nodes) {
    const isCenterLike = n.fx !== undefined && n.fy !== undefined &&
      Math.abs(n.fx - cx) < 6 && Math.abs(n.fy - cy) < 6
    radii.set(n, nodeRadius(n.type, n.similarityScore, isCenterLike))
  }

  const links: SimLink[] = []
  for (const e of edgesRef) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    if (!a || !b) continue
    const w = normalizedEdgeWeight(e.weight) // 0–1
    const base = e.method === 'rule_based' ? LINK_RULE_DIST : LINK_BASE_DIST - w * LINK_DIST_SPAN
    const rest = base + (radii.get(a) ?? 12) + (radii.get(b) ?? 12) // 반경만큼 밀어내 노드 겹침 방지
    const k = LINK_STRENGTH * (0.7 + w * 0.9) // 강한 관계일수록 더 단단한 스프링
    links.push({ a, b, rest, k })
  }

  return { nodes, links, radii }
}

// ─── Spring-Verlet 틱 (alpha 스케일) ──────────────────────────────────────

const CHARGE_MAX2 = CHARGE_MAX_DIST * CHARGE_MAX_DIST

function clampV(v: number): number {
  return v < -MAX_VELOCITY ? -MAX_VELOCITY : v > MAX_VELOCITY ? MAX_VELOCITY : v
}

function tick(scene: Scene, cx: number, cy: number, alpha: number): number {
  const { nodes, links, radii } = scene
  const n = nodes.length

  // 1) 반발력 (O(n²) + 거리 컷오프)
  for (let i = 0; i < n; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 === 0) {
        // 완전 겹침: 결정적 미세 분리 (인덱스 기반 → 매 실행 동일)
        dx = (i - j) * 0.5 || 0.5
        dy = ((i * 7 + j) % 3 - 1) * 0.5
        d2 = dx * dx + dy * dy
      }
      if (d2 > CHARGE_MAX2) continue
      const d = Math.sqrt(d2)
      const f = (CHARGE * alpha) / d2
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      if (a.fx === undefined) { a.vx -= fx; a.vy -= fy }
      if (b.fx === undefined) { b.vx += fx; b.vy += fy }
    }
  }

  // 2) 링크 스프링 (rest 길이로 수렴, 질량(반경) 비례 분배)
  for (const link of links) {
    const { a, b, rest, k } = link
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const f = ((d - rest) / d) * k * alpha
    const fx = dx * f
    const fy = dy * f
    const ma = radii.get(a) ?? 12
    const mb = radii.get(b) ?? 12
    const total = ma + mb
    const sa = mb / total // 가벼운(작은) 노드가 더 많이 움직인다
    const sb = ma / total
    if (a.fx === undefined) { a.vx += fx * sa; a.vy += fy * sa }
    if (b.fx === undefined) { b.vx -= fx * sb; b.vy -= fy * sb }
  }

  // 3) 부드러운 충돌 — 위치 순간이동(하드 점프) 대신 속도 임펄스로 완만히 분리
  for (let i = 0; i < n; i++) {
    const a = nodes[i]
    const ra = radii.get(a) ?? 12
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]
      const rb = radii.get(b) ?? 12
      const min = ra + rb + COLLIDE_PAD
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d2 = dx * dx + dy * dy
      if (d2 === 0 || d2 >= min * min) continue
      const d = Math.sqrt(d2)
      const push = ((min - d) / d) * COLLIDE_STRENGTH * 0.5
      const ox = dx * push
      const oy = dy * push
      if (a.fx === undefined) { a.vx -= ox; a.vy -= oy }
      if (b.fx === undefined) { b.vx += ox; b.vy += oy }
    }
  }

  // 4) 적분 (중심 인력 → 클램프 → 감쇠 → 위치 갱신)
  let ke = 0
  for (const node of nodes) {
    if (node.fx !== undefined && node.fy !== undefined) {
      node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0
      continue
    }
    node.vx += (cx - node.x) * CENTER_GRAVITY * alpha
    node.vy += (cy - node.y) * CENTER_GRAVITY * alpha
    node.vx = clampV(node.vx) * (1 - VELOCITY_DECAY)
    node.vy = clampV(node.vy) * (1 - VELOCITY_DECAY)
    node.x += node.vx
    node.y += node.vy
    ke += node.vx * node.vx + node.vy * node.vy
  }

  return ke
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
  const runningRef = useRef(false)
  const [, setFrame] = useState(0)

  // prefers-reduced-motion: 애니메이션 없이 최종 레이아웃으로 즉시 정착
  const reducedMotionRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const onChange = () => { reducedMotionRef.current = mq.matches }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // resume: 드래그 종료·구조 변경 시 재가열(reheat). 한 번에 하나의 루프만 실행.
  const resume = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    runningRef.current = false

    const cx = svgWidth / 2
    const cy = svgHeight / 2
    const scene = buildScene(nodesRef.current, edgesRef.current, cx, cy)
    if (scene.nodes.length === 0) return () => {}

    // 고정되지 않은 노드의 속도만 초기화 (중심/드래그 노드는 fx로 유지)
    for (const node of scene.nodes) {
      if (node.fx === undefined) { node.vx = 0; node.vy = 0 }
    }

    // reduced-motion: 동기 스텝으로 정착 후 1회만 렌더
    if (reducedMotionRef.current) {
      let alpha = ALPHA_START
      for (let s = 0; s < REDUCED_STEPS && alpha > ALPHA_MIN; s++) {
        tick(scene, cx, cy, alpha)
        alpha += (0 - alpha) * ALPHA_DECAY
      }
      setFrame(f => f + 1)
      return () => {}
    }

    runningRef.current = true
    let alpha = ALPHA_START

    const animate = () => {
      if (!runningRef.current) return
      const ke = tick(scene, cx, cy, alpha)
      alpha += (0 - alpha) * ALPHA_DECAY // 0을 향한 지수 냉각
      // 시각 갱신은 RAF당 1회(디스플레이 주사율에 자연 스로틀). 문서 숨김 시 렌더 생략.
      if (typeof document === 'undefined' || !document.hidden) {
        setFrame(f => f + 1)
      }
      if (alpha < ALPHA_MIN && ke < 0.6) {
        runningRef.current = false
        setFrame(f => f + 1) // 최종 정착 프레임 확정
        return
      }
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    return () => { runningRef.current = false; cancelAnimationFrame(rafRef.current) }
  }, [nodesRef, edgesRef, svgWidth, svgHeight])

  // rawNodes 변경 / layoutKey 변경 / 캔버스 크기 변경 시 자동 재시작
  useEffect(() => {
    if (rawNodesLength === 0) return
    const cleanup = resume()
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodesLength, layoutKey, svgWidth, svgHeight])

  return { resume, setFrame }
}

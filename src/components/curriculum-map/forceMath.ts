// 교육과정 분석맵 — 힘 기반 레이아웃의 순수 계산부.
// React 와 무관한 데이터 변환만 담아 node 로 단독 테스트한다.
// 시뮬레이션 상태는 에셋의 복사본이며, 에셋 좌표(x,y)는 절대 변형하지 않는다.

export interface SimNode {
  id: string
  subjectId: string
  x: number
  y: number
  vx: number
  vy: number
  /** 월드 단위 반지름 */
  r: number
  /** 에셋이 준 원래 자리 — 복구·귀환력의 기준 */
  homeX: number
  homeY: number
  /** 드래그로 고정된 좌표 (없으면 null) */
  fx: number | null
  fy: number | null
}

export interface SimLink {
  /** nodes 배열 인덱스 */
  source: number
  target: number
  sim: number
  /** 스프링 자연 길이 */
  rest: number
}

export interface SimParams {
  alpha: number
  velocityDecay: number
  linkStrength: number
  repulsion: number
  collisionPad: number
  centerStrength: number
  subjectStrength: number
  center: { x: number; y: number }
  /** 반발·충돌 탐색 격자 한 칸 크기 = 상호작용 반경 */
  cellSize: number
  subjectCentroids: Map<string, { x: number; y: number }>
}

export const ALPHA_START = 0.35
export const ALPHA_MIN = 0.015
export const ALPHA_TARGET = 0.01
export const ALPHA_DECAY = 0.0228
export const REHEAT_DRAG = 0.5
export const REHEAT_CHANGE = 0.3
/** 스프링 자연 길이 계산 기준 */
export const REST_BASE = 40
export const REST_RANGE = 260
export const LAYOUT_REFERENCE_EXTENT = 2000

export const DEFAULT_PARAMS: Omit<SimParams, 'alpha' | 'center' | 'subjectCentroids'> = {
  velocityDecay: 0.18,
  linkStrength: 0.08,
  repulsion: 0.9,
  collisionPad: 6,
  centerStrength: 0.006,
  subjectStrength: 0.02,
  cellSize: 150,
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}

/** 에셋 배치 크기를 기준 크기(2000)에 대한 비율로. */
export function layoutSpread(extent: number): number {
  if (!Number.isFinite(extent) || extent <= 0) return 1
  return extent / LAYOUT_REFERENCE_EXTENT
}

/**
 * 스프링 자연 길이 — 현재 에셋 거리를 70%, 유사도 기반 목표를 30% 섞는다.
 * 에셋 배치를 크게 흔들지 않으면서 유사도가 낮은 쌍을 밀어 놓는다.
 */
export function springRestLength(assetDist: number, sim: number, spread: number): number {
  const d = Math.max(0, finite(assetDist, 0))
  const s = Math.min(1, Math.max(0, finite(sim, 0)))
  const target = REST_BASE + (1 - s) * REST_RANGE * Math.max(0.2, finite(spread, 1))
  return d * 0.7 + target * 0.3
}

/**
 * alpha 한 스텝. target 으로 감쇠하되 min 아래로는 내려가지 않아
 * 그래프가 완전히 멈추지 않고 미세하게 계속 움직인다.
 */
export function alphaStep(
  alpha: number,
  target: number = ALPHA_TARGET,
  decay: number = ALPHA_DECAY,
  min: number = ALPHA_MIN,
): number {
  const a = finite(alpha, min)
  return Math.max(min, a + (target - a) * decay)
}

/**
 * 두 노드가 겹칠 때 a 가 움직여야 할 절반 변위. b 는 그 반대로 움직이면
 * 정확히 r_a + r_b + pad 만큼 벌어진다. 겹치지 않으면 null.
 */
export function collisionPush(
  a: { x: number; y: number; r: number },
  b: { x: number; y: number; r: number },
  pad: number,
): { dx: number; dy: number } | null {
  const need = a.r + b.r + pad
  let dx = a.x - b.x
  let dy = a.y - b.y
  let d = Math.hypot(dx, dy)
  if (d >= need) return null
  if (d === 0 || !Number.isFinite(d)) {
    // 완전히 같은 자리 — 결정적인 방향으로 갈라놓는다
    dx = 1
    dy = 0
    d = 1
  }
  const half = (need - d) / 2
  return { dx: (dx / d) * half, dy: (dy / d) * half }
}

export function gridKey(x: number, y: number, cellSize: number): number {
  const cx = Math.floor(finite(x, 0) / cellSize)
  const cy = Math.floor(finite(y, 0) / cellSize)
  // 음수 좌표도 충돌 없이 담기는 단순 해시
  return (cx + 4096) * 16384 + (cy + 4096)
}

/** 교과별 무게중심 — 에셋 좌표에서 한 번 계산해 고정 목표로 쓴다. */
export function subjectCentroids(
  nodes: readonly { subjectId: string; x: number; y: number }[],
): Map<string, { x: number; y: number }> {
  const sums = new Map<string, { x: number; y: number; n: number }>()
  for (const n of nodes) {
    const acc = sums.get(n.subjectId) ?? { x: 0, y: 0, n: 0 }
    acc.x += finite(n.x, 0)
    acc.y += finite(n.y, 0)
    acc.n += 1
    sums.set(n.subjectId, acc)
  }
  const out = new Map<string, { x: number; y: number }>()
  for (const [id, acc] of sums) {
    if (acc.n > 0) out.set(id, { x: acc.x / acc.n, y: acc.y / acc.n })
  }
  return out
}

/** 에셋 노드에서 시뮬레이션 상태를 만든다 (에셋은 읽기만 한다). */
export function createSimNodes(
  nodes: readonly { id: string; subjectId: string; x: number; y: number; r?: number }[],
  radiusOf: (id: string) => number,
): SimNode[] {
  return nodes.map(n => ({
    id: n.id,
    subjectId: n.subjectId,
    x: finite(n.x, 0),
    y: finite(n.y, 0),
    vx: 0,
    vy: 0,
    r: Math.max(1, radiusOf(n.id)),
    homeX: finite(n.x, 0),
    homeY: finite(n.y, 0),
    fx: null,
    fy: null,
  }))
}

export function createSimLinks(
  edges: readonly { source: string; target: string; sim: number }[],
  indexById: Map<string, number>,
  nodes: readonly SimNode[],
  spread: number,
): SimLink[] {
  const links: SimLink[] = []
  for (const e of edges) {
    const si = indexById.get(e.source)
    const ti = indexById.get(e.target)
    if (si === undefined || ti === undefined || si === ti) continue
    const a = nodes[si]
    const b = nodes[ti]
    const assetDist = Math.hypot(a.homeX - b.homeX, a.homeY - b.homeY)
    links.push({ source: si, target: ti, sim: e.sim, rest: springRestLength(assetDist, e.sim, spread) })
  }
  return links
}

/**
 * 시뮬레이션 한 스텝. nodes 를 제자리에서 갱신한다.
 * 반발·충돌은 균일 격자로 3x3 이웃 칸만 보므로 627 노드에서 O(n).
 */
export function simulationTick(nodes: SimNode[], links: readonly SimLink[], params: SimParams): void {
  const { alpha, cellSize } = params
  const n = nodes.length
  if (n === 0) return

  // 1) 링크 스프링
  for (const link of links) {
    const a = nodes[link.source]
    const b = nodes[link.target]
    if (!a || !b) continue
    let dx = b.x - a.x
    let dy = b.y - a.y
    let d = Math.hypot(dx, dy)
    if (d === 0 || !Number.isFinite(d)) {
      dx = 1
      dy = 0
      d = 1
    }
    const k = params.linkStrength * (0.35 + link.sim * 0.65) * alpha
    const shift = ((d - link.rest) / d) * k
    const mx = dx * shift
    const my = dy * shift
    a.vx += mx
    a.vy += my
    b.vx -= mx
    b.vy -= my
  }

  // 2) 격자 구성
  const grid = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const key = gridKey(nodes[i].x, nodes[i].y, cellSize)
    const cell = grid.get(key)
    if (cell) cell.push(i)
    else grid.set(key, [i])
  }

  // 3) 반발 + 충돌 (이웃 3x3 칸)
  const cutoff = cellSize
  for (let i = 0; i < n; i++) {
    const a = nodes[i]
    const cx = Math.floor(a.x / cellSize)
    const cy = Math.floor(a.y / cellSize)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cell = grid.get(((cx + ox) + 4096) * 16384 + ((cy + oy) + 4096))
        if (!cell) continue
        for (const j of cell) {
          if (j <= i) continue
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 > cutoff * cutoff) continue
          if (d2 === 0 || !Number.isFinite(d2)) {
            dx = (i % 2 === 0 ? 1 : -1) * 0.5
            dy = 0.5
            d2 = 0.5
          }
          const d = Math.sqrt(d2)
          // 반발 세기는 반지름 합에 비례 (큰 노드가 더 넓은 자리를 차지)
          const sum = a.r + b.r
          const mag = ((params.repulsion * sum * sum) / d2) * alpha
          const ux = dx / d
          const uy = dy / d
          a.vx += ux * mag
          a.vy += uy * mag
          b.vx -= ux * mag
          b.vy -= uy * mag

          // 충돌은 위치를 직접 벌린다 (겹침은 즉시 해소)
          const push = collisionPush(a, b, params.collisionPad)
          if (push) {
            if (a.fx === null) {
              a.x += push.dx
              a.y += push.dy
            }
            if (b.fx === null) {
              b.x -= push.dx
              b.y -= push.dy
            }
          }
        }
      }
    }
  }

  // 4) 중심·교과 응집 + 적분
  for (const node of nodes) {
    if (node.fx !== null && node.fy !== null) {
      node.x = node.fx
      node.y = node.fy
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx += (params.center.x - node.x) * params.centerStrength * alpha
    node.vy += (params.center.y - node.y) * params.centerStrength * alpha
    const home = params.subjectCentroids.get(node.subjectId)
    if (home) {
      node.vx += (home.x - node.x) * params.subjectStrength * alpha
      node.vy += (home.y - node.y) * params.subjectStrength * alpha
    }
    node.vx *= 1 - params.velocityDecay
    node.vy *= 1 - params.velocityDecay
    node.x += node.vx
    node.y += node.vy
    // 어떤 이유로든 좌표가 망가지면 원래 자리로 되돌린다
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      node.x = node.homeX
      node.y = node.homeY
      node.vx = 0
      node.vy = 0
    }
  }
}

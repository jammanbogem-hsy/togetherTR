// 교육과정 분석맵 — 융합 그래프 좌표 계산 (순수 함수, 외부 의존성 없음).
//
// 가운데 = 핵심 성취기준. 둘레 = 같은 학년군 다른 교과의 융합 짝.
//  - 방향(부채꼴) = 교과: 같은 교과는 한 부채꼴에 모인다(교과 순서는 범례 순서).
//  - 중심에서의 거리 = 엮기 자연스러움(Jev 관계 강도): 가까울수록 한 수업으로 엮기 쉽다.
// 그래서 "어느 교과와, 얼마나 쉽게" 엮이는지가 자리만 보고 읽힌다.

export interface FusionLayoutItem {
  id: string
  subjectId: string
  /** 0..1 관계 강도 */
  strength: number
}

export interface FusionSector {
  subjectId: string
  /** 이 부채꼴에서 가장 바깥 노드의 반지름 — 교과 이름을 그 바로 바깥에 붙인다 */
  outerRadius: number
  /** 부채꼴 가운데 각(라디안, 0 = 오른쪽, 시계 방향 증가 — 화면 좌표) */
  angle: number
  start: number
  end: number
  count: number
}

export interface FusionLayout {
  positions: Map<string, { x: number; y: number }>
  sectors: FusionSector[]
}

/** 부채꼴 사이 빈틈(라디안) — 교과 경계가 눈에 보이게 */
export const FUSION_SECTOR_GAP = 0.18
/** 같은 부채꼴 안에서 나란히 놓인 이웃이 겹치지 않게 반지름을 번갈아 비키는 비율 */
const RADIAL_STAGGER = 0.09

/**
 * rMin..rMax 사이에 둘레 노드를 놓는다. 부채꼴 폭은 항목 수에 비례하되 교과마다 최소 폭을 준다.
 * 첫 부채꼴은 12시 방향에서 시작한다.
 * 거리는 strengthFloor..1 구간을 rMax..rMin 에 펼친다 — 보이는 항목이 모두 0.5 이상이면
 * 0..1 로 매핑할 때 안쪽 절반에만 몰려 그래프가 작아진다(2026-10-01 화면에서 확인).
 */
export function computeFusionLayout(
  items: readonly FusionLayoutItem[],
  subjectOrder: readonly string[],
  rMin: number,
  rMax: number,
  strengthFloor = 0,
): FusionLayout {
  const positions = new Map<string, { x: number; y: number }>()
  const sectors: FusionSector[] = []
  if (items.length === 0) return { positions, sectors }

  const groups = new Map<string, FusionLayoutItem[]>()
  for (const item of items) {
    const list = groups.get(item.subjectId)
    if (list) list.push(item)
    else groups.set(item.subjectId, [item])
  }
  const order = [...groups.keys()].sort((a, b) => {
    const ia = subjectOrder.indexOf(a)
    const ib = subjectOrder.indexOf(b)
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || (a < b ? -1 : a > b ? 1 : 0)
  })

  const gapTotal = groups.size > 1 ? FUSION_SECTOR_GAP * groups.size : 0
  const usable = Math.PI * 2 - gapTotal
  // 항목 수 비례 + 교과당 최소 1.5칸 — 한 개짜리 교과도 이름이 들어갈 폭을 갖는다
  const weights = order.map(id => Math.max(1.5, groups.get(id)!.length))
  const weightSum = weights.reduce((a, b) => a + b, 0)

  let cursor = -Math.PI / 2
  order.forEach((subjectId, gi) => {
    const width = (usable * weights[gi]) / weightSum
    const start = cursor + (groups.size > 1 ? FUSION_SECTOR_GAP / 2 : 0)
    const end = start + width
    const list = [...groups.get(subjectId)!].sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1))
    // 칸 배정: 강한 것부터 부채꼴 가운데 칸 → 양옆 칸 순서(칸마다 한 항목, 겹치지 않음)
    const slots = list.length
    const step = width / slots
    const centerSlot = (slots - 1) / 2
    const slotOrder = Array.from({ length: slots }, (_, k) => k)
      .sort((a, b) => Math.abs(a - centerSlot) - Math.abs(b - centerSlot) || a - b)
    const span = Math.max(1e-6, 1 - strengthFloor)
    let outerRadius = rMin
    list.forEach((item, i) => {
      const slot = slotOrder[i]
      const angle = start + step * (slot + 0.5)
      const norm = Math.min(1, Math.max(0, (item.strength - strengthFloor) / span))
      const stagger = slots > 1 ? (slot % 2 === 0 ? -1 : 1) * RADIAL_STAGGER * (rMax - rMin) : 0
      const r = Math.min(rMax, Math.max(rMin, rMin + (1 - norm) * (rMax - rMin) + stagger))
      outerRadius = Math.max(outerRadius, r)
      positions.set(item.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    })
    sectors.push({ subjectId, outerRadius, angle: (start + end) / 2, start, end, count: list.length })
    cursor = end + (groups.size > 1 ? FUSION_SECTOR_GAP / 2 : 0)
  })

  return { positions, sectors }
}

// ─── 옵시디언식 힘 배치 (융합 묶음 전용, 노드 25개 이하) ─────────────────────
//
// 2026-10-01 피드백: 부채꼴 고정 배치는 가운데에서 바퀴살만 뻗어 "옵시디언처럼 연결된"
// 느낌이 없다. 그래서 부채꼴 자리를 출발점으로 삼고, 핵심↔짝 스프링(길이 = 엮기 강도) +
// 짝↔짝 스프링(지도 에셋의 교과 간 링크·유사도 이웃) + 서로 밀어내기로 자리를 잡게 한다.
// 핵심은 원점에 고정한다. 노드 수가 적으므로 모든 쌍을 직접 계산한다(O(n²), n ≤ 25).

export interface FusionForceNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** 원점 고정(핵심) 또는 끌기 중 고정 */
  fixed: boolean
  /**
   * 출발 자리(교과 부채꼴). 약하게 이 자리로 당겨 교과별 방향을 유지한다 — 없으면 짝끼리의
   * 그물 선이 서로를 끌어당겨 전체가 핵심의 한쪽으로 쏠린다(2026-10-01 화면에서 확인).
   */
  homeX?: number
  homeY?: number
}

export interface FusionForceLink {
  /** nodes 배열 인덱스 */
  a: number
  b: number
  /** 스프링 자연 길이 */
  rest: number
  /** 스프링 세기 0..1 */
  k: number
}

export interface FusionForceOptions {
  /** 서로 밀어내는 세기 */
  repulsion?: number
  /** 노드 중심 사이 최소 거리 */
  collide?: number
  /** 원점에서 이 거리 밖으로는 나가지 않는다(화면 안에 머물게) */
  bound?: number
  /** 출발 자리로 당기는 세기 */
  home?: number
}

export const FUSION_ALPHA_START = 1
export const FUSION_ALPHA_MIN = 0.02
export const FUSION_ALPHA_DECAY = 0.035

/** 시뮬레이션 한 틱. nodes 를 제자리에서 갱신한다. */
export function fusionForceTick(
  nodes: FusionForceNode[],
  links: readonly FusionForceLink[],
  alpha: number,
  options: FusionForceOptions = {},
): void {
  const repulsion = options.repulsion ?? 2400
  const collide = options.collide ?? 40
  const bound = options.bound ?? Infinity
  const home = options.home ?? 0.15
  const n = nodes.length

  for (const node of nodes) {
    if (node.fixed || node.homeX === undefined || node.homeY === undefined) continue
    node.vx += (node.homeX - node.x) * home * alpha
    node.vy += (node.homeY - node.y) * home * alpha
  }

  for (const link of links) {
    const a = nodes[link.a]
    const b = nodes[link.b]
    if (!a || !b) continue
    let dx = b.x - a.x
    let dy = b.y - a.y
    let d = Math.hypot(dx, dy)
    if (!Number.isFinite(d) || d < 1e-6) {
      dx = 1
      dy = 0
      d = 1
    }
    const f = ((d - link.rest) / d) * link.k * 0.5 * alpha
    if (!a.fixed) {
      a.vx += dx * f
      a.vy += dy * f
    }
    if (!b.fixed) {
      b.vx -= dx * f
      b.vy -= dy * f
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (!Number.isFinite(d2) || d2 < 1e-6) {
        dx = (i % 2 === 0 ? 1 : -1)
        dy = 0.5
        d2 = 1.25
      }
      const d = Math.sqrt(d2)
      const mag = Math.min(8, repulsion / d2) * alpha
      const ux = dx / d
      const uy = dy / d
      if (!a.fixed) {
        a.vx += ux * mag
        a.vy += uy * mag
      }
      if (!b.fixed) {
        b.vx -= ux * mag
        b.vy -= uy * mag
      }
    }
  }

  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx *= 0.6
    node.vy *= 0.6
    node.x += node.vx
    node.y += node.vy
    const r = Math.hypot(node.x, node.y)
    if (r > bound) {
      node.x *= bound / r
      node.y *= bound / r
    }
  }

  // 충돌은 위치를 직접 벌린다(겹침 즉시 해소) — 두어 번 반복해 연쇄 겹침도 푼다
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= collide) continue
        if (d < 1e-6) {
          dx = 1
          dy = 0
          d = 1
        }
        const overlap = (collide - d) / d
        if (a.fixed && b.fixed) continue
        const share = a.fixed || b.fixed ? 1 : 0.5
        if (!a.fixed) {
          a.x -= dx * overlap * share
          a.y -= dy * overlap * share
        }
        if (!b.fixed) {
          b.x += dx * overlap * share
          b.y += dy * overlap * share
        }
      }
    }
  }
}

/** 다음 틱의 alpha — 0 쪽으로 서서히 식는다. */
export function fusionAlphaStep(alpha: number): number {
  return alpha + (0 - alpha) * FUSION_ALPHA_DECAY
}

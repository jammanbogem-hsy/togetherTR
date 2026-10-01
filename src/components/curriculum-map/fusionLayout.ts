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

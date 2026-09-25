// 교육과정 분석맵 — "성좌" 배치 (순수 함수, 외부 의존성 없음).
//
// 목표: 옵시디언 그래프처럼 허브에서 가지가 뻗는 모양이되, 위치의 뜻은 문서 속성으로만 정한다
// (2026-09-23 교사 피드백 "거리가 주관적이다"를 지키면서 표 모양의 딱딱함을 없앤다).
//
//   교과 = 꽃 하나(가운데 허브)
//   영역 = 꽃잎(부채꼴 방향)          → 방향이 곧 영역
//   학년군 = 허브에서의 거리(동심원)   → 안쪽 1-2 · 가운데 3-4 · 바깥 5-6
//   꽃잎 안의 순서 = 성취기준 코드 순
//
// 꽃끼리의 자리는 범례 순서대로 원점에 가깝게 겹치지 않게 붙인다(결정적). 꽃 사이 거리에는
// 뜻이 없으며, 화면 안내문이 그렇게 말한다. 좌표 단위는 에셋 좌표와 같다(렌더러가 K 배).

export interface ConstellationNode {
  id: string
  code: string
  subjectId: string
  band: string
  area: string
}

export interface ConstellationSubject {
  id: string
  name: string
}

export interface ConstellationHub {
  subjectId: string
  label: string
  x: number
  y: number
  /** 허브 원 반지름 */
  r: number
  /** 꽃 전체 반지름(바깥 고리 + 여백) */
  extent: number
}

export interface ConstellationAreaHub {
  subjectId: string
  area: string
  x: number
  y: number
  /** 꽃잎 가운데 방향(라디안) — 라벨 정렬용 */
  angle: number
}

export interface ConstellationRing {
  subjectId: string
  band: string
  cx: number
  cy: number
  r: number
}

/** 가지: 영역 허브 → 성취기준 */
export interface ConstellationBranch {
  subjectId: string
  area: string
  id: string
}

export interface ConstellationGuides {
  hubs: ConstellationHub[]
  areaHubs: ConstellationAreaHub[]
  rings: ConstellationRing[]
  branches: ConstellationBranch[]
}

export interface ConstellationResult {
  positions: Map<string, { x: number; y: number }>
  guides: ConstellationGuides
}

/** 같은 고리 위 이웃 성취기준 사이 호 길이(반지름 12 원 + 여백) */
export const CONST_SPACING = 32
/** 교과 허브 반지름 */
export const CONST_HUB_RADIUS = 30
/** 첫 학년군 고리 반지름 */
export const CONST_FIRST_RING = 118
/** 한 학년군이 넘쳐 고리를 겹칠 때 고리 사이 간격 */
export const CONST_SUBRING_GAP = 30
/** 학년군 고리 사이 간격 */
export const CONST_BAND_GAP = 46
/** 영역 허브가 놓이는 반지름(첫 고리 대비) */
export const CONST_AREA_HUB_RATIO = 0.52
/** 꽃잎 사이 빈 각도(라디안) */
export const CONST_SECTOR_GAP = 0.12
/** 꽃과 꽃 사이 최소 여백 */
export const CONST_FLOWER_GAP = 70

const NO_AREA = '영역 없음'
const TAU = Math.PI * 2

function compareCodes(a: { code: string; id: string }, b: { code: string; id: string }): number {
  const byCode = a.code.localeCompare(b.code, 'ko', { numeric: true })
  if (byCode !== 0) return byCode
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

interface Flower {
  subjectId: string
  label: string
  extent: number
  /** 원점 기준 좌표(꽃 중심 = 0,0) */
  local: Map<string, { x: number; y: number }>
  areaHubs: Array<Omit<ConstellationAreaHub, 'subjectId'>>
  rings: Array<{ band: string; r: number }>
  branches: Array<{ area: string; id: string }>
}

/** 교과 하나를 꽃 모양으로 배치한다(중심 0,0). */
function layoutFlower(subject: ConstellationSubject, nodes: readonly ConstellationNode[], bandOrder: readonly string[]): Flower {
  const byArea = new Map<string, ConstellationNode[]>()
  for (const n of nodes) {
    const area = (n.area ?? '').trim() || NO_AREA
    const list = byArea.get(area)
    if (list) list.push(n)
    else byArea.set(area, [n])
  }
  const areas = [...byArea.entries()]
    .map(([area, list]) => ({ area, list: [...list].sort(compareCodes) }))
    .sort((a, b) => compareCodes(a.list[0], b.list[0]))
  const bands = bandOrder.filter(band => nodes.some(n => n.band === band))

  // 꽃잎 각도: 가장 붐비는 학년군 칸의 개수에 비례
  const weight = (list: ConstellationNode[]): number =>
    Math.max(1, ...bands.map(band => list.filter(n => n.band === band).length))
  const gap = areas.length > 1 ? CONST_SECTOR_GAP : 0
  const usable = TAU - gap * areas.length
  const totalWeight = areas.reduce((sum, a) => sum + weight(a.list), 0)
  let cursor = -Math.PI / 2 - (areas.length > 1 ? 0 : 0)
  const sectors = areas.map(a => {
    const span = (usable * weight(a.list)) / totalWeight
    const start = cursor + gap / 2
    cursor += span + gap
    return { ...a, start, span }
  })

  const local = new Map<string, { x: number; y: number }>()
  const rings: Flower['rings'] = []
  let radius = CONST_FIRST_RING
  for (const band of bands) {
    let deepest = 1
    for (const sector of sectors) {
      const items = sector.list.filter(n => n.band === band)
      let placed = 0
      let sub = 0
      while (placed < items.length) {
        const rho = radius + sub * CONST_SUBRING_GAP
        const capacity = Math.max(1, Math.floor((rho * sector.span) / CONST_SPACING))
        const take = Math.min(capacity, items.length - placed)
        for (let i = 0; i < take; i++) {
          const angle = sector.start + (sector.span * (i + 0.5)) / take
          local.set(items[placed + i].id, { x: Math.cos(angle) * rho, y: Math.sin(angle) * rho })
        }
        placed += take
        sub += 1
      }
      deepest = Math.max(deepest, sub)
    }
    rings.push({ band, r: radius + ((deepest - 1) * CONST_SUBRING_GAP) / 2 })
    radius += (deepest - 1) * CONST_SUBRING_GAP + CONST_BAND_GAP
  }
  const outer = radius - CONST_BAND_GAP

  const hubRadius = CONST_FIRST_RING * CONST_AREA_HUB_RATIO
  const areaHubs = sectors.map(s => {
    const angle = s.start + s.span / 2
    return { area: s.area, angle, x: Math.cos(angle) * hubRadius, y: Math.sin(angle) * hubRadius }
  })
  const branches = sectors.flatMap(s => s.list.map(n => ({ area: s.area, id: n.id })))

  return {
    subjectId: subject.id,
    label: subject.name,
    extent: outer + CONST_SPACING,
    local,
    areaHubs,
    rings,
    branches,
  }
}

/**
 * 꽃을 범례 순서대로 원점 가까이 붙인다. 각 꽃은 이미 놓인 꽃들과 겹치지 않는 자리 중
 * 원점에서 가장 가까운 곳을 고른다(거리 20, 각도 7.5° 단위 탐색 — 결정적).
 */
function packFlowers(flowers: readonly Flower[]): Array<{ x: number; y: number }> {
  const placed: Array<{ x: number; y: number; r: number }> = []
  const centers: Array<{ x: number; y: number }> = []
  for (const f of flowers) {
    let best: { x: number; y: number } | null = null
    if (placed.length === 0) best = { x: 0, y: 0 }
    for (let d = 0; !best && d < 100_000; d += 20) {
      const steps = d === 0 ? 1 : 48
      for (let k = 0; k < steps; k++) {
        const a = (TAU * k) / steps
        const x = Math.cos(a) * d
        const y = Math.sin(a) * d
        if (placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + f.extent + CONST_FLOWER_GAP)) {
          best = { x, y }
          break
        }
      }
    }
    const c = best ?? { x: 0, y: 0 }
    placed.push({ ...c, r: f.extent })
    centers.push(c)
  }
  return centers
}

export function computeConstellationLayout(
  nodes: readonly ConstellationNode[],
  subjects: readonly ConstellationSubject[],
  bands: readonly string[],
): ConstellationResult {
  const subjectOrder = [...subjects]
  for (const n of nodes) {
    if (!subjectOrder.some(s => s.id === n.subjectId)) subjectOrder.push({ id: n.subjectId, name: n.subjectId })
  }
  const bandOrder = [...bands]
  for (const n of nodes) if (!bandOrder.includes(n.band)) bandOrder.push(n.band)

  const flowers = subjectOrder
    .map(s => ({ s, list: nodes.filter(n => n.subjectId === s.id) }))
    .filter(entry => entry.list.length > 0)
    .map(entry => layoutFlower(entry.s, entry.list, bandOrder))
  const centers = packFlowers(flowers)

  const positions = new Map<string, { x: number; y: number }>()
  const guides: ConstellationGuides = { hubs: [], areaHubs: [], rings: [], branches: [] }
  flowers.forEach((f, i) => {
    const c = centers[i]
    for (const [id, p] of f.local) positions.set(id, { x: c.x + p.x, y: c.y + p.y })
    guides.hubs.push({ subjectId: f.subjectId, label: f.label, x: c.x, y: c.y, r: CONST_HUB_RADIUS, extent: f.extent })
    for (const h of f.areaHubs) guides.areaHubs.push({ subjectId: f.subjectId, area: h.area, angle: h.angle, x: c.x + h.x, y: c.y + h.y })
    for (const r of f.rings) guides.rings.push({ subjectId: f.subjectId, band: r.band, cx: c.x, cy: c.y, r: r.r })
    for (const b of f.branches) guides.branches.push({ subjectId: f.subjectId, area: b.area, id: b.id })
  })
  return { positions, guides }
}

/** 렌더러의 K 배를 안내 요소에도 똑같이 곱한다. */
export function scaleConstellationGuides(guides: ConstellationGuides, k: number): ConstellationGuides {
  return {
    hubs: guides.hubs.map(h => ({ ...h, x: h.x * k, y: h.y * k, r: h.r * k, extent: h.extent * k })),
    areaHubs: guides.areaHubs.map(h => ({ ...h, x: h.x * k, y: h.y * k })),
    rings: guides.rings.map(r => ({ ...r, cx: r.cx * k, cy: r.cy * k, r: r.r * k })),
    branches: guides.branches,
  }
}

// ─── 로컬 그래프(선택 시) ───────────────────────────────────────────────────

/** 로컬 그래프 반지름: 관계 강도 1 → LOCAL_MIN, 0 → LOCAL_MIN + LOCAL_RANGE */
export const LOCAL_MIN_RADIUS = 80
export const LOCAL_RADIUS_RANGE = 220

/** 강도 → 로컬 그래프 반지름(에셋 단위). 거리가 곧 판정 수치다. */
export function localRadiusForStrength(strength: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0))
  return LOCAL_MIN_RADIUS + (1 - s) * LOCAL_RADIUS_RANGE
}

/** 눈금 고리 — 관계 등급 경계(levelForScore 와 같은 기준) */
export const LOCAL_RINGS: ReadonlyArray<{ strength: number; label: string }> = [
  { strength: 0.75, label: '핵심' },
  { strength: 0.5, label: '관련' },
  { strength: 0.25, label: '약함' },
]

/**
 * 선택한 성취기준을 가운데 두고 관련 성취기준을 둥글게 놓는다(옵시디언 로컬 그래프).
 * 반지름 = 관계 강도, 각도 = 관계 유형별로 묶은 순서. 좌표는 center 기준 절대 좌표.
 */
export function computeLocalLayout(
  center: { x: number; y: number },
  related: ReadonlyArray<{ id: string; relationType: string; strength: number }>,
  scale: number = 1,
): Map<string, { x: number; y: number }> {
  const ordered = [...related].sort((a, b) =>
    a.relationType.localeCompare(b.relationType, 'ko') || b.strength - a.strength || (a.id < b.id ? -1 : 1))
  const out = new Map<string, { x: number; y: number }>()
  const n = ordered.length
  ordered.forEach((item, i) => {
    // 반 칸 돌려 12시 방향을 비운다 — 그 자리에 눈금 고리 이름이 들어간다
    const angle = -Math.PI / 2 + (TAU * (i + 0.5)) / Math.max(1, n)
    const r = localRadiusForStrength(item.strength) * scale
    out.set(item.id, { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r })
  })
  return out
}

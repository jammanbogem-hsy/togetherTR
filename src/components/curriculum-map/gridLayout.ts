// 교육과정 분석맵 — "정렬 배치" 좌표 계산 (순수 함수, 외부 의존성 없음).
//
// 왜 필요한가(2026-09-23 교사 피드백): "성취기준이 떨어져 있는 거리가 주관적이다".
// 유사도 지도는 임베딩 유사도 + 힘 시뮬레이션 + 과목 인력 + 충돌 해소가 섞인 결과라
// 두 원 사이의 거리를 어떤 수치로도 읽을 수 없다. 정렬 배치는 위치를 문서에 적힌
// 속성으로만 정한다:
//   행 = 교과(범례 순서) · 열 = 학년군 · 칸 안 = 영역 묶음 → 코드 순서
// 그래서 같은 입력이면 누구에게나 같은 자리이고, "가깝다"는 말은 "같은 교과·학년군·
// 영역이고 코드가 이웃한다"는 뜻뿐이다. 성취기준 사이의 관계는 거리 대신 선
// (/related 판정)과 패널의 수치로만 보여 준다.
//
// 좌표 단위는 에셋 좌표와 같다(렌더러가 K 배를 곱한다). 모든 노드의 반지름이 같으므로
// 격자 간격만 지키면 겹침이 생기지 않는다.

export interface GridLayoutNode {
  id: string
  code: string
  subjectId: string
  band: string
  area: string
}

export interface GridSubject {
  id: string
  name: string
}

export interface GridRowGuide {
  subjectId: string
  label: string
  y0: number
  y1: number
}

export interface GridColumnGuide {
  band: string
  x0: number
  x1: number
}

export interface GridCellGuide {
  subjectId: string
  band: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface GridAreaGuide {
  subjectId: string
  band: string
  area: string
  /** 라벨 왼쪽 위 기준점 */
  x: number
  y: number
}

export interface GridGuides {
  rows: GridRowGuide[]
  columns: GridColumnGuide[]
  cells: GridCellGuide[]
  areas: GridAreaGuide[]
}

export interface GridLayoutResult {
  positions: Map<string, { x: number; y: number }>
  guides: GridGuides
}

/** 노드 중심 사이 가로 간격 — 반지름 12 × 2 + 여백. 코드 라벨이 이웃과 덜 부딪치게 넓게 둔다. */
export const GRID_PITCH_X = 40
/** 세로 간격 — 원 아래 코드 라벨 자리를 포함한다. */
export const GRID_PITCH_Y = 40
/** 칸 한 줄에 놓는 성취기준 수. 가장 큰 칸(과학 51개)이 7줄 안팎이 되게 한다. */
export const GRID_COLUMNS_PER_CELL = 8
/** 칸 안쪽 여백 */
export const GRID_CELL_PADDING = 24
/** 영역 라벨 줄 높이 */
export const GRID_AREA_LABEL_HEIGHT = 22
/** 같은 칸 안 영역 묶음 사이 여백 */
export const GRID_AREA_GAP = 10
/** 칸 사이 간격(가로·세로) */
export const GRID_GUTTER = 28

const NO_AREA = '영역 없음'

/**
 * 성취기준 코드 자연 정렬 — '[4사01-02]' < '[4사01-10]'. 숫자를 수로 비교한다.
 * 코드가 같으면 id 로 가른다(결정성).
 */
export function compareStandardCodes(a: { code: string; id: string }, b: { code: string; id: string }): number {
  const byCode = a.code.localeCompare(b.code, 'ko', { numeric: true })
  if (byCode !== 0) return byCode
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 교과 × 학년군 격자 배치. 행 높이는 그 교과에서 가장 큰 칸, 열 너비는 모두 같다.
 * 비어 있는 칸(예: 과학 1-2학년군)도 자리는 남겨 행·열이 어긋나지 않게 한다.
 */
export function computeGridLayout(
  nodes: readonly GridLayoutNode[],
  subjects: readonly GridSubject[],
  bands: readonly string[],
): GridLayoutResult {
  const positions = new Map<string, { x: number; y: number }>()
  const rows: GridRowGuide[] = []
  const cells: GridCellGuide[] = []
  const areas: GridAreaGuide[] = []

  // 에셋의 교과·학년군 목록에 없는 값도 버리지 않는다 — 끝에 덧붙인다.
  const subjectOrder = [...subjects]
  for (const n of nodes) {
    if (!subjectOrder.some(s => s.id === n.subjectId)) subjectOrder.push({ id: n.subjectId, name: n.subjectId })
  }
  const bandOrder = [...bands]
  for (const n of nodes) {
    if (!bandOrder.includes(n.band)) bandOrder.push(n.band)
  }

  const cellWidth = GRID_CELL_PADDING * 2 + (GRID_COLUMNS_PER_CELL - 1) * GRID_PITCH_X
  const columns: GridColumnGuide[] = bandOrder.map((band, i) => {
    const x0 = i * (cellWidth + GRID_GUTTER)
    return { band, x0, x1: x0 + cellWidth }
  })

  // (교과, 학년군) → 영역 묶음(영역 안은 코드 순, 영역끼리는 첫 코드 순)
  const cellKey = (subjectId: string, band: string): string => `${subjectId}\u0000${band}`
  const grouped = new Map<string, Map<string, GridLayoutNode[]>>()
  for (const n of nodes) {
    const key = cellKey(n.subjectId, n.band)
    let byArea = grouped.get(key)
    if (!byArea) {
      byArea = new Map()
      grouped.set(key, byArea)
    }
    const area = (n.area ?? '').trim() || NO_AREA
    const list = byArea.get(area)
    if (list) list.push(n)
    else byArea.set(area, [n])
  }

  const cellContentHeight = (byArea: Map<string, GridLayoutNode[]> | undefined): number => {
    if (!byArea || byArea.size === 0) return 0
    let h = 0
    for (const list of byArea.values()) {
      h += GRID_AREA_LABEL_HEIGHT + Math.ceil(list.length / GRID_COLUMNS_PER_CELL) * GRID_PITCH_Y
    }
    return h + (byArea.size - 1) * GRID_AREA_GAP
  }

  let y = 0
  for (const subject of subjectOrder) {
    const rowCells = bandOrder.map(band => grouped.get(cellKey(subject.id, band)))
    if (rowCells.every(c => !c || c.size === 0)) continue
    const rowHeight = GRID_CELL_PADDING * 2 + Math.max(...rowCells.map(cellContentHeight))
    rows.push({ subjectId: subject.id, label: subject.name, y0: y, y1: y + rowHeight })

    bandOrder.forEach((band, bandIndex) => {
      const byArea = rowCells[bandIndex]
      const col = columns[bandIndex]
      if (!byArea || byArea.size === 0) return
      cells.push({ subjectId: subject.id, band, x0: col.x0, y0: y, x1: col.x1, y1: y + rowHeight })
      const groups = [...byArea.entries()]
        .map(([area, list]) => [area, [...list].sort(compareStandardCodes)] as const)
        .sort((a, b) => compareStandardCodes(a[1][0], b[1][0]))
      let cursor = y + GRID_CELL_PADDING
      for (const [area, list] of groups) {
        areas.push({ subjectId: subject.id, band, area, x: col.x0 + GRID_CELL_PADDING - 12, y: cursor })
        cursor += GRID_AREA_LABEL_HEIGHT
        list.forEach((n, i) => {
          positions.set(n.id, {
            x: col.x0 + GRID_CELL_PADDING + (i % GRID_COLUMNS_PER_CELL) * GRID_PITCH_X,
            y: cursor + GRID_PITCH_Y / 2 + Math.floor(i / GRID_COLUMNS_PER_CELL) * GRID_PITCH_Y,
          })
        })
        cursor += Math.ceil(list.length / GRID_COLUMNS_PER_CELL) * GRID_PITCH_Y + GRID_AREA_GAP
      }
    })
    y += rowHeight + GRID_GUTTER
  }

  return { positions, guides: { rows, columns, cells, areas } }
}

/** 렌더러의 가독성 배수 K 를 안내선에도 똑같이 곱한다(노드 좌표와 어긋나지 않게). */
export function scaleGridGuides(guides: GridGuides, k: number): GridGuides {
  return {
    rows: guides.rows.map(r => ({ ...r, y0: r.y0 * k, y1: r.y1 * k })),
    columns: guides.columns.map(c => ({ ...c, x0: c.x0 * k, x1: c.x1 * k })),
    cells: guides.cells.map(c => ({ ...c, x0: c.x0 * k, y0: c.y0 * k, x1: c.x1 * k, y1: c.y1 * k })),
    areas: guides.areas.map(a => ({ ...a, x: a.x * k, y: a.y * k })),
  }
}

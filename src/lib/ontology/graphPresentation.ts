import { STAGES } from '@/types'
import { STAGE_COLOR } from '@/lib/ui/stageColors'
import type { OntologyEdge, OntologyGraph, OntologyNode } from './projectOntology'

/** 표시 좌표만 변경한다. 활동 ID·교육적 관계·저장 데이터는 유지한다. */
export const GRAPH_LAYOUT = {
  column: 276, firstColumn: 158, firstRow: 150, row: 124,
  cardWidth: 228, cardHeight: 104, headerY: 24, headerHeight: 60,
} as const

export function stagePalette(stage: OntologyNode['stage']) {
  const color = STAGE_COLOR[stage]
  return {
    accent: color.hex,
    surface: color.light.match(/#[\da-f]+/i)?.[0] ?? color.hex,
    text: color.doneText.match(/#[\da-f]+/i)?.[0] ?? color.hex,
    border: color.border.match(/#[\da-f]+/i)?.[0] ?? color.hex,
  }
}

export function presentOntology(graph: OntologyGraph) {
  const nodes = graph.nodes.map(node => ({
    ...node,
    x: GRAPH_LAYOUT.firstColumn + node.stageIdx * GRAPH_LAYOUT.column,
    y: GRAPH_LAYOUT.firstRow + node.slot * GRAPH_LAYOUT.row,
  }))
  const bottom = Math.max(GRAPH_LAYOUT.firstRow, ...nodes.map(node => node.y)) + GRAPH_LAYOUT.cardHeight / 2
  return { nodes, width: GRAPH_LAYOUT.firstColumn * 2 + (STAGES.length - 1) * GRAPH_LAYOUT.column, height: bottom + 86 }
}

/** 활동명을 생략하지 않고 한글·영문 문자 폭에 맞춰 줄을 나눈다. */
export function wrapActivityLabel(label: string, maxUnits = 26): string[] {
  const lines: string[] = []
  const measure = (text: string) => Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0)
  let line = ''
  for (const word of label.match(/\([^)]*\)|\S+/g) ?? []) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxUnits) { line = candidate; continue }
    if (line) { lines.push(line); line = '' }
    for (const char of word) {
      if (measure(line + char) > maxUnits && line) { lines.push(line); line = '' }
      line += char
    }
  }
  if (line) lines.push(line)
  return lines
}

export function visibleOntologyEdges(edges: OntologyEdge[], focusedId: string | null, showAll: boolean) {
  return edges.filter(edge => showAll || edge.kind === 'sequential' || edge.kind === 'stage' || edge.kind === 'cycle'
    || (focusedId !== null && (edge.source === focusedId || edge.target === focusedId)))
}

/** 직선 구간 사이를 작은 곡선으로 연결해 노드 바깥 여백으로 우회한다. */
function roundedRoute(points: { x: number; y: number }[]): string {
  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], corner = points[i], after = points[i + 1]
    const a = Math.hypot(corner.x - before.x, corner.y - before.y)
    const b = Math.hypot(after.x - corner.x, after.y - corner.y)
    const radius = Math.min(16, a / 2, b / 2)
    if (!a || !b) continue
    const enter = { x: corner.x + (before.x - corner.x) * radius / a, y: corner.y + (before.y - corner.y) * radius / a }
    const leave = { x: corner.x + (after.x - corner.x) * radius / b, y: corner.y + (after.y - corner.y) * radius / b }
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`
  }
  const last = points[points.length - 1]
  return `${path} L ${last.x} ${last.y}`
}

export function ontologyEdgePath(edge: OntologyEdge, source: OntologyNode, target: OntologyNode, height: number): string {
  const halfWidth = GRAPH_LAYOUT.cardWidth / 2, halfHeight = GRAPH_LAYOUT.cardHeight / 2
  if (edge.kind === 'sequential') return `M ${source.x} ${source.y + halfHeight} L ${target.x} ${target.y - halfHeight}`
  if (edge.kind === 'cycle') {
    return roundedRoute([
      { x: source.x + halfWidth, y: source.y }, { x: source.x + halfWidth + 24, y: source.y },
      { x: source.x + halfWidth + 24, y: height - 30 }, { x: target.x - halfWidth - 24, y: height - 30 },
      { x: target.x - halfWidth - 24, y: target.y }, { x: target.x - halfWidth, y: target.y },
    ])
  }
  if (source.stageIdx === target.stageIdx) {
    const x = source.x + halfWidth
    return `M ${x} ${source.y} C ${x + 28} ${source.y}, ${x + 28} ${target.y}, ${x} ${target.y}`
  }
  const direction = target.x > source.x ? 1 : -1
  const start = { x: source.x + direction * halfWidth, y: source.y }
  const end = { x: target.x - direction * halfWidth, y: target.y }
  if (Math.abs(source.stageIdx - target.stageIdx) === 1) {
    const mid = (start.x + end.x) / 2
    return `M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}`
  }
  // 멀리 떨어진 단계의 개념 연결은 중간 활동 카드를 가로지르지 않는다.
  const sourceX = start.x + direction * 18, targetX = end.x - direction * 18
  const channelY = height - 58 - (source.slot % 3) * 4
  return roundedRoute([start, { x: sourceX, y: start.y }, { x: sourceX, y: channelY },
    { x: targetX, y: channelY }, { x: targetX, y: end.y }, end])
}

import type { GEdge, GraphRelationAnalysis } from './types'
import { hasCompletedRelationAnalysis, normalizedEdgeWeight, RELATION_COLORS } from './constants'

interface Point { x: number; y: number }

/** 원 둘레에 맞춘 무방향 연결선. 겹친 노드는 선을 뒤집어 그리지 않는다. */
export function graphEdgeSegment(source: Point, target: Point, sourceRadius: number, targetRadius: number) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.hypot(dx, dy)
  const start = sourceRadius + 4
  const end = targetRadius + 4
  if (!Number.isFinite(distance) || distance <= start + end) return null
  return {
    x1: source.x + dx / distance * start,
    y1: source.y + dy / distance * start,
    x2: target.x - dx / distance * end,
    y2: target.y - dy / distance * end,
    length: distance - start - end,
  }
}

/** 단순 유사도와 분석 완료된 관계를 구별한다. source/target은 방향을 뜻하지 않는다. */
export function graphEdgeAppearance(
  edge: GEdge, analysis: GraphRelationAnalysis | undefined, hasFocus: boolean, touchesFocus: boolean,
) {
  const completed = hasCompletedRelationAnalysis(analysis)
  const analyzed = completed || Boolean(edge.explanation?.trim())
  const relation = completed ? analysis.relationType : edge.relation
  const strength = normalizedEdgeWeight(completed ? analysis.score : edge.weight)
  return {
    analyzed,
    color: analyzed ? (RELATION_COLORS[relation] ?? '#747775') : '#94A3B8',
    width: (analyzed ? 1.5 + strength * 2 : 1.2) + (touchesFocus ? 1 : 0),
    opacity: hasFocus && !touchesFocus ? 0.12 : touchesFocus ? 0.95 : analyzed ? 0.85 : 0.45,
    dash: analyzed ? undefined : '5 5',
    label: analyzed ? relation : '관계 추정',
  }
}

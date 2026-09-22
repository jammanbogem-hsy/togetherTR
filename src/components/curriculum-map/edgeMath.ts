// 교육과정 분석맵 — 연결선 강조 규칙.
//
// 규칙(중요): 선택만으로는 에셋 엣지를 절대 강조하지 않는다.
//  - 색 있는 선  = /related 가 판정한 Jev 관계뿐 (합성 선이라 여기서 다루지 않는다)
//  - 회색 진한 선 = 호버 중일 때만 (그 노드의 이웃은 모두 밝게 표시된다)
//  - 그 외       = 모두 같은 흐린 배경선 (선택 노드의 엣지도 예외가 아니다)
// 선택 노드에서만 진한 회색 선이 뻗어 나가면, 흐린 노드로 향하는 그 선이
// Jev 관계처럼 보여 사용자가 목록과 화면을 다르게 읽는다(실제 혼란이었다).

/** 흐리게 처리한 요소의 알파 */
export const DIMMED_ALPHA = 0.15

export function edgeAlpha(sim: number): number {
  const s = Number.isFinite(sim) ? Math.min(1, Math.max(0, sim)) : 0
  return Math.min(0.4, Math.max(0.06, 0.06 + s * 0.34))
}

/** 엣지 선 굵기 — 유사도에 따라 1.2~2.5px. */
export function edgeWidth(sim: number): number {
  const s = Number.isFinite(sim) ? Math.min(1, Math.max(0, sim)) : 0
  return 1.2 + s * 1.3
}

export type EdgeEmphasis = 'hover' | 'background'

export interface EdgeEmphasisContext {
  /** 호버(또는 패널 카드 호버) 대상 */
  focusId: string | null
  selectedId: string | null
  /** /related 응답 대기 중 */
  relatedPending: boolean
}

/**
 * 에셋 엣지의 강조 단계. 호버만 'hover' 가 되고, 선택 상태(대기 중이든 완료든)는
 * 절대 영향을 주지 않는다 — 선택 노드의 엣지도 남들과 같은 배경선이다.
 */
export function edgeEmphasis(
  edge: { source: string; target: string },
  ctx: EdgeEmphasisContext,
): EdgeEmphasis {
  if (ctx.focusId !== null && (edge.source === ctx.focusId || edge.target === ctx.focusId)) {
    return 'hover'
  }
  return 'background'
}

export interface EdgeDimContext {
  focusId: string | null
  searchActive: boolean
  selectedId: string | null
}

/** 배경선 전체에 곱하는 흐림 계수. 특정 엣지만 따로 진하게 하지 않는다. */
export function edgeDimFactor(ctx: EdgeDimContext): number {
  if (ctx.focusId !== null) return DIMMED_ALPHA
  if (ctx.searchActive) return 0.45
  if (ctx.selectedId !== null) return 0.4
  return 1
}

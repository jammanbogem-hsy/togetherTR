// 문제상황 워크숍 화면 상태 판정 (순수 함수 — 단위 테스트 대상).
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'
import type { DetailPart, ProblemCandidateDetail } from './generation'

/** scenario 조각이 성취기준 연결 없이 왔는지 — 생성 응답이 비거나 잘린 일시 현상으로 보고 재요청한다. */
export function isEmptyScenarioDetail(part: DetailPart, detail: Partial<ProblemCandidateDetail> | null | undefined): boolean {
  return part === 'scenario' && !(detail?.standardsAlignment?.length)
}

/** 중심 노드나 선택 성취기준이 있는 그래프만 유효. 비워진 그래프는 null로 돌려 대체 목록이 보이게 한다. */
export function usableGraphData(graph: GraphSavedData | null | undefined): GraphSavedData | null {
  if (!graph) return null
  const hasCenter = graph.centerNode != null
  const hasStandards = Array.isArray(graph.selectedStandards) && graph.selectedStandards.length > 0
  return hasCenter || hasStandards ? graph : null
}

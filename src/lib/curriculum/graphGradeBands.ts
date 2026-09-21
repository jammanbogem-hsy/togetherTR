import type { GraphSavedData } from '@/lib/knowledge-graph/domain'
import { gradeBandFromStandardCode, toGradeBandLabel } from './sheetGradeBands'

/** Unknown or mismatched records never become evidence for an elementary grade band. */
export function standardBelongsToBand(standard: { code?: string; grade_band?: string }, band?: string): boolean {
  const target = toGradeBandLabel(band)
  if (!target) return !band
  const codeBand = gradeBandFromStandardCode(standard.code)
  const storedBand = toGradeBandLabel(standard.grade_band)
  return (codeBand || storedBand) === target && (!codeBand || !storedBand || codeBand === storedBand)
}

export function filterGraphToGradeBand(
  data: GraphSavedData,
  band: string,
  standards: Array<{ id: string; code: string; grade_band?: string }>,
): GraphSavedData {
  const byId = new Map(standards.map(standard => [standard.id, standard]))
  const matches = (id: string) => {
    const standard = byId.get(id)
    return !!standard && standardBelongsToBand(standard, band)
  }
  const centerNode = data.centerNode && matches(data.centerNode.id) ? data.centerNode : null
  const selectedStandards = data.selectedStandards.filter(standard => matches(standard.id))
  const ids = new Set([centerNode?.id, ...selectedStandards.map(standard => standard.id)])
  return { ...data, centerNode, selectedStandards, agentNotes: data.agentNotes.filter(note => ids.has(note.standardId)) }
}

export const GRAPH_RELATION_TYPES = [
  '의미연결',
  '도구-활용',
  '현상-가치',
  '내용-표현',
  '개념-적용',
  '문제-해결',
  '탐구-실천',
  '원인-결과',
] as const

export type GraphRelationType = (typeof GRAPH_RELATION_TYPES)[number]
export type GraphRelationFilter = 'all' | GraphRelationType

export const DEFAULT_GRAPH_RELATION_TYPE: GraphRelationType = '의미연결'

const LEGACY_RELATION_ALIASES: Record<string, GraphRelationType> = {
  '의미-연결': '의미연결',
}

export function normalizeGraphRelationType(value?: string | null): GraphRelationType | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const aliased = LEGACY_RELATION_ALIASES[trimmed]
  if (aliased) return aliased

  return GRAPH_RELATION_TYPES.find(relation => relation === trimmed || trimmed.includes(relation))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function toStoredGraphScore(score?: number | null): number | undefined {
  if (score === undefined || score === null || Number.isNaN(score)) return undefined
  const normalized = score <= 1 ? score * 100 : score
  return Math.round(clamp(normalized, 0, 100))
}

export function toUnitGraphScore(score?: number | null): number | undefined {
  if (score === undefined || score === null || Number.isNaN(score)) return undefined
  const normalized = score > 1 ? score / 100 : score
  return clamp(normalized, 0, 1)
}

export interface GraphCenterNode {
  id: string
  label: string
  subjectId: string
  text: string
}

export interface GraphSelectedStandard {
  id: string
  label: string
  subjectId: string
  text: string
  relationType?: GraphRelationType
  score?: number // persisted as 0..100
}

export interface GraphAgentNote {
  standardId: string
  explanation: string
  ideas?: string[]
  teachingNote?: string
}

export interface GraphPinnedStandard {
  stdId: string
  addedBy: string
  addedByUid?: string
  source?: 'chat' | 'manual'
}

export interface GraphSelectionState {
  pinnedStandards: GraphPinnedStandard[]
  checkedStandardIds: string[]
  updatedByUid?: string | null
  updatedAt?: number
}

export interface GraphSavedData {
  centerNode: GraphCenterNode | null
  selectedStandards: GraphSelectedStandard[]
  agentNotes: GraphAgentNote[]
  savedAt?: number
}

export function normalizeGraphPinnedStandards(pins: GraphPinnedStandard[]): GraphPinnedStandard[] {
  const seen = new Set<string>()
  const normalized: GraphPinnedStandard[] = []

  for (const pin of pins) {
    const stdId = pin.stdId?.trim()
    if (!stdId || seen.has(stdId)) continue
    seen.add(stdId)
    normalized.push({
      stdId,
      addedBy: pin.addedBy?.trim() || '알 수 없음',
      ...(pin.addedByUid ? { addedByUid: pin.addedByUid } : {}),
      ...(pin.source ? { source: pin.source } : {}),
    })
  }

  return normalized
}

export function normalizeGraphSelectionState<T extends GraphSelectionState | null | undefined>(data: T): T {
  if (!data) return data

  const checkedStandardIds = [...new Set(
    data.checkedStandardIds
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id))
  )]

  return {
    ...data,
    pinnedStandards: normalizeGraphPinnedStandards(data.pinnedStandards ?? []),
    checkedStandardIds,
  } as T
}

export function normalizeGraphSavedData<T extends GraphSavedData | null | undefined>(data: T): T {
  if (!data) return data

  return {
    ...data,
    selectedStandards: data.selectedStandards.map((standard) => {
      const relationType = normalizeGraphRelationType(standard.relationType)
      const score = toStoredGraphScore(standard.score)
      return {
        id: standard.id,
        label: standard.label,
        subjectId: standard.subjectId,
        text: standard.text,
        ...(relationType ? { relationType } : {}),
        ...(score !== undefined ? { score } : {}),
      }
    }),
  } as T
}

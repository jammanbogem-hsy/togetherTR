/**
 * 그래프 핵심아이디어 문장 중복 정리.
 *
 * 그래프 빌더가 2022 사회과 '인문환경과 인간생활' 문장 4개를 5-6학년군의 두 노드
 * (`cig_soc_elem56_environment` [자연·인문환경과 인간생활], `cig_soc_elem56_global`
 * [인문환경·지속가능한 세계])에 모두 붙여 놓았다(2026-09-20 확인). 그대로 두면
 * 분석 시트 후보 목록에 같은 문장이 두 번 보이고, Jev Choice 확률이 반으로 갈려
 * confidence·게이트가 오판된다.
 *
 * 규칙: 같은 교과·같은 학년군 안에서 완전한 문장(isUsableCoreIdea)이 여러 노드에
 * 있으면, 그 학년군 성취기준을 가장 많이 가진 노드에만 남긴다(동률이면 배열 순서).
 * 어휘 목록·[별표] 같은 잡음 항목은 런타임 필터가 걸러내므로 건드리지 않는다.
 *
 * graphReader.loadGraph()(런타임)와 scripts/sanitize-knowledge-graph.mjs(파일)가
 * 같은 함수를 쓰고, scripts/verify-curriculum-linkage.mjs D8 이 파일 상태를 검증한다.
 */

import { isUsableCoreIdea } from '@/lib/curriculum/curriculumFilters'

interface CoreIdeaNodeLike {
  id: string
  subject_id: string
  ideas: string[]
}

interface StandardLike {
  core_idea_id?: string
  grade_band: string
}

interface GraphLike {
  coreIdeas: CoreIdeaNodeLike[]
  achievementStandards: StandardLike[]
}

export interface CoreIdeaDuplicate {
  subjectId: string
  band: string
  idea: string
  keptNodeId: string
  removedNodeIds: string[]
}

function normalizeSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** 노드별 { 학년군 → 성취기준 수 } */
function bandCountsByNode(graph: GraphLike): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>()
  for (const std of graph.achievementStandards) {
    if (!std.core_idea_id) continue
    if (!counts.has(std.core_idea_id)) counts.set(std.core_idea_id, new Map())
    const perBand = counts.get(std.core_idea_id)!
    perBand.set(std.grade_band, (perBand.get(std.grade_band) ?? 0) + 1)
  }
  return counts
}

/** 중복 목록만 계산한다(변경 없음). 검증 스크립트가 쓴다. */
export function findDuplicateCoreIdeaSentences(graph: GraphLike): CoreIdeaDuplicate[] {
  const counts = bandCountsByNode(graph)
  // key: subject|band|sentence → 후보 노드들(배열 순서 유지)
  const owners = new Map<string, Array<{ nodeId: string; standards: number; order: number }>>()
  graph.coreIdeas.forEach((node, order) => {
    const perBand = counts.get(node.id)
    if (!perBand) return
    for (const [band, standards] of perBand) {
      for (const idea of node.ideas) {
        if (!isUsableCoreIdea(idea)) continue
        const key = `${node.subject_id}|${band}|${normalizeSentence(idea)}`
        if (!owners.has(key)) owners.set(key, [])
        const list = owners.get(key)!
        if (!list.some(item => item.nodeId === node.id)) list.push({ nodeId: node.id, standards, order })
      }
    }
  })
  const duplicates: CoreIdeaDuplicate[] = []
  for (const [key, list] of owners) {
    if (list.length < 2) continue
    const [subjectId, band, idea] = key.split('|')
    const keeper = [...list].sort((a, b) => b.standards - a.standards || a.order - b.order)[0]
    duplicates.push({
      subjectId,
      band,
      idea,
      keptNodeId: keeper.nodeId,
      removedNodeIds: list.filter(item => item.nodeId !== keeper.nodeId).map(item => item.nodeId),
    })
  }
  return duplicates
}

/** 그래프 객체를 제자리에서 정리하고, 정리한 중복 목록을 돌려준다. */
export function dedupeCoreIdeaSentences(graph: GraphLike): CoreIdeaDuplicate[] {
  const duplicates = findDuplicateCoreIdeaSentences(graph)
  if (duplicates.length === 0) return duplicates
  const removals = new Map<string, Set<string>>()
  for (const dup of duplicates) {
    for (const nodeId of dup.removedNodeIds) {
      if (!removals.has(nodeId)) removals.set(nodeId, new Set())
      removals.get(nodeId)!.add(dup.idea)
    }
  }
  for (const node of graph.coreIdeas) {
    const drop = removals.get(node.id)
    if (!drop) continue
    node.ideas = node.ideas.filter(idea => !drop.has(normalizeSentence(idea)))
  }
  return duplicates
}

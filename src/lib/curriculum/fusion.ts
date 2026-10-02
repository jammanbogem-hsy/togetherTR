// 교육과정 분석맵 — "융합 찾기" 순수 헬퍼 (외부 의존성 없음).
//
// 왜 필요한가(2026-10-01 교사 피드백): "유사도는 찾아서 어떻게 써야 할지 모르겠다.
// 융합할 수 있는 성취기준끼리 묶어 주는 게 더 의미 있다." 그래서 주제 검색 결과에서
// 융합 수업의 중심(핵심)이 될 성취기준을 하나 추천하고, 그것을 중심으로 같은 학년군의
// 다른 교과 성취기준만 모아 보여 준다.
//
// 핵심 추천 점수 = 0.6 × 주제 관련도(Jev) + 0.4 × 다리 놓기(같은 학년군에서 주제에 닿는
// 다른 교과를 몇 개나 끌어오는가, 3교과면 만점). "주제에 가장 가깝고, 다른 교과를 가장
// 많이 엮을 수 있는 성취기준"이 핵심이다.
//
// 실측(2026-10-01, v1 임베딩): 무작위 다른 교과 쌍의 코사인 p50 0.23 · p90 0.34 ·
// p97 0.38 · p99 0.42 → 0.40 이상이면 우연보다 확실히 가깝다고 본다. 교육과정이 직접
// 이은 교과 간 링크는 코사인과 무관하게 짝으로 인정한다.
// 학년군을 넘는 짝은 세지 않는다 — 한 학급의 한 수업으로 엮을 수 없기 때문이다.

/** 다른 교과 짝으로 인정하는 v1 코사인 하한(무작위 다른 교과 쌍의 상위 약 2%). */
export const FUSION_AFFINITY_MIN = 0.4
/** 핵심 후보가 되려면 필요한 주제 관련도(검색의 '관련' 경계와 같다). */
export const FUSION_HUB_TOPIC_MIN = 0.5
/** 짝으로 셀 수 있는 주제 관련도 하한 — '약함' 판정까지 포함한다(주제에 조금이라도 닿는 것). */
export const FUSION_PARTNER_TOPIC_MIN = 0.3
/** 다리 놓기 만점 기준 교과 수. */
export const FUSION_BRIDGE_FULL = 3
/** 핵심 후보로 살펴볼 상위 개수. */
export const FUSION_HUB_CANDIDATES = 10

export interface FusionPoolItem {
  id: string
  subjectId: string
  band: string
  /** 0..1 주제 관련도 */
  topic: number
}

export interface FusionHub {
  id: string
  /** 0..1 핵심 추천 점수 */
  hubScore: number
  topic: number
  /** 같은 학년군에서 짝이 있는 다른 교과 id (정렬됨) */
  partnerSubjectIds: string[]
  /** 짝 성취기준 id — 주제 관련도 내림차순 */
  partnerIds: string[]
}

export interface RankFusionHubsOptions {
  limit?: number
  affinityMin?: number
  hubTopicMin?: number
  partnerTopicMin?: number
}

/**
 * 검색 후보 풀에서 융합 핵심 후보를 순위대로 고른다.
 * affinity(a, b) 는 0..1 의미 근접도(v1 코사인), linked(a, b) 는 교육과정 교과 간 링크 여부.
 */
export function rankFusionHubs(
  pool: readonly FusionPoolItem[],
  affinity: (a: string, b: string) => number,
  linked: (a: string, b: string) => boolean,
  options: RankFusionHubsOptions = {},
): FusionHub[] {
  const limit = options.limit ?? 3
  const affinityMin = options.affinityMin ?? FUSION_AFFINITY_MIN
  const hubTopicMin = options.hubTopicMin ?? FUSION_HUB_TOPIC_MIN
  const partnerTopicMin = options.partnerTopicMin ?? FUSION_PARTNER_TOPIC_MIN

  const byTopic = [...pool].sort((a, b) => b.topic - a.topic || compareIds(a.id, b.id))
  const candidates = byTopic.filter(item => item.topic >= hubTopicMin).slice(0, FUSION_HUB_CANDIDATES)

  const hubs = candidates.map(hub => {
    const partners = byTopic.filter(other =>
      other.id !== hub.id
      && other.band === hub.band
      && other.subjectId !== hub.subjectId
      && other.topic >= partnerTopicMin
      && (linked(hub.id, other.id) || affinity(hub.id, other.id) >= affinityMin))
    const partnerSubjectIds = [...new Set(partners.map(p => p.subjectId))].sort()
    const bridge = Math.min(1, partnerSubjectIds.length / FUSION_BRIDGE_FULL)
    return {
      id: hub.id,
      hubScore: round3(0.6 * hub.topic + 0.4 * bridge),
      topic: hub.topic,
      partnerSubjectIds,
      partnerIds: partners.map(p => p.id),
    }
  })

  return hubs
    .sort((a, b) => b.hubScore - a.hubScore || b.topic - a.topic || compareIds(a.id, b.id))
    .slice(0, Math.max(0, limit))
}

export interface FusionCandidateInput {
  id: string
  subjectId: string
  band: string
  /** 후보가 된 경로 — 우선순위: 교과 간 링크 > 주제 짝 > 의미 이웃 */
  origin: 'cross' | 'topic' | 'embedding'
  /** 0..1 중심과의 근접도(v1 코사인 또는 링크 가중치) */
  sim: number
  relation?: string
}

const ORIGIN_RANK = { cross: 0, topic: 1, embedding: 2 } as const

/**
 * 융합 그래프 후보: 중심과 같은 학년군·다른 교과만, 출처 우선순위 → 근접도 순으로 cap 개.
 * 같은 id 가 여러 경로로 오면 가장 높은 우선순위와 가장 큰 근접도를 남긴다.
 */
export function selectFusionCandidates(
  center: { id: string; subjectId: string; band: string },
  inputs: readonly FusionCandidateInput[],
  cap: number,
): FusionCandidateInput[] {
  const byId = new Map<string, FusionCandidateInput>()
  for (const input of inputs) {
    if (!input.id || input.id === center.id) continue
    if (input.band !== center.band || input.subjectId === center.subjectId) continue
    const existing = byId.get(input.id)
    if (!existing) {
      byId.set(input.id, { ...input })
      continue
    }
    if (ORIGIN_RANK[input.origin] < ORIGIN_RANK[existing.origin]) existing.origin = input.origin
    existing.sim = Math.max(existing.sim, input.sim)
    if (!existing.relation && input.relation) existing.relation = input.relation
  }
  return [...byId.values()]
    .sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || b.sim - a.sim || compareIds(a.id, b.id))
    .slice(0, Math.max(0, cap))
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

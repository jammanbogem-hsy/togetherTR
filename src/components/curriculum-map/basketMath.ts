// 교육과정 분석맵 — 담기(바구니)와 시트 연동의 순수 계산부.
// 외부 의존성 없음 (node --experimental-strip-types 로 단독 테스트).

import type { MapFilters, MapNode, MapPick, MapSubject } from './types'

/**
 * 시트의 교과 이름('사회', '통합교과' …)을 에셋의 교과 id 로.
 * 모르는 이름은 조용히 버린다 — 하나라도 매핑되면 그것만 필터로 쓴다.
 */
export function subjectNamesToIds(names: readonly string[], subjects: readonly MapSubject[]): string[] {
  const byName = new Map(subjects.map(s => [s.name.trim(), s.id]))
  const ids: string[] = []
  for (const raw of names) {
    const id = byName.get(raw.trim())
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** "[코드] 본문". 코드에 이미 대괄호가 있으면 다시 감싸지 않는다. */
export function formatStandard(code: string, text: string): string {
  const c = code.trim()
  const t = text.trim()
  const bracketed = c.startsWith('[') && c.endsWith(']') ? c : `[${c}]`
  return t ? `${bracketed} ${t}` : bracketed
}

/** 에셋 노드에서 담을 항목을 만든다. */
export function pickFromNode(node: MapNode): MapPick {
  return {
    id: node.id,
    code: node.code,
    text: node.text,
    standard: formatStandard(node.code, node.text),
    subject: node.subject,
    subjectId: node.subjectId,
    band: node.band,
    area: node.area,
    coreIdea: node.coreIdea ?? '',
  }
}

export interface PickableItem {
  id: string
  code: string
  text: string
  subject: string
  subjectId: string
  band: string
  area: string
}

/**
 * 검색 결과·관련 항목에서 담을 항목을 만든다. 이들 응답에는 핵심 아이디어가
 * 없으므로 에셋 노드가 있으면 거기서 보충한다.
 */
export function pickFromItem(item: PickableItem, node?: MapNode | null): MapPick {
  if (node) return pickFromNode(node)
  return {
    id: item.id,
    code: item.code,
    text: item.text,
    standard: formatStandard(item.code, item.text),
    subject: item.subject,
    subjectId: item.subjectId,
    band: item.band,
    area: item.area,
    coreIdea: '',
  }
}

/** 담기 토글 — 있으면 빼고 없으면 뒤에 붙인다 (순서 유지). 원본은 건드리지 않는다. */
export function toggleBasket(basket: readonly MapPick[], pick: MapPick): MapPick[] {
  return basket.some(p => p.id === pick.id)
    ? basket.filter(p => p.id !== pick.id)
    : [...basket, pick]
}

export function removeFromBasket(basket: readonly MapPick[], id: string): MapPick[] {
  return basket.filter(p => p.id !== id)
}

export function isPicked(basket: readonly MapPick[], id: string): boolean {
  return basket.some(p => p.id === id)
}

/** 맥락 칩 문구 — 비어 있는 조각은 건너뛴다. */
export function contextChipLabel(ctx: { subject?: string; gradeBand?: string; coreIdea?: string }): string {
  return [ctx.subject, ctx.gradeBand, ctx.coreIdea]
    .map(v => v?.trim() ?? '')
    .filter(v => v.length > 0)
    .join(' · ')
}

/**
 * 시트에서 열 때의 시작 필터. 교과·학년군 모두 "주어진 목록만 켜고, 없으면 전부 켠다".
 * base 의 나머지 설정(선 굵기 기준·라벨·움직임)은 그대로 둔다.
 */
export function resolveInitialFilters(
  props: { initialSubjects?: readonly string[]; initialBands?: readonly string[] },
  asset: { subjects: readonly MapSubject[]; bands: readonly string[] },
  base: MapFilters,
): MapFilters {
  const allSubjectIds = asset.subjects.map(s => s.id)
  const wantedSubjects = subjectNamesToIds(props.initialSubjects ?? [], asset.subjects)
  const hiddenSubjectIds = wantedSubjects.length > 0
    ? allSubjectIds.filter(id => !wantedSubjects.includes(id))
    : []
  const wantedBands = (props.initialBands ?? []).filter(b => asset.bands.includes(b))
  const hiddenBands = wantedBands.length > 0
    ? asset.bands.filter(b => !wantedBands.includes(b))
    : []
  return { ...base, hiddenSubjectIds, hiddenBands }
}

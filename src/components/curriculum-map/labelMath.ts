// 교육과정 분석맵 — 라벨 크기·위치 판정과 겹침(occlusion) 제거.
// 순수 함수라 node 로 단독 테스트한다.
//
// 크기 규칙(중요): 라벨 크기는 **CSS 픽셀 고정**이다. 뷰 배율이나
// devicePixelRatio 를 절대 곱하지 않는다. dpr 은 렌더러가
// ctx.setTransform(dpr,0,0,dpr,0,0) 으로 한 번만 적용한다.
//
// 폰트 문자열 주의: 캔버스 ctx.font 는 CSS 변수(var(--x))를 해석하지 못한다.
// 그런 문자열을 대입하면 조용히 무시되고 **직전 폰트가 그대로 남는다**.
// 아이콘(Material Symbols)을 그린 직후였다면 라벨이 아이콘 폰트·아이콘 크기로
// 그려져 2배 크고 넓은 글자가 된다(실제 결함이었다). 그래서 실제 패밀리 이름만 쓴다.

/** 이 배율 이상이면 (가림 검사를 거쳐) 모든 노드 라벨을 그린다 */
export const LABEL_ZOOM_THRESHOLD = 1.2
export const LABEL_FONT_PX = 14
/** 선택·검색 결과·관련 라벨은 한 단계 크게 */
export const LABEL_FONT_PX_FOCUS = 15
/** 이 배율 이상에서 코드 + 본문 앞부분을 함께 보여 준다 (크기는 그대로 14px) */
export const LABEL_DETAIL_ZOOM = 2
export const LABEL_DETAIL_CHARS = 18
/** 노드 아래로 띄우는 간격 */
export const LABEL_GAP_PX = 4
/** 흰 외곽선 두께 */
export const LABEL_HALO_PX = 3
export const LABEL_WEIGHT = 500
/** 앱 본문과 같은 얼굴. CSS 변수를 쓰면 캔버스가 무시한다. */
export const LABEL_FONT_FAMILY = "'Noto Sans KR', system-ui, sans-serif"

export interface LabelSizeOptions {
  /** 선택·검색 결과·관련 노드인지 */
  focused: boolean
  /**
   * 아래 두 값은 **의도적으로 무시**한다. 호출부가 실수로 배율을 곱하지 않도록
   * 시그니처에만 남겨 두고, 테스트가 무시됨을 검증한다.
   */
  viewScale?: number
  devicePixelRatio?: number
}

/** CSS 픽셀 고정 라벨 크기 — 배율·dpr 과 무관하다. */
export function labelFontSize(options: LabelSizeOptions): number {
  return options.focused ? LABEL_FONT_PX_FOCUS : LABEL_FONT_PX
}

/** 캔버스 ctx.font 문자열. CSS 변수 없이 실제 패밀리만 쓴다. */
export function labelFont(fontSize: number): string {
  return `${LABEL_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`
}

/**
 * 라벨의 기준선 y — 노드 **아래**. textBaseline 은 'top' 을 쓴다.
 * 노드 위나 중앙에 그리면 아이콘·원을 덮는다.
 */
export function labelAnchorY(nodeScreenY: number, screenRadius: number): number {
  return nodeScreenY + screenRadius + LABEL_GAP_PX
}

export interface LabelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 측정한 글자 폭으로 라벨 상자를 만든다 (anchorY 는 상자의 위쪽). */
export function labelBox(centerX: number, anchorY: number, textWidth: number, fontSize: number): LabelBox {
  const half = textWidth / 2 + 3
  return { x0: centerX - half, y0: anchorY - 1, x1: centerX + half, y1: anchorY + fontSize + 2 }
}

export function boxesIntersect(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/** 라벨 상자가 원(강조 노드)과 겹치는지 — 가장 가까운 점까지의 거리로 판정. */
export function boxIntersectsCircle(
  box: LabelBox,
  circle: { x: number; y: number; r: number },
): boolean {
  const nx = Math.max(box.x0, Math.min(circle.x, box.x1))
  const ny = Math.max(box.y0, Math.min(circle.y, box.y1))
  const dx = circle.x - nx
  const dy = circle.y - ny
  return dx * dx + dy * dy < circle.r * circle.r
}

export interface LabelContext {
  scale: number
  alwaysLabels: boolean
  isResult: boolean
  isSelected: boolean
  isHovered: boolean
  /** 선택 노드의 이웃·관련 — 관련 성취기준을 바로 읽히게 한다 */
  isNeighbor?: boolean
}

/** 항상 보여야 하는 라벨(선택·결과·호버·관련)은 가림 검사에서도 우선한다. */
export function isForcedLabel(ctx: LabelContext): boolean {
  return ctx.isSelected || ctx.isHovered || ctx.isResult || ctx.isNeighbor === true
}

export function shouldDrawLabel(ctx: LabelContext): boolean {
  if (isForcedLabel(ctx)) return true
  if (ctx.alwaysLabels) return true
  return ctx.scale >= LABEL_ZOOM_THRESHOLD
}

/** 배율이 충분하면 코드 뒤에 본문 앞부분을 붙인다 (글자 크기는 그대로). */
export function labelText(code: string, text: string, scale: number): string {
  if (scale < LABEL_DETAIL_ZOOM || !text) return code
  const head = text.slice(0, LABEL_DETAIL_CHARS).trim()
  if (!head) return code
  return `${code} ${head}${text.length > LABEL_DETAIL_CHARS ? '…' : ''}`
}

export interface LabelCandidate {
  id: string
  box: LabelBox
  /** 높을수록 먼저 자리를 차지한다 */
  priority: number
  /** 선택·결과·호버처럼 반드시 그려야 하는 라벨 */
  forced: boolean
}

/**
 * 탐욕적 가림 제거 — 우선순위가 높은 라벨부터 배치하고, 이미 놓인 라벨이나
 * 강조 노드의 원과 겹치는 라벨은 건너뛴다. 강제 라벨은 그리되 자리는 차지한다.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  blockers: readonly { x: number; y: number; r: number }[] = [],
): Set<string> {
  const ordered = [...candidates].sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1
    return b.priority - a.priority
  })
  const accepted: LabelBox[] = []
  const ids = new Set<string>()
  for (const c of ordered) {
    if (c.forced) {
      accepted.push(c.box)
      ids.add(c.id)
      continue
    }
    if (accepted.some(box => boxesIntersect(box, c.box))) continue
    if (blockers.some(circle => boxIntersectsCircle(c.box, circle))) continue
    accepted.push(c.box)
    ids.add(c.id)
  }
  return ids
}

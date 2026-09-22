/**
 * 분석 시트(전체 화면) · 분석맵 레이어의 브라우저 history 규칙 — 순수 함수.
 *
 * 두 레이어가 각각 history 항목 하나를 쌓는다: 시트가 열리면 `tcidSheet`, 그 위에 분석맵이
 * 열리면 `tcidMap`. 뒤로가기(popstate)는 창 전체에 한 번 오므로 "누가 닫혀야 하는지"를
 * 새 history.state와 레이어 열림 상태로 판정한다. 규칙을 한곳에 두는 이유:
 * 맵의 뒤로가기가 시트까지 닫거나, 맵 항목이 스택에 남는 사고가 두 파일의 판단이 어긋나서 났다.
 *
 * 닫기 요청(뒤로가기 화살표·Esc·반영 완료)은 항상 같은 경로를 탄다: 자기 항목이 최상단이면
 * history.back()으로 항목을 소비하고 popstate에서 닫는다. 아니면 바로 닫는다.
 */

export interface SheetHistoryState {
  tcidSheet?: boolean
  tcidMap?: boolean
}

export type SheetLayerKey = 'tcidSheet' | 'tcidMap'
export type PopOwner = 'map' | 'sheet' | 'none'

function readState(state: unknown): SheetHistoryState {
  if (!state || typeof state !== 'object') return {}
  return state as SheetHistoryState
}

/** 열 때 항목을 쌓아야 하는지 — 이미 자기 항목이 최상단이면(StrictMode·remount) 쌓지 않는다. */
export function shouldPushEntry(currentState: unknown, key: SheetLayerKey): boolean {
  return !readState(currentState)[key]
}

/**
 * popstate가 왔을 때 닫혀야 할 레이어.
 *  - 맵이 열려 있고 새 state에 tcidMap이 없으면 → 'map' (맵 항목이 pop됨. 시트는 유지)
 *  - 맵이 닫혀 있고 시트가 열려 있고 새 state에 tcidSheet·tcidMap이 모두 없으면 → 'sheet'
 *  - 그 밖(자기 항목이 아직 위에 있음 = 다른 레이어의 pop) → 'none'
 * 뒤로가기를 빠르게 두 번 누르면 첫 pop이 'map', 두 번째 pop이 'sheet'로 판정된다
 * (호출부는 'map' 판정 즉시 맵 열림 플래그를 내려야 한다).
 */
export function decidePopOwner(input: { sheetOpen: boolean; mapOpen: boolean; newState: unknown }): PopOwner {
  const state = readState(input.newState)
  if (input.mapOpen) return state.tcidMap ? 'none' : 'map'
  if (input.sheetOpen) return state.tcidSheet || state.tcidMap ? 'none' : 'sheet'
  return 'none'
}

/**
 * 닫기 요청 — 자기 항목이 최상단이면 back()으로 항목을 소비(popstate에서 닫힘), 아니면 바로 닫는다.
 * back()을 이미 요청해 popstate를 기다리는 중이면(빠른 연타) 아무것도 하지 않는다.
 * 반환값: 'back' | 'close' | 'pending'.
 */
export function closeViaHistory(input: {
  currentState: unknown
  key: SheetLayerKey
  backPending: boolean
  back: () => void
  close: () => void
}): 'back' | 'close' | 'pending' {
  if (input.backPending) return 'pending'
  if (readState(input.currentState)[input.key]) {
    input.back()
    return 'back'
  }
  input.close()
  return 'close'
}

// ─── 맵 레이어 열림 플래그 — 시트 컨테이너가 prop 없이 읽는다 ────────────────
// 모듈 스코프 클로저(가변 변수는 export하지 않는다). 한 창에 시트는 하나만 열린다.
let mapLayerOpen = false
export function setMapLayerOpen(open: boolean): void { mapLayerOpen = open }
export function isMapLayerOpen(): boolean { return mapLayerOpen }

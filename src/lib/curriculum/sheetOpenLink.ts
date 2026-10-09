// 프로젝트 화면을 열면서 교육과정 분석 시트를 바로 펼치는 링크.
// 대시보드 분석맵의 "시트로 보내기" 뒤 "시트로 이동"이 만들고, ChatPanel이 한 번 읽고 지운다.

export const SHEET_OPEN_PARAM = 'open'
export const SHEET_OPEN_VALUE = 'curriculum-sheet'
export const SHEET_ROW_PARAM = 'row'

export interface SheetOpenRequest {
  /** 스크롤해 보여 줄 줄 id (없으면 시트만 연다) */
  rowId?: string
}

export function buildSheetOpenHref(projectId: string, rowId?: string): string {
  const params = new URLSearchParams({ [SHEET_OPEN_PARAM]: SHEET_OPEN_VALUE })
  if (rowId) params.set(SHEET_ROW_PARAM, rowId)
  return `/projects/${encodeURIComponent(projectId)}?${params.toString()}`
}

export function readSheetOpenRequest(search: string): SheetOpenRequest | null {
  const params = new URLSearchParams(search)
  if (params.get(SHEET_OPEN_PARAM) !== SHEET_OPEN_VALUE) return null
  const rowId = params.get(SHEET_ROW_PARAM)?.trim()
  return rowId ? { rowId } : {}
}

/** 새로고침·뒤로 가기 때 다시 열리지 않도록 요청 파라미터만 뺀 주소. */
export function stripSheetOpenParams(href: string): string {
  const url = new URL(href, 'http://local')
  url.searchParams.delete(SHEET_OPEN_PARAM)
  url.searchParams.delete(SHEET_ROW_PARAM)
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
}

/** "시트로 보내기" 결과 안내 — 성취기준은 교과·핵심아이디어·학년군별로 묶여 줄 수가 더 적을 수 있다. */
export function sheetSentMessage(projectTitle: string, added: number, pickCount: number): string {
  const where = `‘${projectTitle}’ 프로젝트의 교육과정 분석 시트`
  if (added === 0) return `${where}에 넣을 성취기준이 없었습니다.`
  if (added === pickCount) return `${where}에 성취기준 ${pickCount}개를 넣었습니다.`
  return `${where}에 성취기준 ${pickCount}개를 ${added}줄로 묶어 넣었습니다.`
}

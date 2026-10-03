// 분석시트 행의 지식·이해/과정·기능/가치·태도 빈 칸 자동 보강 조건.

interface AutoFillRow {
  coreIdea?: string
  standard?: string
}

/**
 * 핵심아이디어와 성취기준이 모두 있을 때만 빈 내용 칸을 자동으로 채운다.
 * 성취기준이 비면 영역을 좁힐 근거가 없어, 같은 핵심아이디어의 다른 영역 항목
 * (예: 기후 행에 '강 주변 지형'·'화산 활동')이 들어가므로 채우지 않고 그대로 둔다.
 */
export function canAutoFillContentCells(row: AutoFillRow): boolean {
  return !!(row.coreIdea ?? '').trim() && !!(row.standard ?? '').trim()
}

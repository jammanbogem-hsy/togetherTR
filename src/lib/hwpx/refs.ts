// ─── 참조 ID 레지스트리 ──────────────────────────────────────────────────
// rhwp 패턴: 매직넘버 대신 의미 있는 이름으로 ID 관리 + 무결성 검증

/** CharPr ID — 문자 속성 */
export const CharPr = {
  BODY:          0,   // 본문 (10pt, 검정)
  H1_TITLE:      1,   // 구 제목용 (18pt, 검정, 볼드) — legacy
  H2_TITLE:      2,   // 구 부제목 (14pt, 검정, 볼드) — legacy
  H3_TITLE:      3,   // 구 소제목 (12pt, 검정, 볼드) — legacy
  H4_TITLE:      4,   // 구 (10pt, 볼드) — legacy
  ITALIC:        5,   // 이탤릭 (10pt, 회색)
  CODE:          6,   // 코드 (9.5pt, 브랜드 블루)
  BOLD_ITALIC:   7,   // 볼드+이탤릭 (10pt)
  TABLE_DENSE:   8,   // 표 본문 (9pt, 밀집 레이아웃)
  TABLE_DENSE_BOLD: 9,// 표 본문 볼드 (9pt)
  H1:           10,   // 대제목 (26pt, 네이비, 볼드, 이중밑줄)
  H2:           11,   // 섹션 제목 (20pt, 브랜드블루, 볼드, 밑줄)
  H3:           12,   // 서브 제목 (15pt, 딥블루, 볼드)
  H4:           13,   // 최소 제목 (12.5pt, 다크그레이, 볼드)
  BOLD:         14,   // 볼드 (10pt, 브랜드 블루)
  TH_WHITE:     15,   // 표 헤더 흰색 (10pt, 흰색, 볼드)
  TH_WHITE_SM:  16,   // 표 헤더 흰색 소형 (9pt, 흰색, 볼드)
  H2_BADGE:     17,   // H2 배지 박스 내부 (12pt, 브랜드블루, 볼드)
  H3_BAR:       18,   // H3 좌측바 박스 내부 (13pt, 딥블루, 볼드)
} as const

/** BorderFill ID — 테두리/배경 */
export const BorderFill = {
  NONE:         1,   // 테두리 없음 (기본)
  BASIC:        2,   // 기본 실선
  TABLE:        3,   // 표 본문 셀 (연한 회색)
  TABLE_HEADER: 4,   // 표 헤더 셀 (블루 배경)
  BLOCKQUOTE:   5,   // 블록쿼트 (좌측 파란 바 + 라벤더 배경)
  H2_BADGE:     6,   // H2 배지 (연블루 배경 + 좌측 블루 바)
  H3_BAR:       7,   // H3 좌측 파란 바 (배경 없음)
  H4_BAR:       8,   // H4 좌측 회색 바 (배경 없음)
} as const

/** ParShape ID — 문단 속성 */
export const ParShape = {
  BODY:          0,   // 본문 (양쪽정렬, 줄간격 160%)
  H1:            1,   // 대제목 (좌측, 줄간격 140%, next 520)
  H2:            2,   // 섹션 제목 (좌측, 줄간격 145%)
  H3:            3,   // 서브 제목 (좌측, 줄간격 150%)
  H4:            4,   // 최소 제목 (좌측, 줄간격 155%)
  LIST:          5,   // 리스트 (indent -420, left 1200)
  QUOTE:         6,   // 인용 (left 900, right 300)
  TH_CENTER:     7,   // 표 헤더 중앙 (줄간격 135%)
  TD:            8,   // 표 본문 (좌측, 줄간격 138%)
} as const

/** Style ID */
export const StyleId = {
  NORMAL:        0,   // 바탕글
  TABLE_HEADER:  1,   // 표 머리글 (CENTER)
} as const

// ─── 무결성 검증 ─────────────────────────────────────────────────────────
// rhwp의 SerializeContext 패턴: 사용된 ID가 header에 정의돼 있는지 확인

const VALID_CHAR_PR_IDS = new Set<number>(Object.values(CharPr))
const VALID_BORDER_FILL_IDS = new Set<number>(Object.values(BorderFill))
const VALID_PAR_SHAPE_IDS = new Set<number>(Object.values(ParShape))
const VALID_STYLE_IDS = new Set<number>(Object.values(StyleId))

export function validateRef(type: 'charPr' | 'borderFill' | 'parShape' | 'style', id: number): void {
  const set = type === 'charPr' ? VALID_CHAR_PR_IDS
    : type === 'borderFill' ? VALID_BORDER_FILL_IDS
    : type === 'parShape' ? VALID_PAR_SHAPE_IDS
    : VALID_STYLE_IDS
  if (!set.has(id)) {
    throw new Error(`[hwpx] 미등록 ${type} ID: ${id}`)
  }
}

export function resolveCharPrId(run: { bold?: boolean; italic?: boolean; code?: boolean }, base: number): number {
  if (run.code) return CharPr.CODE
  if (run.bold && run.italic) return CharPr.BOLD_ITALIC
  if (run.bold) return CharPr.BOLD
  if (run.italic) return CharPr.ITALIC
  return base
}

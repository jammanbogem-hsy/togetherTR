// 교과별 Material Symbols Rounded 아이콘.
// 여기 있는 이름은 반드시 src/app/layout.tsx 의 icon_names 서브셋에도 있어야 한다
// (없으면 폰트에 글리프가 없어 리거처 이름이 글자로 그려진다).

export const SUBJECT_ICONS: Record<string, string> = {
  sub_kor: 'menu_book',
  sub_math: 'calculate',
  sub_sci: 'science',
  sub_soc: 'public',
  sub_mor: 'volunteer_activism',
  sub_art: 'palette',
  sub_mus: 'music_note',
  sub_pe: 'directions_run',
  sub_eng: 'translate',
  sub_prac: 'handyman',
  sub_int: 'emoji_nature',
  sub_extra: 'explore',
}

/** 캔버스에서 쓰는 아이콘 폰트 패밀리 */
export const ICON_FONT_FAMILY = '"Material Symbols Rounded"'
/** 폰트 로드 확인용 스펙 */
export const ICON_FONT_SPEC = `20px ${ICON_FONT_FAMILY}`
/** 이 화면 반지름 미만이면 아이콘을 그리지 않는다 (읽히지 않으므로) */
export const ICON_MIN_SCREEN_RADIUS = 9
/** 아이콘 크기 = 화면 반지름 × 이 값 */
export const ICON_SIZE_RATIO = 1.15
/** 이보다 많은 노드가 아이콘 대상이면(축소 상태) 아이콘을 건너뛴다 */
export const ICON_NODE_BUDGET = 400

/** 알 수 없는 교과면 빈 문자열 — 호출부에서 그리기를 건너뛴다. */
export function subjectIcon(subjectId?: string): string {
  if (!subjectId) return ''
  return SUBJECT_ICONS[subjectId] ?? ''
}

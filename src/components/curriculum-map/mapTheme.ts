// 교육과정 분석맵 — 캔버스 색 팔레트(밝게/어둡게).
// 어두운 테마는 옵시디언 그래프 보기처럼 짙은 바탕에 교과색 점이 떠 보이게 한다.

export type CanvasTheme = 'dark' | 'light'

export interface CanvasPalette {
  bg: string
  /** 바탕색의 투명 버전 — 그라데이션 끝(검정 투명으로 끝내면 가장자리에 어두운 띠가 생긴다) */
  bgTransparent: string
  /** 배경 유사도 선 */
  edge: string
  /** 호버 이웃 선 */
  focusEdge: string
  /** 라벨 글자 테두리(바탕색과 같은 계열) */
  labelHalo: string
  /** 교과색이 없을 때의 라벨 글자 */
  labelInk: string
  /** 안내 글자(영역·학년군) */
  guideInk: string
  /** 고리·가지 기본 알파 */
  ringAlpha: number
  branchAlpha: number
  /** 선택 링 */
  selectRing: string
  /** 노드 발광 사용 */
  glow: boolean
}

export const CANVAS_PALETTES: Record<CanvasTheme, CanvasPalette> = {
  dark: {
    bg: '#15171C',
    bgTransparent: 'rgba(21,23,28,0)',
    edge: '#5B6170',
    focusEdge: '#C9CDD6',
    labelHalo: 'rgba(21,23,28,0.92)',
    labelInk: '#E6E8EC',
    guideInk: '#9AA0AC',
    ringAlpha: 0.22,
    branchAlpha: 0.2,
    selectRing: '#FFFFFF',
    glow: true,
  },
  light: {
    bg: '#F8FAFD',
    bgTransparent: 'rgba(248,250,253,0)',
    edge: '#C4C7C5',
    focusEdge: '#747775',
    labelHalo: 'rgba(255,255,255,0.95)',
    labelInk: '#444746',
    guideInk: '#5E5E5E',
    ringAlpha: 0.35,
    branchAlpha: 0.22,
    selectRing: '#1F1F1F',
    glow: false,
  },
}

/** 어두운 바탕에서 교과색 글자가 묻히지 않게 밝게 섞는다(#RRGGBB 만). */
export function readableOn(theme: CanvasTheme, color: string): string {
  if (theme === 'light' || !/^#[0-9a-f]{6}$/i.test(color)) return color
  const mix = (i: number): number => {
    const c = parseInt(color.slice(i, i + 2), 16)
    return Math.round(c + (255 - c) * 0.45)
  }
  return `rgb(${mix(1)},${mix(3)},${mix(5)})`
}

import type { StageCode } from '@/types'

/**
 * 단계 아이덴티티 컬러 — StageBar / ActivitySidebar / ArtifactPanel 공통.
 * docs/ui-spec-2026-04.md 섹션 1-2 기준. 3영역에서 import하여 사용.
 *
 * 필드 의미:
 * - hex: raw hex (rgba 합성·style prop용)
 * - bg:  진한색 Tailwind class (활성 chip·배지)
 * - text: 진한색 텍스트 class
 * - done: 중간 톤 Tailwind class (완료·미진행 노드)
 * - light: 연한 배경 class (pill·카드 배경)
 * - border: 보더 class (카드 외곽)
 * - doneText: 완료 단계 텍스트 class
 * - pulse: drop-shadow/box-shadow용 rgba (0.35 톤)
 * - corner: corner decoration용 rgba (0.11 통일 — 기존 0.10~0.13 편차 수렴)
 */
export interface StageColor {
  hex: string
  bg: string
  text: string
  done: string
  light: string
  border: string
  doneText: string
  pulse: string
  corner: string
}

export const STAGE_COLOR: Record<StageCode, StageColor> = {
  T: {
    hex: '#1A73E8',
    bg: 'bg-[#1A73E8]',
    text: 'text-[#1A73E8]',
    done: 'bg-[#AECBFA]',
    light: 'bg-[#E8F0FE]',
    border: 'border-[#AECBFA]',
    doneText: 'text-[#1558D6]',
    pulse: 'rgba(26,115,232,0.35)',
    corner: 'rgba(26,115,232,0.11)',
  },
  A: {
    hex: '#7B1FA2',
    bg: 'bg-[#7B1FA2]',
    text: 'text-[#7B1FA2]',
    done: 'bg-[#CE93D8]',
    light: 'bg-[#F3E5F5]',
    border: 'border-[#CE93D8]',
    doneText: 'text-[#6A1B9A]',
    pulse: 'rgba(123,31,162,0.35)',
    corner: 'rgba(123,31,162,0.11)',
  },
  Ds: {
    hex: '#00897B',
    bg: 'bg-[#00897B]',
    text: 'text-[#00897B]',
    done: 'bg-[#80CBC4]',
    light: 'bg-[#E0F2F1]',
    border: 'border-[#80CBC4]',
    doneText: 'text-[#00695C]',
    pulse: 'rgba(0,137,123,0.35)',
    corner: 'rgba(0,137,123,0.11)',
  },
  DI: {
    hex: '#E65100',
    bg: 'bg-[#E65100]',
    text: 'text-[#E65100]',
    done: 'bg-[#FFAB91]',
    light: 'bg-[#FBE9E7]',
    border: 'border-[#FFAB91]',
    doneText: 'text-[#BF360C]',
    pulse: 'rgba(230,81,0,0.35)',
    corner: 'rgba(230,81,0,0.11)',
  },
  E: {
    hex: '#C62828',
    bg: 'bg-[#C62828]',
    text: 'text-[#C62828]',
    done: 'bg-[#EF9A9A]',
    light: 'bg-[#FFEBEE]',
    border: 'border-[#EF9A9A]',
    doneText: 'text-[#B71C1C]',
    pulse: 'rgba(198,40,40,0.35)',
    corner: 'rgba(198,40,40,0.11)',
  },
}

export const STAGE_LABELS: Record<StageCode, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

// 단계 분석 보고서의 고정 섹션 머리글. 생성 프롬프트(analyze/stage)와 보고서 화면의 아이콘 매핑이 함께 쓴다.
// icon 은 @phosphor-icons/react 컴포넌트 이름이다. 머리글이 이 목록과 다른 예전 보고서도 일반 머리글로 렌더된다.
import type { StageCode } from '@/types'

export type ReportSectionKey =
  | 'summary' | 'overview' | 'activities' | 'alignment' | 'strengths' | 'improvements' | 'next' | 'appendix'

export interface ReportSection {
  key: ReportSectionKey
  title: string
  icon: string
  /** 예전 보고서에 저장된 제목 — 같은 섹션(아이콘)으로 인식한다 */
  legacyTitles?: readonly string[]
}

/** 설계(Ds) 단계 기준 머리글. 다른 단계는 reportSectionsFor 로 'alignment' 제목만 바꾼다. */
export const REPORT_SECTIONS: readonly ReportSection[] = [
  { key: 'summary', title: '이 단계 핵심 요약', icon: 'Target' },
  { key: 'overview', title: '한눈에 보기', icon: 'ChartBar' },
  { key: 'activities', title: '활동별 산출물 및 분석', icon: 'ListChecks' },
  { key: 'alignment', title: '성취기준·평가 연결', icon: 'Exam', legacyTitles: ['성취기준·평가 정렬'] },
  // 평가자가 아니라 설계 동료의 관점 — 칭찬과 제안형 아이디어(TASK-044)
  { key: 'strengths', title: '잘 설계된 점', icon: 'ThumbsUp', legacyTitles: ['강점'] },
  { key: 'improvements', title: '함께 다듬어 볼 아이디어', icon: 'Wrench', legacyTitles: ['보완점'] },
  { key: 'next', title: '다음 단계 제안', icon: 'ArrowRight' },
  // 산출물 원문 — 서버가 보고서 끝에 붙인다. 화면에서 기본 접힘.
  { key: 'appendix', title: '부록: 산출물 원문', icon: 'Database' },
]

/** 단계마다 'alignment' 자리에서 살펴보는 연결 — 잘 이어진 곳을 먼저, 빈 곳은 다음에 이어 볼 곳으로 */
const ALIGNMENT_BY_STAGE: Record<StageCode, { title: string; icon: string; legacyTitles: readonly string[] }> = {
  T: { title: '팀 협력 구조 살펴보기', icon: 'UsersThree', legacyTitles: ['팀 협력 구조 점검'] },
  A: { title: '성취기준·목표 연결', icon: 'Exam', legacyTitles: ['성취기준·목표 정렬'] },
  Ds: { title: '성취기준·평가 연결', icon: 'Exam', legacyTitles: ['성취기준·평가 정렬'] },
  DI: { title: '설계·실행 연결', icon: 'Exam', legacyTitles: ['설계·실행 정렬'] },
  E: { title: '성찰·개선 연결', icon: 'ArrowsClockwise', legacyTitles: [] },
}

export function reportSectionsFor(stage: StageCode): ReportSection[] {
  return REPORT_SECTIONS.map(section => section.key === 'alignment'
    ? { ...section, ...ALIGNMENT_BY_STAGE[stage] }
    : { ...section })
}

/** 머리글 글자(앞 이모지·공백 무시)로 고정 섹션을 찾는다. 예전 제목도 인식한다. 없으면 null — 일반 머리글로 렌더한다. */
export function findReportSection(heading: string): ReportSection | null {
  const title = heading.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const all = [...REPORT_SECTIONS, ...Object.values(ALIGNMENT_BY_STAGE).map(meta => ({ key: 'alignment' as const, ...meta }))]
  return all.find(section => section.title === title || section.legacyTitles?.includes(title)) ?? null
}

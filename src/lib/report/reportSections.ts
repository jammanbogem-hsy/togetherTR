// 단계 분석 보고서의 고정 섹션 머리글. 생성 프롬프트(analyze/stage)와 보고서 화면의 아이콘 매핑이 함께 쓴다.
// icon 은 @phosphor-icons/react 컴포넌트 이름이다. 머리글이 이 목록과 다른 예전 보고서도 일반 머리글로 렌더된다.
import type { StageCode } from '@/types'

export type ReportSectionKey =
  | 'summary' | 'overview' | 'activities' | 'alignment' | 'strengths' | 'improvements' | 'next'

export interface ReportSection {
  key: ReportSectionKey
  title: string
  icon: string
}

/** 설계(Ds) 단계 기준 머리글. 다른 단계는 reportSectionsFor 로 'alignment' 제목만 바꾼다. */
export const REPORT_SECTIONS: readonly ReportSection[] = [
  { key: 'summary', title: '이 단계 핵심 요약', icon: 'Target' },
  { key: 'overview', title: '한눈에 보기', icon: 'ChartBar' },
  { key: 'activities', title: '활동별 산출물 및 분석', icon: 'ListChecks' },
  { key: 'alignment', title: '성취기준·평가 정렬', icon: 'Exam' },
  { key: 'strengths', title: '강점', icon: 'ThumbsUp' },
  { key: 'improvements', title: '보완점', icon: 'Wrench' },
  { key: 'next', title: '다음 단계 제안', icon: 'ArrowRight' },
]

/** 단계마다 'alignment' 자리에서 점검하는 대상 */
const ALIGNMENT_BY_STAGE: Record<StageCode, { title: string; icon: string }> = {
  T: { title: '팀 협력 구조 점검', icon: 'UsersThree' },
  A: { title: '성취기준·목표 정렬', icon: 'Exam' },
  Ds: { title: '성취기준·평가 정렬', icon: 'Exam' },
  DI: { title: '설계·실행 정렬', icon: 'Exam' },
  E: { title: '성찰·개선 연결', icon: 'ArrowsClockwise' },
}

export function reportSectionsFor(stage: StageCode): ReportSection[] {
  return REPORT_SECTIONS.map(section => section.key === 'alignment'
    ? { ...section, ...ALIGNMENT_BY_STAGE[stage] }
    : { ...section })
}

/** 머리글 글자(앞 이모지·공백 무시)로 고정 섹션을 찾는다. 없으면 null — 일반 머리글로 렌더한다. */
export function findReportSection(heading: string): ReportSection | null {
  const title = heading.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const all = [...REPORT_SECTIONS, ...Object.values(ALIGNMENT_BY_STAGE).map(meta => ({ key: 'alignment' as const, ...meta }))]
  return all.find(section => section.title === title) ?? null
}

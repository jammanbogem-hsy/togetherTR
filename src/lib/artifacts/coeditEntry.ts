// 산출물 패널 빈 상태에서 '공동 편집으로 함께 작성하기'로 바로 열 수 있는 활동.
// 채팅 아래 공동 편집 버튼이 있는 활동과 같다(A-2-1 은 교육과정 분석 공동 편집). 연수용 프로젝트는 연수 양식을 쓴다.
import type { ActivityCode } from '@/types'

export const COEDIT_ACTIVITIES: readonly ActivityCode[] = [
  'T-1-1', 'T-1-2', 'T-2-1', 'T-2-2', 'T-2-3', 'A-1-2', 'A-2-1', 'A-2-2',
  'Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2', 'DI-1-1', 'DI-2-1', 'E-1-1', 'E-2-1',
]

/** 빈 산출물 화면에서 공동 편집을 열 수 있는가 — 지금 진행 중인 활동을 보고 있고, 연수용이 아닐 때만. */
export function canOpenCoeditFromPanel(input: { viewingActivity: string; currentActivity: string; trainingProject: boolean }): boolean {
  return !input.trainingProject && input.viewingActivity === input.currentActivity
    && (COEDIT_ACTIVITIES as readonly string[]).includes(input.viewingActivity)
}

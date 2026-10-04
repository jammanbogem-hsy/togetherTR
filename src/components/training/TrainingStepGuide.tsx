import type { ReactNode } from 'react'
import type { ActivityCode, Project } from '@/types'
import { isTrainingActivity } from '@/lib/training/trainingMode'

export function TrainingStepGuide({ project, activityCode, children }: { project: Project; activityCode: ActivityCode; children: ReactNode }) {
  if (!isTrainingActivity(project, activityCode)) return <>{children}</>
  return (
    <details className="mx-3 mt-3 min-w-0 border-t border-[#DADCE0] pt-3">
      <summary className="cursor-pointer text-sm font-medium text-[#5F6368]">정식 진행 스텝 보기</summary>
      {children}
    </details>
  )
}

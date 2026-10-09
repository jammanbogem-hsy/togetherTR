import type { ReactNode } from 'react'
import type { ActivityCode, Project } from '@/types'
import { isTrainingActivity } from '@/lib/training/trainingMode'

export function TrainingStepGuide({ project, activityCode, children }: { project: Project; activityCode: ActivityCode; children: ReactNode }) {
  if (!isTrainingActivity(project, activityCode)) return <>{children}</>
  return (
    <details className="group mx-3 mt-3 min-w-0 shrink-0 rounded-2xl border border-[#C4C7C5] bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-3 py-3 text-sm font-medium text-[#444746] hover:bg-[#F0F4F9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"><path d="m9 5 7 7-7 7" /></svg>
        정식 진행 스텝 보기
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  )
}

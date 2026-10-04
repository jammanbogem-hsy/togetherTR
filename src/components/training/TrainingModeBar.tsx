'use client'

import { useState } from 'react'
import { CheckCircle, ArrowRight, Question } from '@phosphor-icons/react'
import { ACTIVITY_META, STAGES, SOLO_HIDDEN_ACTIVITIES, type ActivityCode, type Project } from '@/types'
import { TRAINING_ACTIVITIES, TRAINING_STEP_BY_STEP, formatTrainingHelpRequest, isTrainingActivity, trainingStatus } from '@/lib/training/trainingMode'
import { StageAnalysisModal } from '@/components/modals/StageAnalysisModal'
import { MD3Button } from '@/components/ui/MD3Button'
import { trainingFormValues } from './trainingFormState'

export interface TrainingModeBarProps {
  project: Project
  activityCode: ActivityCode
  content?: Record<string, unknown>
  loaded: boolean
  isHost: boolean
  busy: boolean
  onSend: (text: string) => unknown
  onNext: (nextCode: ActivityCode) => unknown
  onReport?: () => unknown
}

export function TrainingModeBar({ project, activityCode, content = {}, loaded, isHost, busy, onSend, onNext, onReport }: TrainingModeBarProps) {
  const [showReport, setShowReport] = useState(false)
  if (!isTrainingActivity(project, activityCode)) return null
  const status = trainingStatus(activityCode, trainingFormValues(activityCode, content))
  const activities = STAGES.flatMap(stage => stage.activities)
    .filter(code => project.mode !== 'solo' || !SOLO_HIDDEN_ACTIVITIES.includes(code))
  const activityIndex = activities.indexOf(activityCode)
  const next = activityIndex >= 0 ? activities[activityIndex + 1] : undefined
  const blocked = !loaded || busy
  return (
    <aside aria-label="연수용 모드" className="shrink-0 border-b border-[#DADCE0] bg-[#F3F7FE] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-[#0842A0]">연수용 모드</span>
        <span role="status" className="flex items-center gap-1 text-[#3C4043]">
          <CheckCircle size={16} aria-hidden="true" />
          {!loaded ? '내용을 불러오는 중…' : `필수 칸 ${status.requiredTotal - status.missingRequired.length}/${status.requiredTotal}`}
        </span>
        {loaded && status.missingRequired.length > 0 && <span className="text-xs text-[#8A3D00]">미입력: {status.missingRequired.map(field => field.label).join(' · ')}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {TRAINING_ACTIVITIES[activityCode].help.map(action => (
          <MD3Button key={action.label} type="button" variant="tonal" size="xs" disabled={blocked}
            icon={<Question size={16} />} onClick={() => onSend(formatTrainingHelpRequest(action))}>AI 도움: {action.label}</MD3Button>
        ))}
        <MD3Button type="button" variant="outlined" size="xs" disabled={blocked}
          onClick={() => onSend(TRAINING_STEP_BY_STEP)}>단계별로 함께 진행</MD3Button>
        <MD3Button type="button" size="xs" disabled={blocked || !isHost}
          title={!isHost ? '방장만 다음 활동으로 이동할 수 있습니다.' : undefined}
          trailing={<ArrowRight size={16} />} onClick={() => {
            if (blocked || !isHost) return
            if (next) onNext(next)
            else if (onReport) onReport()
            else setShowReport(true)
          }}>{next ? `다음 활동 · ${ACTIVITY_META[next].label}` : '보고서 작성하기'}</MD3Button>
      </div>
      {showReport && isHost && <StageAnalysisModal isHost={isHost} onClose={() => setShowReport(false)} />}
    </aside>
  )
}

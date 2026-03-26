'use client'

import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode, type StageStatus, type ActivityCode } from '@/types'
import { cn } from '@/lib/utils'

const STAGE_COLOR: Record<StageCode, { chip: string; chipText: string; done: string; doneText: string }> = {
  T:  { chip: 'bg-[#1A73E8]', chipText: 'text-white', done: 'bg-[#E8F0FE]', doneText: 'text-[#1A73E8]' },
  A:  { chip: 'bg-[#7B1FA2]', chipText: 'text-white', done: 'bg-[#F3E5F5]', doneText: 'text-[#7B1FA2]' },
  Ds: { chip: 'bg-[#00897B]', chipText: 'text-white', done: 'bg-[#E0F2F1]', doneText: 'text-[#00897B]' },
  DI: { chip: 'bg-[#E65100]', chipText: 'text-white', done: 'bg-[#FBE9E7]', doneText: 'text-[#E65100]' },
  E:  { chip: 'bg-[#C62828]', chipText: 'text-white', done: 'bg-[#FFEBEE]', doneText: 'text-[#C62828]' },
}

function CycleArrow() {
  return (
    <div className="absolute -top-6 left-0 right-0 pointer-events-none flex justify-center">
      <svg width="300" height="22" viewBox="0 0 300 22">
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
            <polygon points="0 0, 6 2.5, 0 5" fill="#34A853" />
          </marker>
        </defs>
        <path d="M 270 17 C 270 3, 30 3, 30 17" fill="none" stroke="#34A853"
          strokeWidth="1.5" strokeDasharray="5,3" markerEnd="url(#arr)" />
        <text x="148" y="9" textAnchor="middle" fill="#34A853" fontSize="9" fontWeight="500">새로운 주기</text>
      </svg>
    </div>
  )
}

function StageChip({
  stage, status, isCurrent, completedCount, totalCount, onClick,
}: {
  stage: typeof STAGES[number]
  status: StageStatus
  isCurrent: boolean
  completedCount: number
  totalCount: number
  onClick: () => void
}) {
  const color = STAGE_COLOR[stage.code]
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const isDone = status === 'completed'

  if (isCurrent) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'flex items-center gap-2 pl-3.5 pr-4 py-2 rounded-full select-none',
          'shadow-md hover:shadow-lg active:scale-[0.97] transition-all duration-150',
          color.chip, color.chipText
        )}
      >
        {/* 원형 진행률 */}
        <div className="relative w-[18px] h-[18px] flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
            <circle cx="9" cy="9" r="7" fill="none" stroke="white" strokeWidth="2"
              strokeDasharray={`${progressPct * 0.44} 100`} strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-[13px] font-bold tracking-wide">{stage.code}</span>
        <span className="text-[11px] font-medium opacity-90">{stage.label}</span>
        <span className="text-[10px] opacity-70 ml-0.5">{completedCount}/{totalCount}</span>
      </button>
    )
  }

  if (isDone) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'flex items-center gap-1.5 pl-3 pr-4 py-2 rounded-full select-none',
          'hover:brightness-95 active:scale-[0.97] transition-all duration-150',
          color.done, color.doneText
        )}
      >
        <span className="material-symbols-rounded msf" style={{ fontSize: 15 }}>check_circle</span>
        <span className="text-[12px] font-semibold">{stage.code}</span>
        <span className="text-[11px] font-normal opacity-80">{stage.label}</span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 pl-3 pr-4 py-2 rounded-full select-none
        border border-[#DADCE0] bg-white text-[#5F6368]
        hover:bg-[#F1F3F4] hover:border-[#BDC1C6] active:scale-[0.97] transition-all duration-150"
    >
      <span className="material-symbols-rounded" style={{ fontSize: 15, color: '#9AA0A6' }}>
        radio_button_unchecked
      </span>
      <span className="text-[12px] font-medium">{stage.code}</span>
      <span className="text-[11px] opacity-70">{stage.label}</span>
    </button>
  )
}

export function StageBar() {
  const { project, activityStatus, setPendingStageMove } = useProjectStore()
  if (!project) return null

  const currentStage = project.currentStage
  const currentStageIdx = STAGES.findIndex(s => s.code === currentStage)

  function getStageStatus(stageCode: StageCode): StageStatus {
    const info = STAGES.find(s => s.code === stageCode)!
    if (info.activities.every(a => isEffectivelyDone(a))) return 'completed'
    if (stageCode === currentStage) return 'in_progress'
    if (info.activities.some(a => (activityStatus[a] ?? 'not_started') !== 'not_started')) return 'in_progress'
    return 'not_started'
  }

  // 산출물이 있는 warning도 완료로 간주 (ActivitySidebar와 동일 로직)
  function isEffectivelyDone(code: ActivityCode) {
    const s = activityStatus[code]
    if (s === 'completed') return true
    if (s === 'warning' && project?.artifacts?.[code]) return true
    return false
  }

  function getCompletedCount(stageCode: StageCode) {
    return STAGES.find(s => s.code === stageCode)!.activities
      .filter(a => isEffectivelyDone(a)).length
  }

  return (
    <div className="relative bg-white border-b border-[#DADCE0] px-6 py-3">
      {project.isECompleted && <CycleArrow />}

      <div className="flex items-center justify-center gap-0">
        {STAGES.map((stage, idx) => {
          // 다음 단계가 시작된 경우(완료 또는 진행 중) 커넥터를 초록색으로
          const nextStage = STAGES[idx + 1]
          const nextStarted = nextStage && getStageStatus(nextStage.code) !== 'not_started'

          return (
            <div key={stage.code} className="flex items-center">
              <StageChip
                stage={stage}
                status={getStageStatus(stage.code)}
                isCurrent={stage.code === currentStage}
                completedCount={getCompletedCount(stage.code)}
                totalCount={stage.activities.length}
                onClick={() => { if (stage.code !== currentStage) setPendingStageMove(stage.code) }}
              />
              {idx < STAGES.length - 1 && (
                <div className="flex items-center px-1 flex-shrink-0 gap-px">
                  <div className={cn('h-px w-3 transition-colors', nextStarted ? 'bg-[#34A853]' : 'bg-[#DADCE0]')} />
                  <span className={cn('text-[8px] transition-colors leading-none', nextStarted ? 'text-[#34A853]' : 'text-[#DADCE0]')}>⇄</span>
                  <div className={cn('h-px w-3 transition-colors', nextStarted ? 'bg-[#34A853]' : 'bg-[#DADCE0]')} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {project.isA23Completed && (
        <div className="absolute right-5 top-1/2 -translate-y-1/2">
          <span className="flex items-center gap-1 text-[10px] bg-[#F3E5F5] text-[#7B1FA2]
            px-2.5 py-1 rounded-full border border-[#E1BEE7] font-medium select-none">
            <span className="material-symbols-rounded msf" style={{ fontSize: 13 }}>shield</span>
            가드레일
          </span>
        </div>
      )}
    </div>
  )
}

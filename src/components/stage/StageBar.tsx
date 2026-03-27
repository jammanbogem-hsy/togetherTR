'use client'

import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode, type StageStatus, type ActivityCode } from '@/types'
import { cn } from '@/lib/utils'
import { UsersThree, ChartLineUp, PencilRuler, RocketLaunch, Trophy, Check, Shield, type Icon } from '@phosphor-icons/react'

const STAGE_COLOR: Record<StageCode, { chip: string; done: string; doneText: string; pulse: string }> = {
  T:  { chip: 'bg-[#1A73E8]', done: 'bg-[#E8F0FE]', doneText: 'text-[#1A73E8]', pulse: 'rgba(26,115,232,0.35)' },
  A:  { chip: 'bg-[#7B1FA2]', done: 'bg-[#F3E5F5]', doneText: 'text-[#7B1FA2]', pulse: 'rgba(123,31,162,0.35)' },
  Ds: { chip: 'bg-[#00897B]', done: 'bg-[#E0F2F1]', doneText: 'text-[#00897B]', pulse: 'rgba(0,137,123,0.35)' },
  DI: { chip: 'bg-[#E65100]', done: 'bg-[#FBE9E7]', doneText: 'text-[#E65100]', pulse: 'rgba(230,81,0,0.35)'  },
  E:  { chip: 'bg-[#C62828]', done: 'bg-[#FFEBEE]', doneText: 'text-[#C62828]', pulse: 'rgba(198,40,40,0.35)' },
}

// 단계별 고유 아이콘 (Phosphor)
const STAGE_ICONS: Record<StageCode, Icon> = {
  T:  UsersThree,
  A:  ChartLineUp,
  Ds: PencilRuler,
  DI: RocketLaunch,
  E:  Trophy,
}

function CycleArrow() {
  return (
    <div className="absolute -top-7 left-0 right-0 pointer-events-none flex justify-center">
      <svg width="340" height="24" viewBox="0 0 340 24">
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
            <polygon points="0 0, 6 2.5, 0 5" fill="#34A853" />
          </marker>
        </defs>
        <path d="M 305 19 C 305 4, 35 4, 35 19" fill="none" stroke="#34A853"
          strokeWidth="1.5" strokeDasharray="5,3" markerEnd="url(#arr)" />
        <text x="170" y="11" textAnchor="middle" fill="#34A853" fontSize="9" fontWeight="500">새로운 주기</text>
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
  const StageIcon = STAGE_ICONS[stage.code]

  if (isCurrent) {
    return (
      <button onClick={onClick} className="flex flex-col items-center gap-1.5 select-none group">
        {/* 56px organic shape — morph + bounce + colored glow */}
        <div
          className={cn('w-14 h-14 flex items-center justify-center relative overflow-hidden', color.chip)}
          style={{
            animation: 'morph-shape 7s ease-in-out infinite, stage-bounce 2.8s ease-in-out infinite',
            boxShadow: `0 6px 20px ${color.pulse}`,
          }}
        >
          {/* 진행률 fill (하단에서 위로) */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-white/20 transition-all duration-700"
            style={{ height: `${progressPct}%` }}
          />
          <StageIcon size={26} weight="fill" className="text-white relative z-10" />
        </div>
        <span className="text-[11px] font-bold text-[#202124] leading-tight">{stage.label}</span>
        <span className="text-[9px] text-[#9AA0A6] tabular-nums -mt-0.5">{completedCount}/{totalCount}</span>
      </button>
    )
  }

  if (isDone) {
    return (
      <button
        onClick={onClick}
        title="클릭해서 이 단계로 돌아가기"
        className="flex flex-col items-center gap-1.5 select-none hover:scale-105 active:scale-95 transition-transform duration-150"
      >
        {/* 40px — light tint, gentle rounded on hover */}
        <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center relative transition-all duration-300 group-hover:rounded-[40%_60%_55%_45%_/_50%_45%_55%_50%]', color.done)}>
          <StageIcon size={20} weight="fill" className={color.doneText} />
          {/* 체크 뱃지 */}
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#34A853] flex items-center justify-center shadow-sm">
            <Check size={11} weight="bold" className="text-white" />
          </div>
        </div>
        <span className={cn('text-[10px] font-semibold', color.doneText)}>{stage.label}</span>
      </button>
    )
  }

  // 미진행 단계
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 select-none opacity-45 hover:opacity-70 active:scale-95 transition-all duration-150"
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-[#DADCE0] bg-[#F8F9FA]">
        <StageIcon size={20} weight="regular" className="text-[#BDBDBD]" />
      </div>
      <span className="text-[10px] text-[#9AA0A6]">{stage.label}</span>
    </button>
  )
}

export function StageBar() {
  const { project, activityStatus, setPendingStageMove } = useProjectStore()
  if (!project) return null

  const currentStage = project.currentStage

  function getStageStatus(stageCode: StageCode): StageStatus {
    const info = STAGES.find(s => s.code === stageCode)!
    if (info.activities.every(a => isEffectivelyDone(a))) return 'completed'
    if (stageCode === currentStage) return 'in_progress'
    if (info.activities.some(a => (activityStatus[a] ?? 'not_started') !== 'not_started')) return 'in_progress'
    return 'not_started'
  }

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
    <div className="relative bg-white rounded-2xl border border-[#DADCE0] px-8 py-4 shadow-sm">
      {project.isECompleted && <CycleArrow />}

      <div className="flex items-center justify-center gap-1">
        {STAGES.map((stage, idx) => {
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
                <div className="flex items-center px-3 flex-shrink-0 gap-px pb-6">
                  <div className={cn('h-0.5 w-5 rounded-full transition-colors', nextStarted ? 'bg-[#34A853]' : 'bg-[#DADCE0]')} />
                  <span className={cn('text-[9px] transition-colors leading-none', nextStarted ? 'text-[#34A853]' : 'text-[#DADCE0]')}>⇄</span>
                  <div className={cn('h-0.5 w-5 rounded-full transition-colors', nextStarted ? 'bg-[#34A853]' : 'bg-[#DADCE0]')} />
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
            <Shield size={13} weight="fill" />
            가드레일
          </span>
        </div>
      )}
    </div>
  )
}

'use client'

import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode, type StageStatus, type ActivityCode } from '@/types'
import { cn } from '@/lib/utils'
import { UsersThree, ChartLineUp, PencilRuler, RocketLaunch, Trophy, Check, Shield, type Icon } from '@phosphor-icons/react'

const STAGE_COLOR: Record<StageCode, {
  chip: string; done: string; doneText: string; pulse: string
}> = {
  T:  { chip: 'bg-[#1A73E8]', done: 'bg-[#AECBFA]', doneText: 'text-[#1558D6]', pulse: 'rgba(26,115,232,0.4)'  },
  A:  { chip: 'bg-[#7B1FA2]', done: 'bg-[#CE93D8]', doneText: 'text-[#6A1B9A]', pulse: 'rgba(123,31,162,0.4)'  },
  Ds: { chip: 'bg-[#00897B]', done: 'bg-[#80CBC4]', doneText: 'text-[#00695C]', pulse: 'rgba(0,137,123,0.4)'   },
  DI: { chip: 'bg-[#E65100]', done: 'bg-[#FFAB91]', doneText: 'text-[#BF360C]', pulse: 'rgba(230,81,0,0.4)'    },
  E:  { chip: 'bg-[#C62828]', done: 'bg-[#EF9A9A]', doneText: 'text-[#B71C1C]', pulse: 'rgba(198,40,40,0.4)'   },
}

const STAGE_MORPH_DELAY: Record<StageCode, string> = {
  T: '0s', A: '-2.8s', Ds: '-5.6s', DI: '-8.4s', E: '-11.2s',
}

const STAGE_ICONS: Record<StageCode, Icon> = {
  T:  UsersThree,
  A:  ChartLineUp,
  Ds: PencilRuler,
  DI: RocketLaunch,
  E:  Trophy,
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
  const delay = STAGE_MORPH_DELAY[stage.code]

  if (isCurrent) {
    return (
      <button onClick={onClick} className="flex flex-col items-center gap-1 select-none group">
        <div
          className={cn('w-14 h-14 flex items-center justify-center relative overflow-hidden', color.chip)}
          style={{
            animation: `morph-shape 7s ease-in-out ${delay} infinite, stage-bounce 2.8s ease-in-out 0s infinite`,
            filter: `drop-shadow(0 4px 14px ${color.pulse})`,
          }}
        >
          <div className="absolute bottom-0 left-0 right-0 bg-white/20 transition-all duration-700"
            style={{ height: `${progressPct}%` }} />
          <StageIcon size={28} weight="fill" className="text-white relative z-10" />
        </div>
        <span className="text-[12px] font-extrabold text-[#202124] leading-tight">{stage.label}</span>
        <span className="text-[10px] font-semibold text-[#9AA0A6] tabular-nums -mt-0.5">{completedCount}/{totalCount}</span>
      </button>
    )
  }

  if (isDone) {
    return (
      <button onClick={onClick} title="클릭해서 이 단계로 돌아가기"
        className="flex flex-col items-center gap-1 select-none hover:scale-105 active:scale-95 transition-transform duration-150"
      >
        <div
          className={cn('w-10 h-10 flex items-center justify-center relative', color.done)}
          style={{ animation: `morph-shape 9s ease-in-out ${delay} infinite` }}
        >
          <StageIcon size={20} weight="fill" className={color.doneText} />
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#34A853] flex items-center justify-center shadow">
            <Check size={9} weight="bold" className="text-white" />
          </div>
        </div>
        <span className={cn('text-[11px] font-bold', color.doneText)}>{stage.label}</span>
      </button>
    )
  }

  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1 select-none opacity-60 hover:opacity-85 active:scale-95 transition-all duration-200"
    >
      <div className={cn('w-9 h-9 flex items-center justify-center', color.done)}
        style={{ animation: `morph-shape 11s ease-in-out ${delay} infinite` }}>
        <StageIcon size={17} weight="fill" className={color.doneText} />
      </div>
      <span className={cn('text-[10px] font-semibold', color.doneText)}>{stage.label}</span>
    </button>
  )
}

// 단계 사이 연결 화살표
function StageConnector({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-0.5 pb-5 flex-shrink-0">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={cn('text-[13px] font-black leading-none select-none transition-colors',
            active ? 'text-[#34A853]' : 'text-[#AECBFA]')}
          style={{ animation: `chevron-flow 1.4s ease-in-out ${i * 0.38}s infinite` }}
        >›</span>
      ))}
    </div>
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
    <div className="relative flex items-center justify-center gap-2 px-4">
      {project.isA23Completed && (
        <span className="absolute right-0 top-0 flex items-center gap-1 text-[9px] bg-[#F3E5F5] text-[#7B1FA2]
          px-2 py-0.5 rounded-full border border-[#E1BEE7] font-medium select-none">
          <Shield size={10} weight="fill" />
          가드레일
        </span>
      )}
      {STAGES.map((stage, idx) => {
        const nextStage = STAGES[idx + 1]
        const nextStarted = nextStage ? getStageStatus(nextStage.code) !== 'not_started' : false
        return (
          <div key={stage.code} className="flex items-center gap-2">
            <StageChip
              stage={stage}
              status={getStageStatus(stage.code)}
              isCurrent={stage.code === currentStage}
              completedCount={getCompletedCount(stage.code)}
              totalCount={stage.activities.length}
              onClick={() => { if (stage.code !== currentStage) setPendingStageMove(stage.code) }}
            />
            {idx < STAGES.length - 1 && <StageConnector active={nextStarted} />}
          </div>
        )
      })}
    </div>
  )
}

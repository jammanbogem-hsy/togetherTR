'use client'

import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type ActivityCode, type StageStatus } from '@/types'
import { setProjectActivity } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'

const STAGE_COLOR: Record<string, { bg: string; text: string; light: string; border: string }> = {
  T:  { bg: 'bg-[#1A73E8]', text: 'text-[#1A73E8]', light: 'bg-[#E8F0FE]', border: 'border-[#AECBFA]' },
  A:  { bg: 'bg-[#7B1FA2]', text: 'text-[#7B1FA2]', light: 'bg-[#F3E5F5]', border: 'border-[#CE93D8]' },
  Ds: { bg: 'bg-[#00897B]', text: 'text-[#00897B]', light: 'bg-[#E0F2F1]', border: 'border-[#80CBC4]' },
  DI: { bg: 'bg-[#E65100]', text: 'text-[#E65100]', light: 'bg-[#FBE9E7]', border: 'border-[#FFAB91]' },
  E:  { bg: 'bg-[#C62828]', text: 'text-[#C62828]', light: 'bg-[#FFEBEE]', border: 'border-[#EF9A9A]' },
}

const STAGE_GUIDE: Record<string, { goal: string; teamTasks: string[] }> = {
  T: {
    goal: '팀이 하나의 방향으로 정렬되는 단계',
    teamTasks: ['공통 비전과 목표를 함께 만들어요', '각자의 역할을 명확히 정해요', '함께 일하는 규칙을 합의해요'],
  },
  A: {
    goal: '수업의 뼈대가 될 분석을 완성하는 단계',
    teamTasks: ['주제와 성취기준을 함께 검토해요', '학습자 특성을 팀이 함께 파악해요', '이 단계 산출물이 설계 가드레일이 됩니다'],
  },
  Ds: {
    goal: '평가를 먼저 설계하고 활동을 채우는 단계',
    teamTasks: ['평가계획을 먼저 확정해요', '학습자 프로필을 모든 설계에 반영해요', '활동-평가 정합성을 함께 확인해요'],
  },
  DI: {
    goal: '설계를 실제 수업으로 구현하는 단계',
    teamTasks: ['자료를 함께 탐색하고 개발해요', '수업 중 관찰을 꼼꼼히 기록해요', '예상치 못한 반응도 메모해두세요'],
  },
  E: {
    goal: '성찰로 다음 주기를 준비하는 단계',
    teamTasks: ['수업 에피소드를 함께 돌아봐요', '팀 협력의 강점과 개선점을 나눠요', '다음 주기의 씨앗을 이 단계에서 심어요'],
  },
}

function ActivityItem({ code, isCurrent, status, index, onClick }: {
  code: ActivityCode; isCurrent: boolean; status: StageStatus; index: number; onClick: () => void
}) {
  const meta = ACTIVITY_META[code]

  let statusIcon = ''
  let statusColor = 'text-[#9AA0A6]'
  if (status === 'completed') { statusIcon = 'check_circle'; statusColor = 'text-[#34A853]' }
  else if (status === 'warning') { statusIcon = 'warning'; statusColor = 'text-[#F9AB00]' }
  else if (status === 'active_return') { statusIcon = 'replay'; statusColor = 'text-[#E65100]' }
  else if (status === 'in_progress' || isCurrent) { statusIcon = 'pending'; statusColor = 'text-[#1A73E8]' }

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150',
        isCurrent
          ? 'bg-[#E8F0FE] shadow-sm'
          : 'hover:bg-[#F1F3F4] text-[#5F6368]'
      )}
    >
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0',
        isCurrent ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#9AA0A6]'
      )}>
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn('text-xs leading-tight truncate',
          isCurrent ? 'font-bold text-[#1A73E8]' : 'font-medium text-[#3C4043]'
        )}>
          {meta.label}
        </p>
        {!isCurrent && status === 'warning' && (
          <p className="text-[10px] text-[#F9AB00] mt-0.5">건너뜀</p>
        )}
        {!isCurrent && status === 'active_return' && (
          <p className="text-[10px] text-[#E65100] mt-0.5">재진행 중</p>
        )}
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {meta.isGuardrailSource && (
          <span className="material-symbols-rounded msf ms-sm text-[#7B1FA2]">shield</span>
        )}
        {meta.isBackwardDesignFirst && (
          <span className="material-symbols-rounded msf ms-sm text-[#F9AB00]">star</span>
        )}
        {statusIcon && (
          <span className={cn('material-symbols-rounded msf ms-sm', statusColor)}>{statusIcon}</span>
        )}
        {isCurrent && (
          <span className="material-symbols-rounded ms-sm text-[#1A73E8]">chevron_right</span>
        )}
      </div>
    </button>
  )
}

export function ActivitySidebar() {
  const { project, activityStatus, currentActivity, setCurrentActivity } = useProjectStore()
  if (!project) return null

  const currentStage = project.currentStage
  const currentStageInfo = STAGES.find(s => s.code === currentStage)!
  const guide = STAGE_GUIDE[currentStage]
  const color = STAGE_COLOR[currentStage]
  const completedCount = currentStageInfo.activities.filter(a => activityStatus[a] === 'completed').length
  const totalCount = currentStageInfo.activities.length
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  function handleActivityClick(code: ActivityCode) {
    if (code === currentActivity) return
    setCurrentActivity(code)
    setProjectActivity(project!.id, code).catch(console.error)
  }

  return (
    <div className="w-60 flex-shrink-0 flex flex-col bg-white border-r border-[#DADCE0] overflow-hidden">

      {/* 단계 헤더 */}
      <div className="px-4 pt-5 pb-4 border-b border-[#F1F3F4]">
        <div className="flex items-center gap-2 mb-3">
          <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold text-white', color.bg)}>
            {currentStage}
          </span>
          <span className="text-sm font-bold text-[#202124]">{currentStageInfo.label}</span>
        </div>
        <p className="text-[11px] text-[#5F6368] leading-relaxed mb-3">{guide.goal}</p>

        {/* 진행률 바 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[#F1F3F4] rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', color.bg)}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] text-[#9AA0A6] font-medium tabular-nums">{completedCount}/{totalCount}</span>
        </div>
      </div>

      {/* 팀이 할 일 */}
      <div className={cn('mx-3 mt-3 rounded-2xl border px-3.5 py-3', color.light, color.border)}>
        <p className={cn('text-[10px] font-bold uppercase tracking-wider mb-2 opacity-60', color.text)}>팀이 할 일</p>
        {guide.teamTasks.map((task, i) => (
          <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
            <span className={cn('text-[10px] font-bold mt-0.5 opacity-50 flex-shrink-0', color.text)}>{i + 1}.</span>
            <p className={cn('text-[11px] leading-snug', color.text, 'opacity-85')}>{task}</p>
          </div>
        ))}
      </div>

      {/* 활동 목록 */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <p className="text-[10px] font-semibold text-[#9AA0A6] uppercase tracking-widest px-2 mb-1.5">활동</p>
        <div className="space-y-0.5">
          {currentStageInfo.activities.map((code, idx) => (
            <ActivityItem
              key={code}
              code={code}
              index={idx}
              isCurrent={code === currentActivity}
              status={activityStatus[code] ?? 'not_started'}
              onClick={() => handleActivityClick(code)}
            />
          ))}
        </div>
      </div>

      {/* 범례 */}
      <div className="px-4 py-2.5 border-t border-[#F1F3F4] flex gap-3">
        <div className="flex items-center gap-1 text-[10px] text-[#9AA0A6]">
          <span className="material-symbols-rounded msf ms-sm text-[#7B1FA2]">shield</span>
          <span>가드레일</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-[#9AA0A6]">
          <span className="material-symbols-rounded msf ms-sm text-[#F9AB00]">star</span>
          <span>평가 먼저</span>
        </div>
      </div>
    </div>
  )
}

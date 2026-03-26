'use client'

import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type ActivityCode, type StageStatus } from '@/types'
import { setProjectActivity } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { CheckCircle, Shield, Star, ChevronRight, AlertTriangle, RotateCcw } from 'lucide-react'

// 단계별 색상
const STAGE_BG: Record<string, string> = {
  T: 'bg-blue-600', A: 'bg-violet-600', Ds: 'bg-emerald-600',
  DI: 'bg-orange-600', E: 'bg-rose-600',
}
const STAGE_LIGHT: Record<string, string> = {
  T: 'bg-blue-50 border-blue-200 text-blue-800',
  A: 'bg-violet-50 border-violet-200 text-violet-800',
  Ds: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  DI: 'bg-orange-50 border-orange-200 text-orange-800',
  E: 'bg-rose-50 border-rose-200 text-rose-800',
}

// 단계 설명 (팀이 해야 할 일)
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
    teamTasks: ['평가계획을 먼저 확정해요 (Backward Design)', '학습자 프로필을 모든 설계에 반영해요', '활동-평가 정합성을 팀이 함께 확인해요'],
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

const STATUS_STYLE: Record<StageStatus, { dot: string; text: string }> = {
  not_started:   { dot: 'bg-gray-300', text: 'text-gray-400' },
  in_progress:   { dot: 'bg-blue-500 animate-pulse', text: 'text-gray-700 font-medium' },
  completed:     { dot: 'bg-green-500', text: 'text-green-700' },
  warning:       { dot: 'bg-yellow-400', text: 'text-yellow-700' },
  active_return: { dot: 'bg-orange-400', text: 'text-orange-700' },
}

function ActivityItem({ code, isCurrent, status, index, onClick }: {
  code: ActivityCode; isCurrent: boolean; status: StageStatus; index: number; onClick: () => void
}) {
  const meta = ACTIVITY_META[code]
  const style = STATUS_STYLE[status]

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all',
        isCurrent
          ? 'bg-white shadow-sm border border-blue-200 ring-1 ring-blue-300'
          : 'hover:bg-white/60 text-gray-600'
      )}
    >
      {/* 번호 */}
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0',
        isCurrent ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
      )}>
        {index + 1}
      </div>

      {/* 레이블 */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs leading-tight truncate', isCurrent ? 'font-bold text-gray-900' : style.text)}>
          {meta.label}
        </p>
        {isCurrent && (
          <p className="text-[10px] text-blue-500 mt-0.5">진행 중</p>
        )}
        {!isCurrent && status === 'warning' && (
          <p className="text-[10px] text-yellow-600 mt-0.5">건너뜀</p>
        )}
        {!isCurrent && status === 'completed' && (
          <p className="text-[10px] text-green-600 mt-0.5">완료</p>
        )}
        {!isCurrent && status === 'active_return' && (
          <p className="text-[10px] text-orange-600 mt-0.5">재진행 중</p>
        )}
      </div>

      {/* 아이콘 */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {meta.isGuardrailSource && <Shield className="w-3 h-3 text-purple-500" />}
        {meta.isBackwardDesignFirst && <Star className="w-3 h-3 text-amber-500" />}
        {status === 'completed' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
        {status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
        {status === 'active_return' && !isCurrent && <RotateCcw className="w-3.5 h-3.5 text-orange-500" />}
        {isCurrent && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
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
  const completedCount = currentStageInfo.activities.filter(a => activityStatus[a] === 'completed').length
  const totalCount = currentStageInfo.activities.length
  const currentIdx = currentStageInfo.activities.indexOf(currentActivity)

  function handleActivityClick(code: ActivityCode) {
    if (code === currentActivity) return
    setCurrentActivity(code)
    // setMessages([])는 watchMessages effect가 currentActivity 변경을 감지하여 처리
    // Firestore 동기화 → 모든 팀원에게 현재 활동 공유
    setProjectActivity(project!.id, code).catch(console.error)
  }

  return (
    <div className="w-60 flex-shrink-0 flex flex-col bg-gray-50/80 border-r border-gray-200 overflow-hidden">

      {/* ── 단계 헤더 (크고 명확하게) ── */}
      <div className={cn('px-4 pt-4 pb-3 border-b border-gray-200')}>
        {/* 단계 배지 */}
        <div className="flex items-center gap-2 mb-2">
          <div className={cn('px-2.5 py-1 rounded-lg text-white text-xs font-black tracking-wide', STAGE_BG[currentStage])}>
            {currentStage}
          </div>
          <span className="text-base font-black text-gray-900">{currentStageInfo.label}</span>
        </div>

        {/* 목표 */}
        <p className="text-[11px] text-gray-600 leading-snug mb-2">{guide.goal}</p>

        {/* 진행률 바 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', STAGE_BG[currentStage])}
              style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 font-medium">{completedCount}/{totalCount}</span>
        </div>
      </div>

      {/* ── 팀이 해야 할 일 ── */}
      <div className={cn('mx-3 mt-3 rounded-xl border px-3 py-2.5', STAGE_LIGHT[currentStage])}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 opacity-70">팀이 할 일</p>
        {guide.teamTasks.map((task, i) => (
          <div key={i} className="flex items-start gap-1.5 mb-1 last:mb-0">
            <span className="text-[10px] font-bold mt-0.5 opacity-60">{i + 1}.</span>
            <p className={cn('text-[11px] leading-snug', i === currentIdx ? 'font-bold' : 'opacity-80')}>
              {task}
            </p>
          </div>
        ))}
      </div>

      {/* ── 활동 목록 ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-1 mb-2">활동</p>
        <div className="space-y-1">
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

      {/* ── 아이콘 범례 ── */}
      <div className="px-4 py-2.5 border-t border-gray-200 flex gap-4">
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <Shield className="w-3 h-3 text-purple-500" /><span>가드레일</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <Star className="w-3 h-3 text-amber-500" /><span>평가 먼저</span>
        </div>
      </div>
    </div>
  )
}

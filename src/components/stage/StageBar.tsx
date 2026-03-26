'use client'

import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type StageCode, type StageStatus } from '@/types'
import { CheckCircle, AlertTriangle, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

const STAGE_COLORS: Record<StageCode, { active: string; progress: string; ring: string; text: string }> = {
  T:  { active: 'bg-blue-500',    progress: 'bg-blue-400',    ring: 'ring-blue-300',   text: 'text-blue-600'   },
  A:  { active: 'bg-violet-500',  progress: 'bg-violet-400',  ring: 'ring-violet-300', text: 'text-violet-600' },
  Ds: { active: 'bg-emerald-500', progress: 'bg-emerald-400', ring: 'ring-emerald-300',text: 'text-emerald-600'},
  DI: { active: 'bg-orange-500',  progress: 'bg-orange-400',  ring: 'ring-orange-300', text: 'text-orange-600' },
  E:  { active: 'bg-rose-500',    progress: 'bg-rose-400',    ring: 'ring-rose-300',   text: 'text-rose-600'   },
}

// ─── E→T 순환 화살표 ──────────────────────────────────
function CycleArrow() {
  return (
    <div className="absolute -top-8 left-0 right-0 pointer-events-none flex justify-center">
      <svg width="320" height="28" viewBox="0 0 320 28">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#16a34a" />
          </marker>
        </defs>
        <path d="M 290 20 C 290 5, 30 5, 30 20" fill="none" stroke="#16a34a"
          strokeWidth="2" strokeDasharray="6,3" markerEnd="url(#arrowhead)" />
        <text x="155" y="10" textAnchor="middle" fill="#16a34a" fontSize="10">새로운 주기</text>
      </svg>
    </div>
  )
}

// ─── 연결선 ───────────────────────────────────────────
function Connector({ isActive }: { isActive: boolean }) {
  return (
    <div className="flex items-center px-1 flex-shrink-0">
      <div className={cn('h-0.5 w-5 rounded', isActive ? 'bg-blue-400' : 'bg-gray-200')} />
      <div className={cn('w-0 h-0 border-y-4 border-y-transparent border-l-4',
        isActive ? 'border-l-blue-400' : 'border-l-gray-200')} />
    </div>
  )
}

// ─── 단계 노드 ────────────────────────────────────────
function StageNode({
  stage, status, isCurrent, completedCount, totalCount, onClick,
}: {
  stage: typeof STAGES[number]
  status: StageStatus
  isCurrent: boolean
  completedCount: number
  totalCount: number
  onClick: () => void
}) {
  const color = STAGE_COLORS[stage.code]
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  if (isCurrent) {
    // ── 현재 단계: 크고 강조된 카드 ──
    return (
      <button
        onClick={onClick}
        className={cn(
          'relative flex flex-col items-center gap-1.5 px-5 py-3 rounded-2xl border-0',
          'transition-all duration-200 min-w-[96px]',
          color.active, 'text-white shadow-lg',
          `ring-4 ${color.ring} ring-offset-2`
        )}
      >
        {/* 단계 코드 + 라벨 */}
        <div className="flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5 opacity-80" />
          <span className="text-base font-black tracking-wide">{stage.code}</span>
        </div>
        <span className="text-[12px] font-semibold opacity-90">{stage.label}</span>

        {/* 진행률 바 */}
        <div className="w-full mt-0.5">
          <div className="w-full h-1.5 bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[10px] text-white/80 text-right mt-0.5">{completedCount}/{totalCount}</p>
        </div>
      </button>
    )
  }

  // ── 비현재 단계: 작고 조용한 노드 ──
  const isDone = status === 'completed'
  const isWarn = status === 'warning'

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all duration-200 min-w-[72px]',
        isDone
          ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
          : isWarn
          ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
          : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
      )}
    >
      <div className="flex items-center gap-1 text-sm font-bold">
        {isDone ? <CheckCircle className="w-3 h-3" /> :
         isWarn  ? <AlertTriangle className="w-3 h-3" /> :
                   <Circle className="w-3 h-3" />}
        <span>{stage.code}</span>
      </div>
      <span className="text-[11px] font-medium whitespace-nowrap">{stage.label}</span>

      {/* 진행률 바 (시작된 경우에만) */}
      {completedCount > 0 && (
        <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full', isDone ? 'bg-green-400' : color.progress)}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </button>
  )
}

// ─── 메인 StageBar ────────────────────────────────────
export function StageBar() {
  const { project, activityStatus, setPendingStageMove } = useProjectStore()
  if (!project) return null

  const currentStage = project.currentStage
  const isECompleted = project.isECompleted
  const isA23Completed = project.isA23Completed

  function getStageStatus(stageCode: StageCode): StageStatus {
    const stageInfo = STAGES.find(s => s.code === stageCode)!
    const statuses = stageInfo.activities.map(a => activityStatus[a] ?? 'not_started')
    if (statuses.every(s => s === 'completed')) return 'completed'
    if (stageCode === currentStage) return 'in_progress'
    if (statuses.some(s => s === 'warning')) return 'warning'
    if (statuses.some(s => s === 'active_return')) return 'active_return'
    if (statuses.some(s => s !== 'not_started')) return 'in_progress'
    return 'not_started'
  }

  function getCompletedCount(stageCode: StageCode) {
    const stageInfo = STAGES.find(s => s.code === stageCode)!
    return stageInfo.activities.filter(a => activityStatus[a] === 'completed').length
  }

  return (
    <div className="relative bg-white border-b border-gray-200 px-6 py-3">
      {isECompleted && <CycleArrow />}

      <div className="flex items-center justify-center gap-0 mt-1">
        {STAGES.map((stage, idx) => {
          const status = getStageStatus(stage.code)
          const isCurrent = stage.code === currentStage
          const completedCount = getCompletedCount(stage.code)
          const totalCount = stage.activities.length

          return (
            <div key={stage.code} className="flex items-center">
              <StageNode
                stage={stage}
                status={status}
                isCurrent={isCurrent}
                completedCount={completedCount}
                totalCount={totalCount}
                onClick={() => {
                  if (stage.code !== currentStage) setPendingStageMove(stage.code)
                }}
              />
              {idx < STAGES.length - 1 && (
                <Connector isActive={STAGES.findIndex(s => s.code === currentStage) > idx} />
              )}
            </div>
          )
        })}
      </div>

      {/* 가드레일 표시 */}
      {isA23Completed && (
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200">
            🛡 학습자 프로필 가드레일 적용 중
          </span>
        </div>
      )}
    </div>
  )
}

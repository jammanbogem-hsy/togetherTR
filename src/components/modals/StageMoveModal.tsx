'use client'

import { useState } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type StageCode } from '@/types'
import { cn } from '@/lib/utils'
import { ArrowRight, AlertTriangle, X } from 'lucide-react'

function getStageLabel(code: StageCode) {
  return STAGES.find(s => s.code === code)?.label ?? code
}

function getIncompleteActivities(
  fromStage: StageCode,
  activityStatus: Record<string, string>
): string[] {
  const stageInfo = STAGES.find(s => s.code === fromStage)
  if (!stageInfo) return []
  return stageInfo.activities
    .filter(a => activityStatus[a] !== 'completed')
    .map(a => ACTIVITY_META[a].label)
}

export function StageMoveModal() {
  const {
    project,
    pendingStageMove,
    setPendingStageMove,
    activityStatus,
    setCurrentActivity,
    setMessages,
  } = useProjectStore()

  const [reason, setReason] = useState('')

  if (!project || !pendingStageMove) return null

  const fromStage = project.currentStage
  const toStage = pendingStageMove
  const incompleteActivities = getIncompleteActivities(fromStage, activityStatus)
  const isBackward = STAGES.findIndex(s => s.code === toStage) <
    STAGES.findIndex(s => s.code === fromStage)
  const isCycle = fromStage === 'E' && toStage === 'T'

  function handleConfirm() {
    if (!project) return

    // 대상 단계의 첫 번째 활동으로 이동
    const targetStage = STAGES.find(s => s.code === toStage)
    if (targetStage) {
      setCurrentActivity(targetStage.activities[0])
      setMessages([])
    }

    // TODO: Firestore에 단계 전환 기록 저장 (logStageTransition)
    setPendingStageMove(null)
    setReason('')
  }

  function handleCancel() {
    setPendingStageMove(null)
    setReason('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className={cn(
          'px-6 py-4 flex items-center justify-between',
          isCycle ? 'bg-green-50' : isBackward ? 'bg-amber-50' : 'bg-blue-50'
        )}>
          <div>
            <h2 className="font-bold text-gray-900">
              {isCycle ? '새로운 설계 주기 시작' : isBackward ? '이전 단계로 이동' : '다음 단계로 이동'}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium text-gray-600">
                {fromStage} · {getStageLabel(fromStage)}
              </span>
              <ArrowRight className="w-4 h-4 text-gray-400" />
              <span className={cn(
                'text-sm font-bold',
                isCycle ? 'text-green-700' : isBackward ? 'text-amber-700' : 'text-blue-700'
              )}>
                {toStage} · {getStageLabel(toStage)}
              </span>
            </div>
          </div>
          <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 미완료 활동 경고 */}
          {incompleteActivities.length > 0 && !isBackward && (
            <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">미완료 활동이 있습니다</p>
                <ul className="mt-1 space-y-0.5">
                  {incompleteActivities.map(label => (
                    <li key={label} className="text-xs text-amber-700">· {label}</li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 mt-1">계속 진행하면 미완료 상태로 넘어갑니다.</p>
              </div>
            </div>
          )}

          {/* 사이클 안내 */}
          {isCycle && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <p className="text-sm text-green-800">
                평가 단계 성찰을 바탕으로 <strong>주기 {(project.cycleCount ?? 1) + 1}</strong>를
                시작합니다. T 단계부터 새로운 시각으로 설계를 개선해보세요.
              </p>
            </div>
          )}

          {/* 이동 이유 입력 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              이동 이유 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={
                isBackward
                  ? '어떤 부분을 수정하거나 보완하려 하시나요?'
                  : isCycle
                  ? '이번 주기에서 개선하고 싶은 점은 무엇인가요?'
                  : '다음 단계로 이동하는 이유를 간단히 적어주세요'
              }
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2
                         text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* 버튼 */}
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm
                         font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleConfirm}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors',
                isCycle ? 'bg-green-500 hover:bg-green-600'
                  : isBackward ? 'bg-amber-500 hover:bg-amber-600'
                  : 'bg-blue-500 hover:bg-blue-600'
              )}
            >
              {isCycle ? '새 주기 시작' : isBackward ? '이전으로 이동' : '다음으로 이동'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

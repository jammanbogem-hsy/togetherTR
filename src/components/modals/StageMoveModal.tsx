'use client'

import { useState } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type StageCode } from '@/types'
import { returnToActivity, advanceActivity, logStageTransition } from '@/lib/firebase/projects'
import { auth } from '@/lib/firebase/config'
import { cn } from '@/lib/utils'
import { ArrowRight, X, Warning, ChartBar } from '@phosphor-icons/react'
import { StageAnalysisModal } from '@/components/modals/StageAnalysisModal'
import { setAnalysisOpen } from '@/lib/firebase/projects'

function getStageLabel(code: StageCode) {
  return STAGES.find(s => s.code === code)?.label ?? code
}

function getIncompleteActivities(
  fromStage: StageCode,
  activityStatus: Record<string, string>,
  artifacts: Record<string, { status?: string }> | undefined
): string[] {
  const stageInfo = STAGES.find(s => s.code === fromStage)
  if (!stageInfo) return []
  return stageInfo.activities
    .filter(a => {
      // 산출물이 confirmed이거나 activityStatus가 completed/warning이면 완료로 간주 (ActivitySidebar와 동일 기준)
      const artifactConfirmed = artifacts?.[a]?.status === 'confirmed'
      const statusDone = activityStatus[a] === 'completed' || activityStatus[a] === 'warning'
      return !artifactConfirmed && !statusDone
    })
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
    userProfile,
  } = useProjectStore()

  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)

  const isHost = project?.hostUid === auth.currentUser?.uid
  if (!project || !pendingStageMove || !isHost) return null

  const fromStage = project.currentStage
  const toStage = pendingStageMove
  const incompleteActivities = getIncompleteActivities(fromStage, activityStatus, project.artifacts as Record<string, { status?: string }> | undefined)
  const isBackward = STAGES.findIndex(s => s.code === toStage) <
    STAGES.findIndex(s => s.code === fromStage)
  const isCycle = fromStage === 'E' && toStage === 'T'

  async function handleConfirm() {
    if (!project) return

    const trimmedReason = reason.trim()
    // spec(07.절차프롬프트_v2 "이동 사유 기록 필수") — 모든 방향에서 사유 필수화
    if (!trimmedReason) {
      setReasonError('이동 사유를 입력해주세요. (T-CID 모형: 단계 이동 사유 기록 필수)')
      return
    }
    setReasonError(null)
    setSubmitError(null)

    const targetStage = STAGES.find(s => s.code === toStage)
    if (!targetStage) return

    const firstActivity = targetStage.activities[0]
    const direction: import('@/types').StageTransition['direction'] =
      isCycle ? 'cycle' : isBackward ? 'backward' : 'forward'
    const baseCycle = project.cycleCount ?? 1
    const cycleNumber = isCycle ? baseCycle + 1 : baseCycle
    // initiatedBy: Firestore rules가 request.auth.uid와 일치 강제 (data-architect 협의)
    // userProfile.uid는 onAuthStateChanged 동기화 값이지만 race 안전을 위해 auth.currentUser 우선
    const initiatedBy = auth?.currentUser?.uid ?? userProfile?.uid
    if (!initiatedBy) {
      setSubmitError('로그인 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.')
      return
    }

    setSubmitting(true)

    // 안전망: Firestore 호출이 무기한 hang 되면(HMR 중 click 등) 자동 reset.
    // 개발 환경 HMR 재컴파일이 길어질 때(>10s)는 보호 timeout이 너무 일찍 발동하지 않도록
    // 30초로 충분히 늘려둠. 진짜 네트워크 장애도 30초 안에 SDK가 자체 reject한다.
    const withTimeout = <T,>(promise: Promise<T>, label: string, ms = 30000): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => {
          reject(new Error(`[stage-move:${label}] timeout after ${ms}ms — Firestore 호출이 응답하지 않습니다.`))
        }, ms)
        promise.then(v => { clearTimeout(t); resolve(v) }).catch(e => { clearTimeout(t); reject(e) })
      })
    }

    try {
      console.time('[StageMoveModal] logStageTransition')
      // 이력을 먼저 기록 (실패 시 이동 중단 — 감사 추적이 spec 명시 사항이므로 데이터 정합성 우선)
      await withTimeout(logStageTransition(project.id, {
        fromStage,
        toStage,
        direction,
        cycleNumber,
        reason: trimmedReason,
        ...(incompleteActivities.length > 0 && !isBackward
          ? { missingItemsIgnored: incompleteActivities }
          : {}),
        initiatedBy,
      }), 'logStageTransition')
      console.timeEnd('[StageMoveModal] logStageTransition')

      if (isBackward || isCycle) {
        console.time('[StageMoveModal] returnToActivity')
        // 이전 단계로 이동: returnToActivity + currentStage 업데이트
        await withTimeout(returnToActivity(project.id, firstActivity, toStage), 'returnToActivity')
        console.timeEnd('[StageMoveModal] returnToActivity')
      } else {
        console.time('[StageMoveModal] advanceActivity')
        // 다음 단계로 이동: 현재 스테이지 activities + 다음 스테이지 activities 합쳐서 advance
        const currentStageInfo = STAGES.find(s => s.code === fromStage)!
        const combinedActivities = [
          ...currentStageInfo.activities,
          ...targetStage.activities,
        ] as import('@/types').ActivityCode[]
        const currentActivityCode = project.currentActivity ?? currentStageInfo.activities[0]
        await withTimeout(advanceActivity(
          project.id,
          combinedActivities,
          currentActivityCode as import('@/types').ActivityCode,
          firstActivity,
          toStage
        ), 'advanceActivity')
        console.timeEnd('[StageMoveModal] advanceActivity')
      }
    } catch (err) {
      console.error('[StageMoveModal] handleConfirm failed:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitError(
        msg.includes('timeout')
          ? '저장 응답이 30초 이상 지연됩니다. 개발 서버 HMR 재컴파일이 길어진 경우가 많습니다 — 브라우저를 하드 새로고침(⌘+Shift+R)한 뒤 다시 시도해 주세요.'
          : `이동 이력 저장에 실패했습니다 (${msg.slice(0, 80)}). 잠시 후 다시 시도해 주세요.`
      )
      setSubmitting(false)
      return
    }

    // 로컬 상태도 즉시 반영
    setCurrentActivity(firstActivity)
    setMessages([])
    setPendingStageMove(null)
    setReason('')
    setSubmitting(false)
  }

  function handleCancel() {
    setPendingStageMove(null)
    setReason('')
    setReasonError(null)
    setSubmitError(null)
  }

  return (
    <>
    {showAnalysis && <StageAnalysisModal onClose={() => {
      setShowAnalysis(false)
      if (project?.id) setAnalysisOpen(project.id, false).catch(console.error)
    }} />}
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className={cn(
          'px-6 py-4 flex items-center justify-between',
          isCycle ? 'bg-[#E6F4EA]' : isBackward ? 'bg-[#FFF3E0]' : 'bg-[#E8F0FE]'
        )}>
          <div>
            <h2 className="font-bold text-[#202124]">
              {isCycle ? '새로운 설계 주기 시작' : isBackward ? '이전 단계로 이동' : '다음 단계로 이동'}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium text-[#5F6368]">
                {fromStage} · {getStageLabel(fromStage)}
              </span>
              <ArrowRight size={16} weight="regular" className="text-[#9AA0A6]" />
              <span className={cn(
                'text-sm font-bold',
                isCycle ? 'text-[#137333]' : isBackward ? 'text-[#E65100]' : 'text-[#1A73E8]'
              )}>
                {toStage} · {getStageLabel(toStage)}
              </span>
            </div>
          </div>
          <button onClick={handleCancel} className="text-[#9AA0A6] hover:text-[#5F6368]">
            <X size={16} weight="regular" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 미완료 활동 경고 */}
          {incompleteActivities.length > 0 && !isBackward && (
            <div className="flex gap-3 bg-[#FFF3E0] border border-[#FFCC80] rounded-2xl p-3">
              <Warning size={16} weight="fill" className="text-[#E65100] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#BF360C]">미완료 활동이 있습니다</p>
                <ul className="mt-1 space-y-0.5">
                  {incompleteActivities.map(label => (
                    <li key={label} className="text-xs text-[#E65100]">· {label}</li>
                  ))}
                </ul>
                <p className="text-xs text-[#E65100] mt-1">계속 진행하면 미완료 상태로 넘어갑니다.</p>
              </div>
            </div>
          )}

          {/* 사이클 안내 */}
          {isCycle && (
            <div className="bg-[#E6F4EA] border border-[#81C995] rounded-2xl p-3">
              <p className="text-sm text-[#1E4620]">
                평가 단계 성찰을 바탕으로 <strong>주기 {(project.cycleCount ?? 1) + 1}</strong>를
                시작합니다. T 단계부터 새로운 시각으로 설계를 개선해보세요.
              </p>
            </div>
          )}

          {/* 이동 이유 입력 (T-CID 모형: 이동 사유 기록 필수) */}
          <div>
            <label className="block text-sm font-medium text-[#202124] mb-1.5">
              이동 이유 <span className="text-[#D93025] font-semibold">(필수)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => {
                setReason(e.target.value)
                if (reasonError && e.target.value.trim()) setReasonError(null)
              }}
              placeholder={
                isBackward
                  ? '어떤 부분을 수정하거나 보완하려 하시나요?'
                  : isCycle
                  ? '이번 주기에서 개선하고 싶은 점은 무엇인가요?'
                  : '다음 단계로 이동하는 이유를 간단히 적어주세요'
              }
              rows={3}
              aria-invalid={!!reasonError}
              className={cn(
                'w-full resize-none rounded-2xl border px-3 py-2',
                'text-sm focus:outline-none focus:ring-2 text-[#202124]',
                reasonError
                  ? 'border-[#D93025] focus:ring-[#D93025]'
                  : 'border-[#DADCE0] focus:ring-[#1A73E8]'
              )}
            />
            {reasonError && (
              <p className="mt-1.5 text-xs text-[#D93025]">{reasonError}</p>
            )}
          </div>

          {/* 이력 저장 실패 등 제출 에러 (인라인 표시 — 모달은 닫지 않음) */}
          {submitError && (
            <div className="flex gap-2 items-start bg-[#FCE8E6] border border-[#F28B82] rounded-2xl p-3">
              <Warning size={16} weight="fill" className="text-[#C5221F] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#C5221F]">{submitError}</p>
            </div>
          )}

          {/* 현재 단계 분석 제안 (다음 단계 이동 시만 표시) */}
          {!isBackward && !isCycle && (
            <div className="relative rounded-2xl overflow-hidden p-[1.5px]"
              style={{ background: 'linear-gradient(135deg, #1A73E8, #7B2FF7, #1A73E8)', backgroundSize: '200% 200%', animation: 'gradient-shift 3s ease infinite' }}
            >
              <div className="relative bg-[#F0F4FF] rounded-[14px] p-4 flex items-center gap-4">
                {/* 배경 빛번짐 */}
                <div className="absolute inset-0 rounded-[14px] pointer-events-none"
                  style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(26,115,232,0.12) 0%, transparent 70%)', animation: 'pulse-glow 2s ease-in-out infinite' }}
                />
                <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl"
                  style={{ background: 'linear-gradient(135deg, #1A73E8, #7B2FF7)', boxShadow: '0 0 16px rgba(26,115,232,0.5)', animation: 'icon-pulse 2s ease-in-out infinite' }}
                >
                  <ChartBar size={18} weight="fill" className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-[#1A1F6B]">현재 단계 분석하기</p>
                  <p className="text-xs text-[#5F6368] mt-0.5">다음 단계로 넘어가기 전에 {fromStage}단계 산출물을 T-CID 관점에서 분석합니다.</p>
                </div>
                <button
                  onClick={() => {
                    setShowAnalysis(true)
                    if (project?.id) setAnalysisOpen(project.id, true).catch(console.error)
                  }}
                  className="relative flex-shrink-0 px-4 py-2 rounded-full text-sm font-extrabold text-white overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, #1A73E8, #7B2FF7)',
                    boxShadow: '0 0 18px rgba(26,115,232,0.6), 0 0 36px rgba(123,47,247,0.3)',
                    animation: 'btn-glow 2s ease-in-out infinite',
                  }}
                >
                  {/* 빛 sweeping 효과 */}
                  <span className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%)', backgroundSize: '200% 100%', animation: 'shine-sweep 2.4s linear infinite' }}
                  />
                  <span className="relative">분석 보기 ✦</span>
                </button>
              </div>
              <style>{`
                @keyframes gradient-shift {
                  0%, 100% { background-position: 0% 50%; }
                  50% { background-position: 100% 50%; }
                }
                @keyframes pulse-glow {
                  0%, 100% { opacity: 0.6; }
                  50% { opacity: 1; }
                }
                @keyframes icon-pulse {
                  0%, 100% { box-shadow: 0 0 16px rgba(26,115,232,0.5); transform: scale(1); }
                  50% { box-shadow: 0 0 28px rgba(123,47,247,0.7); transform: scale(1.08); }
                }
                @keyframes btn-glow {
                  0%, 100% { box-shadow: 0 0 18px rgba(26,115,232,0.6), 0 0 36px rgba(123,47,247,0.3); }
                  50% { box-shadow: 0 0 28px rgba(26,115,232,0.9), 0 0 56px rgba(123,47,247,0.5); }
                }
                @keyframes shine-sweep {
                  0% { background-position: -100% 0; }
                  100% { background-position: 200% 0; }
                }
              `}</style>
            </div>
          )}

          {/* 버튼 */}
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-full border border-[#DADCE0] text-sm
                         font-medium text-[#5F6368] hover:bg-[#F1F3F4] transition-colors
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              취소
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting || reason.trim() === ''}
              className={cn(
                'flex-1 py-2.5 rounded-full text-sm font-bold text-white transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isCycle ? 'bg-[#34A853] hover:bg-[#2d9248]'
                  : isBackward ? 'bg-[#E65100] hover:bg-[#cc4700]'
                  : 'bg-[#1A73E8] hover:bg-[#1557b0]'
              )}
            >
              {submitting
                ? '저장 중...'
                : isCycle ? '새 주기 시작' : isBackward ? '이전으로 이동' : '다음으로 이동'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}

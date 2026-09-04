'use client'

import { useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, SOLO_HIDDEN_ACTIVITIES, type StageCode } from '@/types'
import {
  returnToActivity,
  advanceActivity,
  logStageTransition,
  ensureProjectMemberUid,
} from '@/lib/firebase/projects'
import { auth } from '@/lib/firebase/config'
import { cn } from '@/lib/utils'
import { ArrowRight, X, Warning, ChartBar } from '@phosphor-icons/react'
import { StageAnalysisModal } from '@/components/modals/StageAnalysisModal'
import { setAnalysisOpen } from '@/lib/firebase/projects'
import { isEffectivelyDone } from '@/lib/activity/completion'
import {
  completedCycleNumberForTransition,
  nextCycleNumber,
  resolveStageTransitionDirection,
  shouldChooseEToTTransition,
} from '@/lib/activity/cycle'

type EToTMoveChoice = 'move' | 'new-cycle'

function getStageLabel(code: StageCode) {
  return STAGES.find(s => s.code === code)?.label ?? code
}

function getIncompleteActivities(
  fromStage: StageCode,
  activityStatus: Record<string, string>,
  artifacts: Record<string, { status?: string }> | undefined,
  isSolo: boolean
): string[] {
  const stageInfo = STAGES.find(s => s.code === fromStage)
  if (!stageInfo) return []
  return stageInfo.activities
    // solo에서 숨긴 활동은 미완료 경고 목록에도 노출하지 않는다.
    .filter(a => !(isSolo && SOLO_HIDDEN_ACTIVITIES.includes(a)))
    .filter(a => {
      return !isEffectivelyDone(
        a,
        activityStatus as Parameters<typeof isEffectivelyDone>[1],
        artifacts as Parameters<typeof isEffectivelyDone>[2],
      )
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

  const [eToTMoveChoice, setEToTMoveChoice] = useState<EToTMoveChoice | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const submittingRef = useRef(false)

  const currentUid = auth.currentUser?.uid ?? userProfile?.uid
  const isHost = project?.hostUid === currentUid || project?.createdBy === currentUid
  const isSameStageMove = !!project && !!pendingStageMove && project.currentStage === pendingStageMove

  if (!project || !pendingStageMove || !isHost || isSameStageMove) return null

  const fromStage = project.currentStage
  const toStage = pendingStageMove
  const isSolo = project.mode === 'solo'
  const incompleteActivities = getIncompleteActivities(fromStage, activityStatus, project.artifacts as Record<string, { status?: string }> | undefined, isSolo)
  const isBackward = STAGES.findIndex(s => s.code === toStage) <
    STAGES.findIndex(s => s.code === fromStage)
  const currentStageDone = incompleteActivities.length === 0
  const needsEToTMoveChoice = shouldChooseEToTTransition(fromStage, toStage, currentStageDone)
  const isStartingNewCycle = needsEToTMoveChoice && eToTMoveChoice === 'new-cycle'

  async function handleConfirm() {
    if (!project || submittingRef.current) return

    if (needsEToTMoveChoice && !eToTMoveChoice) {
      setSubmitError('T 단계로 이동할 방식을 선택해주세요.')
      return
    }
    setSubmitError(null)

    const targetStage = STAGES.find(s => s.code === toStage)
    if (!targetStage) return

    // solo는 대상 단계의 첫 "표시" 활동으로 진입한다 (예: A 단계는 숨김인 A-1-1 대신 A-1-2).
    const firstActivity = isSolo
      ? (targetStage.activities.find(a => !SOLO_HIDDEN_ACTIVITIES.includes(a)) ?? targetStage.activities[0])
      : targetStage.activities[0]
    const direction: import('@/types').StageTransition['direction'] =
      resolveStageTransitionDirection(fromStage, toStage, isStartingNewCycle)
    const completedCycle = completedCycleNumberForTransition(project)
    const cycleNumber = completedCycle
    // initiatedBy: Firestore rules가 request.auth.uid와 일치 강제 (data-architect 협의)
    // userProfile.uid는 onAuthStateChanged 동기화 값이지만 race 안전을 위해 auth.currentUser 우선
    const initiatedBy = auth?.currentUser?.uid ?? userProfile?.uid
    if (!initiatedBy) {
      setSubmitError('로그인 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.')
      return
    }

    submittingRef.current = true
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

    const transitionLogPayload = {
      fromStage,
      toStage,
      direction,
      cycleNumber,
      // 사용자에게 사유를 요구하지 않고 선택한 이동 유형만 이력으로 남긴다.
      reason: direction === 'cycle'
        ? '새 주기 시작'
        : direction === 'backward'
          ? '이전 단계로 이동'
          : '다음 단계로 이동',
      ...(incompleteActivities.length > 0 && !isBackward
        ? { missingItemsIgnored: incompleteActivities }
        : {}),
      initiatedBy,
    }

    try {
      if (!(project.memberUids ?? []).includes(initiatedBy)) {
        await withTimeout(ensureProjectMemberUid(project.id, initiatedBy, userProfile ? {
          displayName: userProfile.displayName,
          color: userProfile.color ?? '#A0BCE8',
          emoji: userProfile.emoji ?? '👤',
        } : undefined), 'ensureProjectMemberUid', 8000)
      }

      if (direction !== 'forward') {
        // 이전 단계로 이동: returnToActivity + currentStage 업데이트
        await withTimeout(returnToActivity(project.id, firstActivity, toStage), 'returnToActivity')
      } else {
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
      }
      await withTimeout(logStageTransition(project.id, transitionLogPayload), 'logStageTransition')
    } catch (err) {
      console.error('[StageMoveModal] handleConfirm failed:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitError(
        msg.includes('timeout')
          ? '저장 응답이 30초 이상 지연됩니다. 개발 서버 HMR 재컴파일이 길어진 경우가 많습니다 — 브라우저를 하드 새로고침(⌘+Shift+R)한 뒤 다시 시도해 주세요.'
          : `단계 이동 저장에 실패했습니다 (${msg.slice(0, 80)}). 잠시 후 다시 시도해 주세요.`
      )
      submittingRef.current = false
      setSubmitting(false)
      return
    }

    // 로컬 상태도 즉시 반영
    setCurrentActivity(firstActivity)
    setMessages([])
    setPendingStageMove(null)
    setEToTMoveChoice(null)
    submittingRef.current = false
    setSubmitting(false)

  }

  function handleCancel() {
    if (submittingRef.current) return
    setPendingStageMove(null)
    setEToTMoveChoice(null)
    setSubmitError(null)
  }

  return (
    <>
    {showAnalysis && <StageAnalysisModal onClose={() => {
      setShowAnalysis(false)
      if (project?.id) setAnalysisOpen(project.id, false).catch(console.error)
    }} />}
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stage-move-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        {/* 헤더 */}
        <div className={cn(
          'px-6 py-4 flex items-center justify-between',
          needsEToTMoveChoice ? 'bg-[#E6F4EA]' : isBackward ? 'bg-[#FFF3E0]' : 'bg-[#E8F0FE]'
        )}>
          <div>
            <h2 id="stage-move-title" className="font-bold text-[#202124]">
              {needsEToTMoveChoice ? 'T 단계 이동 방식 선택' : isBackward ? '이전 단계로 이동' : '다음 단계로 이동'}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium text-[#5F6368]">
                {fromStage} · {getStageLabel(fromStage)}
              </span>
              <ArrowRight size={16} weight="regular" className="text-[#9AA0A6]" />
              <span className={cn(
                'text-sm font-bold',
                needsEToTMoveChoice ? 'text-[#137333]' : isBackward ? 'text-[#E65100]' : 'text-[#1A73E8]'
              )}>
                {toStage} · {getStageLabel(toStage)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="단계 이동 창 닫기"
            className="text-[#9AA0A6] hover:text-[#5F6368]"
          >
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

          {/* E 단계 완료 후 E→T: 현재 주기 유지와 새 주기 시작을 명시적으로 선택 */}
          {needsEToTMoveChoice && (
            <fieldset>
              <legend className="text-sm font-semibold text-[#202124] mb-2">
                이동 방식을 선택해주세요
                <span className="text-[#D93025] ml-1">(필수)</span>
              </legend>
              <div className="space-y-2">
                <label className={cn(
                  'flex items-start gap-3 rounded-2xl border-2 px-4 py-3 cursor-pointer transition-colors',
                  'focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-[#1A73E8]',
                  eToTMoveChoice === 'move'
                    ? 'border-[#1A73E8] bg-[#E8F0FE]'
                    : 'border-[#DADCE0] bg-white hover:border-[#AECBFA]'
                )}>
                  <input
                    type="radio"
                    name="e-to-t-move-choice"
                    value="move"
                    checked={eToTMoveChoice === 'move'}
                    onChange={() => {
                      setEToTMoveChoice('move')
                      setSubmitError(null)
                    }}
                    disabled={submitting}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#1A73E8]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#202124]">T 단계로 이동</span>
                    <span className="block mt-0.5 text-xs leading-relaxed text-[#5F6368]">
                      현재 주기 {completedCycleNumberForTransition(project)}를 유지하고 기존 T 단계 내용을 확인·보완합니다.
                    </span>
                  </span>
                </label>

                <label className={cn(
                  'flex items-start gap-3 rounded-2xl border-2 px-4 py-3 cursor-pointer transition-colors',
                  'focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-[#34A853]',
                  eToTMoveChoice === 'new-cycle'
                    ? 'border-[#34A853] bg-[#E6F4EA]'
                    : 'border-[#DADCE0] bg-white hover:border-[#81C995]'
                )}>
                  <input
                    type="radio"
                    name="e-to-t-move-choice"
                    value="new-cycle"
                    checked={eToTMoveChoice === 'new-cycle'}
                    onChange={() => {
                      setEToTMoveChoice('new-cycle')
                      setSubmitError(null)
                    }}
                    disabled={submitting}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#34A853]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#137333]">새 주기 시작</span>
                    <span className="block mt-0.5 text-xs leading-relaxed text-[#3C6142]">
                      주기 {nextCycleNumber(completedCycleNumberForTransition(project))}로 전환하고 평가 단계의 성찰을 이어 설계를 개선합니다.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {/* 일반 역방향 이동: 사유 없이 간단 확인만 */}
          {isBackward && !needsEToTMoveChoice && (
            <p className="text-sm text-[#5F6368] leading-relaxed">
              이전 단계로 돌아가 산출물을 다시 보완할 수 있습니다. 진행할까요?
            </p>
          )}

          {/* 이력 저장 실패 등 제출 에러 (인라인 표시 — 모달은 닫지 않음) */}
          {submitError && (
            <div className="flex gap-2 items-start bg-[#FCE8E6] border border-[#F28B82] rounded-2xl p-3">
              <Warning size={16} weight="fill" className="text-[#C5221F] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#C5221F]">{submitError}</p>
            </div>
          )}

          {/* 현재 단계 분석 제안 (다음 단계 이동 시만 표시) */}
          {!isBackward && (
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
              disabled={submitting || (needsEToTMoveChoice && !eToTMoveChoice)}
              className={cn(
                'flex-1 py-2.5 rounded-full text-sm font-bold text-white transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isStartingNewCycle ? 'bg-[#34A853] hover:bg-[#2d9248]'
                  : isBackward ? 'bg-[#E65100] hover:bg-[#cc4700]'
                  : 'bg-[#1A73E8] hover:bg-[#1557b0]'
              )}
            >
              {submitting
                ? '저장 중...'
                : needsEToTMoveChoice
                  ? eToTMoveChoice === 'new-cycle'
                    ? '새 주기 시작'
                    : eToTMoveChoice === 'move'
                      ? 'T 단계로 이동'
                      : '이동 방식 선택'
                  : isBackward ? '이전으로 이동' : '다음으로 이동'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}

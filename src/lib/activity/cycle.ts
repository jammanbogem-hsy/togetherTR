import type { StageCode, StageTransition } from '@/types'

interface CycleState {
  currentCycle?: number
  cycleCount?: number
}

export type NextCycleChoice = 'A' | 'B'

export function completedCycleNumberForTransition(state: CycleState): number {
  return state.currentCycle ?? state.cycleCount ?? 1
}

export function nextCycleNumber(completedCycleNumber: number): number {
  return completedCycleNumber + 1
}

/**
 * E→T 이동은 사용자가 명시적으로 새 주기를 선택했을 때만 cycle이다.
 * 선택하지 않은 E→T는 현재 주기를 유지한 채 T 단계로 돌아가는 backward 이동이다.
 */
export function resolveStageTransitionDirection(
  fromStage: StageCode,
  toStage: StageCode,
  startNewCycle = false,
): StageTransition['direction'] {
  if (fromStage === 'E' && toStage === 'T' && startNewCycle) return 'cycle'

  const stageOrder: StageCode[] = ['T', 'A', 'Ds', 'DI', 'E']
  return stageOrder.indexOf(toStage) < stageOrder.indexOf(fromStage)
    ? 'backward'
    : 'forward'
}

export function shouldChooseEToTTransition(
  fromStage: StageCode,
  toStage: StageCode,
  eStageCompleted: boolean,
): boolean {
  return eStageCompleted && fromStage === 'E' && toStage === 'T'
}

/** 모달에서 내린 명시적 선택을 E 단계 산출물의 이전 선택보다 우선한다. */
export function resolveNextCycleChoice(
  explicitChoice: NextCycleChoice | undefined,
  artifactChoice: NextCycleChoice | undefined,
): NextCycleChoice | undefined {
  return explicitChoice ?? artifactChoice
}

export function hasNewCycleT11Artifact(
  cycleStartVersion: number | undefined,
  currentVersion: number | undefined,
): boolean {
  if (currentVersion === undefined) return false
  return currentVersion > (cycleStartVersion ?? 0)
}

export function shouldOpenCycleTransition(
  eStageCompleted: boolean,
  nextCycleChoice: 'A' | 'B' | undefined,
): boolean {
  return eStageCompleted && nextCycleChoice === 'A'
}

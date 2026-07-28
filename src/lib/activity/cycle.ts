interface CycleState {
  currentCycle?: number
  cycleCount?: number
}

export function completedCycleNumberForTransition(state: CycleState): number {
  return state.currentCycle ?? state.cycleCount ?? 1
}

export function nextCycleNumber(completedCycleNumber: number): number {
  return completedCycleNumber + 1
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

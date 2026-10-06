import type { ProjectMode } from '@/types'

// 2026-07 의 개인·협력 2원화 이전에는 개인 설계 방에도 팀원이 들어올 수 있었다. 그래서 저장값이 'solo' 인데
// 팀원이 여럿인 레거시 방이 있다(예: 6명 방). 화면·프롬프트·참여 판정은 저장값이 아니라 이 함수로 모드를 정한다.
type ModeSource = { mode?: ProjectMode; memberUids?: readonly string[] } | null | undefined

/** 저장값이 solo 여도 멤버가 2명 이상이면 협력 방으로 본다. 1명뿐인 진짜 개인 방만 solo. */
export function effectiveProjectMode(project: ModeSource): ProjectMode {
  if (project?.mode !== 'solo') return 'collaborative'
  return new Set(project.memberUids ?? []).size >= 2 ? 'collaborative' : 'solo'
}

export function isSoloProject(project: ModeSource): boolean {
  return effectiveProjectMode(project) === 'solo'
}

/** 방장이 레거시 방을 열었을 때 저장값도 한 번 맞춘다 — 방장(hostUid·createdBy)만, 이미 맞으면 하지 않는다. */
export function needsProjectModeSync(
  project: (ModeSource & { hostUid?: string; createdBy?: string }) | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (!project || !uid || project.mode !== 'solo') return false
  if (project.hostUid !== uid && project.createdBy !== uid) return false
  return effectiveProjectMode(project) === 'collaborative'
}

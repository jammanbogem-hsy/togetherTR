// 회원 탈퇴 처리 계획 — 순수 함수(명세 docs/privacy-consent-spec.md). API 가 이 계획대로 실행한다.
//  1) 나만 남은 프로젝트(개인 설계 포함): 삭제(하위 컬렉션·업로드 자료 포함)
//  2) 내가 방장인 팀 프로젝트: 남은 팀원 중 가장 먼저 참여한 사람에게 방장(hostUid·createdBy) 이전 후 내 멤버 정보 제거
//  3) 팀원인 팀 프로젝트: 내 멤버 정보만 제거(createdBy 가 나면 현재 방장에게 넘김 — 규칙상 createdBy 도 방장 권한·삭제 권한)
//  4) 팀 프로젝트에 남긴 대화·산출물은 팀의 공동 기록으로 남김
// 재시도해도 안전: 이미 처리된 프로젝트는 다음 조회에서 대상이 아니게 된다.

export interface DeletionProjectLike {
  id: string
  createdBy?: string
  hostUid?: string
  memberUids?: string[]
  memberInfo?: Record<string, { joinedAt?: number } | undefined>
}

export type ProjectDeletionStep =
  | { projectId: string; action: 'delete' }
  | { projectId: string; action: 'transfer'; newHostUid: string; reassignCreatedBy: boolean }
  | { projectId: string; action: 'leave'; reassignCreatedByTo: string | null }

/** 이 프로젝트에 남는 사람(나 제외) — 참여 시각 순, 시각이 없으면 memberUids 순서 */
export function remainingMembers(project: DeletionProjectLike, uid: string): string[] {
  const order = new Map<string, number>()
  ;(project.memberUids ?? []).forEach((member, index) => { if (!order.has(member)) order.set(member, index) })
  for (const extra of [project.createdBy, project.hostUid]) {
    if (extra && !order.has(extra)) order.set(extra, Number.MAX_SAFE_INTEGER)
  }
  order.delete(uid)
  const joined = (member: string) => project.memberInfo?.[member]?.joinedAt
  return [...order.keys()].sort((a, b) => {
    const ja = joined(a), jb = joined(b)
    if (ja !== undefined && jb !== undefined && ja !== jb) return ja - jb
    if (ja !== undefined && jb === undefined) return -1
    if (ja === undefined && jb !== undefined) return 1
    return order.get(a)! - order.get(b)!
  })
}

function isHost(project: DeletionProjectLike, uid: string): boolean {
  return project.hostUid ? project.hostUid === uid : project.createdBy === uid
}

export function planAccountDeletion(projects: readonly DeletionProjectLike[], uid: string): ProjectDeletionStep[] {
  const seen = new Set<string>()
  const steps: ProjectDeletionStep[] = []
  for (const project of projects) {
    if (seen.has(project.id)) continue
    seen.add(project.id)
    const involved = (project.memberUids ?? []).includes(uid) || project.createdBy === uid || project.hostUid === uid
    if (!involved) continue
    const others = remainingMembers(project, uid)
    if (others.length === 0) {
      steps.push({ projectId: project.id, action: 'delete' })
    } else if (isHost(project, uid)) {
      steps.push({ projectId: project.id, action: 'transfer', newHostUid: others[0], reassignCreatedBy: project.createdBy === uid })
    } else {
      const reassignCreatedByTo = project.createdBy === uid ? (project.hostUid && project.hostUid !== uid ? project.hostUid : others[0]) : null
      steps.push({ projectId: project.id, action: 'leave', reassignCreatedByTo })
    }
  }
  return steps
}

/** 멤버에서 빼야 할 필드 경로(남는 프로젝트) — 대화·산출물은 그대로 둔다. */
export function memberRemovalFieldPaths(uid: string): string[] {
  return [`memberInfo.${uid}`, `artifactConfirmations.${uid}`]
}

/** 남는 프로젝트에서 지울 내 presence 문서 컬렉션(공동 편집 커서 표시) */
export const PRESENCE_COLLECTIONS = [
  'teamVisionPresence', 'integratedGoalPresence', 'lessonDesignDirectionPresence', 'evaluationPlanPresence',
  'problemSituationWorkspacePresence', 'supportToolWorkspacePresence', 'roleDistributionPresence', 'teamRulesPresence',
  'teamSchedulePresence', 'topicSelectionPresence', 'learningActivityPresence', 'scaffoldingPresence',
  'materialDevPresence', 'lessonRecordPresence', 'lessonReflectionPresence', 'collaborationReflectionPresence',
] as const

import type { Project } from '@/types'
import { MEMBER_ADMIN_ERROR_COPY, isProjectHost, planMemberRemoval } from '@/lib/project/memberAdmin'

type MemberProject = Pick<Project, 'hostUid' | 'createdBy' | 'memberUids' | 'memberInfo' | 'demoRun'>

export function canManageMembers(project: MemberProject, uid?: string): boolean {
  return !project.demoRun && isProjectHost(project, uid)
}

export function canRemoveMember(project: MemberProject, uid: string | undefined, targetUid: string): boolean {
  return !!uid && canManageMembers(project, uid) && planMemberRemoval(project, uid, targetUid).ok
}

export function memberRemovalError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  return MEMBER_ADMIN_ERROR_COPY[code as keyof typeof MEMBER_ADMIN_ERROR_COPY] ?? '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

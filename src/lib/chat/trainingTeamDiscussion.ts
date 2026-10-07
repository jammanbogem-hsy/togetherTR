import type { ActivityCode, Project } from '@/types'
import { isTrainingProject } from '@/lib/training/trainingMode'
import { clearTeamDiscussionRequest, setTeamDiscussion } from '@/lib/firebase/projects'

/** 기존 연수 방의 공유 팀 토의 플래그만 종료한다. 대화·산출물·활동 상태는 보존한다. */
export async function retireTrainingTeamDiscussion(project: Project, activityCode: ActivityCode, userId?: string): Promise<void> {
  if (!isTrainingProject(project) || !userId || (project.hostUid !== userId && project.createdBy !== userId)) return
  const updates: Promise<void>[] = []
  if (project.teamDiscussions?.[activityCode]?.active) updates.push(setTeamDiscussion(project.id, activityCode, false))
  if (project.teamDiscussionRequests?.[activityCode]?.pending) updates.push(clearTeamDiscussionRequest(project.id, activityCode))
  await Promise.all(updates)
}

import { proposeArtifactToHost } from '@/lib/firebase/projects'

/** 산출물 직접 반영 권한은 방장에게만 두고, 팀원의 편집 내용은 같은 제안 경로로 보낸다. */
export async function sendWorkspaceArtifact<T extends object>({
  isHost, projectId, activityCode, currentUid, currentUserName, content, onSendArtifact,
}: {
  isHost: boolean
  projectId?: string
  activityCode: string
  currentUid?: string
  currentUserName?: string
  content: T
  onSendArtifact: (content: T) => Promise<void>
}): Promise<void> {
  if (isHost) {
    await onSendArtifact(content)
    return
  }
  if (!projectId || !currentUid) throw new Error('프로젝트와 로그인 정보를 확인한 뒤 다시 요청해 주세요.')
  // 기존 제안 필드에 구조화 표와 manualWorkspace를 그대로 보존한다.
  await proposeArtifactToHost(projectId, activityCode, content as Record<string, string>, currentUid, currentUserName ?? '팀원')
}

import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './config'
import type { Project } from '@/types'
import { buildProjectInfoUpdate, type ProjectInfoInput } from '@/lib/projects/projectInfo'

export async function updateProjectInfo(projectId: string, input: ProjectInfoInput): Promise<Partial<Project>> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('로그인이 필요합니다.')
  return runTransaction(db, async transaction => {
    const ref = doc(db, 'projects', projectId)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists()) throw new Error('프로젝트를 찾을 수 없습니다.')
    const project = snapshot.data() as Project
    const isHost = project.hostUid === uid || (!project.demoExperience?.scenarioId && project.createdBy === uid)
    if (!isHost) throw new Error('프로젝트 정보는 기록 담당만 변경할 수 있습니다.')
    const patch = buildProjectInfoUpdate(project, input)
    // Optional legacy row fields must not introduce Firestore undefined values.
    const clean = JSON.parse(JSON.stringify(patch)) as Partial<Project>
    transaction.update(ref, { ...clean, updatedAt: serverTimestamp() })
    return clean
  })
}

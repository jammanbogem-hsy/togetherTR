// 서버 전용. 큐에는 원본 uid/이메일/파일 내용 없이 uid 해시와 프로젝트 prefix만 보관한다.
import { createHash } from 'node:crypto'
import type { Firestore, FieldValue } from 'firebase-admin/firestore'

export const STORAGE_CLEANUP_COLLECTION = 'storageCleanupQueue'
type FieldValues = Pick<typeof FieldValue, 'serverTimestamp' | 'increment'>
export interface CleanupBucket {
  name: string
  deleteFiles(options: { prefix: string }): Promise<unknown>
}
export type CleanupStatus = 'deleted' | 'missing' | 'pending' | 'project-exists' | 'invalid-record'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const storageCleanupOwnerHash = (uid: string) => hash(`account-storage-cleanup:${uid}`)
const queueIdFor = (projectId: string) => hash(`project-storage-cleanup:${projectId}`)
const validProjectId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

/** 프로젝트를 지우기 전에 기록한다. 기록 실패 시 호출자는 프로젝트/계정을 지우지 않는다. */
export async function queueProjectStorageCleanup(
  db: Firestore, values: FieldValues, projectId: string, uid: string, bucketName?: string,
) {
  if (!validProjectId(projectId)) throw new Error('invalid-cleanup-project')
  const ref = db.collection(STORAGE_CLEANUP_COLLECTION).doc(queueIdFor(projectId))
  const uidHash = storageCleanupOwnerHash(uid)
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(ref)
    if (existing.exists) {
      const data = existing.data()!
      if (data.projectId !== projectId || data.uidHash !== uidHash) throw new Error('cleanup-owner-mismatch')
      return
    }
    transaction.set(ref, {
      schemaVersion: 1, projectId, uidHash, paths: [`projects/${projectId}/`],
      bucketName: bucketName ?? null, reason: 'account-deletion',
      createdAt: values.serverTimestamp(), attempts: 0,
    })
  })
  return ref
}

/** 관리자 재시도도 같은 함수를 사용한다. 프로젝트가 남아 있으면 자료 삭제를 차단한다. */
export async function retryStorageCleanup(
  db: Firestore, values: FieldValues, bucket: CleanupBucket | null, queueId: string,
): Promise<CleanupStatus> {
  if (!/^[a-f0-9]{64}$/.test(queueId)) return 'invalid-record'
  const ref = db.collection(STORAGE_CLEANUP_COLLECTION).doc(queueId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return 'missing'
  const data = snapshot.data()!
  if (data.schemaVersion !== 1 || !validProjectId(data.projectId) || queueIdFor(data.projectId) !== queueId
    || !Array.isArray(data.paths) || data.paths.length !== 1 || data.paths[0] !== `projects/${data.projectId}/`
    || !(data.bucketName === null || typeof data.bucketName === 'string')) return 'invalid-record'
  if ((await db.collection('projects').doc(data.projectId).get()).exists) return 'project-exists'

  await ref.update({ attempts: values.increment(1), lastAttemptAt: values.serverTimestamp() })
  if (!bucket || (data.bucketName !== null && data.bucketName !== bucket.name)) {
    await ref.update({ reason: bucket ? 'bucket-mismatch' : 'bucket-unavailable' })
    return 'pending'
  }
  try {
    await bucket.deleteFiles({ prefix: data.paths[0] })
  } catch {
    // SDK 오류 원문에는 파일 경로·토큰이 포함될 수 있어 저장하지 않는다.
    await ref.update({ reason: 'storage-delete-failed' })
    return 'pending'
  }
  // 성공한 항목은 uid 해시까지 지운다. 여기서 실패해도 큐가 남아 멱등 재시도할 수 있다.
  await ref.delete()
  return 'deleted'
}

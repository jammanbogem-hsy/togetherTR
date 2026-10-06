// 회원 탈퇴 — 본인 ID 토큰을 firebase-admin 으로 검증하고 명세 순서대로 처리한다(docs/privacy-consent-spec.md).
// 처리 계획은 순수 함수 planAccountDeletion 이 만들고, 여기서는 실행만 한다. 중간에 실패하면 어디까지 처리됐는지
// 돌려주며, 다시 호출해도 안전하다(처리된 프로젝트는 다음 조회에서 대상이 아님, 문서·계정 삭제는 없어도 성공 처리).
// Firebase Hosting 60초 제한: 프로젝트 삭제는 recursiveDelete(BulkWriter 배치), 시간이 모자라면 partial-failure 로 돌려주고 재시도.
import { getAdminAuth, getAdminBucket, getAdminDb, getFieldValue } from '@/lib/firebase/admin'
import { memberRemovalFieldPaths, planAccountDeletion, PRESENCE_COLLECTIONS, type DeletionProjectLike } from '@/lib/account/accountDeletion'
import { queueProjectStorageCleanup, retryStorageCleanup, storageCleanupOwnerHash, STORAGE_CLEANUP_COLLECTION } from '@/lib/account/storageCleanup'
import type { AccountDeletionResult } from '@/lib/privacy/consentContent'

export const runtime = 'nodejs'
export const maxDuration = 60

const TIME_BUDGET_MS = 50_000

function json(body: AccountDeletionResult, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const result: AccountDeletionResult = {
    ok: false, deletedProjects: [], transferredProjects: [], leftProjects: [], userDocDeleted: false, authDeleted: false,
  }
  const startedAt = Date.now()

  const db = getAdminDb()
  const auth = getAdminAuth()
  if (!db || !auth) return json({ ...result, error: 'admin-unavailable' }, 503)

  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  let uid: string
  try {
    if (!token) throw new Error('missing token')
    uid = (await auth.verifyIdToken(token)).uid as string
  } catch {
    return json({ ...result, error: 'unauthenticated' }, 401)
  }

  const body = await request.json().catch(() => ({})) as { confirm?: string }
  if (body.confirm !== '탈퇴') return json({ ...result, error: 'confirm-required' }, 400)

  try {
    const FieldValue = getFieldValue()
    const projectsRef = db.collection('projects')
    // 내가 관련된 프로젝트: 멤버 목록·생성자·방장 어느 쪽이든(규칙도 셋 중 하나면 멤버로 본다)
    const snaps = await Promise.all([
      projectsRef.where('memberUids', 'array-contains', uid).get(),
      projectsRef.where('createdBy', '==', uid).get(),
      projectsRef.where('hostUid', '==', uid).get(),
    ])
    const projects: DeletionProjectLike[] = snaps.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<DeletionProjectLike, 'id'>) })))
    const bucket = getAdminBucket()

    for (const step of planAccountDeletion(projects, uid)) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) throw new Error('time-budget-exceeded')
      const ref = projectsRef.doc(step.projectId)
      if (step.action === 'delete') {
        // 자료 정리 목록이 영속 저장돼야 프로젝트/계정을 지울 수 있다.
        const cleanup = await queueProjectStorageCleanup(db, FieldValue, step.projectId, uid, bucket?.name)
        await db.recursiveDelete(ref)
        result.deletedProjects.push(step.projectId)
        await retryStorageCleanup(db, FieldValue, bucket, cleanup.id)
        continue
      }
      const updates: Record<string, unknown> = { memberUids: FieldValue.arrayRemove(uid) }
      for (const path of memberRemovalFieldPaths(uid)) updates[path] = FieldValue.delete()
      if (step.action === 'transfer') {
        updates.hostUid = step.newHostUid
        if (step.reassignCreatedBy) updates.createdBy = step.newHostUid
      } else if (step.reassignCreatedByTo) {
        updates.createdBy = step.reassignCreatedByTo
      }
      await ref.update(updates)
      await Promise.all(PRESENCE_COLLECTIONS.map(name => ref.collection(name).doc(uid).delete().catch(() => undefined)))
      if (step.action === 'transfer') result.transferredProjects.push({ projectId: step.projectId, newHostUid: step.newHostUid })
      else result.leftProjects.push(step.projectId)
    }

    // 이전 부분 실패로 이미 프로젝트가 사라진 경우도 남은 자료 안내에 포함한다.
    const pendingCleanup = await db.collection(STORAGE_CLEANUP_COLLECTION)
      .where('uidHash', '==', storageCleanupOwnerHash(uid)).limit(1).get()
    result.storageCleanupPending = !pendingCleanup.empty
    await db.collection('users').doc(uid).delete()
    result.userDocDeleted = true
    try {
      await auth.deleteUser(uid)
    } catch (e) {
      if ((e as { code?: string })?.code !== 'auth/user-not-found') throw e
    }
    result.authDeleted = true
    return json({ ...result, ok: true }, 200)
  } catch (e) {
    console.error('[account/delete] partial failure:', e)
    return json({ ...result, error: 'partial-failure' }, 500)
  }
}

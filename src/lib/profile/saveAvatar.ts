import { doc, FieldPath, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/config'
import { isProfileAvatarId } from './avatars'

/** Change only the avatar, preserving other profile fields and other team members. */
export async function saveProfileAvatar(uid: string, avatarId: string, projectId?: string): Promise<void> {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error('로그인한 프로필만 변경할 수 있습니다.')
  if (!isProfileAvatarId(avatarId)) throw new Error('선택할 수 없는 프로필 이미지입니다.')
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), { avatarId, updatedAt: serverTimestamp() }, { merge: true })
  if (projectId) batch.update(doc(db, 'projects', projectId), new FieldPath('memberInfo', uid, 'avatarId'), avatarId)
  await batch.commit()
}

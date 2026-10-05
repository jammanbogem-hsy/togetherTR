// 본문 위치 표시의 Firestore 통로 — projects/{id}/lessonDesignDirectionDocumentPresence/{uid}
// 규칙: 이름이 'Presence' 로 끝나는 하위 컬렉션은 멤버 읽기, 본인 uid 문서만 쓰기(firestore.rules 와일드카드).
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { DOCUMENT_PRESENCE_COLLECTION, type DocumentPresenceRecord, type DocumentPresenceTransport } from './documentPresence'

export function firestoreDocumentPresenceTransport(projectId: string, uid: string): DocumentPresenceTransport {
  const mine = doc(db, 'projects', projectId, DOCUMENT_PRESENCE_COLLECTION, uid)
  return {
    write: record => setDoc(mine, record),
    remove: () => deleteDoc(mine),
    subscribe: onRecords => onSnapshot(
      collection(db, 'projects', projectId, DOCUMENT_PRESENCE_COLLECTION),
      snap => onRecords(snap.docs.map(d => d.data() as DocumentPresenceRecord)),
      error => console.warn('[documentPresence] watch failed:', error),
    ),
  }
}

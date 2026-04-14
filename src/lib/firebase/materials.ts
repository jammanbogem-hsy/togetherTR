import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './config'
import type { MaterialChunk, ProjectMaterial } from '@/types'

export async function createProjectMaterial(
  projectId: string,
  data: Omit<ProjectMaterial, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'projects', projectId, 'materials'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateProjectMaterial(
  projectId: string,
  materialId: string,
  data: Partial<ProjectMaterial>
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId, 'materials', materialId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export function watchProjectMaterials(
  projectId: string,
  callback: (materials: ProjectMaterial[]) => void
): Unsubscribe {
  const q = query(collection(db, 'projects', projectId, 'materials'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ProjectMaterial))
  })
}

export async function getProjectMaterialChunks(projectId: string): Promise<MaterialChunk[]> {
  const snap = await getDocs(collection(db, 'projects', projectId, 'materialChunks'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as MaterialChunk)
}

export async function deleteProjectMaterial(projectId: string, materialId: string): Promise<void> {
  const chunkSnap = await getDocs(collection(db, 'projects', projectId, 'materialChunks'))
  const batch = writeBatch(db)
  let ops = 0

  chunkSnap.docs.forEach((chunkDoc) => {
    if (chunkDoc.data().materialId === materialId) {
      batch.delete(chunkDoc.ref)
      ops += 1
    }
  })

  if (ops > 0) {
    await batch.commit()
  }
  await deleteDoc(doc(db, 'projects', projectId, 'materials', materialId))
}


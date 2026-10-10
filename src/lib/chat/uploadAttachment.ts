'use client'

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, storage } from '@/lib/firebase/config'
import { IMAGE_MAX_EDGE, attachmentPath, attachmentType, type ChatAttachment } from './attachments'

/** Shrink large photos (phones take 4–8MB pictures). GIFs and small images stay as they are. */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_500_000) { bitmap.close(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch { return file }
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Upload one file, then ask the server to read it for the AI. Reading failures keep the file. */
export async function prepareAttachment(projectId: string, uid: string, file: File): Promise<ChatAttachment> {
  const type = attachmentType(file.name, file.type)
  if (!type) throw Error('unsupported')
  const id = newId()
  const body = type.kind === 'image' ? await shrinkImage(file) : file
  const shrunk = body !== file && body.type === 'image/jpeg'
  const name = shrunk ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name
  const contentType = shrunk ? 'image/jpeg' : type.contentType
  const path = attachmentPath(projectId, uid, id, name)
  const objectRef = ref(storage, path)
  await uploadBytes(objectRef, body, { contentType })
  const url = await getDownloadURL(objectRef)
  let extract = ''
  try {
    const token = await auth.currentUser?.getIdToken()
    const response = await fetch('/api/chat/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ projectId, path, name, contentType }),
    })
    if (response.ok) extract = String((await response.json()).text ?? '')
  } catch { /* The AI is told it could not read this file. */ }
  return { id, name, contentType, size: body.size, path, url, kind: type.kind, ...(extract ? { extract } : {}) }
}

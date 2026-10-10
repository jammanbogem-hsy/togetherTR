import { isMoveRequest } from './moveRequest'

/**
 * Chat attachments — photos and files teachers add so the AI (and the team) get the context
 * of offline discussion: meeting notes, whiteboards, paper drafts, shared documents.
 *
 * Files live in Storage at projects/{projectId}/chat/{uid}/{attachmentId}/{name} (storage.rules:
 * members upload their own, members read). The server reads each file once and stores the text
 * on the message (`extract`), so later AI turns reuse it without re-reading the file.
 */

export interface ChatAttachment {
  id: string
  name: string
  contentType: string
  size: number
  path: string
  url: string
  kind: AttachmentKind
  /** What the AI read from the file (transcribed text / description). Empty if reading failed. */
  extract?: string
}

export type AttachmentKind = 'image' | 'pdf' | 'text'

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
export const ATTACHMENT_MAX_COUNT = 5
/** Text from one attachment that goes to the AI; long documents are clipped. */
export const ATTACHMENT_EXTRACT_LIMIT = 8000
/** Photos are shrunk before upload so phone pictures upload fast and cost less to read. */
export const IMAGE_MAX_EDGE = 2000

const TYPES: Record<string, AttachmentKind> = {
  'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'application/pdf': 'pdf',
  'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text',
}
const EXTENSION_TYPES: Record<string, string> = { md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv' }

export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,.md,.txt,.csv'

/** Normalize the browser's content type (some send '' for .md). Returns null when unsupported. */
export function attachmentType(name: string, type: string): { contentType: string; kind: AttachmentKind } | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const contentType = TYPES[type] ? type : EXTENSION_TYPES[ext] ?? ''
  const kind = TYPES[contentType]
  return kind ? { contentType, kind } : null
}

export function validateAttachment(file: { name: string; type: string; size: number }, existingCount: number): string | null {
  if (existingCount >= ATTACHMENT_MAX_COUNT) return `한 번에 ${ATTACHMENT_MAX_COUNT}개까지 올릴 수 있어요.`
  if (!attachmentType(file.name, file.type)) return `'${file.name}'은(는) 올릴 수 없는 형식이에요. 사진(PNG·JPG·WEBP·GIF), PDF, 텍스트 파일만 돼요.`
  if (file.size > ATTACHMENT_MAX_BYTES) return `'${file.name}'이(가) 20MB보다 커요.`
  return null
}

/** Storage-safe file name: keep Korean letters, drop path characters. */
export function safeAttachmentName(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\\/:*?"<>|#\[\]\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').replace(/\s+/g, ' ').trim()
  return (cleaned || 'file').slice(-120)
}

export function attachmentPath(projectId: string, uid: string, attachmentId: string, name: string): string {
  return `projects/${projectId}/chat/${uid}/${attachmentId}/${safeAttachmentName(name)}`
}

/** The server only reads files the caller uploaded into this project's chat folder. */
export function isOwnAttachmentPath(path: string, projectId: string, uid: string): boolean {
  const prefix = `projects/${projectId}/chat/${uid}/`
  return path.startsWith(prefix) && !path.includes('..') && /^[A-Za-z0-9_-]+\/[^/]+$/.test(path.slice(prefix.length))
}

export function clipExtract(text: string): string {
  const trimmed = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed.length > ATTACHMENT_EXTRACT_LIMIT ? `${trimmed.slice(0, ATTACHMENT_EXTRACT_LIMIT)}\n…(이하 생략)` : trimmed
}

/** Append what the AI read from attachments to a message for the AI request (not for display). */
export function withAttachmentContext(content: string, attachments: readonly ChatAttachment[] | undefined): string {
  if (!attachments?.length) return content
  const blocks = attachments.map(item => {
    const label = item.kind === 'image' ? '사진' : item.kind === 'pdf' ? 'PDF' : '파일'
    return item.extract?.trim()
      ? `[첨부 ${label}: ${item.name}]\n${item.extract.trim()}`
      : `[첨부 ${label}: ${item.name}] (내용을 읽지 못함 — 선생님께 핵심을 한두 줄로 알려 달라고 할 것)`
  })
  return [content.trim(), ...blocks].filter(Boolean).join('\n\n')
}

/** Text shown when a teacher sends only attachments. */
export const ATTACHMENT_ONLY_TEXT = '자료를 올렸어요.'

export const IMAGE_READ_PROMPT = [
  '교사 협의 중에 찍은 사진입니다(회의 메모, 칠판·화이트보드, 종이 산출물, 화면 캡처 등).',
  '1. 사진 속 글자를 빠짐없이 옮겨 적으세요. 표는 표 형태로, 목록은 목록으로 유지합니다.',
  '2. 그림·도식·포스트잇 배치처럼 글자가 아닌 내용은 무엇을 나타내는지 1~3문장으로 설명합니다.',
  '3. 학생 실명은 "학생"으로 바꾸고, 사람의 얼굴·외모 등 개인을 알아볼 수 있는 정보는 설명하지 않습니다.',
  '4. 읽을 수 없는 부분은 "(읽기 어려움)"으로 표시하고 지어내지 않습니다.',
  '답은 한국어로, 머리말 없이 옮긴 내용과 설명만 씁니다.',
].join('\n')

const ATTACHMENT_MARKER = /(^|\n)\[첨부 (사진|PDF|파일): /

/** True when an AI-request message carries attachment context (see withAttachmentContext). */
export function hasAttachmentContext(content: string): boolean {
  return ATTACHMENT_MARKER.test(content)
}

/**
 * Sent with a message that has attachments. Teachers upload photos/files to ADD context to the
 * current activity ("체크해 주세요" = review it), not to finish the activity.
 */
export const ATTACHMENT_REVIEW_NOTE = [
  '[시스템 안내] 방금 선생님이 사진·파일을 올렸습니다. 이것은 지금 활동에 맥락을 더하려는 것입니다.',
  '1. 첨부에서 읽은 내용을 지금 활동의 목표와 지금까지의 대화·저장된 기록에 비추어 검토하세요.',
  '2. 기존 내용과 겹치는 점, 새로 더해지는 점, 서로 다르거나 빠진 점을 짧게 정리하고, 기록에 반영할지 물으세요.',
  '3. 선생님이 이번 메시지에서 이동을 직접 말하지 않았다면 [ACTIVITY_ADVANCE]를 내지 말고, 묻지 않고 저장([ARTIFACT_UPDATE])하지도 마세요.',
].join('\n')

/** Attachments are context: only an explicit move request in the same message may advance. */
export function attachmentsBlockAdvance(userText: string, attachments: readonly unknown[] | undefined): boolean {
  if (!attachments?.length) return false
  const text = userText.replace(/^\[답장: "[^"]*"\]\n/, '')
  return !isMoveRequest(text)
}

/** Fallback when the AI still answered with only the move line for an attachment message. */
export const ATTACHMENT_REVIEW_FALLBACK = '올려 주신 자료를 받았어요. 지금 활동과 비교해 볼 부분(예: 빠진 내용, 기록에 더할 내용)을 알려 주시면 함께 살펴볼게요.'

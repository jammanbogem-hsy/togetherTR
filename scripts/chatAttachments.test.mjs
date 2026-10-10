// Chat attachments: photos/files add offline-discussion context for the AI and the team.
//   node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/chatAttachments.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ATTACHMENT_EXTRACT_LIMIT, attachmentPath, attachmentType, clipExtract, isOwnAttachmentPath, safeAttachmentName, validateAttachment, withAttachmentContext } from '../src/lib/chat/attachments.ts'

test('supported types: photos, PDF and text; .md without a browser type still works', () => {
  assert.deepEqual(attachmentType('메모.jpg', 'image/jpeg'), { contentType: 'image/jpeg', kind: 'image' })
  assert.deepEqual(attachmentType('회의록.md', ''), { contentType: 'text/markdown', kind: 'text' })
  assert.deepEqual(attachmentType('계획.pdf', 'application/pdf'), { contentType: 'application/pdf', kind: 'pdf' })
  assert.equal(attachmentType('계획.hwp', 'application/x-hwp'), null)
  assert.equal(attachmentType('사진.heic', 'image/heic'), null)
})

test('validation explains count, type and size limits in Korean', () => {
  assert.equal(validateAttachment({ name: 'a.png', type: 'image/png', size: 10 }, 0), null)
  assert.match(validateAttachment({ name: 'a.png', type: 'image/png', size: 10 }, 5), /5개까지/)
  assert.match(validateAttachment({ name: 'a.hwp', type: '', size: 10 }, 0), /올릴 수 없는 형식/)
  assert.match(validateAttachment({ name: 'a.pdf', type: 'application/pdf', size: 21 * 1024 * 1024 }, 0), /20MB/)
})

test('paths stay inside the uploader folder of the project', () => {
  const path = attachmentPath('room1', 'u1', 'abc123', '../회의 메모?.png')
  assert.equal(path, 'projects/room1/chat/u1/abc123/_회의 메모_.png')
  assert.equal(isOwnAttachmentPath(path, 'room1', 'u1'), true, 'cleaned names stay readable')
  assert.equal(isOwnAttachmentPath('projects/room1/chat/u1/abc/../x.png', 'room1', 'u1'), false, 'dot-dot paths are refused')
  assert.equal(isOwnAttachmentPath('projects/room1/chat/u1/abc123/메모.png', 'room1', 'u1'), true)
  assert.equal(isOwnAttachmentPath('projects/room1/chat/u2/abc123/메모.png', 'room1', 'u1'), false)
  assert.equal(isOwnAttachmentPath('projects/room2/chat/u1/abc123/메모.png', 'room1', 'u1'), false)
  assert.equal(isOwnAttachmentPath('projects/room1/chat/u1/abc/def/메모.png', 'room1', 'u1'), false)
  assert.equal(safeAttachmentName('  '), 'file')
})

test('AI context gets what was read; unread files ask the teacher for the gist', () => {
  const items = [
    { id: '1', name: '칠판.jpg', kind: 'image', extract: '모둠별 역할: 기록·발표' },
    { id: '2', name: '자료.pdf', kind: 'pdf' },
  ]
  const text = withAttachmentContext('오늘 협의 결과예요', items)
  assert.match(text, /^오늘 협의 결과예요\n\n\[첨부 사진: 칠판\.jpg\]\n모둠별 역할: 기록·발표/)
  assert.match(text, /\[첨부 PDF: 자료\.pdf\] \(내용을 읽지 못함/)
  assert.equal(withAttachmentContext('그대로', undefined), '그대로')
  assert.ok(clipExtract('가'.repeat(ATTACHMENT_EXTRACT_LIMIT + 50)).endsWith('(이하 생략)'))
})

test('wiring: composer attach/paste/drop, message save, AI history, server checks, storage rules', () => {
  const chat = fs.readFileSync('src/components/chat/ChatPanel.tsx', 'utf8')
  assert.match(chat, /aria-label="사진·파일 첨부"/)
  assert.match(chat, /onPaste=\{event => \{\n\s+const files = \[\.\.\.event\.clipboardData\.files\]/)
  assert.match(chat, /onDrop=\{event =>/)
  assert.equal((chat.match(/withAttachmentContext\(/g) ?? []).length, 3)
  assert.match(chat, /attachments,\n\s+\}, userMsgId\)/)
  const route = fs.readFileSync('src/app/api/chat/attachments/route.ts', 'utf8')
  assert.match(route, /isOwnAttachmentPath\(path, projectId, identity\.uid\)/)
  assert.match(route, /이 프로젝트의 팀원만/)
  const rules = fs.readFileSync('storage.rules', 'utf8')
  assert.match(rules, /match \/projects\/\{projectId\}\/chat\/\{uid\}\/\{attachmentId\}\/\{fileName\}/)
  assert.match(rules, /request\.auth\.uid == uid\n\s+&& request\.resource\.size < 20 \* 1024 \* 1024/)
  assert.match(rules, /allow update: if false;/)
})

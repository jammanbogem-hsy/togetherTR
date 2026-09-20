'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import Collaboration from '@tiptap/extension-collaboration'
import type * as Y from 'yjs'
import { documentExtensions } from '@/lib/coedit/document'
import { connectDocument, type DocumentStatus } from '@/lib/coedit/firestore-document'

interface Props {
  projectId: string
  flushRef: MutableRefObject<(() => Promise<void>) | null>
}

const insertCommands = [
  { label: '본문', keywords: 'text paragraph', run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: '제목 1', keywords: 'heading h1', run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: '제목 2', keywords: 'heading h2', run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: '글머리 목록', keywords: 'bullet list', run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록', keywords: 'ordered list', run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { label: '인용', keywords: 'quote', run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: '표', keywords: 'table', run: (e: Editor) => e.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
]
function slashAt(editor: Editor) {
  const { empty, $from, from } = editor.state.selection
  if (!empty || !$from.parent.isTextblock || editor.isActive('codeBlock')) return null
  const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const match = /^\/([^/\n]{0,30})$/.exec(text)
  return match ? { from: from - text.length, to: from, query: match[1] } : null
}

function DocumentBody({ document }: { document: Y.Doc }) {
  const [revision, setRevision] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState(0)
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [...documentExtensions(), Collaboration.configure({ document })],
    onTransaction: ({ transaction }) => {
      setRevision(value => value + 1)
      if (transaction.docChanged) { setDismissed(false); setSelected(0) }
    },
    editorProps: {
      handleKeyDown: (_view, event) => keyHandler.current(event),
      attributes: { class: 'collaborative-document-body', role: 'textbox', 'aria-label': '공동 문서 본문', 'aria-multiline': 'true' },
    },
  }, [document])
  const slash = editor ? slashAt(editor) : null
  const query = slash?.query
  const commands = insertCommands.filter(command => `${command.label} ${command.keywords}`.toLowerCase().includes((query ?? '').toLowerCase()))
  const menuOpen = !!slash && !dismissed
  const activeIndex = Math.min(selected, Math.max(0, commands.length - 1))
  function insert(index: number) {
    if (!editor) return
    const current = slashAt(editor)
    if (!current || !commands[index]) return
    editor.chain().focus().deleteRange({ from: current.from, to: current.to }).run()
    commands[index].run(editor)
    setDismissed(true)
  }
  useEffect(() => { keyHandler.current = event => {
    if (!menuOpen || event.isComposing || event.keyCode === 229) return false
    if (event.key === 'Escape') { setDismissed(true); return true }
    if (!commands.length) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      setSelected((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length)
      return true
    }
    if (event.key === 'Enter') { insert(activeIndex); return true }
    return false
  } })
  const formattingTools = editor && <>
    <button type="button" className="document-tool" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>굵게</button>
    <button type="button" className="document-tool" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>기울임</button>
    <button type="button" className="document-tool" aria-pressed={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>밑줄</button>
    <button type="button" className="document-tool" onClick={() => editor.chain().focus().toggleBulletList().run()}>글머리 목록</button>
    <button type="button" className="document-tool" onClick={() => editor.chain().focus().toggleOrderedList().run()}>번호 목록</button>
    <button type="button" className="document-tool" onClick={() => editor.chain().focus().toggleBlockquote().run()}>인용</button>
  </>

  function move(direction: -1 | 1) {
    if (!editor) return
    const { state } = editor
    const start = state.selection.$from.index(0)
    const end = state.doc.resolve(Math.max(state.selection.from, state.selection.to - 1)).index(0)
    const target = direction < 0 ? start - 1 : end + 1
    if (target < 0 || target >= state.doc.childCount) return
    const first = Math.min(start, target)
    const last = Math.max(end, target)
    let pos = 0
    for (let i = 0; i < first; i++) pos += state.doc.child(i).nodeSize
    const group = []
    for (let i = start; i <= end; i++) group.push(state.doc.child(i))
    const neighbor = state.doc.child(target)
    const nodes = direction < 0 ? [...group, neighbor] : [neighbor, ...group]
    let size = 0
    for (let i = first; i <= last; i++) size += state.doc.child(i).nodeSize
    const tr = state.tr.replaceWith(pos, pos + size, nodes)
    const offset = direction * neighbor.nodeSize
    tr.setSelection(TextSelection.create(tr.doc, state.selection.from + offset, state.selection.to + offset))
    editor.view.dispatch(tr)
    editor.commands.focus()
  }

  return <>
    <div className="flex flex-wrap gap-1 py-2" role="toolbar" aria-label="문서 편집 도구" onMouseDown={event => event.preventDefault()}>
      {formattingTools}
      <button type="button" className="document-tool" onClick={() => editor?.chain().focus().setParagraph().run()}>본문</button>
      <button type="button" className="document-tool" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>제목</button>
      <button type="button" className="document-tool" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>인용</button>
      <button type="button" className="document-tool" onClick={() => move(-1)}>문단 위로</button>
      <button type="button" className="document-tool" onClick={() => move(1)}>문단 아래로</button>
      <button type="button" className="document-tool" onClick={() => editor?.chain().focus().undo().run()}>실행 취소</button>
      <button type="button" className="document-tool" onClick={() => editor?.chain().focus().redo().run()}>다시 실행</button>
    </div>
    {editor && <BubbleMenu editor={editor} className="document-selection-menu" options={{ placement: 'top' }}>
      <div role="toolbar" aria-label="선택한 문단 서식" onMouseDown={event => event.preventDefault()}>{formattingTools}</div>
    </BubbleMenu>}
    <EditorContent editor={editor} />
    {menuOpen && <div className="document-slash-menu" role="menu" aria-label="블록 삽입 명령어" data-revision={revision} onMouseDown={event => event.preventDefault()}>
      <p className="px-3 py-2 text-xs text-gray-500">↑↓ 선택 · Enter 적용 · Esc 닫기</p>
      {commands.map((command, index) => <button type="button" role="menuitem" key={command.label} className="document-tool block w-full text-left" data-active={index === activeIndex} onClick={() => insert(index)}>{command.label}</button>)}
      {!commands.length && <p className="px-3 py-2 text-sm">일치하는 명령어가 없습니다.</p>}
    </div>}
  </>
}

export function CollaborativeDocument({ projectId, flushRef }: Props) {
  const [connection, setConnection] = useState<ReturnType<typeof connectDocument> | null>(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<DocumentStatus>('connecting')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const provider = connectDocument(projectId, (next, detail) => {
      if (!active) return
      setStatus(next)
      setError(detail ?? '')
    })
    flushRef.current = async () => { await provider.ready; await provider.flush() }
    provider.ready.then(() => { if (active) { setConnection(provider); setReady(true) } }).catch(() => {})
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Browser recovery also retains updates; still warn before leaving.
      if (document.querySelector('[data-document-pending="true"]')) event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      active = false
      flushRef.current = null
      window.removeEventListener('beforeunload', beforeUnload)
      provider.destroy()
    }
  }, [projectId, flushRef])
  return <section aria-label="실시간 공동 문서" data-document-pending={status !== 'saved'}>
    <div className="flex items-center justify-between text-xs text-[#5F6368] py-2" role="status">
      <span>{status === 'connecting' ? '문서 연결 중…' : status === 'saving' ? '변경 내용 저장 중…' : status === 'saved' ? '본문 자동 저장됨 · 동시 입력 병합' : `저장 확인 필요: ${error}`}</span>
      {status === 'error' && ready && <button type="button" className="document-tool" onClick={() => void connection?.flush().catch(() => {})}>저장 재시도</button>}
    </div>
    {ready && connection && <DocumentBody document={connection.ydoc} />}
    <p className="text-xs text-[#9AA0A6] py-2">Enter로 새 문단 · Shift+Enter로 줄바꿈 · 여러 문단을 드래그해 함께 서식 적용 · 문단 시작에서 /로 삽입 메뉴</p>
  </section>
}

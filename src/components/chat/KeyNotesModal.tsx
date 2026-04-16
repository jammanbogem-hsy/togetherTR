'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, PushPinSimple, Trash, ChatCircle } from '@phosphor-icons/react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { KeyNote, ActivityCode } from '@/types'
import { ACTIVITY_META } from '@/types'
import { STAGE_COLOR } from '@/lib/ui/stageColors'
import { removeKeyNote } from '@/lib/firebase/projects'

// 노트 내용은 md로 저장되는 경우가 많음 (AI 응답의 표/볼드/제목 포함).
// 읽을 때는 실제 시각 요소로 렌더.
const noteMarkdownComponents: Components = {
  h1: ({ children }) => <h3 className="text-[14px] font-extrabold text-[#202124] mt-3 mb-1.5">{children}</h3>,
  h2: ({ children }) => <h4 className="text-[13px] font-bold text-[#202124] mt-2.5 mb-1">{children}</h4>,
  h3: ({ children }) => <p className="text-[12px] font-bold text-[#3C4043] mt-2 mb-0.5">{children}</p>,
  h4: ({ children }) => <p className="text-[12px] font-bold text-[#5F6368] mt-1.5 mb-0.5">{children}</p>,
  p: ({ children }) => <p className="text-[13px] text-[#3C4043] leading-relaxed my-1">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-[#202124]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#5F6368]">{children}</em>,
  ul: ({ children }) => <ul className="space-y-1 my-1.5 pl-0">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-5 my-1.5 space-y-0.5 text-[13px] text-[#3C4043]">{children}</ol>,
  li: ({ children }) => (
    <li className="flex items-start gap-1.5 text-[13px] text-[#3C4043] leading-relaxed">
      <span className="mt-1.5 w-1 h-1 rounded-full bg-[#F9AB00] flex-shrink-0" />
      <span className="flex-1 min-w-0">{children}</span>
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 px-2.5 py-1 bg-white/70 border-l-2 border-[#F9AB00] rounded-r text-[12px] text-[#5F6368]">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 rounded-lg border border-[#E8D96E] overflow-hidden bg-white">
      <table className="w-full border-collapse text-[12px]" style={{ tableLayout: 'auto' }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#FEF7E0]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2 py-1.5 text-left font-bold text-[11px] text-[#B06000] align-top" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      {children}
    </th>
  ),
  tr: ({ children }) => <tr className="border-t border-[#F5D900]/30">{children}</tr>,
  td: ({ children }) => (
    <td className="px-2 py-1.5 text-[12px] text-[#3C4043] leading-snug align-top" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      {children}
    </td>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 bg-white border border-[#E8D96E] rounded text-[11px] text-[#B06000]">{children}</code>
  ),
  hr: () => <hr className="my-2 border-t border-[#F5D900]/40" />,
}

// AI가 단일 라인에 파이프로 표를 말아넣었을 때 다시 정렬 (ArtifactPanel의 로직 재사용 패턴)
function normalizeInlinePipeList(text: string): string {
  if (text.includes('\n')) return text
  const trimmed = text.trim()
  if (!trimmed.startsWith('|')) return text
  const pipeCount = (trimmed.match(/\|/g) || []).length
  if (pipeCount < 4) return text
  const core = trimmed.slice(1).replace(/\|$/, '')
  const rawCells = core.split('|').map(s => s.trim()).filter(Boolean)
  const evenCount = rawCells.length - (rawCells.length % 2)
  if (evenCount < 4) return text
  const cells = rawCells.slice(0, evenCount)
  const pairs: [string, string][] = []
  for (let i = 0; i < cells.length; i += 2) pairs.push([cells[i], cells[i + 1]])
  const isSep = (s: string) => /^:?-{2,}:?$/.test(s)
  const sepIdx = pairs.findIndex(p => isSep(p[0]) && isSep(p[1]))
  if (sepIdx > 0 && sepIdx < pairs.length - 1) {
    const header = pairs[sepIdx - 1]
    const dataRows = pairs.slice(sepIdx + 1).filter(p => !(isSep(p[0]) && isSep(p[1])))
    if (dataRows.length === 0) return text
    return [
      `| ${header[0]} | ${header[1]} |`,
      `| --- | --- |`,
      ...dataRows.map(p => `| ${p[0]} | ${p[1]} |`),
    ].join('\n')
  }
  return [
    `| 항목 | 내용 |`,
    `| --- | --- |`,
    ...pairs.filter(p => !(isSep(p[0]) && isSep(p[1]))).map(p => `| ${p[0]} | ${p[1]} |`),
  ].join('\n')
}

/**
 * 프로젝트 중요 노트(포스트잇) 모달.
 * - 채팅에서 우클릭으로 저장한 메시지 모음을 한눈에 열람
 * - 저장 시각 역순 정렬 (최신 위)
 * - 작성자만 삭제 가능 (권한 확인은 UI 레벨 — Firestore rules에서 이중 보장)
 */
export function KeyNotesModal({
  open,
  onClose,
  projectId,
  notes,
  currentUid,
  onInsertReference,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  notes: KeyNote[]
  currentUid: string
  /** 청킹 레퍼런스 삽입 — 노트 번호(#N)만 채팅 입력창에 들어감 */
  onInsertReference?: (note: KeyNote, number: number) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  if (!open || typeof document === 'undefined') return null

  // 번호는 저장 시점 오름차순(가장 오래된 것이 #1). 삭제 시 번호는 재압축됨 → 안정적 매핑 위해
  // note.id → number 맵을 계산 후 렌더에서 재사용.
  const numberMap = new Map<string, number>()
  ;[...notes].sort((a, b) => a.savedAt - b.savedAt).forEach((n, i) => numberMap.set(n.id, i + 1))

  const sorted = [...notes].sort((a, b) => b.savedAt - a.savedAt)

  async function handleRemove(noteId: string) {
    if (!window.confirm('이 중요 노트를 삭제할까요?')) return
    setBusyId(noteId)
    try {
      await removeKeyNote(projectId, noteId)
    } catch (err) {
      console.error('[keyNotes] remove failed', err)
    } finally {
      setBusyId(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[235] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[96vw] max-w-[720px] max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-gradient-to-br from-[#FEF7E0] to-white px-5 py-4 flex items-center gap-3 border-b border-[#DADCE0] flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#F9AB00] flex items-center justify-center flex-shrink-0">
            <PushPinSimple size={20} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#B06000] uppercase tracking-widest">중요 노트</p>
            <h3 className="text-[15px] font-bold text-[#202124]">
              팀이 저장한 주요 내용 · <span className="tabular-nums">{notes.length}</span>개
            </h3>
          </div>
          <button onClick={onClose} aria-label="닫기" className="p-1.5 rounded-full hover:bg-white text-[#5F6368] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sorted.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-16 text-center text-[#9AA0A6]">
              <PushPinSimple size={40} weight="regular" className="mb-3" />
              <p className="text-[13px] font-semibold text-[#5F6368]">저장된 중요 노트가 없습니다</p>
              <p className="text-[11px] mt-1 leading-relaxed max-w-[320px]">
                채팅에서 보관하고 싶은 메시지를 <strong>우클릭</strong>한 뒤 <strong>&ldquo;중요 내용 저장&rdquo;</strong>을 선택하면 이곳에 모입니다.<br />
                저장된 내용은 AI 응답 시 자동 참고됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sorted.map(note => {
                const activity = note.sourceActivityCode ? ACTIVITY_META[note.sourceActivityCode] : null
                const color = activity ? STAGE_COLOR[activity.stage] : STAGE_COLOR.T
                const canDelete = note.savedBy === currentUid
                const number = numberMap.get(note.id) ?? 0
                return (
                  <div
                    key={note.id}
                    className="group rounded-xl border border-[#F5D900]/40 bg-gradient-to-br from-[#FFFEF5] to-[#FEF7E0] px-4 py-3 shadow-sm hover:shadow transition-shadow"
                  >
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#F9AB00] text-white text-[11px] font-extrabold tabular-nums flex-shrink-0">
                        #{number}
                      </span>
                      {note.sourceActivityCode && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold text-white tabular-nums flex-shrink-0"
                          style={{ backgroundColor: color.hex }}
                        >
                          {note.sourceActivityCode}
                        </span>
                      )}
                      {activity && (
                        <span className="text-[11px] font-semibold text-[#5F6368] truncate">{activity.label}</span>
                      )}
                      {note.sourceRole === 'assistant' ? (
                        <span className="text-[10px] text-[#7B1FA2] bg-[#F3E5F5] px-1.5 py-0.5 rounded">AI</span>
                      ) : (
                        note.sourceDisplayName && (
                          <span className="text-[10px] text-[#5F6368] bg-white border border-[#E8EAED] px-1.5 py-0.5 rounded">
                            {note.sourceDisplayName}
                          </span>
                        )
                      )}
                      <span className="flex-1" />
                      <span className="text-[10px] text-[#9AA0A6] tabular-nums flex-shrink-0">
                        {new Date(note.savedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="text-[#202124]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={noteMarkdownComponents}>
                        {normalizeInlinePipeList(note.content)}
                      </ReactMarkdown>
                    </div>
                    <div className="mt-2 flex items-center gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-[#9AA0A6]">
                        저장: {note.savedByName ?? '팀원'}
                      </span>
                      <span className="flex-1" />
                      {onInsertReference && (
                        <button
                          type="button"
                          onClick={() => { onInsertReference(note, number); onClose() }}
                          title={`@노트#${number} 으로 채팅에 불러오기`}
                          className="flex items-center gap-1 text-[10px] font-semibold text-[#1A73E8] hover:bg-[#E8F0FE] rounded-full px-2 py-1 transition-colors"
                        >
                          <ChatCircle size={12} weight="fill" /> 채팅에 불러오기
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleRemove(note.id)}
                          disabled={busyId === note.id}
                          title="삭제"
                          className="flex items-center gap-1 text-[10px] text-[#C5221F] hover:bg-[#FCE8E6] rounded-full px-2 py-1 transition-colors disabled:opacity-50"
                        >
                          <Trash size={12} weight="regular" /> 삭제
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 채팅 메시지 우클릭 컨텍스트 메뉴.
 * 좌표(clientX/Y)에 떠서 답장 / 중요 저장 / 복사 / 삭제 제공.
 */
export function MessageContextMenu({
  open, x, y, onClose,
  onReply, onSaveKeyNote, onCopy,
}: {
  open: boolean
  x: number
  y: number
  onClose: () => void
  onReply?: () => void
  onSaveKeyNote: () => void
  onCopy: () => void
}) {
  if (!open || typeof document === 'undefined') return null
  // 우측 가장자리·하단 초과 방지를 위한 위치 클램프
  const MENU_W = 200, MENU_H = 160
  const maxX = typeof window !== 'undefined' ? window.innerWidth - MENU_W - 8 : x
  const maxY = typeof window !== 'undefined' ? window.innerHeight - MENU_H - 8 : y
  const left = Math.min(x, maxX)
  const top = Math.min(y, maxY)

  return createPortal(
    <>
      <div className="fixed inset-0 z-[220]" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div
        className="fixed z-[221] min-w-[200px] bg-white rounded-xl shadow-2xl border border-[#E8EAED] overflow-hidden py-1"
        style={{ left, top }}
      >
        {onReply && (
          <button
            type="button"
            onClick={() => { onReply(); onClose() }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#202124] hover:bg-[#F1F3F4] text-left transition-colors"
          >
            <ChatCircle size={15} weight="regular" className="text-[#5F6368]" />
            답장하기
          </button>
        )}
        <button
          type="button"
          onClick={() => { onSaveKeyNote(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#202124] hover:bg-[#FEF7E0] text-left transition-colors"
        >
          <PushPinSimple size={15} weight="fill" className="text-[#F9AB00]" />
          중요 내용 저장
        </button>
        <button
          type="button"
          onClick={() => { onCopy(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#202124] hover:bg-[#F1F3F4] text-left transition-colors"
        >
          <svg width={15} height={15} viewBox="0 0 16 16" fill="currentColor" className="text-[#5F6368]">
            <path d="M10 1H3a2 2 0 0 0-2 2v7h2V3h7V1zm3 3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 10H6V6h7v8z"/>
          </svg>
          복사
        </button>
      </div>
    </>,
    document.body,
  )
}

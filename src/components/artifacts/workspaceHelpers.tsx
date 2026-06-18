'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// 공용 워크스페이스 헬퍼 — IGW(통합 수업목표)와 TVW(팀 공통 비전) 등 협업 모달이 공유.
// 각 모달이 동일한 presence/문서 편집 패턴을 가지므로 중복 정의를 한 곳에서 관리.

// ─── AutoGrowTextarea ────────────────────────────────────────────────
// 내용 양에 맞춰 자동으로 height가 늘어나는 textarea. value 변경 시 scrollHeight 측정.
// `resize-none overflow-hidden`로 스크롤바와 수동 리사이즈 제거.
type AutoGrowTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  value: string
  minRows?: number
}
export function AutoGrowTextarea({ value, className, minRows = 2, style, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      className={cn('resize-none overflow-hidden', className)}
      style={style}
      {...rest}
    />
  )
}

// ─── CaretOverlay (구글 문서식) ───────────────────────────────────────
// 다른 팀원의 caret 위치를 textarea 위 mirror div로 그려준다.
// textarea와 동일 font/padding/line-height를 className으로 받아 wrap 위치가 일치해야 한다.
export type CaretOverlayEditor = {
  uid: string
  displayName: string
  color: string
  caretPos?: number
}
export function CaretOverlay({ text, editors, className }: { text: string; editors: CaretOverlayEditor[]; className: string }) {
  const sorted = editors
    .filter(e => typeof e.caretPos === 'number' && e.caretPos! >= 0)
    .sort((a, b) => (a.caretPos! - b.caretPos!))
  if (!sorted.length) return null
  const elements: React.ReactNode[] = []
  let cursor = 0
  for (const ed of sorted) {
    const pos = Math.max(0, Math.min(ed.caretPos!, text.length))
    if (pos > cursor) elements.push(text.slice(cursor, pos))
    elements.push(
      <span key={`c-${ed.uid}`} className="relative inline-block align-baseline" style={{ width: 0, height: '1em' }}>
        <span className="absolute left-0 top-[0.1em] block animate-pulse" style={{ width: '2px', height: '1.1em', backgroundColor: ed.color }} />
        <span className="absolute -top-[1.4em] left-0 whitespace-nowrap rounded px-1.5 py-[1px] text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>{ed.displayName}</span>
      </span>
    )
    cursor = pos
  }
  if (cursor < text.length) elements.push(text.slice(cursor))
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent', className)} aria-hidden>
      {elements}
    </div>
  )
}

// ─── 체크리스트 ──────────────────────────────────────────────────────
// block.content 1줄 = 1항목, `- [x] ` / `- [ ] ` 마커로 체크 상태 직렬화.
// 데이터 모델 변경 없이 기존 string 필드만 사용.
export type ChecklistItem = { text: string; checked: boolean }
const CHECKLIST_LINE = /^\s*[-*]\s*\[([ xX])\]\s*(.*)$/
export function parseChecklist(content: string): ChecklistItem[] {
  if (!content) return []
  return content.split(/\r?\n/).map(line => {
    const m = line.match(CHECKLIST_LINE)
    if (m) return { text: m[2], checked: m[1].toLowerCase() === 'x' }
    return { text: line.replace(/^\s*[-*]\s*/, ''), checked: false }
  })
}
export function stringifyChecklist(items: ChecklistItem[]): string {
  return items.map(it => `- [${it.checked ? 'x' : ' '}] ${it.text}`).join('\n')
}

// ─── Firestore nested undefined 청소 ─────────────────────────────────
// 객체·배열 트리를 순회하며 undefined 값 키를 제거. setProjectArtifact 등 외부 cleanup이
// top-level만 처리하므로 manualWorkspace.blocks[].table 같은 깊은 곳 잔존 undefined를 송신 직전에 정리.
export function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[k] = stripUndefinedDeep(v)
    }
    return out
  }
  return value
}

// ─── 블록 드래그&드롭 정렬 ────────────────────────────────────────────
// 협업 모달 공통: 문서 블록을 드래그 핸들로 잡아 순서를 바꾼다.
// 핸들만 draggable로 두어 textarea 등 내부 편집을 방해하지 않는다.
export function reorderArray<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function useBlockDnd(onReorder: (from: number, to: number) => void) {
  const fromIdx = useRef<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  return {
    /** 드래그 중 드롭 대상으로 강조될 인덱스 (null이면 없음) */
    overIndex,
    /** 각 블록의 드래그 핸들 버튼에 스프레드 */
    handleProps: (index: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        fromIdx.current = index
        e.dataTransfer.effectAllowed = 'move'
        // 일부 브라우저에서 dragstart에 데이터가 없으면 drop 미발생
        try { e.dataTransfer.setData('text/plain', String(index)) } catch { /* noop */ }
      },
      onDragEnd: () => { fromIdx.current = null; setOverIndex(null) },
    }),
    /** 각 블록 컨테이너(드롭 영역)에 스프레드 */
    dropZoneProps: (index: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (fromIdx.current == null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (overIndex !== index) setOverIndex(index)
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const from = fromIdx.current
        fromIdx.current = null
        setOverIndex(null)
        if (from != null && from !== index) onReorder(from, index)
      },
    }),
  }
}

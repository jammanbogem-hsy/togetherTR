'use client'

// 평가 루브릭 작성 창 — 선생님이 직접 쓰거나, AI 제안(산출물·대화·성취수준 근거)으로 채운 뒤 "반영하기"로 산출물 아래에 붙인다.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Sparkle, Trash, X } from '@phosphor-icons/react'
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'
import { AutoGrowTextarea } from '../workspaceHelpers'
import { RUBRIC_COLUMNS, emptyRubricRow, isBlankRubricRow, type RubricField, type RubricRow } from '@/lib/rubric/rubric'
import type { RubricSuggestRequest, RubricSuggestResult } from '@/app/api/rubric/suggest/route'

export type RubricSuggestContext = Omit<RubricSuggestRequest, 'activityCode' | 'existingRows'>

export interface RubricEditorModalProps {
  activityCode: RubricSuggestRequest['activityCode']
  activityLabel: string
  initialRows: RubricRow[]
  suggestContext: () => RubricSuggestContext
  onSave: (rows: RubricRow[]) => Promise<void>
  onClose: () => void
}

const STARTER_ROWS = 3

export function RubricEditorModal({ activityCode, activityLabel, initialRows, suggestContext, onSave, onClose }: RubricEditorModalProps) {
  const [rows, setRows] = useState<RubricRow[]>(() =>
    initialRows.length > 0 ? initialRows.map(r => ({ ...r })) : Array.from({ length: STARTER_ROWS }, emptyRubricRow))
  const [suggesting, setSuggesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const setCell = (id: string, field: RubricField, value: string) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)))

  async function suggest() {
    setSuggesting(true)
    setError(null)
    setNote(null)
    try {
      const filled = rows.filter(r => !isBlankRubricRow(r))
      const res = await fetch('/api/rubric/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityCode, existingRows: filled, ...suggestContext() } satisfies RubricSuggestRequest),
      })
      const data = (await res.json()) as RubricSuggestResult & { error?: string }
      if (!res.ok) { setError(data.error ?? 'AI 제안을 받지 못했습니다. 다시 시도해 주세요.'); return }
      if (!data.rows?.length) { setError('AI가 제안할 내용을 찾지 못했습니다. 산출물이나 대화를 먼저 채워 주세요.'); return }
      // 빈 행은 버리고 기존 내용 뒤에 붙인다 — 선생님이 쓴 칸은 덮어쓰지 않는다.
      setRows([...filled, ...data.rows])
      const basis = data.levelCodes?.length
        ? `공식 성취수준 ${data.levelCodes.join(', ')}의 A·B·C 원문을 바탕으로 했습니다.`
        : '산출물에서 공식 성취수준이 있는 성취기준을 찾지 못해, 상·중·하를 과제 장면의 행동 차이로 제안했습니다.'
      setNote([basis, data.rationale].filter(Boolean).join(' '))
    } catch {
      setError('AI 제안을 받지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.')
    } finally {
      setSuggesting(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(rows.filter(r => !isBlankRubricRow(r)))
      onClose()
    } catch {
      setError('저장하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === 'undefined') return null
  const busy = suggesting || saving
  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={() => { if (!busy) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rubric-editor-title"
        className="flex max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#DADCE0] bg-[#F3E8FD] px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#7B1FA2]">평가 루브릭 작성</p>
            <h2 id="rubric-editor-title" className="truncate text-[15px] font-bold text-[#202124]">{activityLabel}</h2>
          </div>
          <MD3Button variant="tonal" tone="purple" size="sm" onClick={suggest} disabled={busy}
            icon={<Sparkle size={MD3_ICON.sm} weight="fill" />}>
            {suggesting ? 'AI가 제안하는 중…' : 'AI 제안'}
          </MD3Button>
          <button type="button" onClick={onClose} disabled={busy} aria-label="루브릭 창 닫기"
            className="rounded-full p-1.5 text-[#5F6368] hover:bg-white/70 disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          <p className="mb-3 text-[13px] leading-relaxed text-[#5F6368]">
            직접 쓰거나 &lsquo;AI 제안&rsquo;을 누르세요. AI는 팀 산출물과 대화, 관련 성취기준의 공식 성취수준(상↔A, 중↔B, 하↔C)을 참고해 행을 덧붙입니다. 이미 쓴 칸은 바꾸지 않습니다.
          </p>
          {note && <p className="mb-3 rounded-xl bg-[#E8F0FE] px-4 py-2.5 text-[13px] leading-relaxed text-[#174EA6]">{note}</p>}
          {error && <p role="alert" className="mb-3 rounded-xl bg-[#FCE8E6] px-4 py-2.5 text-[13px] text-[#C5221F]">{error}</p>}
          <div className="overflow-x-auto rounded-xl border border-[#DADCE0]">
            <table className="w-full min-w-[1100px] border-collapse text-[13px]">
              <thead className="bg-[#F8F9FA] text-[#5F6368]">
                <tr>
                  {RUBRIC_COLUMNS.map(c => (
                    <th key={c.id} className={`border-b border-[#DADCE0] px-2 py-2 text-left font-semibold ${c.wide ? 'w-[18%]' : 'w-[9%]'}`}>{c.label}</th>
                  ))}
                  <th className="w-10 border-b border-[#DADCE0]" aria-label="행 삭제" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.id} className="align-top">
                    {RUBRIC_COLUMNS.map(c => (
                      <td key={c.id} className="border-b border-[#F1F3F4] px-1.5 py-1">
                        <AutoGrowTextarea
                          value={row[c.id]}
                          minRows={2}
                          aria-label={`${ri + 1}행 ${c.label}`}
                          onChange={e => setCell(row.id, c.id, e.target.value)}
                          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-snug text-[#202124] hover:border-[#DADCE0] focus:border-[#7B1FA2] focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className="border-b border-[#F1F3F4] px-1 py-1 text-center">
                      <button type="button" onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                        aria-label={`${ri + 1}행 삭제`} className="rounded-full p-1.5 text-[#5F6368] hover:bg-[#FCE8E6] hover:text-[#C5221F]">
                        <Trash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setRows(prev => [...prev, emptyRubricRow()])}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-[#7B1FA2] hover:bg-[#F3E8FD]">
            <Plus size={14} weight="bold" /> 행 추가
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#DADCE0] px-6 py-3">
          <MD3Button variant="text" tone="neutral" size="sm" onClick={onClose} disabled={busy}>취소</MD3Button>
          <MD3Button variant="filled" tone="purple" size="sm" onClick={save} disabled={busy}>
            {saving ? '반영하는 중…' : '반영하기'}
          </MD3Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

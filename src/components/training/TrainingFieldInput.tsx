'use client'

import { useState } from 'react'
import { emptyTrainingTable, parseTrainingTables, serializeTrainingTables, trainingTableRow, type TrainingTablePart } from '@/lib/training/trainingTable'

const inputClass = 'block w-full min-w-0 resize-y rounded-lg border border-[#C4C7C5] bg-white px-3 py-2 text-sm leading-relaxed text-[#202124] focus:border-[#0B57D0] focus:outline-none focus:ring-2 focus:ring-[#D3E3FD] disabled:bg-[#F8F9FA]'
const buttonClass = 'rounded-lg border border-[#C4C7C5] bg-white px-3 py-2 text-xs font-medium text-[#3C4043] hover:bg-[#F1F3F4] aria-pressed:border-[#0B57D0] aria-pressed:bg-[#E8F0FE] aria-pressed:text-[#0842A0] focus-visible:outline-2 focus-visible:outline-[#0B57D0] disabled:opacity-50'

function fieldParts(value: string, columns?: readonly string[]): TrainingTablePart[] {
  const parsed = parseTrainingTables(value)
  return !value.trim() && columns?.length ? [emptyTrainingTable(columns)] : parsed
}

export function TrainingFieldInput({ id, label, value, onChange, columns, placeholder }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  columns?: readonly string[]; placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => ({ source: value, parts: fieldParts(value, columns) }))
  const [mode, setMode] = useState<'auto' | 'table' | 'text'>('auto')
  // Parent protects dirty fields. Unedited fields still follow incoming artifact snapshots.
  if (draft.source !== value) setDraft({ source: value, parts: fieldParts(value, columns) })
  const hasTable = draft.parts.some(part => part.kind === 'table')
  const tableMode = mode !== 'text' && hasTable

  function changeParts(parts: TrainingTablePart[]) {
    const next = serializeTrainingTables(parts)
    setDraft({ source: next, parts })
    onChange(next)
  }
  function updatePart(index: number, update: (part: TrainingTablePart) => TrainingTablePart) {
    changeParts(draft.parts.map((part, position) => position === index ? update(part) : part))
  }

  return <div className="min-w-0 space-y-2">
    {hasTable && <div className="flex flex-wrap gap-2" role="group" aria-label={`${label} 입력 방식`}>
      <button type="button" aria-pressed={tableMode} onClick={() => setMode('table')} className={buttonClass}>표로 입력</button>
      <button type="button" aria-pressed={!tableMode} onClick={() => setMode('text')} className={buttonClass}>글로 입력</button>
    </div>}
    {!tableMode ? <textarea id={id} aria-label={label} value={value} rows={4} placeholder={placeholder ?? '정리한 내용을 적어 주세요.'}
      onChange={event => onChange(event.target.value)} className={inputClass} /> : draft.parts.map((part, partIndex) => {
      if (part.kind === 'text') return part.text.trim() ? <textarea key={`text-${partIndex}`} aria-label={`${label} 표 앞뒤 글 ${partIndex + 1}`}
        value={part.text} rows={2} className={inputClass} onChange={event => updatePart(partIndex, () => ({ kind: 'text', text: event.target.value }))} /> : null
      const tableLabel = `${label} 표 ${partIndex + 1}`
      const updateCell = (rowId: string, column: number, text: string) => updatePart(partIndex, current => current.kind !== 'table' ? current : {
        ...current, rows: current.rows.map(row => row.id !== rowId ? row : { ...row, cells: row.cells.map((cell, index) => index === column ? text : cell) }),
      })
      const deleteRow = (rowId: string) => updatePart(partIndex, current => current.kind !== 'table' ? current : { ...current, rows: current.rows.filter(row => row.id !== rowId) })
      const cellInput = (rowId: string, rowIndex: number, column: number, text: string) => <textarea
        aria-label={`${tableLabel} ${rowIndex + 1}행 ${part.headers[column] || `${column + 1}열`}`} value={text} rows={2}
        onChange={event => updateCell(rowId, column, event.target.value)} className={inputClass} />
      return <div key={`table-${partIndex}`} className="min-w-0 space-y-2">
        <div className="hidden max-h-[420px] overflow-auto rounded-xl border border-[#DADCE0] sm:block">
          <table aria-label={tableLabel} className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#F1F3F4] text-[#3C4043]"><tr>
              {part.headers.map((header, column) => <th key={column} scope="col" className="min-w-32 border-b border-[#DADCE0] px-3 py-2 font-medium">{header || `${column + 1}열`}</th>)}
              <th scope="col" className="w-16 border-b border-[#DADCE0] px-2 py-2"><span className="sr-only">행 관리</span></th>
            </tr></thead>
            <tbody>{part.rows.map((row, rowIndex) => <tr key={row.id}>
              {row.cells.map((cell, column) => <td key={column} className="border-b border-[#E8EAED] p-2 align-top">{cellInput(row.id, rowIndex, column, cell)}</td>)}
              <td className="border-b border-[#E8EAED] p-2 align-top"><button type="button" aria-label={`${tableLabel} ${rowIndex + 1}행 삭제`} className={buttonClass} onClick={() => deleteRow(row.id)}>삭제</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="space-y-3 sm:hidden" role="group" aria-label={`${tableLabel} 카드`}>
          {part.rows.map((row, rowIndex) => <div key={row.id} className="space-y-3 rounded-xl border border-[#DADCE0] bg-[#F8F9FA] p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{rowIndex + 1}행</span>
              <button type="button" aria-label={`${tableLabel} ${rowIndex + 1}행 삭제`} className={buttonClass} onClick={() => deleteRow(row.id)}>삭제</button></div>
            {row.cells.map((cell, column) => <label key={column} className="block min-w-0 space-y-1 text-sm text-[#3C4043]">
              <span>{part.headers[column] || `${column + 1}열`}</span>{cellInput(row.id, rowIndex, column, cell)}
            </label>)}
          </div>)}
        </div>
        {!part.rows.length && <p className="text-xs text-[#5F6368]">행을 추가해 내용을 입력하세요.</p>}
        <button type="button" aria-label={`${tableLabel} 행 추가`} className={buttonClass} onClick={() => updatePart(partIndex, current => current.kind !== 'table' ? current : {
          ...current, rows: [...current.rows, trainingTableRow(current.headers.map(() => ''))],
        })}>행 추가</button>
      </div>
    })}
  </div>
}

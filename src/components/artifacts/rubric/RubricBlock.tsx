'use client'

// 산출물 아래에 붙는 평가 루브릭 표(읽기 전용) + 편집·한글 표 복사·HWPX 받기.

import { useEffect, useState } from 'react'
import { Check, Copy, DownloadSimple, PencilSimple } from '@phosphor-icons/react'
import { RUBRIC_COLUMNS, isBlankRubricRow, type RubricRow } from '@/lib/rubric/rubric'
import { copyRubricForHangul, downloadRubricHwpx } from './rubricExport'

export function RubricBlock({ rows, title, onEdit, compact = false }: {
  rows: RubricRow[]
  /** 복사·파일 제목 (예: "Ds-3 학습활동 설계 평가 루브릭") */
  title: string
  onEdit?: () => void
  compact?: boolean
}) {
  const filled = rows.filter(r => !isBlankRubricRow(r))
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    if (!status) return
    const t = window.setTimeout(() => setStatus(null), 2400)
    return () => window.clearTimeout(t)
  }, [status])
  if (filled.length === 0) return null

  const copy = async () => {
    try {
      const kind = await copyRubricForHangul(filled, title)
      setStatus(kind === 'table' ? '복사됨 — 한글에 붙여 넣으면 표로 들어갑니다' : '글로 복사됨 — 이 브라우저는 표 복사를 막았습니다')
    } catch {
      setStatus('복사하지 못했습니다')
    }
  }
  const download = async () => {
    try { await downloadRubricHwpx(filled, title) } catch { setStatus('HWPX 파일을 만들지 못했습니다') }
  }
  const chip = 'inline-flex items-center gap-1 rounded-full border border-[#DADCE0] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#5F6368] hover:border-[#7B1FA2] hover:text-[#7B1FA2]'

  return (
    <section aria-label="평가 루브릭" className="mt-4 rounded-2xl border border-[#E1C9F5] bg-[#FBF7FE] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <h3 className="mr-auto text-[13px] font-bold text-[#7B1FA2]">평가 루브릭</h3>
        {onEdit && <button type="button" onClick={onEdit} className={chip}><PencilSimple size={13} /> 편집</button>}
        <button type="button" onClick={copy} className={chip} title="한글(HWP)에 붙여 넣으면 표로 들어갑니다">
          {status?.startsWith('복사됨') ? <Check size={13} weight="bold" /> : <Copy size={13} />} 한글 표로 복사
        </button>
        <button type="button" onClick={download} className={chip} title="HWPX 파일로 내려받기">
          <DownloadSimple size={13} /> HWPX
        </button>
      </div>
      {status && <p role="status" className="mb-2 text-[12px] text-[#5F6368]">{status}</p>}
      <div className="overflow-x-auto rounded-xl border border-[#E8EAED] bg-white">
        <table className={`w-full border-collapse ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
          <thead className="bg-[#F8F9FA] text-[#5F6368]">
            <tr>{RUBRIC_COLUMNS.map(c => <th key={c.id} style={{ minWidth: c.minPx }} className="whitespace-nowrap border-b border-[#E8EAED] px-2.5 py-2 text-left font-semibold">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {filled.map(row => (
              <tr key={row.id} className="align-top">
                {RUBRIC_COLUMNS.map(c => (
                  <td key={c.id} className="whitespace-pre-wrap border-b border-[#F1F3F4] px-2.5 py-2 leading-relaxed text-[#202124]">{row[c.id]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

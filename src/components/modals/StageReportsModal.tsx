'use client'

import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode } from '@/types'
import { cn } from '@/lib/utils'
import { X, FileText, ArrowLeft, DownloadSimple, FilePdf } from '@phosphor-icons/react'
import { generateHwpx } from '@/lib/hwpx/generateHwpx'

const STAGE_COLOR: Record<string, { bg: string; text: string; light: string; border: string }> = {
  T:  { bg: 'bg-[#1A73E8]', text: 'text-[#1A73E8]', light: 'bg-[#E8F0FE]', border: 'border-[#1A73E8]' },
  A:  { bg: 'bg-[#7B1FA2]', text: 'text-[#7B1FA2]', light: 'bg-[#F3E5F5]', border: 'border-[#7B1FA2]' },
  Ds: { bg: 'bg-[#00897B]', text: 'text-[#00897B]', light: 'bg-[#E0F2F1]', border: 'border-[#00897B]' },
  DI: { bg: 'bg-[#E65100]', text: 'text-[#E65100]', light: 'bg-[#FBE9E7]', border: 'border-[#E65100]' },
  E:  { bg: 'bg-[#C62828]', text: 'text-[#C62828]', light: 'bg-[#FFEBEE]', border: 'border-[#C62828]' },
}

const STAGE_LABELS: Record<string, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

export function StageReportsModal({ onClose }: { onClose: () => void }) {
  const { project } = useProjectStore()
  const [selectedStage, setSelectedStage] = useState<StageCode | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const stageReports = project?.stageReports ?? {}
  const savedStages = STAGES.filter(s => stageReports[s.code])

  if (savedStages.length === 0) return null

  const selectedReport = selectedStage ? stageReports[selectedStage] : null
  const selectedColor = selectedStage ? STAGE_COLOR[selectedStage] : null
  const displayContent = (selectedReport?.content ?? '')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .split('\n')
    .map(line => line.startsWith('|')
      ? line.replace(/<br\s*\/?>/gi, '\u2028')
      : line.replace(/<br\s*\/?>/gi, '\n')
    )
    .join('\n')

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function downloadMd() {
    if (!selectedStage || !selectedReport) return
    const blob = new Blob([selectedReport.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.title ?? 'report'}_${STAGE_LABELS[selectedStage]}_보고서.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadPdf() {
    const contentEl = contentRef.current
    if (!contentEl || !selectedStage) return
    const win = window.open('', '_blank')
    if (!win) return

    const html = contentEl.innerHTML
    win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${project?.title ?? ''} ${STAGE_LABELS[selectedStage]} 단계 보고서</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body {
      font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif;
      max-width: 740px;
      margin: 0 auto;
      padding: 36px 40px;
      color: #202124;
      background: white;
      font-size: 14px;
      line-height: 1.7;
    }
    @page { size: A4; margin: 18mm 15mm; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  ${html}
  <script>
    window.onload = () => {
      setTimeout(() => {
        window.print()
        window.onafterprint = () => window.close()
      }, 600)
    }
  <\/script>
</body>
</html>`)
    win.document.close()
  }

  async function downloadHwpx() {
    if (!selectedStage || !displayContent) return
    try {
      const filename = `${project?.title ?? 'report'}_${STAGE_LABELS[selectedStage]}_보고서.hwpx`
      const blob = await generateHwpx(displayContent, `${project?.title ?? '프로젝트'} ${STAGE_LABELS[selectedStage]} 단계 보고서`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Stage report HWPX export failed:', error)
      window.alert('HWPX 생성에 실패했습니다. 현재는 PDF 또는 Markdown 공유를 사용해주세요.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '860px', height: '85vh', maxHeight: '90vh' }}>

        {/* 헤더 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8EAED] flex-shrink-0">
          {selectedStage && (
            <button
              onClick={() => setSelectedStage(null)}
              className="flex items-center gap-1 text-[13px] text-[#5F6368] hover:text-[#202124] hover:bg-[#F1F3F4] rounded-full px-2.5 py-1.5 transition-all"
            >
              <ArrowLeft size={15} weight="bold" />
              목록
            </button>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileText size={18} weight="fill" className="text-[#5F6368] flex-shrink-0" />
            <h2 className="text-[15px] font-extrabold text-[#202124] truncate">
              {selectedStage
                ? `${STAGE_LABELS[selectedStage]}(${selectedStage}) 단계 보고서`
                : '저장된 단계 보고서'}
            </h2>
          </div>
          {selectedStage && selectedReport && (
            <div className="flex items-center gap-2">
              <button
                onClick={downloadMd}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold bg-white border border-[#DADCE0] text-[#5F6368] rounded-full hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
              >
                <FileText size={14} weight="fill" />
                MD
              </button>
              <button
                onClick={downloadPdf}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold bg-white border border-[#DADCE0] text-[#5F6368] rounded-full hover:border-[#E65100] hover:text-[#E65100] transition-colors"
              >
                <FilePdf size={14} weight="fill" />
                PDF
              </button>
              <button
                onClick={downloadHwpx}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold bg-white border border-[#DADCE0] text-[#5F6368] rounded-full hover:border-[#00AEEF] hover:text-[#00AEEF] transition-colors"
              >
                <DownloadSimple size={14} weight="bold" />
                HWPX 베타
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F1F3F4] transition-colors flex-shrink-0"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* 본문 */}
        {!selectedStage ? (
          /* 목록 */
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-[12px] text-[#9AA0A6] font-medium mb-4">
              완료된 단계의 심층 분석 보고서입니다. 단계를 선택해 전체 내용을 확인하세요.
            </p>
            <div className="grid grid-cols-1 gap-3">
              {savedStages.map(stageInfo => {
                const report = stageReports[stageInfo.code]!
                const color = STAGE_COLOR[stageInfo.code]
                return (
                  <button
                    key={stageInfo.code}
                    onClick={() => setSelectedStage(stageInfo.code as StageCode)}
                    className={cn(
                      'w-full text-left rounded-2xl border-2 p-5 hover:shadow-md transition-all group',
                      color.border, color.light
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white font-extrabold text-[13px] flex-shrink-0', color.bg)}>
                          {stageInfo.code}
                        </div>
                        <div>
                          <p className={cn('text-[15px] font-extrabold', color.text)}>
                            {STAGE_LABELS[stageInfo.code]}({stageInfo.code}) 단계
                          </p>
                          <p className="text-[11px] text-[#9AA0A6] font-medium mt-0.5">
                            {formatDate(report.savedAt)}
                          </p>
                        </div>
                      </div>
                      <div className={cn('text-[12px] font-bold px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all', color.bg, 'text-white')}>
                        보고서 보기 →
                      </div>
                    </div>
                    {/* 미리보기 */}
                    <p className="text-[12px] text-[#5F6368] mt-3 leading-relaxed line-clamp-2">
                      {report.content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').substring(0, 150)}...
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          /* 보고서 뷰어 */
          <div className="flex-1 overflow-y-auto">
            {/* 단계 배지 */}
            <div className={cn('px-6 py-3 flex items-center gap-2 border-b border-[#E8EAED]', selectedColor!.light)}>
              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-white font-extrabold text-[11px]', selectedColor!.bg)}>
                {selectedStage}
              </div>
              <span className={cn('text-[13px] font-bold', selectedColor!.text)}>
                {STAGE_LABELS[selectedStage]}({selectedStage}) 단계 심층 분석 보고서
              </span>
              <span className="ml-auto text-[11px] text-[#9AA0A6]">
                {formatDate(selectedReport!.savedAt)}
              </span>
            </div>

            {/* 마크다운 */}
            <div className="px-10 py-7" ref={contentRef}>
              <p className="text-[11px] text-[#9AA0A6] font-medium mb-4">
                HWPX는 기본형 내보내기만 지원합니다. 제목, 문단, 목록, 단순 표를 우선 보존하며 복잡한 스타일은 간소화됩니다.
              </p>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  td: ({ children }) => {
                    const text = typeof children === 'string' ? children : null
                    if (text && (text.includes('【') && text.includes(' / 【') || text.includes('\u2028'))) {
                      const parts = text.includes('\u2028') ? text.split('\u2028') : text.split(' / ')
                      return (
                        <td style={{ padding: '0.6rem 1rem', borderTop: '1px solid #F1F3F4', color: '#3C4043', fontSize: '0.88rem' }}>
                          {parts.map((part, i) => (
                            <span key={i} style={{ display: 'block' }}>{part}</span>
                          ))}
                        </td>
                      )
                    }
                    return <td style={{ padding: '0.6rem 1rem', borderTop: '1px solid #F1F3F4', color: '#3C4043', fontSize: '0.88rem', whiteSpace: 'nowrap' }}>{children}</td>
                  },
                  h1: ({ children }) => (
                    <h1 style={{ fontSize: '1.55rem', fontWeight: 900, color: '#202124', margin: '0 0 2rem', lineHeight: 1.2, letterSpacing: '-0.03em', paddingBottom: '0.9rem', borderBottom: '3px solid #1A73E8' }}>
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <div style={{ marginTop: '2.4rem', marginBottom: '1rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 800, color: '#1A73E8', background: '#E8F0FE', borderRadius: '8px', padding: '0.4rem 0.85rem', letterSpacing: '0.01em' }}>
                        {children}
                      </span>
                    </div>
                  ),
                  h3: ({ children }) => (
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#202124', margin: '1.6rem 0 0.4rem', paddingLeft: '0.65rem', borderLeft: '3px solid #1A73E8', lineHeight: 1.4 }}>
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => (
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#5F6368', margin: '1.2rem 0 0.35rem', paddingLeft: '0.5rem', borderLeft: '2px solid #DADCE0', lineHeight: 1.4 }}>
                      {children}
                    </h4>
                  ),
                  p: ({ children }) => (
                    <p style={{ fontSize: '0.92rem', color: '#3C4043', lineHeight: 1.82, margin: '0.55rem 0' }}>
                      {children}
                    </p>
                  ),
                  strong: ({ children }) => (
                    <strong style={{ fontWeight: 800, color: '#202124', background: 'rgba(26,115,232,0.08)', borderRadius: '3px', padding: '0 3px' }}>
                      {children}
                    </strong>
                  ),
                  blockquote: ({ children }) => (
                    <div style={{ margin: '0.9rem 0', padding: '0.85rem 1.1rem', background: 'linear-gradient(135deg, #EAF2FF 0%, #F3E5F5 100%)', borderLeft: '4px solid #1A73E8', borderRadius: '0 12px 12px 0', fontSize: '0.9rem', color: '#1a2e5a', fontWeight: 600, lineHeight: 1.75 }}>
                      {children}
                    </div>
                  ),
                  ul: ({ children }) => (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.6rem 0' }}>{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol style={{ listStyle: 'none', padding: 0, margin: '0.6rem 0', counterReset: 'ol' }}>{children}</ol>
                  ),
                  li: ({ children }) => (
                    <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.5rem', fontSize: '0.91rem', color: '#3C4043', lineHeight: 1.75 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1A73E8', flexShrink: 0, marginTop: '0.52rem', display: 'inline-block' }} />
                      <span>{children}</span>
                    </li>
                  ),
                  table: ({ children }) => (
                    <div style={{ margin: '1rem 0', borderRadius: '12px', overflowX: 'auto', border: '1.5px solid #DADCE0' }}>
                      <table style={{ minWidth: 'max-content', width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead style={{ background: '#1A73E8', color: 'white' }}>{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 700, fontSize: '0.83rem', color: 'white', whiteSpace: 'nowrap' }}>{children}</th>
                  ),
                  tr: ({ children }) => <tr>{children}</tr>,
                  hr: () => (
                    <hr style={{ border: 'none', borderTop: '1.5px solid #F1F3F4', margin: '1.8rem 0' }} />
                  ),
                  em: ({ children }) => (
                    <em style={{ fontStyle: 'italic', color: '#5F6368', fontSize: '0.88rem' }}>{children}</em>
                  ),
                  code: ({ children }) => (
                    <code style={{ background: '#F8F9FA', border: '1px solid #DADCE0', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.85rem', color: '#202124' }}>{children}</code>
                  ),
                }}
              >
                {displayContent}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

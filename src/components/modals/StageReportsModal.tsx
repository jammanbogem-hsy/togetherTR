'use client'

import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { pickReportIcon, stripLeadingEmoji, childrenToText, ReportIcon } from '@/components/ui/ReportSectionIcon'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode } from '@/types'
import { MD3Button } from '@/components/ui/MD3Button'
import { ReportMarkdown } from './ReportMarkdown'
import { X, FileText, ArrowLeft, DownloadSimple, FilePdf } from '@phosphor-icons/react'
import { generateHwpx } from '@/lib/hwpx/generateHwpx'

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
  const displayContent = (selectedReport?.content ?? '')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .split('\n')
    .map(line => line.startsWith('|')
      ? line.replace(/<br\s*\/?>/gi, '\u2028')
      : line.replace(/<br\s*\/?>/gi, '\n')
    )
    .join('\n')

  // 분석시트 변경 감지 — 보고서가 현재 분석시트를 반영하는지 "내용 기반"으로 판정 (A 분석 보고서).
  // 타임스탬프 대신 본문 교과 비교를 쓰는 이유: updatedAt은 재저장(replace-all/set-center)만 해도
  // 전 행에 찍혀 false-positive가 잦다. 본문 비교는 실제 교과 추가/삭제만 잡는다.
  const SHEET_SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과', '통합교과']
  const sheetRows = project?.curriculumSheet ?? []
  const currentSubjects = [...new Set(sheetRows.map(r => r.subject).filter(Boolean))]
  const currentCenter = sheetRows.find(r => r.isCenter)?.subject ?? ''
  const reportText = selectedReport?.content ?? ''
  const subjectsInReport = SHEET_SUBJECTS.filter(s => reportText.includes(s))
  const addedNotInReport = currentSubjects.filter(s => !subjectsInReport.includes(s))      // 시트엔 있으나 보고서엔 없음 (예: 미술 추가)
  const removedStillInReport = subjectsInReport.filter(s => !currentSubjects.includes(s))   // 보고서엔 있으나 시트엔 없음 (예: 도덕 삭제)
  const reportStale = !!selectedReport && selectedStage === 'A' && currentSubjects.length > 0
    && (addedNotInReport.length > 0 || removedStillInReport.length > 0)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--md-sys-scrim)] backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="stage-reports-title" className="relative z-10 flex h-[min(85vh,calc(100dvh_-_2rem))] w-full min-w-0 max-w-[860px] flex-col overflow-hidden rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-low)] shadow-2xl">
        <header className="shrink-0 border-b border-[var(--md-sys-outline-variant)] p-4 sm:px-6">
          <div className="flex items-start gap-2">
            {selectedStage && <MD3Button variant="text" tone="neutral" onClick={() => setSelectedStage(null)} aria-label="보고서 목록으로" icon={<ArrowLeft size={20} />} />}
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <FileText size={22} weight="fill" className="mt-1 shrink-0 text-[var(--md-sys-primary)]" />
              <h2 id="stage-reports-title" className="text-[20px] font-medium leading-7 text-[var(--md-sys-on-surface)]">{selectedStage ? `${STAGE_LABELS[selectedStage]}(${selectedStage}) 단계 보고서` : '저장된 단계 보고서'}</h2>
            </div>
            <MD3Button variant="text" tone="neutral" onClick={onClose} aria-label="단계 보고서 닫기" icon={<X size={20} />} />
          </div>
          {selectedStage && selectedReport && <div className="mt-4 flex flex-wrap gap-2">
            <MD3Button variant="outlined" onClick={downloadMd} icon={<FileText size={18} />}>MD</MD3Button>
            <MD3Button variant="tonal" onClick={downloadPdf} icon={<FilePdf size={18} />}>PDF</MD3Button>
            <MD3Button variant="outlined" onClick={downloadHwpx} icon={<DownloadSimple size={18} />}>HWPX 베타</MD3Button>
          </div>}
        </header>
        {!selectedStage ? <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <p className="mb-4 text-[13px] text-[var(--md-sys-on-surface-variant)]">완료된 단계의 심층 분석 보고서입니다. 단계를 선택해 전체 내용을 확인하세요.</p>
          <div className="grid grid-cols-1 gap-3">
            {savedStages.map(stageInfo => {
              const report = stageReports[stageInfo.code]!
              return <button type="button" key={stageInfo.code} onClick={() => setSelectedStage(stageInfo.code as StageCode)}
                className="group w-full min-w-0 rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)] p-4 text-left transition-colors hover:bg-[var(--md-sys-surface-container)] focus-visible:outline-2 focus-visible:outline-[var(--md-sys-primary)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-primary-container)] text-[14px] font-medium text-[var(--md-sys-on-primary-container)]">{stageInfo.code}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">{STAGE_LABELS[stageInfo.code]}({stageInfo.code}) 단계</p>
                    <p className="mt-1 text-[12px] text-[var(--md-sys-on-surface-variant)]">{formatDate(report.savedAt)}</p>
                  </div>
                  <span className="hidden text-[13px] font-medium text-[var(--md-sys-primary)] sm:inline">보고서 보기 →</span>
                </div>
                <p className="mt-3 line-clamp-2 break-words text-[13px] leading-6 text-[var(--md-sys-on-surface-variant)]">{report.content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').substring(0, 150)}...</p>
              </button>
            })}
          </div>
        </div> : <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container)] px-4 py-3 text-[13px] text-[var(--md-sys-on-surface-variant)] sm:px-6">
            <span className="rounded-full bg-[var(--md-sys-primary-container)] px-3 py-1 font-medium text-[var(--md-sys-on-primary-container)]">{selectedStage}</span>
            <span className="min-w-0">{STAGE_LABELS[selectedStage]}({selectedStage}) 단계 심층 분석 보고서</span>
            <span className="text-[12px] sm:ml-auto">{formatDate(selectedReport!.savedAt)}</span>
          </div>
          {reportStale && <div className="mx-4 mt-4 rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-error-container)] p-4 text-[var(--md-sys-on-error-container)] sm:mx-6">
            <p className="text-[13px] font-medium">⚠ 이 보고서가 현재 분석시트와 일치하지 않습니다 — 보고서를 다시 생성해야 최신 교과·중심 교과가 반영됩니다.</p>
            <p className="mt-1 text-[12px]">
              {addedNotInReport.length > 0 && <>추가됨: {addedNotInReport.join('·')} · </>}
              {removedStillInReport.length > 0 && <>삭제됨: {removedStillInReport.join('·')} · </>}
              현재 분석시트 — 교과: {currentSubjects.join('·')}{currentCenter ? ` · 중심 교과: ${currentCenter}` : ''}
            </p>
          </div>}
          <div className="min-w-0 p-4 sm:p-6">
            <p className="mb-4 text-[12px] text-[var(--md-sys-on-surface-variant)]">HWPX는 기본형 내보내기만 지원합니다. 제목, 문단, 목록, 단순 표를 우선 보존하며 복잡한 스타일은 간소화됩니다.</p>
            <ReportMarkdown content={displayContent} />
          </div>
          {/* 기존 PDF 출력 본문·스타일은 화면 개편과 분리해 보존한다. */}
          <div className="hidden" aria-hidden="true" ref={contentRef}>
              <p className="text-[11px] text-[#9AA0A6] font-medium mb-4">
                HWPX는 기본형 내보내기만 지원합니다. 제목, 문단, 목록, 단순 표를 우선 보존하며 복잡한 스타일은 간소화됩니다.
              </p>
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                components={{
                  td: ({ children }) => {
                    const baseStyle: React.CSSProperties = { padding: '0.6rem 1rem', borderTop: '1px solid #F1F3F4', color: '#3C4043', fontSize: '0.88rem', verticalAlign: 'top', lineHeight: 1.6, wordBreak: 'keep-all', overflowWrap: 'anywhere' }
                    const text = typeof children === 'string' ? children : null
                    if (text && (text.includes('【') && text.includes(' / 【') || text.includes('\u2028'))) {
                      const parts = text.includes('\u2028') ? text.split('\u2028') : text.split(' / ')
                      return (
                        <td style={baseStyle}>
                          {parts.map((part, i) => (
                            <span key={i} style={{ display: 'block' }}>{part}</span>
                          ))}
                        </td>
                      )
                    }
                    return <td style={baseStyle}>{children}</td>
                  },
                  h1: ({ children }) => (
                    <h1 style={{ fontSize: '1.55rem', fontWeight: 900, color: '#202124', margin: '0 0 2rem', lineHeight: 1.2, letterSpacing: '-0.03em', paddingBottom: '0.9rem', borderBottom: '3px solid #1A73E8' }}>
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => {
                    // 이모지 제목 → M3 tonal 컨테이너 + 벡터 아이콘
                    const raw = childrenToText(children)
                    const iconName = pickReportIcon(raw)
                    return (
                      <div style={{ marginTop: '2.4rem', marginBottom: '1rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.9rem', fontWeight: 600, color: '#0842A0', background: '#D3E3FD', borderRadius: '10px', padding: '0.45rem 0.9rem', letterSpacing: '0.01em' }}>
                          {iconName && <ReportIcon name={iconName} size={18} />}
                          {stripLeadingEmoji(raw) || children}
                        </span>
                      </div>
                    )
                  },
                  h3: ({ children }) => {
                    const raw = childrenToText(children)
                    return (
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#202124', margin: '1.6rem 0 0.4rem', paddingLeft: '0.65rem', borderLeft: '3px solid #0B57D0', lineHeight: 1.4 }}>
                        {stripLeadingEmoji(raw) || children}
                      </h3>
                    )
                  },
                  h4: ({ children }) => {
                    const raw = childrenToText(children)
                    const iconName = pickReportIcon(raw)
                    return (
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem', fontWeight: 600, color: '#5F6368', margin: '1.2rem 0 0.35rem', paddingLeft: '0.5rem', borderLeft: '2px solid #E9E9E7', lineHeight: 1.4 }}>
                        {iconName && <ReportIcon name={iconName} size={16} fill={0} />}
                        {stripLeadingEmoji(raw) || children}
                      </h4>
                    )
                  },
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
                    <div style={{ margin: '1rem 0', borderRadius: '12px', border: '1.5px solid #DADCE0', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', tableLayout: 'auto' }}>{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead style={{ background: '#1A73E8', color: 'white' }}>{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 700, fontSize: '0.83rem', color: 'white', wordBreak: 'keep-all', overflowWrap: 'anywhere', verticalAlign: 'top' }}>{children}</th>
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
        </div>}
      </div>
    </div>
  )
}

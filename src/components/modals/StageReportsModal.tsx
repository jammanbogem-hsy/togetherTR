'use client'

import { useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode } from '@/types'
import { MD3Button } from '@/components/ui/MD3Button'
import { ReportHero, ReportMarkdown } from './ReportMarkdown'
import { printReport } from './printReport'
import { cleanReportMarkdown } from '@/lib/markdown/reportDisplay'
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
    const blob = new Blob([cleanReportMarkdown(selectedReport.content)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.title ?? 'report'}_${STAGE_LABELS[selectedStage]}_보고서.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadPdf() {
    if (!contentRef.current || !selectedStage) return
    printReport(contentRef.current, `${project?.title ?? ''} ${STAGE_LABELS[selectedStage]} 단계 보고서`)
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
            <div ref={contentRef}>
              <ReportHero content={displayContent} stage={selectedStage} project={project} generatedAt={selectedReport!.savedAt} />
              <ReportMarkdown content={displayContent} stage={selectedStage} project={project} />
            </div>
          </div>
        </div>}
      </div>
    </div>
  )
}

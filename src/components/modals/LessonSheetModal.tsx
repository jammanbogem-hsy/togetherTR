'use client'

/**
 * 시험판 '수업 실행 나눔 기록지' — 단계 보고서 목록의 카드와 전체 보기 창.
 * 단계 보고서와 나란히 두고, 선생님들이 더 좋은 형식에 표시(reportFormatVotes)하게 한다.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { MD3Button } from '@/components/ui/MD3Button'
import { ReportMarkdown } from './ReportMarkdown'
import { printReport } from './printReport'
import { downloadReportPdf } from './downloadReportPdf'
import { cleanReportMarkdown } from '@/lib/markdown/reportDisplay'
import { ArrowLeft, FileText, FilePdf, Flask, SpinnerGap, ThumbsUp, X } from '@phosphor-icons/react'
import { canGenerateStageReport } from '@/lib/report/stageReportState'
import { countReportVotes, generateLessonSheet, lessonSheetArtifacts, voteReportFormat, type ReportFormat } from '@/lib/report/lessonSheet'
import { hasLessonSheetSources } from '@/lib/report/lessonSheetPrompt'

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 표 칸의 <br>은 칸 안 줄바꿈으로, 그 밖은 문단 줄바꿈으로. */
export function lessonSheetDisplay(markdown: string): string {
  return markdown.split('\n').map(line => line.replace(/<br\s*\/?>/gi, line.startsWith('|') ? ' ' : '\n')).join('\n')
}

function ReportVotes() {
  const { project, userProfile } = useProjectStore()
  const [error, setError] = useState('')
  if (!project) return null
  const votes = countReportVotes(project.reportFormatVotes)
  const mine = userProfile?.uid ? project.reportFormatVotes?.[userProfile.uid] : undefined
  async function vote(format: ReportFormat) {
    if (!userProfile?.uid || !project) return
    setError('')
    await voteReportFormat(project.id, userProfile.uid, format, mine).catch(() => setError('선호 표시를 저장하지 못했어요.'))
  }
  return <div className="flex flex-wrap items-center gap-2" aria-label="보고서 형식 선호">
    <span className="text-xs font-medium text-[var(--md-sys-on-surface-variant)]">어떤 형식이 더 좋나요?</span>
    {(['stage', 'sheet'] as const).map(format => <button key={format} type="button" aria-pressed={mine === format} onClick={() => { void vote(format) }}
      className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${mine === format ? 'border-transparent bg-[#D3E3FD] text-[#0842A0]' : 'border-[#C4C7C5] bg-white text-[#444746] hover:bg-[#F1F4F9]'}`}>
      <ThumbsUp size={14} weight={mine === format ? 'fill' : 'regular'} />{format === 'stage' ? '단계 보고서' : '나눔 기록지'} {votes[format]}
    </button>)}
    {error && <span role="alert" className="text-xs text-[var(--md-sys-error)]">{error}</span>}
  </div>
}

/** 단계 보고서 목록 맨 위의 시험판 카드. */
export function LessonSheetCard({ onOpen }: { onOpen: (generate: boolean) => void }) {
  const { project, userProfile } = useProjectStore()
  if (!project) return null
  const saved = project.lessonSheetReport
  const isHost = canGenerateStageReport(project, userProfile?.uid)
  const canMake = hasLessonSheetSources(lessonSheetArtifacts(project))
  return <section aria-label="시험판 수업 실행 나눔 기록지" className="w-full min-w-0 rounded-[var(--md-sys-radius-lg)] border border-[#D7B8F3] bg-[#FBF7FE] p-4">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-md)] bg-[#EADDFF] text-[#4A148C]"><Flask size={20} weight="fill" /></div>
      <div className="min-w-0 flex-1">
        <h3 className="flex flex-wrap items-center gap-2 text-[16px] font-medium text-[var(--md-sys-on-surface)]">수업 실행 나눔 기록지 <span className="rounded-full bg-[#EADDFF] px-2 py-0.5 text-[11px] font-semibold text-[#4A148C]">시험판</span></h3>
        <p className="mt-1 text-[12px] text-[var(--md-sys-on-surface-variant)]">{saved ? formatDate(saved.savedAt) : '연수 기록지 양식(팀 정보 · 수업 설계 · 평가 루브릭 · 학습활동 계획 · KPT 성찰)으로 전체 산출물을 한 장에 정리해요.'}</p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {saved && <MD3Button variant="text" onClick={() => onOpen(false)}>기록지 보기 →</MD3Button>}
      {isHost ? <MD3Button variant={saved ? 'tonal' : 'filled'} disabled={!canMake} onClick={() => onOpen(true)}>{saved ? '다시 만들기' : '기록지 만들기'}</MD3Button>
        : !saved && <p className="text-xs text-[#5F6368]">기록 담당이 만들 수 있어요</p>}
      {!canMake && <p className="text-xs text-[#5F6368]">산출물을 저장하면 만들 수 있어요</p>}
    </div>
    <div className="mt-3 border-t border-[#E8DDF5] pt-3"><ReportVotes /></div>
  </section>
}

/** 기록지 전체 보기·만들기 창(단계 보고서 창과 같은 틀). */
export function LessonSheetModal({ generate, onBack, onClose }: { generate: boolean; onBack: () => void; onClose: () => void }) {
  const { project, userProfile } = useProjectStore()
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const started = useRef(false)
  useEffect(() => () => abort.current?.abort(), [])
  useLayoutEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' }) }, [busy])

  const isHost = canGenerateStageReport(project, userProfile?.uid)
  const content = draft ?? project?.lessonSheetReport?.content ?? ''

  async function make() {
    if (!project || !isHost || busy) return
    abort.current?.abort()
    const controller = new AbortController(); abort.current = controller
    setBusy(true); setError(''); setDraft('')
    try {
      await generateLessonSheet({ project, callerUid: userProfile?.uid, signal: controller.signal, onText: setDraft })
      setDraft(null)
    } catch (cause) {
      if (controller.signal.aborted) return
      setDraft(null)
      setError(cause instanceof Error ? cause.message : '기록지를 만들지 못했어요. 다시 시도해 주세요.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (!generate || started.current) return
    started.current = true
    if (project?.lessonSheetReport && !window.confirm('이전 기록지는 새 기록지로 바뀌어요. 다시 만들까요?')) return
    void make()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when opened to generate
  }, [generate])

  if (!project) return null
  const title = `${project.title} 수업 실행 나눔 기록지`
  function downloadMd() {
    const url = URL.createObjectURL(new Blob([cleanReportMarkdown(content)], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${project?.title ?? 'report'}_수업실행나눔기록지.md`; a.click()
    URL.revokeObjectURL(url)
  }
  async function downloadPdf() {
    if (!contentRef.current || pdfBusy) return
    setPdfBusy(true); setError('')
    try { await downloadReportPdf(contentRef.current, project?.title ?? '프로젝트', '수업 실행 나눔 기록지') }
    catch (cause) {
      console.error('Lesson sheet PDF download failed:', cause)
      setError('PDF 다운로드에 실패했습니다. 인쇄 창에서 PDF로 저장해 주세요.')
      printReport(contentRef.current, title)
    } finally { setPdfBusy(false) }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-[var(--md-sys-scrim)] backdrop-blur-sm" onClick={onClose} />
    <div role="dialog" aria-modal="true" aria-labelledby="lesson-sheet-title" className="relative z-10 flex h-[min(85vh,calc(100dvh_-_2rem))] w-full min-w-0 max-w-[860px] flex-col overflow-hidden rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-low)] shadow-2xl">
      <header className="shrink-0 border-b border-[var(--md-sys-outline-variant)] p-4 sm:px-6">
        <div className="flex items-start gap-2">
          <MD3Button variant="text" tone="neutral" onClick={onBack} aria-label="보고서 목록으로" icon={<ArrowLeft size={20} />} />
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Flask size={22} weight="fill" className="mt-1 shrink-0 text-[#6A1B9A]" />
            <h2 id="lesson-sheet-title" className="text-[20px] font-medium leading-7 text-[var(--md-sys-on-surface)]">수업 실행 나눔 기록지 (시험판)</h2>
          </div>
          <MD3Button variant="text" tone="neutral" onClick={onClose} aria-label="닫기" icon={<X size={20} />} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MD3Button variant="outlined" onClick={downloadMd} disabled={!content || busy} icon={<FileText size={18} />}>MD</MD3Button>
          <MD3Button variant="filled" onClick={() => { void downloadPdf() }} disabled={!content || busy || pdfBusy} icon={pdfBusy ? <SpinnerGap size={18} className="animate-spin" /> : <FilePdf size={18} />}>{pdfBusy ? '만드는 중…' : 'PDF 다운로드'}</MD3Button>
          <MD3Button variant="tonal" onClick={() => { if (contentRef.current) printReport(contentRef.current, title) }} disabled={!content || busy} icon={<FilePdf size={18} />}>인쇄</MD3Button>
          {isHost && <MD3Button variant="tonal" onClick={() => { if (window.confirm('이전 기록지는 새 기록지로 바뀌어요. 다시 만들까요?')) void make() }} disabled={busy || !hasLessonSheetSources(lessonSheetArtifacts(project))}>{busy ? '만드는 중…' : '다시 만들기'}</MD3Button>}
        </div>
        <div className="mt-3"><ReportVotes /></div>
        {error && <p role="alert" className="mt-3 text-[13px] text-[var(--md-sys-error)]">{error}</p>}
      </header>
      <div ref={scrollRef} style={{ overflowAnchor: 'none' }} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6" aria-busy={busy}>
        <p className="mb-4 rounded-[var(--md-sys-radius-md)] bg-[#F3E8FD] p-3 text-[12px] text-[#4A148C]">시험판이에요. 연수 기록지 양식으로 모든 단계의 저장 산출물을 한 장에 옮겼어요. 단계 보고서와 비교해 보고 더 좋은 형식에 표시해 주세요.</p>
        {busy && !content && <p role="status" className="py-6 text-center text-sm text-[#5F6368]">기록지를 만드는 중이에요… 보통 30초 안팎 걸려요.</p>}
        {content ? <div ref={contentRef}><ReportMarkdown content={lessonSheetDisplay(content)} project={project} /></div>
          : !busy && <p className="py-6 text-center text-sm text-[#5F6368]">{isHost ? '다시 만들기를 누르면 저장된 산출물로 기록지를 만들어요.' : '아직 기록지가 없어요. 기록 담당이 만들 수 있어요.'}</p>}
      </div>
    </div>
  </div>
}

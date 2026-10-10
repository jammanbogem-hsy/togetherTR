'use client'

/**
 * 단계별 테스트 보고서(기록지형 시험판) — 목록 위 안내·투표 카드, 단계 카드 안의 줄, 전체 보기 창.
 * 기본 단계 보고서와 나란히 두고, 선생님들이 더 좋은 형식에 표시(reportFormatVotes)하게 한다.
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
import { countReportVotes, generateStageTestReport, lessonSheetArtifacts, voteReportFormat, type ReportFormat } from '@/lib/report/lessonSheet'
import { STAGE_NAMES, hasStageTestSources } from '@/lib/report/lessonSheetPrompt'
import type { StageCode } from '@/types'

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
      <ThumbsUp size={14} weight={mine === format ? 'fill' : 'regular'} />{format === 'stage' ? '기본 보고서' : '테스트 보고서'} {votes[format]}
    </button>)}
    {error && <span role="alert" className="text-xs text-[var(--md-sys-error)]">{error}</span>}
  </div>
}

/** 단계 보고서 목록 맨 위 — 테스트 보고서 안내와 형식 선호 투표. */
export function LessonSheetCard() {
  return <section aria-label="테스트 보고서 안내" className="w-full min-w-0 rounded-[var(--md-sys-radius-lg)] border border-[#D7B8F3] bg-[#FBF7FE] p-4">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-md)] bg-[#EADDFF] text-[#4A148C]"><Flask size={20} weight="fill" /></div>
      <div className="min-w-0 flex-1">
        <h3 className="flex flex-wrap items-center gap-2 text-[16px] font-medium text-[var(--md-sys-on-surface)]">테스트 보고서 <span className="rounded-full bg-[#EADDFF] px-2 py-0.5 text-[11px] font-semibold text-[#4A148C]">시험판</span></h3>
        <p className="mt-1 text-[12px] leading-5 text-[var(--md-sys-on-surface-variant)]">연수 기록지처럼 칸마다 무엇을 쓸지 정해진 한 장 표 형식이에요. 단계마다 기본 보고서 아래의 &lsquo;테스트 보고서&rsquo;로 만들고 비교해 보세요.</p>
      </div>
    </div>
    <div className="mt-3 border-t border-[#E8DDF5] pt-3"><ReportVotes /></div>
  </section>
}

/** 단계 카드 안 — 그 단계의 테스트 보고서 보기·만들기. */
export function TestReportRow({ stage, onOpen }: { stage: StageCode; onOpen: (generate: boolean) => void }) {
  const { project, userProfile } = useProjectStore()
  if (!project) return null
  const saved = project.testReports?.[stage]
  const isHost = canGenerateStageReport(project, userProfile?.uid)
  const canMake = hasStageTestSources(stage, lessonSheetArtifacts(project))
  if (!saved && !canMake) return null
  return <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--md-sys-radius-md)] bg-[#FBF7FE] px-3 py-2">
    <Flask size={16} weight="fill" className="text-[#6A1B9A]" aria-hidden="true" />
    <span className="text-xs font-semibold text-[#4A148C]">테스트 보고서</span>
    <span className="text-xs text-[#5F6368]">{saved ? formatDate(saved.savedAt) : '아직 없음'}</span>
    <span className="flex-1" />
    {saved && <MD3Button variant="text" size="sm" onClick={() => onOpen(false)}>보기 →</MD3Button>}
    {isHost && canMake && <MD3Button variant="tonal" size="sm" onClick={() => onOpen(true)}>{saved ? '다시 만들기' : '만들기'}</MD3Button>}
  </div>
}

/** 테스트 보고서 전체 보기·만들기 창(단계 보고서 창과 같은 틀). */
export function LessonSheetModal({ stage, generate, onBack, onClose }: { stage: StageCode; generate: boolean; onBack: () => void; onClose: () => void }) {
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
  const saved = project?.testReports?.[stage]
  const content = draft ?? saved?.content ?? ''

  async function make() {
    if (!project || !isHost || busy) return
    abort.current?.abort()
    const controller = new AbortController(); abort.current = controller
    setBusy(true); setError(''); setDraft('')
    try {
      await generateStageTestReport({ project, stage, callerUid: userProfile?.uid, signal: controller.signal, onText: setDraft })
      setDraft(null)
    } catch (cause) {
      if (controller.signal.aborted) return
      setDraft(null)
      setError(cause instanceof Error ? cause.message : '테스트 보고서를 만들지 못했어요. 다시 시도해 주세요.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (!generate || started.current) return
    started.current = true
    if (saved && !window.confirm('이전 테스트 보고서는 새 보고서로 바뀌어요. 다시 만들까요?')) return
    void make()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when opened to generate
  }, [generate])

  if (!project) return null
  const label = `${STAGE_NAMES[stage]}(${stage}) 단계 테스트 보고서`
  const title = `${project.title} ${label}`
  function downloadMd() {
    const url = URL.createObjectURL(new Blob([cleanReportMarkdown(content)], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${project?.title ?? 'report'}_${STAGE_NAMES[stage]}_테스트보고서.md`; a.click()
    URL.revokeObjectURL(url)
  }
  async function downloadPdf() {
    if (!contentRef.current || pdfBusy) return
    setPdfBusy(true); setError('')
    try { await downloadReportPdf(contentRef.current, project?.title ?? '프로젝트', `${STAGE_NAMES[stage]} 테스트 보고서`) }
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
            <h2 id="lesson-sheet-title" className="text-[20px] font-medium leading-7 text-[var(--md-sys-on-surface)]">{label} (시험판)</h2>
          </div>
          <MD3Button variant="text" tone="neutral" onClick={onClose} aria-label="닫기" icon={<X size={20} />} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MD3Button variant="outlined" onClick={downloadMd} disabled={!content || busy} icon={<FileText size={18} />}>MD</MD3Button>
          <MD3Button variant="filled" onClick={() => { void downloadPdf() }} disabled={!content || busy || pdfBusy} icon={pdfBusy ? <SpinnerGap size={18} className="animate-spin" /> : <FilePdf size={18} />}>{pdfBusy ? '만드는 중…' : 'PDF 다운로드'}</MD3Button>
          <MD3Button variant="tonal" onClick={() => { if (contentRef.current) printReport(contentRef.current, title) }} disabled={!content || busy} icon={<FilePdf size={18} />}>인쇄</MD3Button>
          {isHost && <MD3Button variant="tonal" onClick={() => { if (window.confirm('이전 테스트 보고서는 새 보고서로 바뀌어요. 다시 만들까요?')) void make() }} disabled={busy || !hasStageTestSources(stage, lessonSheetArtifacts(project))}>{busy ? '만드는 중…' : '다시 만들기'}</MD3Button>}
        </div>
        <div className="mt-3"><ReportVotes /></div>
        {error && <p role="alert" className="mt-3 text-[13px] text-[var(--md-sys-error)]">{error}</p>}
      </header>
      <div ref={scrollRef} style={{ overflowAnchor: 'none' }} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6" aria-busy={busy}>
        <p className="mb-4 rounded-[var(--md-sys-radius-md)] bg-[#F3E8FD] p-3 text-[12px] text-[#4A148C]">시험판이에요. 연수 기록지처럼 칸마다 무엇을 쓸지 정해진 표로 이 단계의 산출물을 한 장에 정리했어요. 기본 보고서와 비교해 보고 더 좋은 형식에 표시해 주세요.</p>
        {busy && !content && <p role="status" className="py-6 text-center text-sm text-[#5F6368]">테스트 보고서를 만드는 중이에요… 보통 30초 안팎 걸려요.</p>}
        {content ? <div ref={contentRef}><ReportMarkdown content={lessonSheetDisplay(content)} project={project} /></div>
          : !busy && <p className="py-6 text-center text-sm text-[#5F6368]">{isHost ? '다시 만들기를 누르면 이 단계 산출물로 테스트 보고서를 만들어요.' : '아직 테스트 보고서가 없어요. 기록 담당이 만들 수 있어요.'}</p>}
      </div>
    </div>
  </div>
}

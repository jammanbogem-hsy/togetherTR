'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type StageCode } from '@/types'
import { MD3Button } from '@/components/ui/MD3Button'
import { ReportHero, ReportMarkdown } from './ReportMarkdown'
import { printReport } from './printReport'
import { X, DownloadSimple, FilePdf, FileText, SpinnerGap, ChartBar, ArrowRight } from '@phosphor-icons/react'
import { setAnalysisReport, saveStageReport } from '@/lib/firebase/projects'
import { generateHwpx } from '@/lib/hwpx/generateHwpx'

const STAGE_LABELS: Record<string, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

export function StageAnalysisModal({
  onClose,
  onReady,
  isHost = true,
}: {
  onClose: () => void
  onReady?: () => void
  isHost?: boolean
}) {
  const { project, setPendingStageMove, userProfile } = useProjectStore()
  const callerUid = userProfile?.uid
  const [markdown, setMarkdown] = useState('')
  const [status, setStatus] = useState<'loading' | 'streaming' | 'done' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusFrameRef = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  const onReadyRef = useRef(onReady)
  // 마운트 시점의 project 스냅샷 — Firestore 업데이트로 인한 재실행 방지
  const projectSnapshotRef = useRef(project)
  const hasStartedRef = useRef(false)

  const stage = project?.currentStage ?? 'T'

  useEffect(() => {
    onCloseRef.current = onClose
    onReadyRef.current = onReady
  }, [onClose, onReady])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    // Strict Mode의 setup→cleanup→setup 사이에 예약된 복원을 취소하고 최초 호출 요소를 보존한다.
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
      restoreFocusFrameRef.current = null
    }
    if (!restoreFocusRef.current) {
      const activeElement = document.activeElement
      restoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
    }

    const getFocusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true')

    dialog.focus({ preventScroll: true })
    onReadyRef.current?.()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      const focused = document.activeElement

      if (!dialog.contains(focused)) {
        event.preventDefault()
        const focusTarget = event.shiftKey ? last : first
        focusTarget.focus()
      } else if (event.shiftKey && (focused === first || focused === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)

      const elementToRestore = restoreFocusRef.current
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null
        const canRestoreOriginalFocus = !!elementToRestore
          && elementToRestore !== document.body
          && elementToRestore.isConnected
          && elementToRestore.offsetParent !== null
          && !elementToRestore.closest('[aria-hidden="true"]')
        if (canRestoreOriginalFocus) elementToRestore.focus({ preventScroll: true })
        if (restoreFocusRef.current === elementToRestore) restoreFocusRef.current = null
      })
    }
  }, [])

  // 다음 단계 코드 계산
  const nextStage = (() => {
    const idx = STAGES.findIndex(s => s.code === stage)
    return idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1].code as StageCode : null
  })()

  function handleMoveToNextStage() {
    if (!nextStage) return
    onClose()
    setPendingStageMove(nextStage)
  }

  // ── 방장: 마운트 1회만 실행 — 기존 보고서 있으면 재사용 ──
  useEffect(() => {
    if (!isHost || hasStartedRef.current) return
    hasStartedRef.current = true

    // 기존 완성된 보고서가 있으면 바로 표시 (재생성 안 함)
    const existingReport = projectSnapshotRef.current?.analysisReport
    if (existingReport && !existingReport.generating && existingReport.content && existingReport.stage === stage) {
      setMarkdown(existingReport.content)
      setStatus('done')
      return
    }

    const snap = projectSnapshotRef.current
    if (!snap) return

    async function run() {
      const p = snap!
      setMarkdown('')
      setStatus('loading')
      setErrorMsg('')

      // Firestore에 생성 중 표시
      if (p.id) await setAnalysisReport(p.id, stage, '', true).catch(console.error)

      const stageInfo = STAGES.find(s => s.code === stage)!
      const artifacts: Record<string, { title: string; content: Record<string, unknown> }> = {}
      for (const code of stageInfo.activities) {
        const art = p.artifacts?.[code]
        if (art) artifacts[code] = { title: ACTIVITY_META[code].label, content: art.content ?? {} }
      }

      abortRef.current = new AbortController()
      let fullText = ''
      try {
        const res = await fetch('/api/analyze/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            stage,
            project: {
              title: p.title,
              targetGradeGroup: p.targetGradeGroup,
              targetSubjects: p.targetSubjects,
            },
            artifacts,
          }),
        })
        if (!res.ok) throw new Error('분석 요청 실패')
        setStatus('streaming')

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'text') {
                fullText += data.text
                setMarkdown(fullText)
                setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
              } else if (data.type === 'done') {
                setStatus('done')
              } else if (data.type === 'error') {
                throw new Error(data.message)
              }
            } catch { /* ignore parse errors */ }
          }
        }
        setStatus('done')
        // 완료 후 Firestore 저장 → 팀원 공유 + 단계별 영구 저장
        if (p.id && fullText) {
          await setAnalysisReport(p.id, stage, fullText, false).catch(console.error)
          await saveStageReport(p.id, stage, fullText, callerUid).catch(console.error)
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : '알 수 없는 오류')
        if (p.id) await setAnalysisReport(p.id, stage, '', false).catch(console.error)
      }
    }

    run()
    return () => abortRef.current?.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 마운트 1회만 실행

  // 방장: 다시 생성 버튼
  function rerunAnalysis() {
    hasStartedRef.current = false
    projectSnapshotRef.current = project
    setMarkdown('')
    setStatus('loading')
    setErrorMsg('')
    hasStartedRef.current = true

    const snap = project
    if (!snap) return

    async function run() {
      const p = snap!
      if (p.id) await setAnalysisReport(p.id, stage, '', true).catch(console.error)

      const stageInfo = STAGES.find(s => s.code === stage)!
      const artifacts: Record<string, { title: string; content: Record<string, unknown> }> = {}
      for (const code of stageInfo.activities) {
        const art = p.artifacts?.[code]
        if (art) artifacts[code] = { title: ACTIVITY_META[code].label, content: art.content ?? {} }
      }

      abortRef.current?.abort()
      abortRef.current = new AbortController()
      let fullText = ''
      try {
        const res = await fetch('/api/analyze/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            stage,
            project: { title: p.title, targetGradeGroup: p.targetGradeGroup, targetSubjects: p.targetSubjects },
            artifacts,
          }),
        })
        if (!res.ok) throw new Error('분석 요청 실패')
        setStatus('streaming')
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'text') {
                fullText += data.text
                setMarkdown(fullText)
                setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
              } else if (data.type === 'done') {
                setStatus('done')
              }
            } catch { /* ignore */ }
          }
        }
        setStatus('done')
        if (p.id && fullText) {
          await setAnalysisReport(p.id, stage, fullText, false).catch(console.error)
          await saveStageReport(p.id, stage, fullText, callerUid).catch(console.error)
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : '알 수 없는 오류')
      }
    }
    run()
  }

  // ── 팀원: Firestore 보고서 감지 (project 구독으로 자동 업데이트) ──
  useEffect(() => {
    if (isHost) return
    const saved = project?.analysisReport
    if (saved && !saved.generating && saved.content && saved.stage === stage) {
      setMarkdown(saved.content)
      setStatus('done')
    }
  // project.analysisReport만 감지
  }, [project?.analysisReport, isHost, stage])

  function downloadMd() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.title ?? 'report'}_${STAGE_LABELS[stage]}_분석.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadPdf() {
    if (!contentRef.current) return
    printReport(contentRef.current, `${project?.title ?? ''} ${STAGE_LABELS[stage]} 분석 보고서`)
  }

  async function downloadHwpx() {
    if (!markdown) return

    try {
      const filename = `${project?.title ?? 'report'}_${STAGE_LABELS[stage]}_분석.hwpx`
      const blob = await generateHwpx(markdown, `${project?.title ?? '프로젝트'} ${STAGE_LABELS[stage]} 분석 보고서`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Stage analysis HWPX export failed:', error)
      window.alert('HWPX 생성에 실패했습니다. 현재는 PDF 또는 Markdown 공유를 사용해주세요.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--md-sys-scrim)] p-4 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="stage-analysis-title" tabIndex={-1}
        className="flex h-[min(86vh,calc(100dvh_-_2rem))] w-full min-w-0 max-w-[860px] flex-col overflow-hidden rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-low)] shadow-2xl">
        <header className="shrink-0 border-b border-[var(--md-sys-outline-variant)] p-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)]">
              <ChartBar size={22} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--md-sys-on-surface-variant)]">{stage} 단계</p>
              <h2 id="stage-analysis-title" className="text-[20px] font-medium leading-7 text-[var(--md-sys-on-surface)]">{STAGE_LABELS[stage]} 단계 분석 보고서</h2>
            </div>
            <MD3Button variant="text" tone="neutral" onClick={onClose} aria-label="단계 분석 보고서 닫기" icon={<X size={20} />} />
          </div>
          {status === 'done' && <div className="mt-4 flex flex-wrap gap-2">
            <MD3Button variant="outlined" onClick={downloadMd} icon={<FileText size={18} />}>MD 저장</MD3Button>
            <MD3Button variant="tonal" onClick={downloadPdf} icon={<FilePdf size={18} />}>PDF 저장</MD3Button>
            <MD3Button variant="outlined" onClick={downloadHwpx} icon={<DownloadSimple size={18} />}>HWPX 베타</MD3Button>
          </div>}
        </header>

        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <div ref={contentRef}>
            <ReportHero content={markdown} stage={stage} project={project} generating={status === 'loading' || status === 'streaming'} generatedAt={project?.stageReports?.[stage]?.content === markdown ? project.stageReports[stage]?.savedAt : undefined} />
            {status === 'loading' && <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center text-[var(--md-sys-on-surface-variant)]">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)]"><ChartBar size={28} weight="fill" /></div>
              <p className="text-[16px] font-medium">{isHost ? '산출물 분석 중...' : '보고서가 생성 중입니다'}</p>
              <p className="text-[13px]">{isHost ? 'T-CID 협력 수업설계 관점에서 분석합니다' : '방장이 분석을 완료하면 자동으로 표시됩니다'}</p>
              {!isHost && <SpinnerGap size={20} className="animate-spin text-[var(--md-sys-primary)]" />}
            </div>}
            {(status === 'streaming' || status === 'done') && markdown && <div className="min-w-0">
              <ReportMarkdown content={markdown} stage={stage} project={project} />
              {status === 'streaming' && <SpinnerGap size={16} className="mt-2 animate-spin text-[var(--md-sys-primary)]" />}
            </div>}
            {status === 'error' && <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <p className="font-medium text-[var(--md-sys-error)]">분석 중 오류가 발생했습니다</p>
              <p className="break-words text-[13px] text-[var(--md-sys-on-surface-variant)]">{errorMsg}</p>
              <MD3Button variant="filled" onClick={rerunAnalysis}>다시 시도</MD3Button>
            </div>}
          </div>
        </div>
        {status === 'streaming' && <div className="flex shrink-0 items-center gap-2 border-t border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container)] px-4 py-3 text-[13px] text-[var(--md-sys-on-surface-variant)] sm:px-6">
          <SpinnerGap size={16} className="animate-spin text-[var(--md-sys-primary)]" />분석 생성 중...
        </div>}
        {status === 'done' && <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container)] p-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <span className="rounded-full bg-[var(--md-sys-tertiary-container)] px-3 py-1 text-[12px] font-medium text-[var(--md-sys-on-tertiary-container)]">✓ 분석 완료</span>
            {isHost && <p className="mt-2 text-[12px] text-[var(--md-sys-on-surface-variant)]">보고서가 저장됐습니다 · “보고서 확인”에서 다시 볼 수 있어요</p>}
          </div>
          {isHost && <MD3Button variant="text" tone="neutral" onClick={rerunAnalysis}>다시 생성</MD3Button>}
          {isHost && nextStage && <MD3Button variant="filled" onClick={handleMoveToNextStage} trailing={<ArrowRight size={18} />} className="w-full sm:w-auto">{STAGE_LABELS[nextStage]} 단계로 이동</MD3Button>}
        </footer>}
      </div>
    </div>
  )
}

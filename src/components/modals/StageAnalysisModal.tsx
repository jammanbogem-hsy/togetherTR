'use client'

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type StageCode } from '@/types'
import { cn } from '@/lib/utils'
import { X, DownloadSimple, FilePdf, FileText, SpinnerGap, ChartBar, ArrowRight } from '@phosphor-icons/react'
import { setAnalysisReport } from '@/lib/firebase/projects'

const STAGE_COLOR: Record<string, { bg: string; text: string; light: string }> = {
  T:  { bg: 'bg-[#1A73E8]', text: 'text-[#1A73E8]', light: 'bg-[#E8F0FE]' },
  A:  { bg: 'bg-[#7B1FA2]', text: 'text-[#7B1FA2]', light: 'bg-[#F3E5F5]' },
  Ds: { bg: 'bg-[#00897B]', text: 'text-[#00897B]', light: 'bg-[#E0F2F1]' },
  DI: { bg: 'bg-[#E65100]', text: 'text-[#E65100]', light: 'bg-[#FBE9E7]' },
  E:  { bg: 'bg-[#C62828]', text: 'text-[#C62828]', light: 'bg-[#FFEBEE]' },
}

const STAGE_LABELS: Record<string, string> = {
  T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가',
}

export function StageAnalysisModal({ onClose, isHost = true }: { onClose: () => void; isHost?: boolean }) {
  const { project, setPendingStageMove } = useProjectStore()
  const [markdown, setMarkdown] = useState('')
  const [status, setStatus] = useState<'loading' | 'streaming' | 'done' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 마운트 시점의 project 스냅샷 — Firestore 업데이트로 인한 재실행 방지
  const projectSnapshotRef = useRef(project)
  const hasStartedRef = useRef(false)

  const stage = project?.currentStage ?? 'T'
  const color = STAGE_COLOR[stage]

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
        // 완료 후 Firestore 저장 → 팀원 공유
        if (p.id && fullText) {
          await setAnalysisReport(p.id, stage, fullText, false).catch(console.error)
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
        if (p.id && fullText) await setAnalysisReport(p.id, stage, fullText, false).catch(console.error)
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
    const contentEl = contentRef.current
    if (!contentEl) return
    const win = window.open('', '_blank')
    if (!win) return

    // 렌더된 DOM의 innerHTML을 그대로 복사 → 화면과 동일한 스타일 유지
    const html = contentEl.innerHTML

    win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${project?.title ?? ''} ${STAGE_LABELS[stage]} 분석 보고서</title>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(32,33,36,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '780px', maxWidth: '96vw', height: '86vh' }}
      >
        {/* 헤더 */}
        <div className={cn('flex items-center justify-between px-6 py-4 flex-shrink-0', color.light)}>
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 flex items-center justify-center rounded-xl', color.bg)}
              style={{ animation: 'morph-shape 8s ease-in-out infinite' }}>
              <ChartBar size={20} weight="fill" className="text-white" />
            </div>
            <div>
              <p className={cn('text-[11px] font-bold uppercase tracking-widest', color.text)}>{stage} 단계</p>
              <h2 className="text-[16px] font-extrabold text-[#202124]">
                {STAGE_LABELS[stage]} 단계 분석 보고서
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'done' && (
              <>
                <button onClick={downloadMd}
                  className="morph-btn flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold bg-white border-2 border-[#DADCE0] text-[#5F6368] hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
                >
                  <FileText size={15} weight="fill" />
                  MD 저장
                </button>
                <button onClick={downloadPdf}
                  className="morph-btn flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold bg-[#1A73E8] text-white hover:bg-[#1557B0] transition-colors"
                  style={{ filter: 'drop-shadow(0 2px 6px rgba(26,115,232,0.35))' }}
                >
                  <FilePdf size={15} weight="fill" />
                  PDF 저장
                </button>
              </>
            )}
            <button onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#9AA0A6] hover:bg-[#F1F3F4] hover:text-[#202124] transition-colors ml-1"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-7">
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[#9AA0A6]">
              <div className={cn('w-16 h-16 flex items-center justify-center', color.bg)}
                style={{ animation: 'morph-shape 7s ease-in-out infinite, stage-bounce 2.8s ease-in-out infinite', filter: `drop-shadow(0 4px 14px ${color.bg.replace('bg-', '')})` }}>
                <ChartBar size={28} weight="fill" className="text-white" />
              </div>
              {isHost ? (
                <>
                  <p className="text-[14px] font-semibold text-[#5F6368]">산출물 분석 중...</p>
                  <p className="text-[12px] text-[#9AA0A6]">T-CID 협력 수업설계 관점에서 분석합니다</p>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-semibold text-[#5F6368]">보고서가 생성 중입니다</p>
                  <p className="text-[12px] text-[#9AA0A6]">방장이 분석을 완료하면 자동으로 표시됩니다</p>
                  <SpinnerGap size={20} className={cn('animate-spin mt-1', color.text)} />
                </>
              )}
            </div>
          )}

          {(status === 'streaming' || status === 'done') && markdown && (
            <div className="max-w-none" ref={contentRef}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
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
                  td: ({ children }) => (
                    <td style={{ padding: '0.6rem 1rem', borderTop: '1px solid #F1F3F4', color: '#3C4043', fontSize: '0.88rem', whiteSpace: 'nowrap' }}>{children}</td>
                  ),
                  hr: () => (
                    <hr style={{ border: 'none', borderTop: '1.5px solid #F1F3F4', margin: '1.8rem 0' }} />
                  ),
                  em: ({ children }) => (
                    <em style={{ fontStyle: 'normal', color: '#5F6368', fontSize: '0.88rem' }}>{children}</em>
                  ),
                }}
              >
                {markdown}
              </ReactMarkdown>
              {status === 'streaming' && (
                <span className="inline-flex items-center gap-1 ml-1 text-[#1A73E8]">
                  <SpinnerGap size={14} className="animate-spin" />
                </span>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-[14px] text-red-500 font-semibold">분석 중 오류가 발생했습니다</p>
              <p className="text-[12px] text-[#9AA0A6]">{errorMsg}</p>
              <button onClick={rerunAnalysis}
                className="morph-btn px-5 py-2.5 bg-[#1A73E8] text-white text-[13px] font-bold hover:bg-[#1557B0] transition-colors">
                다시 시도
              </button>
            </div>
          )}
        </div>

        {/* 하단 상태 바 */}
        {status === 'streaming' && (
          <div className={cn('px-6 py-2.5 flex-shrink-0 flex items-center gap-2 border-t border-[#F1F3F4]', color.light)}>
            <SpinnerGap size={14} className={cn('animate-spin', color.text)} />
            <span className={cn('text-[12px] font-semibold', color.text)}>분석 생성 중...</span>
          </div>
        )}
        {status === 'done' && (
          <div className="px-6 py-3 flex-shrink-0 flex items-center justify-between gap-3 border-t border-[#F1F3F4] bg-[#F8F9FA]">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-[12px] text-[#34A853] font-semibold whitespace-nowrap">✓ 분석 완료</span>
              <span className="text-[11px] text-[#9AA0A6] hidden sm:inline">MD 또는 PDF로 저장하세요</span>
              {isHost && (
                <button onClick={rerunAnalysis}
                  className="text-[11px] text-[#9AA0A6] hover:text-[#5F6368] underline transition-colors whitespace-nowrap">
                  다시 생성
                </button>
              )}
            </div>
            {isHost && nextStage && (
              <button
                onClick={handleMoveToNextStage}
                className="morph-btn flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold text-white bg-[#1A73E8] hover:bg-[#1557B0] transition-colors whitespace-nowrap flex-shrink-0"
              >
                {STAGE_LABELS[nextStage]} 단계로 이동
                <ArrowRight size={15} weight="bold" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

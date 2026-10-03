'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { pickReportIcon, stripLeadingEmoji, childrenToText, ReportIcon } from '@/components/ui/ReportSectionIcon'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { useProjectStore } from '@/store/project'
import type { ActivityCode } from '@/types'
import { X, FileText, SpinnerGap, ArrowsOut, ArrowsIn, DownloadSimple, FloppyDisk, Users, FilePdf, FileMd, CaretDown } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { saveCumulativeReport } from '@/lib/firebase/projects'
import { generateHwpx } from '@/lib/hwpx/generateHwpx'

// DI-1-1까지의 활동 목록
const REPORT_ACTIVITIES: ActivityCode[] = [
  'T-1-1', 'T-1-2', 'T-2-1', 'T-2-2', 'T-2-3',
  'A-1-1', 'A-1-2', 'A-2-1', 'A-2-2', 'A-2-3',
  'Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2',
  'DI-1-1',
]

interface Props {
  onClose: () => void
}

export function CumulativeReportModal({ onClose }: Props) {
  const { project, userProfile } = useProjectStore()
  const isHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid

  const savedReport = project?.cumulativeReport

  // 팀장도 저장된 보고서 있으면 그걸로 시작 (재생성 전까지 표시)
  const [content, setContent] = useState(savedReport?.content ?? '')
  const [isGenerating, setIsGenerating] = useState(false)
  // savedReport가 있으면 팀장도 이미 완료 상태로 시작
  const [isDone, setIsDone] = useState(() => isHost && !!savedReport)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(isHost && !!savedReport)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const projectRef = useRef(project)
  // 생성 시작 후 project store 변경에 영향받지 않도록 ref로 고정
  useEffect(() => { projectRef.current = project }, [project])

  // 팀장: 저장된 보고서 없을 때만 자동 생성 시작 (한 번만)
  const hasStarted = useRef(false)
  useEffect(() => {
    if (!isHost || hasStarted.current || !!savedReport) return
    hasStarted.current = true
    generateReport()
    return () => { abortRef.current?.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 스트리밍 중 스크롤 맨 아래 유지
  useEffect(() => {
    if (isGenerating && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, isGenerating])

  async function generateReport() {
    // 현재 시점의 project 스냅샷 사용 — 이후 store 업데이트 무관
    const snap = projectRef.current
    if (!snap) return
    setIsGenerating(true)
    setIsDone(false)
    setIsSaved(false)
    setError(null)
    setContent('')

    const artifacts: Record<string, { title: string; content: Record<string, unknown> }> = {}
    for (const code of REPORT_ACTIVITIES) {
      const art = snap.artifacts?.[code]
      if (art && Object.keys(art.content ?? {}).length > 0) {
        artifacts[code] = { title: art.title, content: art.content as Record<string, unknown> }
      }
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/analyze/cumulative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: {
            title: snap.title,
            targetGradeGroup: snap.targetGradeGroup,
            targetSubjects: snap.targetSubjects,
          },
          artifacts,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error('API 오류')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      function processBuffer(buf: string) {
        const lines = buf.split('\n')
        const remaining = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed.type === 'text') setContent(prev => prev + parsed.text)
            if (parsed.type === 'done') setIsDone(true)
            if (parsed.type === 'error') setError(parsed.message)
          } catch { /* ignore */ }
        }
        return remaining
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // 스트림 종료 시 남은 버퍼까지 처리 (done 이벤트가 마지막 청크에 있을 수 있음)
          processBuffer(buffer + '\n')
          break
        }
        buffer += decoder.decode(value, { stream: true })
        buffer = processBuffer(buffer)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '보고서 생성 실패')
      }
    } finally {
      setIsGenerating(false)
      // done 이벤트 누락 방지 폴백: 에러 없이 완료됐으면 done 처리
      setIsDone(prev => prev || true)
    }
  }

  async function handleSave() {
    if (!project || !content || !userProfile) return
    setIsSaving(true)
    try {
      await saveCumulativeReport(project.id, content, userProfile.uid)
      setIsSaved(true)
    } catch {
      setError('저장 실패. 다시 시도해주세요.')
    } finally {
      setIsSaving(false)
    }
  }

  function handleCopyLink() {
    if (!project) return
    const url = `${window.location.origin}/report/${project.id}`
    navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2500)
  }

  function handleDownloadMd() {
    if (!displayContent) return
    const filename = `T-CID_종합보고서_${project?.title ?? '보고서'}_${new Date().toISOString().slice(0, 10)}.md`
    const blob = new Blob([displayContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setShowDownloadMenu(false)
  }

  function handleDownloadPdf() {
    if (!displayContent) return

    function inlineFormat(text: string): string {
      return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
    }

    function mdToHtml(md: string): string {
      const lines = md.split('\n')
      const out: string[] = []
      let i = 0

      while (i < lines.length) {
        const line = lines[i]

        // 수평선
        if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue }

        // 헤딩
        const hMatch = line.match(/^(#{1,4})\s+(.+)$/)
        if (hMatch) {
          const lvl = hMatch[1].length
          out.push(`<h${lvl}>${inlineFormat(hMatch[2])}</h${lvl}>`)
          i++; continue
        }

        // blockquote (연속 줄 합치기)
        if (line.startsWith('> ')) {
          const bqLines: string[] = []
          while (i < lines.length && lines[i].startsWith('> ')) {
            bqLines.push(lines[i].slice(2))
            i++
          }
          out.push(`<blockquote>${inlineFormat(bqLines.join('<br>'))}</blockquote>`)
          continue
        }

        // 표 (|로 시작하는 줄 묶기)
        if (line.startsWith('|')) {
          const tableLines: string[] = []
          while (i < lines.length && lines[i].startsWith('|')) {
            tableLines.push(lines[i])
            i++
          }
          // 구분선(|---|) 필터링
          const isSeparator = (l: string) => /^\|[\s\-:|]+\|$/.test(l)
          const dataLines = tableLines.filter(l => !isSeparator(l))
          if (dataLines.length === 0) continue
          const rows = dataLines.map(l =>
            l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inlineFormat(c.trim()))
          )
          let tableHtml = '<table><thead><tr>'
          rows[0].forEach(cell => { tableHtml += `<th>${cell}</th>` })
          tableHtml += '</tr></thead><tbody>'
          rows.slice(1).forEach(row => {
            tableHtml += '<tr>'
            row.forEach(cell => { tableHtml += `<td>${cell}</td>` })
            tableHtml += '</tr>'
          })
          tableHtml += '</tbody></table>'
          out.push(tableHtml)
          continue
        }

        // 목록
        const isBullet = (l: string) => /^[-*]\s/.test(l) || /^- \[.?\]/.test(l)
        const isOrdered = (l: string) => /^\d+\.\s/.test(l)
        if (isBullet(line) || isOrdered(line)) {
          const ordered = isOrdered(line)
          const tag = ordered ? 'ol' : 'ul'
          const listLines: string[] = []
          while (i < lines.length && (isBullet(lines[i]) || isOrdered(lines[i]))) {
            listLines.push(lines[i])
            i++
          }
          const items = listLines.map(l => {
            const checkboxMatch = l.match(/^- \[( |x)\] (.+)/)
            if (checkboxMatch) {
              const checked = checkboxMatch[1] === 'x'
              return `<li class="checkbox">${checked ? '☑' : '☐'} ${inlineFormat(checkboxMatch[2])}</li>`
            }
            const text = l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')
            return `<li>${inlineFormat(text)}</li>`
          }).join('')
          out.push(`<${tag}>${items}</${tag}>`)
          continue
        }

        // 빈 줄
        if (line.trim() === '') { i++; continue }

        // 일반 문단
        const paraLines: string[] = []
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !lines[i].match(/^#{1,4}\s/) &&
          !lines[i].startsWith('|') &&
          !lines[i].startsWith('> ') &&
          !isBullet(lines[i]) &&
          !isOrdered(lines[i]) &&
          !/^---+$/.test(lines[i].trim())
        ) {
          paraLines.push(lines[i])
          i++
        }
        if (paraLines.length > 0) {
          out.push(`<p>${inlineFormat(paraLines.join(' '))}</p>`)
        }
      }
      return out.join('\n')
    }

    const html = mdToHtml(displayContent)
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>T-CID 종합 설계 보고서 · ${project?.title ?? ''}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; font-size: 10pt; line-height: 1.8; color: #202124; padding: 20mm 20mm 20mm 25mm; }
  h1 { font-size: 18pt; font-weight: 900; color: #202124; border-bottom: 3px solid #E65100; padding-bottom: 8px; margin: 0 0 16px; }
  h2 { font-size: 12pt; font-weight: 800; color: #E65100; background: #FBE9E7; border-radius: 6px; padding: 5px 14px; margin: 28px 0 14px; display: inline-block; }
  h3 { font-size: 11pt; font-weight: 700; color: #202124; border-left: 3px solid #E65100; padding-left: 10px; margin: 20px 0 8px; }
  h4 { font-size: 10pt; font-weight: 700; color: #5F6368; border-left: 2px solid #DADCE0; padding-left: 8px; margin: 14px 0 6px; }
  p { margin: 6px 0; line-height: 1.8; }
  blockquote { background: #FFF3E0; border-left: 4px solid #E65100; padding: 10px 14px; margin: 10px 0; font-weight: 600; color: #BF360C; border-radius: 0 8px 8px 0; }
  ul { list-style: none; margin: 8px 0; padding: 0; }
  ol { margin: 8px 0 8px 18px; padding: 0; }
  li { margin-bottom: 5px; padding-left: 14px; position: relative; }
  ul li::before { content: "●"; position: absolute; left: 0; color: #E65100; font-size: 7pt; top: 4px; }
  li.checkbox { list-style: none; padding-left: 0; }
  li.checkbox::before { display: none; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; table-layout: auto; }
  thead { background: #E65100; color: white; }
  th { padding: 7px 10px; text-align: left; font-weight: 700; word-break: keep-all; overflow-wrap: anywhere; vertical-align: top; }
  td { padding: 6px 10px; border-top: 1px solid #EEEEEE; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: #FFF8F5; }
  hr { border: none; border-top: 1.5px solid #F1F3F4; margin: 18px 0; }
  strong { font-weight: 800; }
  em { font-style: italic; color: #5F6368; }
  code { background: #F8F9FA; border: 1px solid #DADCE0; border-radius: 3px; padding: 0 3px; font-size: 9pt; }
  @media print {
    body { padding: 15mm 15mm 15mm 20mm; }
    h2 { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    blockquote { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tbody tr:nth-child(even) td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1, h2, h3 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
${html}
<script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`)
    printWindow.document.close()
    setShowDownloadMenu(false)
  }

  async function handleDownloadHwpx() {
    if (!displayContent) return
    try {
      const filename = `T-CID_종합보고서_${project?.title ?? '보고서'}_${new Date().toISOString().slice(0, 10)}.hwpx`
      const blob = await generateHwpx(displayContent, project?.title ?? '종합 설계 보고서')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setShowDownloadMenu(false)
    } catch (error) {
      console.error('HWPX download failed:', error)
      window.alert('HWPX 생성에 실패했습니다. 현재는 PDF 또는 Markdown 공유를 사용해주세요.')
    }
  }

  const artifactCount = REPORT_ACTIVITIES.filter(code =>
    project?.artifacts?.[code] && Object.keys(project.artifacts[code]?.content ?? {}).length > 0
  ).length

  const rawContent = content || (savedReport?.content ?? '')
  // 렌더링 전 정규화: 테이블 줄은 <br/>→\u2028(td에서 처리), 나머지는 \n, ~~취소선~~ 제거
  const displayContent = rawContent
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .split('\n')
    .map(line => line.startsWith('|')
      ? line.replace(/<br\s*\/?>/gi, '\u2028')
      : line.replace(/<br\s*\/?>/gi, '\n')
    )
    .join('\n')

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`relative bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ${
          isFullscreen ? 'w-full h-full max-w-none max-h-none rounded-none' : 'w-full max-w-5xl h-[92vh]'
        }`}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8EAED] bg-gradient-to-r from-[#E65100]/10 to-[#FBE9E7] flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#E65100] flex items-center justify-center flex-shrink-0">
            <FileText size={20} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#E65100] uppercase tracking-wider">T-CID 종합 설계 보고서</p>
            <p className="text-[14px] font-bold text-[#202124] truncate">
              {project?.title ?? '프로젝트'} · 팀준비 → 분석 → 설계 → 자료 개발
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] font-semibold text-[#5F6368] bg-[#F1F3F4] rounded-full px-2.5 py-1">
              산출물 {artifactCount}개
            </span>
            {/* 팀원용: 저장된 보고서 표시 */}
            {!isHost && savedReport && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#137333] bg-[#E6F4EA] rounded-full px-2.5 py-1">
                <Users size={12} weight="fill" />
                팀장 공유
              </span>
            )}
            {/* 다운로드 드롭다운 (팀장: 완료 후 / 팀원: 저장된 보고서 있을 때) */}
            {((isHost && (isDone || isSaved)) || (!isHost && !!savedReport)) && displayContent && (
              <div className="relative">
                <button
                  onClick={() => setShowDownloadMenu(m => !m)}
                  title="다운로드"
                  className="flex items-center gap-1 p-1.5 pl-2.5 pr-2 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] hover:text-[#E65100] transition-colors text-[11px] font-semibold"
                >
                  <DownloadSimple size={14} weight="regular" />
                  다운로드
                  <CaretDown size={11} weight="bold" />
                </button>
                {showDownloadMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDownloadMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-[#E8EAED] py-1 min-w-[140px]">
                      <button
                        onClick={handleDownloadMd}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-[#202124] hover:bg-[#F8F9FA] transition-colors"
                      >
                        <FileMd size={16} weight="fill" className="text-[#5F6368]" />
                        Markdown (.md)
                      </button>
                      <button
                        onClick={handleDownloadPdf}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-[#202124] hover:bg-[#F8F9FA] transition-colors"
                      >
                        <FilePdf size={16} weight="fill" className="text-[#E65100]" />
                        PDF (인쇄)
                      </button>
                      <button
                        onClick={handleDownloadHwpx}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-[#202124] hover:bg-[#F8F9FA] transition-colors"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="2" width="18" height="20" rx="2" fill="#00AEEF" opacity="0.15"/>
                          <path d="M3 4a2 2 0 012-2h10l6 6v12a2 2 0 01-2 2H5a2 2 0 01-2-2V4z" stroke="#00AEEF" strokeWidth="1.5"/>
                          <path d="M13 2v6h6" stroke="#00AEEF" strokeWidth="1.5" strokeLinejoin="round"/>
                          <text x="5" y="18" fontSize="7" fontWeight="bold" fill="#00AEEF">HWPX</text>
                        </svg>
                        한글 (.hwpx) 베타
                      </button>
                      <div className="px-4 py-2.5 text-[11px] leading-5 text-[#5F6368] border-t border-[#F1F3F4] bg-[#F8F9FA]">
                        HWPX는 기본형 내보내기만 지원합니다. 제목, 문단, 목록, 단순 표를 우선 보존하며 복잡한 스타일은 간소화됩니다.
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => setIsFullscreen(f => !f)}
              title={isFullscreen ? '창 크기로' : '전체 화면'}
              className="p-1.5 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] transition-colors"
            >
              {isFullscreen ? <ArrowsIn size={16} weight="regular" /> : <ArrowsOut size={16} weight="regular" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] transition-colors"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {/* 팀원이고 저장된 보고서 없는 경우 */}
        {!isHost && !savedReport && (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center px-8">
              <div className="w-16 h-16 rounded-full bg-[#FBE9E7] flex items-center justify-center mx-auto mb-4">
                <FileText size={32} weight="regular" className="text-[#E65100]" />
              </div>
              <p className="text-sm font-bold text-[#202124] mb-2">아직 보고서가 없습니다</p>
              <p className="text-xs text-[#9AA0A6] leading-relaxed">
                팀장이 보고서를 생성하고 저장하면<br />여기서 확인할 수 있습니다
              </p>
            </div>
          </div>
        )}

        {/* 생성 중 상태 배너 (팀장만) */}
        {isHost && isGenerating && (
          <div className="flex items-center gap-2.5 px-6 py-2.5 bg-[#FFF3E0] border-b border-[#FFE0B2] flex-shrink-0">
            <SpinnerGap size={16} weight="bold" className="text-[#E65100] animate-spin flex-shrink-0" />
            <span className="text-[12px] font-semibold text-[#BF360C]">
              AI가 전체 산출물을 분석하여 보고서를 작성하고 있습니다... (1~2분 소요)
            </span>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="px-6 py-3 bg-[#FFEBEE] border-b border-[#FFCDD2] flex-shrink-0">
            <p className="text-[12px] font-semibold text-[#C62828]">오류: {error}</p>
            {isHost && (
              <button onClick={generateReport} className="mt-1 text-[11px] text-[#C62828] underline">다시 시도</button>
            )}
          </div>
        )}

        {/* 본문 */}
        {(isHost || savedReport) && (
          <div ref={contentRef} className="flex-1 overflow-y-auto">
            {isHost && !displayContent && !isGenerating && !error && (
              <div className="flex items-center justify-center h-full text-[#9AA0A6]">
                <div className="text-center">
                  <SpinnerGap size={32} className="animate-spin mx-auto mb-3 text-[#E65100]" />
                  <p className="text-sm font-semibold">보고서 생성 준비 중...</p>
                </div>
              </div>
            )}

            {displayContent && (
              <div className="px-10 py-8 max-w-4xl mx-auto">
                {/* 저장된 보고서 표시 시 안내 배너 */}
                {!isHost && savedReport && (
                  <div className="mb-6 flex items-center gap-2.5 bg-[#E6F4EA] border border-[#B7DFC3] rounded-xl px-4 py-3">
                    <Users size={16} weight="fill" className="text-[#137333] flex-shrink-0" />
                    <span className="text-[12px] font-semibold text-[#137333]">
                      팀장이 저장한 보고서입니다 ·{' '}
                      {new Date(savedReport.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}

                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  components={{
                    h1: ({ children }) => (
                      <h1 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#202124', margin: '0 0 0.5rem', lineHeight: 1.2, letterSpacing: '-0.03em', paddingBottom: '1rem', borderBottom: '3px solid #E65100' }}>
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => {
                      // 이모지 제목 → 벡터 아이콘 (그라데이션은 M3 단색 컨테이너로)
                      const raw = childrenToText(children)
                      const iconName = pickReportIcon(raw)
                      return (
                        <div style={{ marginTop: '3.2rem', marginBottom: '1.4rem', borderRadius: '12px', background: '#BF360C', padding: '0.75rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {iconName && <ReportIcon name={iconName} size={20} color="#FFFFFF" />}
                          <span style={{ fontSize: '1.05rem', fontWeight: 600, color: 'white', letterSpacing: '0.01em', lineHeight: 1.3 }}>
                            {stripLeadingEmoji(raw) || children}
                          </span>
                        </div>
                      )
                    },
                    h3: ({ children }) => (
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#E65100', margin: '1.8rem 0 0.6rem', paddingLeft: '0.8rem', borderLeft: '3px solid #E65100', lineHeight: 1.4, background: '#FFF8F5', padding: '0.45rem 0.8rem', borderRadius: '0 6px 6px 0' }}>
                        {children}
                      </h3>
                    ),
                    h4: ({ children }) => (
                      <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#5F6368', margin: '1.4rem 0 0.4rem', paddingLeft: '0.5rem', borderLeft: '2px solid #DADCE0', lineHeight: 1.4 }}>
                        {children}
                      </h4>
                    ),
                    p: ({ children }) => (
                      <p style={{ fontSize: '0.92rem', color: '#3C4043', lineHeight: 1.85, margin: '0.6rem 0' }}>
                        {children}
                      </p>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ fontWeight: 800, color: '#202124', background: 'rgba(230,81,0,0.08)', borderRadius: '3px', padding: '0 3px' }}>
                        {children}
                      </strong>
                    ),
                    blockquote: ({ children }) => (
                      <div style={{ margin: '1rem 0', padding: '0.9rem 1.2rem', background: 'linear-gradient(135deg, #FFF3E0 0%, #FBE9E7 100%)', borderLeft: '4px solid #E65100', borderRadius: '0 12px 12px 0', fontSize: '0.92rem', color: '#BF360C', fontWeight: 600, lineHeight: 1.75 }}>
                        {children}
                      </div>
                    ),
                    ul: ({ children }) => (
                      <ul style={{ listStyle: 'none', padding: 0, margin: '0.7rem 0' }}>{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol style={{ listStyle: 'none', padding: 0, margin: '0.7rem 0', counterReset: 'ol-counter' }}>{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.55rem', fontSize: '0.91rem', color: '#3C4043', lineHeight: 1.8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#E65100', flexShrink: 0, marginTop: '0.55rem', display: 'inline-block' }} />
                        <span>{children}</span>
                      </li>
                    ),
                    table: ({ children }) => (
                      <div style={{ margin: '1.2rem 0', borderRadius: '12px', border: '1.5px solid #DADCE0', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', tableLayout: 'auto' }}>{children}</table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead style={{ background: 'linear-gradient(90deg, #E65100, #BF360C)', color: 'white' }}>{children}</thead>
                    ),
                    th: ({ children }) => (
                      <th style={{ padding: '0.7rem 1.1rem', textAlign: 'left', fontWeight: 700, fontSize: '0.83rem', color: 'white', wordBreak: 'keep-all', overflowWrap: 'anywhere', verticalAlign: 'top' }}>{children}</th>
                    ),
                    tr: ({ children, ...props }) => (
                      <tr style={(props as { style?: React.CSSProperties }).style}>{children}</tr>
                    ),
                    td: ({ children }) => {
                      const baseStyle: React.CSSProperties = { padding: '0.65rem 1.1rem', borderTop: '1px solid #F1F3F4', color: '#3C4043', fontSize: '0.88rem', verticalAlign: 'top', lineHeight: 1.6, wordBreak: 'keep-all', overflowWrap: 'anywhere' }
                      const text = typeof children === 'string' ? children : null
                      if (text && text.includes('\u2028')) {
                        return (
                          <td style={baseStyle}>
                            {text.split('\u2028').filter(Boolean).map((line, i) => (
                              <span key={i} style={{ display: 'block' }}>{line}</span>
                            ))}
                          </td>
                        )
                      }
                      return <td style={baseStyle}>{children}</td>
                    },
                    hr: () => (
                      <hr style={{ border: 'none', borderTop: '1.5px solid #F1F3F4', margin: '2rem 0' }} />
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

                {isGenerating && (
                  <div className="flex items-center gap-2 mt-6 text-[#E65100]">
                    <SpinnerGap size={14} className="animate-spin" />
                    <span className="text-[12px] font-semibold">작성 중...</span>
                  </div>
                )}

                {/* ── 참여 선생님 ─────────────────────────────── */}
                {project?.memberInfo && Object.keys(project.memberInfo).length > 0 && (
                  <div className="mt-10 pt-8 border-t border-[#F1F3F4]">
                    <p className="text-[13px] font-bold text-[#202124] mb-4">참여 선생님</p>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.values(project.memberInfo).sort((a, b) => a.joinedAt - b.joinedAt).map(m => (
                        <div key={m.uid} className="flex items-center gap-3 bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-[#E8EAED]">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0 shadow-sm"
                            style={{ background: m.color ?? '#9AA0A6' }}
                          >
                            {m.displayName?.[0] ?? '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[#202124] truncate">{m.displayName}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── 요약 ────────────────────────────────────── */}
                {(() => {
                  const totalActivities = 16
                  const confirmedList = Object.values(project?.artifacts ?? {}).filter(a => (a as { status: string }).status === 'confirmed')
                  const confirmedCount = confirmedList.length
                  const memberCount = project?.memberInfo ? Object.keys(project.memberInfo).length : 0
                  const t11 = project?.artifacts?.['T-1-1']?.content as Record<string, string> | undefined
                  const teamVision = t11 ? Object.values(t11).find(v => typeof v === 'string' && v.trim()) : undefined
                  const a12 = project?.artifacts?.['A-1-2']?.content as Record<string, string> | undefined
                  const selectedTopic = a12 ? Object.values(a12).find(v => typeof v === 'string' && v.trim()) : undefined
                  const a22 = project?.artifacts?.['A-2-2']?.content as Record<string, string> | undefined
                  const integratedGoal = a22 ? Object.values(a22).find(v => typeof v === 'string' && v.trim()) : undefined
                  if (!confirmedCount && !selectedTopic && !teamVision) return null
                  return (
                    <div className="mt-8 pt-8 border-t border-[#F1F3F4]">
                      <p className="text-[13px] font-bold text-[#202124] mb-4">요약</p>
                      {/* 통계 카드 */}
                      <div className="grid grid-cols-3 gap-3 mb-5">
                        <div className="bg-[#FBE9E7] rounded-2xl px-4 py-3 text-center">
                          <p className="text-[22px] font-black text-[#E65100]">{confirmedCount}<span className="text-[12px] font-semibold text-[#BF360C]">/{totalActivities}</span></p>
                          <p className="text-[10px] text-[#BF360C] font-semibold mt-0.5">확정 산출물</p>
                        </div>
                        <div className="bg-[#E8F0FE] rounded-2xl px-4 py-3 text-center">
                          <p className="text-[22px] font-black text-[#1A73E8]">{memberCount}</p>
                          <p className="text-[10px] text-[#1A73E8] font-semibold mt-0.5">참여 교사</p>
                        </div>
                        <div className="bg-[#E0F2F1] rounded-2xl px-4 py-3 text-center">
                          <p className="text-[22px] font-black text-[#00897B]">{project?.targetSubjects?.length ?? 0}</p>
                          <p className="text-[10px] text-[#00897B] font-semibold mt-0.5">융합 교과</p>
                        </div>
                      </div>
                      {/* 텍스트 정보 */}
                      <div className="space-y-2.5">
                        {project?.targetSubjects && project.targetSubjects.length > 0 && (
                          <div className="flex items-start gap-3">
                            <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">참여 교과</span>
                            <span className="text-[12px] text-[#3C4043]">{project.targetSubjects.join(' · ')}</span>
                          </div>
                        )}
                        {selectedTopic && (
                          <div className="flex items-start gap-3">
                            <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">선정 주제</span>
                            <span className="text-[12px] text-[#3C4043]">{selectedTopic}</span>
                          </div>
                        )}
                        {teamVision && (
                          <div className="flex items-start gap-3">
                            <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">팀 비전</span>
                            <span className="text-[12px] text-[#3C4043]">{teamVision}</span>
                          </div>
                        )}
                        {integratedGoal && (
                          <div className="flex items-start gap-3">
                            <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">통합 목표</span>
                            <span className="text-[12px] text-[#3C4043] line-clamp-2">{integratedGoal}</span>
                          </div>
                        )}
                        <div className="flex items-start gap-3">
                          <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">설계 진행</span>
                          <span className="text-[12px] text-[#3C4043]">{confirmedCount}/{totalActivities} 절차 완료 · {project?.targetGradeGroup}</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* 하단 버튼 */}
        {isHost && isDone && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[#E8EAED] flex-shrink-0 bg-white">
            <p className="text-[11px] text-[#9AA0A6] font-medium">
              T-CID 협력 수업설계 모델 기반 종합 분석 보고서
            </p>
            <div className="flex gap-2">
              <button
                onClick={generateReport}
                className="text-[12px] font-semibold text-[#5F6368] hover:text-[#202124] px-3 py-1.5 rounded-full hover:bg-[#F1F3F4] transition-colors"
              >
                재생성
              </button>
              {isSaved ? (
                <>
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#137333] bg-[#E6F4EA] px-4 py-1.5 rounded-full">
                    <FloppyDisk size={14} weight="fill" />
                    저장 완료
                  </span>
                  <button
                    onClick={handleCopyLink}
                    className={`flex items-center gap-1.5 text-[12px] font-semibold px-4 py-1.5 rounded-full transition-colors ${
                      linkCopied ? 'bg-[#E6F4EA] text-[#137333]' : 'bg-[#E8F0FE] text-[#1A73E8] hover:bg-[#D2E3FC]'
                    }`}
                  >
                    {linkCopied ? '✓ 복사됨' : '🔗 링크 공유'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#E65100] hover:bg-[#BF360C] px-4 py-1.5 rounded-full transition-colors disabled:opacity-60"
                >
                  <FloppyDisk size={14} weight="fill" />
                  {isSaving ? '저장 중...' : '저장하기 · 팀원 공유'}
                </button>
              )}
              <button
                onClick={onClose}
                className="text-[12px] font-semibold text-[#5F6368] hover:text-[#202124] px-3 py-1.5 rounded-full hover:bg-[#F1F3F4] transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {/* 팀원 하단 */}
        {!isHost && savedReport && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[#E8EAED] flex-shrink-0 bg-white">
            <p className="text-[11px] text-[#9AA0A6] font-medium">
              T-CID 협력 수업설계 모델 기반 종합 분석 보고서
            </p>
            <button
              onClick={onClose}
              className="text-[12px] font-semibold text-white bg-[#E65100] hover:bg-[#BF360C] px-4 py-1.5 rounded-full transition-colors"
            >
              닫기
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

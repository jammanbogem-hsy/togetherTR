'use client'

import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { useState } from 'react'
import { generateHwpx } from '@/lib/hwpx/generateHwpx'

interface MemberInfo {
  uid: string
  displayName: string
  color: string
  emoji: string
  joinedAt: number
}

interface Props {
  title: string
  targetGradeGroup: string
  targetSubjects: string[]
  content: string
  savedAt: number
  memberInfo?: Record<string, MemberInfo>
  completedCount?: number
  teamVision?: string
  selectedTopic?: string
}

export function ReportViewer({ title, targetGradeGroup, targetSubjects, content, savedAt, memberInfo, completedCount, teamVision, selectedTopic }: Props) {
  const [copied, setCopied] = useState(false)

  // 렌더링 전 정규화
  const displayContent = content
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .split('\n')
    .map(line => line.startsWith('|')
      ? line.replace(/<br\s*\/?>/gi, '\u2028')
      : line.replace(/<br\s*\/?>/gi, '\n')
    )
    .join('\n')

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownloadMd() {
    const filename = `T-CID_종합보고서_${title}_${new Date(savedAt).toISOString().slice(0, 10)}.md`
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDownloadHwpx() {
    try {
      const filename = `T-CID_종합보고서_${title}_${new Date(savedAt).toISOString().slice(0, 10)}.hwpx`
      const blob = await generateHwpx(displayContent, title)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('HWPX download failed:', error)
      window.alert('HWPX 생성에 실패했습니다. 현재는 PDF 또는 Markdown 공유를 사용해주세요.')
    }
  }

  function handleDownloadPdf() {
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

        if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue }

        const hMatch = line.match(/^(#{1,4})\s+(.+)$/)
        if (hMatch) {
          const lvl = hMatch[1].length
          out.push(`<h${lvl}>${inlineFormat(hMatch[2])}</h${lvl}>`)
          i++; continue
        }

        if (line.startsWith('> ')) {
          const bqLines: string[] = []
          while (i < lines.length && lines[i].startsWith('> ')) {
            bqLines.push(lines[i].slice(2))
            i++
          }
          out.push(`<blockquote>${inlineFormat(bqLines.join('<br>'))}</blockquote>`)
          continue
        }

        if (line.startsWith('|')) {
          const tableLines: string[] = []
          while (i < lines.length && lines[i].startsWith('|')) {
            tableLines.push(lines[i])
            i++
          }
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

        if (line.trim() === '') { i++; continue }

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
<title>T-CID 종합 설계 보고서 · ${title}</title>
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
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      {/* 상단 네비게이션 바 */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#E8EAED] shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#E65100] flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-[#E65100] uppercase tracking-wider">T-CID 종합 설계 보고서</p>
              <p className="text-[13px] font-bold text-[#202124] truncate">{title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#9AA0A6]">
              {targetGradeGroup} · {targetSubjects?.join(', ')}
            </span>
            <button
              onClick={handleDownloadMd}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5F6368] hover:text-[#202124] px-3 py-1.5 rounded-full hover:bg-[#F1F3F4] transition-colors border border-[#DADCE0]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 20h14v-2H5v2zm7-18L5.33 9h3.84v6h5.66V9h3.84L12 2z"/>
              </svg>
              MD
            </button>
            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5F6368] hover:text-[#202124] px-3 py-1.5 rounded-full hover:bg-[#F1F3F4] transition-colors border border-[#DADCE0]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#E65100">
                <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/>
              </svg>
              PDF
            </button>
            <button
              onClick={handleDownloadHwpx}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5F6368] hover:text-[#202124] px-3 py-1.5 rounded-full hover:bg-[#F1F3F4] transition-colors border border-[#DADCE0]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M3 4a2 2 0 012-2h10l6 6v12a2 2 0 01-2 2H5a2 2 0 01-2-2V4z" stroke="#00AEEF" strokeWidth="1.5"/>
                <path d="M13 2v6h6" stroke="#00AEEF" strokeWidth="1.5" strokeLinejoin="round"/>
                <text x="4" y="19" fontSize="6" fontWeight="bold" fill="#00AEEF">HWP</text>
              </svg>
              HWPX 베타
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                copied
                  ? 'bg-[#E6F4EA] text-[#137333]'
                  : 'bg-[#E65100] hover:bg-[#BF360C] text-white'
              }`}
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                  복사됨
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                  링크 복사
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 보고서 본문 */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* 메타 정보 */}
        <div className="mb-8 flex flex-wrap items-center gap-2 text-[11px] text-[#9AA0A6]">
          <span className="bg-white border border-[#DADCE0] rounded-full px-3 py-1 font-medium">{targetGradeGroup}</span>
          {targetSubjects?.map(s => (
            <span key={s} className="bg-white border border-[#DADCE0] rounded-full px-3 py-1 font-medium">{s}</span>
          ))}
          <span className="ml-auto">
            {new Date(savedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 저장
          </span>
        </div>

        {/* 마크다운 렌더링 */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E8EAED] px-10 py-10">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            components={{
              h1: ({ children }) => (
                <h1 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#202124', margin: '0 0 0.5rem', lineHeight: 1.2, letterSpacing: '-0.03em', paddingBottom: '1rem', borderBottom: '3px solid #E65100' }}>
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <div style={{ marginTop: '3.2rem', marginBottom: '1.4rem', borderRadius: '10px', background: 'linear-gradient(135deg, #E65100 0%, #BF360C 100%)', padding: '0.75rem 1.2rem', display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'white', letterSpacing: '0.01em', lineHeight: 1.3 }}>
                    {children}
                  </span>
                </div>
              ),
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

          {/* ── 참여 선생님 ─────────────────────────────── */}
          {memberInfo && Object.keys(memberInfo).length > 0 && (
            <div className="mt-10 pt-8 border-t border-[#F1F3F4]">
              <p className="text-[15px] font-bold text-[#202124] mb-4">참여 선생님</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.values(memberInfo).sort((a, b) => a.joinedAt - b.joinedAt).map(m => (
                  <div key={m.uid} className="flex items-center gap-3 bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-[#E8EAED]">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0 shadow-sm"
                      style={{ background: m.color ?? '#9AA0A6' }}
                    >
                      {m.displayName?.[0] ?? '?'}
                    </div>
                    <p className="text-[13px] font-semibold text-[#202124] truncate">{m.displayName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 요약 ────────────────────────────────────── */}
          {(completedCount !== undefined && completedCount > 0) || teamVision || selectedTopic ? (
            <div className="mt-8 pt-8 border-t border-[#F1F3F4]">
              <p className="text-[15px] font-bold text-[#202124] mb-4">요약</p>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[#FBE9E7] rounded-2xl px-4 py-3 text-center">
                  <p className="text-[22px] font-black text-[#E65100]">{completedCount ?? 0}<span className="text-[12px] font-semibold text-[#BF360C]">/16</span></p>
                  <p className="text-[10px] text-[#BF360C] font-semibold mt-0.5">확정 산출물</p>
                </div>
                <div className="bg-[#E8F0FE] rounded-2xl px-4 py-3 text-center">
                  <p className="text-[22px] font-black text-[#1A73E8]">{memberInfo ? Object.keys(memberInfo).length : 0}</p>
                  <p className="text-[10px] text-[#1A73E8] font-semibold mt-0.5">참여 교사</p>
                </div>
                <div className="bg-[#E0F2F1] rounded-2xl px-4 py-3 text-center">
                  <p className="text-[22px] font-black text-[#00897B]">{targetSubjects?.length ?? 0}</p>
                  <p className="text-[10px] text-[#00897B] font-semibold mt-0.5">융합 교과</p>
                </div>
              </div>
              <div className="space-y-2.5">
                {targetSubjects && targetSubjects.length > 0 && (
                  <div className="flex items-start gap-3">
                    <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">참여 교과</span>
                    <span className="text-[12px] text-[#3C4043]">{targetSubjects.join(' · ')}</span>
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
                <div className="flex items-start gap-3">
                  <span className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide flex-shrink-0 mt-0.5 w-14">설계 진행</span>
                  <span className="text-[12px] text-[#3C4043]">{completedCount ?? 0}/16 절차 완료 · {targetGradeGroup}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* 하단 푸터 */}
        <div className="mt-8 text-center">
          <p className="text-[11px] text-[#9AA0A6]">
            T-CID 협력 수업설계 모델 기반 종합 분석 보고서 · AI 생성
          </p>
        </div>
      </div>
    </div>
  )
}

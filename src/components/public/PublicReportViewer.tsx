'use client'

import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PublicReport, StageCode } from '@/types'
import { STAGES } from '@/types'
import { STAGE_LABELS, STAGE_COLOR } from '@/lib/ui/stageColors'
import { cn } from '@/lib/utils'
import { PublicOntologySection } from '@/components/ontology/ProjectOntologyModal'

/**
 * 공개 배포 전용 보고서 뷰어.
 * - 로그인 상태 무관 (공개 URL 접근)
 * - 탭 구조: 단계별 보고서(T/A/Ds/DI/E 중 존재하는 것) + 최종 결과서(종합 보고서)
 * - URL 해시(`#T`, `#final` 등)로 탭 상태 보존·공유 가능
 * - PDF 친화적 렌더 (표 가로 스크롤 없이 wrap)
 */

function normalizeMarkdown(content: string): string {
  return content
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .split('\n')
    .map(line => line.startsWith('|')
      ? line.replace(/<br\s*\/?>/gi, '\u2028')
      : line.replace(/<br\s*\/?>/gi, '\n')
    )
    .join('\n')
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-[22px] font-extrabold text-[#202124] mt-10 mb-4 pb-2 border-b-2 border-[#E8EAED]">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[18px] font-extrabold text-[#202124] mt-8 mb-3 pl-3 border-l-4 border-[#1A73E8]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[15px] font-bold text-[#3C4043] mt-5 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-[14px] text-[#3C4043] leading-[1.8] mb-3">{children}</p>
  ),
  ul: ({ children }) => <ul className="space-y-1.5 my-3 pl-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-6 my-3 space-y-1 text-[14px] text-[#3C4043] leading-[1.8]">{children}</ol>,
  li: ({ children }) => (
    <li className="flex items-start gap-2 text-[14px] text-[#3C4043] leading-[1.8]">
      <span className="mt-[0.55rem] w-[7px] h-[7px] rounded-full bg-[#1A73E8] flex-shrink-0" />
      <span>{children}</span>
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 px-4 py-3 bg-[#F1F8FF] border-l-4 border-[#1A73E8] rounded-r-lg text-[#1F3D70] font-semibold">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="font-bold text-[#202124]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#5F6368]">{children}</em>,
  hr: () => <hr className="my-8 border-0 border-t border-[#E8EAED]" />,
  table: ({ children }) => (
    <div className="my-5 rounded-xl border border-[#DADCE0] overflow-hidden shadow-sm">
      <table className="w-full border-collapse text-[14px]" style={{ tableLayout: 'auto' }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gradient-to-r from-[#1A73E8] to-[#1557B0] text-white">{children}</thead>,
  th: ({ children }) => (
    <th className="px-4 py-3 text-left font-bold text-[13px] align-top" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      {children}
    </th>
  ),
  tr: ({ children }) => <tr className="border-t border-[#F1F3F4]">{children}</tr>,
  td: ({ children }) => {
    const baseStyle: React.CSSProperties = { wordBreak: 'keep-all', overflowWrap: 'anywhere' }
    const text = typeof children === 'string' ? children : null
    if (text && text.includes('\u2028')) {
      return (
        <td className="px-4 py-3 text-[14px] text-[#3C4043] leading-[1.7] align-top" style={baseStyle}>
          {text.split('\u2028').filter(Boolean).map((line, i) => (
            <span key={i} className="block">{line}</span>
          ))}
        </td>
      )
    }
    return (
      <td className="px-4 py-3 text-[14px] text-[#3C4043] leading-[1.7] align-top" style={baseStyle}>
        {children}
      </td>
    )
  },
  code: ({ children }) => (
    <code className="px-1.5 py-0.5 bg-[#F1F3F4] border border-[#DADCE0] rounded text-[13px] text-[#202124]">{children}</code>
  ),
}

function StageReportSection({ stage, content, savedAt }: {
  stage: StageCode
  content: string
  savedAt: number
}) {
  const color = STAGE_COLOR[stage]
  const normalized = useMemo(() => normalizeMarkdown(content), [content])
  return (
    <section>
      <header className="mb-5 flex items-center gap-3">
        <span
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-[15px] font-extrabold flex-shrink-0"
          style={{ backgroundColor: color.hex }}
        >
          {stage}
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: color.hex }}>
            단계 보고서
          </p>
          <h2 className="text-[20px] font-extrabold text-[#202124] leading-tight">
            {STAGE_LABELS[stage]}
          </h2>
        </div>
        <span className="ml-auto text-[11px] text-[#9AA0A6] tabular-nums flex-shrink-0">
          {new Date(savedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </header>
      <article className="prose-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {normalized}
        </ReactMarkdown>
      </article>
    </section>
  )
}

function FinalReportSection({ content, savedAt }: { content: string; savedAt: number }) {
  const normalized = useMemo(() => normalizeMarkdown(content), [content])
  return (
    <section>
      <header className="mb-5 flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-[18px] font-extrabold flex-shrink-0 bg-gradient-to-br from-[#E65100] to-[#BF360C]">
          ∑
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#E65100]">최종 결과서</p>
          <h2 className="text-[20px] font-extrabold text-[#202124] leading-tight">
            T → DI 통합 설계안
          </h2>
        </div>
        <span className="ml-auto text-[11px] text-[#9AA0A6] tabular-nums flex-shrink-0">
          {new Date(savedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </header>
      <article className="prose-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {normalized}
        </ReactMarkdown>
      </article>
    </section>
  )
}

type Tab =
  | { key: 'structure'; label: string; type: 'structure'; color: string }
  | { key: StageCode; label: string; type: 'stage'; stage: StageCode; color: string; data: { content: string; savedAt: number } }
  | { key: 'final'; label: string; type: 'final'; color: string; data: { content: string; savedAt: number } }

export function PublicReportViewer({ report }: { report: PublicReport }) {
  const [copied, setCopied] = useState(false)

  const tabs: Tab[] = useMemo(() => {
    const out: Tab[] = []
    // 구조 탭 — 프로젝트 온톨로지 그래프 (항상 첫 탭으로 노출)
    out.push({ key: 'structure', label: '프로젝트 구조', type: 'structure', color: '#1A73E8' })
    const stageOrder = STAGES.map(s => s.code)
    const reports = report.stageReports ?? {}
    for (const code of stageOrder) {
      const data = reports[code]
      if (data?.content) {
        out.push({
          key: code,
          label: STAGE_LABELS[code],
          type: 'stage',
          stage: code,
          color: STAGE_COLOR[code].hex,
          data: { content: data.content, savedAt: data.savedAt },
        })
      }
    }
    if (report.cumulativeReport?.content) {
      out.push({
        key: 'final',
        label: '최종 결과서',
        type: 'final',
        color: '#E65100',
        data: { content: report.cumulativeReport.content, savedAt: report.cumulativeReport.savedAt },
      })
    }
    return out
  }, [report])

  // URL 해시(#T, #final 등)로 탭 상태 동기화.
  // 링크 공유 시 특정 탭을 가리킬 수 있고, 뒤로가기로 탭 이동 가능.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  useEffect(() => {
    if (tabs.length === 0) { setActiveKey(null); return }
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    const matched = tabs.find(t => t.key === hash)
    setActiveKey(matched?.key ?? tabs[0].key)
    const onHashChange = () => {
      const h = window.location.hash.slice(1)
      const m = tabs.find(t => t.key === h)
      if (m) setActiveKey(m.key)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [tabs])

  function changeTab(key: string) {
    setActiveKey(key)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${key}`)
    }
  }

  const activeTab = tabs.find(t => t.key === activeKey) ?? tabs[0]
  const showTabBar = tabs.length >= 2  // 1개면 탭바 생략

  function copyLink() {
    if (typeof window === 'undefined') return
    navigator.clipboard.writeText(window.location.href).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1800) },
      () => {},
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 상단 — 프로젝트 메타 */}
      <header className="bg-gradient-to-br from-[#E8F0FE] via-white to-white border-b border-[#DADCE0]">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p className="text-[11px] font-bold text-[#1A73E8] uppercase tracking-widest mb-2">
            T-CID 협력적 수업설계
          </p>
          <h1 className="text-[28px] font-extrabold text-[#202124] leading-tight mb-4">
            {report.projectTitle}
          </h1>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#5F6368]">
            <span className="flex items-center gap-1.5">
              <span className="text-[#9AA0A6]">학교급</span>
              <span className="font-semibold text-[#3C4043]">{report.schoolLevel}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[#9AA0A6]">학년군</span>
              <span className="font-semibold text-[#3C4043]">{report.targetGradeGroup}</span>
            </span>
            {report.targetSubjects?.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="text-[#9AA0A6]">교과</span>
                <span className="font-semibold text-[#3C4043]">{report.targetSubjects.join(', ')}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="text-[#9AA0A6]">팀</span>
              <span className="font-semibold text-[#3C4043]">{report.memberCount}명 협력 설계</span>
            </span>
            {report.cycleCount > 1 && (
              <span className="flex items-center gap-1.5">
                <span className="text-[#9AA0A6]">주기</span>
                <span className="font-semibold text-[#3C4043]">{report.cycleCount}차</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="text-[#9AA0A6]">공개일</span>
              <span className="font-semibold text-[#3C4043] tabular-nums">
                {new Date(report.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 no-print">
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-full bg-[#1A73E8] text-white hover:bg-[#1557B0] transition-colors"
            >
              {copied ? '링크 복사됨 ✓' : '공유 링크 복사'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-full bg-white text-[#5F6368] border border-[#DADCE0] hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
            >
              인쇄 / PDF 저장
            </button>
          </div>
        </div>
      </header>

      {/* 탭 네비게이션 (2개 이상일 때만) */}
      {showTabBar && (
        <nav className="border-b border-[#E8EAED] bg-white/90 backdrop-blur-sm sticky top-0 z-10 no-print">
          <div className="max-w-4xl mx-auto px-2 sm:px-6 flex overflow-x-auto">
            {tabs.map(tab => {
              const isActive = tab.key === activeKey
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => changeTab(tab.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-[13px] font-semibold whitespace-nowrap border-b-[3px] transition-all flex-shrink-0',
                    isActive ? 'text-[#202124]' : 'text-[#9AA0A6] hover:text-[#3C4043]',
                  )}
                  style={{
                    borderBottomColor: isActive ? tab.color : 'transparent',
                  }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tab.color }} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </nav>
      )}

      {/* 본문 — 활성 탭 내용 (또는 탭 1개면 그 내용만) */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        {tabs.length === 0 ? (
          <div className="text-center py-20 text-[#9AA0A6] text-sm">
            아직 공개된 보고서가 없습니다.
          </div>
        ) : (
          <>
            {/* 인쇄 시에는 모든 탭 내용을 순서대로 전부 출력 */}
            <div className="print-only print-stack">
              {tabs.map(tab => (
                <div key={`print-${tab.key}`} className="mb-12 print-section">
                  {tab.type === 'structure'
                    ? <PublicOntologySection stageReports={report.stageReports as Record<string, unknown>} />
                    : tab.type === 'stage'
                      ? <StageReportSection stage={tab.stage} content={tab.data.content} savedAt={tab.data.savedAt} />
                      : <FinalReportSection content={tab.data.content} savedAt={tab.data.savedAt} />}
                </div>
              ))}
            </div>
            {/* 화면에서는 활성 탭만 */}
            <div className="screen-only">
              {activeTab && (
                activeTab.type === 'structure'
                  ? <PublicOntologySection stageReports={report.stageReports as Record<string, unknown>} />
                  : activeTab.type === 'stage'
                    ? <StageReportSection stage={activeTab.stage} content={activeTab.data.content} savedAt={activeTab.data.savedAt} />
                    : <FinalReportSection content={activeTab.data.content} savedAt={activeTab.data.savedAt} />
              )}
            </div>
          </>
        )}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-[#DADCE0] bg-[#F8F9FA] py-8 text-center no-print">
        <p className="text-[12px] text-[#9AA0A6]">
          T-CID 협력적 수업설계 AI 공동설계자로 제작된 보고서입니다.
        </p>
        <p className="text-[10px] text-[#BDC1C6] mt-1">
          본 보고서는 팀에서 공개 설정한 내용만 포함하며, 원본 설계 과정·채팅·팀원 정보는 포함되지 않습니다.
        </p>
      </footer>

      {/* 화면/인쇄 분기용 CSS — 탭 하나만 보는 스크린뷰 vs 인쇄 시 전체 나열 */}
      <style jsx global>{`
        .print-only { display: none; }
        .screen-only { display: block; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block; }
          .screen-only { display: none; }
          .print-section { page-break-inside: avoid; }
          body { background: white; }
        }
      `}</style>
    </div>
  )
}

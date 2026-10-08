'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ReportMarkdown, reportSummary } from '@/components/modals/ReportMarkdown'
import { reportStageColors } from '@/components/modals/reportDashboardStyles'
import { cleanReportMarkdown } from '@/lib/markdown/reportDisplay'
import { MD3Button } from '@/components/ui/MD3Button'
import { UsersThree, ChartLineUp, PencilRuler, RocketLaunch, Trophy, BookOpen, CalendarBlank, Copy, Printer, type Icon } from '@phosphor-icons/react'
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
 * - 내부 보고서와 같은 ReportMarkdown으로 표시·인쇄 (공개 스냅샷만 사용)
 */

const STAGE_ICONS: Record<StageCode, Icon> = { T: UsersThree, A: ChartLineUp, Ds: PencilRuler, DI: RocketLaunch, E: Trophy }

function PublicReportSection({ stage, content, savedAt }: {
  stage?: StageCode; content: string; savedAt: number;
}) {
  const colors = reportStageColors(stage ? STAGE_COLOR[stage].hex : '#E65100')
  const HeadingIcon = stage ? STAGE_ICONS[stage] : BookOpen
  const { summary } = reportSummary(cleanReportMarkdown(content))
  return <section aria-label={stage ? `${STAGE_LABELS[stage]} 보고서` : '최종 결과서'}>
    <header className="report-hero">
      <div className="report-hero-banner" style={{ backgroundColor: colors.container, color: colors.band }}>
        <div className="report-hero-title">
          <span className="report-stage-icon"><HeadingIcon size={24} weight="duotone" aria-hidden="true" /></span>
          <div><p className="report-eyebrow">{stage ? `${stage} · 단계 분석 보고서` : '최종 결과서'}</p><h2 className="m-0 text-xl font-bold">{stage ? `${STAGE_LABELS[stage]} 단계` : 'T → DI 통합 설계안'}</h2></div>
        </div>
        {summary && <p className="report-hero-summary">{summary}</p>}
        <div className="report-dates"><span><CalendarBlank size={14} aria-hidden="true" /> 생성일 · {new Date(savedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
      </div>
    </header>
    <ReportMarkdown content={content} stage={stage} />
  </section>
}

type Tab =
  | { key: 'structure'; label: string; type: 'structure'; color: string }
  | { key: StageCode; label: string; type: 'stage'; stage: StageCode; color: string; data: { content: string; savedAt: number } }
  | { key: 'final'; label: string; type: 'final'; color: string; data: { content: string; savedAt: number } }

const subscribeMounted = () => () => {}
const getMountedSnapshot = () => true
const getMountedServerSnapshot = () => false

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
  const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getMountedServerSnapshot)
  const hash = mounted ? window.location.hash.slice(1) : ''
  const [selection, setSelection] = useState<{
    tabs: Tab[]
    mounted: boolean
    activeKey: string | null
  }>(() => ({ tabs, mounted, activeKey: (tabs.find(t => t.key === hash) ?? tabs[0])?.key ?? null }))

  if (selection.tabs !== tabs || selection.mounted !== mounted) {
    // 처음 마운트하거나 탭 구성이 바뀔 때만 해시 불일치를 첫 탭으로 처리.
    setSelection({ tabs, mounted, activeKey: (tabs.find(t => t.key === hash) ?? tabs[0])?.key ?? null })
  }
  const activeKey = selection.activeKey

  useEffect(() => {
    const onHashChange = () => {
      const matched = tabs.find(t => t.key === window.location.hash.slice(1))
      if (matched) setSelection(prev => ({ ...prev, activeKey: matched.key }))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [tabs])

  function changeTab(key: string) {
    setSelection(prev => ({ ...prev, activeKey: key }))
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
    <div className="public-report-viewer min-h-screen bg-[#F8FAFD]">
      {/* 상단 — 프로젝트 메타 */}
      <header className="bg-white border-b border-[#C4C7C5]">
        <div className="max-w-[1200px] mx-auto px-4 py-8 sm:px-8">
          <p className="text-[11px] font-bold text-[#1A73E8] uppercase tracking-widest mb-2">
            T-CID2.0 협력적 수업설계
          </p>
          <h1 className="text-[28px] font-extrabold text-[#202124] leading-tight mb-4">
            {report.projectTitle}
          </h1>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#5F6368]">
            <span className="flex items-center gap-1.5">
              <span className="text-[#5F6368]">학교급</span>
              <span className="font-semibold text-[#3C4043]">{report.schoolLevel}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[#5F6368]">학년군</span>
              <span className="font-semibold text-[#3C4043]">{report.targetGradeGroup}</span>
            </span>
            {report.targetSubjects?.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="text-[#5F6368]">교과</span>
                <span className="font-semibold text-[#3C4043]">{report.targetSubjects.join(', ')}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="text-[#5F6368]">팀</span>
              <span className="font-semibold text-[#3C4043]">{report.memberCount}명 협력 설계</span>
            </span>
            {report.cycleCount > 1 && (
              <span className="flex items-center gap-1.5">
                <span className="text-[#5F6368]">주기</span>
                <span className="font-semibold text-[#3C4043]">{report.cycleCount}차</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="text-[#5F6368]">공개일</span>
              <span className="font-semibold text-[#3C4043] tabular-nums">
                {new Date(report.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 no-print">
            <MD3Button variant="filled" size="sm" className="min-h-11 text-sm" onClick={copyLink} icon={<Copy size={18} aria-hidden="true" />}>
              {copied ? '링크 복사됨' : '공유 링크 복사'}
            </MD3Button>
            <MD3Button variant="outlined" size="sm" className="min-h-11 text-sm" onClick={() => window.print()} icon={<Printer size={18} aria-hidden="true" />}>
              인쇄 / PDF 저장
            </MD3Button>
          </div>
        </div>
      </header>

      {/* 탭 네비게이션 (2개 이상일 때만) */}
      {showTabBar && (
        <nav className="border-b border-[#E8EAED] bg-white/90 backdrop-blur-sm sticky top-0 z-10 no-print">
          <div className="max-w-[1200px] mx-auto px-2 sm:px-8 flex overflow-x-auto">
            {tabs.map(tab => {
              const isActive = tab.key === activeKey
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => changeTab(tab.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-[#0B57D0] focus-visible:outline-offset-[-4px] flex-shrink-0',
                    isActive ? 'text-[#202124]' : 'text-[#5F6368] hover:text-[#3C4043]',
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
      <main className="max-w-[1200px] mx-auto px-4 py-8 sm:px-8">
        {tabs.length === 0 ? (
          <div className="text-center py-20 text-[#5F6368] text-sm">
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
                      ? <PublicReportSection stage={tab.stage} content={tab.data.content} savedAt={tab.data.savedAt} />
                      : <PublicReportSection content={tab.data.content} savedAt={tab.data.savedAt} />}
                </div>
              ))}
            </div>
            {/* 화면에서는 활성 탭만 */}
            <div className="screen-only rounded-2xl border border-[#DADCE0] bg-white p-4 sm:p-6">
              {activeTab && (
                activeTab.type === 'structure'
                  ? <PublicOntologySection stageReports={report.stageReports as Record<string, unknown>} />
                  : activeTab.type === 'stage'
                    ? <PublicReportSection stage={activeTab.stage} content={activeTab.data.content} savedAt={activeTab.data.savedAt} />
                    : <PublicReportSection content={activeTab.data.content} savedAt={activeTab.data.savedAt} />
              )}
            </div>
          </>
        )}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-[#DADCE0] bg-[#F8F9FA] py-8 text-center no-print">
        <p className="text-[12px] text-[#5F6368]">
          T-CID2.0 협력적 수업설계 AI 공동설계자로 제작된 보고서입니다.
        </p>
        <p className="text-[10px] text-[#5F6368] mt-1">
          본 보고서는 팀에서 공개 설정한 내용만 포함하며, 원본 설계 과정·채팅·팀원 정보는 포함되지 않습니다.
        </p>
      </footer>

      {/* 화면/인쇄 분기용 CSS — 탭 하나만 보는 스크린뷰 vs 인쇄 시 전체 나열 */}
      <style>{`
        .public-report-viewer .print-only { display: none; }
        .public-report-viewer .screen-only { display: block; }
        @media print {
          .public-report-viewer .no-print { display: none !important; }
          .public-report-viewer .print-only { display: block; }
          .public-report-viewer .screen-only { display: none; }
          .public-report-viewer .print-section { break-inside: auto; page-break-inside: auto; }
          .public-report-viewer .print-section + .print-section { break-before: page; page-break-before: always; }
          .public-report-viewer main { max-width: none; padding: 0; }
          body { background: white; }
        }
      `}</style>
    </div>
  )
}

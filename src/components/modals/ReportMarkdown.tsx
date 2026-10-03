'use client'

import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { stripLeadingEmoji } from '@/components/ui/ReportSectionIcon'
import { REPORT_SECTIONS, findReportSection } from '@/lib/report/reportSections'
import { STAGES, type Project, type StageCode } from '@/types'
import { Target, ListChecks, Exam, ThumbsUp, Wrench, ArrowRight, Lightbulb, Database, Question, CheckCircle, CalendarBlank, Clock, UsersThree, ChartLineUp, ChartBar, ArrowsClockwise, PencilRuler, RocketLaunch, Trophy, type Icon } from '@phosphor-icons/react'

const SECTION_ICONS: Record<string, Icon> = { Target, ListChecks, Exam, ThumbsUp, Wrench, ArrowRight, Lightbulb, Database, Question, ChartBar, UsersThree, ArrowsClockwise }
const STAGE_ICONS: Record<StageCode, Icon> = { T: UsersThree, A: ChartLineUp, Ds: PencilRuler, DI: RocketLaunch, E: Trophy }
const STAGE_NAMES: Record<StageCode, string> = { T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가' }

function sectionIcon(title: string): Icon {
  const normalized = stripLeadingEmoji(title).replace(/^\d+[.)]\s*/, '').trim()
  const section = REPORT_SECTIONS.find(item => item.title === normalized) ?? findReportSection(normalized)
  if (section && SECTION_ICONS[section.icon]) return SECTION_ICONS[section.icon]
  const rules: Array<[RegExp, Icon]> = [
    [/요약|핵심/, Target], [/성취기준|평가/, Exam], [/활동/, ListChecks],
    [/강점/, ThumbsUp], [/보완/, Wrench], [/다음/, ArrowRight],
    [/인사이트|분석/, Lightbulb], [/데이터|출처/, Database], [/질문/, Question],
  ]
  return rules.find(([pattern]) => pattern.test(title))?.[1] ?? Lightbulb
}

function reportHeadingText(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode }>(child) ? reportHeadingText(child.props.children) : ''
  }).join('')
}

interface ReportNode {
  type: string
  depth?: number
  value?: string
  start?: number | null
  ordered?: boolean
  align?: Array<'left' | 'right' | 'center' | null>
  children?: ReportNode[]
  data?: { hName?: string; hProperties?: Record<string, string | number> }
}

function reportNodeText(node: ReportNode): string {
  return node.value ?? node.children?.map(reportNodeText).join('') ?? ''
}

// Markdown AST에서만 묶으므로 코드 블록의 ## 문자열을 섹션으로 오인하지 않는다.
function remarkReportCards() {
  return (tree: ReportNode) => {
    const grouped: ReportNode[] = []
    let body: ReportNode | undefined
    for (const node of tree.children ?? []) {
      if (node.type === 'heading' && node.depth === 2) {
        body = { type: 'reportBody', data: { hName: 'div', hProperties: { className: 'min-w-0 p-4 sm:p-5' } }, children: [] }
        grouped.push({ type: 'reportCard', data: { hName: 'section' }, children: [node, body] })
      } else if (body) body.children!.push(node)
      else grouped.push(node)
    }
    tree.children = grouped
    function visit(node: ReportNode) {
      if (node.type === 'list' && node.ordered) {
        node.children?.forEach((item, i) => {
          item.data = { ...item.data, hProperties: { ...item.data?.hProperties, 'data-report-number': (node.start ?? 1) + i } }
        })
      }
      if (node.type === 'table' && node.children?.length) {
        const rows = node.children.slice(1)
        node.align ??= node.children[0].children?.map(() => null) ?? []
        node.align.forEach((_, i) => {
          const values = rows.map(row => reportNodeText(row.children?.[i] ?? { type: 'text', value: '' }).trim()).filter(value => value && value !== '—' && value !== '-')
          if (values.length && values.every(value => /^[+−-]?\d[\d,.]*(?:\s*(?:%|점|개|명|차시|시간|회|건|일|분|\/\d+))?$/.test(value))) node.align![i] = 'right'
        })
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

function reportDate(milliseconds?: number): string {
  return milliseconds && Number.isFinite(milliseconds)
    ? new Date(milliseconds).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '기록 없음'
}

/** 기존 프로젝트·산출물·저장 보고서 데이터만 사용한다. */
export function ReportHero({ stage, project, generatedAt, generating = false }: {
  stage: StageCode
  project: Project | null
  generatedAt?: number
  generating?: boolean
}) {
  const activities = STAGES.find(item => item.code === stage)?.activities ?? []
  const confirmed = activities.filter(code => project?.artifacts?.[code]?.status === 'confirmed').length
  const updatedAt = project?.updatedAt?.toMillis?.()
  const StageIcon = STAGE_ICONS[stage]
  return <div className="mb-6 min-w-0" data-report-hero>
    <div className="relative overflow-hidden rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-primary-container)] p-4 text-[var(--md-sys-on-primary-container)] sm:p-6">
      <StageIcon size={120} weight="duotone" aria-hidden="true" className="pointer-events-none absolute -right-4 -top-4 opacity-[0.08]" />
      <div className="relative flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container-lowest)] text-[var(--md-sys-primary)]"><StageIcon size={28} weight="duotone" aria-hidden="true" /></div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium tracking-wide">{stage} · 단계 분석 보고서</p>
          <h3 className="mt-1 text-[24px] font-semibold leading-8">{STAGE_NAMES[stage]} 단계</h3>
          <p className="mt-2 break-words text-[14px]">{project?.title ?? '프로젝트'}</p>
          <p className="mt-3 flex items-start gap-1.5 text-[12px]"><CalendarBlank size={16} className="shrink-0" aria-hidden="true" /><span>{generating ? '보고서 생성 중' : `생성일 · ${reportDate(generatedAt)}`}</span></p>
        </div>
      </div>
    </div>
    <dl className="mt-3 flex flex-wrap gap-2 text-[12px]">
      <div className="flex items-center gap-2 rounded-full bg-[var(--md-sys-surface-container-high)] px-3 py-2 text-[var(--md-sys-on-surface)]"><ListChecks size={16} aria-hidden="true" /><dt>활동 수</dt><dd className="font-semibold tabular-nums">{activities.length}개</dd></div>
      <div className="flex items-center gap-2 rounded-full bg-[var(--md-sys-tertiary-container)] px-3 py-2 text-[var(--md-sys-on-tertiary-container)]"><CheckCircle size={16} aria-hidden="true" /><dt>확정 활동</dt><dd className="font-semibold tabular-nums">{confirmed}개</dd></div>
      {updatedAt && <div className="flex min-w-0 items-start gap-2 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container)] px-3 py-2 text-[var(--md-sys-on-surface-variant)]"><Clock size={16} className="shrink-0" aria-hidden="true" /><dt className="shrink-0">마지막 갱신</dt><dd>{reportDate(updatedAt)}</dd></div>}
    </dl>
  </div>
}

// 강조·링크 안의 학년군도 한 줄로 읽고, 기존 보고서의 셀 내부 줄 구분은 유지한다.
function reportCellContent(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child === 'string') {
      const lines = child.includes('【') && child.includes(' / 【') ? child.split(' / ') : child.split('\u2028')
      return lines.map((line, index) => <span key={index}>
        {index > 0 && <br />}
        {line.split(/((?:초등(?:학교)?\s*|초)?[1-6]\s*[-~–]\s*[1-6]\s*학년(?:군)?)/g).map((part, i) =>
          i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part)}
      </span>)
    }
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return cloneElement(child, {}, reportCellContent(child.props.children))
    }
    return child
  })
}

/** 화면용 MD3 보고서. PDF용 기존 렌더와 분리해 내보내기 모양을 보존한다. */
export function ReportMarkdown({ content }: { content: string }) {
  return <div className="min-w-0 max-w-full break-words text-[14px] leading-7 text-[var(--md-sys-on-surface-variant)]">
    <ReactMarkdown remarkPlugins={[...REMARK_PLUGINS, remarkReportCards]} components={{
      section: ({ children }) => <section data-report-section className="my-6 min-w-0 overflow-hidden rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)] shadow-sm">{children}</section>,
      h1: ({ children }) => <h1 className="mb-6 text-[24px] font-medium leading-8 text-[var(--md-sys-on-surface)]">{children}</h1>,
      h2: ({ children }) => {
        const raw = reportHeadingText(children)
        const SectionIcon = sectionIcon(raw)
        return <h2 className="m-0 flex items-center gap-3 border-b border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container)] px-4 py-4 text-[18px] font-medium leading-7 text-[var(--md-sys-on-surface)]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-primary-container)] text-[var(--md-sys-primary)]"><SectionIcon size={22} weight="duotone" aria-hidden="true" /></span>
          <span className="min-w-0">{stripLeadingEmoji(raw) || children}</span>
        </h2>
      },
      h3: ({ children }) => <h3 className="mb-3 mt-5"><span className="inline-flex max-w-full items-start gap-2 rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-secondary-container)] px-3 py-2 text-[14px] font-medium text-[var(--md-sys-on-secondary-container)]"><ListChecks size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0">{stripLeadingEmoji(reportHeadingText(children)) || children}</span></span></h3>,
      h4: ({ children }) => <h4 className="mb-2 mt-4 font-medium text-[var(--md-sys-on-surface)]">{stripLeadingEmoji(reportHeadingText(children)) || children}</h4>,
      p: ({ children }) => <p className="my-4 max-w-[72ch] first:mt-0 last:mb-0">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold text-[var(--md-sys-on-surface)]">{children}</strong>,
      ul: ({ children }) => <ul className="my-4 space-y-3">{children}</ul>,
      ol: ({ children }) => <ol className="my-4 list-decimal space-y-3">{children}</ol>,
      li: ({ children, node }) => {
        const number = node?.properties?.['data-report-number'] ?? node?.properties?.dataReportNumber
        return <li className="flex list-none items-start gap-3"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--md-sys-primary-container)] text-[12px] font-medium text-[var(--md-sys-primary)]" aria-hidden="true">{number ? String(number) : <CheckCircle size={16} weight="fill" />}</span><div className="min-w-0 flex-1">{children}</div></li>
      },
      blockquote: ({ children }) => <aside role="note" aria-label="인사이트와 권고" className="my-5 flex gap-3 rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-secondary-container)] p-4 text-[var(--md-sys-on-secondary-container)]"><Lightbulb size={24} weight="duotone" className="shrink-0" aria-hidden="true" /><div className="min-w-0"><p className="mb-2 text-[12px] font-semibold">인사이트 · 권고</p>{children}</div></aside>,
      table: ({ children }) => <div role="region" aria-label="보고서 표" tabIndex={0} className="my-5 max-h-[60vh] max-w-full overflow-auto rounded-[var(--md-sys-radius-md)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)] focus-visible:outline-2 focus-visible:outline-[var(--md-sys-primary)]">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-[13px] leading-6">{children}</table>
      </div>,
      thead: ({ children }) => <thead>{children}</thead>,
      th: ({ children, style }) => <th scope="col" className="sticky top-0 z-10 min-w-[10rem] whitespace-nowrap border-b border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container)] px-4 py-3 font-medium text-[var(--md-sys-on-surface-variant)] first:min-w-[9rem]" style={style}>{children}</th>,
      tr: ({ children }) => <tr className="hover:bg-[var(--md-sys-surface-container-low)]">{children}</tr>,
      td: ({ children, style }) => <td className="min-w-[10rem] border-b border-[var(--md-sys-outline-variant)] px-4 py-3 align-top tabular-nums [overflow-wrap:anywhere] first:min-w-[9rem]" style={style}>{reportCellContent(children)}</td>,
      hr: () => <hr className="my-6 border-[var(--md-sys-outline-variant)]" />,
      em: ({ children }) => <em className="text-[var(--md-sys-on-surface-variant)]">{children}</em>,
      code: ({ children }) => <code className="rounded-[var(--md-sys-radius-xs)] bg-[var(--md-sys-surface-container-high)] px-1.5 py-0.5 text-[0.9em]">{children}</code>,
      pre: ({ children }) => <pre className="my-4 max-w-full overflow-x-auto rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-surface-container-high)] p-4 text-[13px]">{children}</pre>,
      a: ({ href, children }) => <a href={href} className="text-[var(--md-sys-primary)] underline underline-offset-2">{children}</a>,
    }}>{content}</ReactMarkdown>
  </div>
}

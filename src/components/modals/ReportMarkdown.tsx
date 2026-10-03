'use client'

import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { cleanReportMarkdown } from '@/lib/markdown/reportDisplay'
import { stripLeadingEmoji } from '@/components/ui/ReportSectionIcon'
import { REPORT_SECTIONS, findReportSection } from '@/lib/report/reportSections'
import { STAGES, displayActivityCode, type Project, type StageCode } from '@/types'
import { STAGE_COLOR } from '@/lib/ui/stageColors'
import { REPORT_DASHBOARD_CSS, reportStageColors } from './reportDashboardStyles'
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

function sectionKind(title: string): string {
  const normalized = stripLeadingEmoji(title).replace(/^\d+[.)]\s*/, '').trim()
  const known = findReportSection(normalized)
  if (known) return known.key
  for (const [pattern, key] of [[/강점/, 'strengths'], [/보완|개선/, 'improvements'], [/다음/, 'next'], [/정렬|성취기준/, 'alignment'], [/활동별/, 'activities']] as const) {
    if (pattern.test(normalized)) return key
  }
  return 'general'
}

// Markdown AST에서만 묶으므로 코드 블록의 ## 문자열을 섹션으로 오인하지 않는다.
function remarkReportCards({ stage, project }: { stage?: StageCode; project?: Project | null } = {}) {
  return (tree: ReportNode) => {
    const grouped: ReportNode[] = []
    let body: ReportNode | undefined
    for (const node of tree.children ?? []) {
      if (node.type === 'heading' && node.depth === 2) {
        const kind = sectionKind(reportNodeText(node))
        body = { type: 'reportBody', data: { hName: 'div', hProperties: { className: 'report-body' } }, children: [] }
        grouped.push({ type: 'reportCard', data: { hName: 'section', hProperties: { 'data-report-kind': kind } }, children: [node, body] })
      } else if (body) body.children!.push(node)
      else grouped.push(node)
    }
    const cards = grouped.filter(node => node.type === 'reportCard')
    for (const card of cards) {
      const cardBody = card.children![1]
      const kind = card.data!.hProperties!['data-report-kind']
      if (kind === 'activities') {
        let activity: ReportNode | undefined
        const activityNodes: ReportNode[] = []
        const intro: ReportNode[] = []
        for (const node of cardBody.children ?? []) {
          if (node.type === 'heading' && node.depth === 3) {
            const title = reportNodeText(node)
            const code = STAGES.find(item => item.code === stage)?.activities.find(code => new RegExp(`(?:^|\\s|\\()${displayActivityCode(code)}(?=$|[\\s:.)])`).test(title))
            const artifact = code ? project?.artifacts?.[code] : undefined
            const status = artifact?.status === 'confirmed' ? 'confirmed' : artifact ? 'draft' : 'missing'
            const heading: ReportNode = { type: 'reportActivityHeading', data: { hName: 'div', hProperties: { className: 'report-activity-heading' } }, children: [node] }
            activity = { type: 'reportActivity', data: { hName: 'article', hProperties: { className: 'report-activity' } }, children: [heading] }
            if (code && project) heading.children!.push({ type: 'reportStatus', data: { hName: 'span', hProperties: { className: 'report-status', 'data-status': status } }, children: [{ type: 'text', value: status === 'confirmed' ? '확정' : status === 'draft' ? '작성 중' : '산출물 없음' }] })
            activityNodes.push(activity)
          } else if (activity) activity.children!.push(node)
          else intro.push(node)
        }
        if (activityNodes.length) cardBody.children = [...intro, { type: 'reportActivities', data: { hName: 'div', hProperties: { className: 'report-activities' } }, children: activityNodes }]
      }
    }
    // 모든 섹션을 전체 폭으로 이어 붙이고 부록은 인쇄 때 새 페이지로 분리한다.
    const mainCards = cards.filter(card => card.data?.hProperties?.['data-report-kind'] !== 'appendix')
    const appendices = cards.filter(card => card.data?.hProperties?.['data-report-kind'] === 'appendix')
    tree.children = [...grouped.filter(node => node.type !== 'reportCard'), ...mainCards, ...appendices]
    function visit(node: ReportNode) {
      if (node.type === 'reportCard' && node.data?.hProperties?.['data-report-kind'] === 'next') {
        const numberSteps = (child: ReportNode) => {
          if (child.type === 'list') child.children?.forEach((item, i) => {
            item.data = { ...item.data, hProperties: { ...item.data?.hProperties, 'data-report-number': (child.start ?? 1) + i } }
          })
          else child.children?.forEach(numberSteps)
        }
        node.children?.forEach(numberSteps)
      }
      if (node.type === 'list' && node.ordered) {
        node.children?.forEach((item, i) => {
          item.data = { ...item.data, hProperties: { ...item.data?.hProperties, 'data-report-number': (node.start ?? 1) + i } }
        })
      }
      if (node.type === 'table' && node.children?.length) {
        const rows = node.children.slice(1)
        const headers = node.children[0].children ?? []
        const textWidth = (value: string): number => Array.from(value).reduce((width, character) => width + (character.codePointAt(0)! > 127 ? 2 : 1), 0)
        let tableWidth = 0
        headers.forEach((header, i) => {
          const label = reportNodeText(header).replace(/\s+/g, ' ').trim()
          const values = [label, ...rows.map(row => reportNodeText(row.children?.[i] ?? { type: 'text', value: '' }).replace(/\s+/g, ' ').trim())]
          const maxWidth = Math.max(...values.map(textWidth))
          const short = maxWidth <= 28
          const minCh = short ? Math.max(6, maxWidth + 4) : Math.max(24, textWidth(label) + 4)
          tableWidth += minCh
          for (const cell of [header, ...rows.flatMap(row => row.children?.[i] ? [row.children[i]] : [])]) {
            cell.data = { ...cell.data, hProperties: { ...cell.data?.hProperties, 'data-report-min-ch': minCh, 'data-report-label': label, 'data-report-short': short ? 'true' : 'false' } }
          }
        })
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, 'data-report-min-ch': tableWidth, 'data-report-columns': headers.length, 'data-report-print-cards': headers.length >= 6 || tableWidth > 100 ? 'true' : 'false' } }
        node.align ??= headers.map(() => null)
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

/** 새 형식의 요약을 히어로에도 표시하며 기존 본문은 생략하지 않는다. */
export function reportSummary(content: string): { summary: string; keywords: string[] } {
  // 코드 블록의 제목은 제외하고 핵심 요약 섹션의 첫 문장을 읽는다.
  let fenced = ''
  let active = false
  const lines: string[] = []
  for (const line of content.split('\n')) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) { if (!fenced) fenced = fence[1][0]; else if (fenced === fence[1][0]) fenced = ''; continue }
    if (fenced) continue
    if (/^##\s+/.test(line)) {
      if (active) break
      active = line.replace(/^##\s+/, '').replace(/[*_]/g, '').trim() === '이 단계 핵심 요약'
      continue
    }
    if (active && line.trim()) lines.push(line.trim())
  }
  const clean = (value: string) => value.replace(/\*\*|__|`/g, '').replace(/^[-*]\s+/, '').trim()
  const keywordLine = lines.find(line => /^(?:[-*]\s*)?(?:\*\*)?키워드(?:\*\*)?\s*[:：]/.test(line))
  return { summary: clean(lines.find(line => line !== keywordLine) ?? ''), keywords: keywordLine ? clean(keywordLine).replace(/^키워드\s*[:：]\s*/, '').split(/[·,]/).map(word => word.trim()).filter(Boolean) : [] }
}

function reportDate(milliseconds?: number): string {
  return milliseconds && Number.isFinite(milliseconds)
    ? new Date(milliseconds).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '기록 없음'
}

/** 기존 프로젝트·산출물·저장 보고서 데이터만 사용한다. */
export function ReportHero({ stage, project, generatedAt, generating = false, content = '' }: {
  stage: StageCode
  project: Project | null
  generatedAt?: number
  generating?: boolean
  content?: string
}) {
  const activities = STAGES.find(item => item.code === stage)?.activities ?? []
  const confirmed = activities.filter(code => project?.artifacts?.[code]?.status === 'confirmed').length
  const updatedAt = project?.updatedAt?.toMillis?.()
  const StageIcon = STAGE_ICONS[stage]
  const colors = reportStageColors(STAGE_COLOR[stage].hex)
  const { summary } = reportSummary(cleanReportMarkdown(content))
  const saved = activities.filter(code => !!project?.artifacts?.[code]).length
  const versions = activities.reduce((total, code) => total + (project?.artifacts?.[code]?.version ?? 0), 0)
  const kpis = [
    { label: '활동', value: activities.length, unit: '개', Icon: ListChecks },
    { label: '확정', value: confirmed, unit: '개', Icon: CheckCircle },
    { label: '산출물', value: saved, unit: '개', Icon: Database },
    { label: '저장 버전', value: versions, unit: '회', Icon: ArrowsClockwise },
  ]
  return <div className="report-hero" data-report-hero>
    <style>{REPORT_DASHBOARD_CSS}</style>
    <div className="report-hero-banner" style={{ backgroundColor: colors.container, color: colors.band }}>
      <div className="report-hero-title">
        <div className="report-stage-icon"><StageIcon size={24} weight="duotone" aria-hidden="true" /></div>
        <div><p className="report-eyebrow">{stage} · 단계 분석 보고서</p><h3>{STAGE_NAMES[stage]} 단계</h3><p className="report-project-name">{project?.title ?? '프로젝트'}</p></div>
      </div>
      {summary && <p className="report-hero-summary">{summary}</p>}
      <div className="report-dates"><span><CalendarBlank size={14} aria-hidden="true" /> {generating ? '보고서 생성 중' : `생성일 · ${reportDate(generatedAt)}`}</span>{updatedAt && <span><Clock size={14} aria-hidden="true" /> 마지막 갱신 · {reportDate(updatedAt)}</span>}</div>
    </div>
    <dl className="report-metrics">{kpis.map(({ label, value, unit, Icon }) => <div className="report-metric" key={label}><dt>{label}</dt><dd><Icon size={14} aria-hidden="true" />{value}<small>{unit}</small></dd></div>)}</dl>
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
          i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : reportStandardContent(part))}
      </span>)
    }
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return cloneElement(child, {}, reportCellContent(child.props.children))
    }
    return child
  })
}

function reportStandardContent(text: string): ReactNode {
  return text.split(/(\[?\d[가-힣]+\d{2}-\d{2}\]?)/g).map((part, i) => i % 2
    ? <span key={i} className="report-standard">{part}</span>
    : part.split(/([A-Za-z][A-Za-z0-9_:/?&=.%#@+~-]{23,})/g).map((word, j) => j % 2
      ? <span key={j} className="report-long-english">{word}</span>
      : word))
}

/** 화면과 PDF가 공유하는 MD3 대시보드 본문. 예전 보고서의 내용도 유지한다. */
export function ReportMarkdown({ content, stage, project }: { content: string; stage?: StageCode; project?: Project | null }) {
  const colors = stage ? reportStageColors(STAGE_COLOR[stage].hex) : undefined
  return <div className="report-dashboard" style={colors ? { '--report-stage-band': colors.band, '--report-stage-container': colors.container } as CSSProperties : undefined}>
    <style>{REPORT_DASHBOARD_CSS}</style>
    <ReactMarkdown remarkPlugins={[...REMARK_PLUGINS, [remarkReportCards, { stage, project }]]} components={{
      section: ({ children, node }) => {
        const kind = String(node?.properties?.['data-report-kind'] ?? node?.properties?.dataReportKind ?? 'general')
        if (kind === 'appendix') {
          const [heading, ...body] = Children.toArray(children)
          return <section data-report-section data-report-kind="appendix" className="report-section report-appendix">
            <details data-report-appendix>
              <summary className="report-appendix-toggle">{heading}<span className="report-appendix-action"><span className="report-appendix-expand">펼치기</span><span className="report-appendix-collapse">접기</span><ArrowRight size={16} aria-hidden="true" /></span></summary>
              {body}
            </details>
          </section>
        }
        return <section data-report-section data-report-kind={kind} className="report-section">{children}</section>
      },
      h1: ({ children }) => <h1>{children}</h1>,
      h2: ({ children }) => {
        const raw = reportHeadingText(children)
        const SectionIcon = sectionIcon(raw)
        return <h2><span className="report-section-icon"><SectionIcon size={22} weight="duotone" aria-hidden="true" /></span><span>{stripLeadingEmoji(raw) || children}</span></h2>
      },
      h3: ({ children }) => <h3>{stripLeadingEmoji(reportHeadingText(children)) || children}</h3>,
      h4: ({ children }) => <h4>{stripLeadingEmoji(reportHeadingText(children)) || children}</h4>,
      p: ({ children }) => <p>{children}</p>,
      strong: ({ children }) => <strong>{children}</strong>,
      ul: ({ children }) => <ul>{children}</ul>,
      ol: ({ children }) => <ol>{children}</ol>,
      li: ({ children, node }) => {
        const number = node?.properties?.['data-report-number'] ?? node?.properties?.dataReportNumber
        return <li><span className="report-list-mark" aria-hidden="true">{number ? String(number) : '•'}</span><div className="report-list-content">{children}</div></li>
      },
      blockquote: ({ children }) => <aside role="note" aria-label="인사이트와 권고" className="report-callout"><Lightbulb size={18} aria-hidden="true" /><div>{children}</div></aside>,
      table: ({ children, node }) => {
        const printCards = String(node?.properties?.['data-report-print-cards'] ?? node?.properties?.dataReportPrintCards) === 'true'
        const minCh = Number(node?.properties?.['data-report-min-ch'] ?? node?.properties?.dataReportMinCh)
        return <div role="region" aria-label="보고서 표" tabIndex={0} className={`report-table-scroll${printCards ? ' report-table-wide' : ''}`}><table data-columns={node?.properties?.['data-report-columns'] ?? node?.properties?.dataReportColumns} style={minCh ? { minWidth: `${minCh}ch` } : undefined}>{children}</table></div>
      },
      th: ({ children, style, node }) => {
        const minCh = Number(node?.properties?.['data-report-min-ch'] ?? node?.properties?.dataReportMinCh)
        return <th scope="col" style={{ ...style, ...(minCh ? { minWidth: `${minCh}ch` } : {}) }}>{children}</th>
      },
      td: ({ children, style, node }) => {
        const properties = node?.properties ?? {}
        const minCh = Number(properties['data-report-min-ch'] ?? properties.dataReportMinCh)
        const short = String(properties['data-report-short'] ?? properties.dataReportShort) === 'true'
        return <td data-short-cell={short ? 'true' : undefined} data-long-cell={short ? undefined : 'true'} data-label={properties['data-report-label'] ?? properties.dataReportLabel} style={{ ...style, ...(minCh ? { minWidth: `${minCh}ch` } : {}) }}>{reportCellContent(children)}</td>
      },
    }}>{cleanReportMarkdown(content)}</ReactMarkdown>
  </div>
}

'use client'
import type { A21Row, A21Structured } from '@/lib/artifacts/schemas'

function displayCell(value?: string): string {
  const cleaned = (value ?? '')
    .replace(/&(?:#124|124);/g, ' / ')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim()
  return cleaned || '-'
}

function inferGradeLabelFromStandard(standard?: string): string {
  const code = (standard ?? '').match(/\[?(\d)[가-힣A-Za-z]*\d{2}-\d{2}\]?/)?.[1]
  if (!code) return ''
  if (code === '1' || code === '2') return '1-2학년군'
  if (code === '3' || code === '4') return '3-4학년군'
  if (code === '5' || code === '6') return '5-6학년군'
  return ''
}

function displayContentElement(value?: string, standard?: string): string {
  const cleaned = displayCell(value)
  if (cleaned === '-') return cleaned
  const gradeLabel = inferGradeLabelFromStandard(standard)
  if (!gradeLabel) return cleaned
  return cleaned
    .split(/\s*\/\s*/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => /^\d-\d학년군:/.test(item) ? item : `${gradeLabel}: ${item}`)
    .join(' / ')
}

/**
 * 교과 칸('사회 (5-6학년군) ★중심')을 이름·학년군·중심 표시로 나눈다.
 * 학년군 접미사는 혼성 학년 팀 시트에서만 붙으므로 없으면 band가 ''이다
 * (graphSheetBridge.buildCurriculumSheetArtifactProposal 참고).
 */
function splitSubjectCell(subject?: string): { name: string; band: string; isCenter: boolean } {
  const raw = displayCell(subject)
  const bandMatch = raw.match(/\(\s*(\d)\s*-\s*(\d)\s*학년군\s*\)/)
  const band = bandMatch ? `${bandMatch[1]}-${bandMatch[2]}학년군` : ''
  const withoutBand = bandMatch ? raw.replace(bandMatch[0], ' ') : raw
  const isCenter = /★\s*중심/.test(withoutBand)
  const name = withoutBand.replace(/★\s*중심/g, ' ').replace(/\s+/g, ' ').trim()
  return { name: name || '-', band, isCenter }
}

function Chip({ text, tone = 'band' }: { text: string; tone?: 'band' | 'center' }) {
  const tones = {
    band: 'bg-[#E8F0FE] text-[#1557B0]',
    center: 'bg-[#FEF7E0] text-[#B06000]',
  }
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${tones[tone]}`}>
      {text}
    </span>
  )
}

export function A21Renderer({ data }: { data: A21Structured }) {
  const rows = data?.rows ?? []
  const subjectRows = rows.filter(r => !r.isCommon)
  const commonRows = rows.filter(r => r.isCommon)
  const hasStandard = rows.some(r => r.standard)
  const hasValueAttitude = rows.some(r => r.valueAttitude)
  const hasContribution = rows.some(r => r.contribution)
  const hasAgentLesson = rows.some(r => r.agentLessonExample)
  const hasDescription = rows.some(r => r.description)
  const headers = [
    '교과',
    '핵심 아이디어',
    ...(hasStandard ? ['성취기준'] : []),
    '지식·이해',
    '과정·기능',
    ...(hasValueAttitude ? ['가치·태도'] : []),
    ...(hasContribution ? ['공통 요소·고유 기여'] : []),
    ...(hasAgentLesson ? ['Agent 추천 수업아이디어'] : []),
    ...(hasDescription ? ['수업내용 설명'] : []),
  ]

  // 같은 핵심아이디어 묶음(학년군만 다른 줄·다른 교과 연결 줄)을 한 행으로 묶는다 —
  // 분석시트 화면과 같은 규칙. 표에서는 교과 칸 '↳ ' 표시가 groupWithPrevious로 들어온다.
  const groups: A21Row[][] = []
  for (const row of subjectRows) {
    const last = groups[groups.length - 1]
    if (row.groupWithPrevious && last) last.push(row)
    else groups.push([row])
  }

  /** 묶음 안 줄 앞에 붙는 학년군(필요하면 교과명까지) 표시 — 한 줄 묶음이면 없음. */
  function lineChip(group: A21Row[], index: number): string {
    if (group.length < 2) return ''
    const leader = splitSubjectCell(group[0].subject)
    const own = splitSubjectCell(group[index].subject)
    const name = own.name !== '-' && own.name !== leader.name ? own.name : ''
    return [own.band, name, own.isCenter ? '★ 중심' : ''].filter(Boolean).join(' · ')
  }

  /** 묶음의 대표 칸(교과·핵심 아이디어) — 묶음 줄 수만큼 세로로 합친다. */
  function leadCells(group: A21Row[]) {
    const leader = group[0]
    const { name, band, isCenter } = splitSubjectCell(leader.subject)
    const leaderIdea = displayCell(leader.coreIdea)
    // 연결 줄(다른 교과 핵심아이디어를 쓰는 줄)은 대표 칸 아래에 한 줄로 덧붙인다.
    const linkedLines = group.slice(1)
      .map(row => ({ idea: displayCell(row.coreIdea), ...splitSubjectCell(row.subject) }))
      .filter(line => line.idea !== '-' && line.idea !== leaderIdea)
    const cellBase = `px-3 py-3 align-top border-b border-[#DADCE0]${group.length > 1 ? ' border-r border-[#F1F3F4]' : ''}`
    return (
      <>
        <td rowSpan={group.length} className={`${cellBase} whitespace-nowrap`}>
          <div className="flex flex-col items-start gap-1">
            <span className="font-semibold text-[#1A73E8]">{name}</span>
            {group.length === 1 && (band || isCenter) && (
              <span className="flex items-center gap-1">
                {band && <Chip text={band} />}
                {isCenter && <Chip text="★ 중심" tone="center" />}
              </span>
            )}
          </div>
        </td>
        <td rowSpan={group.length} className={`${cellBase} text-[#202124] min-w-[220px]`}>
          <p className="leading-relaxed whitespace-pre-line">{leaderIdea}</p>
          {linkedLines.map((line, i) => (
            <p key={i} className="mt-1.5 text-[11px] leading-relaxed text-[#5F6368] whitespace-pre-line">
              {`↔ ${[line.band, line.name !== '-' ? line.name : ''].filter(Boolean).join(' · ')}: ${line.idea}`}
            </p>
          ))}
        </td>
      </>
    )
  }

  /** 묶음 안 한 줄의 고유 칸(성취기준 이하) — 줄 사이는 얇은 선, 묶음 사이는 기본 선. */
  function lineCells(r: A21Row, options: { chip?: string; lastInGroup: boolean }) {
    const border = options.lastInGroup ? 'border-b border-[#DADCE0]' : 'border-b border-[#F1F3F4]'
    const cell = `px-3 py-3 leading-relaxed align-top whitespace-pre-line ${border}`
    const chipEl = options.chip ? <><Chip text={options.chip} />{' '}</> : null
    return (
      <>
        {hasStandard && (
          <td className={`${cell} text-[#1A73E8] min-w-[220px]`}>{chipEl}{displayCell(r.standard)}</td>
        )}
        <td className={`${cell} text-[#5F6368] min-w-[160px]`}>
          {!hasStandard && chipEl}{displayContentElement(r.knowledgeUnderstanding, r.standard)}
        </td>
        <td className={`${cell} text-[#5F6368] min-w-[160px]`}>{displayContentElement(r.processFunction, r.standard)}</td>
        {hasValueAttitude && <td className={`${cell} text-[#5F6368] min-w-[160px]`}>{displayContentElement(r.valueAttitude, r.standard)}</td>}
        {hasContribution && <td className={`${cell} text-[#202124] min-w-[180px]`}>{displayCell(r.contribution)}</td>}
        {hasAgentLesson && <td className={`${cell} text-[#4A148C] min-w-[240px]`}>{displayCell(r.agentLessonExample)}</td>}
        {hasDescription && <td className={`${cell} text-[#202124] min-w-[220px]`}>{displayCell(r.description)}</td>}
      </>
    )
  }

  /** 공통(팀 조정) 행 — 묶음 없이 기존 한 줄 렌더링을 유지한다. */
  function commonCells(r: A21Row) {
    const cell = 'px-3 py-3 leading-relaxed align-top whitespace-pre-line'
    return (
      <>
        <td className="px-3 py-3 font-semibold text-[#1A73E8] whitespace-nowrap align-top">{displayCell(r.subject)}</td>
        <td className={`${cell} text-[#202124] min-w-[220px]`}>{displayCell(r.coreIdea)}</td>
        {hasStandard && <td className={`${cell} text-[#1A73E8] min-w-[220px]`}>{displayCell(r.standard)}</td>}
        <td className={`${cell} text-[#5F6368] min-w-[160px]`}>{displayContentElement(r.knowledgeUnderstanding, r.standard)}</td>
        <td className={`${cell} text-[#5F6368] min-w-[160px]`}>{displayContentElement(r.processFunction, r.standard)}</td>
        {hasValueAttitude && <td className={`${cell} text-[#5F6368] min-w-[160px]`}>{displayContentElement(r.valueAttitude, r.standard)}</td>}
        {hasContribution && <td className={`${cell} text-[#202124] min-w-[180px]`}>{displayCell(r.contribution)}</td>}
        {hasAgentLesson && <td className={`${cell} text-[#4A148C] min-w-[240px]`}>{displayCell(r.agentLessonExample)}</td>}
        {hasDescription && <td className={`${cell} text-[#202124] min-w-[220px]`}>{displayCell(r.description)}</td>}
      </>
    )
  }

  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">핵심아이디어 및 내용체계 분석</span>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm border-collapse [word-break:keep-all]">
            <thead className="bg-[#1A73E8]"><tr>
              {headers.map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {groups.flatMap((group, gi) => group.map((r, li) => (
                <tr key={`${gi}-${li}`} className="hover:bg-[#F8F9FA]/50">
                  {li === 0 && leadCells(group)}
                  {lineCells(r, { chip: lineChip(group, li), lastInGroup: li === group.length - 1 })}
                </tr>
              )))}
              {commonRows.map((r, i) => (
                <tr key={`common-${i}`} className="bg-[#E8F0FE] border-t-2 border-[#1A73E8]">
                  {commonCells({ ...r, subject: r.subject || '공통 (팀 조정)' })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 분석표가 작성되지 않았습니다</div>
      )}
      {data?.agentLessonIdeas && !hasAgentLesson && (
        <div className="border-t border-[#E8EAED] bg-[#FCF8FF] px-4 py-3">
          <p className="text-[11px] font-bold text-[#7B1FA2] uppercase tracking-wider mb-2">Agent 추천 수업아이디어</p>
          <p className="text-sm text-[#4A148C] leading-relaxed whitespace-pre-line">{displayCell(data.agentLessonIdeas)}</p>
        </div>
      )}
      {(data?.commonElements || data?.reconstructedStandard) && (
        <div className="border-t border-[#DADCE0] bg-[#F8F9FA] px-4 py-4 space-y-3">
          {data.commonElements && (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#5F6368]">교과 간 공통 요소</p>
              <p className="text-sm leading-relaxed text-[#202124]">{data.commonElements}</p>
            </div>
          )}
          {data.reconstructedStandard && (
            <div className="rounded-xl border border-[#B7D1F8] bg-[#E8F0FE] px-3 py-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#1557B0]">재구조화 성취기준</p>
              <p className="text-sm font-semibold leading-relaxed text-[#202124]">{data.reconstructedStandard}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'
import type { A21Structured } from '@/lib/artifacts/schemas'

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

export function A21Renderer({ data }: { data: A21Structured }) {
  const rows = data?.rows ?? []
  const subjectRows = rows.filter(r => !r.isCommon)
  const commonRows = rows.filter(r => r.isCommon)
  const hasStandard = rows.some(r => r.standard)
  const hasAgentLesson = rows.some(r => r.agentLessonExample)
  const hasDescription = rows.some(r => r.description)
  const headers = [
    '교과',
    '핵심 아이디어',
    ...(hasStandard ? ['성취기준'] : []),
    '지식·이해',
    '과정·기능',
    ...(hasAgentLesson ? ['Agent 추천 수업아이디어'] : []),
    ...(hasDescription ? ['수업내용 설명'] : []),
  ]

  function renderCells(r: typeof rows[number]) {
    return (
      <>
        <td className="px-3 py-3 font-semibold text-[#1A73E8] whitespace-nowrap align-top">{displayCell(r.subject)}</td>
        <td className="px-3 py-3 leading-relaxed align-top text-[#202124] min-w-[220px] whitespace-pre-line">{displayCell(r.coreIdea)}</td>
        {hasStandard && <td className="px-3 py-3 leading-relaxed align-top text-[#1A73E8] min-w-[220px] whitespace-pre-line">{displayCell(r.standard)}</td>}
        <td className="px-3 py-3 leading-relaxed align-top text-[#5F6368] min-w-[160px] whitespace-pre-line">{displayContentElement(r.knowledgeUnderstanding, r.standard)}</td>
        <td className="px-3 py-3 leading-relaxed align-top text-[#5F6368] min-w-[160px] whitespace-pre-line">{displayContentElement(r.processFunction, r.standard)}</td>
        {hasAgentLesson && <td className="px-3 py-3 leading-relaxed align-top text-[#4A148C] min-w-[240px] whitespace-pre-line">{displayCell(r.agentLessonExample)}</td>}
        {hasDescription && <td className="px-3 py-3 leading-relaxed align-top text-[#202124] min-w-[220px] whitespace-pre-line">{displayCell(r.description)}</td>}
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
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-[#1A73E8]"><tr>
              {headers.map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {subjectRows.map((r, i) => (
                <tr key={i} className="border-b border-[#F1F3F4] hover:bg-[#F8F9FA]/50">
                  {renderCells(r)}
                </tr>
              ))}
              {commonRows.map((r, i) => (
                <tr key={`common-${i}`} className="bg-[#E8F0FE] border-t-2 border-[#1A73E8]">
                  {renderCells({ ...r, subject: r.subject || '공통 (팀 조정)' })}
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
    </div>
  )
}

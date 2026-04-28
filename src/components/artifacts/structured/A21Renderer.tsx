'use client'
import type { A21Structured } from '@/lib/artifacts/schemas'

export function A21Renderer({ data }: { data: A21Structured }) {
  const rows = data?.rows ?? []
  const subjectRows = rows.filter(r => !r.isCommon)
  const commonRows = rows.filter(r => r.isCommon)

  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">핵심아이디어 및 내용체계 분석</span>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-[#1A73E8]"><tr>
              {['교과', '핵심 아이디어', '지식·이해', '과정·기능'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {subjectRows.map((r, i) => (
                <tr key={i} className="border-b border-[#F1F3F4] hover:bg-[#F8F9FA]/50">
                  <td className="px-3 py-3 font-semibold text-[#1A73E8] whitespace-nowrap align-top">{r.subject}</td>
                  <td className="px-3 py-3 leading-relaxed align-top text-[#202124]">{r.coreIdea}</td>
                  <td className="px-3 py-3 leading-relaxed align-top text-[#5F6368]">{r.knowledgeUnderstanding || '-'}</td>
                  <td className="px-3 py-3 leading-relaxed align-top text-[#5F6368]">{r.processFunction || '-'}</td>
                </tr>
              ))}
              {commonRows.map((r, i) => (
                <tr key={`common-${i}`} className="bg-[#E8F0FE] border-t-2 border-[#1A73E8]">
                  <td className="px-3 py-3 font-bold text-[#1A73E8] whitespace-nowrap align-top">
                    {r.subject || '공통 (팀 조정)'}
                  </td>
                  <td className="px-3 py-3 leading-relaxed align-top font-semibold text-[#202124]">{r.coreIdea}</td>
                  <td className="px-3 py-3 leading-relaxed align-top font-semibold text-[#5F6368]">{r.knowledgeUnderstanding || '-'}</td>
                  <td className="px-3 py-3 leading-relaxed align-top font-semibold text-[#5F6368]">{r.processFunction || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 분석표가 작성되지 않았습니다</div>
      )}
    </div>
  )
}

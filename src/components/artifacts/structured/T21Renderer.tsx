'use client'

import type { T21Structured } from '@/lib/artifacts/schemas'

export function T21Renderer({ data }: { data: T21Structured }) {
  const roles = data?.roles ?? []
  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">역할 배분</span>
      </div>
      {roles.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm border-collapse [word-break:keep-all]">
            <thead className="bg-[#1A73E8]">
              <tr>
                {['교사명', '담당 교과', '강점·전문성', '팀 내 역할', '담당 업무'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F4]">
              {roles.map((r, i) => (
                <tr key={i} className="hover:bg-[#F8F9FA]/50">
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{r.teacherName}</td>
                  <td className="px-3 py-2.5 text-[#5F6368] whitespace-nowrap">{r.subject || '-'}</td>
                  <td className="px-3 py-2.5 leading-relaxed">{r.strengths || '-'}</td>
                  <td className="px-3 py-2.5 font-semibold text-[#1A73E8]">{r.role || '-'}</td>
                  <td className="px-3 py-2.5 leading-relaxed">{r.responsibilities || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 역할이 배분되지 않았습니다</div>
      )}
    </div>
  )
}

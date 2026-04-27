'use client'

import type { T23Structured } from '@/lib/artifacts/schemas'

export function T23Renderer({ data }: { data: T23Structured }) {
  const { schedule } = data
  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">팀 일정</span>
      </div>
      {schedule.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-[#1A73E8]">
              <tr>
                {['기간', '활동 내용', '마감·산출물', '담당자'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F4]">
              {schedule.map((s, i) => (
                <tr key={i} className="hover:bg-[#F8F9FA]/50">
                  <td className="px-3 py-2.5 font-semibold text-[#1A73E8] whitespace-nowrap">{s.period}</td>
                  <td className="px-3 py-2.5 leading-relaxed">{s.activity}</td>
                  <td className="px-3 py-2.5 text-[#5F6368] leading-relaxed">{s.deliverable || '-'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{s.assignee || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 일정이 설정되지 않았습니다</div>
      )}
    </div>
  )
}

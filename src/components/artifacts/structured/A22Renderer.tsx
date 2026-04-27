'use client'
import type { A22Structured } from '@/lib/artifacts/schemas'

export function A22Renderer({ data }: { data: A22Structured }) {
  const subjectGoals = data?.subjectGoals ?? []
  const integratedGoals = data?.integratedGoals ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">교과별 세부 목표</span>
        </div>
        {subjectGoals.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-[#1A73E8]"><tr>
                {['교과', '학습 목표'].map(h => <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {subjectGoals.map((g, i) => <tr key={i} className="hover:bg-[#F8F9FA]/50"><td className="px-3 py-2.5 font-semibold text-[#1A73E8] whitespace-nowrap">{g.subject}</td><td className="px-3 py-2.5 leading-relaxed">{g.goal}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 교과별 목표가 정해지지 않았습니다</div>}
      </div>

      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">통합 학습목표</span>
        </div>
        {integratedGoals.length > 0 ? (
          <div className="px-4 py-3 space-y-2">
            {integratedGoals.map((g, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#34A853] text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <p className="text-sm leading-relaxed">{g}</p>
              </div>
            ))}
          </div>
        ) : <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 통합 목표가 진술되지 않았습니다</div>}
      </div>
    </div>
  )
}

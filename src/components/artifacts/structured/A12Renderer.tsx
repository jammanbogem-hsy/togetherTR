'use client'
import type { A12Structured } from '@/lib/artifacts/schemas'

export function A12Renderer({ data }: { data: A12Structured }) {
  const criteria = data?.criteria ?? []
  const linkedSubjects = data?.linkedSubjects ?? []
  const selectedTopic = data?.selectedTopic ?? ''
  const topicType = data?.topicType ?? ''
  const rationale = data?.rationale ?? ''

  return (
    <div className="space-y-4">
      {/* 주제 선정 기준 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">주제 선정 기준</span>
        </div>
        {criteria.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-[#1A73E8]"><tr>
                {['기준', '설명', '우선순위'].map(h => <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {criteria.map((c, i) => <tr key={i} className="hover:bg-[#F8F9FA]/50"><td className="px-3 py-2.5 font-semibold">{c.criterion}</td><td className="px-3 py-2.5 leading-relaxed">{c.description || '-'}</td><td className="px-3 py-2.5 text-[#5F6368]">{c.priority || '-'}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 기준이 정해지지 않았습니다</div>}
      </div>

      {linkedSubjects.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">연계 교과</span>
          </div>
          <div className="divide-y divide-[#F1F3F4]">
            {linkedSubjects.map((item, i) => (
              <div key={`${item.subject}-${i}`} className="px-4 py-3 text-sm">
                <span className="font-bold text-[#202124]">{item.subject}</span>
                <span className="text-[#5F6368]">: {item.focus}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 선정 주제 + 유형 + 근거 — 통합 카드 */}
      <div className="rounded-2xl border-2 border-[#34A853] overflow-hidden bg-[#E6F4EA]">
        <div className="px-5 py-4 space-y-3">
          <div>
            <span className="text-[10px] font-bold text-[#137333] uppercase tracking-wider">선정 주제</span>
            <p className="text-lg font-bold text-[#137333] mt-1">{selectedTopic || '아직 선정되지 않았습니다'}</p>
          </div>
          {topicType && (
            <div>
              <span className="text-[10px] font-bold text-[#137333] uppercase tracking-wider">주제 유형</span>
              <p className="text-sm font-semibold text-[#137333]/80 mt-0.5">{topicType}</p>
            </div>
          )}
          {rationale && (
            <div>
              <span className="text-[10px] font-bold text-[#137333] uppercase tracking-wider">선정 근거</span>
              <p className="text-sm text-[#137333]/80 mt-0.5 leading-relaxed">{rationale}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

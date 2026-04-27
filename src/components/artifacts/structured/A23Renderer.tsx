'use client'
import type { A23Structured } from '@/lib/artifacts/schemas'

export function A23Renderer({ data }: { data: A23Structured }) {
  const commonProfile = data?.commonProfile ?? []
  const teacherNotes = data?.teacherNotes ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">팀 공통 학습자 프로필</span>
        </div>
        {commonProfile.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-[#7B1FA2]"><tr>
                {['항목', '공통 내용'].map(h => <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#6A1B9A]">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {commonProfile.map((p, i) => <tr key={i} className="hover:bg-[#F8F9FA]/50"><td className="px-3 py-2.5 font-semibold text-[#7B1FA2] whitespace-nowrap">{p.item}</td><td className="px-3 py-2.5 leading-relaxed">{p.content}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 학습자 프로필이 작성되지 않았습니다</div>}
      </div>

      {teacherNotes.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">교사별 맞춤 고려 포인트</span>
          </div>
          <div className="divide-y divide-[#F1F3F4]">
            {teacherNotes.map((t, i) => (
              <div key={i} className="px-4 py-3 flex items-start gap-3">
                <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-[#F3E5F5] text-[#7B1FA2]">{t.teacherName}</span>
                <p className="text-sm leading-relaxed">{t.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

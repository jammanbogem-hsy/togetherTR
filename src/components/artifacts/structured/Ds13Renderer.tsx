'use client'

import type { Ds13Structured } from '@/lib/artifacts/schemas'

const HEADERS = ['순서', '흐름 단계', '활동명', '활동 설명', '핵심/부가', '담당 교과', '누적 차시', '차시 운영'] as const

function CoreTypeBadge({ value }: { value: string }) {
  const v = (value ?? '').trim()
  if (!v) return <span className="text-[#9AA0A6]">-</span>
  const isCore = v.includes('핵심')
  return (
    <span
      className={
        isCore
          ? 'inline-flex items-center rounded-full bg-[#E8F0FE] px-2.5 py-1 text-[11px] font-bold text-[#1A73E8]'
          : 'inline-flex items-center rounded-full bg-[#F1F3F4] px-2.5 py-1 text-[11px] font-bold text-[#5F6368]'
      }
    >
      {v}
    </span>
  )
}

export function Ds13Renderer({ data }: { data: Ds13Structured }) {
  const activities = data.activities ?? []
  const review = (data.review ?? '').trim()

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">학습활동 설계</span>
        </div>
        {activities.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm border-collapse [word-break:keep-all]">
              <thead className="bg-[#1A73E8]">
                <tr>
                  {HEADERS.map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {activities.map((a, i) => (
                  <tr key={i} className="hover:bg-[#F8F9FA]/50 align-top">
                    <td className="px-3 py-2.5 font-semibold text-[#1A73E8] whitespace-nowrap">{a.order || i + 1}</td>
                    <td className="px-3 py-2.5 text-[#5F6368] whitespace-nowrap">{a.phase || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#202124] leading-relaxed">{a.name || '-'}</td>
                    <td className="px-3 py-2.5 text-[#3C4043] leading-relaxed min-w-[220px]">{a.description || '-'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><CoreTypeBadge value={a.coreType} /></td>
                    <td className="px-3 py-2.5 text-[#5F6368] whitespace-nowrap">{a.subject || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#1A73E8] whitespace-nowrap">{a.session || '-'}</td>
                    <td className="px-3 py-2.5 text-[#5F6368] leading-relaxed min-w-[200px]">{a.operation || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 학습 활동이 설계되지 않았습니다</div>
        )}
      </div>

      {review && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">AI 점검</span>
          </div>
          <p className="px-4 py-3 text-sm leading-relaxed text-[#3C4043] whitespace-pre-wrap">{review}</p>
        </div>
      )}
    </div>
  )
}

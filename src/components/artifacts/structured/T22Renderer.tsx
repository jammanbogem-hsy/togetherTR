'use client'

import type { T22Structured } from '@/lib/artifacts/schemas'

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  소통: { bg: 'bg-blue-100', text: 'text-blue-700' },
  시간: { bg: 'bg-amber-100', text: 'text-amber-700' },
  조율: { bg: 'bg-purple-100', text: 'text-purple-700' },
  태도: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
}

export function T22Renderer({ data }: { data: T22Structured }) {
  const rules = data?.rules ?? []
  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">팀 규칙</span>
      </div>
      {rules.length > 0 ? (
        <div className="divide-y divide-[#F1F3F4]">
          {rules.map((r, i) => {
            const catStyle = CATEGORY_COLORS[r.category] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
            return (
              <div key={i} className="px-4 py-3.5">
                <div className="flex items-start gap-2.5">
                  {r.category && (
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${catStyle.bg} ${catStyle.text} mt-0.5`}>
                      {r.category}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#202124]">{r.name}</p>
                    <p className="mt-1 text-xs text-[#5F6368] leading-relaxed">{r.description}</p>
                    {r.violation && (
                      <p className="mt-1.5 text-[10px] text-[#9AA0A6]">
                        위반 시: {r.violation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 팀 규칙이 설정되지 않았습니다</div>
      )}
    </div>
  )
}

'use client'

import type { T12Structured } from '@/lib/artifacts/schemas'

interface Props {
  data: T12Structured
}

export function T12Renderer({ data }: Props) {
  const designPrinciples = data?.designPrinciples ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">수업 설계 원칙</span>
        </div>
        {designPrinciples.length > 0 ? (
          <div className="divide-y divide-[#F1F3F4]">
            {designPrinciples.map((dp, i) => (
              <div key={i} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1A73E8] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#202124] leading-relaxed">
                      {dp.principle}
                    </p>
                    {dp.rationale && (
                      <p className="mt-1.5 text-xs text-[#5F6368] leading-relaxed">
                        {dp.rationale}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">
            아직 설계 원칙이 확정되지 않았습니다
          </div>
        )}
      </div>
    </div>
  )
}

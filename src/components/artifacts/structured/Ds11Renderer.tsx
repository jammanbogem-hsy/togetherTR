'use client'

import type { Ds11Structured } from '@/lib/artifacts/schemas'

// AI가 마크다운 굵은체로 작성한 경우 raw 별표가 노출되지 않도록 inline bold만 변환.
function InlineMarkdown({ text }: { text: string }) {
  const parts = (text ?? '').split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4
          ? <strong key={i} className="font-extrabold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

export function Ds11Renderer({ data }: { data: Ds11Structured }) {
  const rubric = data?.rubric ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">평가 계획 (상/중/하 루브릭)</span>
        </div>
        {rubric.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm border-collapse [word-break:keep-all]">
              <thead className="bg-[#E8F0FE]">
                <tr>
                  {['평가 항목', '평가 방법', '평가 시점', '상', '중', '하'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-[#1A237E] border-b border-[#BBDEFB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {rubric.map((r, i) => (
                  <tr key={i} className="align-top hover:bg-[#F8F9FA]/50">
                    <td className="px-3 py-2.5 font-semibold text-[#202124]"><InlineMarkdown text={r.item} /></td>
                    <td className="px-3 py-2.5 text-[#3C4043]"><InlineMarkdown text={r.method} /></td>
                    <td className="px-3 py-2.5 text-[#3C4043] whitespace-nowrap"><InlineMarkdown text={r.timing} /></td>
                    <td className="px-3 py-2.5 bg-[#E6F4EA]/40 text-[#202124] leading-relaxed"><InlineMarkdown text={r.high} /></td>
                    <td className="px-3 py-2.5 bg-[#FEF7E0]/50 text-[#202124] leading-relaxed"><InlineMarkdown text={r.mid} /></td>
                    <td className="px-3 py-2.5 bg-[#FCE8E6]/50 text-[#202124] leading-relaxed"><InlineMarkdown text={r.low} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 평가 계획이 확정되지 않았습니다</div>
        )}
      </div>
    </div>
  )
}

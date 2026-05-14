'use client'
import type { A22Structured } from '@/lib/artifacts/schemas'

const TAG_RE = /(\(\s*(?:지식[·⋅]\s*이해|과정[·⋅]\s*기능|가치[·⋅]\s*태도)(?:\s*[:：][^)]*)?\))/g

function HighlightedGoal({ text }: { text: string }) {
  const parts = text.split(TAG_RE)
  return (
    <span className="leading-relaxed">
      {parts.map((p, i) =>
        TAG_RE.test(p) ? (
          <span key={i} className="inline-block px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-bold text-[#1A237E] bg-[#E8F0FE] border border-[#BBDEFB] align-baseline">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  )
}

export function A22Renderer({ data }: { data: A22Structured }) {
  const commonCoreIdea = data?.commonCoreIdea ?? ''
  const integratedGoal = data?.integratedGoal ?? ''
  const subjectGoals = data?.subjectGoals ?? []
  const keywords = data?.convergentKeywords ?? []
  const method = data?.method

  const methodLabel = method === 'deductive' ? '연역적(통합 → 개별)' : method === 'inductive' ? '귀납적(개별 → 통합)' : null

  return (
    <div className="space-y-4">
      {/* 1. 공통 핵심 아이디어 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">공통 핵심 아이디어</span>
          {methodLabel && (
            <span className="text-[11px] font-semibold text-[#1A73E8]">진술 방식 · {methodLabel}</span>
          )}
        </div>
        {commonCoreIdea ? (
          <p className="px-4 py-3 text-sm leading-relaxed text-[#202124]">{commonCoreIdea}</p>
        ) : (
          <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 공통 핵심 아이디어가 정해지지 않았습니다</div>
        )}
      </div>

      {/* 2. 통합 수업목표 (단일 문장) */}
      <div className="rounded-2xl border border-[#1A73E8]/30 overflow-hidden bg-[#F8FBFF]">
        <div className="bg-[#1A73E8] px-4 py-2.5 border-b border-[#1557B0]">
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">통합 수업목표</span>
        </div>
        {integratedGoal ? (
          <p className="px-4 py-3.5 text-[15px] font-semibold leading-relaxed text-[#1A237E]">
            <HighlightedGoal text={integratedGoal} />
          </p>
        ) : (
          <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 통합 수업목표가 진술되지 않았습니다</div>
        )}
      </div>

      {/* 3. 핵심 키워드 (선택) */}
      {keywords.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">수렴 핵심 키워드</span>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {keywords.map((kw, i) => (
              <span key={i} className="px-2.5 py-1 rounded-full text-xs font-semibold text-[#34A853] bg-[#E6F4EA] border border-[#A8DAB5]">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4. 교과별 수업목표 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">교과별 수업목표</span>
        </div>
        {subjectGoals.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-[#E8F0FE]">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-[#1A237E] border-b border-[#BBDEFB] w-20">교과</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-[#1A237E] border-b border-[#BBDEFB]">교과별 수업목표</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {subjectGoals.map((g, i) => (
                  <tr key={i} className="hover:bg-[#F8F9FA]/50 align-top">
                    <td className="px-3 py-2.5 font-semibold text-[#1A73E8] whitespace-nowrap">{g.subject}</td>
                    <td className="px-3 py-2.5">
                      <HighlightedGoal text={g.goal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-4 text-sm text-[#9AA0A6]">아직 교과별 수업목표가 정해지지 않았습니다</div>
        )}
      </div>
    </div>
  )
}

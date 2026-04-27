'use client'

import type { T11Structured } from '@/lib/artifacts/schemas'

interface Props {
  data: T11Structured
}

export function T11Renderer({ data }: Props) {
  const personalVisions = data?.personalVisions ?? []
  const teamVision = data?.teamVision ?? ''
  const coreKeywords = data?.coreKeywords ?? []

  return (
    <div className="space-y-4">
      {/* 개인 비전 표 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">개인 비전</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-[#1A73E8]">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">교사명</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">개인 비전 키워드</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">AI 정교화 비전</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F4]">
              {personalVisions.length > 0 ? (
                personalVisions.map((pv, i) => (
                  <tr key={i} className="hover:bg-[#F8F9FA]/50 transition-colors">
                    <td className="px-3 py-2.5 text-sm text-[#202124] font-semibold whitespace-nowrap">
                      {pv.teacherName} 선생님
                      {pv.subject && <span className="ml-1 text-[10px] text-[#5F6368] font-normal">({pv.subject})</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-[#202124]">
                      {pv.keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {pv.keywords.map((kw, j) => (
                            <span key={j} className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-[#E8F0FE] text-[#1A73E8]">
                              {kw}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[#9AA0A6] text-xs">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed">
                      {pv.refinedVision || <span className="text-[#9AA0A6] text-xs">-</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-sm text-[#9AA0A6]">
                    아직 개인 비전이 수집되지 않았습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 팀 공통 비전 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">팀 공통 비전</span>
        </div>
        <div className="px-4 py-4">
          {teamVision ? (
            <p className="text-base font-semibold text-[#202124] leading-relaxed">
              &ldquo;{teamVision}&rdquo;
            </p>
          ) : (
            <p className="text-sm text-[#9AA0A6]">아직 팀 비전이 확정되지 않았습니다</p>
          )}
        </div>
      </div>

      {/* 핵심 키워드 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">핵심 키워드</span>
        </div>
        <div className="px-4 py-3">
          {coreKeywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {coreKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-[#E8F0FE] text-[#1A73E8] border border-[#D2E3FC]"
                >
                  #{kw}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#9AA0A6]">아직 핵심 키워드가 추출되지 않았습니다</p>
          )}
        </div>
      </div>
    </div>
  )
}

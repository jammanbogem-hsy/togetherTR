'use client'

import type { Ds22Structured, Ds22Scaffold, Ds22SupportPlan } from '@/lib/artifacts/schemas'

const SCAFFOLD_HEADERS = ['대상 활동', '스캐폴딩 유형', '구체적 내용', '대상 수준', '점진적 제거 계획'] as const
const SUPPORT_HEADERS = ['지원 방안', '대상 활동'] as const

function LevelBadge({ value }: { value: string }) {
  const v = (value ?? '').trim()
  if (!v) return <span className="text-[#9AA0A6]">-</span>
  const isWhole = v.includes('전체')
  return (
    <span
      className={
        isWhole
          ? 'inline-flex items-center rounded-full bg-[#F1F3F4] px-2.5 py-1 text-[11px] font-bold text-[#5F6368]'
          : 'inline-flex items-center rounded-full bg-[#E8F0FE] px-2.5 py-1 text-[11px] font-bold text-[#1A73E8]'
      }
    >
      {v}
    </span>
  )
}

/** _schema 없는 옛 데이터도 best-effort로 scaffolds/supportPlans/review 추출 */
function normalize(data: Ds22Structured | Record<string, unknown>): {
  scaffolds: Ds22Scaffold[]
  supportPlans: Ds22SupportPlan[]
  review: string
} {
  const d = (data ?? {}) as Record<string, unknown>
  const rawScaffolds = Array.isArray(d.scaffolds) ? d.scaffolds : []
  const scaffolds: Ds22Scaffold[] = rawScaffolds.map(item => {
    const s = (item ?? {}) as Record<string, unknown>
    return {
      targetActivity: typeof s.targetActivity === 'string' ? s.targetActivity : '',
      type: typeof s.type === 'string' ? s.type : '',
      content: typeof s.content === 'string' ? s.content : '',
      level: typeof s.level === 'string' ? s.level : '',
      fadeOut: typeof s.fadeOut === 'string' ? s.fadeOut : '',
    }
  })
  const rawSupport = Array.isArray(d.supportPlans) ? d.supportPlans : []
  const supportPlans: Ds22SupportPlan[] = rawSupport
    .map(item => {
      const p = (item ?? {}) as Record<string, unknown>
      return {
        support: typeof p.support === 'string' ? p.support : '',
        targetActivity: typeof p.targetActivity === 'string' ? p.targetActivity : '',
      }
    })
    .filter(p => p.support.trim() || p.targetActivity.trim())
  const review = typeof d.review === 'string' ? d.review.trim() : ''
  return { scaffolds, supportPlans, review }
}

export function Ds22Renderer({ data }: { data: Ds22Structured | Record<string, unknown> }) {
  const { scaffolds, supportPlans, review } = normalize(data)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">스캐폴딩 계획</span>
        </div>
        {scaffolds.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm border-collapse [word-break:keep-all]">
              <thead className="bg-[#1A73E8]">
                <tr>
                  {SCAFFOLD_HEADERS.map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {scaffolds.map((s, i) => (
                  <tr key={i} className="hover:bg-[#F8F9FA]/50 align-top">
                    <td className="px-3 py-2.5 font-semibold text-[#202124] leading-relaxed min-w-[160px]">{s.targetActivity || '-'}</td>
                    <td className="px-3 py-2.5 text-[#5F6368] whitespace-nowrap">{s.type || '-'}</td>
                    <td className="px-3 py-2.5 text-[#3C4043] leading-relaxed min-w-[260px]">{s.content || '-'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><LevelBadge value={s.level} /></td>
                    <td className="px-3 py-2.5 text-[#5F6368] leading-relaxed min-w-[220px]">{s.fadeOut || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">아직 스캐폴딩이 설계되지 않았습니다</div>
        )}
      </div>

      {supportPlans.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">지원 방안 정리</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm border-collapse [word-break:keep-all]">
              <thead className="bg-[#1A73E8]">
                <tr>
                  {SUPPORT_HEADERS.map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {supportPlans.map((p, i) => (
                  <tr key={i} className="hover:bg-[#F8F9FA]/50 align-top">
                    <td className="px-3 py-2.5 text-[#3C4043] leading-relaxed min-w-[260px]">{p.support || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#202124] leading-relaxed min-w-[160px]">{p.targetActivity || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

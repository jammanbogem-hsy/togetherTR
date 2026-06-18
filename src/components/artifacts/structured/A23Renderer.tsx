'use client'
import type { A23Structured } from '@/lib/artifacts/schemas'

// 학습자·맥락 분석에서 권장하는 점검 항목 (체크리스트). 각 항목이 프로필에 다뤄졌는지 키워드로 판정.
const A23_CHECKLIST: Array<{ label: string; keywords: string[] }> = [
  { label: '선수 지식·기능', keywords: ['선수', '사전', '배경지식', '기초'] },
  { label: '오개념·혼동 지점', keywords: ['오개념', '혼동', '어려움', '오류'] },
  { label: '흥미·동기', keywords: ['흥미', '동기', '관심', '참여'] },
  { label: '환경·자원 제약', keywords: ['환경', '자원', '제약', '여건', '기기', '시설'] },
  { label: '개별 학습자 특성·격차', keywords: ['개별', '격차', '수준차', '특수', '다양'] },
]

export function A23Renderer({ data }: { data: A23Structured }) {
  const commonProfile = data?.commonProfile ?? []
  const teacherNotes = data?.teacherNotes ?? []
  const profileText = commonProfile.map(p => `${p.item} ${p.content}`).join(' ')
  const checklist = A23_CHECKLIST.map(c => ({
    label: c.label,
    covered: c.keywords.some(k => profileText.includes(k)),
  }))

  return (
    <div className="space-y-4">
      {/* 권장 분석 항목 체크리스트 — 무엇을 분석해야 하는지 안내 + 커버 여부 */}
      <div className="rounded-2xl border border-[#E1BEE7] overflow-hidden bg-[#FCF6FF]">
        <div className="px-4 py-2.5 border-b border-[#E1BEE7]">
          <span className="text-[11px] font-bold text-[#7B1FA2] uppercase tracking-wider">학습자·맥락 분석 체크리스트</span>
        </div>
        <div className="px-4 py-3 grid sm:grid-cols-2 gap-x-4 gap-y-2">
          {checklist.map(c => (
            <div key={c.label} className="flex items-center gap-2 text-[12px]">
              <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${c.covered ? 'bg-[#7B1FA2] text-white' : 'border border-[#CBA8D6] text-[#CBA8D6]'}`}>
                {c.covered ? '✓' : ''}
              </span>
              <span className={c.covered ? 'font-semibold text-[#202124]' : 'text-[#9AA0A6]'}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">팀 공통 학습자 프로필</span>
        </div>
        {commonProfile.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm border-collapse [word-break:keep-all]">
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

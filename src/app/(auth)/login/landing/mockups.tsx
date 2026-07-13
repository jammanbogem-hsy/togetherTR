// 경량 CSS 목업 — 전부 장식용(aria-hidden). 실제 스크린샷 미사용(레퍼런스 방식).
import { Check } from 'lucide-react'

// 브라우저 프레임 (신호등 3점 헤더)
export function BrowserFrame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="bg-white rounded-2xl border border-[#E8EAED] md-shadow-2 overflow-hidden">
      <div className="h-8 bg-[#F1F3F4] flex items-center gap-1.5 px-3">
        <span className="w-2.5 h-2.5 rounded-full bg-[#EF9A9A]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#FDE293]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#A8DAB5]" />
        {title && <span className="ml-2 text-[12px] text-[#9AA0A6] truncate">{title}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// 스텝 1 — 로그인 카드 축소 목업
export function LoginMockup() {
  return (
    <BrowserFrame title="T-CID · 로그인">
      <div className="max-w-[240px] mx-auto text-center py-2">
        <div className="w-9 h-9 rounded-2xl bg-[#1A73E8] mx-auto mb-3" />
        <p className="text-[13px] font-bold text-[#202124] mb-2">시작하기</p>
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[#E8EAED] py-2 text-[12px] font-semibold text-[#202124]">
          <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'conic-gradient(#EA4335 0 25%, #4285F4 0 50%, #FBBC05 0 75%, #34A853 0)' }} />
          Google로 시작하기
        </div>
      </div>
    </BrowserFrame>
  )
}

// 스텝 2 — 초대 코드 + 팀원 아바타
export function InviteMockup() {
  const members = [
    { init: '김', bg: '#1A73E8' },
    { init: '이', bg: '#7B1FA2' },
    { init: '박', bg: '#00897B' },
  ]
  return (
    <BrowserFrame title="팀 참여">
      <div className="py-1">
        <p className="text-[12px] text-[#9AA0A6] mb-1.5">초대 코드</p>
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#E8F0FE] px-3 py-1.5 mb-3">
          <span className="text-[14px] font-bold tracking-[0.2em] text-[#1558D6]">TCID-2026</span>
        </div>
        <div className="flex items-center gap-1.5">
          {members.map(m => (
            <span key={m.init} className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[12px] font-bold" style={{ backgroundColor: m.bg }}>
              {m.init}
            </span>
          ))}
          <span className="text-[12px] text-[#5F6368] ml-1.5">3명 참여 중</span>
        </div>
      </div>
    </BrowserFrame>
  )
}

// 스텝 3 — 프로젝트 카드
export function ProjectMockup() {
  return (
    <BrowserFrame title="프로젝트">
      <div className="rounded-xl border border-[#E8EAED] p-3">
        <p className="text-[14px] font-bold text-[#202124] mb-1.5">🌱 우리 마을 환경 프로젝트</p>
        <p className="text-[12px] text-[#5F6368] mb-2.5">초등 5-6학년 · 융합 수업</p>
        <div className="flex gap-1.5">
          {['사회', '과학', '국어'].map(s => (
            <span key={s} className="rounded-full bg-[#F1F3F4] px-2 py-0.5 text-[11px] font-semibold text-[#5F6368]">{s}</span>
          ))}
        </div>
      </div>
    </BrowserFrame>
  )
}

// 스텝 4 — 채팅 1왕복 미니 목업
export function MiniChatMockup() {
  return (
    <BrowserFrame title="T-1 · 공동 비전 설정">
      <div className="space-y-2 py-1">
        <div className="flex justify-end">
          <p className="rounded-2xl bg-[#1A73E8] text-white text-[12px] px-3 py-1.5 max-w-[75%]">비전 만들기부터 시작할까요?</p>
        </div>
        <div className="flex justify-start">
          <p className="rounded-2xl bg-[#F1F3F4] text-[#202124] text-[12px] px-3 py-1.5 max-w-[85%]">
            좋아요! 각자 키워드 3~5개를 먼저 나눠 볼까요? 🙌
          </p>
        </div>
      </div>
    </BrowserFrame>
  )
}

// AI 섹션 — 채팅 목업 (사용자 → AI 초안 → 액션)
export function ChatMockup() {
  return (
    <div aria-hidden="true" className="rounded-2xl border border-[#E8EAED] bg-[#F8F9FA] p-4 md-shadow-2">
      <div className="space-y-3">
        <div className="flex justify-end">
          <p className="rounded-2xl bg-[#1A73E8] text-white text-[14px] leading-relaxed px-4 py-2.5 max-w-[80%]">
            저는 &lsquo;스스로 질문하는 아이&rsquo;가 우리 반 비전이에요.
          </p>
        </div>
        <div className="flex justify-start">
          <div className="rounded-2xl bg-white border border-[#E8EAED] text-[14px] leading-relaxed px-4 py-3 max-w-[90%]">
            <p className="text-[#202124]">좋아요. 세 분의 키워드를 모으면 이런 팀 공통 비전 초안을 만들 수 있어요.</p>
            <p className="mt-2 border-l-2 border-[#AECBFA] pl-3 text-[#1558D6] font-semibold">
              &ldquo;함께 질문하고, 스스로 답을 찾아가는 교실&rdquo;
            </p>
          </div>
        </div>
        <div className="flex gap-2 pl-1">
          <span className="rounded-full bg-[#1A73E8] text-white text-[12px] font-bold px-3 py-1.5">이 안으로</span>
          <span className="rounded-full border border-[#DADCE0] bg-white text-[#5F6368] text-[12px] font-semibold px-3 py-1.5">조금 수정</span>
          <span className="rounded-full text-[#5F6368] text-[12px] font-semibold px-3 py-1.5">다른 안 보기</span>
        </div>
      </div>
    </div>
  )
}

// 협업 섹션 — 3층 미니 카드 스택 (산출물/지식 그래프/보고서)
export function CollabMockup() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {/* 산출물 패널 */}
      <div className="rounded-2xl border border-[#E8EAED] bg-white p-4 md-shadow-1">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[14px] font-bold text-[#202124]">T-1 · 공동 비전 설정</p>
          <span className="flex items-center gap-1 rounded-full bg-[#E6F4EA] text-[#34A853] text-[11px] font-bold px-2 py-0.5">
            <Check className="w-3 h-3" /> 확정됨
          </span>
        </div>
        <div className="space-y-1.5">
          <div className="h-2.5 rounded bg-[#F1F3F4] w-11/12" />
          <div className="h-2.5 rounded bg-[#F1F3F4] w-8/12" />
        </div>
      </div>
      {/* 지식 그래프 */}
      <div className="rounded-2xl border border-[#E8EAED] bg-white p-4 md-shadow-1">
        <p className="text-[12px] font-semibold text-[#9AA0A6] mb-2">지식 그래프 · 성취기준</p>
        <svg viewBox="0 0 220 64" className="w-full h-16">
          <line x1="42" y1="32" x2="110" y2="14" stroke="#DADCE0" strokeWidth="1.5" />
          <line x1="42" y1="32" x2="110" y2="50" stroke="#DADCE0" strokeWidth="1.5" />
          <line x1="110" y1="14" x2="178" y2="32" stroke="#DADCE0" strokeWidth="1.5" />
          <circle cx="42" cy="32" r="11" fill="#1A73E8" />
          <circle cx="110" cy="14" r="8" fill="#E8F0FE" stroke="#AECBFA" />
          <circle cx="110" cy="50" r="8" fill="#F3E5F5" stroke="#CE93D8" />
          <circle cx="178" cy="32" r="8" fill="#E0F2F1" stroke="#80CBC4" />
        </svg>
      </div>
      {/* 보고서 */}
      <div className="rounded-2xl border border-[#E8EAED] bg-white p-4 md-shadow-1">
        <p className="text-[12px] font-semibold text-[#9AA0A6] mb-2">종합 보고서</p>
        <div className="space-y-1.5 mb-3">
          <div className="h-2.5 rounded bg-[#F1F3F4] w-10/12" />
          <div className="h-2.5 rounded bg-[#F1F3F4] w-7/12" />
          <div className="h-2.5 rounded bg-[#F1F3F4] w-9/12" />
        </div>
        <div className="flex gap-1.5">
          {['HWPX', 'PDF', '공유 링크'].map(t => (
            <span key={t} className="rounded-full bg-[#E8F0FE] text-[#1558D6] text-[11px] font-bold px-2.5 py-1">{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// 랜딩 섹션 모음 — 명세서(docs/login-guide-design-spec.md) §3 순서 그대로.
// 서버 컴포넌트(정적 마크업) + 클라이언트 섬(LoginCard·Reveal)만 삽입.
import { LogIn, Users, FolderPlus, Sparkles, RefreshCw, Check, ChevronRight, ChevronDown, ArrowUp, BookOpen } from 'lucide-react'
import LoginCard from '../LoginCard'
import Reveal from './Reveal'
import {
  WORKFLOW_STAGES, TOTAL_ACTIVITIES, START_STEPS, AI_ROLES, PRINCIPLES, COLLAB_FEATURES, FAQ_ITEMS,
} from './content'
import { LoginMockup, InviteMockup, ProjectMockup, MiniChatMockup, ChatMockup, CollabMockup } from './mockups'

const CONTAINER = 'max-w-[1120px] mx-auto px-5 md:px-8'

function SectionHeading({ overline, title, sub, id }: { overline: string; title: string; sub?: string; id: string }) {
  return (
    <div className="text-center mb-10 md:mb-14">
      <p className="overline mb-2">{overline}</p>
      <h2 id={id} className="font-display text-[32px] md:text-[40px] font-bold leading-[1.25] tracking-[-0.01em] text-[#202124]">
        {title}
      </h2>
      {sub && <p className="text-[17px] md:text-[19px] leading-[1.75] text-[#5F6368] mt-3">{sub}</p>}
    </div>
  )
}

// ── 1. Hero + 로그인 카드 ─────────────────────────────
export function HeroSection() {
  const chips = [
    { icon: LogIn, label: 'Google 계정으로 바로 시작' },
    { icon: Users, label: '초대 코드로 팀 참여' },
    { icon: RefreshCw, label: '실시간 공동 편집' },
  ]
  return (
    <section
      id="login"
      aria-labelledby="hero-title"
      className="landing-section relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #EAF2FF 0%, #F8F9FA 50%, #F3E5F5 100%)' }}
    >
      {/* 배경 장식 원 (기존 로그인 페이지에서 이식 — 섹션 내부 한정) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div style={{
          position: 'absolute', top: '-10%', left: '-8%',
          width: '420px', height: '420px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(26,115,232,0.10) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-8%', right: '-6%',
          width: '360px', height: '360px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(123,31,162,0.09) 0%, transparent 70%)',
        }} />
      </div>

      <div className={`${CONTAINER} relative pt-24 pb-16 md:pt-28 md:pb-24`}>
        <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[1fr_minmax(360px,420px)] lg:gap-12 lg:items-center">
          {/* 좌: 카피 (모바일에선 헤드라인 → 카드 → 서브카피 순서) */}
          <div className="contents lg:block">
            <div className="order-1">
              <p className="overline mb-3">함께 만드는 수업 설계</p>
              <h1 id="hero-title" className="font-display text-[clamp(34px,6.5vw,60px)] font-bold leading-[1.18] tracking-[-0.02em] text-[#202124]">
                함께 밭을 일구듯,<br className="hidden md:block" /> 동료와 짓는 수업 설계
              </h1>
            </div>
            <div className="order-3 lg:mt-5">
              <p className="text-[17px] md:text-[19px] leading-[1.75] text-[#5F6368]">
                T-CID 다섯 단계를 따라, 동료 교사들이 한 팀이 되어 한 학기 수업을 함께 설계합니다.
                AI 퍼실리테이터가 활동마다 절차를 안내하고, 초안을 제안하고, 정합성을 점검합니다.
              </p>
              <ul className="flex flex-wrap gap-2 mt-5" aria-label="핵심 특징">
                {chips.map(chip => (
                  <li key={chip.label} className="flex items-center gap-1.5 rounded-full bg-white/80 border border-[#E8EAED] px-3 py-1.5">
                    <chip.icon className="w-4 h-4 text-[#1558D6]" aria-hidden="true" />
                    <span className="text-[13.5px] font-semibold text-[#3C4043]">{chip.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 우: 로그인 카드 (로직 무변경 — showBrand=false로 중복 h1 방지) */}
          <div className="order-2 lg:order-none flex justify-center">
            <LoginCard showBrand={false} />
          </div>
        </div>

        {/* 스크롤 큐 (데스크톱) */}
        <div aria-hidden="true" className="hidden lg:flex justify-center mt-14">
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[#9AA0A6]">
            아래로 내려 살펴보기
            <ChevronDown className="w-4 h-4" style={{ animation: 'chevron-flow 1.6s ease-in-out infinite' }} />
          </span>
        </div>
      </div>
    </section>
  )
}

// ── 2. 4단계 시작 ─────────────────────────────────────
export function StartSection() {
  const icons = [LogIn, Users, FolderPlus, Sparkles]
  const mockups = [LoginMockup, InviteMockup, ProjectMockup, MiniChatMockup]
  return (
    <section id="start" aria-labelledby="start-title" className="landing-section bg-white">
      <div className={`${CONTAINER} py-16 md:py-24`}>
        <SectionHeading
          id="start-title"
          overline="START"
          title="네 걸음이면, 팀이 움직입니다"
          sub="로그인부터 첫 설계 활동까지, 준비는 간단합니다."
        />
        <div className="space-y-12 md:space-y-16">
          {START_STEPS.map((step, i) => {
            const Icon = icons[i]
            const Mockup = mockups[i]
            const reversed = i % 2 === 1
            return (
              <Reveal key={step.no}>
                <div className={`grid md:grid-cols-2 gap-6 md:gap-12 items-center ${reversed ? 'md:[direction:rtl]' : ''}`}>
                  <div className="md:[direction:ltr]">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-12 h-12 rounded-full bg-[#E8F0FE] flex items-center justify-center text-[16px] font-bold text-[#1558D6]">
                        {step.no}
                      </span>
                      <Icon className="w-6 h-6 text-[#1A73E8]" aria-hidden="true" />
                    </div>
                    <h3 className="text-[22px] font-bold text-[#202124] mb-2">{step.title}</h3>
                    <p className="text-[15.5px] leading-[1.75] text-[#5F6368]">{step.desc}</p>
                  </div>
                  <div className="md:[direction:ltr] max-w-[380px] w-full mx-auto">
                    <Mockup />
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── 3. 5과정 워크플로우 ───────────────────────────────
export function WorkflowSection() {
  return (
    <section
      id="workflow"
      aria-labelledby="workflow-title"
      className="landing-section"
      style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #F8F9FA 100%)' }}
    >
      <div className={`${CONTAINER} py-16 md:py-24`}>
        <SectionHeading
          id="workflow-title"
          overline="WORKFLOW"
          title={`다섯 시간의 흐름, ${TOTAL_ACTIVITIES === 19 ? '열아홉' : TOTAL_ACTIVITIES} 개의 활동`}
          sub="밭을 일구는 일부터 열매를 거두는 일까지. 각 단계 안에서 세부 활동을 하나씩 함께 완성합니다."
        />

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {WORKFLOW_STAGES.map((stage, i) => (
            <Reveal key={stage.code} delayMs={i * 80}>
              <div className={`rounded-2xl border p-6 h-full ${stage.color.light} ${stage.color.border}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[14px] font-bold"
                      style={{ backgroundColor: stage.color.hex }}
                    >
                      {stage.code}
                    </span>
                    <h3 className={`text-[17px] font-bold ${stage.color.doneText}`}>{stage.label}</h3>
                  </div>
                  <span className="text-[13.5px] font-semibold" style={{ color: stage.color.hex }}>
                    {stage.activities.length}개 활동
                  </span>
                </div>
                <p className={`font-display text-[16.5px] leading-[1.5] mb-3.5 ${stage.color.doneText}`}>
                  {stage.metaphor}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {stage.activities.map(act => (
                    <li
                      key={act.display}
                      className="flex items-center gap-1.5 rounded-full bg-white/85 border border-[#E8EAED] px-3 py-1.5"
                    >
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color.hex }} />
                      <span className="text-[13.5px] font-semibold text-[#3C4043]">
                        {act.display} · {act.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        {/* 하단 플로우 바 + 다음 주기 순환 */}
        <Reveal className="mt-10">
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-center">
              {WORKFLOW_STAGES.map((stage, i) => (
                <span key={stage.code} className="flex items-center gap-2 md:gap-3">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color.hex }} />
                    <span className={`text-[12.5px] font-bold ${stage.color.doneText}`}>{stage.code} {stage.label}</span>
                  </span>
                  {i < WORKFLOW_STAGES.length - 1 && (
                    <ChevronRight className="w-3.5 h-3.5 text-[#9AA0A6]" aria-hidden="true" />
                  )}
                </span>
              ))}
            </div>
            <div aria-hidden="true" className="flex items-center gap-1.5 mt-1">
              <svg width="120" height="22" viewBox="0 0 120 22" fill="none">
                <path d="M116 4 C 116 18, 4 18, 6 6" stroke="#9AA0A6" strokeWidth="1.5" strokeDasharray="3 3" />
                <path d="M2 10 L6 4 L10 9" stroke="#9AA0A6" strokeWidth="1.5" fill="none" />
              </svg>
              <span className="text-[12.5px] font-semibold text-[#5F6368]">다음 주기</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ── 4. AI 퍼실리테이터 ────────────────────────────────
export function AiFacilitatorSection() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="landing-section bg-white">
      <div className={`${CONTAINER} py-16 md:py-24`}>
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="overline mb-2">AI FACILITATOR</p>
            <h2 id="ai-title" className="font-display text-[32px] md:text-[40px] font-bold leading-[1.25] tracking-[-0.01em] text-[#202124]">
              곁에서 함께 설계하는<br />AI 퍼실리테이터
            </h2>
            <p className="text-[17.5px] leading-[1.8] text-[#5F6368] mt-3 mb-7">
              AI는 정답을 대신 정해주지 않습니다. 팀이 스스로 결정하도록 절차를 안내하고, 초안을 제안하고, 놓친 부분을 짚어줍니다.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {AI_ROLES.map((role, i) => (
                <Reveal key={role.title} delayMs={i * 80}>
                  <div className="rounded-2xl border border-[#E8EAED] bg-white p-5 md-shadow-1 h-full">
                    <p aria-hidden="true" className="text-[28px] leading-none mb-2">{role.emoji}</p>
                    <h3 className="text-[16px] font-bold text-[#202124] mb-1">{role.title}</h3>
                    <p className="text-[14.5px] leading-[1.65] text-[#5F6368]">{role.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delayMs={160}>
            <ChatMockup />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ── 5. 협력 UP 5원리 ─────────────────────────────────
export function PrinciplesSection() {
  return (
    <section id="principles" aria-labelledby="principles-title" className="landing-section bg-[#F8F9FA]">
      <div className={`${CONTAINER} py-16 md:py-24`}>
        <SectionHeading
          id="principles-title"
          overline="PRINCIPLES"
          title="협력이 살아나는 다섯 가지 원리"
          sub="AI 퍼실리테이터는 이 다섯 원리를 기준으로 팀의 협력을 북돋웁니다."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.tag} delayMs={i * 80}>
              <div className="rounded-2xl border border-[#E8EAED] bg-white p-5 md-shadow-1 h-full">
                <p className="text-[12.5px] font-bold text-[#9AA0A6] mb-2">{String(i + 1).padStart(2, '0')}</p>
                <p className="inline-block rounded-full bg-[#E8F0FE] px-3.5 py-1.5 text-[14.5px] font-bold text-[#1558D6] mb-2.5">
                  {p.tag}
                </p>
                <p className="text-[14.5px] leading-[1.7] text-[#5F6368]">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── 6. 협업·산출물·보고서 ─────────────────────────────
export function CollaborationSection() {
  return (
    <section id="collab" aria-labelledby="collab-title" className="landing-section bg-white">
      <div className={`${CONTAINER} py-16 md:py-24`}>
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="overline mb-2">COLLABORATION</p>
            <h2 id="collab-title" className="font-display text-[32px] md:text-[40px] font-bold leading-[1.25] tracking-[-0.01em] text-[#202124]">
              같은 화면에서,<br />함께 쌓는 산출물
            </h2>
            <p className="text-[17.5px] leading-[1.8] text-[#5F6368] mt-3 mb-7">
              채팅·산출물·활동 상태가 실시간으로 동기화됩니다. 논의한 내용은 그대로 기록과 보고서로 남습니다.
            </p>
            <ul className="space-y-4">
              {COLLAB_FEATURES.map(f => (
                <li key={f.title} className="flex gap-3">
                  <span aria-hidden="true" className="mt-0.5 w-6 h-6 rounded-full bg-[#E6F4EA] flex items-center justify-center flex-shrink-0">
                    <Check className="w-3.5 h-3.5 text-[#34A853]" />
                  </span>
                  <p className="text-[15.5px] leading-[1.7] text-[#3C4043]">
                    <strong className="font-bold text-[#202124]">{f.title}</strong> — {f.desc}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <Reveal delayMs={160}>
            <CollabMockup />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ── 7. FAQ ────────────────────────────────────────────
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="landing-section bg-[#F8F9FA]">
      <div className={`${CONTAINER} py-16 md:py-24`}>
        <SectionHeading id="faq-title" overline="FAQ" title="자주 묻는 질문" />
        <div className="max-w-[720px] mx-auto">
          {FAQ_ITEMS.map(item => (
            <details key={item.q} className="faq-item border-b border-[#E8EAED]">
              <summary className="text-[17px] font-bold text-[#202124] py-5 cursor-pointer flex justify-between items-center gap-3 focus-visible:outline-2 focus-visible:outline-[#1A73E8] focus-visible:outline-offset-2 rounded">
                {item.q}
                <ChevronDown className="w-5 h-5 text-[#9AA0A6] flex-shrink-0" aria-hidden="true" />
              </summary>
              <p className="text-[15.5px] text-[#5F6368] leading-[1.75] pb-5">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── 8. 최종 CTA ──────────────────────────────────────
export function FinalCtaSection() {
  return (
    <section
      id="cta"
      aria-labelledby="cta-title"
      className="landing-section"
      style={{ background: 'linear-gradient(135deg, #E8F0FE 0%, #F3E5F5 100%)' }}
    >
      <div className="max-w-[720px] mx-auto px-5 py-20 md:py-28 text-center">
        <h2 id="cta-title" className="font-display text-[32px] md:text-[42px] font-bold leading-[1.3] tracking-[-0.01em] text-[#202124]">
          이제, 우리 팀의 밭을 일굴 차례입니다
        </h2>
        <p className="text-[17.5px] leading-[1.8] text-[#5F6368] mt-3 mb-8">
          Google 계정만 있으면 바로 시작할 수 있습니다.
        </p>
        <a
          href="#login"
          className="morph-btn inline-flex items-center gap-2 px-8 py-4 bg-[#1A73E8] text-white font-bold text-[16.5px] focus-visible:outline-2 focus-visible:outline-[#1A73E8] focus-visible:outline-offset-4"
          style={{ filter: 'drop-shadow(0 4px 14px rgba(26,115,232,0.42))' }}
        >
          바로 로그인하기
          <ArrowUp className="w-4 h-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

// ── 9. 푸터 ──────────────────────────────────────────
export function LandingFooter() {
  return (
    <footer className="bg-[#F1F3F4] py-10 text-center">
      <div className="flex items-center justify-center gap-2 mb-2">
        <span aria-hidden="true" className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#1A73E8]">
          <BookOpen className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
        </span>
        <span className="text-[14.5px] font-bold text-[#3C4043]">T-CID 협력 수업설계</span>
      </div>
      <p className="text-[13.5px] text-[#5F6368]">AI 퍼실리테이터와 함께하는 협력적 수업 설계</p>
      <p className="text-[13.5px] text-[#9AA0A6] mt-1.5">© 2026 T-CID</p>
    </footer>
  )
}

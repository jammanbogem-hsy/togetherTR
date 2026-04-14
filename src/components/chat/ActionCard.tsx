'use client'

/**
 * Phase 1-c: ACTION_CARD UI 컴포넌트
 *
 * 설계 근거: /Users/hongseong-yong/협력적수업설계/verify/04-pedagogy.md §12
 *   - §12-0 설계 철학 (AI의 제안이지 요구가 아님, 원리5 조정 보호)
 *   - §12-3 톤 가이드라인 (skip 필수·가치중립)
 *   - §12-4 에지 케이스 규칙
 *   - §12-7 Phase 1-c 인계 체크리스트
 *
 * flow-integrator(Phase 1-b)가 파싱한 ActionCard 데이터와 UI 맥락(stage/isHost 등)을
 * 조립하여 본 컴포넌트에 props로 전달. 본 컴포넌트는 순수 표현 레이어.
 */

import { useState } from 'react'
import { CheckCircle, ArrowRight } from '@phosphor-icons/react'
import type { ActionCardProps, StageCode } from '@/types'

// 단계별 팔레트 — StageBar.tsx:10-18 과 동일 값.
// 단계 색상 변경 시 두 곳 동기화 필요 (의도적 중복: ActionCard 독립성 우선).
const STAGE_PALETTE: Record<StageCode, {
  bgGradient: string    // 카드 배경 그라데이션
  border: string        // 카드 border 색
  accent: string        // 좌측 강조 바 + intent 아이콘 색
  primaryBg: string     // primary 버튼 배경
  primaryHover: string  // primary 버튼 hover 배경
  intentText: string    // intent 텍스트 색
}> = {
  T:  { bgGradient: 'linear-gradient(135deg, #E8F0FE 0%, #F1F5FC 100%)',
        border: '#AECBFA', accent: '#1A73E8',
        primaryBg: '#1A73E8', primaryHover: '#1558D6', intentText: '#1558D6' },
  A:  { bgGradient: 'linear-gradient(135deg, #F3E5F5 0%, #F8F0F9 100%)',
        border: '#CE93D8', accent: '#7B1FA2',
        primaryBg: '#7B1FA2', primaryHover: '#6A1B9A', intentText: '#6A1B9A' },
  Ds: { bgGradient: 'linear-gradient(135deg, #E0F2F1 0%, #F1F8F7 100%)',
        border: '#80CBC4', accent: '#00897B',
        primaryBg: '#00897B', primaryHover: '#00695C', intentText: '#00695C' },
  DI: { bgGradient: 'linear-gradient(135deg, #FFF3E0 0%, #FFF8F1 100%)',
        border: '#FFAB91', accent: '#E65100',
        primaryBg: '#E65100', primaryHover: '#BF360C', intentText: '#BF360C' },
  E:  { bgGradient: 'linear-gradient(135deg, #FFEBEE 0%, #FCF1F2 100%)',
        border: '#EF9A9A', accent: '#C62828',
        primaryBg: '#C62828', primaryHover: '#B71C1C', intentText: '#B71C1C' },
}

export function ActionCard({
  card,
  stage,
  isHost,
  isSelected,
  selectedLabel,
  onPrimary,
  onSecondary,
  onSkip,
}: ActionCardProps) {
  const palette = STAGE_PALETTE[stage]
  // 낙관적 잠금 — 클릭 즉시 버튼 비활성. Firestore 동기화가 돌아오면 isSelected로 덮어씀.
  const [clicked, setClicked] = useState(false)
  const locked = isSelected || clicked

  const handlePrimary = () => {
    if (locked || !isHost) return
    setClicked(true)
    onPrimary()
  }
  const handleSecondary = () => {
    if (locked || !isHost || !onSecondary) return
    setClicked(true)
    onSecondary()
  }
  const handleSkip = () => {
    if (locked) return
    setClicked(true)
    onSkip()
  }

  // 선택 완료 상태 — 결정 맥락 보존 (카드 유지 + 배지)
  if (isSelected) {
    return (
      <div
        className="mx-0 my-2 rounded-2xl border px-4 py-3 opacity-75"
        style={{ background: palette.bgGradient, borderColor: palette.border, borderLeftWidth: 4, borderLeftColor: palette.accent }}
        role="group"
        aria-label={`행동 제안 (선택 완료): ${card.intent}`}
      >
        <p className="text-[11px] italic text-gray-500 mb-1">💡 {card.intent}</p>
        <div className="inline-flex items-center gap-1.5 bg-white/80 rounded-full px-3 py-1 border" style={{ borderColor: palette.border }}>
          <CheckCircle size={14} weight="fill" style={{ color: palette.accent }} />
          <span className="text-[12px] font-semibold" style={{ color: palette.intentText }}>
            {selectedLabel ? `"${selectedLabel}" 선택됨` : '선택 완료'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="mx-0 my-2 rounded-2xl border px-4 py-3 shadow-sm"
      style={{
        background: palette.bgGradient,
        borderColor: palette.border,
        borderLeftWidth: 4,
        borderLeftColor: palette.accent,
        // globals.css:78 msg-slide-in 재사용 (translateY+opacity 페이드인). 250ms = §12-7 "300ms 이하" 기준 충족.
        animation: 'msg-slide-in 250ms ease-out',
      }}
      role="group"
      aria-label={`행동 제안: ${card.intent}`}
    >
      {/* intent — "AI가 왜 이 제안하는지" 외현화 (원리4) */}
      <p
        className="text-[12px] italic mb-2.5 flex items-start gap-1"
        style={{ color: palette.intentText }}
      >
        <span aria-hidden="true">💡</span>
        <span className="flex-1 leading-snug">{card.intent}</span>
      </p>

      {/* 버튼 그룹 — 모바일 세로 스택, 640px+ 가로 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {/* primary — 채움, 단계 색 */}
        <button
          type="button"
          onClick={handlePrimary}
          disabled={locked || !isHost}
          aria-disabled={locked || !isHost}
          tabIndex={locked || !isHost ? -1 : 0}
          aria-label={`권장 행동: ${card.primary}`}
          title={!isHost ? '방장만 결정할 수 있습니다' : undefined}
          className="transition-transform hover:enabled:scale-[1.02] px-4 py-2 rounded-xl text-white text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: palette.primaryBg,
            boxShadow: !isHost || locked ? 'none' : `0 3px 10px ${palette.primaryBg}55`,
          }}
          onMouseEnter={(e) => { if (!locked && isHost) e.currentTarget.style.background = palette.primaryHover }}
          onMouseLeave={(e) => { if (!locked && isHost) e.currentTarget.style.background = palette.primaryBg }}
        >
          {card.primary}
        </button>

        {/* secondary — 외곽선, 회색. 라벨이 있을 때만 렌더 */}
        {card.secondary && (
          <button
            type="button"
            onClick={handleSecondary}
            disabled={locked || !isHost}
            aria-disabled={locked || !isHost}
            tabIndex={locked || !isHost ? -1 : 0}
            aria-label={`대안 행동: ${card.secondary}`}
            title={!isHost ? '방장만 결정할 수 있습니다' : undefined}
            className="transition-transform hover:enabled:scale-[1.02] px-4 py-2 rounded-xl text-[13px] font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {card.secondary}
          </button>
        )}

        {/* skip — 텍스트 링크 스타일, 가장 약하게. 모바일 맨 아래, 데스크톱 오른쪽. 방장 아니어도 활성 */}
        <button
          type="button"
          onClick={handleSkip}
          disabled={locked}
          aria-disabled={locked}
          tabIndex={locked ? -1 : 0}
          aria-label={`건너뛰기: ${card.skip}`}
          className="transition-transform hover:enabled:scale-[1.02] sm:ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 hover:border-gray-400 bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowRight size={12} weight="bold" />
          <span>{card.skip}</span>
        </button>
      </div>

      {/* 방장 아님 안내 — primary/secondary disabled 이유 명시 */}
      {!isHost && (
        <p className="text-[10px] text-gray-400 mt-2">
          방장만 결정할 수 있습니다. 본인 차원의 건너뛰기는 가능합니다.
        </p>
      )}
    </div>
  )
}

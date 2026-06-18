'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, type StageCode, type StageStatus, type ActivityCode } from '@/types'
import { isEffectivelyDone as checkEffectivelyDone } from '@/lib/activity/completion'
import { cn } from '@/lib/utils'
import { STAGE_COLOR } from '@/lib/ui/stageColors'
import { UsersThree, ChartLineUp, PencilRuler, RocketLaunch, Trophy, Check, Shield, ArrowsClockwise, type Icon } from '@phosphor-icons/react'

const STAGE_MORPH_DELAY: Record<StageCode, string> = {
  T: '0s', A: '-2.8s', Ds: '-5.6s', DI: '-8.4s', E: '-11.2s',
}

const STAGE_ICONS: Record<StageCode, Icon> = {
  T:  UsersThree,
  A:  ChartLineUp,
  Ds: PencilRuler,
  DI: RocketLaunch,
  E:  Trophy,
}

// ─── 가드레일 뱃지 (Ds 노드 위에 표시) ──────────────────────
function GuardrailBadge({ summary }: { summary: string | null }) {
  return (
    <div className="absolute -top-1.5 -right-1.5 z-20 group/badge">
      <div
        className="w-5 h-5 rounded-full bg-[#7B1FA2] flex items-center justify-center shadow-md ring-2 ring-white cursor-help"
        style={{ animation: 'guardrail-pulse 2.4s ease-in-out infinite' }}
      >
        <Shield size={11} weight="fill" className="text-white" />
      </div>
      {/* hover tooltip */}
      <div className="pointer-events-none opacity-0 group-hover/badge:opacity-100 transition-opacity duration-150 absolute top-7 right-0 w-64 z-30">
        <div className="bg-[#202124] text-white text-[11px] leading-relaxed rounded-md shadow-xl p-3">
          <div className="font-bold text-[#CE93D8] mb-1 flex items-center gap-1.5">
            <Shield size={12} weight="fill" />
            가드레일 (A-2-3 학습자·맥락 분석)
          </div>
          {summary ? (
            <div className="whitespace-pre-wrap line-clamp-6 text-white/90">{summary}</div>
          ) : (
            <div className="text-white/60 italic">A-2-3 산출물이 비어 있습니다</div>
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes guardrail-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(123,31,162,0.55); }
          50%      { box-shadow: 0 0 0 6px rgba(123,31,162,0); }
        }
      `}</style>
    </div>
  )
}

// ─── E→T 순환 화살표 (단계들 위로 호선) ───────────────────────
function CycleArrow({
  containerRef,
  fromRef,
  toRef,
  onLabelClick,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  fromRef: React.RefObject<HTMLDivElement | null>
  toRef: React.RefObject<HTMLDivElement | null>
  onLabelClick: () => void
}) {
  const [geom, setGeom] = useState<{
    width: number
    height: number
    pathD: string
    labelX: number
    labelY: number
  } | null>(null)

  useLayoutEffect(() => {
    function measure() {
      const c = containerRef.current
      const f = fromRef.current
      const t = toRef.current
      if (!c || !f || !t) return
      const cb = c.getBoundingClientRect()
      const fb = f.getBoundingClientRect()
      const tb = t.getBoundingClientRect()

      // 화살표 끝점은 노드 상단 중앙
      const fromX = fb.left - cb.left + fb.width / 2
      const fromY = fb.top  - cb.top
      const toX   = tb.left - cb.left + tb.width / 2
      const toY   = tb.top  - cb.top

      // 호선의 정점은 단계들 위쪽 (pt-12 영역 활용)
      // Task #35: 노드 크기 원래(56/40/36)로 롤백에 맞춰 archHeight 40→38 (원래 값).
      const archHeight = 38
      const cpY = Math.min(fromY, toY) - archHeight
      const cpX = (fromX + toX) / 2

      // bezier: M from C cp1 cp2 to (단순 quadratic curve)
      const pathD = `M ${fromX} ${fromY} Q ${cpX} ${cpY}, ${toX} ${toY}`

      setGeom({
        width: cb.width,
        height: cb.height,
        pathD,
        labelX: cpX,
        labelY: cpY + 8,
      })
    }
    measure()
    const id = window.setTimeout(measure, 50)
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('resize', measure)
    }
  }, [containerRef, fromRef, toRef])

  if (!geom) return null

  return (
    <>
      <svg
        className="absolute inset-0 pointer-events-none"
        width={geom.width}
        height={geom.height}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <marker
            id="cycle-arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#34A853" />
          </marker>
        </defs>
        {/* 배경 그림자 */}
        <path
          d={geom.pathD}
          fill="none"
          stroke="rgba(52,168,83,0.15)"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {/* 본 경로: dashed flow */}
        <path
          d={geom.pathD}
          fill="none"
          stroke="#34A853"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="8 6"
          markerEnd="url(#cycle-arrowhead)"
          style={{ animation: 'cycle-dash-flow 1.6s linear infinite' }}
        />
      </svg>
      {/* 클릭 가능한 라벨 */}
      <button
        type="button"
        onClick={onLabelClick}
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full bg-white border border-[#34A853] text-[#1E8E3E] text-[11px] font-bold shadow-sm hover:bg-[#34A853] hover:text-white active:scale-95 transition-all duration-150 flex items-center gap-1"
        style={{ left: geom.labelX, top: geom.labelY }}
        title="E→T 순환: 새로운 주기를 시작합니다"
      >
        <ArrowsClockwise size={11} weight="bold" />
        새로운 주기 시작
      </button>
      <style jsx>{`
        @keyframes cycle-dash-flow {
          to { stroke-dashoffset: -28; }
        }
      `}</style>
    </>
  )
}

function StageChip({
  stage, status, isCurrent, completedCount, totalCount, onClick, showGuardrail, guardrailSummary,
}: {
  stage: typeof STAGES[number]
  status: StageStatus
  isCurrent: boolean
  completedCount: number
  totalCount: number
  onClick: () => void
  showGuardrail?: boolean
  guardrailSummary?: string | null
}) {
  const color = STAGE_COLOR[stage.code]
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const isDone = status === 'completed'
  const StageIcon = STAGE_ICONS[stage.code]
  const delay = STAGE_MORPH_DELAY[stage.code]

  // Task #31 수직 정렬: 모든 단계의 "노드 슬롯"을 고정 높이 + items-center로 정렬.
  // Task #35: 노드 크기 원래(56/40/36)로 롤백 — 슬롯도 h-16 → h-14(56px)로 재조정.
  // 활성/완료/미진행 모두 노드 수평 중심선 통일(최대 노드 56px에 맞춤).
  const NODE_SLOT = 'h-14 flex items-center justify-center'

  if (isCurrent) {
    return (
      <button onClick={onClick} className="flex flex-col items-center gap-1 select-none group">
        <div className={cn('relative', NODE_SLOT)}>
          <div
            className={cn('relative w-14 h-14 flex items-center justify-center overflow-hidden', color.bg)}
            style={{
              animation: `morph-shape 7s ease-in-out ${delay} infinite, stage-bounce 2.8s ease-in-out 0s infinite`,
              filter: `drop-shadow(0 4px 14px ${color.pulse})`,
            }}
          >
            <div className="absolute bottom-0 left-0 right-0 bg-white/20 transition-all duration-700"
              style={{ height: `${progressPct}%` }} />
            <StageIcon size={28} weight="fill" className="text-white relative z-10" />
          </div>
          {showGuardrail && <GuardrailBadge summary={guardrailSummary ?? null} />}
        </div>
        <span className="text-[12px] font-extrabold text-[#202124] leading-tight">{stage.label}</span>
        <span className="text-[10px] font-semibold text-[#9AA0A6] tabular-nums -mt-0.5">{completedCount}/{totalCount}</span>
      </button>
    )
  }

  if (isDone) {
    return (
      <button onClick={onClick} title="클릭해서 이 단계로 돌아가기"
        className="flex flex-col items-center gap-1 select-none hover:scale-105 active:scale-95 transition-transform duration-150"
      >
        <div className={cn('relative', NODE_SLOT)}>
          <div
            className={cn('w-11 h-11 flex items-center justify-center relative', color.done)}
            style={{ animation: `morph-shape 9s ease-in-out ${delay} infinite` }}
          >
            <StageIcon size={22} weight="fill" className={color.doneText} />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#34A853] flex items-center justify-center shadow">
              <Check size={9} weight="bold" className="text-white" />
            </div>
          </div>
          {showGuardrail && <GuardrailBadge summary={guardrailSummary ?? null} />}
        </div>
        <span className={cn('text-[11px] font-bold', color.doneText)}>{stage.label}</span>
      </button>
    )
  }

  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1 select-none opacity-60 hover:opacity-85 active:scale-95 transition-all duration-200"
    >
      <div className={cn('relative', NODE_SLOT)}>
        <div className={cn('w-9 h-9 flex items-center justify-center', color.done)}
          style={{ animation: `morph-shape 11s ease-in-out ${delay} infinite` }}>
          <StageIcon size={17} weight="fill" className={color.doneText} />
        </div>
        {showGuardrail && <GuardrailBadge summary={guardrailSummary ?? null} />}
      </div>
      <span className={cn('text-[10px] font-semibold', color.doneText)}>{stage.label}</span>
    </button>
  )
}

// 단계 사이 연결 화살표
function StageConnector({ active }: { active: boolean }) {
  // Task #31: 노드 슬롯 중심선에 connector 정렬.
  // Task #35: chevron 20px + gap-1 + 슬롯 h-14 (시각 흐름 강조).
  // Task #36: Task #33 반응형 분포(flex-1/min/max-w) 롤백 — flex-shrink-0 + 자연 폭으로 복귀. 사용자 피드백("간격도 원래대로").
  return (
    <div className="h-14 flex items-center justify-center gap-1 flex-shrink-0">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={cn('text-[20px] font-black leading-none select-none transition-colors',
            active ? 'text-[#34A853]' : 'text-[#AECBFA]')}
          style={{ animation: `chevron-flow 1.4s ease-in-out ${i * 0.38}s infinite` }}
        >›</span>
      ))}
    </div>
  )
}

// A-2-3 산출물에서 학습자 프로필 요약을 추출
function summarizeA23(content: Record<string, unknown> | undefined): string | null {
  if (!content) return null
  const entries = Object.entries(content).filter(([, v]) => {
    if (v == null) return false
    if (typeof v === 'string') return v.trim().length > 0
    if (Array.isArray(v)) return v.length > 0
    return true
  })
  if (entries.length === 0) return null
  return entries
    .slice(0, 4)
    .map(([k, v]) => {
      const value = Array.isArray(v)
        ? v.join(', ')
        : typeof v === 'string'
          ? v
          : JSON.stringify(v)
      return `· ${k}: ${value}`
    })
    .join('\n')
}

export function StageBar() {
  const { project, activityStatus, setPendingStageMove, userProfile } = useProjectStore()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const eNodeRef = useRef<HTMLDivElement | null>(null)
  const tNodeRef = useRef<HTMLDivElement | null>(null)

  // 모든 hooks는 early return 전에 호출되어야 함
  const [, forceRerender] = useState(0)
  useEffect(() => {
    // 폰트/이미지 로드 후 SVG 좌표 재계산 트리거
    const id = window.setTimeout(() => forceRerender(n => n + 1), 100)
    return () => window.clearTimeout(id)
  }, [project?.id])

  if (!project) return null

  const isHost = project.hostUid === userProfile?.uid || project.createdBy === userProfile?.uid
  const currentStage = project.currentStage

  function getStageStatus(stageCode: StageCode): StageStatus {
    const info = STAGES.find(s => s.code === stageCode)!
    if (info.activities.every(a => isEffectivelyDone(a))) return 'completed'
    if (stageCode === currentStage) return 'in_progress'
    if (info.activities.some(a => (activityStatus[a] ?? 'not_started') !== 'not_started')) return 'in_progress'
    return 'not_started'
  }

  function isEffectivelyDone(code: ActivityCode) {
    // P1-I: 중앙화된 헬퍼로 위임 (E 단계 requiredSections 검증 포함).
    // non-E 활동은 기존 로직과 동일하게 작동(회귀 없음).
    return checkEffectivelyDone(code, activityStatus, project?.artifacts)
  }

  function getCompletedCount(stageCode: StageCode) {
    return STAGES.find(s => s.code === stageCode)!.activities
      .filter(a => isEffectivelyDone(a)).length
  }

  // 가드레일: A-2-3 산출물이 있으면 Ds 노드에 표시
  const a23Artifact = project.artifacts?.['A-2-3']
  const hasGuardrail = !!a23Artifact && summarizeA23(a23Artifact.content as Record<string, unknown> | undefined) !== null
  const guardrailSummary = hasGuardrail ? summarizeA23(a23Artifact!.content as Record<string, unknown> | undefined) : null

  // E→T 순환 화살표: E 단계가 모두 완료되었거나 isECompleted true일 때
  const eStage = STAGES.find(s => s.code === 'E')!
  const eAllDone = eStage.activities.every(a => isEffectivelyDone(a))
  const canOpenCycleMove = currentStage !== 'T'
  const showCycleArrow = canOpenCycleMove && (eAllDone || project.isECompleted === true)

  return (
    // Task #31: items-start로 변경 — 모든 컬럼이 top 정렬되고, 각 컬럼 첫 요소가 노드 슬롯이라 노드 수평선 자동 통일.
    // (활성 단계의 sub-label "0/5"이 컬럼 하단에 추가되어도 노드 위치는 영향 없음.)
    // Task #36: Task #33 max-w-5xl + w-full + mx-auto + gap-0 롤백 — 자연 cluster + gap-2로 복귀. 사용자 피드백("간격도 원래대로").
    <div ref={containerRef} className="relative flex items-start justify-center gap-2 px-4 pt-12">
      {STAGES.map((stage, idx) => {
        const nextStage = STAGES[idx + 1]
        const nextStarted = nextStage ? getStageStatus(nextStage.code) !== 'not_started' : false
        const nodeRef =
          stage.code === 'T' ? tNodeRef
          : stage.code === 'E' ? eNodeRef
          : undefined
        return (
          // Task #31: chip 컬럼과 connector도 top 정렬 — 활성 단계 컬럼이 sub-label로 길어져도 connector 위치 영향 없음.
          // Task #36: Task #33 flex-1/last:flex-none 롤백 — 자연 폭으로 복귀. 사용자 피드백("간격도 원래대로").
          <div key={stage.code} className="flex items-start gap-2">
            <div ref={nodeRef}>
              <StageChip
                stage={stage}
                status={getStageStatus(stage.code)}
                isCurrent={stage.code === currentStage}
                completedCount={getCompletedCount(stage.code)}
                totalCount={stage.activities.length}
                onClick={() => { if (isHost && stage.code !== currentStage) setPendingStageMove(stage.code) }}
                showGuardrail={stage.code === 'Ds' && hasGuardrail}
                guardrailSummary={guardrailSummary}
              />
            </div>
            {idx < STAGES.length - 1 && <StageConnector active={nextStarted} />}
          </div>
        )
      })}
      {showCycleArrow && (
        <CycleArrow
          containerRef={containerRef}
          fromRef={eNodeRef}
          toRef={tNodeRef}
          onLabelClick={() => { if (isHost && canOpenCycleMove) setPendingStageMove('T') }}
        />
      )}
    </div>
  )
}

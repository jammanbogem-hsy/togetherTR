'use client'

import { useState } from 'react'
import { useProjectStore } from '@/store/project'
import { STAGES, ACTIVITY_META, type ActivityCode, type StageStatus } from '@/types'
import { setProjectActivity, setAnalysisOpen } from '@/lib/firebase/projects'
import { isEffectivelyDone as checkEffectivelyDone } from '@/lib/activity/completion'
import { cn } from '@/lib/utils'
import {
  UsersThree, ChartLineUp, PencilRuler, RocketLaunch, Trophy,
  CheckCircle, Warning, Clock, Shield, Star, CaretRight, ChartBar, Crown, ArrowBendUpLeft, type Icon,
} from '@phosphor-icons/react'
import { StageAnalysisModal } from '@/components/modals/StageAnalysisModal'

const STAGE_ICON_MAP: Record<string, Icon> = {
  T:  UsersThree,
  A:  ChartLineUp,
  Ds: PencilRuler,
  DI: RocketLaunch,
  E:  Trophy,
}

const STAGE_COLOR: Record<string, { bg: string; text: string; light: string; border: string; pulse: string; corner: string }> = {
  T:  { bg: 'bg-[#1A73E8]', text: 'text-[#1A73E8]', light: 'bg-[#E8F0FE]', border: 'border-[#AECBFA]', pulse: 'rgba(26,115,232,0.35)',  corner: 'rgba(26,115,232,0.13)'  },
  A:  { bg: 'bg-[#7B1FA2]', text: 'text-[#7B1FA2]', light: 'bg-[#F3E5F5]', border: 'border-[#CE93D8]', pulse: 'rgba(123,31,162,0.35)', corner: 'rgba(123,31,162,0.11)'  },
  Ds: { bg: 'bg-[#00897B]', text: 'text-[#00897B]', light: 'bg-[#E0F2F1]', border: 'border-[#80CBC4]', pulse: 'rgba(0,137,123,0.35)',  corner: 'rgba(0,137,123,0.11)'   },
  DI: { bg: 'bg-[#E65100]', text: 'text-[#E65100]', light: 'bg-[#FBE9E7]', border: 'border-[#FFAB91]', pulse: 'rgba(230,81,0,0.35)',   corner: 'rgba(230,81,0,0.11)'    },
  E:  { bg: 'bg-[#C62828]', text: 'text-[#C62828]', light: 'bg-[#FFEBEE]', border: 'border-[#EF9A9A]', pulse: 'rgba(198,40,40,0.35)',  corner: 'rgba(198,40,40,0.11)'   },
}

// 활동별 개념 안내 (선택된 활동에 맞는 안내 박스 표시)
const ACTIVITY_INFO: Partial<Record<string, { title: string; body: string; example: string }>> = {
  'T-1-1': {
    title: '💡 팀 비전이란?',
    body: '우리 팀이 이 수업을 통해 궁극적으로 실현하고자 하는 교육 목적입니다. 단순한 수업 목표가 아니라, 학생에게 어떤 변화·경험·역량을 만들어주고 싶은지를 담은 한 문장입니다.\n이 비전은 A~E 단계에서 의견이 엇갈릴 때마다 돌아오는 기준이 됩니다.',
    example: '예: "학생들이 협력하여 실생활 문제를 해결하는 경험을 만드는 교육"',
  },
  'T-1-2': {
    title: '🧭 수업설계 방향이란?',
    body: '비전을 실현하기 위해 어떤 교수학습 전략과 방향을 지향할 것인지에 대한 합의입니다.\n교과 범위·성취기준·도구 선정은 이후 단계(A, Ds)에서 다룹니다.',
    example: '예: "학생 주도 프로젝트 기반 학습, 과정 중심 평가 중심"',
  },
  'T-2-1': {
    title: '👥 역할 분담이란?',
    body: '설계팀이 원활하게 협력하기 위해 각 교사가 맡을 역할을 사전에 합의합니다.\n고정 역할(사회자, 기록자 등)과 활동별 순환 역할을 구분하면 책임 사각지대를 없앨 수 있습니다.',
    example: '예: 사회자·촉진자 / 기록자 / 자료조사·편집 / 피드백 담당',
  },
  'T-2-2': {
    title: '📋 팀 규칙이란?',
    body: '안전하고 효율적인 논의를 위한 팀 그라운드 룰입니다.\n규칙마다 위반 시 조치 방법도 함께 정해두면 실제 갈등 상황에서 기준이 됩니다.',
    example: '예: "발언 중 끼어들지 않기 / 마감 전날까지 공유"',
  },
  'T-2-3': {
    title: '🗓 팀 일정 협의란?',
    body: '수업설계의 각 단계(팀준비→분석→설계→개발·실행→평가)를 언제까지 완료할지 팀이 함께 현실적인 목표 날짜를 정하는 활동입니다.\n무리한 일정보다 실제로 지킬 수 있는 일정이 훨씬 중요합니다.',
    example: '예: "분석 단계는 4월 말까지, 설계는 5월 중순까지"',
  },

  // ── 분석(A) 단계 ──────────────────────────────────────
  'A-1-2': {
    title: '🎯 주제 선정이란?',
    body: '융합 수업의 출발점이 되는 핵심 주제를 팀이 함께 결정하는 활동입니다.\n좋은 주제는 두 가지 조건을 갖춥니다: ① 학생의 실생활과 연결되고, ② 여러 교과가 자연스럽게 만나는 맥락이 있어야 합니다.\n이 주제는 이후 성취기준 분석·문제상황 개발의 방향을 결정합니다.',
    example: '예: "우리 동네 환경 문제", "디지털 리터러시와 미디어 비판"',
  },
  'A-2-1': {
    title: '📐 핵심아이디어 및 성취기준 분석이란?',
    body: '선정한 주제와 연결되는 교과별 핵심아이디어와 성취기준을 분석하는 활동입니다.\n각 교과에서 이 수업을 통해 학생이 도달해야 할 목표를 명확히 하고, 교과 간 연결고리를 찾습니다.\n이 분석이 통합 수업목표와 평가 계획의 토대가 됩니다.',
    example: '예: 사회-환경 성취기준 + 과학-생태계 성취기준의 연결점 찾기',
  },
  'A-2-2': {
    title: '🎓 통합 수업목표 진술이란?',
    body: '여러 교과의 성취기준을 하나의 통합된 수업목표 문장으로 진술하는 활동입니다.\n"학생은 ~을 통해 ~할 수 있다"의 형식으로, 교과를 넘나드는 공통 역량이 드러나야 합니다.\n이 목표 문장이 설계(Ds) 단계에서 평가와 활동을 설계하는 기준이 됩니다.',
    example: '예: "학생은 지역 환경 문제를 탐구하고 해결 방안을 제안하는 보고서를 작성할 수 있다"',
  },
  'A-2-3': {
    title: '🔍 학습자·맥락 분석이란?',
    body: '우리 학생들의 사전 지식, 흥미, 생활 맥락을 팀이 함께 분석하는 활동입니다.\n이 정보는 이후 문제상황을 실감 나게 만들고 스캐폴딩을 맞춤 설계하는 데 직접 활용됩니다.\n분석 결과는 설계 단계 내내 "가드레일"로 참조합니다.',
    example: '예: "우리 반 학생들은 환경 뉴스에 관심은 높지만 데이터 읽기에 어려움을 느낌"',
  },

  // ── 설계(Ds) 단계 ─────────────────────────────────────
  'Ds-1-1': {
    title: '📊 평가 계획 수립이란?',
    body: 'T-CID는 백워드 설계(Backward Design)를 따릅니다. 즉, 활동을 먼저 정하지 않고 "어떻게 학생의 성취를 확인할 것인가"를 먼저 설계합니다.\n수행과제·평가기준(루브릭)·피드백 방법을 이 단계에서 결정하면, 이후 활동 설계가 평가와 자연스럽게 정렬됩니다.',
    example: '예: "환경 문제 해결 보고서 + 4단계 루브릭 (자료 수집·분석·제안·표현)"',
  },
  'Ds-1-2': {
    title: '🌍 문제상황 개발이란?',
    body: '학생이 수업에 몰입할 수 있도록 실생활 맥락의 문제 시나리오를 개발하는 활동입니다.\n좋은 문제상황은 ① 학생의 삶과 연결되고, ② 정답이 하나가 아니며, ③ 여러 교과 지식이 필요한 구조여야 합니다.\n학습자·맥락 분석(A-2-3) 결과를 반드시 반영해야 합니다.',
    example: '예: "우리 마을 하천이 오염되고 있습니다. 원인을 조사하고 주민 설득 자료를 만들어보세요"',
  },
  'Ds-1-3': {
    title: '🗺 학습활동 설계란?',
    body: '평가 계획과 문제상황을 바탕으로 학생이 경험할 학습활동의 흐름을 설계하는 활동입니다.\n도입-전개-정리의 흐름 안에서 각 활동이 평가 목표와 어떻게 연결되는지 확인해가며 설계합니다.\n활동의 순서·시간 배분·교사 역할도 함께 계획합니다.',
    example: '예: "① 문제 제시(1차시) → ② 모둠 탐구(2-3차시) → ③ 해결안 발표(4차시)"',
  },
  'Ds-2-1': {
    title: '🛠 지원 도구 설계란?',
    body: '학생의 학습을 돕기 위한 교사 제작 자료·디지털 도구·참고 자원을 설계하는 활동입니다.\n어떤 도구가 어느 활동 단계에서 어떤 목적으로 사용되는지 명확히 계획해야 합니다.\n핵심 활동과 직접 연결된 도구를 선택하는 것이 과도한 도구 나열보다 중요합니다.',
    example: '예: 탐구 기록지, 구글 폼 자기평가, 패들렛 공유보드, 환경부 데이터 링크',
  },
  'Ds-2-2': {
    title: '🪜 스캐폴딩 설계란?',
    body: '학생들이 과제를 스스로 해결할 수 있도록 단계적으로 제공하는 지원 구조를 설계하는 활동입니다.\n학습자 분석(A-2-3)에서 파악한 어려움 지점을 중심으로, 누구에게·언제·어떤 도움을 줄지 계획합니다.\n너무 많은 지원은 학생 사고를 대신하게 되므로 "적절한 도전 수준" 유지가 핵심입니다.',
    example: '예: 어려움 예상 지점 → 힌트 카드 준비 / 모둠 역할 카드 / 단계별 안내 질문',
  },

  // ── 개발·실행(DI) 단계 ────────────────────────────────
  'DI-1-1': {
    title: '🔎 자료 탐색·개발이란?',
    body: '설계한 수업을 실제로 실행하기 위해 필요한 자료를 탐색하고 직접 개발하는 활동입니다.\n기존 자료를 그대로 쓰기보다 우리 학생·맥락에 맞게 수정·재구성하는 것이 핵심입니다.\n개발한 자료는 팀 전체가 검토하여 완성도를 높입니다.',
    example: '예: 탐구 활동지 제작, 예시 답안 작성, 영상 클립 선별, 평가 루브릭 최종화',
  },
  'DI-2-1': {
    title: '📝 수업 기록이란?',
    body: '수업 실행 중 관찰한 학생 반응, 예상치 못한 상황, 교사의 즉각적인 판단을 기록하는 활동입니다.\n기록은 평가(E) 단계의 성찰 자료가 되며, 다음 주기 설계를 개선하는 가장 중요한 근거입니다.\n영상·사진·현장 메모 등 다양한 방식으로 남겨두세요.',
    example: '예: "3모둠이 자료 해석에서 막힘 → 힌트 카드 추가 필요" / 학생 발화 기록',
  },

  // ── 평가(E) 단계 ──────────────────────────────────────
  'E-1-1': {
    title: '🪞 수업 성찰·평가란?',
    body: '실행한 수업을 교사 팀이 함께 돌아보며 성찰하는 활동입니다.\n"무엇이 잘 됐는가", "무엇이 어려웠는가", "다음에 어떻게 바꿀 것인가"를 증거 기반으로 논의합니다.\n수업 기록(DI-2-1)을 함께 펼쳐놓고 에피소드 중심으로 이야기하면 더 깊은 성찰이 됩니다.',
    example: '예: "2차시 모둠 탐구에서 시간이 부족했음 → 다음에는 사전 자료 제공 필요"',
  },
  'E-2-1': {
    title: '🤝 팀 활동 성찰·평가란?',
    body: '수업 내용이 아닌 팀 협력 과정 자체를 돌아보는 활동입니다.\n역할 분담이 잘 됐는지, 의사결정이 공정하게 이루어졌는지, 다음 협력을 위해 무엇을 개선할지 논의합니다.\n이 성찰이 다음 T-CID 주기의 팀준비 단계를 더 탄탄하게 만듭니다.',
    example: '예: "기록 역할이 한 사람에게 집중됨 → 다음에는 순환 역할 적용"',
  },
}

const STAGE_GUIDE: Record<string, { goal: string; teamTasks: string[] }> = {
  T: {
    goal: '팀이 하나의 방향으로 정렬되는 단계',
    teamTasks: ['공통 비전과 목표를 함께 만들어요', '각자의 역할을 명확히 정해요', '함께 일하는 규칙을 합의해요'],
  },
  A: {
    goal: '수업의 뼈대가 될 분석을 완성하는 단계',
    teamTasks: ['주제와 성취기준을 함께 검토해요', '학습자 특성을 팀이 함께 파악해요', '이 단계 산출물이 설계 가드레일이 됩니다'],
  },
  Ds: {
    goal: '평가를 먼저 설계하고 활동을 채우는 단계',
    teamTasks: ['평가계획을 먼저 확정해요', '학습자 프로필을 모든 설계에 반영해요', '활동-평가 정합성을 함께 확인해요'],
  },
  DI: {
    goal: '설계를 실제 수업으로 구현하는 단계',
    teamTasks: ['자료를 함께 탐색하고 개발해요', '수업 중 관찰을 꼼꼼히 기록해요', '예상치 못한 반응도 메모해두세요'],
  },
  E: {
    goal: '성찰로 다음 주기를 준비하는 단계',
    teamTasks: ['수업 에피소드를 함께 돌아봐요', '팀 협력의 강점과 개선점을 나눠요', '다음 주기의 씨앗을 이 단계에서 심어요'],
  },
}

function ActivityItem({ code, isViewing, isHostCurrent, isHost, status, hasArtifact, artifactConfirmed, index, onClick }: {
  code: ActivityCode; isViewing: boolean; isHostCurrent: boolean; isHost: boolean
  status: StageStatus; hasArtifact: boolean; artifactConfirmed: boolean; index: number; onClick: () => void
}) {
  const meta = ACTIVITY_META[code]

  // 산출물 확정됐거나, 건너뜀(warning) + 산출물 있으면 완료로 간주
  const effectiveStatus: StageStatus = artifactConfirmed || (status === 'warning' && hasArtifact) ? 'completed' : status

  let StatusIconComp: Icon | null = null
  let statusColor = 'text-[#9AA0A6]'
  if (effectiveStatus === 'completed') { StatusIconComp = CheckCircle; statusColor = 'text-[#34A853]' }
  else if (effectiveStatus === 'warning') { StatusIconComp = Warning; statusColor = 'text-[#F9AB00]' }
  else if (effectiveStatus === 'active_return') { StatusIconComp = ArrowBendUpLeft; statusColor = 'text-[#E65100]' }
  else if (effectiveStatus === 'in_progress' || isViewing) { StatusIconComp = Clock; statusColor = 'text-[#1A73E8]' }

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150',
        isViewing
          ? 'bg-[#E8F0FE] shadow-sm'
          : isHostCurrent && !isHost
            ? 'bg-[#FFF8E1] hover:bg-[#FFF3CD]'
            : 'hover:bg-[#F1F3F4] text-[#5F6368]',
        isViewing && 'activity-glow'
      )}
    >
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0',
        isViewing ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#9AA0A6]'
      )}>
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn('text-[13px] leading-tight truncate',
          isViewing ? 'font-bold text-[#1A73E8]' : 'font-medium text-[#3C4043]'
        )}>
          {meta.label}
        </p>
        {!isViewing && effectiveStatus === 'warning' && (
          <p className="text-[11px] text-[#F9AB00] mt-0.5">건너뜀</p>
        )}
        {effectiveStatus === 'active_return' && (
          <p className="text-[11px] text-[#E65100] mt-0.5">재검토 중</p>
        )}
        {isHostCurrent && !isHost && !isViewing && (
          <p className="text-[11px] text-[#E65100] mt-0.5 flex items-center gap-1">
            <Crown size={10} weight="fill" className="inline" />
            <span>방장 진행 중</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {meta.isGuardrailSource && (
          <Shield size={16} weight="fill" className="text-[#7B1FA2]" />
        )}
        {meta.isBackwardDesignFirst && (
          <Star size={16} weight="fill" className="text-[#F9AB00]" />
        )}
        {/* 방장 현재 위치 표시 */}
        {isHostCurrent && !isHost && (
          <Crown size={14} weight="fill" className="text-[#F9AB00]" />
        )}
        {StatusIconComp && (
          <StatusIconComp size={16} weight="fill" className={statusColor} />
        )}
        {isViewing && (
          <CaretRight size={16} weight="regular" className="text-[#1A73E8]" />
        )}
      </div>
    </button>
  )
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none"
          style={{ minWidth: '220px' }}>
          <div className="bg-[#202124] text-white text-[11px] font-medium rounded-xl px-3 py-2.5 leading-snug shadow-lg">
            {text}
          </div>
          <div className="w-2 h-2 bg-[#202124] rotate-45 ml-3 -mt-1" />
        </div>
      )}
    </div>
  )
}

export function ActivitySidebar() {
  const { project, activityStatus, currentActivity, viewingActivity, setViewingActivity, setCurrentActivity, userProfile } = useProjectStore()
  const [showAnalysis, setShowAnalysis] = useState(false)
  if (!project) return null

  const isHost = project.hostUid === userProfile?.uid || project.createdBy === userProfile?.uid

  const currentStage = project.currentStage
  const currentStageInfo = STAGES.find(s => s.code === currentStage)!
  const guide = STAGE_GUIDE[currentStage]
  const color = STAGE_COLOR[currentStage]
  // 산출물이 있어야 완료로 간주 (status만으로는 완료 처리 안 함)
  // P1-I: 중앙화된 헬퍼로 위임 (E 단계 requiredSections 검증 포함).
  function isEffectivelyDone(code: ActivityCode) {
    return checkEffectivelyDone(code, activityStatus, project?.artifacts)
  }
  const completedCount = currentStageInfo.activities.filter(a => isEffectivelyDone(a)).length
  const totalCount = currentStageInfo.activities.length
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  function handleActivityClick(code: ActivityCode) {
    if (isHost) {
      // 방장: Firestore 업데이트 + 로컬 동기화
      if (code === currentActivity) return
      setCurrentActivity(code)
      setViewingActivity(code)
      setProjectActivity(project!.id, code).catch(console.error)
    } else {
      // 팀원: 로컬 탐색만 (Firestore 변경 없음)
      setViewingActivity(code)
    }
  }

  return (
    <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden corner-wrap-sidebar"
      style={{ '--cc': color.corner } as React.CSSProperties}>

      {/* ─── 단계 아이덴티티 헤더 ────────────────── */}
      <div className={cn('px-4 pt-4 pb-4', color.light)}>
        {/* 아이콘 + 단계명 */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className={cn('w-11 h-11 flex items-center justify-center flex-shrink-0 shadow-sm', color.bg)}
            style={{
              animation: 'morph-shape 8s ease-in-out infinite, stage-bounce 3s ease-in-out infinite',
              boxShadow: `0 6px 16px ${color.pulse}`,
            }}
          >
            {(() => { const StageIcon = STAGE_ICON_MAP[currentStage]; return <StageIcon size={22} weight="fill" className="text-white" /> })()}
          </div>
          <div className="min-w-0">
            <p className={cn('text-[11px] font-bold uppercase tracking-widest mb-0.5', color.text)}>
              {currentStage} 단계
            </p>
            <p className="text-[16px] font-extrabold text-[#202124] leading-tight">{currentStageInfo.label}</p>
          </div>
        </div>

        {/* 목표 */}
        <p className={cn('text-[12px] leading-snug mb-3 line-clamp-2', color.text, 'opacity-70')}>{guide.goal}</p>

        {/* 진행률 바 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', color.bg)}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className={cn('text-[12px] font-bold tabular-nums', color.text)}>{completedCount}/{totalCount}</span>
        </div>
      </div>

      {/* 팀이 할 일 */}
      <div className={cn('mx-3 mt-3 rounded-2xl border px-3.5 py-3', color.light, color.border)}>
        <p className={cn('text-[11px] font-bold uppercase tracking-wider mb-2 opacity-60', color.text)}>팀이 할 일</p>
        {guide.teamTasks.map((task, i) => (
          <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
            <span className={cn('text-[11px] font-bold mt-0.5 opacity-50 flex-shrink-0', color.text)}>{i + 1}.</span>
            <p className={cn('text-[12px] leading-snug', color.text, 'opacity-85')}>{task}</p>
          </div>
        ))}
      </div>

      {/* 팀원 탐색 모드 배너 */}
      {!isHost && viewingActivity !== currentActivity && (
        <div className="mx-3 mt-2 rounded-xl bg-[#FFF8E1] border border-[#FFD54F] px-3 py-2 flex items-center gap-2">
          <Crown size={14} weight="fill" className="text-[#F9AB00] flex-shrink-0" />
          <p className="flex-1 text-[11px] text-[#E65100] leading-snug">
            탐색 중 — 채팅은 방장 진행 활동에서 계속됩니다
          </p>
          <button
            onClick={() => setViewingActivity(currentActivity)}
            className="text-[11px] font-bold text-[#E65100] underline flex-shrink-0 hover:no-underline"
          >
            돌아가기
          </button>
        </div>
      )}

      {/* 활동 목록 */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <p className="text-[11px] font-semibold text-[#9AA0A6] uppercase tracking-widest px-2 mb-1.5">활동</p>
        <div className="space-y-0.5">
          {currentStageInfo.activities.map((code, idx) => (
            <ActivityItem
              key={code}
              code={code}
              index={idx}
              isViewing={code === viewingActivity}
              isHostCurrent={code === currentActivity}
              isHost={isHost}
              status={activityStatus[code] ?? 'not_started'}
              hasArtifact={!!project?.artifacts?.[code]}
              artifactConfirmed={project?.artifacts?.[code]?.status === 'confirmed'}
              onClick={() => handleActivityClick(code)}
            />
          ))}
        </div>

        {/* 선택된 활동 개념 안내 박스 */}
        {viewingActivity && ACTIVITY_INFO[viewingActivity] && (
          <div className="mt-3 mx-1 rounded-2xl border border-[#AECBFA] bg-[#E8F0FE] px-3.5 py-3">
            <p className="text-[12px] font-bold text-[#1A73E8] mb-1.5">{ACTIVITY_INFO[viewingActivity]!.title}</p>
            <p className="text-[11px] text-[#3C4043] leading-snug whitespace-pre-line mb-2">{ACTIVITY_INFO[viewingActivity]!.body}</p>
            <p className="text-[11px] text-[#5F6368] italic leading-snug">{ACTIVITY_INFO[viewingActivity]!.example}</p>
          </div>
        )}

        {/* 단계 분석 버튼 — 모든 산출물 확정 시 활성화 */}
        {completedCount === totalCount && totalCount > 0 && (
          <div className="px-1 pt-3 pb-1">
            <button
              onClick={() => {
                setShowAnalysis(true)
                if (project?.id) setAnalysisOpen(project.id, true).catch(console.error)
              }}
              className={cn(
                'morph-btn w-full flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white transition-all',
                color.bg
              )}
              style={{ filter: `drop-shadow(0 3px 10px ${color.pulse})` }}
            >
              <ChartBar size={16} weight="fill" />
              현재 단계 분석하기
            </button>
          </div>
        )}
      </div>

      {/* 범례 */}
      <div className="px-4 py-2.5 border-t border-[#F1F3F4] flex gap-3">
        <Tooltip text="A-2-3 학습자·맥락 분석 산출물이 이후 설계 단계의 가드레일로 활용됩니다. 설계 단계에서 이 분석 결과가 반드시 반영되어야 합니다.">
          <div className="flex items-center gap-1 text-[11px] text-[#9AA0A6] cursor-help">
            <Shield size={16} weight="fill" className="text-[#7B1FA2]" />
            <span>가드레일</span>
          </div>
        </Tooltip>
        <Tooltip text="백워드 설계(Backward Design) 원칙에 따라 평가를 먼저 계획합니다. 수업 활동보다 평가 기준을 먼저 확정함으로써 목표 중심 수업설계를 구현합니다.">
          <div className="flex items-center gap-1 text-[11px] text-[#9AA0A6] cursor-help">
            <Star size={16} weight="fill" className="text-[#F9AB00]" />
            <span>평가 먼저</span>
          </div>
        </Tooltip>
      </div>

      {showAnalysis && <StageAnalysisModal isHost={isHost} onClose={() => {
        setShowAnalysis(false)
        if (project?.id) setAnalysisOpen(project.id, false).catch(console.error)
      }} />}
    </div>
  )
}

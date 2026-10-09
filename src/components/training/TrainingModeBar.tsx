'use client'

import { ModalLoading } from '@/components/ui/ModalLoading'
import dynamic from 'next/dynamic'
const StageAnalysisModal = dynamic(() => import('@/components/modals/StageAnalysisModal').then(module => module.StageAnalysisModal), { ssr: false, loading: ModalLoading })


import { useEffect, useId, useRef, useState } from 'react'
import { CheckCircle, ArrowRight, Question, X } from '@phosphor-icons/react'
import { ACTIVITY_META, type ActivityCode, type Project } from '@/types'
import { TRAINING_ACTIVITIES, TRAINING_STEP_BY_STEP, formatTrainingHelpRequest, isTrainingActivity } from '@/lib/training/trainingMode'

import { MD3Button } from '@/components/ui/MD3Button'
import { trainingRecordText } from '@/lib/training/trainingRecord'
import { nextTrainingActivity } from '@/lib/training/navigation'

export interface TrainingModeBarProps {
  project: Project
  activityCode: ActivityCode
  content?: Record<string, unknown>
  loaded: boolean
  isHost: boolean
  busy: boolean
  onSend: (text: string) => unknown
  onNext: (nextCode: ActivityCode) => unknown
  onReport?: () => unknown
}

export function TrainingModeBar({ project, activityCode, content = {}, loaded, isHost, busy, onSend, onNext, onReport }: TrainingModeBarProps) {
  const [showReport, setShowReport] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const helpId = useId()
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const helpCloseRef = useRef<HTMLButtonElement>(null)
  const helpPanelRef = useRef<HTMLDivElement>(null)
  const help = {
    record: '이 활동에 저장한 기록이 있는지 보여 줘요. 오른쪽 입력창 하나에 자유롭게 적고 저장하세요.',
    ai: '이 활동에서 막히기 쉬운 일 하나만 AI가 도와줘요. 다른 질문은 덧붙이지 않아요.',
    steps: '이 활동만 AI가 단계마다 묻고 이끌어 주는 방식으로 바꿔요. 채팅에 "직접 적을게요"라고 쓰면 다시 간단히 옮겨 적는 방식으로 돌아와요.',
    next: '다음 활동으로 넘어가요. 기록 담당만 누를 수 있고, 기록은 나중에 돌아와 이어 쓸 수 있어요.',
    quiet: '도움이 필요 없으면 채팅에 "개입하지 마세요"라고 쓰면 AI가 조언하지 않아요.',
  }
  useEffect(() => {
    if (!showHelp) return
    helpCloseRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setShowHelp(false)
      helpButtonRef.current?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !helpPanelRef.current?.contains(event.target) && !helpButtonRef.current?.contains(event.target)) setShowHelp(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [showHelp])
  if (!isTrainingActivity(project, activityCode)) return null
  const hasRecord = !!trainingRecordText(activityCode, content).trim()
  const next = nextTrainingActivity(project, activityCode)
  const blocked = !loaded || busy
  return (
    <aside aria-label="연수용 모드" className="relative shrink-0 border-b border-[#DADCE0] bg-[#F3F7FE] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-[#0842A0]">연수용 모드</span>
        <span role="status" title={help.record} className="flex items-center gap-1 text-[#3C4043]">
          <CheckCircle size={16} aria-hidden="true" />
          {!loaded ? '내용을 불러오는 중…' : hasRecord ? '기록 저장됨' : '아직 기록 없음'}
        </span>
        <button ref={helpButtonRef} type="button" aria-label="연수 막대 도움말" title="연수 막대 도움말"
          aria-expanded={showHelp} aria-controls={helpId} aria-haspopup="dialog"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#0842A0] hover:bg-[#D3E3FD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B57D0] focus-visible:ring-offset-2"
          onClick={() => setShowHelp(current => !current)}><Question size={20} aria-hidden="true" /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {TRAINING_ACTIVITIES[activityCode].help.map(action => (
          <MD3Button key={action.label} type="button" variant="tonal" size="xs" disabled={blocked} title={help.ai}
            icon={<Question size={16} />} onClick={() => onSend(formatTrainingHelpRequest(action))}>AI 도움: {action.label}</MD3Button>
        ))}
        <MD3Button type="button" variant="outlined" size="xs" disabled={blocked} title={help.steps}
          onClick={() => onSend(TRAINING_STEP_BY_STEP)}>단계별로 함께 진행</MD3Button>
        <MD3Button type="button" size="xs" disabled={blocked || !isHost}
          title={help.next}
          trailing={<ArrowRight size={16} />} onClick={() => {
            if (blocked || !isHost) return
            if (next) onNext(next)
            else if (onReport) onReport()
            else setShowReport(true)
          }}>{next ? `다음 활동 · ${ACTIVITY_META[next].label}` : '보고서 작성하기'}</MD3Button>
      </div>
      {!isHost && <p className="mt-2 text-xs text-[#3C4043]">다음 활동 이동은 기록 담당이 진행합니다.</p>}
      {showHelp && <div ref={helpPanelRef} id={helpId} role="dialog" aria-labelledby={`${helpId}-title`}
        className="absolute right-4 top-full z-30 mt-2 max-h-[60vh] w-[calc(100%-2rem)] max-w-[26rem] overflow-y-auto rounded-2xl border border-[#DADCE0] bg-white p-4 text-[13px] leading-relaxed text-[#3C4043] shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id={`${helpId}-title`} className="font-semibold text-[#202124]">연수 막대 도움말</h3>
          <button ref={helpCloseRef} type="button" aria-label="도움말 닫기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F1F3F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B57D0]"
            onClick={() => { setShowHelp(false); helpButtonRef.current?.focus() }}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="space-y-2">
          <p><strong className="text-[#202124]">활동 기록</strong> — {help.record}</p>
          <p><strong className="text-[#202124]">AI 도움</strong> — {help.ai}</p>
          <p><strong className="text-[#202124]">단계별로 함께 진행</strong> — {help.steps}</p>
          <p><strong className="text-[#202124]">다음 활동</strong> — {help.next}</p>
        </div>
        <p className="mt-3 border-t border-[#E8EAED] pt-3 text-[#5F6368]">{help.quiet}</p>
      </div>}
      {showReport && isHost && <StageAnalysisModal isHost={isHost} onClose={() => setShowReport(false)} />}
    </aside>
  )
}

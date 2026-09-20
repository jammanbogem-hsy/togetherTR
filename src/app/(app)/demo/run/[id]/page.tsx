'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Users,
} from 'lucide-react'
import { getProject } from '@/lib/firebase/projects'
import { runLiveMultiAgentDemo, type DemoEngineEvent } from '@/lib/demo/engine/run'
import {
  parseDemoEngineConfig,
  type DemoEngineConfig,
  type DemoRunStatus,
} from '@/lib/demo/engine/types'
import { useProjectStore } from '@/store/project'
import { cn } from '@/lib/utils'

const PHASE_LABELS: Record<string, string> = {
  'orchestrator-intro': '총괄 AI 활동 제시',
  'teacher-contribution': '교사별 독립 제안',
  'teacher-response': '동료 의견 검토·조정',
  'orchestrator-synthesis': '공동 산출물 초안 제시',
  'teacher-review': '교사별 산출물 검토·동의 확인',
  'orchestrator-revision': '검토 의견 반영·산출물 수정',
  'activity-complete': '활동 저장 완료',
  complete: '전체 실행 완료',
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

function requiresNewSetupAfterError(error: string | null): boolean {
  return Boolean(error && /2회 수정 후에도|이전 버전/.test(error))
}

export default function DemoRunPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const userProfile = useProjectStore((state) => state.userProfile)
  const [config, setConfig] = useState<DemoEngineConfig | null>(null)
  const [status, setStatus] = useState<DemoRunStatus>('ready')
  const [activityIndex, setActivityIndex] = useState(0)
  const activityIndexRef = useRef(0)
  const [completedTurns, setCompletedTurns] = useState(0)
  const [totalTurns, setTotalTurns] = useState(1)
  const [events, setEvents] = useState<DemoEngineEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const runLockRef = useRef(false)
  const autoStartRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!id || !userProfile) return
    let cancelled = false

    getProject(id)
      .then((project) => {
        if (cancelled) return
        if (!project) throw new Error('데모 프로젝트를 찾을 수 없습니다.')
        if (project.createdBy !== userProfile.uid) {
          throw new Error('프로젝트 생성자만 이 실행 화면을 열 수 있습니다.')
        }
        if (!project.demoRun) throw new Error('멀티에이전트 실행 정보가 없는 프로젝트입니다.')
        const parsedConfig = parseDemoEngineConfig(project.demoRun.config)
        const nextIndex = Math.max(0, Math.min(19, project.demoRun.activityIndex ?? 0))
        setConfig(parsedConfig)
        setStatus(project.demoRun.status)
        setActivityIndex(nextIndex)
        activityIndexRef.current = nextIndex
        setCompletedTurns(project.demoRun.completedTurns ?? 0)
        setTotalTurns(project.demoRun.totalTurns || 1)
        setError(project.demoRun.error || null)
      })
      .catch((reason) => {
        if (!cancelled) setError(messageOf(reason))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [id, userProfile])

  const startRun = useCallback(async () => {
    if (!id || !userProfile || !config || runLockRef.current) return
    runLockRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('running')
    setError(null)
    // Durable turns are replayed with deterministic IDs on resume. Clear only
    // this tab's display list; the saved project dialogue remains untouched.
    setEvents([])

    try {
      await runLiveMultiAgentDemo(
        id,
        userProfile.uid,
        config,
        activityIndexRef.current,
        {
          signal: controller.signal,
          onEvent: (event) => {
            setEvents((previous) => [...previous.slice(-39), event])
            setCompletedTurns(event.completedTurns)
            setTotalTurns(event.totalTurns)
          },
          onCheckpoint: (turns, nextActivityIndex) => {
            setCompletedTurns(turns)
            setActivityIndex(nextActivityIndex)
            activityIndexRef.current = nextActivityIndex
          },
        },
      )
      setStatus('completed')
      setActivityIndex(19)
      activityIndexRef.current = 19
    } catch (reason) {
      if (isAbort(reason) || controller.signal.aborted) {
        setStatus('paused')
      } else {
        const nextError = messageOf(reason)
        setStatus('failed')
        setError(nextError)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      runLockRef.current = false
    }
  }, [config, id, userProfile])

  useEffect(() => {
    if (isLoading || !config || status === 'completed' || autoStartRef.current) return
    if (status !== 'ready' && status !== 'running') return
    autoStartRef.current = true
    void startRun()
  }, [config, isLoading, startRun, status])

  function pauseRun() {
    abortRef.current?.abort()
  }

  function resumeRun() {
    autoStartRef.current = true
    void startRun()
  }

  const percent = status === 'completed'
    ? 100
    : Math.min(99, Math.round((completedTurns / Math.max(totalTurns, 1)) * 100))
  const latestEvent = events.at(-1)
  const requiresNewSetup = status === 'failed' && requiresNewSetupAfterError(error)

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F6F8FC]">
        <div className="flex items-center gap-3 text-sm font-bold text-[#5F6368]">
          <Loader2 className="h-5 w-5 animate-spin text-[#7C3AED]" /> 실행 정보를 불러오는 중…
        </div>
      </main>
    )
  }

  if (!config) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F6F8FC] p-5">
        <section className="w-full max-w-lg rounded-3xl border border-[#F4C7C3] bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-extrabold text-[#B3261E]">데모를 시작할 수 없습니다</h1>
          <p className="mt-2 text-sm leading-6 text-[#5F6368]">{error || '실행 설정을 읽지 못했습니다.'}</p>
          <button type="button" onClick={() => router.push('/demo')} className="mt-5 rounded-xl bg-[#7C3AED] px-5 py-2.5 text-sm font-bold text-white">설정으로 돌아가기</button>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F6F8FC] text-[#202124]">
      <header className="sticky top-0 z-20 border-b border-[#DADCE0] bg-white/95 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => router.push('/dashboard')} aria-label="대시보드로 이동" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F1F3F4]">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#7C3AED]">Live multi-agent engine</p>
              <h1 className="truncate text-sm font-extrabold sm:text-base">{config.lesson.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'running' && (
              <button type="button" onClick={pauseRun} className="flex items-center gap-1.5 rounded-xl border border-[#DADCE0] bg-white px-3 py-2 text-xs font-bold text-[#5F6368] hover:bg-[#F8F9FA]">
                <CirclePause className="h-4 w-4" /> 일시정지
              </button>
            )}
            {(status === 'paused' || status === 'failed') && !requiresNewSetup && (
              <button type="button" onClick={resumeRun} className="flex items-center gap-1.5 rounded-xl bg-[#137333] px-3 py-2 text-xs font-bold text-white hover:bg-[#0D652D]">
                {status === 'failed' ? <RefreshCw className="h-4 w-4" /> : <CirclePlay className="h-4 w-4" />}
                {status === 'failed' ? '저장 지점에서 재시도' : '계속 실행'}
              </button>
            )}
            {requiresNewSetup && <button type="button" onClick={() => router.push('/demo')} className="rounded-xl bg-[#7C3AED] px-3 py-2 text-xs font-bold text-white">새 데모 설정</button>}
            <a href={`/projects/${id}`} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 rounded-xl bg-[#1A73E8] px-3 py-2 text-xs font-bold text-white hover:bg-[#1557B0] sm:flex">
              프로젝트 보기 <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-3xl border border-[#E4D7FF] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-[#7C3AED]">전체 실행 진행률</p>
                <p className="mt-0.5 text-3xl font-black tabular-nums">{percent}%</p>
              </div>
              {status === 'completed'
                ? <CheckCircle2 className="h-10 w-10 text-[#137333]" />
                : <Loader2 className={cn('h-8 w-8 text-[#7C3AED]', status === 'running' && 'animate-spin')} />}
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#E8EAED]" role="progressbar" aria-label="멀티에이전트 데모 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#1A73E8] transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-3 flex justify-between text-[11px] font-semibold text-[#5F6368]">
              <span>활동 {Math.min(activityIndex + 1, 19)}/19</span>
              <span>에이전트 턴 {completedTurns} · 예상 {totalTurns}</span>
            </div>
            <p className="mt-3 rounded-xl bg-[#F8F9FA] px-3 py-2 text-xs leading-5 text-[#5F6368]">
              {status === 'running' && (latestEvent ? `${latestEvent.activityLabel} · ${PHASE_LABELS[latestEvent.phase]}` : '총괄 AI가 첫 활동을 준비하고 있습니다.')}
              {status === 'paused' && '일시정지되었습니다. 저장된 활동·대화를 유지하고 이어서 진행합니다.'}
              {status === 'failed' && '오류가 발생했습니다. 저장이 끝난 이전 활동은 유지됩니다.'}
              {status === 'completed' && '모든 활동의 대화·산출물·단계 보고서가 저장되었습니다.'}
            </p>
          </section>

          <section className="rounded-3xl border border-[#DADCE0] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-[#7C3AED]" />
              <h2 className="text-sm font-extrabold">참여 교사 에이전트</h2>
            </div>
            <div className="space-y-2">
              {config.personas.map((persona) => (
                <div key={persona.id} className="flex items-start gap-2.5 rounded-2xl border border-[#E8EAED] p-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-lg" style={{ backgroundColor: `${persona.color}22`, color: persona.color }}>{persona.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-extrabold">{persona.displayName}</p>
                    <p className="truncate text-[11px] text-[#5F6368]">{persona.subject} · {persona.career}</p>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#9AA0A6]">{persona.priority}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#DADCE0] bg-white p-5 text-xs leading-5 text-[#5F6368] shadow-sm">
            <p className="font-extrabold text-[#202124]">실행 방식</p>
            <ol className="mt-2 space-y-1.5">
              <li>1. 총괄 AI가 활동과 쟁점을 먼저 제시</li>
              <li>2. 각 교사가 페르소나 관점으로 독립 제안</li>
              <li>3. 활동의 세부 절차에 따라 동료 의견에 응답·조정</li>
              <li>4. 공동 산출물 초안을 교사 AI가 각각 검토</li>
              <li>5. 수정 요청을 반영하고 전원 동의·형식을 확인한 뒤 저장</li>
            </ol>
            <p className="mt-3 border-t pt-3">사용자는 관찰자입니다. 교사 발언·동의와 수업 실행·성찰은 AI 시뮬레이션이며 실제 교사 승인이나 학습 효과가 아닙니다. 추가 검토에 따라 실행 시간과 예상 턴 수가 달라집니다.</p>
          </section>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-3xl border border-[#DADCE0] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E8EAED] px-5 py-4">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-[#1A73E8]" />
              <div>
                <h2 className="text-sm font-extrabold">실시간 에이전트 협의</h2>
                <p className="text-[11px] text-[#9AA0A6]">완료된 발화는 즉시 프로젝트 활동 대화에 저장됩니다.</p>
              </div>
            </div>
            <span className={cn(
              'rounded-full px-3 py-1 text-[10px] font-extrabold',
              status === 'running' && 'bg-[#E8F0FE] text-[#1A73E8]',
              status === 'paused' && 'bg-[#FEF7E0] text-[#B06000]',
              status === 'failed' && 'bg-[#FCE8E6] text-[#B3261E]',
              status === 'completed' && 'bg-[#E6F4EA] text-[#137333]',
              status === 'ready' && 'bg-[#F1F3F4] text-[#5F6368]',
            )}>
              {status === 'running' ? '실행 중' : status === 'paused' ? '일시정지' : status === 'failed' ? '재시도 필요' : status === 'completed' ? '완료' : '준비'}
            </span>
          </div>

          {error && (
            <div role="alert" className="m-5 rounded-2xl border border-[#F4C7C3] bg-[#FCE8E6] px-4 py-3 text-sm text-[#B3261E]">
              <strong>실행 오류:</strong> {error}
              {requiresNewSetup && <p className="mt-2 text-xs leading-5">기존 대화·초안·검토 의견은 보존되어 있습니다. 같은 기록을 재생해 강제로 승인하지 않습니다. <a href={`/projects/${id}`} className="underline">프로젝트에서 이견과 산출물을 확인</a>한 뒤, 수업 조건이나 페르소나를 조정하여 새 데모를 시작하세요.</p>}
            </div>
          )}

          <div className="min-h-[560px] space-y-4 bg-[#FBFCFF] p-5 sm:p-6" role="log" aria-label="멀티에이전트 실시간 대화" aria-live="polite">
            {events.length === 0 ? (
              <div className="flex min-h-[480px] flex-col items-center justify-center text-center text-[#9AA0A6]">
                <Bot className="mb-3 h-10 w-10 text-[#C4B5FD]" />
                <p className="text-sm font-bold text-[#5F6368]">총괄 AI의 첫 활동 제시를 기다리는 중입니다</p>
                <p className="mt-1 max-w-md text-xs leading-5">각 발화는 미리 작성된 문장이 아니라 현재 수업 설정, 페르소나, 앞선 산출물과 대화를 입력으로 실제 생성됩니다.</p>
              </div>
            ) : (
              events.map((event) => {
                const isSystemEvent = event.phase === 'activity-complete' || event.phase === 'complete'
                const isOrchestrator = event.speaker === '총괄 AI'
                return (
                  <article key={event.id} className={cn(
                    'rounded-2xl border p-4 shadow-sm',
                    isSystemEvent ? 'border-[#B7E1CD] bg-[#E6F4EA]' : isOrchestrator ? 'border-[#C6DAFC] bg-white' : 'border-[#E4D7FF] bg-[#FCFAFF]',
                  )}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={cn('text-xs font-extrabold', isSystemEvent ? 'text-[#137333]' : isOrchestrator ? 'text-[#1A73E8]' : 'text-[#7C3AED]')}>{event.speaker}</span>
                      <span className="rounded-full bg-[#F1F3F4] px-2 py-0.5 text-[10px] font-bold text-[#5F6368]">{event.activityLabel}</span>
                      <span className="text-[10px] text-[#9AA0A6]">{PHASE_LABELS[event.phase]}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-[#3C4043]">{event.content}</p>
                  </article>
                )
              })
            )}
          </div>

          {status === 'completed' && (
            <div className="border-t border-[#B7E1CD] bg-[#E6F4EA] p-5 text-center">
              <p className="font-extrabold text-[#137333]">튜토리얼 프로젝트가 완성되었습니다.</p>
              <p className="mt-1 text-xs text-[#3C6142]">프로젝트 화면에서 19개 활동의 AI 교사 협의, 검토·수정 기록과 산출물을 확인하고 전체 튜토리얼을 내려받을 수 있습니다. 수업 실행 자료는 시뮬레이션입니다.</p>
              <button type="button" onClick={() => router.push(`/projects/${id}`)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#137333] px-5 py-2.5 text-sm font-extrabold text-white hover:bg-[#0D652D]">
                완성된 프로젝트 열기 <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

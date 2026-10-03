'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Info,
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
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'
import { DemoTurnMarkdown } from '@/components/demo/DemoTurnMarkdown'

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

const STATUS_CHIP: Record<DemoRunStatus, { label: string; container: string }> = {
  running: { label: '실행 중', container: 'bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)]' },
  paused: { label: '일시정지', container: 'bg-[var(--md-sys-secondary-container)] text-[var(--md-sys-on-secondary-container)]' },
  failed: { label: '재시도 필요', container: 'bg-[var(--md-sys-error-container)] text-[var(--md-sys-on-error-container)]' },
  completed: { label: '완료', container: 'bg-[var(--md-sys-tertiary-container)] text-[var(--md-sys-on-tertiary-container)]' },
  ready: { label: '준비', container: 'bg-[var(--md-sys-surface-container-high)] text-[var(--md-sys-on-surface-variant)]' },
}

const RUN_STEPS = [
  '총괄 AI가 활동과 쟁점을 먼저 제시',
  '각 교사가 페르소나 관점으로 독립 제안',
  '활동의 세부 절차에 따라 동료 의견에 응답·조정',
  '공동 산출물 초안을 교사 AI가 각각 검토',
  '수정 요청을 반영하고 전원 동의·형식을 확인한 뒤 저장',
]

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

  const statusChip = STATUS_CHIP[status]
  const personaByName = new Map(config?.personas.map((persona) => [persona.displayName, persona]) ?? [])

  if (isLoading) {
    return (
      <main className="m3-shell flex min-h-screen items-center justify-center bg-[var(--md-sys-surface-container-low)]">
        <div className="flex items-center gap-3 text-sm font-medium text-[var(--md-sys-on-surface-variant)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--md-sys-primary)]" /> 실행 정보를 불러오는 중…
        </div>
      </main>
    )
  }

  if (!config) {
    return (
      <main className="m3-shell flex min-h-screen items-center justify-center bg-[var(--md-sys-surface-container-low)] p-5">
        <section className="w-full max-w-lg rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-lowest)] p-8 text-center shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)]">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--md-sys-error-container)] text-[var(--md-sys-on-error-container)]">
            <AlertCircle className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-medium text-[var(--md-sys-on-surface)]">데모를 시작할 수 없습니다</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--md-sys-on-surface-variant)]">{error || '실행 설정을 읽지 못했습니다.'}</p>
          <MD3Button variant="filled" tone="blue" className="mt-6" onClick={() => router.push('/demo')}>설정으로 돌아가기</MD3Button>
        </section>
      </main>
    )
  }

  return (
    <main className="m3-shell min-h-screen bg-[var(--md-sys-surface-container-low)]">
      {/* M3 small top app bar */}
      <header className="m3-top-app-bar sticky top-0 z-20 px-2 sm:px-4">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <MD3Button variant="text" tone="neutral" aria-label="대시보드로 이동" icon={<ArrowLeft className="h-5 w-5" />} onClick={() => router.push('/dashboard')} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.04em] text-[var(--md-sys-primary)]">실시간 멀티에이전트 실행</p>
              <h1 className="truncate text-base font-medium text-[var(--md-sys-on-surface)] sm:text-[22px] sm:leading-7">{config.lesson.title}</h1>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {status === 'running' && (
              <MD3Button variant="outlined" tone="neutral" icon={<CirclePause size={MD3_ICON.sm} />} onClick={pauseRun}>일시정지</MD3Button>
            )}
            {(status === 'paused' || status === 'failed') && !requiresNewSetup && (
              <MD3Button
                variant="filled"
                tone="green"
                icon={status === 'failed' ? <RefreshCw size={MD3_ICON.sm} /> : <CirclePlay size={MD3_ICON.sm} />}
                onClick={resumeRun}
              >
                {status === 'failed' ? '저장 지점에서 재시도' : '계속 실행'}
              </MD3Button>
            )}
            {requiresNewSetup && <MD3Button variant="filled" tone="blue" onClick={() => router.push('/demo')}>새 데모 설정</MD3Button>}
            <MD3Button
              variant="tonal"
              tone="blue"
              className="hidden sm:inline-flex"
              trailing={<ExternalLink size={16} />}
              onClick={() => window.open(`/projects/${id}`, '_blank', 'noopener,noreferrer')}
            >
              프로젝트 보기
            </MD3Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:gap-6 sm:px-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-[88px] lg:self-start">
          {/* Progress card */}
          <section className="rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-lowest)] p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--md-sys-on-surface-variant)]">전체 실행 진행률</p>
                <p className="mt-1 text-[45px] font-normal leading-[52px] tabular-nums text-[var(--md-sys-on-surface)]">
                  {percent}<span className="text-2xl text-[var(--md-sys-on-surface-variant)]">%</span>
                </p>
              </div>
              <span className={cn('flex h-12 w-12 items-center justify-center rounded-full', statusChip.container)}>
                {status === 'completed'
                  ? <CheckCircle2 className="h-6 w-6" />
                  : <Loader2 className={cn('h-6 w-6', status === 'running' && 'animate-spin')} />}
              </span>
            </div>
            {/* M3 linear progress indicator: active track, gap, inactive track, stop dot */}
            <div className="relative mt-4 flex h-1 items-center gap-1" role="progressbar" aria-label="멀티에이전트 데모 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="h-full rounded-full bg-[var(--md-sys-primary)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
              {percent < 100 && <div className="h-full flex-1 rounded-full bg-[var(--md-sys-primary-container)]" />}
              {percent < 100 && <span aria-hidden="true" className="absolute right-0 h-1 w-1 rounded-full bg-[var(--md-sys-primary)]" />}
            </div>
            <div className="mt-3 flex justify-between text-xs text-[var(--md-sys-on-surface-variant)]">
              <span>활동 {Math.min(activityIndex + 1, 19)} / 19</span>
              <span>에이전트 턴 {completedTurns} · 예상 {totalTurns}</span>
            </div>
            <p className="mt-4 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container)] px-4 py-3 text-[13px] leading-5 text-[var(--md-sys-on-surface-variant)]">
              {status === 'running' && (latestEvent ? `${latestEvent.activityLabel} · ${PHASE_LABELS[latestEvent.phase]}` : '총괄 AI가 첫 활동을 준비하고 있습니다.')}
              {status === 'paused' && '일시정지되었습니다. 저장된 활동·대화를 유지하고 이어서 진행합니다.'}
              {status === 'failed' && '오류가 발생했습니다. 저장이 끝난 이전 활동은 유지됩니다.'}
              {status === 'completed' && '모든 활동의 대화·산출물·단계 보고서가 저장되었습니다.'}
              {status === 'ready' && '실행을 준비하고 있습니다.'}
            </p>
          </section>

          {/* Personas — M3 list */}
          <section className="rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-lowest)] py-4">
            <div className="flex items-center gap-2 px-6 pb-2">
              <Users className="h-5 w-5 text-[var(--md-sys-primary)]" />
              <h2 className="text-base font-medium text-[var(--md-sys-on-surface)]">참여 교사 에이전트</h2>
            </div>
            <ul>
              {config.personas.map((persona) => (
                <li key={persona.id} className="flex items-start gap-4 px-6 py-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg" style={{ backgroundColor: `${persona.color}24` }}>{persona.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate text-base text-[var(--md-sys-on-surface)]">{persona.displayName}</p>
                    <p className="truncate text-sm text-[var(--md-sys-on-surface-variant)]">{persona.subject} · {persona.career}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-[18px] text-[var(--md-sys-outline)]">{persona.priority}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* How it runs */}
          <section className="rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-lowest)] p-6">
            <h2 className="text-base font-medium text-[var(--md-sys-on-surface)]">실행 방식</h2>
            <ol className="mt-3 space-y-3">
              {RUN_STEPS.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm leading-5 text-[var(--md-sys-on-surface-variant)]">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--md-sys-secondary-container)] text-xs font-medium text-[var(--md-sys-on-secondary-container)]">{index + 1}</span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex gap-3 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container)] p-4 text-xs leading-5 text-[var(--md-sys-on-surface-variant)]">
              <Info className="h-4 w-4 flex-shrink-0 translate-y-0.5 text-[var(--md-sys-on-surface-variant)]" />
              <p>사용자는 관찰자입니다. 교사 발언·동의와 수업 실행·성찰은 AI 시뮬레이션이며 실제 교사 승인이나 학습 효과가 아닙니다. 추가 검토에 따라 실행 시간과 예상 턴 수가 달라집니다.</p>
            </div>
          </section>
        </aside>

        {/* Live conversation */}
        <section className="min-w-0 overflow-hidden rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-lowest)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--md-sys-outline-variant)] px-6 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <MessageSquareText className="h-6 w-6 flex-shrink-0 text-[var(--md-sys-primary)]" />
              <div className="min-w-0">
                <h2 className="text-base font-medium text-[var(--md-sys-on-surface)]">실시간 에이전트 협의</h2>
                <p className="truncate text-xs text-[var(--md-sys-on-surface-variant)]">완료된 발화는 즉시 프로젝트 활동 대화에 저장됩니다.</p>
              </div>
            </div>
            <span className={cn('inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] px-3 text-sm font-medium', statusChip.container)}>
              {status === 'running' && <span className="h-2 w-2 animate-pulse rounded-full bg-current" />}
              {statusChip.label}
            </span>
          </div>

          {error && (
            <div role="alert" className="m-4 flex gap-3 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-error-container)] px-4 py-3 text-sm text-[var(--md-sys-on-error-container)] sm:m-6">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <div>
                <strong className="font-medium">실행 오류:</strong> {error}
                {requiresNewSetup && <p className="mt-2 text-xs leading-5">기존 대화·초안·검토 의견은 보존되어 있습니다. 같은 기록을 재생해 강제로 승인하지 않습니다. <a href={`/projects/${id}`} className="font-medium underline">프로젝트에서 이견과 산출물을 확인</a>한 뒤, 수업 조건이나 페르소나를 조정하여 새 데모를 시작하세요.</p>}
              </div>
            </div>
          )}

          <div className="min-h-[560px] space-y-3 bg-[var(--md-sys-surface-container-low)] p-4 sm:p-6" role="log" aria-label="멀티에이전트 실시간 대화" aria-live="polite">
            {events.length === 0 ? (
              <div className="flex min-h-[480px] flex-col items-center justify-center px-4 text-center">
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)]">
                  <Bot className="h-8 w-8" />
                </span>
                <p className="text-base font-medium text-[var(--md-sys-on-surface)]">총괄 AI의 첫 활동 제시를 기다리는 중입니다</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-[var(--md-sys-on-surface-variant)]">각 발화는 미리 작성된 문장이 아니라 현재 수업 설정, 페르소나, 앞선 산출물과 대화를 입력으로 실제 생성됩니다.</p>
              </div>
            ) : (
              events.map((event) => {
                const isSystemEvent = event.phase === 'activity-complete' || event.phase === 'complete'
                const isOrchestrator = event.speaker === '총괄 AI'
                const persona = personaByName.get(event.speaker)
                if (isSystemEvent) {
                  return (
                    <div key={event.id} className="flex items-center gap-3 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-tertiary-container)] px-4 py-3 text-sm text-[var(--md-sys-on-tertiary-container)]">
                      <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium">{event.activityLabel} · {PHASE_LABELS[event.phase]}</p>
                        <div className="mt-1 opacity-90"><DemoTurnMarkdown content={event.content} /></div>
                      </div>
                    </div>
                  )
                }
                return (
                  <article key={event.id} className="flex gap-3 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container-lowest)] p-4 shadow-[0_1px_2px_rgba(60,64,67,0.12)] sm:p-5">
                    <span
                      className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg', isOrchestrator && 'bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)]')}
                      style={persona ? { backgroundColor: `${persona.color}24` } : undefined}
                      aria-hidden="true"
                    >
                      {persona ? persona.emoji : <Bot className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium text-[var(--md-sys-on-surface)]">{event.speaker}</span>
                        <span className="inline-flex h-6 items-center rounded-[var(--md-sys-radius-sm)] border border-[var(--md-sys-outline-variant)] px-2 text-[11px] font-medium text-[var(--md-sys-on-surface-variant)]">{event.activityLabel}</span>
                        <span className="text-xs text-[var(--md-sys-outline)]">{PHASE_LABELS[event.phase]}</span>
                      </div>
                      <DemoTurnMarkdown content={event.content} />
                    </div>
                  </article>
                )
              })
            )}
          </div>

          {status === 'completed' && (
            <div className="border-t border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-tertiary-container)] p-6 text-center text-[var(--md-sys-on-tertiary-container)]">
              <p className="text-base font-medium">튜토리얼 프로젝트가 완성되었습니다.</p>
              <p className="mx-auto mt-1 max-w-xl text-sm leading-6 opacity-90">프로젝트 화면에서 19개 활동의 AI 교사 협의, 검토·수정 기록과 산출물을 확인하고 전체 튜토리얼을 내려받을 수 있습니다. 수업 실행 자료는 시뮬레이션입니다.</p>
              <MD3Button variant="filled" tone="green" className="mt-4" trailing={<ExternalLink size={16} />} onClick={() => router.push(`/projects/${id}`)}>
                완성된 프로젝트 열기
              </MD3Button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

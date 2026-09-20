'use client'

import { getProject } from '@/lib/firebase/projects'
import { getDemoActivityContract } from '@/lib/activity/demo-contracts'
import { ACTIVITY_META, STAGES, displayActivityCode, type ActivityCode, type Message, type Project } from '@/types'
import type { DemoDiscussionTurn, DemoEngineConfig, DemoPriorArtifacts, DemoTurnInput, DemoTurnPhase, DemoTurnResponse } from './types'
import {
  acquireLiveDemoLease, beginLiveDemoActivity, commitDemoTurn, completeLiveDemoActivity,
  finishLiveDemoProject, loadDemoJournal, patchLiveDemoRun, releaseLiveDemoLease,
  renewLiveDemoLease, saveLiveDemoArtifact, totalDemoTurns, turnsPerActivity,
} from './project'

export interface DemoEngineEvent {
  id: string
  activityCode: ActivityCode
  activityLabel: string
  stageLabel: string
  phase: DemoTurnPhase | 'activity-complete' | 'complete'
  speaker: string
  content: string
  completedTurns: number
  totalTurns: number
  percent: number
}
export interface DemoRunOptions {
  signal: AbortSignal
  onEvent?: (event: DemoEngineEvent) => void
  onCheckpoint?: (completedTurns: number, activityIndex: number) => void
}
const ALL_ACTIVITIES = STAGES.flatMap(stage => stage.activities)
const MAX_REVISION_ROUNDS = 2
class DemoNonRetryableError extends Error {}

function assertRunning(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('데모 실행이 일시정지되었습니다.', 'AbortError')
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('데모 실행이 일시정지되었습니다.', 'AbortError')); return }
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('데모 실행이 일시정지되었습니다.', 'AbortError')) }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
function compactText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.length > max ? `${text.slice(0, max)}…[이후 내용은 저장 산출물 참조]` : text
}
export function buildPriorArtifacts(project: Project): DemoPriorArtifacts {
  const codes = ALL_ACTIVITIES.filter(code => project.artifacts?.[code])
  const sections = codes.reduce((sum, code) => sum + Object.keys(project.artifacts![code].content).length + 1, 0)
  // Every earlier activity survives, including T agreements used by E reflection.
  // A fair section budget keeps long materials from evicting learner/vision data.
  const fullMaterial = project.artifacts?.['DI-1-1']?.content['개발 자료 목록']
  const observations = project.artifacts?.['DI-2-1']?.content['주요 상황 기록']
  const materialBudget = (fullMaterial ? JSON.stringify(fullMaterial).length : 0)
    + (observations ? JSON.stringify(observations).length : 0)
  let perSection = Math.max(200, Math.floor((68_000 - materialBudget) / Math.max(1, sections)))
  const build = () => Object.fromEntries(codes.map(code => {
    const artifact = project.artifacts![code]
    const evidence = artifact.demoReview?.evidence ?? []
    return [code, { title: compactText(artifact.title, 200), status: artifact.status, content: Object.fromEntries(
      [...Object.entries(artifact.content), ...(evidence.length ? [['협의 근거(실제 실행 발언)', evidence.map(item => `${item.speakerName}(${item.speakerId}): “${item.quote}”`).join('\n')]] : [])]
        .map(([key, value]) => [key, compactText(value, (code === 'DI-1-1' && key === '개발 자료 목록') || (code === 'DI-2-1' && key === '주요 상황 기록') ? 12_000 : perSection)]),
    ) }]
  }))
  let result = build()
  // JSON escaping (notably tables, quotes and newlines) also consumes the API's
  // budget. Shrink values evenly instead of silently dropping older activities.
  for (let attempt = 0; JSON.stringify(result).length > 79_000 && attempt < 5; attempt += 1) {
    perSection = Math.max(20, Math.floor(perSection * 75_000 / JSON.stringify(result).length))
    result = build()
  }
  return result
}
async function withRequestHeartbeat<T>(signal: AbortSignal, heartbeat: () => Promise<void>, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  assertRunning(signal)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  let closed = false
  let timer: number | undefined
  let rejectLease: (reason: Error) => void = () => {}
  const leaseFailure = new Promise<never>((_resolve, reject) => { rejectLease = reject })
  const tick = async () => {
    try {
      await heartbeat()
      if (!closed) timer = window.setTimeout(tick, 30_000)
    } catch (reason) {
      if (!closed) {
        // Reject before aborting: preserve the actionable ownership error rather
        // than reporting a user pause or retrying under a stale execution lease.
        rejectLease(new DemoNonRetryableError(reason instanceof Error ? reason.message : String(reason)))
        controller.abort()
      }
    }
  }
  timer = window.setTimeout(tick, 30_000)
  try {
    return await Promise.race([operation(controller.signal), leaseFailure])
  } finally {
    closed = true
    if (timer !== undefined) window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.abort()
  }
}

async function requestTurn(input: DemoTurnInput, signal: AbortSignal, heartbeat: () => Promise<void>): Promise<DemoTurnResponse> {
  let lastError: Error | null = null
  let validationFeedback: string[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertRunning(signal)
    await heartbeat()
    try {
      const { response, payload } = await withRequestHeartbeat(signal, heartbeat, async requestSignal => {
        const response = await fetch('/api/demo/turn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, ...(validationFeedback.length ? { validationFeedback } : {}) }), signal: requestSignal,
        })
        const payload = await response.json().catch(() => null) as (DemoTurnResponse & { error?: string; issues?: string[] }) | null
        return { response, payload }
      })
      assertRunning(signal)
      if (!response.ok) {
        validationFeedback = payload?.issues?.filter(issue => typeof issue === 'string' && issue.trim()).slice(0, 20).map(issue => issue.slice(0, 1000)) ?? []
        const detail = validationFeedback.length ? ` ${validationFeedback.slice(0, 3).join(' / ')}` : ''
        const message = (payload?.error || `에이전트 호출 실패 (${response.status})`) + detail
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) throw new DemoNonRetryableError(message)
        throw new Error(message)
      }
      if (!payload?.content?.trim()) throw new Error('에이전트가 빈 응답을 반환했습니다.')
      await heartbeat()
      return payload
    } catch (reason) {
      if (signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) throw reason
      if (reason instanceof DemoNonRetryableError) throw reason
      lastError = reason instanceof Error ? reason : new Error(String(reason))
      if (attempt < 2) await wait(1_000 * (attempt + 1), signal)
    }
  }
  throw lastError ?? new Error('에이전트 호출에 실패했습니다.')
}
function makeEvent(code: ActivityCode, phase: DemoEngineEvent['phase'], speaker: string, content: string, completedTurns: number, totalTurns: number): DemoEngineEvent {
  return {
    id: `${code}-${phase}-${completedTurns}`, activityCode: code,
    activityLabel: `${displayActivityCode(code)} · ${ACTIVITY_META[code].label}`,
    stageLabel: STAGES.find(stage => stage.code === ACTIVITY_META[code].stage)?.label ?? ACTIVITY_META[code].stage,
    phase, speaker, content, completedTurns, totalTurns,
    percent: Math.min(phase === 'complete' ? 100 : 99, Math.round(completedTurns / Math.max(1, totalTurns) * 100)),
  }
}
function buildCumulativeReport(project: Project, config: DemoEngineConfig): string {
  return `# ${config.lesson.title} — 멀티에이전트 협력 수업설계 보고서

## 실행 개요
- 주제: ${config.lesson.topic}
- 대상: ${config.lesson.schoolLevel} ${config.lesson.gradeGroup}, ${config.lesson.totalSessions}차시
- 교사 AI: ${config.personas.map(persona => `${persona.displayName}(${persona.subject})`).join(', ')}
- 실행: 활동별 세부 과제 제시 → 교사별 독립 활동 → 동료 응답 → 공동 초안 → 전원 검토 → 필요 시 수정·재검토 → 전원 승인

${STAGES.map(stage => `## ${stage.code} · ${stage.label}\n\n${project.stageReports?.[stage.code]?.content ?? '활동별 확정 산출물과 대화 기록을 참조하세요.'}`).join('\n\n')}

## 적용 전 확인
실제 모델 호출로 수행한 교사 페르소나 시뮬레이션이며 실제 교사·학생의 참여나 교실 효과를 입증하지 않습니다. DI·E의 모의 관찰과 학생 반응은 검토용 가상 증거입니다. 성취기준, 출처, 지역 데이터, 학교 여건을 담당 교사가 확인한 후 적용하세요. 각 활동의 대화와 버전별 초안·검토 기록은 프로젝트에 보존됩니다.`
}

export async function runLiveMultiAgentDemo(projectId: string, ownerUid: string, config: DemoEngineConfig, _startActivityIndex: number, options: DemoRunOptions): Promise<void> {
  const { signal, onEvent, onCheckpoint } = options
  assertRunning(signal)
  const initial = await getProject(projectId)
  if (!initial) throw new Error('데모 프로젝트를 찾을 수 없습니다.')
  if (initial.createdBy !== ownerUid) throw new Error('프로젝트 생성자만 데모 실행을 제어할 수 있습니다.')
  const hasExistingWork = (initial.demoRun?.completedTurns ?? 0) > 0
    || Boolean(initial.demoRun?.startedAt)
    || Object.keys(initial.artifacts ?? {}).length > 0
  if (initial.demoRun?.engineVersion !== 2 && hasExistingWork) {
    throw new Error('이전 버전에서 실행한 프로젝트는 기존 기록을 보존하기 위해 이어 실행하지 않습니다. 새 데모 프로젝트를 만들어 주세요.')
  }
  const runId = await acquireLiveDemoLease(projectId, ownerUid)
  let completedTurns = 0
  let totalTurns = totalDemoTurns(config.personas.length)
  const heartbeat = async () => { assertRunning(signal); await renewLiveDemoLease(projectId, runId); assertRunning(signal) }
  try {
    assertRunning(signal)
    await patchLiveDemoRun(projectId, { status: 'running', engineVersion: 2, totalTurns, error: null, ...(initial.demoRun?.startedAt ? {} : { startedAt: Date.now() }) }, runId)
    // Persisted artifacts/journals, not a stale UI checkpoint, determine resumption.
    for (let activityIndex = 0; activityIndex < ALL_ACTIVITIES.length; activityIndex += 1) {
      await heartbeat()
      const activityCode = ALL_ACTIVITIES[activityIndex], next = ALL_ACTIVITIES[activityIndex + 1]
      const project = await getProject(projectId)
      if (!project) throw new Error('실행 중 프로젝트가 삭제되었습니다.')
      const journal = await loadDemoJournal(projectId, activityCode)
      const baseTurns = turnsPerActivity(config.personas.length, activityCode)
      const existingRevisionCount = Object.keys(journal).filter(key => key.includes('orchestrator-revision')).length
      totalTurns += existingRevisionCount * (config.personas.length + 1)
      if (project.artifacts?.[activityCode]?.status === 'confirmed') {
        const review = project.artifacts[activityCode].demoReview
        const approvedBy = review?.approvedBy ?? []
        if (!review?.simulated || approvedBy.length !== config.personas.length
          || !config.personas.every(teacher => approvedBy.includes(teacher.id))) {
          throw new Error(`${displayActivityCode(activityCode)} 확정 산출물에 교사 전원의 검토·승인 기록이 없습니다. 기존 산출물을 완료로 처리하지 않고 보존했습니다.`)
        }
        completedTurns += Object.keys(journal).length || baseTurns
        await completeLiveDemoActivity(projectId, runId, activityCode, next)
        onCheckpoint?.(completedTurns, activityIndex + 1)
        continue
      }
      await beginLiveDemoActivity(projectId, activityIndex, activityCode, ACTIVITY_META[activityCode].stage, completedTurns, runId)
      const priorArtifacts = buildPriorArtifacts(project)
      delete priorArtifacts[activityCode]
      const discussion: DemoDiscussionTurn[] = []

      const turn = async (phase: DemoTurnPhase, visible: DemoDiscussionTurn[], extra: Partial<DemoTurnInput> = {}) => {
        const teacher = config.personas.find(persona => persona.id === extra.teacherId)
        const key = `live-v2-${activityCode}-${extra.stepId ?? 'joint'}-${phase}-${extra.teacherId ?? 'orchestrator'}-${extra.round ?? 0}`
        await heartbeat()
        const result = journal[key] ?? await requestTurn({ phase, activityCode, config, priorArtifacts, discussion: visible, ...extra }, signal, heartbeat)
        assertRunning(signal)
        const message: Omit<Message, 'id' | 'createdAt'> = {
          role: teacher ? 'user' : 'assistant', content: result.content, activityCode,
          activityType: phase === 'orchestrator-intro' ? '제시' : phase === 'teacher-review' ? '점검' : teacher ? '공유·협의' : '생성',
          actorType: teacher ? '교사팀협의' : '팀+AI', cycleNumber: 1,
          ...(teacher ? { userId: teacher.id, displayName: teacher.displayName } : { agentType: 'orchestrator' as const }),
        }
        await commitDemoTurn(projectId, runId, activityCode, key, result, message)
        journal[key] = result
        const item: DemoDiscussionTurn = {
          phase, speakerId: teacher?.id ?? 'orchestrator', speakerName: teacher?.displayName ?? '총괄 AI', content: result.content,
          ...(extra.stepId ? { stepId: extra.stepId } : {}), ...(extra.round !== undefined ? { round: extra.round } : {}),
          ...(result.review ? { review: result.review } : {}), ...(result.references ? { references: result.references } : {}),
        }
        discussion.push(item)
        completedTurns += 1
        assertRunning(signal)
        await patchLiveDemoRun(projectId, { phase, completedTurns, totalTurns }, runId)
        onEvent?.(makeEvent(activityCode, phase, item.speakerName, result.content, completedTurns, totalTurns))
        onCheckpoint?.(completedTurns, activityIndex)
        return result
      }

      for (const step of getDemoActivityContract(activityCode).steps) {
        await turn('orchestrator-intro', [...discussion], { stepId: step.id })
        const independentContext = [...discussion]
        // Sequential network calls prevent orphan workers after failure; frozen
        // context still preserves independent teacher thinking within each step.
        for (const teacher of config.personas) await turn('teacher-contribution', independentContext, { stepId: step.id, teacherId: teacher.id })
      }
      const responseContext = [...discussion]
      for (const teacher of config.personas) await turn('teacher-response', responseContext, { teacherId: teacher.id })
      let proposal = await turn('orchestrator-synthesis', [...discussion], { round: 0 })
      let approved = false
      for (let round = 0; round <= MAX_REVISION_ROUNDS; round += 1) {
        if (!proposal.artifact || !Object.keys(proposal.artifact.content).length) throw new Error(`${displayActivityCode(activityCode)} 공동 산출물이 없습니다.`)
        assertRunning(signal)
        await saveLiveDemoArtifact(projectId, runId, activityCode, {
          status: 'in_review', title: proposal.artifact.title, content: proposal.artifact.content, version: round + 1,
          demoReview: { approvedBy: [], round, simulated: true },
        })
        const reviewContext = [...discussion]
        const approvedBy: string[] = []
        for (const teacher of config.personas) {
          const review = await turn('teacher-review', reviewContext, { teacherId: teacher.id, round, candidateArtifact: proposal.artifact })
          if (review.review?.decision === 'approve') approvedBy.push(teacher.id)
        }
        if (approvedBy.length === config.personas.length) {
          const evidence = config.personas.flatMap(teacher =>
            ['teacher-contribution', 'teacher-response', 'teacher-review'].flatMap(phase => {
              const utterance = discussion.findLast(item => item.speakerId === teacher.id && item.phase === phase)
              return utterance ? [{ speakerId: teacher.id, speakerName: teacher.displayName, quote: utterance.content.slice(0, 220) }] : []
            }),
          )
          assertRunning(signal)
          await saveLiveDemoArtifact(projectId, runId, activityCode, {
            status: 'confirmed', title: proposal.artifact.title, content: proposal.artifact.content, version: round + 1,
            confirmedBy: 'demo-teacher-team', confirmedAt: Date.now(), demoReview: { approvedBy, round, simulated: true, evidence },
          })
          approved = true
          break
        }
        if (round === MAX_REVISION_ROUNDS) break
        if (round >= existingRevisionCount) totalTurns += config.personas.length + 1
        proposal = await turn('orchestrator-revision', [...discussion], { round: round + 1, candidateArtifact: proposal.artifact })
      }
      if (!approved) throw new Error(`${displayActivityCode(activityCode)}에서 2회 수정 후에도 교사 전원 승인이 이루어지지 않았습니다. 검토 중인 초안과 이견을 보존했습니다.`)
      const boundary = !next || ACTIVITY_META[next].stage !== ACTIVITY_META[activityCode].stage
      assertRunning(signal)
      await completeLiveDemoActivity(projectId, runId, activityCode, next, boundary ? proposal.stageReport?.content || proposal.content : undefined)
      await patchLiveDemoRun(projectId, { activityIndex: activityIndex + 1, activityCode: next ?? activityCode, completedTurns, totalTurns }, runId)
      onEvent?.(makeEvent(activityCode, 'activity-complete', '실행 엔진', `${displayActivityCode(activityCode)} 공동 산출물을 교사 AI 전원이 검토·승인했습니다.`, completedTurns, totalTurns))
      onCheckpoint?.(completedTurns, activityIndex + 1)
    }
    await heartbeat()
    const completed = await getProject(projectId)
    if (!completed) throw new Error('완료 보고서를 만들 프로젝트를 찾을 수 없습니다.')
    assertRunning(signal)
    await patchLiveDemoRun(projectId, { completedTurns, totalTurns: completedTurns }, runId)
    await finishLiveDemoProject(projectId, runId, buildCumulativeReport(completed, config))
    onEvent?.(makeEvent('E-2-1', 'complete', '실행 엔진', '19개 활동의 실제 모델 대화, 공동 검토·승인, 산출물 저장을 완료했습니다.', completedTurns, completedTurns))
    onCheckpoint?.(completedTurns, ALL_ACTIVITIES.length)
  } catch (reason) {
    // Only the owner of the active lease may mark its run failed/paused.
    await patchLiveDemoRun(projectId, {
      status: signal.aborted ? 'paused' : 'failed', completedTurns, totalTurns,
      error: signal.aborted ? null : reason instanceof Error ? reason.message : String(reason),
    }, runId).catch(() => {})
    throw reason
  } finally {
    await releaseLiveDemoLease(projectId, runId).catch(() => {})
  }
}

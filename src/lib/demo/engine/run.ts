'use client'

import {
  advanceActivity,
  deleteActivityMessages,
  getProject,
  saveCumulativeReport,
  saveMessage,
  saveStageReport,
  setActivityStatus,
  setProjectArtifact,
} from '@/lib/firebase/projects'
import {
  ACTIVITY_META,
  STAGES,
  displayActivityCode,
  type ActivityCode,
  type Project,
} from '@/types'
import type {
  DemoDiscussionTurn,
  DemoEngineConfig,
  DemoPriorArtifacts,
  DemoTeacherPersona,
  DemoTurnPhase,
  DemoTurnResponse,
} from './types'
import {
  beginLiveDemoActivity,
  finishLiveDemoProject,
  patchLiveDemoRun,
  turnsPerActivity,
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

const ALL_ACTIVITIES = STAGES.flatMap((stage) => stage.activities)

function assertRunning(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('데모 실행이 일시정지되었습니다.', 'AbortError')
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('데모 실행이 일시정지되었습니다.', 'AbortError'))
      return
    }
    const timeoutId = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeoutId)
      reject(new DOMException('데모 실행이 일시정지되었습니다.', 'AbortError'))
    }, { once: true })
  })
}

function compactText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function buildPriorArtifacts(project: Project): DemoPriorArtifacts {
  // Firestore map 필드의 열거 순서는 활동 진행 순서를 보장하지 않는다.
  // T-CID 활동 순서로 다시 정렬한 뒤 가장 가까운 산출물을 전달해야
  // 후속 에이전트가 직전 합의를 안정적으로 이어받을 수 있다.
  const entries = ALL_ACTIVITIES
    .filter((code) => project.artifacts?.[code])
    .map((code) => [code, project.artifacts![code]] as const)
  const result: DemoPriorArtifacts = {}

  for (const [rawCode, artifact] of entries.slice(-10)) {
    const code = rawCode as ActivityCode
    result[code] = {
      title: compactText(artifact.title, 200),
      status: artifact.status,
      content: Object.fromEntries(
        Object.entries(artifact.content ?? {})
          .slice(0, 8)
          .map(([key, value]) => [key, compactText(value, 700)]),
      ),
    }
  }

  return result
}

async function requestTurn(
  phase: DemoTurnPhase,
  activityCode: ActivityCode,
  config: DemoEngineConfig,
  priorArtifacts: DemoPriorArtifacts,
  discussion: DemoDiscussionTurn[],
  signal: AbortSignal,
  teacherId?: string,
): Promise<DemoTurnResponse> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertRunning(signal)
    try {
      const response = await fetch('/api/demo/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase,
          activityCode,
          config,
          priorArtifacts,
          discussion,
          ...(teacherId ? { teacherId } : {}),
        }),
        signal,
      })
      const payload = await response.json().catch(() => null) as (DemoTurnResponse & { error?: string }) | null
      if (!response.ok) {
        throw new Error(payload?.error || `에이전트 호출 실패 (${response.status})`)
      }
      if (!payload?.content?.trim()) throw new Error('에이전트가 빈 응답을 반환했습니다.')
      return payload
    } catch (reason) {
      if (signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) throw reason
      lastError = reason instanceof Error ? reason : new Error(String(reason))
      if (attempt < 2) await wait(1_000 * (attempt + 1), signal)
    }
  }

  throw lastError ?? new Error('에이전트 호출에 실패했습니다.')
}

async function mapWithConcurrency<T>(
  items: DemoTeacherPersona[],
  concurrency: number,
  task: (persona: DemoTeacherPersona, index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}

function stageLabel(activityCode: ActivityCode): string {
  const stage = STAGES.find((item) => item.code === ACTIVITY_META[activityCode].stage)
  return stage?.label ?? ACTIVITY_META[activityCode].stage
}

function makeEvent(
  activityCode: ActivityCode,
  phase: DemoEngineEvent['phase'],
  speaker: string,
  content: string,
  completedTurns: number,
  totalTurns: number,
): DemoEngineEvent {
  return {
    id: `${activityCode}-${phase}-${completedTurns}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    activityCode,
    activityLabel: `${displayActivityCode(activityCode)} · ${ACTIVITY_META[activityCode].label}`,
    stageLabel: stageLabel(activityCode),
    phase,
    speaker,
    content,
    completedTurns,
    totalTurns,
    percent: Math.min(100, Math.round((completedTurns / totalTurns) * 100)),
  }
}

function buildCumulativeReport(project: Project, config: DemoEngineConfig): string {
  const reports = STAGES.map((stage) => {
    const report = project.stageReports?.[stage.code]?.content
    return `## ${stage.code} · ${stage.label}\n\n${report || '단계 요약은 활동별 산출물에서 확인할 수 있습니다.'}`
  }).join('\n\n')

  return `# ${config.lesson.title} — 멀티에이전트 협력 수업설계 보고서

## 실행 개요

- 주제: ${config.lesson.topic}
- 대상: ${config.lesson.schoolLevel} ${config.lesson.gradeGroup}
- 융합 교과: ${config.lesson.subjects.join(', ')}
- 총 차시: ${config.lesson.totalSessions}차시
- 참여 교사 에이전트: ${config.personas.map((persona) => `${persona.displayName}(${persona.subject})`).join(', ')}
- 실행 방식: 총괄 AI 제시 → 교사별 독립 제안 → 동료 의견 기반 상호 응답 → 합의·산출물 생성

${reports}

## 검토 안내

이 보고서는 실제 AI 에이전트 실행으로 생성된 데모 초안입니다. 성취기준, 지역 데이터, 학교 여건은 실제 수업 적용 전에 담당 교사가 원자료와 대조해 최종 확인해야 합니다.`
}

function buildStageReportFallback(
  project: Project,
  activityCode: ActivityCode,
): string {
  const artifact = project.artifacts?.[activityCode]
  const sections = Object.entries(artifact?.content ?? {})
    .map(([key, value]) => `- **${key}**: ${compactText(value, 1_200)}`)
    .join('\n')
  return `# ${stageLabel(activityCode)} 단계 실행 요약\n\n${sections || '확정 산출물을 프로젝트에서 확인하세요.'}\n\n> 이 요약은 중단 복구 과정에서 확정된 마지막 활동 산출물을 기준으로 재구성되었습니다.`
}

export async function runLiveMultiAgentDemo(
  projectId: string,
  ownerUid: string,
  config: DemoEngineConfig,
  startActivityIndex: number,
  options: DemoRunOptions,
): Promise<void> {
  const { signal, onEvent, onCheckpoint } = options
  const perActivity = turnsPerActivity(config.personas.length)
  const totalTurns = perActivity * ALL_ACTIVITIES.length
  let completedTurns = Math.max(0, Math.min(totalTurns, startActivityIndex * perActivity))

  const initialProject = await getProject(projectId)
  if (!initialProject) throw new Error('데모 프로젝트를 찾을 수 없습니다.')
  if (initialProject.createdBy !== ownerUid) throw new Error('프로젝트 생성자만 데모 실행을 제어할 수 있습니다.')

  await patchLiveDemoRun(projectId, {
    status: 'running',
    completedTurns,
    totalTurns,
    error: null,
    ...(initialProject.demoRun?.startedAt ? {} : { startedAt: Date.now() }),
  })

  for (let activityIndex = startActivityIndex; activityIndex < ALL_ACTIVITIES.length; activityIndex += 1) {
    assertRunning(signal)
    const activityCode = ALL_ACTIVITIES[activityIndex]
    const activityMeta = ACTIVITY_META[activityCode]
    const project = await getProject(projectId)
    if (!project) throw new Error('실행 중 프로젝트가 삭제되었습니다.')

    if (project.artifacts?.[activityCode]?.status === 'confirmed') {
      await setActivityStatus(projectId, activityCode, 'completed')
      const stage = STAGES.find((item) => item.code === activityMeta.stage)
      const isStageBoundary = stage?.activities.at(-1) === activityCode
      if (isStageBoundary && !project.stageReports?.[activityMeta.stage]) {
        await saveStageReport(
          projectId,
          activityMeta.stage,
          buildStageReportFallback(project, activityCode),
        )
      }
      completedTurns = Math.max(completedTurns, (activityIndex + 1) * perActivity)
      onCheckpoint?.(completedTurns, activityIndex + 1)
      continue
    }

    // 중단된 활동은 대화만 비우고 처음부터 다시 실행한다. 확정된 이전 활동은 보존한다.
    await deleteActivityMessages(projectId, activityCode)
    await beginLiveDemoActivity(
      projectId,
      activityIndex,
      activityCode,
      activityMeta.stage,
      completedTurns,
    )

    const priorArtifacts = buildPriorArtifacts(project)
    const discussion: DemoDiscussionTurn[] = []

    const intro = await requestTurn(
      'orchestrator-intro',
      activityCode,
      config,
      priorArtifacts,
      discussion,
      signal,
    )
    await saveMessage(projectId, activityCode, {
      role: 'assistant',
      content: intro.content,
      activityCode,
      activityType: '제시',
      actorType: '팀+AI',
      agentType: 'orchestrator',
      cycleNumber: 1,
    }, `live-${activityCode}-intro`)
    discussion.push({
      phase: 'orchestrator-intro',
      speakerId: 'orchestrator',
      speakerName: '총괄 AI',
      content: intro.content,
    })
    completedTurns += 1
    await patchLiveDemoRun(projectId, { phase: 'teacher-contribution', completedTurns })
    onEvent?.(makeEvent(activityCode, 'orchestrator-intro', '총괄 AI', intro.content, completedTurns, totalTurns))
    onCheckpoint?.(completedTurns, activityIndex)

    const contributions = await mapWithConcurrency(config.personas, 2, async (persona, personaIndex) => {
      const result = await requestTurn(
        'teacher-contribution',
        activityCode,
        config,
        priorArtifacts,
        discussion,
        signal,
        persona.id,
      )
      await saveMessage(projectId, activityCode, {
        role: 'user',
        content: result.content,
        activityCode,
        activityType: '공유·협의',
        actorType: '교사팀협의',
        userId: persona.id,
        displayName: persona.displayName,
        cycleNumber: 1,
      }, `live-${activityCode}-contribution-${personaIndex + 1}`)
      completedTurns += 1
      onEvent?.(makeEvent(activityCode, 'teacher-contribution', persona.displayName, result.content, completedTurns, totalTurns))
      onCheckpoint?.(completedTurns, activityIndex)
      return {
        phase: 'teacher-contribution' as const,
        speakerId: persona.id,
        speakerName: persona.displayName,
        content: result.content,
      }
    })
    discussion.push(...contributions)
    await patchLiveDemoRun(projectId, { phase: 'teacher-response', completedTurns })

    const responses = await mapWithConcurrency(config.personas, 2, async (persona, personaIndex) => {
      const result = await requestTurn(
        'teacher-response',
        activityCode,
        config,
        priorArtifacts,
        discussion,
        signal,
        persona.id,
      )
      await saveMessage(projectId, activityCode, {
        role: 'user',
        content: result.content,
        activityCode,
        activityType: '조정',
        actorType: '교사팀협의',
        userId: persona.id,
        displayName: persona.displayName,
        cycleNumber: 1,
      }, `live-${activityCode}-response-${personaIndex + 1}`)
      completedTurns += 1
      onEvent?.(makeEvent(activityCode, 'teacher-response', persona.displayName, result.content, completedTurns, totalTurns))
      onCheckpoint?.(completedTurns, activityIndex)
      return {
        phase: 'teacher-response' as const,
        speakerId: persona.id,
        speakerName: persona.displayName,
        content: result.content,
      }
    })
    discussion.push(...responses)

    await patchLiveDemoRun(projectId, { phase: 'orchestrator-synthesis', completedTurns })
    const synthesis = await requestTurn(
      'orchestrator-synthesis',
      activityCode,
      config,
      priorArtifacts,
      discussion,
      signal,
    )
    if (!synthesis.artifact || Object.keys(synthesis.artifact.content ?? {}).length === 0) {
      throw new Error(`${displayActivityCode(activityCode)} 총괄 AI가 산출물을 만들지 못했습니다.`)
    }
    await saveMessage(projectId, activityCode, {
      role: 'assistant',
      content: synthesis.content,
      activityCode,
      activityType: '생성',
      actorType: '팀+AI',
      agentType: 'orchestrator',
      cycleNumber: 1,
    }, `live-${activityCode}-synthesis`)
    completedTurns += 1
    onEvent?.(makeEvent(activityCode, 'orchestrator-synthesis', '총괄 AI', synthesis.content, completedTurns, totalTurns))

    await setProjectArtifact(projectId, activityCode, {
      status: 'confirmed',
      title: synthesis.artifact.title || `${activityMeta.label} 산출물`,
      content: synthesis.artifact.content,
      version: 1,
      confirmedBy: ownerUid,
      confirmedAt: Date.now(),
    })

    const nextActivity = ALL_ACTIVITIES[activityIndex + 1]
    const isStageBoundary = !nextActivity || ACTIVITY_META[nextActivity].stage !== activityMeta.stage
    if (isStageBoundary) {
      await saveStageReport(
        projectId,
        activityMeta.stage,
        synthesis.stageReport?.content.trim() || synthesis.content,
      )
    }

    if (nextActivity) {
      await advanceActivity(
        projectId,
        ALL_ACTIVITIES,
        activityCode,
        nextActivity,
        ACTIVITY_META[nextActivity].stage !== activityMeta.stage
          ? ACTIVITY_META[nextActivity].stage
          : undefined,
      )
    } else {
      await setActivityStatus(projectId, activityCode, 'completed')
    }

    await patchLiveDemoRun(projectId, {
      phase: nextActivity ? 'orchestrator-intro' : 'orchestrator-synthesis',
      activityIndex: activityIndex + 1,
      activityCode: nextActivity ?? activityCode,
      completedTurns,
    })
    onEvent?.(makeEvent(
      activityCode,
      'activity-complete',
      '실행 엔진',
      `${displayActivityCode(activityCode)} 활동의 협의와 산출물 저장이 완료되었습니다.`,
      completedTurns,
      totalTurns,
    ))
    onCheckpoint?.(completedTurns, activityIndex + 1)
  }

  assertRunning(signal)
  const completedProject = await getProject(projectId)
  if (!completedProject) throw new Error('완료 보고서를 만들 프로젝트를 찾을 수 없습니다.')
  await saveCumulativeReport(projectId, buildCumulativeReport(completedProject, config), ownerUid)
  await finishLiveDemoProject(projectId)
  onEvent?.(makeEvent(
    'E-2-1',
    'complete',
    '실행 엔진',
    '19개 활동의 실제 에이전트 협의, 산출물, 단계 보고서 생성이 모두 완료되었습니다.',
    totalTurns,
    totalTurns,
  ))
  onCheckpoint?.(totalTurns, ALL_ACTIVITIES.length)
}

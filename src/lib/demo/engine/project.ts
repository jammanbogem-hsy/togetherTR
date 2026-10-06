'use client'

import { collection, doc, getDocs, runTransaction, serverTimestamp, updateDoc, type Transaction } from 'firebase/firestore'
import type { UserProfile } from '@/lib/auth'
import { db } from '@/lib/firebase/config'
import { createProject } from '@/lib/firebase/projects'
import { addJoinedProjectId } from '@/lib/inviteCode'
import { ACTIVITY_META, STAGES, type ActivityCode, type Message, type Project, type StageCode } from '@/types'
import { getDemoActivityContract } from '@/lib/activity/demo-contracts'
import type { DemoEngineConfig, DemoRunState, DemoTurnResponse } from './types'
import { nextArtifactUpdatedAt } from '@/lib/artifacts/artifactUpdatedAt'

export const LIVE_DEMO_SCENARIO_ID = 'live-multi-agent-demo-v1'

export function turnsPerActivity(teacherCount: number, activityCode: ActivityCode = 'T-1-1'): number {
  return getDemoActivityContract(activityCode).steps.length * (1 + teacherCount) + 1 + 2 * teacherCount
}

export function totalDemoTurns(teacherCount: number, activityCount = 19): number {
  return STAGES.flatMap(stage => stage.activities).slice(0, activityCount)
    .reduce((sum, code) => sum + turnsPerActivity(teacherCount, code), 0)
}

function withUniquePersonaIds(config: DemoEngineConfig): DemoEngineConfig {
  const runSuffix = Date.now().toString(36)
  return {
    ...config,
    personas: config.personas.map((persona, index) => ({
      ...persona,
      id: `demo-agent-${runSuffix}-${index + 1}`,
    })),
  }
}

export async function createLiveDemoProject(
  owner: UserProfile,
  rawConfig: DemoEngineConfig,
): Promise<string> {
  const config = withUniquePersonaIds(rawConfig)
  const now = Date.now()
  const personaUids = config.personas.map((persona) => persona.id)
  const firstActivity: ActivityCode = 'T-1-1'
  const totalTurns = totalDemoTurns(config.personas.length)

  const memberInfo = Object.fromEntries([
    [
      owner.uid,
      {
        uid: owner.uid,
        displayName: owner.displayName,
        color: owner.color || '#5B8DEF',
        emoji: owner.emoji || '👩‍🏫',
        joinedAt: now,
        role: '프로젝트 소유자·데모 관찰자',
        expertise: '멀티에이전트 협력 설계 과정을 관찰하고 결과를 검토합니다.',
      },
    ],
    ...config.personas.map((persona) => [
      persona.id,
      {
        uid: persona.id,
        displayName: persona.displayName,
        color: persona.color,
        emoji: persona.emoji,
        joinedAt: now,
        role: `${persona.subject} 교사 에이전트 · ${persona.career}`,
        expertise: persona.summary,
      },
    ] as const),
  ])

  const demoRun: DemoRunState = {
    engineVersion: 2,
    status: 'ready',
    config,
    activityIndex: 0,
    activityCode: firstActivity,
    phase: 'orchestrator-intro',
    completedTurns: 0,
    totalTurns,
    updatedAt: now,
  }

  const projectData = {
    title: `라이브 데모 · ${config.lesson.title}`,
    mode: 'collaborative' as const,
    schoolLevel: config.lesson.schoolLevel,
    targetGradeGroup: config.lesson.gradeGroup,
    targetSubjects: config.lesson.subjects,
    createdBy: owner.uid,
    hostUid: owner.uid,
    memberUids: [owner.uid, ...personaUids],
    memberInfo,
    currentStage: 'T' as const,
    currentCycle: 1,
    currentActivity: firstActivity,
    activityStatuses: { [firstActivity]: 'in_progress' as const },
    status: 'active' as const,
    isECompleted: false,
    isA23Completed: false,
    cycleCount: 1,
    started: true,
    metadata: {
      semester: `${new Date().getFullYear()}-데모`,
      totalSessions: config.lesson.totalSessions,
    },
    demoExperience: {
      scenarioId: LIVE_DEMO_SCENARIO_ID,
      generatedAt: now,
      personaUids,
    },
    demoRun,
  }

  const { id } = await createProject(
    projectData as Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  )
  addJoinedProjectId(id)
  return id
}

export async function patchLiveDemoRun(
  projectId: string,
  patch: Partial<Omit<DemoRunState, 'config'>>,
  runId?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    'demoRun.updatedAt': Date.now(),
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) updates[`demoRun.${key}`] = value
  }

  if (runId) await updateWithLease(projectId, runId, updates)
  else await runTransaction(db, async transaction => {
    const ref = doc(db, 'projects', projectId)
    const snapshot = await transaction.get(ref)
    const lease = snapshot.data()?.demoRun?.lease
    // Observer tabs cannot replace another runner's state, including its failures.
    if (lease?.runId && lease.expiresAt > Date.now()) return
    transaction.update(ref, updates)
  })
}

export async function beginLiveDemoActivity(
  projectId: string,
  activityIndex: number,
  activityCode: ActivityCode,
  stage: StageCode,
  completedTurns: number,
  runId?: string,
): Promise<void> {
  const updates = {
    currentActivity: activityCode,
    currentStage: stage,
    [`activityStatuses.${activityCode}`]: 'in_progress',
    'demoRun.status': 'running',
    'demoRun.activityIndex': activityIndex,
    'demoRun.activityCode': activityCode,
    'demoRun.phase': 'orchestrator-intro',
    'demoRun.completedTurns': completedTurns,
    'demoRun.error': null,
    'demoRun.updatedAt': Date.now(),
    updatedAt: serverTimestamp(),
  }
  if (runId) await updateWithLease(projectId, runId, updates)
  else await updateDoc(doc(db, 'projects', projectId), updates)
}

export async function finishLiveDemoProject(projectId: string, runId: string, report: string): Promise<void> {
  await updateWithLease(projectId, runId, {
    status: 'completed',
    currentStage: 'E',
    currentActivity: 'E-2-1',
    isECompleted: true,
    'activityStatuses.E-2-1': 'completed',
    'demoRun.status': 'completed',
    'demoRun.activityIndex': 19,
    'demoRun.completedAt': Date.now(),
    'demoRun.updatedAt': Date.now(),
    cumulativeReport: { content: report, savedAt: Date.now(), savedBy: 'demo-teacher-team' },
    updatedAt: serverTimestamp(),
  })
}

// TTL exceeds a single provider timeout; renewal happens before and after every call.
// Every engine write checks the lease in its own transaction, so a stale tab cannot
// commit a late response after a new runner acquires the project.
const LEASE_TTL_MS = 180_000

async function readWithLease(transaction: Transaction, projectId: string, runId: string) {
  const ref = doc(db, 'projects', projectId)
  const snapshot = await transaction.get(ref)
  if (!snapshot.exists()) throw new Error('데모 프로젝트를 찾을 수 없습니다.')
  const lease = snapshot.data().demoRun?.lease
  if (lease?.runId !== runId || lease.expiresAt <= Date.now()) {
    throw new Error('이 탭의 실행권이 만료되었습니다. 다른 실행 탭을 확인한 뒤 다시 시작해 주세요.')
  }
  return { ref, project: snapshot.data() as Project }
}

async function updateWithLease(projectId: string, runId: string, updates: Record<string, unknown>): Promise<void> {
  await runTransaction(db, async transaction => {
    const { ref } = await readWithLease(transaction, projectId, runId)
    transaction.update(ref, { ...updates, 'demoRun.lease.expiresAt': Date.now() + LEASE_TTL_MS })
  })
}

export async function acquireLiveDemoLease(projectId: string, ownerUid: string): Promise<string> {
  const runId = crypto.randomUUID()
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'projects', projectId)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists()) throw new Error('데모 프로젝트를 찾을 수 없습니다.')
    const data = snapshot.data()
    if (data.createdBy !== ownerUid) throw new Error('프로젝트 생성자만 실행할 수 있습니다.')
    if (data.demoRun?.lease?.runId && data.demoRun.lease.expiresAt > Date.now()) {
      throw new Error('이 프로젝트가 다른 탭에서 이미 실행 중입니다. 해당 탭에서 일시정지하거나 실행권 만료 후 재개해 주세요.')
    }
    transaction.update(ref, { 'demoRun.lease': { runId, expiresAt: Date.now() + LEASE_TTL_MS } })
  })
  return runId
}

export async function renewLiveDemoLease(projectId: string, runId: string): Promise<void> {
  await updateWithLease(projectId, runId, {})
}

export async function releaseLiveDemoLease(projectId: string, runId: string): Promise<void> {
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'projects', projectId)
    const snapshot = await transaction.get(ref)
    if (snapshot.exists() && snapshot.data().demoRun?.lease?.runId === runId) {
      transaction.update(ref, { 'demoRun.lease': { runId: '', expiresAt: 0 } })
    }
  })
}

export async function loadDemoJournal(projectId: string, code: ActivityCode): Promise<Record<string, DemoTurnResponse>> {
  // Existing, membership-protected messages path: no new security-rule deployment.
  const snapshot = await getDocs(collection(db, `projects/${projectId}/conversations/${code}/messages`))
  const result: Record<string, DemoTurnResponse> = {}
  for (const entry of snapshot.docs) {
    const data = entry.data()
    if (data.demoEngineVersion === 2 && data.demoTurnResponse?.content) result[entry.id] = data.demoTurnResponse
  }
  return result
}

export async function commitDemoTurn(
  projectId: string, runId: string, code: ActivityCode, key: string,
  response: DemoTurnResponse, message: Omit<Message, 'id' | 'createdAt'>,
): Promise<void> {
  await runTransaction(db, async transaction => {
    const { ref } = await readWithLease(transaction, projectId, runId)
    const messageRef = doc(db, `projects/${projectId}/conversations/${code}/messages`, key)
    const existing = await transaction.get(messageRef)
    if (!existing.exists()) {
      transaction.set(messageRef, {
        ...JSON.parse(JSON.stringify(message)), createdAt: serverTimestamp(),
        demoEngineVersion: 2, demoTurnResponse: JSON.parse(JSON.stringify(response)),
      })
    }
    transaction.update(ref, { 'demoRun.lease.expiresAt': Date.now() + LEASE_TTL_MS })
  })
}

export async function saveLiveDemoArtifact(
  projectId: string, runId: string, code: ActivityCode,
  artifact: NonNullable<Project['artifacts']>[string],
): Promise<void> {
  await runTransaction(db, async transaction => {
    const { ref, project } = await readWithLease(transaction, projectId, runId)
    const previous = project.artifacts?.[code]
    // The durable message journal holds every proposal. Keep only changed artifact
    // versions here rather than copying the same draft on each resume/approval.
    const versions = [...(previous?.versions ?? [])]
    if (previous && JSON.stringify(previous.content) !== JSON.stringify(artifact.content)) {
      versions.push({ version: previous.version, content: previous.content, savedAt: Date.now(), savedBy: 'demo-teacher-team' })
    }
    transaction.update(ref, {
      [`artifacts.${code}`]: JSON.parse(JSON.stringify({
        ...artifact, versions: versions.slice(-3), _schemaVersion: 'v2-sections',
        updatedAt: nextArtifactUpdatedAt(previous, artifact, Date.now()),
      })),
      ...(code === 'A-2-3' ? { isA23Completed: artifact.status === 'confirmed' } : {}),
      'demoRun.lease.expiresAt': Date.now() + LEASE_TTL_MS,
      updatedAt: serverTimestamp(),
    })
  })
}

export async function completeLiveDemoActivity(
  projectId: string, runId: string, code: ActivityCode, next?: ActivityCode, report?: string,
): Promise<void> {
  await updateWithLease(projectId, runId, {
    [`activityStatuses.${code}`]: 'completed',
    ...(next ? { currentActivity: next, currentStage: ACTIVITY_META[next].stage, [`activityStatuses.${next}`]: 'in_progress' } : {}),
    ...(report ? { [`stageReports.${ACTIVITY_META[code].stage}`]: { content: report, savedAt: Date.now() } } : {}),
    updatedAt: serverTimestamp(),
  })
}

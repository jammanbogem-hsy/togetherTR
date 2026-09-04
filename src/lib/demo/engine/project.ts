'use client'

import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import type { UserProfile } from '@/lib/auth'
import { db } from '@/lib/firebase/config'
import { createProject } from '@/lib/firebase/projects'
import { addJoinedProjectId } from '@/lib/inviteCode'
import type { ActivityCode, Project, StageCode } from '@/types'
import type { DemoEngineConfig, DemoRunState } from './types'

export const LIVE_DEMO_SCENARIO_ID = 'live-multi-agent-demo-v1'

export function turnsPerActivity(teacherCount: number): number {
  return 2 + teacherCount * 2
}

export function totalDemoTurns(teacherCount: number, activityCount = 19): number {
  return turnsPerActivity(teacherCount) * activityCount
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
): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    'demoRun.updatedAt': Date.now(),
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) updates[`demoRun.${key}`] = value
  }

  await updateDoc(doc(db, 'projects', projectId), updates)
}

export async function beginLiveDemoActivity(
  projectId: string,
  activityIndex: number,
  activityCode: ActivityCode,
  stage: StageCode,
  completedTurns: number,
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
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
  })
}

export async function finishLiveDemoProject(projectId: string): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    status: 'completed',
    currentStage: 'E',
    currentActivity: 'E-2-1',
    isECompleted: true,
    'activityStatuses.E-2-1': 'completed',
    'demoRun.status': 'completed',
    'demoRun.activityIndex': 19,
    'demoRun.completedAt': Date.now(),
    'demoRun.updatedAt': Date.now(),
    updatedAt: serverTimestamp(),
  })
}

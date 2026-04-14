'use client'

import { ACTIVITY_META, STAGES, type ActivityCode, type Project } from '@/types'
import {
  createProject,
  saveMessage,
  setProjectArtifact,
  advanceActivity,
  saveStageReport,
  saveProblemSituationData,
  saveGraphData,
  setActivityStatus,
} from '@/lib/firebase/projects'
import { addJoinedProjectId } from '@/lib/inviteCode'
import type { UserProfile } from '@/lib/auth'
import { DEMO_ACTIVITY_SEEDS, DEMO_PERSONAS, DEMO_PROJECT_TITLE, DEMO_STAGE_REPORTS } from './scenario'

export interface DemoProgress {
  percent: number
  stageLabel: string
  activityLabel: string
  detail: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stageLabel(code: Project['currentStage']) {
  return STAGES.find((stage) => stage.code === code)?.label ?? code
}

export async function createDemoProject(
  owner: UserProfile,
  onProgress?: (progress: DemoProgress) => void,
): Promise<string> {
  const personaInfo = Object.fromEntries(
    DEMO_PERSONAS.map((persona) => [
      persona.uid,
      {
        uid: persona.uid,
        displayName: persona.displayName,
        color: persona.color,
        emoji: persona.emoji,
        joinedAt: Date.now(),
      },
    ])
  )

  const { id: projectId } = await createProject({
    title: DEMO_PROJECT_TITLE,
    mode: 'collaborative',
    schoolLevel: '초등학교',
    targetGradeGroup: '초5-6',
    targetSubjects: ['사회', '도덕', '국어', '실과'],
    createdBy: owner.uid,
    hostUid: DEMO_PERSONAS[1].uid,
    memberUids: DEMO_PERSONAS.map((persona) => persona.uid),
    memberInfo: personaInfo,
    currentStage: 'T',
    currentCycle: 1,
    currentActivity: DEMO_ACTIVITY_SEEDS[0].code,
    status: 'active',
    isECompleted: false,
    isA23Completed: false,
    cycleCount: 1,
    started: true,
    metadata: {
      semester: '2026-2',
      totalSessions: 4,
    },
    demoExperience: {
      scenarioId: 'elementary-resource-circulation-demo',
      generatedAt: Date.now(),
      personaUids: DEMO_PERSONAS.map((persona) => persona.uid),
    },
  })

  addJoinedProjectId(projectId)

  const allActivities = STAGES.flatMap((stage) => stage.activities)
  const totalSteps = DEMO_ACTIVITY_SEEDS.length + Object.keys(DEMO_STAGE_REPORTS).length + 1
  let completedSteps = 0

  function publishProgress(code: ActivityCode, detail: string) {
    const meta = ACTIVITY_META[code]
    const percent = Math.max(5, Math.min(99, Math.round((completedSteps / totalSteps) * 100)))
    onProgress?.({
      percent,
      stageLabel: stageLabel(meta.stage),
      activityLabel: meta.label,
      detail,
    })
  }

  for (let index = 0; index < DEMO_ACTIVITY_SEEDS.length; index++) {
    const seed = DEMO_ACTIVITY_SEEDS[index]
    publishProgress(seed.code, '데모 대화와 산출물을 생성하는 중입니다.')

    for (const message of seed.messages) {
      const persona = DEMO_PERSONAS.find((item) => item.uid === message.speaker)
      await saveMessage(projectId, seed.code, {
        role: message.role,
        content: message.content,
        activityCode: seed.code,
        activityType: message.activityType ?? (message.role === 'assistant' ? '생성' : '공유·협의'),
        agentType: message.role === 'assistant'
          ? (message.agentType ?? 'orchestrator')
          : undefined,
        userId: message.role === 'user' ? persona?.uid : undefined,
        displayName: message.role === 'user' ? persona?.displayName : undefined,
      })
      await sleep(20)
    }

    if (seed.graphData) {
      await saveGraphData(projectId, seed.graphData)
    }

    if (seed.problemSituationData) {
      await saveProblemSituationData(projectId, seed.problemSituationData)
    }

    await setProjectArtifact(projectId, seed.code, {
      status: 'confirmed',
      title: seed.artifact.title,
      content: seed.artifact.content,
      version: 1,
      confirmedBy: owner.uid,
      confirmedAt: Date.now(),
    })

    const next = DEMO_ACTIVITY_SEEDS[index + 1]
    const isStageBoundary = !next || next.stage !== seed.stage
    if (isStageBoundary) {
      await saveStageReport(projectId, seed.stage, DEMO_STAGE_REPORTS[seed.stage])
    }

    if (next) {
      const nextStage = next.stage !== seed.stage ? next.stage : undefined
      await advanceActivity(projectId, allActivities, seed.code, next.code, nextStage)
    }

    completedSteps += 1

    if (isStageBoundary) {
      completedSteps += 1
    }
  }

  const finalActivity = DEMO_ACTIVITY_SEEDS[DEMO_ACTIVITY_SEEDS.length - 1].code
  await setActivityStatus(projectId, finalActivity, 'completed')

  onProgress?.({
    percent: 100,
    stageLabel: '평가',
    activityLabel: ACTIVITY_META[finalActivity].label,
    detail: '데모 프로젝트 준비가 완료되었습니다. 결과 화면으로 이동합니다.',
  })

  return projectId
}

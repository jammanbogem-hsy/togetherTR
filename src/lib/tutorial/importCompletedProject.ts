'use client'

import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import type { UserProfile } from '@/lib/auth'
import { db } from '@/lib/firebase/config'
import {
  advanceActivity,
  deleteActivityMessages,
  getProject,
  markECompleted,
  saveCumulativeReport,
  saveMessage,
  saveStageReport,
  setActivityStatus,
  setProjectArtifact,
} from '@/lib/firebase/projects'
import {
  ACTIVITY_META,
  STAGES,
  type ActivityCode,
  type ActivityType,
  type AgentType,
  type Project,
  type StageCode,
} from '@/types'
import {
  CHEUGUGI_ACTIVITY_SEEDS,
  CHEUGUGI_CUMULATIVE_REPORT,
  CHEUGUGI_PERSONAS,
  CHEUGUGI_TUTORIAL_SCENARIO_ID,
  CHEUGUGI_STAGE_REPORTS,
  CHEUGUGI_TUTORIAL_PROJECT_ID,
} from './cheugugiProject'

export const CHEUGUGI_TUTORIAL_TITLE = '튜토리얼 · 측우기 데이터로 우리 학교의 비를 읽다'
export { CHEUGUGI_TUTORIAL_SCENARIO_ID }

export function isCompletedCheugugiTutorial(
  project: Pick<Project, 'demoExperience'> | null | undefined,
): boolean {
  if (project?.demoExperience?.scenarioId !== CHEUGUGI_TUTORIAL_SCENARIO_ID) return false
  const expected = CHEUGUGI_PERSONAS.map((persona) => persona.uid).sort()
  const actual = [...(project.demoExperience.personaUids ?? [])].sort()
  return expected.length === actual.length
    && expected.every((uid, index) => uid === actual[index])
}

export interface TutorialImportProgress {
  percent: number
  stageLabel: string
  activityLabel: string
  detail: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getStageLabel(stageCode: StageCode): string {
  return STAGES.find((stage) => stage.code === stageCode)?.label ?? stageCode
}

function validateTutorialData(allActivities: ActivityCode[]) {
  if (CHEUGUGI_PERSONAS.length !== 2) {
    throw new Error(`초대 교사 에이전트는 정확히 2명이어야 합니다. 현재 ${CHEUGUGI_PERSONAS.length}명입니다.`)
  }

  const personaUids = CHEUGUGI_PERSONAS.map((persona) => persona.uid)
  if (new Set(personaUids).size !== personaUids.length) {
    throw new Error('교사 페르소나 UID가 중복되었습니다.')
  }
  const allowedTeacherSpeakers = new Set([
    'owner',
    ...CHEUGUGI_PERSONAS.flatMap((persona) => [persona.uid, persona.displayName]),
  ])

  if (CHEUGUGI_ACTIVITY_SEEDS.length !== allActivities.length) {
    throw new Error(
      `튜토리얼 활동은 ${allActivities.length}개여야 합니다. 현재 ${CHEUGUGI_ACTIVITY_SEEDS.length}개입니다.`,
    )
  }

  allActivities.forEach((activityCode, index) => {
    const seed = CHEUGUGI_ACTIVITY_SEEDS[index]
    if (seed.code !== activityCode) {
      throw new Error(`${index + 1}번째 활동이 ${activityCode} 순서와 일치하지 않습니다.`)
    }
    if (seed.stage !== ACTIVITY_META[activityCode].stage) {
      throw new Error(`${activityCode} 활동의 단계 코드가 올바르지 않습니다.`)
    }
    if (!seed.messages.some((message) => message.role === 'user')) {
      throw new Error(`${activityCode} 활동에 교사 대화가 없습니다.`)
    }
    if (!seed.messages.some((message) => message.role === 'assistant')) {
      throw new Error(`${activityCode} 활동에 AI 퍼실리테이터 대화가 없습니다.`)
    }
    const unknownTeacher = seed.messages.find(
      (message) => message.role === 'user' && !allowedTeacherSpeakers.has(message.speaker),
    )
    if (unknownTeacher) {
      throw new Error(`${activityCode} 활동에 등록되지 않은 교사 발화자(${unknownTeacher.speaker})가 있습니다.`)
    }
    for (const persona of CHEUGUGI_PERSONAS) {
      const participated = seed.messages.some(
        (message) => message.role === 'user'
          && (message.speaker === persona.uid || message.speaker === persona.displayName),
      )
      if (!participated) {
        throw new Error(`${activityCode} 활동에 ${persona.displayName}의 실제 협의 발화가 없습니다.`)
      }
    }
  })

  if (!CHEUGUGI_ACTIVITY_SEEDS[0].messages.some(
    (message) => message.role === 'user' && message.speaker === 'owner',
  )) {
    throw new Error('첫 활동에 현재 접속 교사의 프로젝트 시작 요청이 없습니다.')
  }

  for (const stage of STAGES) {
    if (!CHEUGUGI_STAGE_REPORTS[stage.code]?.trim()) {
      throw new Error(`${stage.code} 단계 보고서가 비어 있습니다.`)
    }
  }

  if (!CHEUGUGI_CUMULATIVE_REPORT.trim()) {
    throw new Error('누적 설계 보고서가 비어 있습니다.')
  }
}

/**
 * 이미 만들어진 실프로젝트 한 곳에 실제 멀티 에이전트 협의 기록을 적재한다.
 *
 * 완료 마커는 모든 쓰기가 끝난 뒤에만 남긴다. 중간에 네트워크 오류가 나면 다음
 * 실행에서 각 활동 메시지를 먼저 비우고 다시 적재하므로 부분 실패도 안전하게 복구된다.
 */
export async function importCompletedCheugugiProject(
  owner: UserProfile,
  onProgress?: (progress: TutorialImportProgress) => void,
): Promise<string> {
  const allActivities = STAGES.flatMap((stage) => stage.activities)
  validateTutorialData(allActivities)

  const project = await getProject(CHEUGUGI_TUTORIAL_PROJECT_ID)
  if (!project) {
    throw new Error(`대상 프로젝트(${CHEUGUGI_TUTORIAL_PROJECT_ID})를 찾을 수 없습니다.`)
  }
  if (project.createdBy !== owner.uid) {
    throw new Error('이 가져오기는 대상 프로젝트를 만든 계정으로만 실행할 수 있습니다.')
  }
  if (isCompletedCheugugiTutorial(project)) {
    throw new Error('이 튜토리얼 프로젝트는 이미 완성되어 있습니다. 중복으로 가져오지 않았습니다.')
  }
  if (project.publicStatus?.isPublic) {
    throw new Error('공개 중인 프로젝트는 튜토리얼로 교체하지 않습니다. 먼저 공개를 해제해 주세요.')
  }

  const allowedExistingMembers = new Set([
    owner.uid,
    'tutorial-kim-haneul',
    ...CHEUGUGI_PERSONAS.map((persona) => persona.uid),
  ])
  const unexpectedMembers = (project.memberUids ?? []).filter(
    (uid) => !allowedExistingMembers.has(uid),
  )
  if (unexpectedMembers.length > 0) {
    throw new Error('실제 팀원이 참여 중인 프로젝트는 튜토리얼 데이터로 덮어쓰지 않습니다.')
  }

  const isPriorCheugugiTutorial = project.demoExperience?.scenarioId
    ?.startsWith('cheugugi-data-collaborative-tutorial-') === true
  const isEmptyOwnedTarget = (project.memberUids ?? [owner.uid]).every((uid) => uid === owner.uid)
    && Object.keys(project.artifacts ?? {}).length === 0
  if (!isPriorCheugugiTutorial && !isEmptyOwnedTarget) {
    throw new Error('비어 있거나 이전 측우기 튜토리얼인 대상 프로젝트만 교체할 수 있습니다.')
  }

  const messageUnits = CHEUGUGI_ACTIVITY_SEEDS.reduce(
    (sum, seed) => sum + seed.messages.length,
    0,
  )
  const totalUnits = allActivities.length + messageUnits + CHEUGUGI_ACTIVITY_SEEDS.length + STAGES.length + 4
  let completedUnits = 0

  const publish = (
    stage: StageCode,
    activityCode: ActivityCode,
    detail: string,
    forcePercent?: number,
  ) => {
    const calculated = Math.round((completedUnits / totalUnits) * 100)
    onProgress?.({
      percent: forcePercent ?? Math.max(1, Math.min(99, calculated)),
      stageLabel: getStageLabel(stage),
      activityLabel: ACTIVITY_META[activityCode].label,
      detail,
    })
  }

  const firstActivity = allActivities[0]
  publish('T', firstActivity, '대상 프로젝트와 튜토리얼 데이터를 확인했습니다.', 1)

  // 재시도 시 이전 실행의 일부 메시지가 섞이지 않도록, 모든 활동 대화를 먼저 정리한다.
  for (const activityCode of allActivities) {
    publish(ACTIVITY_META[activityCode].stage, activityCode, '기존 활동 대화를 정리하는 중입니다.')
    await deleteActivityMessages(CHEUGUGI_TUTORIAL_PROJECT_ID, activityCode)
    completedUnits += 1
  }

  const joinedAt = Date.now()
  const personaInfo = Object.fromEntries([
    [
      owner.uid,
      {
        uid: owner.uid,
        displayName: owner.displayName,
        color: owner.color || '#5B8DEF',
        emoji: owner.emoji || '👩‍🏫',
        role: '현재 접속 교사·프로젝트 방장',
        expertise: '학교 맥락을 제공하고 고위험 결정과 최종 산출물을 승인한다.',
        joinedAt,
      },
    ],
    ...CHEUGUGI_PERSONAS.map((persona) => [
      persona.uid,
      {
        uid: persona.uid,
        displayName: persona.displayName,
        color: persona.color,
        emoji: persona.emoji,
        role: persona.role,
        expertise: persona.expertise,
        joinedAt,
      },
    ] as const),
  ])

  // 프로젝트의 초대 코드는 보존하고, 실제 실행 결과에 해당하는 필드만 초기화한다.
  await updateDoc(doc(db, 'projects', CHEUGUGI_TUTORIAL_PROJECT_ID), {
    title: CHEUGUGI_TUTORIAL_TITLE,
    mode: 'collaborative',
    schoolLevel: '초등학교',
    targetGradeGroup: '초5-6',
    targetSubjects: ['국어', '수학', '사회', '과학'],
    createdBy: owner.uid,
    hostUid: owner.uid,
    memberUids: [owner.uid, ...CHEUGUGI_PERSONAS.map((persona) => persona.uid)],
    memberInfo: personaInfo,
    currentStage: 'T',
    currentActivity: firstActivity,
    currentCycle: 1,
    cycleCount: 1,
    status: 'active',
    started: true,
    isECompleted: false,
    isA23Completed: false,
    activityStatuses: { [firstActivity]: 'in_progress' },
    artifacts: {},
    stageReports: {},
    cumulativeReport: deleteField(),
    metadata: {
      semester: '2026-2',
      weeklyHours: 3,
      totalSessions: 10,
    },
    updatedAt: serverTimestamp(),
  })

  for (let index = 0; index < CHEUGUGI_ACTIVITY_SEEDS.length; index += 1) {
    const seed = CHEUGUGI_ACTIVITY_SEEDS[index]
    const next = CHEUGUGI_ACTIVITY_SEEDS[index + 1]

    for (let messageIndex = 0; messageIndex < seed.messages.length; messageIndex += 1) {
      const message = seed.messages[messageIndex]
      const participant = message.role === 'user'
        ? message.speaker === 'owner'
          ? { uid: owner.uid, displayName: owner.displayName }
          : CHEUGUGI_PERSONAS.find(
            (candidate) => candidate.uid === message.speaker || candidate.displayName === message.speaker,
          )
        : undefined

      if (message.role === 'user' && !participant) {
        throw new Error(`${seed.code}의 ${messageIndex + 1}번째 교사 발화자를 찾을 수 없습니다.`)
      }

      publish(
        seed.stage,
        seed.code,
        `협력 대화 ${messageIndex + 1}/${seed.messages.length}을 저장하는 중입니다.`,
      )
      await saveMessage(CHEUGUGI_TUTORIAL_PROJECT_ID, seed.code, {
        role: message.role,
        content: message.content,
        activityCode: seed.code,
        activityType: (message.activityType as ActivityType | undefined)
          ?? (message.role === 'assistant' ? '조정' : '공유·협의'),
        actorType: message.role === 'assistant' ? '팀+AI' : '교사팀협의',
        agentType: message.role === 'assistant'
          ? ((message.agentType as AgentType | undefined) ?? 'orchestrator')
          : undefined,
        userId: participant?.uid,
        displayName: participant?.displayName,
        cycleNumber: 1,
      })
      completedUnits += 1
      await sleep(15)
    }

    publish(seed.stage, seed.code, '합의된 활동 산출물을 확정하는 중입니다.')
    await setProjectArtifact(CHEUGUGI_TUTORIAL_PROJECT_ID, seed.code, {
      status: 'confirmed',
      title: seed.artifact.title,
      content: seed.artifact.content,
      version: 1,
      confirmedBy: owner.uid,
      confirmedAt: Date.now(),
    })
    completedUnits += 1

    const isStageBoundary = !next || next.stage !== seed.stage
    if (isStageBoundary) {
      publish(seed.stage, seed.code, `${getStageLabel(seed.stage)} 단계 보고서를 저장하는 중입니다.`)
      await saveStageReport(
        CHEUGUGI_TUTORIAL_PROJECT_ID,
        seed.stage,
        CHEUGUGI_STAGE_REPORTS[seed.stage],
      )
      completedUnits += 1
    }

    if (next) {
      await advanceActivity(
        CHEUGUGI_TUTORIAL_PROJECT_ID,
        allActivities,
        seed.code,
        next.code,
        next.stage !== seed.stage ? next.stage : undefined,
      )
    }
  }

  const finalActivity: ActivityCode = 'E-2-1'
  publish('E', finalActivity, '최종 활동 상태와 평가 주기를 마무리하는 중입니다.')
  await setActivityStatus(CHEUGUGI_TUTORIAL_PROJECT_ID, finalActivity, 'completed')
  completedUnits += 1

  await markECompleted(CHEUGUGI_TUTORIAL_PROJECT_ID)
  completedUnits += 1

  await saveCumulativeReport(
    CHEUGUGI_TUTORIAL_PROJECT_ID,
    CHEUGUGI_CUMULATIVE_REPORT,
    owner.uid,
  )
  completedUnits += 1

  // 완료 마커는 마지막에 쓴다. 이 값이 있어야 다음 실행을 중복으로 판단한다.
  await updateDoc(doc(db, 'projects', CHEUGUGI_TUTORIAL_PROJECT_ID), {
    currentStage: 'E',
    currentActivity: finalActivity,
    status: 'completed',
    started: true,
    isECompleted: true,
    demoExperience: {
      scenarioId: CHEUGUGI_TUTORIAL_SCENARIO_ID,
      generatedAt: Date.now(),
      personaUids: CHEUGUGI_PERSONAS.map((persona) => persona.uid),
    },
    updatedAt: serverTimestamp(),
  })
  completedUnits += 1

  publish('E', finalActivity, '19개 활동의 대화·산출물·보고서 저장이 완료되었습니다.', 100)
  return CHEUGUGI_TUTORIAL_PROJECT_ID
}

/**
 * 공개 보고서 배포·해제 헬퍼.
 *
 * 아키텍처:
 *  - 원본: `projects/{projectId}` (멤버 전용)
 *  - 공개 스냅샷: `public_reports/{projectId}` (인증 없이 read)
 *
 * 민감 데이터 분리 원칙:
 *  - 원본 프로젝트를 공개 노출하지 않는다. "공개 배포" 시 필요한 필드만
 *    추려서 `public_reports`에 **별도 문서**로 복사한다.
 *  - 이렇게 하면 Firestore rules를 단순화할 수 있고 (public_reports는 전부 공개),
 *    원본 프로젝트의 룰 한 줄 실수로 채팅/UID가 유출될 위험이 없다.
 *
 * 포함 필드:
 *  - projectTitle, schoolLevel, targetGradeGroup, targetSubjects
 *  - cycleCount, memberCount (익명 — 이름·UID 제외)
 *  - stageReports, cumulativeReport (보고서는 이미 비식별 콘텐츠)
 *
 * 제외 필드 (의도적으로 복사 안 함):
 *  - memberUids, memberInfo, hostUid, createdBy
 *  - inviteCode
 *  - conversations/{…}/messages (서브컬렉션 자체를 복사하지 않음)
 *  - artifacts 내부의 proposedBy/confirmedBy
 *  - 일체의 실시간 상태 (streamingState, teamDiscussions, optionVotes 등)
 */

import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './config'
import type { Project, PublicReport } from '@/types'

export const PUBLIC_REPORTS_COLLECTION = 'public_reports'

function assertHostPermission(project: Project, uid: string): void {
  const hostUid = project.hostUid ?? project.createdBy
  if (hostUid !== uid) {
    throw new Error('기록 담당만 공개 링크를 관리할 수 있습니다.')
  }
}

function buildPublicReport(project: Project, projectId: string): PublicReport {
  const base: PublicReport = {
    projectId,
    projectTitle: project.title,
    publishedAt: Date.now(),
    schoolLevel: project.schoolLevel,
    targetGradeGroup: project.targetGradeGroup,
    targetSubjects: project.targetSubjects ?? [],
    cycleCount: project.cycleCount ?? 1,
    memberCount: (project.memberUids ?? []).length || 1,
  }
  if (project.stageReports && Object.keys(project.stageReports).length > 0) {
    // content/savedAt만 추려 snapshot에 복사 (현재 스키마도 이 두 필드만이지만 방어적으로 명시)
    const cleaned: NonNullable<PublicReport['stageReports']> = {}
    for (const [stage, data] of Object.entries(project.stageReports)) {
      if (!data) continue
      cleaned[stage as keyof typeof cleaned] = {
        content: data.content,
        savedAt: data.savedAt,
      }
    }
    if (Object.keys(cleaned).length > 0) base.stageReports = cleaned
  }
  if (project.cumulativeReport?.content) {
    base.cumulativeReport = {
      content: project.cumulativeReport.content,
      savedAt: project.cumulativeReport.savedAt,
    }
  }
  return base
}

/**
 * 프로젝트의 현재 보고서들을 공개 스냅샷으로 배포(또는 재배포).
 * - 이미 `public_reports/{projectId}`가 있으면 덮어쓰기 → "업데이트" 동작
 * - 보고서가 하나도 없으면 에러
 */
export async function publishProjectReports(projectId: string, uid: string): Promise<void> {
  const projectRef = doc(db, 'projects', projectId)
  const projectSnap = await getDoc(projectRef)
  if (!projectSnap.exists()) {
    throw new Error('프로젝트를 찾을 수 없습니다.')
  }
  const project = projectSnap.data() as Project
  assertHostPermission(project, uid)

  const hasStage = !!project.stageReports && Object.keys(project.stageReports).length > 0
  const hasCumulative = !!project.cumulativeReport?.content
  if (!hasStage && !hasCumulative) {
    throw new Error('배포할 보고서가 없습니다. 단계 보고서나 종합 보고서를 먼저 생성해 주세요.')
  }

  const publicData = buildPublicReport(project, projectId)
  // Firestore는 undefined 허용 X
  const clean = Object.fromEntries(
    Object.entries(publicData).filter(([, v]) => v !== undefined)
  )

  const publicRef = doc(db, PUBLIC_REPORTS_COLLECTION, projectId)
  await setDoc(publicRef, clean)

  // 원본 프로젝트에 공개 상태 기록
  await updateDoc(projectRef, {
    publicStatus: { isPublic: true, lastPublishedAt: publicData.publishedAt },
    updatedAt: serverTimestamp(),
  })
}

/**
 * 공개 해제 — 공개 문서 삭제 + 원본 상태 업데이트.
 */
export async function unpublishProjectReports(projectId: string, uid: string): Promise<void> {
  const projectRef = doc(db, 'projects', projectId)
  const projectSnap = await getDoc(projectRef)
  if (!projectSnap.exists()) {
    throw new Error('프로젝트를 찾을 수 없습니다.')
  }
  const project = projectSnap.data() as Project
  assertHostPermission(project, uid)

  const publicRef = doc(db, PUBLIC_REPORTS_COLLECTION, projectId)
  await deleteDoc(publicRef)

  await updateDoc(projectRef, {
    publicStatus: { isPublic: false },
    updatedAt: serverTimestamp(),
  })
}

/**
 * 공개 보고서 조회 — 인증 없이 호출 가능 (rules에서 read 허용).
 * 존재하지 않으면 null.
 */
export async function getPublicReport(projectId: string): Promise<PublicReport | null> {
  const publicRef = doc(db, PUBLIC_REPORTS_COLLECTION, projectId)
  const snap = await getDoc(publicRef)
  if (!snap.exists()) return null
  const data = snap.data() as Omit<PublicReport, 'projectId'>
  return { projectId, ...data }
}

/**
 * 공개 링크 URL 생성 — 현재 origin 기반. SSR 환경에서는 빈 문자열 반환.
 */
export function getPublicReportUrl(projectId: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/public/reports/${projectId}`
}

/**
 * 자동 재배포 — 보고서 저장 훅.
 * 프로젝트가 현재 "공개 중"(publicStatus.isPublic === true)이고 호출자가 호스트면
 * public_reports 스냅샷을 최신 보고서로 덮어쓴다. 그 외에는 조용히 반환.
 *
 * - 실패(권한·네트워크·문서없음)는 삼킨다. 원 save 연산이 성공했다는 가정하에
 *   "자동 동기화"는 best-effort로만 동작하도록 설계. 호스트가 다시 모달 열면
 *   "업데이트 필요" 배너로 복구 경로 제공.
 * - 비용: getDoc 1회 + (공개 중일 때만) publishProjectReports 내부 getDoc/set/update.
 */
export async function autoSyncIfPublic(projectId: string, uid: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, 'projects', projectId))
    if (!snap.exists()) return
    const project = snap.data() as Project
    if (!project.publicStatus?.isPublic) return
    const hostUid = project.hostUid ?? project.createdBy
    if (hostUid !== uid) return
    await publishProjectReports(projectId, uid)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[publicReports] auto-sync skipped:', err)
  }
}

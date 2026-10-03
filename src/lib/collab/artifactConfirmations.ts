// 팀장 종합 진행(규칙 4-1)으로 부재 팀원 의견이 대신 정리돼 저장될 때, 당사자 확인 절차(#28).
// 순수 함수만 둔다 — Firestore 쓰기는 lib/firebase/projects.ts, 표시는 컴포넌트.
import type { ArtifactConfirmationEntry, Project } from '@/types'

type Confirmations = Project['artifactConfirmations']

export interface PendingTargetInput {
  mode?: Project['mode']
  demoRun?: boolean
  hostUid?: string
  createdBy?: string
  memberUids?: readonly string[]
  memberInfo?: Project['memberInfo']
  /** 이 활동 대화(현재 주기)에서 메시지를 보낸 사용자 uid */
  speakerUids: Iterable<string>
  activityCode: string
  version: number
  now: number
  existing?: Confirmations
}

/**
 * 산출물 저장 시 '확인 대기'로 기록할 팀원 → 기록할 항목.
 * 협업 모드·실제 팀(2명 이상)에서, 이 활동 대화에 한 번도 말하지 않은 비방장 팀원만 대상.
 * 같은 버전에 이미 확인·다시 논의 요청을 남긴 팀원은 다시 묻지 않는다(확정만 바뀐 재저장 등).
 */
export function computePendingConfirmations(input: PendingTargetInput): Record<string, ArtifactConfirmationEntry> {
  if (input.mode === 'solo' || input.demoRun) return {}
  const members = [...new Set(input.memberUids?.length ? input.memberUids : Object.keys(input.memberInfo ?? {}))]
  if (members.length < 2) return {}
  const hosts = new Set([input.hostUid, input.createdBy].filter(Boolean))
  const speakers = new Set(input.speakerUids)
  const result: Record<string, ArtifactConfirmationEntry> = {}
  for (const uid of members) {
    if (hosts.has(uid) || speakers.has(uid)) continue
    const previous = input.existing?.[uid]?.[input.activityCode as keyof NonNullable<Confirmations>[string]]
    if (previous && previous.version === input.version) continue
    result[uid] = {
      status: 'pending',
      version: input.version,
      since: input.now,
      displayName: input.memberInfo?.[uid]?.displayName ?? '팀원',
    }
  }
  return result
}

/** 새 버전이 저장되면 이전 버전에 남은 '다시 논의 요청'은 방장이 반영한 것으로 보고 정리할 팀원 uid. */
export function staleRediscussUids(confirmations: Confirmations, activityCode: string, version: number): string[] {
  return Object.entries(confirmations ?? {})
    .filter(([, entries]) => {
      const entry = entries?.[activityCode as keyof typeof entries] as ArtifactConfirmationEntry | undefined
      return entry?.status === 'rediscuss' && entry.version !== version
    })
    .map(([uid]) => uid)
}

/** 이 사용자가 확인해야 할 활동 목록(오래된 순). */
export function pendingConfirmationsForUser(confirmations: Confirmations, uid?: string | null): Array<{ activityCode: string; entry: ArtifactConfirmationEntry }> {
  if (!uid) return []
  return Object.entries(confirmations?.[uid] ?? {})
    .filter((pair): pair is [string, ArtifactConfirmationEntry] => pair[1]?.status === 'pending')
    .map(([activityCode, entry]) => ({ activityCode, entry }))
    .sort((a, b) => a.entry.since - b.entry.since)
}

/** 산출물 패널 배지용: 이 활동의 확인 대기 팀원 이름과 다시 논의 요청. */
export function confirmationSummaryForActivity(confirmations: Confirmations, activityCode: string): {
  pending: string[]
  rediscuss: Array<{ displayName: string; reason: string }>
} {
  const pending: string[] = []
  const rediscuss: Array<{ displayName: string; reason: string }> = []
  for (const entries of Object.values(confirmations ?? {})) {
    const entry = entries?.[activityCode as keyof typeof entries] as ArtifactConfirmationEntry | undefined
    if (!entry) continue
    if (entry.status === 'pending') pending.push(entry.displayName)
    if (entry.status === 'rediscuss') rediscuss.push({ displayName: entry.displayName, reason: entry.reason ?? '' })
  }
  return { pending, rediscuss }
}

export const REDISCUSS_MESSAGE_PREFIX = '[다시 논의 요청]'

export function rediscussMessage(reason: string): string {
  return `${REDISCUSS_MESSAGE_PREFIX} ${reason.trim()}`.trim()
}

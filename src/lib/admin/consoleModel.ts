// This allowlist is separate from feedback operators: only the owner can inspect all projects.
export const SUPER_ADMIN_EMAIL = 'jammanbogem@gmail.com'
export function isSuperAdmin(identity: { email?: string | null; email_verified?: boolean }) {
  return identity.email_verified === true && identity.email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL
}

export type AdminProject = {
  id: string; title: string; ownerUid: string; ownerName: string; schoolLevel: string
  gradeBands: string[]; subjects: string[]; stage: string; activity: string; status: string
  cycle: number; training: boolean; memberCount: number; createdAt: number | null; updatedAt: number | null
}
export type AdminMember = {
  uid: string; name: string; email: string; school: string; schoolLevel: string; grade: string
  createdAt: number | null; lastSignInAt: number | null; disabled: boolean; verified: boolean; hasProfile: boolean
}
export type AdminProjectDetail = AdminProject & {
  members: { uid: string; name: string; role: string }[]
  artifacts: Record<string, { title: string; status: string; content: unknown }>
  reports: { key: string; title: string; content: string }[]
  activityStatuses: Record<string, string>
}
export type AdminMessage = { id: string; role: string; name: string; content: string; createdAt: number | null; legacy: boolean }
export type AdminMessagePage = { items: AdminMessage[]; nextCursor: string | null }
export type AdminPage<T> = { items: T[]; nextCursor: string | null; total?: number }

export function mergeAdminMessages(current: AdminMessage[], incoming: AdminMessage[]): AdminMessage[] {
  const unique = new Map<string, AdminMessage>()
  for (const item of [...current, ...incoming]) {
    if (!unique.has(item.id) || !item.legacy || unique.get(item.id)!.legacy) unique.set(item.id, item)
  }
  return [...unique.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
}

export const textValue = (value: unknown) => typeof value === 'string' ? value : ''
export const recordValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
export function timeValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return timeValue(value.toMillis())
  const seconds = recordValue(value).seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}
export function projectSummary(id: string, data: Record<string, unknown>): AdminProject {
  const ownerUid = textValue(data.originalCreatedBy) || textValue(data.createdBy) || textValue(data.hostUid)
  const members = recordValue(data.memberInfo)
  const bands = strings(data.teamGradeBands)
  return {
    id, title: textValue(data.title) || '제목 없는 프로젝트', ownerUid,
    ownerName: textValue(recordValue(members[ownerUid]).displayName), schoolLevel: textValue(data.schoolLevel),
    gradeBands: bands.length ? bands : [textValue(data.targetGradeGroup)].filter(Boolean), subjects: strings(data.targetSubjects),
    stage: textValue(data.currentStage), activity: textValue(data.currentActivity), status: textValue(data.status),
    cycle: Math.max(1, Number(data.currentCycle) || 1), training: recordValue(data.trainingMode).enabled === true,
    memberCount: new Set([...strings(data.memberUids), ...Object.keys(members)]).size,
    createdAt: timeValue(data.createdAt), updatedAt: timeValue(data.updatedAt),
  }
}
export function projectDetail(id: string, data: Record<string, unknown>): AdminProjectDetail {
  const info = recordValue(data.memberInfo)
  const members = [...new Set([...strings(data.memberUids), ...Object.keys(info)])].map(uid => {
    const member = recordValue(info[uid])
    return { uid, name: textValue(member.displayName) || '이름 미등록', role: uid === data.hostUid ? '기록 담당' : textValue(member.role) || '팀원' }
  })
  const artifacts = Object.fromEntries(Object.entries(recordValue(data.artifacts)).map(([code, value]) => {
    const artifact = recordValue(value)
    return [code, { title: textValue(artifact.title), status: textValue(artifact.status), content: artifact.content ?? {} }]
  }))
  const reports = Object.entries(recordValue(data.stageReports)).flatMap(([key, value]) => {
    const content = textValue(recordValue(value).content)
    return content ? [{ key, title: `${key} 단계 보고서`, content }] : []
  })
  const cumulative = textValue(recordValue(data.cumulativeReport).content)
  if (cumulative) reports.unshift({ key: 'all', title: '종합 보고서', content: cumulative })
  const activityStatuses = Object.fromEntries(Object.entries(recordValue(data.activityStatuses)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return { ...projectSummary(id, data), members, artifacts, reports, activityStatuses }
}

export function memberSummary(user: {
  uid: string; email?: string; displayName?: string; disabled: boolean; emailVerified: boolean
  metadata: { creationTime?: string; lastSignInTime?: string }
}, profile?: Record<string, unknown>): AdminMember {
  return {
    uid: user.uid, name: textValue(profile?.displayName) || user.displayName || '이름 미등록', email: user.email || '',
    school: textValue(profile?.schoolName), schoolLevel: textValue(profile?.schoolLevel), grade: textValue(profile?.grade),
    createdAt: timeValue(user.metadata.creationTime), lastSignInAt: timeValue(user.metadata.lastSignInTime),
    disabled: user.disabled, verified: user.emailVerified, hasProfile: !!profile,
  }
}

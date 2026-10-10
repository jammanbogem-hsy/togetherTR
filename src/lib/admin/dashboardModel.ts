/**
 * Admin dashboard — pure aggregation over project summaries (no Firestore here, so it is testable).
 */
import { STAGES, type ActivityCode, type StageCode } from '@/types'
import { projectSummary, recordValue, textValue, timeValue, type AdminProject } from './consoleModel'

export type ArtifactMark = 'saved' | 'confirmed'

export interface DashboardProject extends AdminProject {
  mode: string
  started: boolean
  hostName: string
  hostIsMember: boolean
  artifacts: Partial<Record<ActivityCode, ArtifactMark>>
  /** Stage codes with a saved stage report, plus 'all' for the cumulative report. */
  reports: string[]
  messageCount: number | null
  materialCount: number | null
  flags: DashboardFlag[]
}

export type DashboardFlagKind = 'no-recorder' | 'idle' | 'stale' | 'not-started'
export interface DashboardFlag { kind: DashboardFlagKind; label: string }

export interface DashboardData {
  generatedAt: number
  totals: {
    projects: number; training: number; collaborative: number; solo: number
    members: number | null; messages: number | null; reports: number; artifacts: number
    activeHour: number; activeDay: number; activeWeek: number
  }
  stageCounts: Record<string, number>
  attention: Array<{ id: string; title: string; flags: DashboardFlag[]; updatedAt: number | null }>
  projects: DashboardProject[]
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** A room in progress with no change for this long during the day is "paused". */
export const IDLE_AFTER_MS = 30 * MINUTE
export const STALE_AFTER_MS = 7 * DAY

export const ALL_ACTIVITIES: ActivityCode[] = STAGES.flatMap(stage => stage.activities)

/** Project document → dashboard row (counts are filled in by the route). */
export function dashboardProject(id: string, data: Record<string, unknown>, now: number): DashboardProject {
  const base = projectSummary(id, data)
  const artifacts: Partial<Record<ActivityCode, ArtifactMark>> = {}
  const rawArtifacts = recordValue(data.artifacts)
  for (const code of ALL_ACTIVITIES) {
    const artifact = recordValue(rawArtifacts[code])
    if (!Object.keys(artifact).length) continue
    artifacts[code] = artifact.status === 'confirmed' ? 'confirmed' : 'saved'
  }
  const reports = Object.entries(recordValue(data.stageReports))
    .filter(([, value]) => timeValue(recordValue(value).savedAt) !== null || textValue(recordValue(value).content))
    .map(([stage]) => stage)
  if (Object.keys(recordValue(data.cumulativeReport)).length) reports.push('all')
  const hostUid = textValue(data.hostUid)
  const memberUids = Array.isArray(data.memberUids) ? data.memberUids.filter((uid): uid is string => typeof uid === 'string') : []
  const info = recordValue(data.memberInfo)
  const row: DashboardProject = {
    ...base,
    mode: textValue(data.mode),
    started: data.started === true,
    hostName: textValue(recordValue(info[hostUid]).displayName),
    hostIsMember: !!hostUid && memberUids.includes(hostUid),
    artifacts,
    reports,
    messageCount: null,
    materialCount: null,
    flags: [],
  }
  row.flags = projectFlags(row, now)
  return row
}

export function projectFlags(project: Pick<DashboardProject, 'status' | 'started' | 'updatedAt' | 'createdAt' | 'memberCount' | 'hostIsMember'>, now: number): DashboardFlag[] {
  const flags: DashboardFlag[] = []
  const inProgress = project.status !== 'completed' && project.status !== 'archived'
  if (!inProgress) return flags
  if (project.memberCount > 1 && !project.hostIsMember) flags.push({ kind: 'no-recorder', label: '기록 담당 없음' })
  if (!project.started && project.createdAt !== null && now - project.createdAt > DAY) flags.push({ kind: 'not-started', label: '시작 전 대기' })
  const idleFor = project.updatedAt === null ? null : now - project.updatedAt
  if (project.started && idleFor !== null) {
    if (idleFor > STALE_AFTER_MS) flags.push({ kind: 'stale', label: `${Math.floor(idleFor / DAY)}일째 멈춤` })
    else if (idleFor > IDLE_AFTER_MS && idleFor < DAY) flags.push({ kind: 'idle', label: `${idleFor >= HOUR ? `${Math.floor(idleFor / HOUR)}시간` : `${Math.floor(idleFor / MINUTE)}분`}째 움직임 없음` })
  }
  return flags
}

export function isSoloRow(project: Pick<DashboardProject, 'mode' | 'memberCount'>): boolean {
  return project.mode === 'solo' && project.memberCount < 2
}

export function summarizeDashboard(projects: DashboardProject[], now: number, extra: { members: number | null; messages: number | null }): DashboardData {
  const stageCounts: Record<string, number> = Object.fromEntries([...STAGES.map(stage => [stage.code, 0]), ['none', 0]])
  let activeHour = 0, activeDay = 0, activeWeek = 0, reports = 0, artifacts = 0
  for (const project of projects) {
    const stage = STAGES.some(item => item.code === project.stage) && project.started ? project.stage as StageCode : 'none'
    stageCounts[stage] += 1
    const age = project.updatedAt === null ? Infinity : now - project.updatedAt
    if (age <= HOUR) activeHour += 1
    if (age <= DAY) activeDay += 1
    if (age <= 7 * DAY) activeWeek += 1
    reports += project.reports.length
    artifacts += Object.keys(project.artifacts).length
  }
  const attention = projects
    .filter(project => project.flags.length > 0)
    // Live problems (idle today, no recorder) first, then by most recent change.
    .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map(project => ({ id: project.id, title: project.title, flags: project.flags, updatedAt: project.updatedAt }))
  return {
    generatedAt: now,
    totals: {
      projects: projects.length,
      training: projects.filter(project => project.training).length,
      solo: projects.filter(isSoloRow).length,
      collaborative: projects.filter(project => !isSoloRow(project)).length,
      members: extra.members, messages: extra.messages, reports, artifacts, activeHour, activeDay, activeWeek,
    },
    stageCounts,
    attention,
    projects: [...projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
  }
}

function rank(project: DashboardProject): number {
  if (project.flags.some(flag => flag.kind === 'idle' || flag.kind === 'no-recorder')) return 0
  if (project.flags.some(flag => flag.kind === 'not-started')) return 1
  return 2
}

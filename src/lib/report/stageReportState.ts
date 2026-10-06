import { STAGES, type Project, type StageCode } from '@/types'

export function stageHasArtifacts(project: Pick<Project, 'artifacts'>, stage: StageCode): boolean {
  return !!STAGES.find(item => item.code === stage)?.activities.some(code => !!project.artifacts?.[code])
}

export function reportTimestamp(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value && typeof value === 'object') {
    const time = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number }
    if (typeof time.toMillis === 'function') return reportTimestamp(time.toMillis())
    if (typeof time.seconds === 'number') return time.seconds * 1000 + (time.nanoseconds ?? 0) / 1e6
  }
  return 0
}

export function stageArtifactLastSavedAt(project: Pick<Project, 'artifacts'>, stage: StageCode): number {
  const activities = STAGES.find(item => item.code === stage)?.activities ?? []
  return Math.max(0, ...activities.map(code => {
    const artifact = project.artifacts?.[code]
    if (!artifact) return 0
    const legacy = artifact as typeof artifact & { updatedAt?: unknown; savedAt?: unknown; meta?: { updatedAt?: unknown } }
    return Math.max(reportTimestamp(legacy.updatedAt), reportTimestamp(legacy.savedAt), reportTimestamp(legacy.meta?.updatedAt),
      reportTimestamp(artifact.confirmedAt), ...(artifact.versions ?? []).map(version => reportTimestamp(version.savedAt)))
  }))
}

export function stageReportChanged(project: Pick<Project, 'artifacts' | 'stageReports'>, stage: StageCode): boolean {
  const report = project.stageReports?.[stage]
  return !!report && stageArtifactLastSavedAt(project, stage) > reportTimestamp(report.savedAt)
}

export function canGenerateStageReport(project: Pick<Project, 'hostUid' | 'createdBy' | 'demoRun'> | null, uid?: string): boolean {
  return !!project && !project.demoRun && !!uid && (project.hostUid === uid || project.createdBy === uid)
}

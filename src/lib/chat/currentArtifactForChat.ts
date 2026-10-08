import type { ActivityCode, Artifact, Project } from '@/types'

/** A saved local artifact may precede the project onSnapshot by one render. */
export function currentArtifactForChat(project: Project, code: ActivityCode, local: Artifact | null) {
  const stored = project.artifacts?.[code]
  if (!local || local.activityCode !== code || (stored && stored.version >= local.currentVersion)) return stored ?? null
  const content = local.status === 'confirmed' ? local.confirmedContent ?? local.aiDraft : local.aiDraft
  if (!content) return stored ?? null
  return { title: local.title, content, status: local.status, version: local.currentVersion }
}

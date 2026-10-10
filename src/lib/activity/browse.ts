/**
 * Team members browse other stages' records without moving the team (read-only viewing).
 * The recorder (host) still moves the whole team; members only change their own viewingActivity.
 */
import { ACTIVITY_META, SOLO_HIDDEN_ACTIVITIES, STAGES, type ActivityCode, type StageCode } from '@/types'

type BrowseProject = { artifacts?: Partial<Record<string, unknown>> | null }

/** Which activity to open when a member picks a stage. */
export function browseActivityForStage(stage: StageCode, project: BrowseProject, currentActivity: ActivityCode, solo = false): ActivityCode {
  if (ACTIVITY_META[currentActivity]?.stage === stage) return currentActivity
  const info = STAGES.find(item => item.code === stage)
  const activities = (info?.activities ?? []).filter(code => !solo || !SOLO_HIDDEN_ACTIVITIES.includes(code))
  // The last activity with a saved record is usually the most useful one to read first.
  const withRecord = [...activities].reverse().find(code => !!project.artifacts?.[code])
  return withRecord ?? activities[0] ?? currentActivity
}

/** Members see the stage they are browsing; the host (and everyone outside browsing) sees the team stage. */
export function sidebarStage(isHost: boolean, demoRun: boolean, viewingActivity: ActivityCode, teamStage: StageCode): StageCode {
  return demoRun || !isHost ? ACTIVITY_META[viewingActivity]?.stage ?? teamStage : teamStage
}

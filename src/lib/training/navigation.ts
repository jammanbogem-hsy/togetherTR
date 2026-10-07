import { SOLO_HIDDEN_ACTIVITIES, STAGES, type ActivityCode, type Project } from '@/types'
import { isSoloProject } from '@/lib/project/projectMode'

/** Only explicit movement requests, never a question about the next lesson/content. */
export function isTrainingNextRequest(text: string): boolean {
  const value = text.trim().replace(/[.!。！]+$/, '').trim()
  return /^(?:다음|다음으로|다음\s*(?:활동|단계)(?:으로|로)?|다음(?:\s*(?:활동|단계))?(?:으로|로)?\s*(?:넘어가(?:자|요|주세요| 주세요|겠습니다)|이동(?:해\s*주세요|하겠습니다|하자)|진행(?:해\s*주세요|하겠습니다|하자)))$/.test(value)
}

export function nextTrainingActivity(project: Project, current: ActivityCode): ActivityCode | undefined {
  const activities = STAGES.flatMap(stage => stage.activities)
    .filter(code => !isSoloProject(project) || !SOLO_HIDDEN_ACTIVITIES.includes(code))
  const index = activities.indexOf(current)
  return index >= 0 ? activities[index + 1] : undefined
}

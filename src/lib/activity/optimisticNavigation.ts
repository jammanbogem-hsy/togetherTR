import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, type ActivityCode, type Project } from '@/types'
import { finishAfterPaint, startInteraction } from '@/lib/performance/interactionMetrics'

export type NavigationTarget = Pick<Project, 'currentStage' | 'currentActivity'> & Partial<Pick<Project,
  'currentCycle' | 'cycleCount' | 'isECompleted' | 'cycleStartT11Version'>>
export interface PendingNavigation { id: number; projectId: string; target: NavigationTarget }

type Queue = { tail: Promise<void>; confirmed: NavigationTarget; latest: number; count: number }
const queues = new Map<string, Queue>()
let sequence = 0
const position = (project: Project): NavigationTarget => ({
  currentStage: project.currentStage, currentActivity: project.currentActivity,
  currentCycle: project.currentCycle, cycleCount: project.cycleCount,
  isECompleted: project.isECompleted, cycleStartT11Version: project.cycleStartT11Version,
})

/** Show immediately; serialize writes so rapid clicks cannot persist in the opposite order. */
export async function navigateOptimistically({ projectId, activity, patch, persist, kind = 'activity-navigation' }: {
  projectId: string; activity: ActivityCode; patch?: Partial<NavigationTarget>; persist: () => Promise<unknown>; kind?: string;
}): Promise<boolean> {
  const store = useProjectStore.getState()
  if (!store.project || store.project.id !== projectId) return false
  const finish = startInteraction(kind)
  let queue = queues.get(projectId)
  if (!queue) {
    queue = { tail: Promise.resolve(), confirmed: position(store.project), latest: 0, count: 0 }
    queues.set(projectId, queue)
  }
  const currentQueue = queue
  const id = ++sequence
  const target = { ...position(store.project), currentActivity: activity, currentStage: ACTIVITY_META[activity].stage, ...patch }
  currentQueue.latest = id
  currentQueue.count++
  useProjectStore.setState({ project: { ...store.project, ...target }, pendingNavigation: { id, projectId, target }, navigationError: null })
  store.setCurrentActivity(activity)
  store.setViewingActivity(activity)
  finishAfterPaint(finish)

  const work = currentQueue.tail.then(async () => {
    try {
      await persist()
      currentQueue.confirmed = target
      const latest = useProjectStore.getState()
      if (latest.project?.id === projectId && latest.pendingNavigation?.id === id) {
        useProjectStore.setState({ pendingNavigation: null })
      }
      return true
    } catch {
      const latest = useProjectStore.getState()
      if (latest.project?.id === projectId && latest.pendingNavigation?.id === id) {
        const confirmed = currentQueue.confirmed
        useProjectStore.setState({ project: { ...latest.project, ...confirmed }, pendingNavigation: null,
          navigationError: '이동 내용을 저장하지 못해 마지막으로 저장된 활동으로 돌아왔습니다. 다시 시도해 주세요.' })
        latest.setCurrentActivity(confirmed.currentActivity ?? store.currentActivity)
        latest.setViewingActivity(confirmed.currentActivity ?? store.viewingActivity)
      }
      return false
    } finally {
      currentQueue.count--
      if (!currentQueue.count && queues.get(projectId) === currentQueue) queues.delete(projectId)
    }
  })
  currentQueue.tail = work.then(() => {})
  return work
}

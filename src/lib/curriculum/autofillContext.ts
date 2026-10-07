import { STAGES, type Project } from '@/types'
import { serializeArtifactForPrompt } from '@/lib/artifacts/serializeArtifactForPrompt'
import { isTrainingSystemText } from '@/lib/training/trainingMode'

export const AUTOFILL_CONTEXT_LIMIT = 1500
const TOPIC_KEYS = ['최종 선정 주제', 'selectedTopic', '최종선정주제', '선택 주제', '주제'] as const
const RATIONALE_KEYS = ['선정 근거', 'rationale'] as const
const bounded = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, Math.floor(limit / 3))}\n…\n${value.slice(-(limit - Math.floor(limit / 3) - 3))}`
function textField(content: Record<string, unknown> | undefined, keys: readonly string[]): string {
  for (const key of keys) if (typeof content?.[key] === 'string' && content[key].trim()) return content[key].trim()
  return ''
}

/** 명시 선정값만 주제로 삼는다. 이전 예시·대화 문자열을 주제명으로 추측하지 않는다. */
export function resolveAutofillTopic(artifact?: Record<string, unknown>, requestTopic?: unknown): string {
  return bounded(textField(artifact, TOPIC_KEYS) || (typeof requestTopic === 'string' ? requestTopic.trim() : ''), 600)
}

export function normalizeAutofillArtifact(artifact?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!artifact) return undefined
  const topic = resolveAutofillTopic(artifact)
  return { ...artifact, ...(topic ? { selectedTopic: topic } : {}) }
}

type ContextMessage = { role: string; content: string; activityCode?: string; cycleNumber?: number }
type ContextProject = Pick<Project, 'id' | 'artifacts' | 'targetSubjects' | 'currentActivity' | 'currentCycle'>

/** 최신 명시 주제 → 선정 근거 → 현재 교사 발언 → 앞 단계 결과 순서로 제한된 판정 맥락을 만든다. */
export function buildAutofillContext({ project, a12Artifact, messages = [], currentActivity, chatContext }: {
  project?: ContextProject | null; a12Artifact?: Record<string, unknown>; messages?: readonly ContextMessage[]
  currentActivity?: string; chatContext?: string
}): { a12Artifact?: Record<string, unknown>; topic: string; chatContext?: string } {
  const source = project?.artifacts?.['A-1-2']?.content ?? a12Artifact
  const normalized = normalizeAutofillArtifact(source)
  const artifact = project?.targetSubjects?.length && !normalized?.targetSubjects && !normalized?.['대상 교과']
    ? { ...normalized, targetSubjects: project.targetSubjects } : normalized
  const topic = resolveAutofillTopic(artifact)
  const rationale = textField(artifact, RATIONALE_KEYS)
  const parts: string[] = []
  if (topic) parts.push(`[최종 선정 주제] ${topic}`)
  if (rationale) parts.push(`[선정 근거] ${bounded(rationale, 250)}`)
  const active = currentActivity ?? project?.currentActivity
  const teachers = messages.filter(message => message.role === 'user' && message.content.trim()
    && !isTrainingSystemText(message.content)
    && (!active || !message.activityCode || message.activityCode === active)
    && (!project?.currentCycle || !message.cycleNumber || message.cycleNumber === project.currentCycle))
    .slice(-3).reverse()
  for (const message of teachers) parts.push(`[최근 교사 발언/${message.activityCode ?? active ?? ''}] ${bounded(message.content.trim(), 500)}`)
  if (project) {
    const ordered = STAGES.flatMap(stage => stage.activities) as string[]
    const activeIndex = active ? ordered.indexOf(active) : -1
    for (const code of ['A-1-1', 'T-1-1', 'T-1-2']) {
      if (activeIndex >= 0 && ordered.indexOf(code) >= activeIndex) continue
      const content = project.artifacts?.[code]?.content
      if (!content) continue
      const keys = code === 'T-1-1' ? ['팀 공통 비전', 'teamVision', '핵심 키워드', 'coreKeywords']
        : code === 'T-1-2' ? ['설계 방향', 'designPrinciples'] : ['주제 선정 기준', 'criteria']
      const visible = Object.fromEntries(keys.filter(key => content[key] != null).map(key => [key, content[key]]))
      const text = serializeArtifactForPrompt(visible).trim()
      if (text) parts.push(`[${code} 저장 산출물] ${bounded(text, 300)}`)
    }
  } else if (chatContext?.trim()) {
    // 독립 시트 호출은 전달받은 맥락을 쓴다. 실제 프로젝트에서는 오래된 부모 요약 대신 최신 store 자료만 쓴다.
    parts.push(bounded(chatContext.trim(), 1000))
  }
  const context = parts.join('\n').slice(0, AUTOFILL_CONTEXT_LIMIT)
  return { a12Artifact: artifact, topic, chatContext: context || undefined }
}

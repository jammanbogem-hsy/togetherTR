/**
 * The training record input (right panel) keeps its text in local state until it is saved.
 * The "AI 도움" buttons live in the chat panel, so they read the writer's current draft here —
 * otherwise the AI only sees the last saved record and asks the teacher to paste it again.
 * Per browser tab only; nothing here is stored or shared.
 */

const drafts = new Map<string, string>()
const key = (projectId: string, code: string) => `${projectId}:${code}`

export function setTrainingDraftText(projectId: string, code: string, text: string): void {
  drafts.set(key(projectId, code), text)
}

export function clearTrainingDraftText(projectId: string, code: string): void {
  drafts.delete(key(projectId, code))
}

export function getTrainingDraftText(projectId: string, code: string): string | undefined {
  return drafts.get(key(projectId, code))
}

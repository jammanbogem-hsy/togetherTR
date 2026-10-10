/**
 * 단계별 테스트 보고서(기록지형 시험판) — 만들기·저장·선호 투표 (클라이언트).
 */
import { doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { STAGES, type Project, type StageCode } from '@/types'
import type { LessonSheetArtifacts } from './lessonSheetPrompt'
import { canGenerateStageReport } from './stageReportState'

export type ReportFormat = 'stage' | 'sheet'

export function lessonSheetArtifacts(project: Project): LessonSheetArtifacts {
  const artifacts: LessonSheetArtifacts = {}
  for (const code of STAGES.flatMap(stage => stage.activities)) {
    const artifact = project.artifacts?.[code]
    if (artifact) artifacts[code] = { title: artifact.title ?? code, content: (artifact.content ?? {}) as Record<string, unknown> }
  }
  return artifacts
}

export function lessonSheetMembers(project: Project): Array<{ name: string; role?: string }> {
  return Object.entries(project.memberInfo ?? {}).map(([uid, info]) => ({
    name: info?.displayName || '이름 미등록',
    role: uid === project.hostUid ? '기록 담당' : (info as { role?: string } | undefined)?.role || undefined,
  }))
}

/** 기록 담당만 만들고 저장한다(기본 단계 보고서와 같은 권한). */
export async function generateStageTestReport({ project, stage, callerUid, signal, onText }: {
  project: Project; stage: StageCode; callerUid?: string; signal: AbortSignal; onText: (markdown: string) => void
}): Promise<string> {
  if (!canGenerateStageReport(project, callerUid)) throw new Error('기록 담당만 테스트 보고서를 만들 수 있어요.')
  const response = await fetch('/api/report/lesson-sheet', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({
      stage,
      project: { title: project.title, targetGradeGroup: project.targetGradeGroup, targetSubjects: project.targetSubjects, schoolLevel: project.schoolLevel },
      members: lessonSheetMembers(project),
      artifacts: lessonSheetArtifacts(project),
    }),
  })
  if (!response.ok || !response.body) throw new Error('테스트 보고서 요청에 실패했어요. 다시 시도해 주세요.')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', text = ''
  const consume = (line: string) => {
    if (!line.startsWith('data: ')) return
    let event: { type?: string; text?: string; message?: string }
    try { event = JSON.parse(line.slice(6)) } catch { return }
    if (event.type === 'error') throw new Error(event.message || '테스트 보고서를 만드는 중 오류가 났어요.')
    if (event.type === 'text' && typeof event.text === 'string') { text += event.text; onText(text) }
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
      for (const line of lines) consume(line.trimEnd())
      if (done) { if (buffer) consume(buffer.trimEnd()); break }
    }
  } catch (cause) { await reader.cancel().catch(() => {}); throw cause }
  finally { reader.releaseLock() }
  if (!text.trim()) throw new Error('테스트 보고서 내용이 비어 있어요. 다시 만들어 주세요.')
  // 스트림이 끝까지 성공한 뒤에만 이전 테스트 보고서를 덮어쓴다.
  await updateDoc(doc(db, 'projects', project.id), {
    [`testReports.${stage}`]: { content: text, savedAt: Date.now(), ...(callerUid ? { savedBy: callerUid } : {}) },
    updatedAt: serverTimestamp(),
  })
  return text
}

/** 각자 더 좋은 형식에 한 표. 같은 형식을 다시 누르면 취소한다. */
export async function voteReportFormat(projectId: string, uid: string, format: ReportFormat, current?: ReportFormat): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), { [`reportFormatVotes.${uid}`]: current === format ? deleteField() : format })
}

export function countReportVotes(votes: Record<string, unknown> | null | undefined): Record<ReportFormat, number> {
  const counts: Record<ReportFormat, number> = { stage: 0, sheet: 0 }
  for (const value of Object.values(votes ?? {})) if (value === 'stage' || value === 'sheet') counts[value] += 1
  return counts
}

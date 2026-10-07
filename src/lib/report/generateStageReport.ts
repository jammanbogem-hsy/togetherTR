import { STAGES, ACTIVITY_META, type Project, type StageCode } from '@/types'
import { saveStageReport, setAnalysisReport } from '@/lib/firebase/projects'
import { canGenerateStageReport } from './stageReportState'

/** 단계 이동과 보고서 목록이 공유하는 생성·저장 경로. 부록 치환은 기존 SSE 서버가 담당한다. */
export async function generateStageReport({ project, stage, callerUid, signal, onText, onStreaming }: {
  project: Project; stage: StageCode; callerUid?: string; signal: AbortSignal
  onText: (markdown: string) => void; onStreaming: () => void
}): Promise<string> {
  if (!canGenerateStageReport(project, callerUid)) throw new Error('기록 담당만 보고서를 저장할 수 있어요.')
  const activities = STAGES.find(item => item.code === stage)?.activities
  if (!activities) throw new Error('단계를 찾지 못했어요.')
  const artifacts: Record<string, { title: string; content: Record<string, unknown> }> = {}
  for (const code of activities) {
    const artifact = project.artifacts?.[code]
    if (artifact) artifacts[code] = { title: ACTIVITY_META[code].label, content: artifact.content ?? {} }
  }
  signal.throwIfAborted()
  const previous = project.analysisReport
  await setAnalysisReport(project.id, stage, '', true)
  let text = ''
  try {
    signal.throwIfAborted()
    const response = await fetch('/api/analyze/stage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ stage, project: { title: project.title, targetGradeGroup: project.targetGradeGroup, targetSubjects: project.targetSubjects }, artifacts }),
    })
    if (!response.ok || !response.body) throw new Error('분석 요청에 실패했어요. 다시 시도해 주세요.')
    onStreaming()
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = ''
    const consumeLine = (line: string) => {
      if (!line.startsWith('data: ')) return
      let event: { type?: string; text?: string; message?: string }
      try { event = JSON.parse(line.slice(6)) } catch { return }
      if (event.type === 'error') throw new Error(event.message || '보고서 생성 중 오류가 발생했어요.')
      if (event.type === 'text' && typeof event.text === 'string') { text += event.text; onText(text) }
      // done 뒤에도 서버의 부록 텍스트가 올 수 있으므로 EOF까지 읽는다.
    }
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) consumeLine(line.trimEnd())
        if (done) { if (buffer) consumeLine(buffer.trimEnd()); break }
      }
    } catch (cause) { await reader.cancel().catch(() => {}); throw cause }
    finally { reader.releaseLock() }
    signal.throwIfAborted()
    if (!text.trim()) throw new Error('보고서 내용이 비어 있어요. 다시 생성해 주세요.')
    // 스트림 성공 전에 기존 영구 보고서를 덮어쓰지 않는다. 저장 실패도 완료로 표시하지 않는다.
    await saveStageReport(project.id, stage, text, callerUid)
    await setAnalysisReport(project.id, stage, text, false)
    return text
  } catch (cause) {
    if (!signal.aborted) await setAnalysisReport(project.id, previous?.stage ?? stage, previous?.content ?? '', false).catch(() => {})
    throw cause
  }
}

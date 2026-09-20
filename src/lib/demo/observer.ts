import type { DemoTeacherReview } from './engine/types'

/** A live demo is an AI-teacher simulation, including paused and completed runs. */
export function isDemoObservationOnly(project: { demoRun?: unknown } | null | undefined): boolean {
  return Boolean(project?.demoRun)
}

interface DownloadableArtifact {
  title: string
  status: string
  version: number
  content: Record<string, unknown>
  confirmedBy?: string
  demoReview?: { approvedBy: string[]; round: number; simulated: true; evidence?: Array<{ speakerId: string; speakerName: string; quote: string }> }
}

export function demoArtifactApprovalLabel(artifact: DownloadableArtifact): string {
  if (artifact.status !== 'confirmed') return '교사 AI 검토 중 · 미확정'
  return artifact.confirmedBy === 'demo-teacher-team'
    ? 'AI 교사팀 합의 · 시뮬레이션'
    : '이전 엔진 자동 확정 · 교사 합의 검증 없음'
}

export function demoSectionText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
}

interface SavedTurnDetails {
  artifact?: { title: string; content: Record<string, unknown> }
  review?: DemoTeacherReview
  references?: Array<{ speakerId: string; quote: string }>
  stageReport?: { stage: string; content: string }
}

export function demoTurnDetailMarkdown(response: SavedTurnDetails | undefined): string {
  if (!response) return ''
  const parts: string[] = []
  if (response.artifact) {
    parts.push(`## 이 시점의 공동 초안 · 미확정\n\n### ${response.artifact.title}`)
    parts.push(...Object.entries(response.artifact.content).map(([key, value]) => `### ${key}\n\n${demoSectionText(value)}`))
  }
  if (response.review) {
    const review = response.review
    parts.push(`## 교사 AI의 검토 결정 · 시뮬레이션\n\n${review.decision === 'approve' ? '동의' : '수정 요청'}\n\n${review.reason}`)
    // Missing fields belong to legacy records; do not reinterpret them as an
    // explicit empty blocker list or invent a structured review retroactively.
    if (review.blockers !== undefined) {
      const blockers = review.blockers.map((blocker, index) => `### 필수 수정 ${index + 1}\n\n기준 ID: ${blocker.criterionId}\n\n대상 섹션: ${blocker.sectionKey}\n\n원문 근거: ${blocker.evidence}\n\n문제: ${blocker.issue}\n\n수정 문안: ${blocker.change}`)
      parts.push(`## 필수 수정\n\n${blockers.length ? blockers.join('\n\n') : '없음'}`)
    }
    if (review.suggestions !== undefined) {
      parts.push(`## 후속 제안 · 필수 승인 조건 아님\n\n${review.suggestions.length ? review.suggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`).join('\n\n') : '없음'}`)
    }
  }
  if (response.references?.length) parts.push(`## 실제 입력 발언 인용\n\n${response.references.map(ref => `${ref.speakerId}: ${ref.quote}`).join('\n\n')}`)
  if (response.stageReport) parts.push(`## 이 시점의 ${response.stageReport.stage} 단계 보고서 초안\n\n${response.stageReport.content}`)
  return parts.join('\n\n')
}

export function demoArtifactMarkdown(activityLabel: string, artifact: DownloadableArtifact): string {
  return [
    `# ${activityLabel} · ${artifact.title}`,
    '> AI 교사 페르소나 시뮬레이션입니다. 실제 교사의 승인이나 실제 학생의 수업 효과를 의미하지 않습니다.',
    `버전: ${artifact.version} · ${demoArtifactApprovalLabel(artifact)}`,
    ...(artifact.demoReview ? [`검토 라운드: ${artifact.demoReview.round} · ${artifact.status === 'confirmed' ? `동의한 교사 AI: ${artifact.demoReview.approvedBy.length}명` : '확정 전 · 개별 검토는 대화 기록 참조'}`, ...(artifact.demoReview.evidence ?? []).map(item => `검토 근거 — ${item.speakerName}: ${item.quote}`)] : []),
    ...Object.entries(artifact.content).map(([key, value]) => `## ${key}\n\n${demoSectionText(value)}`),
  ].join('\n\n')
}

export function safeDemoFilename(title: string): string {
  return `${title.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-').slice(0, 100) || '튜토리얼'}.md`
}

/** Always download inert UTF-8 text: never render model-generated HTML as a document. */
export function downloadDemoMarkdown(title: string, content: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = safeDemoFilename(title)
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

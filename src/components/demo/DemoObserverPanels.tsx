'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { useProjectStore } from '@/store/project'
import { watchMessages } from '@/lib/firebase/projects'
import { ACTIVITY_META, STAGES, displayActivityCode, type ActivityCode, type Message } from '@/types'
import { demoArtifactApprovalLabel, demoArtifactMarkdown, demoSectionText, demoTurnDetailMarkdown, downloadDemoMarkdown } from '@/lib/demo/observer'
import { parseDemoEngineConfig, type DemoTurnResponse } from '@/lib/demo/engine/types'
import { MessageBubble } from '@/components/chat/ChatPanel'
import { ChatPanelHeader } from '@/components/chat/ChatPanelHeader'
import { useChatFontScale } from '@/components/accessibility/FontScaleControl'
import { STAGE_COLOR } from '@/lib/ui/stageColors'

const orderedActivities = STAGES.flatMap(stage => stage.activities)
const markdownComponents = { img: () => null }
type SavedDemoMessage = Message & { demoTurnResponse?: DemoTurnResponse }

function messageDetails(message: Message): string {
  return demoTurnDetailMarkdown((message as SavedDemoMessage).demoTurnResponse)
}

function DemoTurnDetails({ message }: { message: Message }) {
  const details = messageDetails(message)
  const review = (message as SavedDemoMessage).demoTurnResponse?.review
  return details ? <details className="mt-3 border-t border-gray-200 pt-2 text-xs">
    <summary className="cursor-pointer font-semibold text-blue-700">이 시점의 초안·검토 원문{review?.blockers !== undefined && ` · 필수 수정 ${review.blockers.length}개`}{review?.suggestions !== undefined && ` · 후속 제안 ${review.suggestions.length}개`}</summary>
    <div className="prose prose-sm mt-2 max-w-none overflow-x-auto break-words"><ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={markdownComponents}>{details}</ReactMarkdown></div>
  </details> : null
}

function readConfig(value: unknown) {
  try { return parseDemoEngineConfig(value) } catch { return null }
}

/** Demo controls augment the shared project workspace. */
export function DemoProjectToolbar() {
  const project = useProjectStore(state => state.project)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  if (!project?.demoRun) return null
  const config = readConfig(project.demoRun.config)
  async function downloadTutorial() {
    if (!project?.demoRun || !config || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const activities = await Promise.all(orderedActivities.map(async code => {
        const snapshot = await getDocs(query(collection(db, `projects/${project.id}/conversations/${code}/messages`), orderBy('createdAt', 'asc')))
        const dialogue = snapshot.docs.map(doc => {
          const message = doc.data() as SavedDemoMessage
          return `### ${message.displayName || (message.role === 'assistant' ? '총괄 AI' : '교사 AI')}\n\n${message.content || ''}\n\n${messageDetails(message)}`
        }).join('\n\n')
        const artifact = project.artifacts?.[code]
        return `# ${displayActivityCode(code)} · ${ACTIVITY_META[code].label}\n\n## 협력 대화\n\n${dialogue || '아직 저장된 대화 없음'}\n\n${artifact ? demoArtifactMarkdown(displayActivityCode(code), artifact) : '아직 저장된 산출물 없음'}`
      }))
      const personas = config.personas.map(persona => `## ${persona.displayName}\n\n${persona.subject} · ${persona.career}\n\n${persona.summary}\n\n우선순위: ${persona.priority}\n\n협력 방식: ${persona.collaborationStyle}`).join('\n\n')
      const reports = Object.entries(project.stageReports ?? {}).map(([stage, report]) => `# ${stage} 단계 보고서\n\n${report.content}`).join('\n\n')
      downloadDemoMarkdown(`${project.title} 전체 튜토리얼`, `# ${project.title}\n\n> AI 교사 페르소나 시뮬레이션입니다. 실제 교사의 발언·승인이나 실제 학생의 학습 효과를 의미하지 않습니다. 공개·공유 전 내용과 출처를 검토하세요.\n\n실행 상태: ${project.demoRun.status}\n\n# 수업 개괄\n\n${config.lesson.overview}\n\n# 교사 AI 페르소나\n\n${personas}\n\n${activities.join('\n\n---\n\n')}\n\n${reports}`)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : '튜토리얼을 내려받지 못했습니다.')
    } finally { setExporting(false) }
  }
  return <details className="group text-xs">
    <summary className="cursor-pointer rounded-full bg-[#E8F0FE] px-3 py-2 font-semibold text-[#1A73E8]">AI 튜토리얼</summary>
    <section aria-label="교사 에이전트 실행" className="fixed right-5 top-20 z-50 w-[min(540px,90vw)] rounded-2xl border border-[#E8EAED] bg-white p-4 text-[#202124] shadow-xl">
    <header className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold">교사 AI {config?.personas.length ?? '?'}명 + 총괄 AI · {project.demoRun.status === 'completed' ? '실행 완료' : project.demoRun.status === 'running' ? '협의 진행 중' : '실행 상태 확인'}</p><p className="text-[11px] text-[#5F6368]">사용자 관찰 전용 · AI 교사 시뮬레이션</p></div>
      <a href={`/demo/run/${project.id}`} className="rounded-full bg-[#E8F0FE] px-3 py-2 text-xs font-semibold text-[#1A73E8]">실행·일시정지·재개</a>
      <button type="button" disabled={exporting || !config} onClick={() => void downloadTutorial()} className="rounded-full bg-[#1A73E8] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{exporting ? '저장된 대화 모으는 중…' : '전체 튜토리얼 내려받기'}</button>
      <details className="w-full text-xs">
        <summary className="cursor-pointer text-blue-700">수업 개괄·교사 페르소나·단계 보고서 보기</summary>
        <div className="mt-2 max-h-64 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3">
          <p>{config?.lesson.overview}</p>
          {config?.personas.map(persona => <p key={persona.id}><strong>{persona.displayName} · {persona.subject}</strong> — {persona.summary} · 우선순위: {persona.priority}</p>)}
          {Object.entries(project.stageReports ?? {}).map(([stage, report]) => <details key={stage}><summary className="cursor-pointer font-semibold">{stage} 단계 보고서 · 시뮬레이션</summary><div className="prose prose-sm max-w-none overflow-x-auto"><ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={markdownComponents}>{report.content}</ReactMarkdown></div></details>)}
        </div>
      </details>
    </header>
    {exportError && <p role="alert" className="mt-2 text-sm text-red-700">{exportError}</p>}
  </section></details>
}

export function DemoObserverChat() {
  const { project, viewingActivity, setViewingActivity } = useProjectStore()
  const chatFontScale = useChatFontScale()
  const [snapshot, setSnapshot] = useState<{ activity: ActivityCode; messages: Message[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!project?.id) return
    return watchMessages(project.id, viewingActivity,
      messages => { setSnapshot({ activity: viewingActivity, messages }); setError(null) },
      reason => setError(reason.message), project.currentCycle ?? 1)
  }, [project?.id, project?.currentCycle, viewingActivity])
  if (!project) return null
  const config = readConfig(project.demoRun?.config)
  const messages = snapshot?.activity === viewingActivity ? snapshot.messages : []
  const label = `${displayActivityCode(viewingActivity)} ${ACTIVITY_META[viewingActivity].label}`
  return (
    <section className="chat-motion-decorative flex h-full flex-col overflow-hidden corner-wrap-chat" style={{ '--cc': STAGE_COLOR[ACTIVITY_META[viewingActivity].stage].corner } as React.CSSProperties} aria-label="교사 AI 협력 설계 관찰">
      <ChatPanelHeader activity={viewingActivity}>
        <details className="relative text-xs">
          <summary className="cursor-pointer rounded-full bg-[#E8F0FE] px-3 py-2 text-[#1A73E8]">교사 AI {config?.personas.length}명</summary>
          <div className="absolute right-0 top-10 z-30 w-72 space-y-2 rounded-xl border bg-white p-3 shadow-lg">
            {config?.personas.map(persona => <p key={persona.id}><strong>{persona.displayName} · {persona.subject}</strong><br />{persona.priority}</p>)}
          </div>
        </details>
      </ChatPanelHeader>
        <div className="flex shrink-0 flex-wrap gap-3 px-4 py-2 text-xs">
          <button className="text-blue-700 underline" onClick={() => setViewingActivity(project.currentActivity ?? viewingActivity)}>진행 중인 활동 보기</button>
          <button type="button" disabled={!messages.length} className="text-blue-700 underline disabled:opacity-40" onClick={() => downloadDemoMarkdown(`${label} 대화`, `# ${label}\n\n> AI 교사 시뮬레이션 대화입니다.\n\n${messages.map(message => `## ${message.displayName || (message.role === 'assistant' ? '총괄 AI' : '교사 AI')}\n\n${message.content}\n\n${messageDetails(message)}`).join('\n\n')}`)}>이 활동 대화 내려받기</button>
        </div>
      {error && <p role="alert" className="p-3 text-sm text-red-700">대화를 불러오지 못했습니다: {error}</p>}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4" style={{ zoom: chatFontScale }} role="log" aria-label="저장된 교사 AI 대화">
        {!messages.length && <p className="text-sm text-gray-500">이 활동에 저장된 대화가 아직 없습니다. 실행 중에는 완료된 발언부터 표시됩니다.</p>}
        {messages.map(message => <div key={message.id}>
          <MessageBubble role={message.role === 'assistant' ? 'assistant' : 'user'} content={message.content} senderName={message.displayName} senderColor={project.memberInfo?.[message.userId ?? '']?.color} stage={ACTIVITY_META[viewingActivity].stage} activityType={message.activityType} simulated />
          <DemoTurnDetails message={message} />
        </div>)}
      </div>
      <div className="shrink-0 border-t border-[#DADCE0] bg-[#F8F9FA] p-4">
        <p className="mb-2 text-xs text-[#5F6368]">교사 AI 시뮬레이션 · 관찰 중</p>
        <div className="chat-input-wrap"><div className="chat-input-inner bg-white"><textarea disabled rows={3} aria-label="데모 관찰 전용 입력창" placeholder="교사 AI가 발언합니다. 활동을 선택해 대화와 산출물을 살펴보세요." className="w-full resize-none rounded-[18px] border-0 bg-transparent px-3 py-2 text-sm disabled:opacity-50" /></div></div>
      </div>
    </section>
  )
}

export function DemoArtifactPanel() {
  const { project, viewingActivity } = useProjectStore()
  if (!project) return null
  const artifact = project.artifacts?.[viewingActivity]
  const label = `${displayActivityCode(viewingActivity)} ${ACTIVITY_META[viewingActivity].label}`
  function downloadArtifacts() {
    if (!project) return
    const content = orderedActivities.flatMap(code => {
      const saved = project.artifacts?.[code]
      return saved ? [demoArtifactMarkdown(`${displayActivityCode(code)} ${ACTIVITY_META[code].label}`, saved)] : []
    })
    downloadDemoMarkdown(`${project.title} 튜토리얼 산출물`, `# AI 교사 협력 설계 튜토리얼\n\n> 저장된 산출물 모음입니다. 시뮬레이션이며 실제 수업 효과를 검증한 자료가 아닙니다.\n\n${content.join('\n\n---\n\n')}`)
  }
  return <section className="flex h-full flex-col overflow-hidden border-l bg-white" aria-label="시뮬레이션 산출물">
    <header className="shrink-0 border-b bg-gray-50 p-4">
      <h2 className="text-sm font-bold">{label}</h2>
      <p className="mt-1 text-xs text-gray-600">{artifact ? `${demoArtifactApprovalLabel(artifact)} · v${artifact.version}` : '아직 저장된 산출물이 없습니다'}</p>
      {artifact?.demoReview && <details className="mt-2 text-xs text-gray-600">
        <summary className="cursor-pointer">검토 {artifact.demoReview.round}라운드 · {artifact.status === 'confirmed' ? `교사 AI ${artifact.demoReview.approvedBy.length}명 동의 근거` : '확정 전 · 개별 검토는 대화 기록 참조'}</summary>
        <ul className="mt-2 space-y-2">{(artifact.demoReview.evidence ?? []).map((item, index) => <li key={`${item.speakerId}-${index}`}><strong>{item.speakerName}</strong>: {item.quote}</li>)}</ul>
      </details>}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-blue-700">
        {artifact && <button type="button" className="underline" onClick={() => downloadDemoMarkdown(label, demoArtifactMarkdown(label, artifact))}>이 산출물 내려받기</button>}
        <button type="button" className="underline" onClick={downloadArtifacts}>전체 산출물 모음 내려받기</button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-gray-500">AI 교사팀의 공동 산출물 · 실제 수업 전 내용 검토</p>
    </header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {artifact ? Object.entries(artifact.content).map(([key, value]) => <article key={key}>
        <div className="mb-2 flex items-start justify-between gap-2"><h3 className="text-sm font-bold">{key}</h3>
          {viewingActivity === 'DI-1-1' && <button type="button" className="shrink-0 text-xs text-blue-700 underline" onClick={() => downloadDemoMarkdown(`${label} ${key}`, `# ${key}\n\n> AI 교사 시뮬레이션 자료 · 실제 수업 전 검토 필요\n\n${demoSectionText(value)}`)}>자료 본문 내려받기</button>}
        </div>
        <div className="prose prose-sm max-w-none overflow-x-auto break-words [&_table]:min-w-[480px] [&_td]:p-2 [&_th]:p-2"><ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={markdownComponents}>{demoSectionText(value)}</ReactMarkdown></div>
      </article>) : <p className="text-sm text-gray-500">총괄 AI의 초안 생성과 교사 AI 검토가 진행되면 여기에 산출물이 나타납니다.</p>}
    </div>
  </section>
}

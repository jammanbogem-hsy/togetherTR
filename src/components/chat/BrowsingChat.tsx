'use client'

/**
 * A team member reading another activity (lib/activity/browse): the chat shows that activity's
 * saved conversation read-only. The live chat stays mounted underneath (drafts and queues kept)
 * and comes back with "돌아가기".
 */
import { useEffect, useState } from 'react'
import { ArrowUUpLeft, Eye } from '@phosphor-icons/react'
import { useProjectStore } from '@/store/project'
import { watchMessages } from '@/lib/firebase/projects'
import { ACTIVITY_META, displayActivityCode, type ActivityCode, type Message } from '@/types'
import { MessageBubble } from '@/components/chat/ChatPanel'
import { ChatPanelHeader } from '@/components/chat/ChatPanelHeader'
import { useChatFontScale } from '@/components/accessibility/FontScaleControl'
import { STAGE_COLOR } from '@/lib/ui/stageColors'

export function BrowsingChat() {
  const { project, viewingActivity, currentActivity, setViewingActivity, userProfile } = useProjectStore()
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
  const loaded = snapshot?.activity === viewingActivity
  const messages = (loaded ? snapshot.messages : []).filter(message => message.role === 'user' || message.role === 'assistant')
  const stage = ACTIVITY_META[viewingActivity].stage
  const liveLabel = `${displayActivityCode(currentActivity)} ${ACTIVITY_META[currentActivity].label}`
  const back = () => setViewingActivity(currentActivity)
  return (
    <section className="corner-wrap-chat flex h-full flex-col overflow-hidden" aria-label={`${displayActivityCode(viewingActivity)} 대화 열람`}
      style={{ '--cc': STAGE_COLOR[stage].corner } as React.CSSProperties}>
      <ChatPanelHeader activity={viewingActivity} />
      <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#FFD54F] bg-[#FFF8E1] px-4 py-2 text-sm text-[#6D4100]">
        <Eye size={18} weight="bold" aria-hidden="true" />
        <span className="min-w-0 flex-1">열람 중 · {displayActivityCode(viewingActivity)} {ACTIVITY_META[viewingActivity].label}의 대화 기록입니다 (읽기 전용)</span>
        <button type="button" onClick={back} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-[#6D4100] hover:bg-[#FFECB3] focus-visible:outline-2 focus-visible:outline-[#6D4100]">
          <ArrowUUpLeft size={14} weight="bold" /> 진행 중인 활동으로
        </button>
      </div>
      {error && <p role="alert" className="p-3 text-sm text-[#B3261E]">대화를 불러오지 못했습니다: {error}</p>}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4" style={{ zoom: chatFontScale }} role="log" aria-label="열람 중인 활동의 대화">
        {!loaded && !error && <p className="text-sm text-[#5F6368]">대화를 불러오는 중…</p>}
        {loaded && !messages.length && <p className="text-sm text-[#5F6368]">이 활동에는 아직 저장된 대화가 없습니다.</p>}
        {messages.map(message => {
          const info = message.userId ? project.memberInfo?.[message.userId] : undefined
          return <MessageBubble key={message.id}
            role={message.role === 'assistant' ? 'assistant' : 'user'}
            content={message.content}
            attachments={message.attachments}
            activityType={message.activityType}
            senderName={message.displayName || info?.displayName}
            senderColor={info?.color}
            senderAvatarId={info?.avatarId}
            isSelf={!!userProfile?.uid && message.userId === userProfile.uid}
            replyTo={message.replyTo}
            stage={stage} />
        })}
      </div>
      <div className="shrink-0 border-t border-[#DADCE0] bg-[#F8F9FA] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-[#444746]">
          <span className="min-w-0 flex-1">열람 중에는 메시지를 보낼 수 없어요. 대화는 기록 담당이 진행 중인 {liveLabel}에서 이어집니다.</span>
          <button type="button" onClick={back} className="min-h-11 rounded-full bg-[#0B57D0] px-4 text-sm font-semibold text-white hover:bg-[#0842A0]">돌아가서 대화하기</button>
        </div>
      </div>
    </section>
  )
}

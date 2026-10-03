'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import {
  watchProject, watchMessages, startProject, transferHost,
  sendLobbyMessage, watchLobbyMessages, joinProject, setTeamDiscussion,
  clearECompleted, watchKeyNotes, migrateKeyNotesToSubcollection,
  type LobbyMessage
} from '@/lib/firebase/projects'
import type { Project } from '@/types'
import { STAGES, ACTIVITY_META, SOLO_HIDDEN_ACTIVITIES, displayActivityCode } from '@/types'
import type { UserProfile } from '@/lib/auth'
import { StageBar } from '@/components/stage/StageBar'
import { ActivitySidebar } from '@/components/activity/ActivitySidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { DemoProjectToolbar } from '@/components/demo/DemoObserverPanels'
import { MD3Button } from '@/components/ui/MD3Button'
import { ArtifactPanel, CollapsedArtifactStrip } from '@/components/artifacts/ArtifactPanel'
import { StageMoveModal } from '@/components/modals/StageMoveModal'
import { StageAnalysisModal } from '@/components/modals/StageAnalysisModal'
import { StageReportsModal } from '@/components/modals/StageReportsModal'
import { PublishModal } from '@/components/modals/PublishModal'
import { ProjectOntologyModal } from '@/components/ontology/ProjectOntologyModal'
import { ProjectMaterialsModal } from '@/components/materials/ProjectMaterialsModal'
import { setAnalysisOpen } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { STAGE_COLOR, STAGE_LABELS } from '@/lib/ui/stageColors'
import { isEffectivelyDone as checkEffectivelyDone, parseNextCycleChoice } from '@/lib/activity/completion'
import { hasNewCycleT11Artifact, shouldOpenCycleTransition } from '@/lib/activity/cycle'
import { SpinnerGap, PlayCircle, Crown, Copy, Check, Users, Key, ArrowLeft, PaperPlaneRight, FileText, Books, Sparkle, X as XIcon, ArrowRight, CaretRight, CaretDown, Globe, Graph as GraphIcon, House } from '@phosphor-icons/react'
import { Avatar } from '@/components/ui/Avatar'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { useLayoutToggle } from '@/components/layout/useLayoutToggle'
import { PendingConfirmationBanner } from '@/components/collab/PendingConfirmationBanner'

function hasMemberHost(project: Project): boolean {
  const members = project.memberUids ?? Object.keys(project.memberInfo ?? {})
  return [project.hostUid, project.createdBy].some(uid => !!uid && members.includes(uid))
}

// ─── 대기실 ──────────────────────────────────────────
function WaitingRoom({
  project,
  projectId,
  uid,
  isHost,
  userProfile,
  onBecomeHost,
}: {
  project: Project
  projectId: string
  uid: string
  isHost: boolean
  userProfile: UserProfile | null
  onBecomeHost: () => void
}) {
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lobbyInput, setLobbyInput] = useState('')
  const [lobbyMessages, setLobbyMessages] = useState<LobbyMessage[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = watchLobbyMessages(projectId, setLobbyMessages)
    return () => unsub()
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lobbyMessages])

  async function handleStart() {
    setStarting(true)
    await startProject(projectId)
  }

  function handleCopy() {
    if (!project.inviteCode) return
    navigator.clipboard.writeText(project.inviteCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleSendLobby() {
    if (!lobbyInput.trim() || !userProfile) return
    const msg = lobbyInput.trim()
    setLobbyInput('')
    await sendLobbyMessage(projectId, {
      uid: userProfile.uid,
      displayName: userProfile.displayName,
      color: userProfile.color,
      emoji: userProfile.emoji ?? '👤',
      content: msg,
    })
  }

  // 멤버 목록 (memberInfo 있으면 사용, 없으면 memberUids만)
  const memberInfo = project.memberInfo ?? {}
  const memberUids: string[] = project.memberUids ?? [project.createdBy ?? uid]
  const memberCount = memberUids.length

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b border-[#DADCE0] px-6 py-4 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#F9AB00]"
            style={{ animation: 'dot-idle 1.6s ease-in-out infinite' }} />
          <span className="text-[13px] text-[#E37400] font-bold">팀원을 기다리는 중</span>
          <div className="h-4 w-px bg-[#DADCE0] mx-1" />
          <h1 className="text-[14px] font-extrabold text-[#202124]">{project.title}</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto w-full px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1">
        {/* 왼쪽: 초대코드 + 참여 인원 + 시작 */}
        <div className="space-y-4">

          {/* 초대코드 카드 */}
          {project.inviteCode && (
            <div className="project-card rounded-2xl p-6"
              style={{
                '--cc': 'rgba(26,115,232,0.12)', '--cx1': '100%', '--cy1': '0%', '--cx2': '0%', '--cy2': '100%', '--card-speed': '0.65s',
                border: '2.5px solid #4285F4', boxShadow: '0 2px 12px rgba(26,115,232,0.18)',
              } as React.CSSProperties}>
              <p className="text-[11px] font-bold text-[#9AA0A6] uppercase tracking-widest mb-2">이 방의 초대코드</p>
              <div className="flex items-center justify-between">
                <p className="text-4xl font-black text-[#1A73E8] tracking-widest">{project.inviteCode}</p>
                <button onClick={handleCopy}
                  className="morph-btn flex items-center gap-1.5 text-[13px] font-bold text-[#1A73E8] px-4 py-2 bg-[#E8F0FE] hover:bg-[#C5D9F9] transition-colors">
                  {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
                  {copied ? '복사됨!' : '복사'}
                </button>
              </div>
              <p className="text-[11px] text-[#9AA0A6] mt-3 leading-snug">
                팀원에게 공유하면 대시보드 &ldquo;방 참여하기&rdquo;에서 입장할 수 있어요
              </p>
            </div>
          )}

          {/* 참여 인원 카드 */}
          <div className="project-card rounded-2xl p-5"
            style={{
              '--cc': 'rgba(26,115,232,0.09)', '--cx1': '0%', '--cy1': '0%', '--cx2': '100%', '--cy2': '100%', '--card-speed': '0.9s',
              border: '2.5px solid #4285F4', boxShadow: '0 2px 12px rgba(26,115,232,0.14)',
            } as React.CSSProperties}>
            <div className="flex items-center gap-2 mb-4">
              <Users size={16} weight="fill" className="text-[#1A73E8]" />
              <span className="text-[14px] font-extrabold text-[#202124]">참여 중 · {memberCount}명</span>
            </div>
            <div className="space-y-3">
              {memberUids.map(mUid => {
                const info = memberInfo[mUid]
                const isThisHost = project.hostUid === mUid || project.createdBy === mUid
                const isSelf = mUid === uid
                return (
                  <div key={mUid} className="flex items-center gap-3">
                    <Avatar name={info?.displayName} color={info?.color ?? '#9AA0A6'} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-bold text-[#202124] truncate">
                          {info?.displayName ?? mUid.slice(0, 8)}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] bg-[#E8F0FE] text-[#1A73E8] px-2 py-0.5 rounded-full font-bold">나</span>
                        )}
                        {isThisHost && (
                          <Crown size={14} weight="fill" className="text-[#F9AB00]" />
                        )}
                      </div>
                      {isThisHost && (
                        <p className="text-[11px] text-[#F9AB00] font-semibold">방장</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 시작 / 대기 버튼 */}
          {isHost ? (
            <button
              onClick={handleStart}
              disabled={starting}
              className="morph-btn w-full flex items-center justify-center gap-2 py-4 bg-[#1A73E8] text-white font-extrabold text-[15px] hover:bg-[#1557b0] transition-colors disabled:opacity-50"
              style={{ filter: 'drop-shadow(0 4px 14px rgba(26,115,232,0.40))' }}
            >
              {starting ? (
                <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={20} /></span>시작 중...</>
              ) : (
                <><PlayCircle size={22} weight="fill" />수업설계 시작하기</>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="project-card w-full py-4 rounded-2xl text-[13px] text-center font-semibold text-[#9AA0A6]"
                style={{ '--cc': 'rgba(0,0,0,0.04)', '--cx1': '50%', '--cy1': '0%', '--cx2': '50%', '--cy2': '100%', '--card-speed': '0.5s', border: '2px solid #DADCE0' } as React.CSSProperties}>
                방장이 시작 버튼을 누를 때까지 기다려주세요
              </div>
              {!hasMemberHost(project) && <button
                onClick={onBecomeHost}
                className="morph-btn w-full py-3 border-2 border-[#FFCC80] text-[#E65100] text-[13px] font-bold hover:bg-[#FFF3E0] transition-all flex items-center justify-center gap-1.5"
              >
                <Crown size={15} weight="fill" className="text-[#F9AB00]" />
                방장 권한 받기
              </button>}
            </div>
          )}
        </div>

        {/* 오른쪽: 대기실 채팅 */}
        <div className="project-card rounded-2xl flex flex-col overflow-hidden"
          style={{
            '--cc': 'rgba(26,115,232,0.11)', '--cx1': '100%', '--cy1': '0%', '--cx2': '100%', '--cy2': '100%', '--card-speed': '0.5s',
            border: '2.5px solid #4285F4', boxShadow: '0 2px 12px rgba(26,115,232,0.18)', height: '480px',
          } as React.CSSProperties}>
          <div className="px-5 py-4 border-b border-[#E8F0FE] bg-[#E8F0FE]/60 flex-shrink-0">
            <h3 className="text-[14px] font-extrabold text-[#202124]">대기실 채팅</h3>
            <p className="text-[11px] text-[#5F6368] font-medium mt-0.5">팀원과 미리 대화해보세요</p>
          </div>

          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {lobbyMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[#9AA0A6]">
                <div className="w-12 h-12 flex items-center justify-center bg-[#E8F0FE] text-[#4285F4] text-xl"
                  style={{ animation: 'morph-shape 9s ease-in-out infinite' }}>
                  👋
                </div>
                <p className="text-[12px] font-semibold text-center">아직 메시지가 없습니다<br />팀원에게 인사해보세요</p>
              </div>
            )}
            {lobbyMessages.map(msg => {
              const isSelf = msg.uid === uid
              return (
                <div key={msg.id} className={cn('flex gap-2.5', isSelf ? 'flex-row-reverse' : 'flex-row')}>
                  <Avatar name={msg.displayName} color={msg.color} size={36} />
                  <div className={cn('max-w-[75%] space-y-0.5 flex flex-col', isSelf ? 'items-end' : 'items-start')}>
                    {!isSelf && (
                      <span className="text-[11px] font-bold px-1" style={{ color: msg.color }}>
                        {msg.displayName}
                      </span>
                    )}
                    <div
                      className={cn(
                        'px-3.5 py-2 text-[13px] font-medium',
                        isSelf ? 'text-white rounded-2xl rounded-tr-sm' : 'bg-[#EAF2FF] text-[#1a2e5a] rounded-2xl rounded-tl-none border-l-[3px] border-[#4285F4]'
                      )}
                      style={isSelf ? { backgroundColor: msg.color } : undefined}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* 입력창 */}
          <div className="px-3 py-3 border-t border-[#E8F0FE] bg-[#F8F9FA] flex-shrink-0">
            <div className="chat-input-wrap">
              <div className="chat-input-inner flex gap-2 bg-white px-3 py-2">
                <input
                  type="text"
                  value={lobbyInput}
                  onChange={e => setLobbyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSendLobby() }}
                  placeholder="메시지 입력..."
                  className="flex-1 bg-transparent text-[13px] focus:outline-none text-[#202124] placeholder:text-[#9AA0A6]"
                />
                <button
                  onClick={handleSendLobby}
                  disabled={!lobbyInput.trim()}
                  className="w-9 h-9 flex items-center justify-center text-white disabled:opacity-40 transition-all flex-shrink-0"
                  style={{
                    backgroundColor: '#1A73E8',
                    animation: 'morph-shape 6s ease-in-out infinite',
                    filter: lobbyInput.trim() ? 'drop-shadow(0 2px 6px rgba(26,115,232,0.5))' : 'none',
                  }}
                >
                  <PaperPlaneRight size={16} weight="fill" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── P1-I 3-B: 다음 주기 T-1-1 진입 시 "이전 주기 개선안" 카드 ────
// 지식 누적을 명시적으로 가시화. project.previousCycleImprovements는 cycle 이동 시
// finalizeCycleTransition이 자동 저장하므로 여기서는 읽기만.
function PrevCycleImprovementsCard({
  projectId,
  data,
}: {
  projectId: string
  data: NonNullable<Project['previousCycleImprovements']>
}) {
  const dismissKey = `tcid-prev-cycle-card-dismissed:${projectId}:${data.cycleNumber}`
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return !!sessionStorage.getItem(dismissKey)
  })
  if (dismissed) return null

  function handleClose() {
    if (typeof window !== 'undefined') sessionStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  const choiceBadge = data.nextCycleChoice
    ? (data.nextCycleChoice === 'A' ? 'A안' : 'B안')
    : '미선택'

  return (
    <div className="rounded-2xl border-2 border-[#7B1FA2] bg-gradient-to-br from-[#F3E5F5] via-white to-[#F3E5F5] p-4 mb-3 shadow-sm relative">
      <button
        type="button"
        onClick={handleClose}
        aria-label="카드 닫기"
        className="absolute top-3 right-3 w-7 h-7 rounded-full hover:bg-[#EADEEF] flex items-center justify-center text-[#7B1FA2] transition-colors"
      >
        <XIcon size={14} weight="bold" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <div className="w-9 h-9 rounded-full bg-[#7B1FA2] flex items-center justify-center flex-shrink-0">
          <Sparkle size={18} weight="fill" className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[12px] font-extrabold text-[#6A1B9A] uppercase tracking-wider">
              이전 주기({data.cycleNumber}주기) 개선안
            </p>
            <span className={cn(
              'text-[10px] font-extrabold px-2 py-0.5 rounded-full',
              data.nextCycleChoice
                ? 'bg-[#7B1FA2] text-white'
                : 'bg-[#F1F3F4] text-[#5F6368]'
            )}>
              다음 주기: {choiceBadge}
            </span>
          </div>
          <div className="mt-2 space-y-1.5 text-[12px] text-[#202124] leading-relaxed">
            {data.e11Improvement && (
              <p>
                <span className="font-bold text-[#6A1B9A]">수업 성찰 수정안</span>
                {' — '}
                <span className="text-[#3C4043]">{data.e11Improvement}</span>
              </p>
            )}
            {data.e21Improvement && (
              <p>
                <span className="font-bold text-[#6A1B9A]">팀 활동 개선안</span>
                {' — '}
                <span className="text-[#3C4043]">{data.e21Improvement}</span>
              </p>
            )}
            {!data.e11Improvement && !data.e21Improvement && (
              <p className="text-[#5F6368] italic">기록된 개선안이 없습니다.</p>
            )}
          </div>
          <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6A1B9A] bg-white/80 px-2.5 py-1 rounded-full border border-[#CE93D8]">
            <ArrowRight size={12} weight="bold" />
            이번 주기 비전 설정에 반영하세요
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 초대코드 확대 모달 ───────────────────────────────
function InviteCodeModal({
  open,
  inviteCode,
  onClose,
}: {
  open: boolean
  inviteCode: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    setCopied(false)
    setCopyError(false)
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function handleCopy() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[#202124]/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-code-title"
        aria-describedby="invite-code-description"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-[#D2E3FC] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#DADCE0] bg-gradient-to-br from-[#E8F0FE] to-white px-6 py-5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#1A73E8] text-white">
            <Key size={23} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A73E8]">팀 참여</p>
            <h2 id="invite-code-title" className="text-lg font-extrabold text-[#202124]">이 방의 초대코드</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="초대코드 닫기"
            className="rounded-full p-2 text-[#5F6368] transition-colors hover:bg-white hover:text-[#202124] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
          >
            <XIcon size={20} weight="bold" />
          </button>
        </div>

        <div className="px-6 py-8 text-center sm:px-10 sm:py-10">
          <p
            className="select-all break-all text-[clamp(2.25rem,10vw,4.5rem)] font-black leading-none tracking-[0.12em] text-[#1A73E8]"
            aria-label={`초대코드 ${inviteCode}`}
          >
            {inviteCode}
          </p>
          <p id="invite-code-description" className="mt-5 text-sm leading-relaxed text-[#5F6368]">
            팀원에게 이 코드를 공유하면 같은 설계 방에 참여할 수 있습니다.
          </p>

          <button
            type="button"
            onClick={handleCopy}
            className="mt-7 inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#1557B0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
          >
            {copied ? <Check size={18} weight="bold" /> : <Copy size={18} weight="bold" />}
            {copied ? '복사됨!' : '초대코드 복사'}
          </button>
          {copyError && (
            <p role="alert" className="mt-3 text-xs font-medium text-[#C5221F]">
              복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── 메인 페이지 ─────────────────────────────────────
const STAGE_PANEL_BORDER: Record<string, string> = {
  T:  'border-[2.5px] border-[#4285F4] shadow-[0_2px_12px_rgba(26,115,232,0.18)]',
  A:  'border-[2.5px] border-[#AB47BC] shadow-[0_2px_12px_rgba(123,31,162,0.18)]',
  Ds: 'border-[2.5px] border-[#26A69A] shadow-[0_2px_12px_rgba(0,137,123,0.18)]',
  DI: 'border-[2.5px] border-[#EF6C00] shadow-[0_2px_12px_rgba(230,81,0,0.18)]',
  E:  'border-[2.5px] border-[#E53935] shadow-[0_2px_12px_rgba(198,40,40,0.18)]',
}

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const {
    project, setProject, setMessages, setMessagesLoaded,
    setKeyNotes,
    pendingStageMove, setPendingStageMove, userProfile,
    setDiscussionMode, setTeamDiscussionStartIdx, messages,
    currentActivity, setCurrentActivity,
    viewingActivity, setViewingActivity,
    setActivityStatus, resetProjectState,
    discussionMode, activityStatus,
  } = useProjectStore()

  const [claimingHost, setClaimingHost] = useState(false)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [showMaterials, setShowMaterials] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [showOntology, setShowOntology] = useState(false)
  const [showInviteCode, setShowInviteCode] = useState(false)
  const closeInviteCode = useCallback(() => setShowInviteCode(false), [])
  // 팀원 팝오버 위치 (portal에서 fixed 좌표로 렌더 — 좌측 사이드바의 overflow-hidden을 벗어나기 위함)
  const membersBtnRef = useRef<HTMLButtonElement>(null)
  const [membersPopoverPos, setMembersPopoverPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (!showMembers || !membersBtnRef.current) { setMembersPopoverPos(null); return }
    const rect = membersBtnRef.current.getBoundingClientRect()
    setMembersPopoverPos({ top: rect.bottom + 8, left: rect.left })
  }, [showMembers])
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null)
  // Task #34: 레이아웃 패널 접기/펼치기 (localStorage 영속). projectId별 독립.
  const layout = useLayoutToggle(projectId)

  useEffect(() => {
    if (!projectId) return
    resetProjectState()  // 프로젝트 전환 시 이전 프로젝트 상태 초기화
    setProjectLoadError(null)
    const unsubProject = watchProject(
      projectId,
      (p) => {
        if (p) {
          setProjectLoadError(null)
          setProject(p)
        } else {
          setProject(null)
          setProjectLoadError('프로젝트를 찾을 수 없습니다. 삭제되었거나 접근할 수 없는 프로젝트입니다.')
        }
      },
      (error) => {
        setProject(null)
        const message = error.message.toLowerCase()
        if (message.includes('permission') || message.includes('permission-denied')) {
          setProjectLoadError('이 프로젝트에 접근할 수 없습니다. 권한을 확인한 뒤 다시 시도해주세요.')
          return
        }
        setProjectLoadError('프로젝트를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      }
    )
    return () => unsubProject()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 중요 노트(keyNotes) subcollection 실시간 구독 → store union 갱신
  // (노트를 프로젝트 문서 배열에서 subcollection으로 이전 — 길이/개수 무제한)
  useEffect(() => {
    if (!projectId) return
    const unsub = watchKeyNotes(projectId, setKeyNotes)
    return () => unsub()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 레거시 keyNotes 배열 → subcollection 1회 마이그레이션 (호스트만, 멱등·동시성 안전)
  const keyNotesMigratedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!project || !userProfile) return
    if (project.demoRun) return
    const isHost = project.hostUid === userProfile.uid || project.createdBy === userProfile.uid
    if (!isHost) return
    if (keyNotesMigratedRef.current === projectId) return
    keyNotesMigratedRef.current = projectId
    migrateKeyNotesToSubcollection(projectId).catch(err => console.warn('[keyNotes] migration failed:', err))
  }, [project, userProfile, projectId])

  // 개인 설계(solo)는 대기실이 없다. 아직 started가 아니면(구버전 데이터 등) 방장(=생성자)이 자동으로
  // 시작 처리하여 바로 설계 화면으로 진입시킨다. 협력 프로젝트 경로는 건드리지 않는다 (WaitingRoom 유지).
  const soloAutoStartRef = useRef<string | null>(null)
  useEffect(() => {
    if (!project || !userProfile) return
    if (project.demoRun) return
    if (project.mode !== 'solo' || project.started) return
    const isHost = project.hostUid === userProfile.uid || project.createdBy === userProfile.uid
    if (!isHost) return
    if (soloAutoStartRef.current === projectId) return
    soloAutoStartRef.current = projectId
    startProject(projectId).catch(err => console.error('[solo] auto-start failed:', err))
  }, [project, userProfile, projectId])

  // Firestore currentActivity → Zustand 동기화 (방장이 이동하면 모두 따라감)
  useEffect(() => {
    if (!project?.currentActivity) return
    if (project.currentActivity !== currentActivity) {
      setCurrentActivity(project.currentActivity)
      // A demo observer reviewing an earlier activity must not be pulled away by the runner.
      if (!project.demoRun || viewingActivity === currentActivity) setViewingActivity(project.currentActivity)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.currentActivity])

  // Firestore activityStatuses → Zustand 동기화 (건너뛰기·경고 표시 공유)
  useEffect(() => {
    if (!project?.activityStatuses) return
    Object.entries(project.activityStatuses).forEach(([code, status]) => {
      setActivityStatus(code as import('@/types').ActivityCode, status as import('@/types').StageStatus)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.activityStatuses])

  // 마지막 E 단계 활동 완료 후 E→T 이동 모달 자동 트리거.
  // 모달에서 현재 주기 유지/새 주기 시작을 다시 명시적으로 선택한다.
  // 한 번 띄운 뒤에는 sessionStorage로 무시 표시 (per-user, per-session, per-project)
  useEffect(() => {
    if (!project) return
    if (project.demoRun) return
    if (project.currentStage !== 'E') return
    if (pendingStageMove) return
    if (typeof window === 'undefined') return
    const dismissKey = `tcid-cycle-dismissed:${projectId}`
    if (sessionStorage.getItem(dismissKey)) return

    const eStage = STAGES.find(stage => stage.code === 'E')!
    const eStageDone = eStage.activities.every(activity =>
      checkEffectivelyDone(activity, project.activityStatuses ?? {}, project.artifacts),
    )
    const nextCycleChoice = parseNextCycleChoice(
      project.artifacts?.['E-2-1']?.content?.['다음 주기 선택'] as string | undefined,
    )
    if (shouldOpenCycleTransition(eStageDone, nextCycleChoice)) {
      sessionStorage.setItem(dismissKey, '1')
      setPendingStageMove('T')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.currentStage, project?.mode, project?.activityStatuses, project?.artifacts, projectId])

  // P1-I 3-C: 새 주기 T-1-1의 첫 산출물 저장 감지 → isECompleted false 복귀.
  // 방장이 단독으로 write하며, `clearECompleted`는 idempotent하므로 race condition 무해.
  useEffect(() => {
    if (!project) return
    if (project.demoRun) return
    if (project.isECompleted !== true) return
    if (!hasNewCycleT11Artifact(
      project.cycleStartT11Version,
      project.artifacts?.['T-1-1']?.version,
    )) return
    const isHost = project.hostUid === userProfile?.uid || project.createdBy === userProfile?.uid
    if (!isHost) return
    clearECompleted(projectId).catch(err => {
      console.warn('clearECompleted failed:', err)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.isECompleted, project?.cycleStartT11Version, project?.artifacts?.['T-1-1']?.version, projectId, userProfile?.uid])

  // Firestore teamDiscussions[currentActivity] → Zustand 동기화
  useEffect(() => {
    if (!project || !currentActivity) return
    const td = project.teamDiscussions?.[currentActivity]
    if (td?.active) {
      setDiscussionMode('team_discussion')
      if (td.startedAt) {
        const idx = messages.filter(
          m => m.role !== 'system' && m.createdAt?.toDate?.()?.getTime?.() < td.startedAt!
        ).length
        setTeamDiscussionStartIdx(idx)
      }
    } else {
      setDiscussionMode('ai_facilitated')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.teamDiscussions?.[currentActivity]?.active, project?.teamDiscussions?.[currentActivity]?.startedAt, currentActivity])

  useEffect(() => {
    if (!projectId || !currentActivity || projectLoadError) return
    setMessagesLoaded(false)  // 활동 전환 시 리셋
    setMessages([])
    let didReceiveFirstSnapshot = false
    const loadingFallback = window.setTimeout(() => {
      if (!didReceiveFirstSnapshot) {
        console.warn('watchMessages timed out before first snapshot:', { projectId, currentActivity })
        setMessagesLoaded(true)
      }
    }, 5000)
    const unsubMessages = watchMessages(
      projectId,
      currentActivity,
      (msgs) => {
        didReceiveFirstSnapshot = true
        window.clearTimeout(loadingFallback)
        setMessages(msgs)
        setMessagesLoaded(true)   // Firestore 첫 응답 확인
      },
      () => {
        didReceiveFirstSnapshot = true
        window.clearTimeout(loadingFallback)
        setMessagesLoaded(true)
      },
      project?.currentCycle ?? 1,
    )
    return () => {
      window.clearTimeout(loadingFallback)
      unsubMessages()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentActivity, projectLoadError, project?.currentCycle])

  // 대기실 진입 시 멤버 정보 등록 (색상이 바뀐 경우 항상 업데이트)
  useEffect(() => {
    if (!project || !userProfile) return
    if (project.demoExperience?.scenarioId) return
    const uid = userProfile.uid
    const stored = project.memberInfo?.[uid]
    // 미등록이거나 색상이 현재 프로필과 다르면 업데이트
    if (stored && stored.color === userProfile.color) return
    // 이 경로는 이미 멤버인 사용자의 프로필 갱신 — joinProject 내부에서
    // memberUids 포함 여부를 확인하고 inviteCode 검증을 스킵한다. 빈 문자열 OK.
    joinProject(projectId, uid, project.inviteCode ?? '', {
      displayName: userProfile.displayName,
      color: userProfile.color ?? '#A0BCE8',
      emoji: userProfile.emoji ?? '👤',
    }).catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, userProfile?.uid, userProfile?.color])

  if (!project) {
    if (projectLoadError) {
      return (
        <div className="flex items-center justify-center h-screen bg-[#F8F9FA] px-4">
          <div className="max-w-md w-full rounded-3xl bg-white border border-[#E8EAED] shadow-xl p-7 text-center">
            <p className="text-[18px] font-extrabold text-[#202124]">프로젝트를 열 수 없습니다</p>
            <p className="text-sm text-[#5F6368] mt-3 leading-relaxed">{projectLoadError}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="mt-6 inline-flex items-center justify-center px-5 py-3 rounded-2xl bg-[#1A73E8] text-white text-sm font-bold hover:bg-[#1557B0] transition-colors"
            >
              대시보드로 돌아가기
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-center h-screen bg-[#F8F9FA]">
        <div className="flex flex-col items-center gap-4 text-[#5F6368]">
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={32} className="text-[#1A73E8]" /></span>
          <p className="text-sm font-medium">프로젝트 불러오는 중...</p>
        </div>
      </div>
    )
  }

  const uid = userProfile?.uid ?? ''
  const isHost = project.demoRun ? false : project.demoExperience?.scenarioId
    ? project.hostUid === uid
    : project.hostUid === uid || project.createdBy === uid

  async function handleClaimHost() {
    if (!project || hasMemberHost(project)) return
    if (!window.confirm('방장 권한을 가져오시겠습니까?\n기존 방장은 방장 권한을 잃게 됩니다.')) return
    setClaimingHost(true)
    await transferHost(projectId, uid).catch(console.error)
    setClaimingHost(false)
  }

  // 대기실
  if (!project.started && !project.demoRun) {
    // 개인 설계: 대기실 대신 자동 시작(soloAutoStart effect)이 적용되는 동안 짧은 로딩만 노출.
    if (project.mode === 'solo') {
      return (
        <div className="flex items-center justify-center h-screen bg-[#F8F9FA]">
          <div className="flex flex-col items-center gap-4 text-[#5F6368]">
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={32} className="text-[#1A73E8]" /></span>
            <p className="text-sm font-medium">설계 화면을 준비하는 중...</p>
          </div>
        </div>
      )
    }
    return (
      <WaitingRoom
        project={project}
        projectId={projectId}
        uid={uid}
        isHost={isHost}
        userProfile={userProfile}
        onBecomeHost={() => transferHost(projectId, uid)}
      />
    )
  }

  const currentStage = project.demoRun ? ACTIVITY_META[viewingActivity].stage : project.currentStage ?? 'T'
  const isTeamMode = discussionMode === 'team_discussion'

  function panelBorder(panelId: string) {
    // 팀채팅 모드일 때 chat 패널은 pulse 애니메이션 테두리
    if (panelId === 'chat' && isTeamMode) {
      return 'team-chat-active'
    }
    if (activePanel === null) return cn(STAGE_PANEL_BORDER[currentStage], 'transition-all duration-300')
    if (activePanel === panelId) return cn(STAGE_PANEL_BORDER[currentStage], 'transition-all duration-200')
    return 'border border-[#E8EAED] shadow-none transition-all duration-300'
  }

  return (
    <div className="flex h-screen bg-[#F8F9FA] overflow-hidden p-3 gap-2">

      {/* ══ 좌측 컬럼: 내비 + ActivitySidebar (Task #34: 토글 가능) ══ */}
      <div
        className={cn('flex-shrink-0 flex flex-col rounded-2xl overflow-hidden transition-all duration-300',
          layout.sidebar ? '' : 'w-10', panelBorder('left'))}
        onMouseEnter={() => setActivePanel('left')}
        onMouseLeave={() => setActivePanel(null)}
      >
        {layout.sidebar ? (
          <>
            {/* 좌측 상단: 내비게이션 — 컴팩트 홈 버튼 + 제목 + 방장 칩 + 팀원·패널토글 */}
            <div className="flex flex-col gap-2 px-3 py-3 bg-white border-b border-[#DADCE0] flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => router.push('/dashboard')}
                title="대시보드로"
                aria-label="대시보드로 이동"
                className="flex items-center gap-1 text-[#5F6368] hover:text-[#1A73E8] hover:bg-[#E8F0FE]
                  rounded-full px-2 py-1.5 text-[12px] font-semibold transition-all"
              >
                <House size={15} weight="bold" />
                홈
              </button>
              <h1 title={project.title} className="text-[15px] font-semibold text-[#202124] truncate flex-1 min-w-0">{project.title}</h1>
              <PanelToggle direction="left" onClick={() => layout.toggle('sidebar')} label="활동 목록 접기" />
              </div>
              <div className="flex items-center gap-2">
              {isHost ? (
                <span
                  title="방장"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#FFE7C7] px-4 text-[13px] font-medium text-[#8A3D00] flex-shrink-0"
                >
                  <Crown size={18} weight="fill" />
                  방장
                </span>
              ) : !project.demoRun && !hasMemberHost(project) ? (
                <MD3Button
                  onClick={handleClaimHost}
                  disabled={claimingHost}
                  title={claimingHost ? '처리 중...' : '방장 되기'}
                  aria-label="방장 되기"
                  variant="outlined" tone="amber" size="sm"
                  icon={<Crown size={18} weight="fill" />}
                >
                  {claimingHost ? '처리 중...' : '방장 되기'}
                </MD3Button>
              ) : project.demoRun ? <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#D3E3FD] px-4 text-[13px] font-medium text-[#0842A0]"><Sparkle size={18} weight="fill" />AI 팀</span> : null}
              <div className="ml-auto flex items-center gap-1">
                {/* 팀원 수·목록 — 버튼만 인라인, 팝오버는 createPortal로 body에 렌더(좌측 overflow-hidden 탈출) */}
                <MD3Button
                  ref={membersBtnRef}
                  onClick={() => setShowMembers(v => !v)}
                  title="팀원 목록"
                  aria-label={`팀원 ${project.memberUids?.length ?? 1}명 보기`}
                  aria-expanded={showMembers}
                  variant="tonal" tone="blue" size="sm" selected={showMembers}
                  icon={<Users size={18} weight="regular" />}
                  trailing={<CaretDown size={14} weight="bold" />}
                >
                  팀원 {project.memberUids?.length ?? 1}명
                </MD3Button>
              </div>
              </div>
            </div>
            {/* 좌측 하단: 활동 사이드바 */}
            <div className="flex-1 overflow-hidden">
              <ActivitySidebar />
            </div>
          </>
        ) : (() => {
          // Task #34 접힌 상태: 현재 단계 컬러 stripe + 세로 활동코드 + 미니 진행률(세로 fill).
          // 완료 판정은 ActivitySidebar와 동일한 헬퍼(`checkEffectivelyDone`) 재사용 — 판정 규약 통일.
          const stageInfo = STAGES.find(s => s.code === currentStage)
          // solo는 숨김 활동을 진행률 계산에서 제외 (사이드바 표시와 동일 기준 유지)
          const activities = (stageInfo?.activities ?? []).filter(
            a => project.mode !== 'solo' || !SOLO_HIDDEN_ACTIVITIES.includes(a)
          )
          const completedCount = activities.filter(a => checkEffectivelyDone(a, activityStatus, project?.artifacts)).length
          const totalCount = activities.length
          const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0
          const stageColor = STAGE_COLOR[currentStage]
          return (
            <button
              type="button"
              onClick={() => layout.toggle('sidebar')}
              aria-label={`활동 목록 펼치기 (${currentStage} 단계 진행 ${completedCount}/${totalCount})`}
              title={`활동 목록 펼치기 — ${currentStage} ${completedCount}/${totalCount}`}
              className="flex-1 flex flex-col items-center justify-start gap-3 pt-3 pb-3 bg-white hover:bg-[#F8F9FA] transition-colors"
            >
              <span
                className="flex items-center justify-center w-6 h-6 rounded-md text-[#9AA0A6]"
                aria-hidden="true"
              >
                <CaretRight size={14} weight="bold" />
              </span>

              {/* 현재 단계 색 dot — 접힘 상태에서도 "어느 단계"를 한눈에. live-dot-pulse로 진행 중임을 표현. */}
              <span
                aria-hidden="true"
                className={cn('w-2 h-2 rounded-full flex-shrink-0 live-dot-pulse', stageColor.bg)}
                style={{ color: stageColor.hex }}
              />

              {currentActivity && (
                <div className="flex flex-col items-center gap-1.5 min-h-0">
                  <span
                    className="text-[12px] font-extrabold text-[#5F6368] tracking-widest"
                    style={{ writingMode: 'vertical-rl' }}
                  >
                    {displayActivityCode(currentActivity)}
                  </span>
                  {ACTIVITY_META[currentActivity]?.label && (
                    <span
                      className="text-[11px] font-semibold text-[#9AA0A6] tracking-wider"
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      {ACTIVITY_META[currentActivity].label}
                    </span>
                  )}
                </div>
              )}

              {/* 미니 진행률: 세로 fill 바 + x/n 카운터. 접힘 상태에서도 "단계 안에서 몇 개 완료" 읽기 가능 */}
              {totalCount > 0 && (
                <div className="flex flex-col items-center gap-1.5 mt-auto">
                  <div
                    className="relative w-1.5 h-16 bg-[#F1F3F4] rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={completedCount}
                    aria-valuemin={0}
                    aria-valuemax={totalCount}
                    aria-label={`${currentStage} 단계 진행률 ${completedCount}/${totalCount}`}
                  >
                    <div
                      className={cn('absolute bottom-0 left-0 right-0 rounded-full transition-all duration-500', stageColor.bg)}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold tabular-nums text-[#5F6368]">
                    {completedCount}/{totalCount}
                  </span>
                </div>
              )}
            </button>
          )
        })()}
      </div>

      {/* ══ 중앙 컬럼: 단계 섹션 + ChatPanel ══ */}
      <div className="flex-1 flex flex-col gap-2 overflow-hidden min-w-0">
        {/* 중앙 상단: 단계 바 — 5단계는 중앙정렬, 구조도 버튼은 우측 끝에 absolute로 floating */}
        <div
          className={cn('rounded-2xl bg-white flex-shrink-0 transition-all duration-300',
            layout.stage ? 'py-3' : 'py-0', panelBorder('stage'))}
          onMouseEnter={() => setActivePanel('stage')}
          onMouseLeave={() => setActivePanel(null)}
        >
          {layout.stage ? (
            <div className="relative">
              <StageBar />
              {/* 구조도 — 단계 노드와 동일 레이아웃(flex-col + h-14 slot + 라벨), 무지개색. 평가 단계 우측에 배치. */}
              <button
                type="button"
                onClick={() => setShowOntology(true)}
                title="프로젝트 온톨로지 보기 — 전체 설계 구조를 한눈에"
                aria-label="프로젝트 온톨로지 보기"
                className="absolute top-12 right-[15%] flex flex-col items-center gap-1 select-none hover:scale-105 active:scale-95 transition-transform"
              >
                <div className="h-14 flex items-center justify-center relative">
                  <div
                    className="w-11 h-11 flex items-center justify-center relative overflow-hidden"
                    style={{
                      animation: 'morph-shape 9s ease-in-out infinite',
                      background: 'linear-gradient(135deg, #EF4444 0%, #F97316 18%, #FACC15 34%, #22C55E 50%, #3B82F6 68%, #8B5CF6 84%, #EC4899 100%)',
                      filter: 'drop-shadow(0 4px 12px rgba(139, 92, 246, 0.35))',
                    }}
                  >
                    <GraphIcon size={22} weight="fill" className="text-white relative z-10" />
                  </div>
                </div>
                <span
                  className="text-[11px] font-extrabold leading-tight"
                  style={{
                    background: 'linear-gradient(90deg, #EF4444, #F97316, #EAB308, #22C55E, #3B82F6, #8B5CF6, #EC4899)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  구조도
                </span>
              </button>
              {/* PanelToggle — 좌상단으로 이동 (구조도와 우측 겹침 회피) */}
              <div className="absolute top-1 left-2">
                <PanelToggle direction="up" onClick={() => layout.toggle('stage')} label="단계 바 접기" />
              </div>
            </div>
          ) : (
            // Task #2 업그레이드: 접힘 상태에 정보 밀도 추가.
            // 좌 → 우: 단계 브레드크럼(5 chip) · 현재 활동명+진행률 · 팀원 아바타 · 펼침 캐럿.
            // 모든 요소가 "지금 어디서 뭘 하고 있나"를 한 줄로 읽히게 함 (스펙 7-1 반영).
            (() => {
              const stageInfo = STAGES.find(s => s.code === currentStage)
              const stageActivities = stageInfo?.activities ?? []
              const stageDoneCount = stageActivities.filter(a => {
                return project.activityStatuses?.[a] === 'completed'
              }).length
              const stageTotal = stageActivities.length
              const color = STAGE_COLOR[currentStage]
              const collapsedMemberUids: string[] = project.memberUids ?? (project.createdBy ? [project.createdBy] : [])
              const collapsedMemberInfo = project.memberInfo ?? {}
              const displayMembers = collapsedMemberUids.slice(0, 4)
              const extraMembers = Math.max(0, collapsedMemberUids.length - displayMembers.length)
              return (
                <button
                  type="button"
                  onClick={() => layout.toggle('stage')}
                  aria-label="단계 바 펼치기"
                  title="단계 바 펼치기"
                  className="w-full h-10 flex items-center gap-3 px-3 hover:bg-[#F8F9FA] transition-colors rounded-2xl"
                >
                  {/* 브레드크럼 미니: 5단계 chip — 순서대로 위아래 까딱(bob)하면서 진행감 표현. 현재 단계는 크기 + 색으로 강조. */}
                  <div className="flex items-end gap-0.5 flex-shrink-0 h-4" aria-hidden="true">
                    {STAGES.map((s, i) => {
                      const isCurrent = s.code === currentStage
                      const c = STAGE_COLOR[s.code]
                      return (
                        <span key={s.code} className="flex items-end gap-0.5 h-full">
                          <span
                            className={cn('rounded-sm stage-wave-bob',
                              isCurrent ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5')}
                            style={{
                              backgroundColor: c.hex,
                              color: c.hex,
                              animationDelay: `${i * 0.22}s`,
                            }}
                          />
                          {i < STAGES.length - 1 && (
                            <span className="text-[9px] text-[#DADCE0] font-black leading-none pb-0.5">›</span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                  <span className="h-4 w-px bg-[#DADCE0] flex-shrink-0" />
                  {/* 현재 단계 + 활동명 + 진행률 */}
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <span
                      className="px-1.5 py-0.5 rounded-md text-[10px] font-black text-white tabular-nums"
                      style={{ backgroundColor: color.hex }}
                    >
                      {currentStage}
                    </span>
                    <span className="text-[12px] font-extrabold text-[#202124]">
                      {STAGE_LABELS[currentStage]}
                    </span>
                    <span className="text-[11px] font-semibold text-[#5F6368] tabular-nums">
                      {stageDoneCount}/{stageTotal}
                    </span>
                  </span>
                  {currentActivity && (
                    <>
                      <span className="text-[#DADCE0] text-[11px]" aria-hidden="true">·</span>
                      <span className="text-[11px] font-semibold text-[#5F6368] truncate min-w-0">
                        <span className="font-mono tabular-nums" style={{ color: color.hex }}>{displayActivityCode(currentActivity)}</span>
                      </span>
                    </>
                  )}
                  {/* 중간 스페이서 */}
                  <span className="flex-1" />
                  {/* 팀원 아바타 스택 */}
                  {displayMembers.length > 0 && (
                    <div className="flex items-center -space-x-1.5 flex-shrink-0" aria-label={`팀원 ${collapsedMemberUids.length}명`}>
                      {displayMembers.map(mUid => {
                        const info = collapsedMemberInfo[mUid]
                        const isThisHost = mUid === project.hostUid || mUid === project.createdBy
                        const avatarBg = info?.color ?? '#9AA0A6'
                        return (
                          <span
                            key={mUid}
                            className="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white ring-2 ring-white select-none"
                            style={{ backgroundColor: avatarBg }}
                            title={info?.displayName ?? mUid.slice(0, 8)}
                          >
                            {(info?.displayName?.[0] ?? '?').toUpperCase()}
                            {isThisHost && (
                              <Crown size={8} weight="fill" className="absolute -top-1 -right-0.5 text-[#F9AB00] drop-shadow" />
                            )}
                          </span>
                        )
                      })}
                      {extraMembers > 0 && (
                        <span className="w-6 h-6 rounded-full bg-[#F1F3F4] text-[#5F6368] text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white tabular-nums">
                          +{extraMembers}
                        </span>
                      )}
                    </div>
                  )}
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-md text-[#9AA0A6] flex-shrink-0"
                    aria-hidden="true"
                  >
                    <CaretDown size={14} weight="bold" />
                  </span>
                </button>
              )
            })()
          )}
        </div>
        {/* P1-I 3-B: T-1-1 진입 시 이전 주기 개선안 카드 */}
        {currentActivity === 'T-1-1' && project.previousCycleImprovements && (
          <PrevCycleImprovementsCard
            projectId={projectId}
            data={project.previousCycleImprovements}
          />
        )}
        {/* 중앙 하단: 채팅 패널 */}
        <div
          className={cn('flex-1 overflow-hidden rounded-2xl', panelBorder('chat'))}
          onMouseEnter={() => setActivePanel('chat')}
          onMouseLeave={() => setActivePanel(null)}
        >
          <ChatPanel />
        </div>
      </div>

      {/* ══ 우측 컬럼: 정보 + ArtifactPanel (Task #34: 토글 가능) ══ */}
      <div
        className={cn('flex-shrink-0 flex flex-col rounded-2xl overflow-hidden transition-all duration-300',
          layout.artifact ? 'w-80' : 'w-10', panelBorder('right'))}
        onMouseEnter={() => setActivePanel('right')}
        onMouseLeave={() => setActivePanel(null)}
      >
        {layout.artifact ? (
        <>
        {/* 우측 상단: 프로젝트 정보 — 자료함은 일단 숨김. 보고서·초대코드는 텍스트 유지. */}
        <div className="flex items-center justify-end gap-1.5 px-2 h-14 bg-white border-b border-[#DADCE0] flex-shrink-0">
          <PanelToggle direction="right" onClick={() => layout.toggle('artifact')} label="산출물 패널 접기" className="mr-auto" />
          {project.demoRun && <DemoProjectToolbar />}
          {/* 구조도 버튼은 중앙 단계 섹션으로 이동됨 */}
          {project.stageReports && Object.keys(project.stageReports).length > 0 && (
            <button
              onClick={() => setShowReports(true)}
              className="flex items-center gap-1 text-[11px] bg-[#E0F2F1] text-[#00897B]
                px-2 py-1.5 rounded-full font-semibold hover:bg-[#B2DFDB] transition-colors flex-shrink-0 whitespace-nowrap"
            >
              <FileText size={13} weight="fill" />
              보고서
            </button>
          )}
          {isHost && (
            <button
              onClick={() => setShowPublish(true)}
              title={project.publicStatus?.isPublic ? '공개 링크 관리' : '공개 링크로 배포'}
              className={cn(
                'flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-full font-semibold transition-colors flex-shrink-0 whitespace-nowrap',
                project.publicStatus?.isPublic
                  ? 'bg-[#E6F4EA] text-[#188038] hover:bg-[#CEEAD6]'
                  : 'bg-[#F1F3F4] text-[#5F6368] hover:bg-[#E8F0FE] hover:text-[#1A73E8]',
              )}
            >
              <Globe size={13} weight={project.publicStatus?.isPublic ? 'fill' : 'regular'} />
              {project.publicStatus?.isPublic ? '공개 중' : '공개'}
            </button>
          )}
          {!project.demoRun && project.mode !== 'solo' && project.inviteCode && (
            <button
              type="button"
              onClick={() => setShowInviteCode(true)}
              title="초대코드 크게 보기"
              aria-haspopup="dialog"
              aria-expanded={showInviteCode}
              className="flex items-center gap-1 text-[11px] bg-[#E8F0FE] text-[#1A73E8]
                px-2 py-1.5 rounded-full font-semibold hover:bg-[#D2E3FC] transition-colors flex-shrink-0 whitespace-nowrap
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
            >
              <Key size={13} weight="regular" />
              {project.inviteCode}
            </button>
          )}
          {/* 팀원 목록 버튼은 좌측 사이드바 헤더로 이동됨 (우측 폭 확보) */}
        </div>
        {/* 우측 하단: 산출물 패널 */}
        <div className="flex-1 overflow-hidden">
          <ArtifactPanel />
        </div>
        </>
        ) : (
          // 접힌 상태 — CollapsedArtifactStrip: 섹션 개수 뱃지 + 상태 점 + 업데이트 pulse
          <CollapsedArtifactStrip onExpand={() => layout.toggle('artifact')} />
        )}
      </div>

      {!project.demoRun && pendingStageMove && <StageMoveModal />}
      {!project.demoRun && project.mode !== 'solo' && <PendingConfirmationBanner />}

      {showReports && (
        <StageReportsModal onClose={() => setShowReports(false)} />
      )}

      {project.inviteCode && (
        <InviteCodeModal
          open={showInviteCode}
          inviteCode={project.inviteCode}
          onClose={closeInviteCode}
        />
      )}

      <PublishModal
        open={showPublish}
        onClose={() => setShowPublish(false)}
        project={project}
        projectId={projectId}
        uid={uid}
      />

      <ProjectOntologyModal
        open={showOntology}
        onClose={() => setShowOntology(false)}
        project={project}
        onOpenActivity={(code) => {
          setViewingActivity(code)
        }}
      />

      {/* 팀원 팝오버 — createPortal로 body에 렌더해 좌측 사이드바 overflow-hidden 탈출 */}
      {showMembers && membersPopoverPos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setShowMembers(false)} />
          <div
            className="fixed z-[210] min-w-[220px]"
            style={{
              top: membersPopoverPos.top,
              left: membersPopoverPos.left,
              filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.13))',
            }}
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-[#E8EAED]">
              <div className="px-4 py-2.5 border-b border-[#F1F3F4]">
                <p className="text-[11px] font-bold text-[#9AA0A6] uppercase tracking-wider">{project.mode === 'solo' ? '참여자' : '참여 중인 팀원'}</p>
              </div>
              <div className="py-1.5">
                {(project.memberUids ?? []).map((mUid: string) => {
                  const info = project.memberInfo?.[mUid]
                  const displayName = info?.displayName ?? mUid
                  const color = info?.color ?? '#A0BCE8'
                  const isCurrentUser = mUid === uid
                  const isHostMember = mUid === (project.hostUid ?? project.createdBy)
                  return (
                    <div key={mUid} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#F8F9FA]">
                      <Avatar name={displayName} color={color} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[#202124] truncate">
                          {displayName}
                          {isCurrentUser && <span className="text-[11px] text-[#9AA0A6] font-normal ml-1">(나)</span>}
                        </p>
                        {isHostMember && (
                          <p className="text-[11px] text-[#F9AB00] font-bold flex items-center gap-0.5">
                            <Crown size={10} weight="fill" /> 방장
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}

      {showMaterials && (
        <ProjectMaterialsModal
          projectId={projectId}
          userProfile={userProfile}
          onClose={() => setShowMaterials(false)}
        />
      )}

      {/* 팀원: 방장이 분석 모달을 열면 동기화하여 표시 */}
      {!project.demoRun && !isHost && project?.analysisOpen && (
        <StageAnalysisModal
          isHost={false}
          onClose={() => setAnalysisOpen(projectId, false).catch(console.error)}
        />
      )}

    </div>
  )
}

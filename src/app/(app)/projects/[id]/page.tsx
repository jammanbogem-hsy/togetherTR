'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import {
  watchProject, watchMessages, startProject, transferHost,
  sendLobbyMessage, watchLobbyMessages, joinProject, setTeamDiscussion,
  clearECompleted,
  type LobbyMessage
} from '@/lib/firebase/projects'
import type { Project } from '@/types'
import { STAGES } from '@/types'
import type { UserProfile } from '@/lib/auth'
import { StageBar } from '@/components/stage/StageBar'
import { ActivitySidebar } from '@/components/activity/ActivitySidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel'
import { StageMoveModal } from '@/components/modals/StageMoveModal'
import { StageAnalysisModal } from '@/components/modals/StageAnalysisModal'
import { StageReportsModal } from '@/components/modals/StageReportsModal'
import { ProjectMaterialsModal } from '@/components/materials/ProjectMaterialsModal'
import { setAnalysisOpen } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { SpinnerGap, PlayCircle, Crown, Copy, Check, Users, Key, ArrowLeft, PaperPlaneRight, FileText, Books, Sparkle, X as XIcon, ArrowRight, CaretRight, CaretLeft, CaretDown } from '@phosphor-icons/react'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { useLayoutToggle } from '@/components/layout/useLayoutToggle'

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
                팀원에게 공유하면 대시보드 "방 참여하기"에서 입장할 수 있어요
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
                    <div
                      className="w-10 h-10 flex items-center justify-center text-[15px] font-extrabold text-white flex-shrink-0 select-none shadow-sm"
                      style={{
                        backgroundColor: info?.color ?? '#9AA0A6',
                        animation: isThisHost ? 'morph-shape 8s ease-in-out infinite' : 'morph-shape 11s ease-in-out infinite',
                      }}
                    >
                      {(info?.displayName?.[0] ?? '?').toUpperCase()}
                    </div>
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
              <button
                onClick={onBecomeHost}
                className="morph-btn w-full py-3 border-2 border-[#FFCC80] text-[#E65100] text-[13px] font-bold hover:bg-[#FFF3E0] transition-all flex items-center justify-center gap-1.5"
              >
                <Crown size={15} weight="fill" className="text-[#F9AB00]" />
                방장 권한 받기
              </button>
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
                  <div
                    className="w-9 h-9 flex items-center justify-center text-[13px] font-extrabold text-white flex-shrink-0 select-none"
                    style={{ backgroundColor: msg.color, animation: 'morph-shape 10s ease-in-out infinite' }}
                  >
                    {(msg.displayName?.[0] ?? '?').toUpperCase()}
                  </div>
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
    pendingStageMove, setPendingStageMove, userProfile,
    setDiscussionMode, setTeamDiscussionStartIdx, messages,
    currentActivity, setCurrentActivity,
    viewingActivity, setViewingActivity,
    setActivityStatus, resetProjectState,
    discussionMode,
  } = useProjectStore()

  const [claimingHost, setClaimingHost] = useState(false)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [showMaterials, setShowMaterials] = useState(false)
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

  // Firestore currentActivity → Zustand 동기화 (방장이 이동하면 모두 따라감)
  useEffect(() => {
    if (!project?.currentActivity) return
    if (project.currentActivity !== currentActivity) {
      setCurrentActivity(project.currentActivity)
      setViewingActivity(project.currentActivity)  // 방장 이동 시 뷰도 함께 이동
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

  // E→T 순환 모달 자동 트리거: E 단계 모든 활동이 완료(또는 경고+산출물)되면
  // pendingStageMove='T'를 설정하여 StageMoveModal(cycle 모드)을 띄움.
  // 한 번 띄운 뒤에는 sessionStorage로 무시 표시 (per-user, per-session, per-project)
  useEffect(() => {
    if (!project) return
    if (project.currentStage !== 'E') return
    if (pendingStageMove) return
    if (typeof window === 'undefined') return
    const dismissKey = `tcid-cycle-dismissed:${projectId}`
    if (sessionStorage.getItem(dismissKey)) return

    const eStage = STAGES.find(s => s.code === 'E')!
    const eAllDone = eStage.activities.every(a => {
      const status = project.activityStatuses?.[a]
      const hasArtifact = !!project.artifacts?.[a]
      return (status === 'completed' || status === 'warning') && hasArtifact
    })
    if (eAllDone) {
      sessionStorage.setItem(dismissKey, '1')
      setPendingStageMove('T')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.currentStage, project?.activityStatuses, project?.artifacts, projectId])

  // P1-I 3-C: 새 주기 T-1-1의 첫 산출물 저장 감지 → isECompleted false 복귀.
  // 방장이 단독으로 write하며, `clearECompleted`는 idempotent하므로 race condition 무해.
  useEffect(() => {
    if (!project) return
    if (project.isECompleted !== true) return
    if (!project.artifacts?.['T-1-1']) return
    const isHost = project.hostUid === userProfile?.uid || project.createdBy === userProfile?.uid
    if (!isHost) return
    clearECompleted(projectId).catch(err => {
      console.warn('clearECompleted failed:', err)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.isECompleted, project?.artifacts?.['T-1-1'], projectId, userProfile?.uid])

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
      }
    )
    return () => {
      window.clearTimeout(loadingFallback)
      unsubMessages()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentActivity, projectLoadError])

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
  const isHost = project.demoExperience?.scenarioId
    ? project.hostUid === uid
    : project.hostUid === uid || project.createdBy === uid

  async function handleClaimHost() {
    if (!window.confirm('방장 권한을 가져오시겠습니까?\n기존 방장은 방장 권한을 잃게 됩니다.')) return
    setClaimingHost(true)
    await transferHost(projectId, uid).catch(console.error)
    setClaimingHost(false)
  }

  // 대기실
  if (!project.started) {
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

  const currentStage = project?.currentStage ?? 'T'
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
            {/* 좌측 상단: 내비게이션 */}
            <div className="flex items-center gap-2 px-3 h-14 bg-white border-b border-[#DADCE0] flex-shrink-0">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex items-center gap-1 text-[#5F6368] hover:text-[#202124] hover:bg-[#F1F3F4]
                  rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-all"
              >
                <ArrowLeft size={16} weight="regular" />
                대시보드
              </button>
              <div className="h-4 w-px bg-[#DADCE0]" />
              <h1 className="text-[13px] font-semibold text-[#202124] truncate max-w-[100px]">{project.title}</h1>
              {isHost ? (
                <span className="flex items-center gap-1 text-[11px] bg-[#FEF7E0] text-[#B06000]
                  px-2 py-1 rounded-full font-semibold flex-shrink-0">
                  <Crown size={13} weight="fill" className="text-[#F9AB00]" />
                  방장
                </span>
              ) : (
                <button
                  onClick={handleClaimHost}
                  disabled={claimingHost}
                  className="flex items-center gap-1 text-[11px] border border-[#FBBC04] text-[#B06000]
                    px-2 py-1 rounded-full font-medium hover:bg-[#FEF7E0] transition-all disabled:opacity-50 flex-shrink-0"
                >
                  <Crown size={13} weight="fill" className="text-[#F9AB00]" />
                  {claimingHost ? '처리 중...' : '방장 되기'}
                </button>
              )}
              <div className="ml-auto">
                <PanelToggle direction="left" onClick={() => layout.toggle('sidebar')} label="활동 목록 접기" />
              </div>
            </div>
            {/* 좌측 하단: 활동 사이드바 */}
            <div className="flex-1 overflow-hidden">
              <ActivitySidebar />
            </div>
          </>
        ) : (
          // Task #34: 접힌 상태 — 32px strip + 펼치기 버튼 + 현재 활동 코드 세로 표시
          <button
            type="button"
            onClick={() => layout.toggle('sidebar')}
            aria-label="활동 목록 펼치기"
            title="활동 목록 펼치기"
            className="flex-1 flex flex-col items-center justify-start gap-3 pt-3 bg-white hover:bg-[#F8F9FA] transition-colors"
          >
            <span
              className="flex items-center justify-center w-6 h-6 rounded-md text-[#9AA0A6]"
              aria-hidden="true"
            >
              <CaretRight size={14} weight="bold" />
            </span>
            {currentActivity && (
              <span
                className="text-[12px] font-extrabold text-[#5F6368] tracking-widest"
                style={{ writingMode: 'vertical-rl' }}
              >
                {currentActivity}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ══ 중앙 컬럼: 단계 섹션 + ChatPanel ══ */}
      <div className="flex-1 flex flex-col gap-2 overflow-hidden min-w-0">
        {/* 중앙 상단: 단계 바 — 전용 공간 (Task #34: 토글 가능) */}
        <div
          className={cn('rounded-2xl bg-white flex-shrink-0 transition-all duration-300',
            layout.stage ? 'py-3' : 'py-0', panelBorder('stage'))}
          onMouseEnter={() => setActivePanel('stage')}
          onMouseLeave={() => setActivePanel(null)}
        >
          {layout.stage ? (
            <div className="relative">
              <StageBar />
              <div className="absolute top-1 right-2">
                <PanelToggle direction="up" onClick={() => layout.toggle('stage')} label="단계 바 접기" />
              </div>
            </div>
          ) : (
            // Task #34: 접힌 상태 — h-10 strip + 현재 단계 코드/라벨 미니 표시
            <button
              type="button"
              onClick={() => layout.toggle('stage')}
              aria-label="단계 바 펼치기"
              title="단계 바 펼치기"
              className="w-full h-10 flex items-center justify-center gap-3 hover:bg-[#F8F9FA] transition-colors rounded-2xl"
            >
              <span className="text-[12px] font-extrabold text-[#202124]">
                현재 단계: <span className="text-[#1A73E8]">{currentStage}</span>
                {' · '}
                <span className="text-[#5F6368]">{STAGES.find(s => s.code === currentStage)?.label}</span>
              </span>
              <span
                className="flex items-center justify-center w-6 h-6 rounded-md text-[#9AA0A6]"
                aria-hidden="true"
              >
                <CaretDown size={14} weight="bold" />
              </span>
            </button>
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
          layout.artifact ? 'w-[418px]' : 'w-10', panelBorder('right'))}
        onMouseEnter={() => setActivePanel('right')}
        onMouseLeave={() => setActivePanel(null)}
      >
        {layout.artifact ? (
        <>
        {/* 우측 상단: 프로젝트 정보 */}
        <div className="flex items-center justify-end gap-2 px-3 h-14 bg-white border-b border-[#DADCE0] flex-shrink-0">
          <PanelToggle direction="right" onClick={() => layout.toggle('artifact')} label="산출물 패널 접기" className="mr-auto" />
          <button
            onClick={() => setShowMaterials(true)}
            className="flex items-center gap-1.5 text-[12px] bg-[#E8F0FE] text-[#1A73E8]
              px-3 py-1.5 rounded-full font-semibold hover:bg-[#D2E3FC] transition-colors"
          >
            <Books size={14} weight="fill" />
            자료함
          </button>
          {project.stageReports && Object.keys(project.stageReports).length > 0 && (
            <button
              onClick={() => setShowReports(true)}
              className="flex items-center gap-1.5 text-[12px] bg-[#E0F2F1] text-[#00897B]
                px-3 py-1.5 rounded-full font-semibold hover:bg-[#B2DFDB] transition-colors"
            >
              <FileText size={14} weight="fill" />
              보고서 확인
            </button>
          )}
          {project.inviteCode && (
            <span className="flex items-center gap-1.5 text-[12px] bg-[#E8F0FE] text-[#1A73E8]
              px-3 py-1.5 rounded-full font-semibold">
              <Key size={14} weight="regular" />
              {project.inviteCode}
            </span>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMembers(v => !v)}
              className="flex items-center gap-1 text-[12px] bg-[#F1F3F4] text-[#5F6368]
                px-3 py-1.5 rounded-full font-medium hover:bg-[#E8F0FE] hover:text-[#1A73E8] transition-colors"
            >
              <Users size={14} weight="regular" />
              {project.memberUids?.length ?? 1}명
            </button>

            {showMembers && (
              <>
                {/* 바깥 클릭 닫기 */}
                <div className="fixed inset-0 z-40" onClick={() => setShowMembers(false)} />
                {/* 팝오버 */}
                <div className="absolute right-0 top-full mt-2 z-50 min-w-[200px]"
                  style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.13))' }}>
                  <div className="bg-white rounded-2xl overflow-hidden border border-[#E8EAED]">
                    <div className="px-4 py-2.5 border-b border-[#F1F3F4]">
                      <p className="text-[11px] font-bold text-[#9AA0A6] uppercase tracking-wider">참여 중인 팀원</p>
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
                            <div
                              className="w-8 h-8 flex items-center justify-center text-white text-[13px] font-black flex-shrink-0"
                              style={{
                                backgroundColor: color,
                                animation: 'morph-shape 8s ease-in-out infinite',
                                boxShadow: `0 3px 8px ${color}55`,
                              }}
                            >
                              {displayName?.[0]?.toUpperCase() ?? '?'}
                            </div>
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
              </>
            )}
          </div>
        </div>
        {/* 우측 하단: 산출물 패널 */}
        <div className="flex-1 overflow-hidden">
          <ArtifactPanel />
        </div>
        </>
        ) : (
          // Task #34: 접힌 상태 — 32px strip + 펼치기 버튼 + 산출물 아이콘
          <button
            type="button"
            onClick={() => layout.toggle('artifact')}
            aria-label="산출물 패널 펼치기"
            title="산출물 패널 펼치기"
            className="flex-1 flex flex-col items-center justify-start gap-3 pt-3 bg-white hover:bg-[#F8F9FA] transition-colors"
          >
            <span
              className="flex items-center justify-center w-6 h-6 rounded-md text-[#9AA0A6]"
              aria-hidden="true"
            >
              <CaretLeft size={14} weight="bold" />
            </span>
            <FileText size={16} weight="fill" className="text-[#5F6368]" />
            <span
              className="text-[12px] font-extrabold text-[#5F6368] tracking-widest"
              style={{ writingMode: 'vertical-rl' }}
            >
              산출물
            </span>
          </button>
        )}
      </div>

      {pendingStageMove && <StageMoveModal />}

      {showReports && (
        <StageReportsModal onClose={() => setShowReports(false)} />
      )}

      {showMaterials && (
        <ProjectMaterialsModal
          projectId={projectId}
          userProfile={userProfile}
          onClose={() => setShowMaterials(false)}
        />
      )}

      {/* 팀원: 방장이 분석 모달을 열면 동기화하여 표시 */}
      {!isHost && project?.analysisOpen && (
        <StageAnalysisModal
          isHost={false}
          onClose={() => setAnalysisOpen(projectId, false).catch(console.error)}
        />
      )}

    </div>
  )
}

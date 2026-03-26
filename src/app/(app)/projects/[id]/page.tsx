'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import {
  watchProject, watchMessages, startProject, transferHost,
  sendLobbyMessage, watchLobbyMessages, joinProject, setTeamDiscussion,
  type LobbyMessage
} from '@/lib/firebase/projects'
import { StageBar } from '@/components/stage/StageBar'
import { ActivitySidebar } from '@/components/activity/ActivitySidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel'
import { StageMoveModal } from '@/components/modals/StageMoveModal'
import { cn } from '@/lib/utils'

// ─── 대기실 ──────────────────────────────────────────
function WaitingRoom({
  project,
  projectId,
  uid,
  isHost,
  userProfile,
  onBecomeHost,
}: {
  project: any
  projectId: string
  uid: string
  isHost: boolean
  userProfile: any
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
      emoji: userProfile.emoji,
      content: msg,
    })
  }

  // 멤버 목록 (memberInfo 있으면 사용, 없으면 memberUids만)
  const memberInfo = project.memberInfo ?? {}
  const memberUids: string[] = project.memberUids ?? [project.createdBy ?? uid]
  const memberCount = memberUids.length

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-sm text-amber-600 font-medium">팀원을 기다리는 중</span>
          <div className="h-4 w-px bg-gray-200 mx-1" />
          <h1 className="text-sm font-bold text-gray-900">{project.title}</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 왼쪽: 초대코드 + 시작 */}
        <div className="space-y-4">
          {/* 초대코드 카드 */}
          {project.inviteCode && (
            <div className="bg-white rounded-2xl border border-[#DADCE0] p-6">
              <p className="text-xs font-semibold text-[#5F6368] mb-1">이 방의 초대코드</p>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-black text-[#1A73E8] tracking-wide">{project.inviteCode}</p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-sm text-[#1A73E8] hover:text-[#1557b0] transition-colors px-3 py-1.5 rounded-full hover:bg-[#E8F0FE]"
                >
                  {copied ? <span className="material-symbols-rounded ms-sm">check</span> : <span className="material-symbols-rounded ms-sm">content_copy</span>}
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
              <p className="text-xs text-[#9AA0A6] mt-2">
                팀원에게 공유하면 대시보드 "방 참여하기"에서 입장할 수 있어요
              </p>
            </div>
          )}

          {/* 참여 인원 카드 */}
          <div className="bg-white rounded-2xl border border-[#DADCE0] p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-rounded ms-sm text-[#5F6368]">group</span>
              <span className="text-sm font-bold text-[#202124]">참여 중 · {memberCount}명</span>
            </div>
            <div className="space-y-2">
              {memberUids.map(mUid => {
                const info = memberInfo[mUid]
                const isThisHost = project.hostUid === mUid || project.createdBy === mUid
                const isSelf = mUid === uid
                return (
                  <div key={mUid} className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: info?.color ?? '#6B7280' }}
                    >
                      {info?.emoji ?? '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-[#202124] truncate">
                          {info?.displayName ?? mUid.slice(0, 8)}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] bg-[#F1F3F4] text-[#5F6368] px-1.5 py-0.5 rounded-full">나</span>
                        )}
                        {isThisHost && (
                          <span className="material-symbols-rounded msf text-[#F9AB00]" style={{ fontSize: 13 }}>workspace_premium</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 시작 버튼 */}
          {isHost ? (
            <button
              onClick={handleStart}
              disabled={starting}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-[#1A73E8] text-white font-bold text-base hover:bg-[#1557b0] transition-colors disabled:opacity-50 shadow-md"
            >
              {starting ? (
                <><span className="material-symbols-rounded" style={{ fontSize: 20, animation: 'spin 1s linear infinite' }}>progress_activity</span>시작 중...</>
              ) : (
                <><span className="material-symbols-rounded msf" style={{ fontSize: 20 }}>play_circle</span>수업설계 시작하기</>
              )}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="w-full py-4 rounded-2xl bg-[#F1F3F4] text-[#9AA0A6] text-sm text-center font-medium">
                방장이 시작 버튼을 누를 때까지 기다려주세요
              </div>
              <button
                onClick={onBecomeHost}
                className="w-full py-2.5 rounded-full border border-[#FFCC80] text-[#E65100] text-sm font-medium hover:bg-[#FFF3E0] transition-colors flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-rounded msf" style={{ fontSize: 15 }}>workspace_premium</span>
                방장 권한 받기
              </button>
            </div>
          )}
        </div>

        {/* 오른쪽: 대기실 채팅 */}
        <div className="bg-white rounded-2xl border border-[#DADCE0] flex flex-col overflow-hidden" style={{ height: '460px' }}>
          <div className="px-4 py-3 border-b border-[#DADCE0] bg-[#F8F9FA] flex-shrink-0">
            <h3 className="text-sm font-bold text-[#202124]">대기실 채팅</h3>
            <p className="text-[11px] text-[#5F6368]">팀원과 미리 대화해보세요</p>
          </div>

          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {lobbyMessages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-400">아직 메시지가 없습니다<br />팀원에게 인사해보세요 👋</p>
              </div>
            )}
            {lobbyMessages.map(msg => {
              const isSelf = msg.uid === uid
              return (
                <div key={msg.id} className={cn('flex gap-2', isSelf ? 'flex-row-reverse' : 'flex-row')}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: msg.color }}
                  >
                    {msg.emoji}
                  </div>
                  <div className={cn('max-w-[75%] space-y-0.5', isSelf ? 'items-end' : 'items-start', 'flex flex-col')}>
                    {!isSelf && (
                      <span className="text-[10px] font-semibold px-1" style={{ color: msg.color }}>
                        {msg.displayName}
                      </span>
                    )}
                    <div
                      className={cn(
                        'px-3 py-2 rounded-2xl text-sm',
                        isSelf ? 'text-white rounded-tr-sm' : 'bg-[#F1F3F4] text-[#202124] rounded-tl-sm'
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
          <div className="px-3 py-3 border-t border-[#DADCE0] bg-[#F8F9FA] flex-shrink-0 flex gap-2">
            <input
              type="text"
              value={lobbyInput}
              onChange={e => setLobbyInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSendLobby()
              }}
              placeholder="메시지 입력..."
              className="flex-1 rounded-2xl border border-[#DADCE0] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8] bg-white text-[#202124]"
            />
            <button
              onClick={handleSendLobby}
              disabled={!lobbyInput.trim()}
              className="w-9 h-9 rounded-full bg-[#1A73E8] text-white flex items-center justify-center hover:bg-[#1557b0] disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <span className="material-symbols-rounded msf" style={{ fontSize: 18 }}>send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 메인 페이지 ─────────────────────────────────────
export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const {
    project, setProject, setMessages, setMessagesLoaded,
    pendingStageMove, userProfile,
    setDiscussionMode, setTeamDiscussionStartIdx, messages,
    currentActivity, setCurrentActivity,
    setActivityStatus, resetProjectState,
  } = useProjectStore()

  const [claimingHost, setClaimingHost] = useState(false)

  useEffect(() => {
    if (!projectId) return
    resetProjectState()  // 프로젝트 전환 시 이전 프로젝트 상태 초기화
    const unsubProject = watchProject(projectId, (p) => {
      if (p) setProject(p)
      else router.push('/dashboard')
    })
    return () => unsubProject()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Firestore currentActivity → Zustand 동기화 (팀원 실시간 공유)
  useEffect(() => {
    if (!project?.currentActivity) return
    if (project.currentActivity !== currentActivity) {
      setCurrentActivity(project.currentActivity)
      // setMessages([])는 watchMessages effect가 currentActivity 변경을 감지하여 처리
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

  // Firestore teamDiscussion → Zustand 동기화
  useEffect(() => {
    if (!project) return
    const td = project.teamDiscussion
    if (td?.active) {
      setDiscussionMode('team_discussion')
      // startedAt 이전 메시지 수 기준으로 인덱스 계산
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
  }, [project?.teamDiscussion?.active, project?.teamDiscussion?.startedAt])

  useEffect(() => {
    if (!projectId || !currentActivity) return
    setMessagesLoaded(false)  // 활동 전환 시 리셋
    setMessages([])
    const unsubMessages = watchMessages(projectId, currentActivity, (msgs) => {
      setMessages(msgs)
      setMessagesLoaded(true)   // Firestore 첫 응답 확인
    })
    return () => unsubMessages()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentActivity])

  // 대기실 진입 시 멤버 정보 등록 (색상이 바뀐 경우 항상 업데이트)
  useEffect(() => {
    if (!project || !userProfile) return
    const uid = userProfile.uid
    const stored = project.memberInfo?.[uid]
    // 미등록이거나 색상이 현재 프로필과 다르면 업데이트
    if (stored && stored.color === userProfile.color) return
    joinProject(projectId, uid, {
      displayName: userProfile.displayName,
      color: userProfile.color ?? '#A0BCE8',
      emoji: userProfile.emoji ?? '👤',
    }).catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, userProfile?.uid, userProfile?.color])

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F8F9FA]">
        <div className="flex flex-col items-center gap-4 text-[#5F6368]">
          <span className="material-symbols-rounded text-[#1A73E8]" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>progress_activity</span>
          <p className="text-sm font-medium">프로젝트 불러오는 중...</p>
        </div>
      </div>
    )
  }

  const uid = userProfile?.uid ?? ''
  const isHost = project.hostUid === uid || project.createdBy === uid

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

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] overflow-hidden">
      {/* MD3 Top App Bar */}
      <header className="flex-shrink-0 bg-white border-b border-[#DADCE0] px-5 py-0 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1 text-[#5F6368] hover:text-[#202124] hover:bg-[#F1F3F4]
              rounded-full px-3 py-1.5 text-[13px] font-medium transition-all"
          >
            <span className="material-symbols-rounded ms-sm">arrow_back</span>
            대시보드
          </button>
          <div className="h-4 w-px bg-[#DADCE0]" />
          <h1 className="text-[14px] font-semibold text-[#202124] truncate max-w-xs">{project.title}</h1>
          {isHost ? (
            <span className="flex items-center gap-1 text-[11px] bg-[#FEF7E0] text-[#B06000]
              px-2.5 py-1 rounded-full font-semibold">
              <span className="material-symbols-rounded msf ms-sm text-[#F9AB00]">workspace_premium</span>
              방장
            </span>
          ) : (
            <button
              onClick={handleClaimHost}
              disabled={claimingHost}
              className="flex items-center gap-1 text-[11px] border border-[#FBBC04] text-[#B06000]
                px-2.5 py-1 rounded-full font-medium hover:bg-[#FEF7E0] transition-all disabled:opacity-50"
            >
              <span className="material-symbols-rounded msf ms-sm text-[#F9AB00]">workspace_premium</span>
              {claimingHost ? '처리 중...' : '방장 되기'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {project.inviteCode && (
            <span className="flex items-center gap-1.5 text-[12px] bg-[#E8F0FE] text-[#1A73E8]
              px-3 py-1.5 rounded-full font-semibold">
              <span className="material-symbols-rounded ms-sm">key</span>
              {project.inviteCode}
            </span>
          )}
          <span className="flex items-center gap-1 text-[12px] bg-[#F1F3F4] text-[#5F6368]
            px-3 py-1.5 rounded-full font-medium">
            <span className="material-symbols-rounded ms-sm">group</span>
            {project.memberUids?.length ?? 1}명
          </span>
        </div>
      </header>

      <div className="flex-shrink-0">
        <StageBar />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ActivitySidebar />
        <div className="flex-1 overflow-hidden border-r border-[#DADCE0]">
          <ChatPanel />
        </div>
        <div className="w-80 flex-shrink-0">
          <ArtifactPanel />
        </div>
      </div>

      {pendingStageMove && <StageMoveModal />}
    </div>
  )
}

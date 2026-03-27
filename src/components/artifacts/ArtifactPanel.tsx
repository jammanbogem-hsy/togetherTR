'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META } from '@/types'
import type { ArtifactStatus } from '@/types'
import { setProjectArtifact } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { Sparkle, Note, CheckCircle, XCircle, FileText, Lock, CheckSquare, Chat, Clock, X, PencilSimple, ClockCounterClockwise, type Icon } from '@phosphor-icons/react'

const STAGE_COLOR: Record<string, { bg: string; text: string; light: string; pulse: string; corner: string }> = {
  T:  { bg: 'bg-[#1A73E8]', text: 'text-[#1A73E8]', light: 'bg-[#E8F0FE]', pulse: 'rgba(26,115,232,0.35)',  corner: 'rgba(26,115,232,0.11)'  },
  A:  { bg: 'bg-[#7B1FA2]', text: 'text-[#7B1FA2]', light: 'bg-[#F3E5F5]', pulse: 'rgba(123,31,162,0.35)', corner: 'rgba(123,31,162,0.10)'  },
  Ds: { bg: 'bg-[#00897B]', text: 'text-[#00897B]', light: 'bg-[#E0F2F1]', pulse: 'rgba(0,137,123,0.35)',  corner: 'rgba(0,137,123,0.10)'   },
  DI: { bg: 'bg-[#E65100]', text: 'text-[#E65100]', light: 'bg-[#FBE9E7]', pulse: 'rgba(230,81,0,0.35)',   corner: 'rgba(230,81,0,0.10)'    },
  E:  { bg: 'bg-[#C62828]', text: 'text-[#C62828]', light: 'bg-[#FFEBEE]', pulse: 'rgba(198,40,40,0.35)',  corner: 'rgba(198,40,40,0.10)'   },
}

const STATUS_CONFIG: Record<ArtifactStatus, { label: string; icon: Icon; className: string }> = {
  ai_draft:  { label: 'AI 초안', icon: Sparkle,      className: 'bg-[#E8F0FE] text-[#1A73E8]' },
  in_review: { label: '검토 중', icon: Note,          className: 'bg-[#FEF7E0] text-[#B06000]' },
  confirmed: { label: '확정',    icon: CheckCircle,   className: 'bg-[#E6F4EA] text-[#137333]' },
  rejected:  { label: '반려',    icon: XCircle,       className: 'bg-[#FFEBEE] text-[#C62828]' },
}

function StatusBadge({ status }: { status: ArtifactStatus }) {
  const cfg = STATUS_CONFIG[status]
  const IconComp = cfg.icon
  return (
    <span className={cn('flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-semibold', cfg.className)}>
      <IconComp size={16} weight="fill" />
      {cfg.label}
    </span>
  )
}

function EmptyState({ activityLabel }: { activityLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-[#9AA0A6] gap-5 px-6">
      <div className="w-16 h-16 rounded-full bg-[#F1F3F4] flex items-center justify-center">
        <FileText size={36} weight="regular" className="text-[#DADCE0]" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-[#5F6368]">아직 산출물이 없습니다</p>
        <p className="text-xs text-[#9AA0A6] mt-1.5 leading-relaxed">
          [{activityLabel}] 활동에서<br />
          AI와 대화하면 초안이 자동으로 생성됩니다
        </p>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[#9AA0A6] bg-[#F1F3F4] rounded-full px-4 py-2">
        <Chat size={16} weight="regular" />
        <span>채팅</span>
        <span>→</span>
        <span className="font-medium text-[#5F6368]">산출물</span>
      </div>
    </div>
  )
}

function ArtifactSection({ sectionKey, value, onDelete }: {
  sectionKey: string
  value: unknown
  onDelete?: () => void
}) {
  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white md-shadow-1">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">{sectionKey}</span>
        {onDelete && (
          <button
            onClick={onDelete}
            className="ml-2 text-[#9AA0A6] hover:text-[#C62828] hover:bg-[#FFEBEE] rounded-full p-1 flex-shrink-0 transition-colors"
            title="이 섹션 삭제"
          >
            <X size={16} weight="regular" />
          </button>
        )}
      </div>
      <div className="px-4 py-4 bg-white">
        {typeof value === 'string' ? (
          <div className="artifact-md text-sm text-[#202124] leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          </div>
        ) : Array.isArray(value) ? (
          <ul className="space-y-2">
            {value.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-[#202124]">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#1A73E8] flex-shrink-0" />
                <span className="leading-relaxed">{String(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <pre className="text-xs text-[#5F6368] whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}

// 산출물에 표시하면 안 되는 AI 진행 안내 섹션
const DISPLAY_BLOCKED_KEYS = [
  '다음 행동', '다음 단계', 'next step',
  '미결 사항', '미결', '보류 사항',
  'ai 제안', '추천 사항', '참고 사항',
  '합의 내용', '논의 내용', '토론 내용', '확인 사항',
  '진행 내용', '진행 사항', '현황', '요약',
]

function ArtifactContent({ content, onDeleteSection }: {
  content: Record<string, unknown>
  onDeleteSection?: (key: string) => void
}) {
  const filteredEntries = Object.entries(content).filter(
    ([key]) => !DISPLAY_BLOCKED_KEYS.some(k => key.toLowerCase().includes(k))
  )
  if (filteredEntries.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-[#DADCE0] px-4 py-8
        flex flex-col items-center gap-2 text-[#9AA0A6]">
        <FileText size={28} weight="regular" className="text-[#DADCE0]" />
        <p className="text-xs text-center leading-relaxed">
          내용이 없습니다.<br />
          AI와 대화하여 내용을 추가하거나<br />
          직접 입력해주세요.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {filteredEntries.map(([key, value]) => (
        <ArtifactSection
          key={key}
          sectionKey={key}
          value={value}
          onDelete={onDeleteSection ? () => onDeleteSection(key) : undefined}
        />
      ))}
    </div>
  )
}

export function ArtifactPanel() {
  const { currentArtifact, currentActivity, setCurrentArtifact, project, userProfile } = useProjectStore()
  const activityMeta = ACTIVITY_META[currentActivity]
  const [revisionNote, setRevisionNote] = useState('')
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showDirectInput, setShowDirectInput] = useState(false)
  const [directInputText, setDirectInputText] = useState('')

  const isHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid
  const stageColor = STAGE_COLOR[project?.currentStage ?? 'T']

  // Firestore 산출물 (팀 전체 소스)
  const firestoreArtifact = project?.artifacts?.[currentActivity]

  // useEffect 없이 렌더 시점에 직접 파생 — 타이밍 이슈 없음
  // 로컬 currentArtifact가 없으면 Firestore 데이터로 임시 객체 생성
  const displayArtifact = currentArtifact ?? (firestoreArtifact ? {
    id: `${currentActivity}-firestore`,
    activityCode: currentActivity,
    artifactType: activityMeta.label,
    title: firestoreArtifact.title,
    status: firestoreArtifact.status as ArtifactStatus,
    currentVersion: firestoreArtifact.version,
    aiDraft: firestoreArtifact.content as Record<string, unknown>,
    confirmedContent: firestoreArtifact.status === 'confirmed'
      ? (firestoreArtifact.content as Record<string, unknown>)
      : undefined,
    createdBy: firestoreArtifact.confirmedBy ?? 'host',
    meta: {
      author: 'AI 분석',
      createdAt: { toDate: () => new Date(firestoreArtifact.confirmedAt ?? Date.now()) } as any,
      updatedAt: { toDate: () => new Date(firestoreArtifact.confirmedAt ?? Date.now()) } as any,
      evidence: '팀 합의',
      approvalStatus: 'approved' as const,
    },
  } : null)

  // Firestore 상태가 바뀌면 로컬 Zustand도 동기화 (호스트 재입장 등)
  useEffect(() => {
    if (!firestoreArtifact || !currentArtifact) return
    if (firestoreArtifact.status !== currentArtifact.status) {
      setCurrentArtifact({
        ...currentArtifact,
        status: firestoreArtifact.status as ArtifactStatus,
        confirmedContent: firestoreArtifact.status === 'confirmed'
          ? (firestoreArtifact.content as Record<string, unknown>)
          : currentArtifact.confirmedContent,
      })
    }
  }, [firestoreArtifact?.status, currentActivity])

  const effectiveStatus: ArtifactStatus = firestoreArtifact?.status as ArtifactStatus ?? displayArtifact?.status ?? 'in_review'
  const isConfirmed = effectiveStatus === 'confirmed'

  async function handleConfirm() {
    if (!project) return
    // Firestore snapshot 우선, 없으면 로컬 displayArtifact 사용
    const content = (
      firestoreArtifact?.content ??
      (displayArtifact as any)?.lastEditedContent ??
      displayArtifact?.aiDraft ??
      {}
    ) as Record<string, unknown>
    const title = firestoreArtifact?.title ?? displayArtifact?.title ?? (activityMeta.label + ' 산출물')
    const version = firestoreArtifact?.version ?? displayArtifact?.currentVersion ?? 1

    if (!Object.keys(content).length) {
      console.warn('확정할 내용이 없습니다')
      return
    }
    setIsSaving(true)
    try {
      await setProjectArtifact(project.id, currentActivity, {
        status: 'confirmed',
        title,
        content,
        version,
        confirmedBy: userProfile?.uid ?? undefined,
        confirmedAt: Date.now(),
      })
      if (currentArtifact) setCurrentArtifact({ ...currentArtifact, status: 'confirmed', confirmedContent: content })
    } catch (err) {
      console.error('산출물 확정 실패:', err)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRedraft() {
    if (!displayArtifact || !project) return
    await setProjectArtifact(project.id, currentActivity, {
      status: 'in_review',
      title: displayArtifact.title,
      content: (displayArtifact.aiDraft ?? {}) as Record<string, unknown>,
      version: displayArtifact.currentVersion,
    })
    if (currentArtifact) setCurrentArtifact({ ...currentArtifact, status: 'in_review' })
  }

  async function handleRevisionRequest() {
    if (!displayArtifact || !project) return
    await setProjectArtifact(project.id, currentActivity, {
      status: 'in_review',
      title: displayArtifact.title,
      content: (displayArtifact.confirmedContent ?? displayArtifact.aiDraft ?? {}) as Record<string, unknown>,
      version: displayArtifact.currentVersion,
      revisionNote: revisionNote.trim() || undefined,
      revisionRequestedBy: userProfile?.uid,
      revisionRequestedAt: Date.now(),
    })
    if (currentArtifact) setCurrentArtifact({ ...currentArtifact, status: 'in_review' })
    setRevisionNote('')
    setShowRevisionForm(false)
  }

  async function handleDeleteSection(key: string) {
    if (!project || !firestoreArtifact) return
    const newContent = { ...(firestoreArtifact.content as Record<string, unknown>) }
    delete newContent[key]
    const safeStatus = firestoreArtifact.status === 'rejected' ? 'in_review' : firestoreArtifact.status as 'ai_draft' | 'in_review' | 'confirmed'
    await setProjectArtifact(project.id, currentActivity, {
      status: safeStatus,
      title: firestoreArtifact.title,
      content: newContent,
      version: firestoreArtifact.version + 1,
    }).catch(console.error)
  }

  async function handleDirectSave() {
    if (!project || !directInputText.trim()) return
    setIsSaving(true)
    try {
      const content = { [activityMeta.label]: directInputText.trim() }
      await setProjectArtifact(project.id, currentActivity, {
        status: 'in_review',
        title: `${activityMeta.label} - 직접 입력`,
        content,
        version: (displayArtifact?.currentVersion ?? 0) + 1,
      })
      setShowDirectInput(false)
      setDirectInputText('')
    } catch (err) {
      console.error('직접 입력 저장 실패:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const displayContent =
    displayArtifact?.confirmedContent ??
    (displayArtifact as any)?.lastEditedContent ??
    displayArtifact?.aiDraft ??
    {}

  return (
    <div className="flex flex-col h-full overflow-hidden corner-wrap-artifact"
      style={{ '--cc': stageColor.corner } as React.CSSProperties}>
      {/* ─── 산출물 아이덴티티 헤더 ─────────────── */}
      <div className={cn(stageColor.light, 'px-5 pt-4 pb-4 flex-shrink-0')}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className={cn('w-11 h-11 flex items-center justify-center flex-shrink-0', stageColor.bg)}
            style={{
              animation: 'morph-shape 9s ease-in-out infinite, stage-bounce 3.5s ease-in-out infinite',
              boxShadow: `0 6px 16px ${stageColor.pulse}`,
            }}
          >
            <FileText size={22} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-[10px] font-bold uppercase tracking-widest mb-0.5', stageColor.text)}>산출물</p>
            <p className="text-[13px] font-bold text-[#202124] leading-tight truncate">{activityMeta.label}</p>
          </div>
          {displayArtifact && <StatusBadge status={effectiveStatus} />}
        </div>

        {/* 잠금 안내 (팀장 아닌 경우) */}
        {!isHost && displayArtifact && (
          <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-3 py-1.5 w-fit">
            <Lock size={16} weight="fill" className="text-[#5F6368]" />
            <span className="text-[10px] text-[#5F6368] font-medium">팀장이 확정합니다</span>
          </div>
        )}
      </div>

      {/* 직접 입력 폼 (오버레이) */}
      {showDirectInput && (
        <div className="absolute inset-0 z-10 bg-white flex flex-col">
          <div className="px-5 py-4 border-b border-[#DADCE0] bg-[#FEF7E0] flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-bold text-[#B06000]">산출물 직접 입력</p>
              <p className="text-xs text-[#B06000] opacity-70 mt-0.5">AI가 저장하지 못한 경우 직접 입력하세요</p>
            </div>
            <button onClick={() => setShowDirectInput(false)}
              className="text-[#9AA0A6] hover:text-[#5F6368] rounded-full p-1 hover:bg-[#F1F3F4] transition-colors">
              <X size={16} weight="regular" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <p className="text-xs text-[#5F6368]">현재 활동: <span className="font-semibold text-[#202124]">{activityMeta.label}</span></p>
            <textarea
              value={directInputText}
              onChange={e => setDirectInputText(e.target.value)}
              placeholder={`예: "학생들이 협력하여 실생활 문제를 해결하는 경험을 만드는 교육"`}
              rows={8}
              className="w-full text-sm border border-[#DADCE0] rounded-2xl px-4 py-3 resize-none
                focus:outline-none focus:ring-2 focus:ring-[#1A73E8] focus:border-transparent leading-relaxed"
            />
          </div>
          <div className="px-5 py-4 border-t border-[#DADCE0] bg-[#F8F9FA] flex gap-2 flex-shrink-0">
            <button
              onClick={handleDirectSave}
              disabled={isSaving || !directInputText.trim()}
              className="flex-1 py-2.5 rounded-full bg-[#FBBC04] text-[#202124] text-sm font-bold
                hover:bg-[#F9AB00] disabled:opacity-50 transition-colors shadow-sm"
            >
              {isSaving ? '저장 중...' : '산출물에 저장'}
            </button>
            <button
              onClick={() => setShowDirectInput(false)}
              className="px-5 py-2.5 rounded-full border border-[#DADCE0] text-[#5F6368] text-sm hover:bg-[#F1F3F4] transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 내용 */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {!displayArtifact ? (
          <>
            <EmptyState activityLabel={activityMeta.label} />
            {isHost && (
              <div className="px-2 pb-4 mt-4">
                <button
                  onClick={() => setShowDirectInput(true)}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    bg-[rgba(249,171,0,0.12)] hover:bg-[rgba(249,171,0,0.24)] text-[#B06000] text-sm font-semibold transition-colors"
                >
                  <PencilSimple size={16} weight="regular" />
                  AI가 저장 안 했나요? 직접 입력하기
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <div className="pb-3 border-b border-[#F1F3F4]">
              <h4 className="font-bold text-[#202124] text-[15px] leading-snug">{displayArtifact.title}</h4>
              <p className="text-[11px] text-[#9AA0A6] mt-1">
                버전 {displayArtifact.currentVersion} · {displayArtifact.artifactType}
              </p>
            </div>

            {effectiveStatus === 'in_review' && displayArtifact.aiDraft && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center gap-1 text-xs bg-[#E8F0FE] text-[#1A73E8] px-2.5 py-1 rounded-full font-semibold">
                    <Sparkle size={16} weight="fill" />
                    AI 초안 검토
                  </span>
                  <span className="text-xs text-[#9AA0A6]">
                    {isHost ? '내용을 확인하고 확정하세요' : '팀장이 확정 대기 중'}
                  </span>
                </div>
                <div className="border-l-4 border-[#1A73E8] pl-2">
                  <ArtifactContent content={displayArtifact.aiDraft!} onDeleteSection={isHost ? handleDeleteSection : undefined} />
                </div>
              </div>
            )}

            {effectiveStatus !== 'in_review' && (
              <ArtifactContent content={displayContent} onDeleteSection={isHost ? handleDeleteSection : undefined} />
            )}

            {/* 수정 요청 메모 배너 */}
            {firestoreArtifact?.revisionNote && effectiveStatus === 'in_review' && (
              <div className="rounded-2xl border border-[#FBBC04] bg-[#FEF7E0] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Chat size={16} weight="fill" className="text-[#F9AB00]" />
                  <span className="text-xs font-bold text-[#B06000]">
                    수정 요청
                    {firestoreArtifact.revisionRequestedBy && (
                      <span className="font-normal ml-1 opacity-80">
                        · {project?.memberInfo?.[firestoreArtifact.revisionRequestedBy]?.displayName ?? '팀원'}
                        {firestoreArtifact.revisionRequestedAt && (
                          <> · {new Date(firestoreArtifact.revisionRequestedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                        )}
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-[#B06000] leading-relaxed whitespace-pre-wrap opacity-90">
                  "{firestoreArtifact.revisionNote}"
                </p>
              </div>
            )}

            {/* 확정 정보 */}
            {isConfirmed && firestoreArtifact?.confirmedBy && (
              <div className="flex items-center gap-2 text-xs text-[#137333] bg-[#E6F4EA] rounded-full px-4 py-2">
                <CheckCircle size={16} weight="fill" className="text-[#34A853]" />
                <span>
                  {firestoreArtifact.confirmedBy === userProfile?.uid
                    ? '내가 확정함'
                    : (project?.memberInfo?.[firestoreArtifact.confirmedBy]?.displayName ?? '팀장') + '이 확정함'}
                  {firestoreArtifact.confirmedAt && (
                    <> · {new Date(firestoreArtifact.confirmedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[11px] text-[#9AA0A6] pt-2 border-t border-[#F1F3F4]">
              <Clock size={16} weight="regular" />
              <span>
                {displayArtifact.meta?.updatedAt
                  ? new Date(displayArtifact.meta.updatedAt.toDate()).toLocaleString('ko-KR')
                  : '방금 전'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 액션 버튼 */}
      {displayArtifact && (
        <div className="px-5 py-4 border-t border-[#DADCE0] bg-[#F8F9FA] space-y-2.5 flex-shrink-0">
          {isHost ? (
            isConfirmed ? (
              <>
                <div className="flex items-center gap-2 text-[#137333] mb-1">
                  <CheckCircle size={16} weight="fill" className="text-[#34A853]" />
                  <span className="text-sm font-bold">산출물이 확정되었습니다</span>
                </div>
                <button
                  onClick={handleRedraft}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    text-[#5F6368] bg-[rgba(95,99,104,0.08)] hover:bg-[rgba(95,99,104,0.16)] text-sm transition-colors"
                >
                  <ClockCounterClockwise size={16} weight="regular" />
                  확정 취소 · 재검토
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={isSaving}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-3
                    bg-[rgba(52,168,83,0.15)] hover:bg-[rgba(52,168,83,0.28)] text-[#1E7E34] text-sm font-bold
                    disabled:opacity-60 transition-colors"
                >
                  <CheckCircle size={16} weight="fill" />
                  {isSaving ? '저장 중...' : '산출물 확정하기'}
                </button>
                <button
                  onClick={handleRedraft}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    text-[#5F6368] bg-[rgba(95,99,104,0.08)] hover:bg-[rgba(95,99,104,0.16)] text-sm transition-colors"
                >
                  <ClockCounterClockwise size={16} weight="regular" />
                  AI 재초안 요청
                </button>
              </>
            )
          ) : (
            isConfirmed ? (
              <>
                <div className="flex items-center gap-2 text-[#137333] mb-1">
                  <CheckCircle size={16} weight="fill" className="text-[#34A853]" />
                  <span className="text-sm font-semibold">팀장이 확정한 산출물입니다</span>
                </div>
                {showRevisionForm ? (
                  <div className="space-y-2">
                    <textarea
                      value={revisionNote}
                      onChange={e => setRevisionNote(e.target.value)}
                      placeholder="수정이 필요한 내용을 적어주세요..."
                      rows={3}
                      className="w-full text-sm border border-[#DADCE0] rounded-2xl px-4 py-3 resize-none
                        focus:outline-none focus:ring-2 focus:ring-[#FBBC04] focus:border-transparent"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleRevisionRequest}
                        className="squid-btn morph-btn flex-1 py-2.5 bg-[rgba(249,171,0,0.18)] hover:bg-[rgba(249,171,0,0.32)] text-[#B06000] text-sm font-bold transition-colors flex items-center justify-center gap-2"
                      >
                        <Chat size={15} weight="fill" />
                        수정 요청 보내기
                      </button>
                      <button
                        onClick={() => setShowRevisionForm(false)}
                        className="squid-btn morph-btn px-4 py-2.5 text-[#5F6368] bg-[rgba(95,99,104,0.08)] hover:bg-[rgba(95,99,104,0.16)] text-sm transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRevisionForm(true)}
                    className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                      bg-[rgba(249,171,0,0.14)] hover:bg-[rgba(249,171,0,0.28)] text-[#B06000] text-sm font-semibold transition-colors"
                  >
                    <Chat size={16} weight="fill" />
                    수정 요청하기
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-[#9AA0A6] text-xs py-1">
                <Lock size={16} weight="regular" />
                <span>팀장만 산출물을 확정할 수 있습니다</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

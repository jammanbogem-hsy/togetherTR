'use client'

import { useEffect, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META } from '@/types'
import type { ArtifactStatus } from '@/types'
import { setProjectArtifact } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { CheckCircle, Clock, RotateCcw, FileText, ArrowLeftFromLine, Lock, MessageSquare, Pencil, X } from 'lucide-react'

const STATUS_CONFIG: Record<ArtifactStatus, { label: string; className: string }> = {
  ai_draft:   { label: 'AI 초안',   className: 'bg-blue-100 text-blue-700' },
  in_review:  { label: '검토 중',   className: 'bg-amber-100 text-amber-700' },
  confirmed:  { label: '확정',      className: 'bg-green-100 text-green-700' },
  rejected:   { label: '반려',      className: 'bg-red-100 text-red-700' },
}

function StatusBadge({ status }: { status: ArtifactStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold', cfg.className)}>
      {cfg.label}
    </span>
  )
}

function EmptyState({ activityLabel }: { activityLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4 px-6">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <FileText className="w-8 h-8 opacity-40" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-500">아직 산출물이 없습니다</p>
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
          [{activityLabel}] 활동에서<br />
          AI와 대화하면 초안이 자동으로 생성됩니다
        </p>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-gray-400 bg-gray-50 rounded-xl px-4 py-2">
        <span>채팅</span>
        <ArrowLeftFromLine className="w-3.5 h-3.5 rotate-180" />
        <span className="font-medium text-gray-500">산출물</span>
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
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">{sectionKey}</span>
        {onDelete && (
          <button
            onClick={onDelete}
            className="ml-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded p-0.5 flex-shrink-0 transition-colors"
            title="이 섹션 삭제"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="px-4 py-3.5 bg-white">
        {typeof value === 'string' ? (
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{value}</p>
        ) : Array.isArray(value) ? (
          <ul className="space-y-2">
            {value.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-800">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                <span className="leading-relaxed">{String(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <pre className="text-xs text-gray-600 whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
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
      <div className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 flex flex-col items-center gap-2 text-gray-400">
        <FileText className="w-6 h-6 opacity-30" />
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
    <div className="flex flex-col h-full bg-white">
      {/* 헤더 */}
      <div className="px-5 py-4 border-b bg-gray-50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">산출물</h3>
            <p className="text-xs text-gray-500 mt-0.5">{activityMeta.label}</p>
          </div>
          <div className="flex items-center gap-2">
            {displayArtifact && <StatusBadge status={effectiveStatus} />}
            {!isHost && displayArtifact && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <Lock className="w-3 h-3" /> 팀장 확정
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 직접 입력 폼 (오버레이) */}
      {showDirectInput && (
        <div className="absolute inset-0 z-10 bg-white flex flex-col">
          <div className="px-5 py-4 border-b bg-amber-50 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-bold text-amber-800">산출물 직접 입력</p>
              <p className="text-xs text-amber-600 mt-0.5">AI가 저장하지 못한 경우 직접 내용을 입력하세요</p>
            </div>
            <button onClick={() => setShowDirectInput(false)} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <p className="text-xs text-gray-500">현재 활동: <span className="font-semibold text-gray-700">{activityMeta.label}</span></p>
            <textarea
              value={directInputText}
              onChange={e => setDirectInputText(e.target.value)}
              placeholder={`예: "학생들이 협력하여 실생활 문제를 해결하는 경험을 만드는 교육"`}
              rows={8}
              className="w-full text-sm border border-gray-300 rounded-xl px-3 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 leading-relaxed"
            />
          </div>
          <div className="px-5 py-4 border-t bg-gray-50 flex gap-2 flex-shrink-0">
            <button
              onClick={handleDirectSave}
              disabled={isSaving || !directInputText.trim()}
              className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {isSaving ? '저장 중...' : '산출물에 저장'}
            </button>
            <button
              onClick={() => setShowDirectInput(false)}
              className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
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
              <div className="px-4 pb-4">
                <button
                  onClick={() => setShowDirectInput(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-amber-600 text-sm font-medium hover:bg-amber-50 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  AI가 저장 안 했나요? 직접 입력하기
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <div className="pb-3 border-b border-gray-100">
              <h4 className="font-bold text-gray-900 text-base leading-snug">{displayArtifact.title}</h4>
              <p className="text-xs text-gray-400 mt-1">
                버전 {displayArtifact.currentVersion} · {displayArtifact.artifactType}
              </p>
            </div>

            {effectiveStatus === 'in_review' && displayArtifact.aiDraft && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-semibold">
                    AI 초안 검토
                  </span>
                  <span className="text-xs text-gray-400">
                    {isHost ? '내용을 확인하고 확정하세요' : '팀장이 확정 대기 중'}
                  </span>
                </div>
                <div className="border-l-4 border-blue-400 pl-1">
                  <ArtifactContent content={displayArtifact.aiDraft!} onDeleteSection={isHost ? handleDeleteSection : undefined} />
                </div>
              </div>
            )}

            {effectiveStatus !== 'in_review' && (
              <ArtifactContent content={displayContent} onDeleteSection={isHost ? handleDeleteSection : undefined} />
            )}

            {/* 수정 요청 메모 배너 */}
            {firestoreArtifact?.revisionNote && effectiveStatus === 'in_review' && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <span className="text-xs font-bold text-amber-800">
                    수정 요청
                    {firestoreArtifact.revisionRequestedBy && (
                      <span className="font-normal ml-1 text-amber-600">
                        · {project?.memberInfo?.[firestoreArtifact.revisionRequestedBy]?.displayName ?? '팀원'}
                        {firestoreArtifact.revisionRequestedAt && (
                          <> · {new Date(firestoreArtifact.revisionRequestedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                        )}
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
                  "{firestoreArtifact.revisionNote}"
                </p>
              </div>
            )}

            {/* 확정 정보 (누가 확정했는지) */}
            {isConfirmed && firestoreArtifact?.confirmedBy && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-xl px-3 py-2">
                <CheckCircle className="w-3.5 h-3.5" />
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

            <div className="flex items-center gap-1.5 text-xs text-gray-400 pt-2 border-t border-gray-100">
              <Clock className="w-3.5 h-3.5" />
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
        <div className="px-5 py-4 border-t bg-gray-50 space-y-2 flex-shrink-0">
          {isHost ? (
            // ── 팀장 전용 버튼 ──
            isConfirmed ? (
              <>
                <div className="flex items-center gap-2 text-green-700 mb-1">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-bold">산출물이 확정되었습니다</span>
                </div>
                <button
                  onClick={handleRedraft}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  확정 취소 · 재검토
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={isSaving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500 text-white text-sm font-bold hover:bg-green-600 disabled:opacity-60 transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  {isSaving ? '저장 중...' : '산출물 확정하기'}
                </button>
                <button
                  onClick={handleRedraft}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  AI 재초안 요청
                </button>
              </>
            )
          ) : (
            // ── 팀원 전용 버튼 ──
            isConfirmed ? (
              <>
                <div className="flex items-center gap-2 text-green-700 mb-1">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-semibold">팀장이 확정한 산출물입니다</span>
                </div>
                {showRevisionForm ? (
                  <div className="space-y-2">
                    <textarea
                      value={revisionNote}
                      onChange={e => setRevisionNote(e.target.value)}
                      placeholder="수정이 필요한 내용을 적어주세요..."
                      rows={3}
                      className="w-full text-sm border border-gray-300 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleRevisionRequest}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors"
                      >
                        수정 요청 보내기
                      </button>
                      <button
                        onClick={() => setShowRevisionForm(false)}
                        className="px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRevisionForm(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    수정 요청하기
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-gray-500 text-xs py-1">
                <Lock className="w-3.5 h-3.5" />
                <span>팀장만 산출물을 확정할 수 있습니다</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

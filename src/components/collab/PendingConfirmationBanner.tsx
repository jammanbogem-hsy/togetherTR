'use client'

import { useState } from 'react'
import { CheckCircle, ChatCircleDots, Eye } from '@phosphor-icons/react'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, displayActivityCode, type ActivityCode } from '@/types'
import { pendingConfirmationsForUser } from '@/lib/collab/artifactConfirmations'
import { respondArtifactConfirmation } from '@/lib/firebase/projects'
import { ArtifactPreviewModal, type ArtifactPreviewModalState } from '@/components/artifacts/ArtifactPanel'

/**
 * 팀장 종합으로 정리된 산출물을 부재했던 팀원이 확인하는 카드(#28).
 * 어느 활동을 보고 있든 프로젝트 화면 위에 오래된 순으로 하나씩 보여 준다.
 */
export function PendingConfirmationBanner() {
  const project = useProjectStore(state => state.project)
  const userProfile = useProjectStore(state => state.userProfile)
  const [mode, setMode] = useState<'idle' | 'reason'>('idle')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ArtifactPreviewModalState | null>(null)

  const pending = pendingConfirmationsForUser(project?.artifactConfirmations, userProfile?.uid)
  if (!project || !userProfile || pending.length === 0) {
    return <ArtifactPreviewModal modal={preview} onClose={() => setPreview(null)} />
  }
  const { activityCode, entry } = pending[0]
  const code = activityCode as ActivityCode
  const label = ACTIVITY_META[code]?.label ?? activityCode
  const labelEnding = label.replace(/[\s)]+$/g, '').slice(-1)
  const objectParticle = /[가-힣]/.test(labelEnding) && (labelEnding.charCodeAt(0) - 0xAC00) % 28 !== 0 ? '을' : '를'
  const artifact = project.artifacts?.[code]

  async function respond(response: Parameters<typeof respondArtifactConfirmation>[4]) {
    if (!project || !userProfile) return
    setBusy(true)
    setError(null)
    try {
      await respondArtifactConfirmation(project.id, code, userProfile.uid, entry, response)
      setMode('idle')
      setReason('')
    } catch (err) {
      console.error('[PendingConfirmationBanner] respond failed:', err)
      setError('저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        role="status"
        data-testid="pending-confirmation-banner"
        className="fixed left-1/2 top-3 z-[80] w-[calc(100vw-2rem)] max-w-[748px] max-h-[calc(100dvh-2rem)] overflow-y-auto -translate-x-1/2 rounded-3xl border border-[#FFE0B2] bg-white p-5 sm:p-6 shadow-lg"
      >
        <p className="text-[18px] font-bold text-[#202124] leading-snug" style={{ wordBreak: 'keep-all' }}>
          팀장이 {displayActivityCode(code)}·{label}{objectParticle} 정리했어요. 내용을 확인해 주세요.
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[#5F6368]">
          내가 대화에 없을 때 저장된 산출물이에요{pending.length > 1 ? ` · 확인할 산출물 ${pending.length}건` : ''}
        </p>
        {mode === 'reason' ? (
          <div className="mt-4 space-y-3">
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={3}
              placeholder="다시 논의하고 싶은 점을 짧게 적어 주세요"
              className="w-full resize-none rounded-lg border border-[#DADCE0] px-3 py-2.5 text-[16px] leading-relaxed focus:outline-none focus:border-[#1A73E8]"
            />
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => { setMode('idle'); setReason('') }} disabled={busy}
                className="rounded-full min-h-11 px-5 py-2.5 text-[16px] font-semibold text-[#5F6368] hover:bg-[#F1F3F4]">취소</button>
              <button type="button" onClick={() => void respond({ type: 'rediscuss', reason, cycleNumber: project.currentCycle ?? 1 })}
                disabled={busy || !reason.trim()}
                className="rounded-full bg-[#C5221F] min-h-11 px-5 py-2.5 text-[16px] font-bold text-white disabled:opacity-40">요청 보내기</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {artifact && (
              <button type="button"
                onClick={() => setPreview({
                  title: artifact.title ?? label,
                  subtitle: `${displayActivityCode(code)} ${label} · 버전 ${artifact.version ?? 1}`,
                  content: (artifact.content ?? {}) as Record<string, unknown>,
                  status: artifact.status,
                  stageCode: ACTIVITY_META[code]?.stage ?? '',
                  activityCode: code,
                })}
                className="inline-flex items-center gap-2 rounded-full border border-[#DADCE0] min-h-11 px-5 py-2.5 text-[16px] font-semibold text-[#1A73E8] hover:bg-[#F8FBFF]">
                <Eye size={18} weight="bold" /> 산출물 보기
              </button>
            )}
            <button type="button" onClick={() => void respond({ type: 'confirmed' })} disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-[#1A73E8] min-h-11 px-5 py-2.5 text-[16px] font-bold text-white disabled:opacity-40">
              <CheckCircle size={18} weight="fill" /> 확인했어요
            </button>
            <button type="button" onClick={() => setMode('reason')} disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-[#F4C7C3] min-h-11 px-5 py-2.5 text-[16px] font-semibold text-[#C5221F] hover:bg-[#FCE8E6]">
              <ChatCircleDots size={18} weight="bold" /> 다시 논의 요청
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-[14px] text-[#C5221F]">{error}</p>}
      </div>
      <ArtifactPreviewModal modal={preview} onClose={() => setPreview(null)} />
    </>
  )
}

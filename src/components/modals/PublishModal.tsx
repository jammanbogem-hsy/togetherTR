'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Globe, Copy, Check, Warning, ArrowSquareOut, ArrowClockwise, LinkSimpleBreak } from '@phosphor-icons/react'
import { publishProjectReports, unpublishProjectReports, getPublicReportUrl } from '@/lib/firebase/publicReports'
import type { Project } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 공개 배포 모달.
 * - 호스트만 호출 가능 (상위에서 isHost 가드)
 * - 상태: 비공개 / 공개됨 / 최근 변경 후 업데이트 필요
 * - 동작: 배포하기 / 업데이트 / 공개 해제 / 링크 복사
 */
export function PublishModal({
  open,
  onClose,
  project,
  projectId,
  uid,
}: {
  open: boolean
  onClose: () => void
  project: Project
  projectId: string
  uid: string
}) {
  const [busy, setBusy] = useState<null | 'publish' | 'unpublish'>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isPublic = !!project.publicStatus?.isPublic
  const lastPublishedAt = project.publicStatus?.lastPublishedAt
  const publicUrl = getPublicReportUrl(projectId)

  // 공개 이후 보고서가 새로 생성/수정됐는지 판단 — 업데이트 제안 표시용.
  // stageReports / cumulativeReport 의 savedAt 중 max 값을 비교.
  const latestReportSavedAt = (() => {
    let max = 0
    const sr = project.stageReports ?? {}
    for (const v of Object.values(sr)) if (v?.savedAt && v.savedAt > max) max = v.savedAt
    const cm = project.cumulativeReport?.savedAt
    if (cm && cm > max) max = cm
    return max
  })()
  const needsUpdate = isPublic && lastPublishedAt !== undefined && latestReportSavedAt > lastPublishedAt

  const hasStageReports = !!project.stageReports && Object.keys(project.stageReports).length > 0
  const hasCumulative = !!project.cumulativeReport?.content
  const canPublish = hasStageReports || hasCumulative

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  if (!open || typeof document === 'undefined') return null

  async function handlePublish() {
    setBusy('publish')
    setError(null)
    try {
      await publishProjectReports(projectId, uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : '배포에 실패했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function handleUnpublish() {
    if (!window.confirm('공개 링크를 해제하시겠어요?\n공유했던 링크로 더 이상 접근할 수 없게 됩니다.')) return
    setBusy('unpublish')
    setError(null)
    try {
      await unpublishProjectReports(projectId, uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : '해제에 실패했습니다.')
    } finally {
      setBusy(null)
    }
  }

  function handleCopyLink() {
    if (!publicUrl) return
    navigator.clipboard.writeText(publicUrl).then(
      () => setCopied(true),
      () => setError('링크 복사에 실패했습니다. 주소를 수동으로 복사해 주세요.'),
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-gradient-to-br from-[#E8F0FE] to-white px-5 py-4 flex items-center gap-3 border-b border-[#DADCE0]">
          <div className="w-10 h-10 rounded-xl bg-[#1A73E8] flex items-center justify-center flex-shrink-0">
            <Globe size={20} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#1A73E8] uppercase tracking-widest">공개 링크</p>
            <h3 className="text-[15px] font-bold text-[#202124] truncate">{project.title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 rounded-full hover:bg-white text-[#5F6368] transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-5 space-y-4">
          {/* 상태 배너 */}
          {isPublic ? (
            <div className={cn(
              'rounded-xl px-4 py-3 flex items-start gap-3 border',
              needsUpdate ? 'bg-[#FEF7E0] border-[#FADE9A]' : 'bg-[#E6F4EA] border-[#B9D9C2]'
            )}>
              {needsUpdate ? <Warning size={18} weight="fill" className="text-[#F9AB00] mt-0.5 flex-shrink-0" />
                           : <Check size={18} weight="bold" className="text-[#188038] mt-0.5 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className={cn('text-[13px] font-bold', needsUpdate ? 'text-[#B06000]' : 'text-[#188038]')}>
                  {needsUpdate ? '보고서가 변경되었습니다' : '공개 중입니다'}
                </p>
                <p className="text-[11px] text-[#5F6368] mt-0.5 leading-snug">
                  {needsUpdate
                    ? '공개된 스냅샷에 새 내용이 반영되지 않았습니다. 업데이트를 눌러 최신 보고서로 다시 배포하세요.'
                    : lastPublishedAt
                      ? `${new Date(lastPublishedAt).toLocaleString('ko-KR')}에 배포됨`
                      : '이 링크로 누구나 보고서를 볼 수 있습니다.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl px-4 py-3 flex items-start gap-3 bg-[#F8F9FA] border border-[#E8EAED]">
              <Globe size={18} weight="regular" className="text-[#5F6368] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#3C4043]">아직 공개되지 않았습니다</p>
                <p className="text-[11px] text-[#5F6368] mt-0.5 leading-snug">
                  배포하면 링크로 보고서를 외부에 공유할 수 있습니다. 팀원 정보·채팅은 절대 공개되지 않아요.
                </p>
              </div>
            </div>
          )}

          {/* 공개 링크 박스 (공개 중일 때만) */}
          {isPublic && publicUrl && (
            <div>
              <p className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider mb-1.5">공개 주소</p>
              <div className="flex items-center gap-2 rounded-xl border border-[#DADCE0] bg-[#F8F9FA] overflow-hidden">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 px-3 py-2.5 text-[12px] font-mono text-[#1A73E8] truncate hover:underline"
                  title={publicUrl}
                >
                  {publicUrl}
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  title="링크 복사"
                  aria-label="링크 복사"
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 text-[12px] font-semibold border-l border-[#DADCE0] transition-colors flex-shrink-0',
                    copied ? 'bg-[#E6F4EA] text-[#188038]' : 'bg-white text-[#5F6368] hover:bg-[#E8F0FE] hover:text-[#1A73E8]'
                  )}
                >
                  {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="regular" />}
                  {copied ? '복사됨' : '복사'}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="새 탭에서 열기"
                  aria-label="새 탭에서 열기"
                  className="flex items-center justify-center w-9 h-9 text-[#5F6368] hover:text-[#1A73E8] hover:bg-[#E8F0FE] border-l border-[#DADCE0] transition-colors flex-shrink-0"
                >
                  <ArrowSquareOut size={14} />
                </a>
              </div>
            </div>
          )}

          {/* 포함 / 제외 설명 */}
          <details className="rounded-xl border border-[#E8EAED] bg-[#FAFBFC] overflow-hidden" open={!isPublic}>
            <summary className="px-4 py-2.5 text-[12px] font-bold text-[#3C4043] cursor-pointer select-none hover:bg-[#F1F3F4]">
              공개에 포함되는 내용 · 제외되는 내용
            </summary>
            <div className="px-4 pb-3 pt-1 grid grid-cols-2 gap-4 text-[11px] leading-relaxed">
              <div>
                <p className="font-bold text-[#188038] mb-1.5">✓ 포함</p>
                <ul className="space-y-1 text-[#3C4043]">
                  <li>프로젝트 제목 · 학교급 · 학년군 · 교과</li>
                  <li>단계별 분석 보고서</li>
                  <li>종합 보고서 (있는 경우)</li>
                  <li>팀원 수 (이름은 제외)</li>
                </ul>
              </div>
              <div>
                <p className="font-bold text-[#C5221F] mb-1.5">✗ 제외</p>
                <ul className="space-y-1 text-[#3C4043]">
                  <li>팀원 이름 · 이메일 · UID</li>
                  <li>채팅 메시지 · 토론 기록</li>
                  <li>초대 코드</li>
                  <li>산출물의 내부 메타 정보</li>
                </ul>
              </div>
            </div>
          </details>

          {/* 배포 가능 여부 안내 */}
          {!canPublish && (
            <div className="rounded-xl px-4 py-3 bg-[#FCE8E6] border border-[#F4C7C3] text-[12px] text-[#C5221F]">
              배포할 보고서가 없습니다. 단계 보고서 또는 종합 보고서를 먼저 생성해 주세요.
            </div>
          )}

          {error && (
            <div className="rounded-xl px-4 py-3 bg-[#FCE8E6] border border-[#F4C7C3] text-[12px] text-[#C5221F]">
              {error}
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-2 px-5 py-3 bg-[#F8F9FA] border-t border-[#E8EAED]">
          {isPublic && (
            <button
              type="button"
              onClick={handleUnpublish}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-[#C5221F] hover:bg-[#FCE8E6] rounded-full transition-colors disabled:opacity-50"
            >
              <LinkSimpleBreak size={14} weight="bold" />
              공개 해제
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-[12px] font-semibold text-[#5F6368] hover:bg-[#E8EAED] rounded-full transition-colors"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={busy !== null || !canPublish}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-full transition-colors flex-shrink-0',
              'bg-[#1A73E8] text-white hover:bg-[#1557B0] disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {busy === 'publish' ? '배포 중…' : isPublic ? (
              <><ArrowClockwise size={14} weight="bold" /> 업데이트</>
            ) : (
              <><Globe size={14} weight="fill" /> 공개 배포</>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

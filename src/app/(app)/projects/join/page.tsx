'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { findProjectByInviteCode, joinProject } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import { cn } from '@/lib/utils'
import { ArrowLeft, Loader2, Users } from 'lucide-react'

export default function JoinProjectPage() {
  const router = useRouter()
  const { userProfile } = useProjectStore()
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    const trimmed = code.trim()
    if (!trimmed) return
    setIsLoading(true)
    setError('')

    try {
      const project = await findProjectByInviteCode(trimmed)
      if (!project) {
        setError('초대코드를 찾을 수 없습니다. 다시 확인해주세요.')
        setIsLoading(false)
        return
      }

      const uid = userProfile?.uid ?? 'demo-user'
      // 이미 참여한 경우 바로 입장
      if (!project.memberUids?.includes(uid)) {
        await joinProject(project.id, uid, trimmed, userProfile ? {
          displayName: userProfile.displayName,
          color: userProfile.color ?? '#A0BCE8',
          emoji: userProfile.emoji ?? '👤',
        } : undefined)
      }
      router.push(`/projects/${project.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message === 'duplicate-invite-code') {
        setError('동일한 초대코드가 중복되어 있어 입장할 수 없습니다. 새 초대코드를 다시 받아주세요.')
      } else if (message === 'invalid-invite-code') {
        setError('초대코드가 일치하지 않습니다. 다시 확인해주세요.')
      } else if (message === 'solo-project') {
        setError('이 프로젝트는 개인 설계 프로젝트라 팀 참여가 불가능합니다.')
      } else {
        setError('오류가 발생했습니다. 다시 시도해주세요.')
      }
      setIsLoading(false)
    }
  }

  return (
    <div className="m3-shell flex min-h-dvh items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full min-w-0 max-w-md">
        <button
          onClick={() => router.push('/dashboard')}
          className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-full px-3 text-base font-medium text-[var(--md-sys-primary)] transition-[filter] hover:bg-[var(--md-sys-primary-container)]"
        >
          <ArrowLeft className="w-4 h-4" />
          대시보드로
        </button>

        <div className="rounded-[var(--md-sys-radius-xl)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)] p-5 sm:p-8">
          <div className="mb-7 flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)]">
              <Users className="size-6" />
            </div>
            <div>
              <p className="text-2xl font-medium leading-8 text-[var(--md-sys-on-surface)]" aria-level={1} role="heading">방 참여하기</p>
              <p className="mt-1 text-base leading-6 text-[var(--md-sys-on-surface-variant)]" id="join-code-label">초대코드를 입력하세요</p>
            </div>
          </div>

          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleJoin()}
            placeholder="예) 파란고양이"
            autoFocus
            className="mb-5 min-h-14 w-full min-w-0 rounded-[var(--md-sys-radius-sm)] border border-[var(--md-sys-outline)] bg-[var(--md-sys-surface-container-lowest)] px-4 py-3 text-center text-lg font-medium tracking-wide text-[var(--md-sys-on-surface)] placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--md-sys-on-surface-variant)] focus:border-[var(--md-sys-primary)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--md-sys-primary)]" aria-invalid={!!error} aria-describedby={error ? 'join-error' : undefined} aria-labelledby="join-code-label"
          />

          {error && (
            <p className="mb-4 rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-error-container)] px-4 py-3 text-base leading-6 text-[var(--md-sys-on-error-container)]" id="join-error" role="alert">{error}</p>
          )}

          <button
            onClick={handleJoin}
            disabled={!code.trim() || isLoading}
            className={cn(
              'min-h-14 w-full rounded-full px-5 py-3 text-base font-medium transition-[filter]',
              'flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-[var(--md-sys-surface-container-highest)] disabled:text-[var(--md-sys-on-surface-variant)]',
              'bg-[var(--md-sys-primary)] text-[var(--md-sys-on-primary)] enabled:hover:brightness-95'
            )}
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />입장 중...</>
            ) : (
              '방 입장하기 →'
            )}
          </button>
        </div>

        <p className="mt-5 px-3 text-base leading-7 text-[var(--md-sys-on-surface-variant)]">
          한 번 입장하면 다음부터는 코드 없이 바로 들어올 수 있어요
        </p>
      </div>
    </div>
  )
}

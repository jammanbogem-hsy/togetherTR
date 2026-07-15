'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { findProjectByInviteCode, joinProject } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import { cn } from '@/lib/utils'
import { ArrowLeft, BookOpen, Loader2, Users } from 'lucide-react'

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          대시보드로
        </button>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">방 참여하기</p>
              <p className="text-xs text-gray-500">초대코드를 입력하세요</p>
            </div>
          </div>

          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleJoin()}
            placeholder="예) 파란고양이"
            autoFocus
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-teal-400 mb-4 tracking-wide"
          />

          {error && (
            <p className="text-xs text-red-500 mb-3 text-center">{error}</p>
          )}

          <button
            onClick={handleJoin}
            disabled={!code.trim() || isLoading}
            className={cn(
              'w-full py-3 rounded-xl text-white font-bold text-sm transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2',
              'bg-teal-500 hover:bg-teal-600'
            )}
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />입장 중...</>
            ) : (
              '방 입장하기 →'
            )}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          한 번 입장하면 다음부터는 코드 없이 바로 들어올 수 있어요
        </p>
      </div>
    </div>
  )
}

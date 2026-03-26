'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { signInWithNickname } from '@/lib/auth'
import { BookOpen, Loader2, User } from 'lucide-react'

const SUGGESTED_EMOJIS = ['🍎', '🌿', '🌊', '☀️', '🌸', '🍊', '⭐', '🦋']
const SUGGESTED_NAMES = ['김선생님', '이선생님', '박선생님', '최선생님', '정선생님']

export default function LoginPage() {
  const router = useRouter()
  const { setUserProfile } = useProjectStore()
  const [name, setName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleStart() {
    if (!name.trim()) return
    setIsLoading(true)
    setError('')
    try {
      const profile = await signInWithNickname(name.trim())
      setUserProfile(profile)
      router.push('/dashboard')
    } catch (err) {
      setError('로그인 중 오류가 발생했습니다. 다시 시도해주세요.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-500 rounded-2xl mb-4 shadow-lg">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-black text-gray-900">T-CID 협력 수업설계</h1>
          <p className="text-sm text-gray-500 mt-1">AI 퍼실리테이터와 함께하는 수업설계</p>
        </div>

        {/* 카드 */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">이름을 알려주세요</p>
              <p className="text-xs text-gray-500">팀원들에게 보여질 이름입니다</p>
            </div>
          </div>

          {/* 이름 입력 */}
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleStart()}
            placeholder="예) 김민준 선생님"
            maxLength={20}
            autoFocus
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-400 mb-3"
          />

          {/* 빠른 선택 */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {SUGGESTED_NAMES.map(n => (
              <button
                key={n}
                onClick={() => setName(n)}
                className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600
                           hover:bg-blue-100 hover:text-blue-700 transition-colors"
              >
                {n}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-500 mb-3">{error}</p>
          )}

          <button
            onClick={handleStart}
            disabled={!name.trim() || isLoading}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold text-sm
                       hover:bg-blue-600 transition-colors disabled:opacity-40
                       disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />입장 중...</>
            ) : (
              '수업설계 시작하기 →'
            )}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          이름은 언제든지 변경할 수 있습니다
        </p>
      </div>
    </div>
  )
}

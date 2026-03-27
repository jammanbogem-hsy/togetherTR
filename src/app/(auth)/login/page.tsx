'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { signInWithNickname } from '@/lib/auth'
import { BookOpen, ArrowRight, Loader2 } from 'lucide-react'

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
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #EAF2FF 0%, #F8F9FA 50%, #F3E5F5 100%)' }}
    >
      {/* 배경 장식 원 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{
          position: 'absolute', top: '-10%', left: '-8%',
          width: '420px', height: '420px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(26,115,232,0.10) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-8%', right: '-6%',
          width: '360px', height: '360px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(123,31,162,0.09) 0%, transparent 70%)',
        }} />
      </div>

      <div className="w-full max-w-sm relative">
        {/* 로고 아이콘 */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-[72px] h-[72px] bg-[#1A73E8] mb-5 shadow-xl"
            style={{
              animation: 'morph-shape 8s ease-in-out infinite, stage-bounce 3s ease-in-out infinite',
              boxShadow: '0 8px 28px rgba(26,115,232,0.42)',
            }}
          >
            <BookOpen className="w-8 h-8 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-[26px] font-black text-[#202124] tracking-tight">T-CID 협력 수업설계</h1>
          <p className="text-[13px] text-[#5F6368] mt-1.5">AI 퍼실리테이터와 함께하는 수업설계</p>
        </div>

        {/* 카드 */}
        <div
          className="project-card rounded-3xl p-6 shadow-2xl"
          style={{
            '--cc': 'rgba(26,115,232,0.12)',
            '--cx1': '100%', '--cy1': '0%',
            '--cx2': '0%',  '--cy2': '100%',
            '--card-speed': '0.7s',
          } as React.CSSProperties}
        >
          {/* 헤더 */}
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-9 h-9 bg-[#1A73E8] flex items-center justify-center flex-shrink-0"
              style={{ animation: 'morph-shape 9s ease-in-out infinite', boxShadow: '0 4px 12px rgba(26,115,232,0.35)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#202124]">이름을 알려주세요</p>
              <p className="text-[12px] text-[#9AA0A6]">팀원들에게 보여질 이름입니다</p>
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
            className="w-full rounded-2xl border border-[#E8EAED] bg-white px-4 py-3 text-[14px] text-[#202124] placeholder:text-[#BDC1C6] mb-3 outline-none transition-all duration-200"
            style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#1A73E8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(26,115,232,0.12)' }}
            onBlur={e => { e.currentTarget.style.borderColor = '#E8EAED'; e.currentTarget.style.boxShadow = 'inset 0 1px 3px rgba(0,0,0,0.06)' }}
          />

          {/* 빠른 선택 */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {SUGGESTED_NAMES.map(n => (
              <button
                key={n}
                onClick={() => setName(n)}
                className="text-[12px] px-3 py-1.5 rounded-full border border-[#E8EAED] bg-white text-[#5F6368] font-medium transition-all duration-150 hover:border-[#1A73E8] hover:text-[#1A73E8] hover:bg-[#E8F0FE]"
              >
                {n}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-[12px] text-[#C62828] mb-3 bg-[#FFEBEE] rounded-xl px-3 py-2">{error}</p>
          )}

          {/* 시작 버튼 */}
          <button
            onClick={handleStart}
            disabled={!name.trim() || isLoading}
            className="morph-btn w-full py-3.5 bg-[#1A73E8] text-white font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ filter: name.trim() && !isLoading ? 'drop-shadow(0 4px 14px rgba(26,115,232,0.42))' : 'none' }}
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />입장 중...</>
            ) : (
              <><span>수업설계 시작하기</span><ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </div>

        <p className="text-center text-[12px] text-[#9AA0A6] mt-4">
          이름은 언제든지 변경할 수 있습니다
        </p>
      </div>
    </div>
  )
}

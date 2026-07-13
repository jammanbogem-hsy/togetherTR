'use client'

// 로그인 카드 — 기존 page.tsx의 로그인 로직·UI를 verbatim 이식 (기능 무변경).
// 허용된 변경 3가지만 적용: ① 'use client'/import 이동 ② showBrand prop(브랜드 블록 조건부 렌더)
// ③ 페이지 배경/장식은 랜딩 쪽(HeroSection)으로 분리.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { signInWithGoogle, completeProfile } from '@/lib/auth'
import type { User } from 'firebase/auth'
import { BookOpen, ArrowRight, Loader2, ChevronDown } from 'lucide-react'

type Step = 'google' | 'profile'

const SCHOOL_LEVELS = ['초등', '중등', '고등'] as const
const GRADE_OPTIONS: Record<string, string[]> = {
  초등: ['1학년', '2학년', '3학년', '4학년', '5학년', '6학년', '1-2학년', '3-4학년', '5-6학년', '전학년'],
  중등: ['1학년', '2학년', '3학년', '전학년'],
  고등: ['1학년', '2학년', '3학년', '전학년'],
}

export default function LoginCard({ showBrand = true }: { showBrand?: boolean }) {
  const router = useRouter()
  const { setUserProfile } = useProjectStore()

  const [step, setStep] = useState<Step>('google')
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // 프로필 폼
  const [displayName, setDisplayName] = useState('')
  const [schoolLevel, setSchoolLevel] = useState<'초등' | '중등' | '고등'>('초등')
  const [schoolName, setSchoolName] = useState('')
  const [grade, setGrade] = useState('전학년')

  async function handleGoogleLogin() {
    setIsLoading(true)
    setError('')
    try {
      const { firebaseUser: user, existingProfile } = await signInWithGoogle()
      if (existingProfile) {
        setUserProfile(existingProfile)
        router.push('/dashboard')
        return
      }
      // 신규 사용자 — 프로필 입력 단계로
      setFirebaseUser(user)
      setDisplayName(user.displayName ?? '')
      setStep('profile')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('popup-closed')) {
        setError('')
      } else {
        setError('Google 로그인 중 오류가 발생했습니다. 다시 시도해주세요.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCompleteProfile() {
    if (!firebaseUser || !displayName.trim() || !schoolName.trim()) return
    setIsLoading(true)
    setError('')
    try {
      const profile = await completeProfile(firebaseUser, {
        displayName: displayName.trim(),
        schoolLevel,
        schoolName: schoolName.trim(),
        grade,
      })
      setUserProfile(profile)
      router.push('/dashboard')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`저장 오류: ${msg}`)
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md relative">
      {/* 로고 (showBrand=false 시 랜딩 Hero가 h1을 담당하므로 렌더하지 않음 — 중복 h1 방지) */}
      {showBrand && (
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
      )}

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
        {step === 'google' ? (
          <>
            <div className="text-center mb-6">
              <p className="text-[17px] font-bold text-[#202124]">시작하기</p>
              <p className="text-[13.5px] text-[#9AA0A6] mt-1">Google 계정으로 로그인하세요</p>
            </div>

            {error && (
              <p className="text-[13px] text-[#C62828] mb-4 bg-[#FFEBEE] rounded-xl px-3 py-2 text-center">{error}</p>
            )}

            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl border border-[#E8EAED] bg-white text-[15.5px] font-semibold text-[#202124] hover:bg-[#F8F9FA] transition-colors disabled:opacity-50"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#1A73E8]" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
              )}
              Google로 시작하기
            </button>
          </>
        ) : (
          <>
            {/* 프로필 입력 단계 */}
            <div className="flex items-center gap-3 mb-5">
              {firebaseUser?.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firebaseUser.photoURL} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#E8F0FE] flex items-center justify-center text-[#1A73E8] font-bold text-[14px]">
                  {displayName[0] ?? '?'}
                </div>
              )}
              <div>
                <p className="text-[15.5px] font-bold text-[#202124]">프로필을 완성해주세요</p>
                <p className="text-[13px] text-[#9AA0A6]">{firebaseUser?.email}</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* 이름 */}
              <div>
                <label className="block text-[12.5px] font-semibold text-[#5F6368] mb-1">이름</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="예) 김민준 선생님"
                  maxLength={20}
                  className="w-full rounded-xl border border-[#E8EAED] bg-white px-4 py-3 text-[14.5px] text-[#202124] placeholder:text-[#BDC1C6] outline-none"
                  onFocus={e => e.currentTarget.style.borderColor = '#1A73E8'}
                  onBlur={e => e.currentTarget.style.borderColor = '#E8EAED'}
                />
              </div>

              {/* 학교급 */}
              <div>
                <label className="block text-[12.5px] font-semibold text-[#5F6368] mb-1">학교급</label>
                <div className="flex gap-2">
                  {SCHOOL_LEVELS.map(level => (
                    <button
                      key={level}
                      onClick={() => { setSchoolLevel(level); setGrade('전학년') }}
                      className={`flex-1 py-2.5 rounded-xl text-[13.5px] font-semibold border transition-colors ${
                        schoolLevel === level
                          ? 'bg-[#1A73E8] text-white border-[#1A73E8]'
                          : 'bg-white text-[#5F6368] border-[#E8EAED] hover:border-[#1A73E8]'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* 학교명 */}
              <div>
                <label className="block text-[12.5px] font-semibold text-[#5F6368] mb-1">학교명</label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  placeholder="예) 한국초등학교"
                  maxLength={30}
                  className="w-full rounded-xl border border-[#E8EAED] bg-white px-4 py-3 text-[14.5px] text-[#202124] placeholder:text-[#BDC1C6] outline-none"
                  onFocus={e => e.currentTarget.style.borderColor = '#1A73E8'}
                  onBlur={e => e.currentTarget.style.borderColor = '#E8EAED'}
                />
              </div>

              {/* 담당 학년 */}
              <div>
                <label className="block text-[12.5px] font-semibold text-[#5F6368] mb-1">담당 학년</label>
                <div className="relative">
                  <select
                    value={grade}
                    onChange={e => setGrade(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-[#E8EAED] bg-white px-4 py-3 text-[14.5px] text-[#202124] outline-none pr-8"
                  >
                    {(GRADE_OPTIONS[schoolLevel] ?? []).map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9AA0A6] pointer-events-none" />
                </div>
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-[#C62828] mt-3 bg-[#FFEBEE] rounded-xl px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleCompleteProfile}
              disabled={!displayName.trim() || !schoolName.trim() || isLoading}
              className="morph-btn w-full mt-4 py-4 bg-[#1A73E8] text-white font-bold text-[15.5px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ filter: displayName.trim() && schoolName.trim() && !isLoading ? 'drop-shadow(0 4px 14px rgba(26,115,232,0.42))' : 'none' }}
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />저장 중...</>
              ) : (
                <><span>수업설계 시작하기</span><ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </>
        )}
      </div>

      <p className="text-center text-[13.5px] text-[#9AA0A6] mt-4">
        프로필은 대시보드에서 언제든지 수정할 수 있습니다
      </p>
    </div>
  )
}

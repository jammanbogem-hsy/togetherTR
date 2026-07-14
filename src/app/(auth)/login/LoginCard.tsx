'use client'

// 로그인 카드 — 기존 page.tsx의 로그인 로직·UI를 verbatim 이식 (기능 무변경).
// 로그인 로직(핸들러·상태·조건·maxLength·Google svg)은 문자 단위로 동일.
// Material Design 3 표현(클래스·정적 텍스트 크기·아이콘·필드 스타일)만 변경.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/store/project'
import { signInWithGoogle, completeProfile } from '@/lib/auth'
import type { User } from 'firebase/auth'
import { Loader2 } from 'lucide-react'

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
          <div className="inline-flex items-center justify-center w-[72px] h-[72px] rounded-[20px] bg-[var(--md-primary-container)] mb-5">
            <span className="material-symbols-rounded text-[color:var(--md-on-primary-container)]" style={{ fontSize: 34 }} aria-hidden="true">menu_book</span>
          </div>
          <h1 className="text-[26px] font-black text-[color:var(--md-on-surface)] tracking-tight">T-CID 협력 수업설계</h1>
          <p className="text-[13px] text-[color:var(--md-on-surface-variant)] mt-1.5">AI 퍼실리테이터와 함께하는 수업설계</p>
        </div>
      )}

      {/* 카드 (M3 surface-container-lowest · elevation-1) */}
      <div
        className="rounded-[28px] border border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-6"
        style={{ boxShadow: '0 1px 3px 1px rgb(0 0 0 / 0.1), 0 1px 2px rgb(0 0 0 / 0.15)' }}
      >
        {step === 'google' ? (
          <>
            <div className="text-center mb-6">
              <p className="text-[22px] font-bold text-[color:var(--md-on-surface)]">시작하기</p>
              <p className="text-[15px] text-[color:var(--md-on-surface-variant)] mt-1">Google 계정으로 로그인하세요</p>
            </div>

            {error && (
              <p className="text-[14px] text-[color:var(--md-on-error-container)] mb-4 bg-[var(--md-error-container)] rounded-xl px-3 py-2 text-center">{error}</p>
            )}

            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="m3-state w-full flex items-center justify-center gap-3 h-14 rounded-full border border-[color:var(--md-outline)] bg-[var(--md-surface)] text-[16.5px] font-medium text-[color:var(--md-on-surface)] disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-[color:var(--md-primary)]" />
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
                <div className="w-10 h-10 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center text-[color:var(--md-on-primary-container)] font-bold text-[14px]">
                  {displayName[0] ?? '?'}
                </div>
              )}
              <div>
                <p className="text-[16px] font-bold text-[color:var(--md-on-surface)]">프로필을 완성해주세요</p>
                <p className="text-[13px] text-[color:var(--md-on-surface-variant)]">{firebaseUser?.email}</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* 이름 */}
              <div>
                <label className="block text-[13.5px] font-medium text-[color:var(--md-on-surface-variant)] mb-1">이름</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="예) 김민준 선생님"
                  maxLength={20}
                  className="m3-field w-full px-4 py-3 text-[16px] text-[color:var(--md-on-surface)] placeholder:text-[color:var(--md-outline)]"
                />
              </div>

              {/* 학교급 (M3 connected segmented) */}
              <div>
                <label className="block text-[13.5px] font-medium text-[color:var(--md-on-surface-variant)] mb-1">학교급</label>
                <div className="flex rounded-full border border-[color:var(--md-outline)] overflow-hidden">
                  {SCHOOL_LEVELS.map((level, idx) => (
                    <button
                      key={level}
                      onClick={() => { setSchoolLevel(level); setGrade('전학년') }}
                      className={`m3-state flex-1 flex items-center justify-center gap-1 py-2.5 text-[14px] font-medium transition-colors ${idx > 0 ? 'border-l border-[color:var(--md-outline)]' : ''} ${
                        schoolLevel === level
                          ? 'bg-[var(--md-secondary-container)] text-[color:var(--md-on-secondary-container)]'
                          : 'bg-transparent text-[color:var(--md-on-surface)]'
                      }`}
                    >
                      {schoolLevel === level && (
                        <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">check</span>
                      )}
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* 학교명 */}
              <div>
                <label className="block text-[13.5px] font-medium text-[color:var(--md-on-surface-variant)] mb-1">학교명</label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  placeholder="예) 한국초등학교"
                  maxLength={30}
                  className="m3-field w-full px-4 py-3 text-[16px] text-[color:var(--md-on-surface)] placeholder:text-[color:var(--md-outline)]"
                />
              </div>

              {/* 담당 학년 (M3 filled field + expand_more) */}
              <div>
                <label className="block text-[13.5px] font-medium text-[color:var(--md-on-surface-variant)] mb-1">담당 학년</label>
                <div className="relative">
                  <select
                    value={grade}
                    onChange={e => setGrade(e.target.value)}
                    className="m3-field w-full appearance-none px-4 py-3 text-[16px] text-[color:var(--md-on-surface)] pr-9"
                  >
                    {(GRADE_OPTIONS[schoolLevel] ?? []).map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <span className="material-symbols-rounded absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--md-on-surface-variant)] pointer-events-none" style={{ fontSize: 20 }} aria-hidden="true">expand_more</span>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-[14px] text-[color:var(--md-on-error-container)] mt-3 bg-[var(--md-error-container)] rounded-xl px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleCompleteProfile}
              disabled={!displayName.trim() || !schoolName.trim() || isLoading}
              className="m3-state w-full mt-5 h-14 rounded-full bg-[var(--md-primary)] text-[color:var(--md-on-primary)] font-medium text-[16.5px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />저장 중...</>
              ) : (
                <><span>수업설계 시작하기</span><span className="material-symbols-rounded" style={{ fontSize: 20 }} aria-hidden="true">arrow_forward</span></>
              )}
            </button>
          </>
        )}
      </div>

      <p className="text-center text-[14px] text-[color:var(--md-on-surface-variant)] mt-4">
        프로필은 대시보드에서 언제든지 수정할 수 있습니다
      </p>
    </div>
  )
}

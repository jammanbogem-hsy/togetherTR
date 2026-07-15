'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProject } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import { addJoinedProjectId } from '@/lib/inviteCode'
import type { GradeGroup, ProjectMode, SchoolLevel } from '@/types'
import { cn } from '@/lib/utils'
import { BookOpen, ArrowLeft, Loader2, Copy, Check, ArrowRight } from 'lucide-react'

const SCHOOL_LEVELS: { value: SchoolLevel; label: string }[] = [
  { value: '초등학교', label: '초등학교' },
  { value: '중학교',  label: '중학교' },
  { value: '고등학교', label: '고등학교' },
]

const GRADE_GROUPS: Record<SchoolLevel, { value: GradeGroup; label: string }[]> = {
  초등학교: [
    { value: '초1-2', label: '1-2학년' },
    { value: '초3-4', label: '3-4학년' },
    { value: '초5-6', label: '5-6학년' },
  ],
  중학교: [{ value: '중1-3', label: '1-3학년' }],
  고등학교: [
    { value: '고공통', label: '공통 과목' },
    { value: '고선택', label: '선택 과목' },
  ],
}

const SUBJECT_OPTIONS: Record<SchoolLevel, string[]> = {
  초등학교: ['국어', '수학', '사회', '과학', '영어', '도덕', '음악', '미술', '체육', '실과', '창체'],
  중학교:   ['국어', '수학', '사회', '역사', '도덕', '과학', '기술·가정', '영어', '음악', '미술', '체육', '정보'],
  고등학교: ['국어', '수학', '사회', '과학', '영어', '한국사', '윤리', '정보', '음악', '미술', '체육', '진로'],
}

export default function NewProjectPage() {
  const router = useRouter()
  const { userProfile } = useProjectStore()

  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<ProjectMode>('collaborative')
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>('초등학교')
  const [gradeGroup, setGradeGroup] = useState<GradeGroup>('초3-4')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [semester, setSemester] = useState('2026-1')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null)
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function toggleSubject(subject: string) {
    setSelectedSubjects(prev =>
      prev.includes(subject) ? prev.filter(s => s !== subject) : [...prev, subject]
    )
  }

  function handleSchoolLevelChange(level: SchoolLevel) {
    setSchoolLevel(level)
    setGradeGroup(GRADE_GROUPS[level][0].value)
    setSelectedSubjects([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    const uid = userProfile?.uid ?? 'demo-user'

    setIsSubmitting(true)
    setError(null)
    try {
      const { id: projectId, inviteCode } = await createProject({
        title: title.trim(),
        mode,
        schoolLevel,
        targetGradeGroup: gradeGroup,
        targetSubjects: selectedSubjects,
        createdBy: uid,
        hostUid: uid,
        memberUids: [uid],
        currentStage: 'T',
        currentCycle: 1,
        status: 'active',
        isECompleted: false,
        isA23Completed: false,
        cycleCount: 1,
        metadata: { semester },
        // 개인 설계는 대기실이 없으므로 생성 시점에 시작 상태로 만든다 (방장 시작 버튼 동작 재현).
        ...(mode === 'solo' ? { started: true } : {}),
      })

      addJoinedProjectId(projectId)
      // 개인 설계: 초대코드 안내 화면을 건너뛰고 바로 설계 화면으로 이동.
      if (mode === 'solo') {
        router.push(`/projects/${projectId}`)
        return
      }
      setCreatedProjectId(projectId)
      setCreatedInviteCode(inviteCode)
    } catch (err) {
      console.error('프로젝트 생성 실패:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(`저장 실패: ${msg}`)
      setIsSubmitting(false)
    }
  }

  function handleCopyCode() {
    if (!createdInviteCode) return
    navigator.clipboard.writeText(createdInviteCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // 방 생성 완료 화면
  if (createdInviteCode && createdProjectId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
            <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-7 h-7 text-green-600" />
            </div>
            <h2 className="text-xl font-black text-gray-900 mb-1">방이 만들어졌어요!</h2>
            <p className="text-sm text-gray-500 mb-6">초대코드를 팀원에게 공유하세요</p>

            <div className="bg-blue-50 rounded-2xl p-5 mb-4">
              <p className="text-xs text-blue-600 font-medium mb-2">초대코드</p>
              <p className="text-3xl font-black text-blue-700 tracking-wide mb-3">{createdInviteCode}</p>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 mx-auto text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? '복사됨!' : '코드 복사'}
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-6">
              팀원이 대시보드에서 "방 참여하기"를 누르고 이 코드를 입력하면 참여할 수 있어요
            </p>

            <button
              onClick={() => router.push(`/projects/${createdProjectId}`)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500 text-white font-bold text-sm hover:bg-blue-600 transition-colors"
            >
              수업설계 시작하기
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <span className="font-bold text-gray-900">새 수업설계 프로젝트</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              프로젝트 제목 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="예) 3-4학년 환경 통합 수업설계"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">설계 방식</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'collaborative', label: '팀 협력 설계', desc: '여러 교사가 함께' },
                { value: 'solo', label: '개인 설계', desc: 'AI와 단독으로' },
              ].map(({ value, label, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value as ProjectMode)}
                  className={cn(
                    'px-4 py-3 rounded-xl border-2 text-left transition-all',
                    mode === value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  )}
                >
                  <div className="font-medium text-sm text-gray-900">{label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">학교급</label>
            <div className="flex gap-2">
              {SCHOOL_LEVELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleSchoolLevelChange(value)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all',
                    schoolLevel === value ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">학년군</label>
            <div className="flex gap-2 flex-wrap">
              {GRADE_GROUPS[schoolLevel].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGradeGroup(value)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all',
                    gradeGroup === value ? 'border-violet-500 bg-violet-500 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              교과
              <span className="text-gray-400 font-normal ml-1">(선택, 나중에 추가 가능)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {SUBJECT_OPTIONS[schoolLevel].map(subject => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => toggleSubject(subject)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm border-2 transition-all',
                    selectedSubjects.includes(subject) ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  )}
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">학기</label>
            <input
              type="text"
              value={semester}
              onChange={e => setSemester(e.target.value)}
              placeholder="2026-1"
              className="w-40 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={!title.trim() || isSubmitting}
              className="w-full py-3.5 rounded-xl bg-blue-500 text-white font-bold text-sm hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />생성 중...</>
              ) : (
                '방 만들기 →'
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

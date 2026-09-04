'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import { createLiveDemoProject, totalDemoTurns } from '@/lib/demo/engine/project'
import {
  parseDemoEngineConfig,
  parseDemoExpandResponse,
  type DemoEngineConfig,
  type DemoLessonSpec,
  type DemoSetupInput,
  type DemoTeacherPersona,
} from '@/lib/demo/engine/types'
import { useProjectStore } from '@/store/project'
import type { GradeGroup, SchoolLevel } from '@/types'
import { cn } from '@/lib/utils'

const SCHOOL_LEVELS: Array<{ value: SchoolLevel; label: string }> = [
  { value: '초등학교', label: '초등학교' },
  { value: '중학교', label: '중학교' },
  { value: '고등학교', label: '고등학교' },
]

const GRADE_GROUPS: Record<SchoolLevel, Array<{ value: GradeGroup; label: string }>> = {
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
  초등학교: ['국어', '수학', '사회', '과학', '영어', '도덕', '음악', '미술', '체육', '실과', '창체', '정보'],
  중학교: ['국어', '수학', '사회', '역사', '도덕', '과학', '기술·가정', '영어', '음악', '미술', '체육', '정보'],
  고등학교: ['국어', '수학', '사회', '과학', '영어', '한국사', '윤리', '정보', '음악', '미술', '체육', '진로'],
}

const PERSONA_PLACEHOLDERS = [
  '예) 과학·수학 담당 9년차. 측정의 타당도와 데이터 해석을 꼼꼼히 봄',
  '예) 국어·과정평가 담당 6년차. 근거 표현과 모든 학생의 참여를 중시함',
  '예) 사회·역사 담당 12년차. 지역 연계 프로젝트와 토론 수업에 강점이 있음',
  '예) 정보 담당 5년차. 에듀테크를 잘 쓰지만 학생의 판단을 AI에 맡기지 않음',
  '예) 특수·학습지원 담당 8년차. 인지부하와 접근성, 개별화 지원을 점검함',
]

type PageStep = 'setup' | 'review'

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '알 수 없는 오류가 발생했습니다.'
}

function lineList(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function commaList(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-bold text-[#5F6368]">{label}</span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[#DADCE0] bg-white px-3.5 py-2.5 text-sm text-[#202124] outline-none transition focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15"
      />
    </label>
  )
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  helper,
  maxLength,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  helper?: string
  maxLength?: number
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-bold text-[#5F6368]">{label}</span>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full resize-y rounded-xl border border-[#DADCE0] bg-white px-3.5 py-2.5 text-sm leading-6 text-[#202124] outline-none transition focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15"
      />
      {helper && <span className="mt-1 block text-[11px] text-[#9AA0A6]">{helper}</span>}
    </label>
  )
}

export default function DemoSetupPage() {
  const router = useRouter()
  const userProfile = useProjectStore((state) => state.userProfile)

  const [step, setStep] = useState<PageStep>('setup')
  const [teacherCount, setTeacherCount] = useState(2)
  const [personaHints, setPersonaHints] = useState<string[]>([
    '과학·수학 관점에서 측정의 타당도와 데이터 해석을 꼼꼼히 보는 교사',
    '사회·국어 관점에서 측우기의 역사적 의미와 학생의 근거 표현을 중시하는 교사',
  ])
  const [lessonHint, setLessonHint] = useState('측우기의 역사와 원리를 이해하고, 학생들이 합성 강우 데이터를 분석해 오늘의 학교생활 문제와 연결하는 데이터 기반 융합 수업')
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>('초등학교')
  const [gradeGroup, setGradeGroup] = useState<GradeGroup>('초5-6')
  const [subjects, setSubjects] = useState<string[]>(['수학', '사회', '과학'])
  const [config, setConfig] = useState<DemoEngineConfig | null>(null)
  const [isExpanding, setIsExpanding] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function changeTeacherCount(nextCount: number) {
    setTeacherCount(nextCount)
    setPersonaHints((previous) =>
      Array.from({ length: nextCount }, (_, index) => previous[index] ?? ''),
    )
  }

  function changeSchoolLevel(nextLevel: SchoolLevel) {
    setSchoolLevel(nextLevel)
    setGradeGroup(GRADE_GROUPS[nextLevel][0].value)
    setSubjects([])
  }

  function toggleSubject(subject: string) {
    if (!subjects.includes(subject) && subjects.length >= 8) {
      setError('융합 교과는 최대 8개까지 선택할 수 있습니다.')
      return
    }
    setSubjects((previous) =>
      previous.includes(subject)
        ? previous.filter((item) => item !== subject)
        : [...previous, subject],
    )
    setError(null)
  }

  function updatePersona(index: number, patch: Partial<DemoTeacherPersona>) {
    setConfig((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        personas: previous.personas.map((persona, personaIndex) =>
          personaIndex === index ? { ...persona, ...patch } : persona,
        ),
      }
    })
  }

  function updateLesson(patch: Partial<DemoLessonSpec>) {
    setConfig((previous) => previous
      ? { ...previous, lesson: { ...previous.lesson, ...patch } }
      : previous)
  }

  function validateSetup(): string | null {
    if (teacherCount < 2 || teacherCount > 5) return '교사 AI 에이전트 수는 2명에서 5명 사이여야 합니다.'
    if (!lessonHint.trim()) return '설계할 수업의 개괄을 입력해 주세요.'
    if (subjects.length === 0) return '융합할 교과를 한 개 이상 선택해 주세요.'
    return null
  }

  async function expandConfig() {
    const validationError = validateSetup()
    if (validationError) {
      setError(validationError)
      return
    }

    const input: DemoSetupInput = {
      teacherCount,
      personaHints: personaHints.map((hint) => hint.trim()).filter(Boolean),
      lessonHint: lessonHint.trim(),
      schoolLevel,
      gradeGroup,
      subjects,
    }

    setIsExpanding(true)
    setError(null)
    try {
      const response = await fetch('/api/demo/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const apiMessage = payload && typeof payload === 'object' && 'error' in payload
          && typeof payload.error === 'string'
          ? payload.error
          : null
        throw new Error(apiMessage || 'AI 자동 완성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      }

      const expanded = parseDemoExpandResponse(payload)
      setConfig(expanded.config)
      setStep('review')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setIsExpanding(false)
    }
  }

  function handleExpand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void expandConfig()
  }

  async function handleCreate() {
    if (!userProfile || !config || isCreating) return
    if (config.personas.length < 2 || config.personas.length > 5) {
      setError('AI 교사 페르소나는 2명에서 5명 사이여야 합니다.')
      return
    }
    if (config.personas.some((persona) => !persona.displayName.trim() || !persona.summary.trim())) {
      setError('각 교사 에이전트의 이름과 페르소나 요약을 확인해 주세요.')
      return
    }
    if (!config.lesson.title.trim() || !config.lesson.overview.trim()) {
      setError('프로젝트 제목과 수업 개괄을 확인해 주세요.')
      return
    }

    setIsCreating(true)
    setError(null)
    try {
      const validatedConfig = parseDemoEngineConfig(config)
      const projectId = await createLiveDemoProject(userProfile, validatedConfig)
      router.push(`/demo/run/${projectId}`)
    } catch (reason) {
      setError(`프로젝트를 만들지 못했습니다. ${errorMessage(reason)}`)
      setIsCreating(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F6F8FC] text-[#202124]">
      <header className="border-b border-[#DADCE0] bg-white px-5 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              aria-label="대시보드로 돌아가기"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[#5F6368] transition-colors hover:bg-[#F1F3F4] hover:text-[#202124] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#7C3AED]">Live agent demo</p>
              <h1 className="truncate text-lg font-extrabold sm:text-xl">교사 에이전트와 협력 수업설계</h1>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs font-bold sm:flex">
            <span className={cn('rounded-full px-3 py-1.5', step === 'setup' ? 'bg-[#7C3AED] text-white' : 'bg-[#E8EAED] text-[#5F6368]')}>1 · 기본 설정</span>
            <span className="text-[#BDC1C6]">→</span>
            <span className={cn('rounded-full px-3 py-1.5', step === 'review' ? 'bg-[#7C3AED] text-white' : 'bg-[#E8EAED] text-[#5F6368]')}>2 · AI 완성 검토</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        {step === 'setup' ? (
          <form onSubmit={handleExpand} className="space-y-6">
            <section className="overflow-hidden rounded-3xl border border-[#E4D7FF] bg-white shadow-sm">
              <div className="border-b border-[#E4D7FF] bg-gradient-to-r from-[#F4EEFF] to-[#FAF8FF] px-6 py-5 sm:px-8">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#7C3AED] text-white shadow-md">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold">함께 설계할 교사팀을 구성하세요</h2>
                    <p className="mt-1 text-sm leading-6 text-[#5F6368]">
                      현재 계정은 프로젝트 소유자·관찰자가 되고, 선택한 AI 교사들이 서로 다른 전문성과 관점으로 실제 협의합니다.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-6 p-6 sm:p-8">
                <fieldset>
                  <legend className="mb-3 text-sm font-extrabold">교사 AI 에이전트 수</legend>
                  <div className="grid grid-cols-4 gap-2 sm:max-w-md">
                    {[2, 3, 4, 5].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => changeTeacherCount(count)}
                        aria-pressed={teacherCount === count}
                        className={cn(
                          'rounded-xl border-2 px-3 py-2.5 text-sm font-extrabold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]',
                          teacherCount === count
                            ? 'border-[#7C3AED] bg-[#7C3AED] text-white shadow-sm'
                            : 'border-[#DADCE0] bg-white text-[#5F6368] hover:border-[#B794F4]',
                        )}
                      >
                        {count}명
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-[#9AA0A6]">선택한 {teacherCount}명의 교사 에이전트와 별도의 총괄 AI가 참여합니다. 비워 둔 페르소나는 AI가 수업에 맞게 채웁니다.</p>
                </fieldset>

                <div className="grid gap-4 md:grid-cols-2">
                  {personaHints.map((hint, index) => (
                    <article key={index} className="rounded-2xl border border-[#E8EAED] bg-[#FBFCFF] p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EDE9FE] text-sm font-black text-[#7C3AED]">{index + 1}</span>
                        <div>
                          <h3 className="text-sm font-extrabold">교사 에이전트 {index + 1}</h3>
                          <p className="text-[11px] text-[#9AA0A6]">교과·경력·강점·중요하게 보는 기준 중 편한 것만 짧게 적으세요.</p>
                        </div>
                      </div>
                      <label htmlFor={`persona-hint-${index}`} className="sr-only">교사 에이전트 {index + 1} 페르소나 힌트</label>
                      <textarea
                        id={`persona-hint-${index}`}
                        rows={3}
                        maxLength={500}
                        value={hint}
                        onChange={(event) => setPersonaHints((previous) => previous.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                        placeholder={PERSONA_PLACEHOLDERS[index]}
                        className="w-full resize-y rounded-xl border border-[#DADCE0] bg-white px-3.5 py-2.5 text-sm leading-6 outline-none transition focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15"
                      />
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[#DADCE0] bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E8F0FE] text-[#1A73E8]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold">수업의 출발점을 알려주세요</h2>
                  <p className="mt-0.5 text-sm text-[#5F6368]">완성된 계획이 아니어도 됩니다. AI가 프로젝트 제목·목표·데이터 계획까지 채웁니다.</p>
                </div>
              </div>

              <div className="space-y-6">
                <fieldset>
                  <legend className="mb-2 text-sm font-extrabold">학교급</legend>
                  <div className="flex flex-wrap gap-2">
                    {SCHOOL_LEVELS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => changeSchoolLevel(value)}
                        aria-pressed={schoolLevel === value}
                        className={cn(
                          'rounded-xl border-2 px-4 py-2 text-sm font-bold transition-all',
                          schoolLevel === value
                            ? 'border-[#1A73E8] bg-[#1A73E8] text-white'
                            : 'border-[#DADCE0] bg-white text-[#5F6368] hover:border-[#AECBFA]',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2 text-sm font-extrabold">학년군</legend>
                  <div className="flex flex-wrap gap-2">
                    {GRADE_GROUPS[schoolLevel].map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setGradeGroup(value)}
                        aria-pressed={gradeGroup === value}
                        className={cn(
                          'rounded-xl border-2 px-4 py-2 text-sm font-bold transition-all',
                          gradeGroup === value
                            ? 'border-[#7C3AED] bg-[#F4EEFF] text-[#6D28D9]'
                            : 'border-[#DADCE0] bg-white text-[#5F6368] hover:border-[#D8B4FE]',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2 text-sm font-extrabold">융합 교과</legend>
                  <div className="flex flex-wrap gap-2">
                    {SUBJECT_OPTIONS[schoolLevel].map((subject) => (
                      <button
                        key={subject}
                        type="button"
                        onClick={() => toggleSubject(subject)}
                        aria-pressed={subjects.includes(subject)}
                        className={cn(
                          'rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-all',
                          subjects.includes(subject)
                            ? 'border-[#00897B] bg-[#00897B] text-white'
                            : 'border-[#DADCE0] bg-white text-[#5F6368] hover:border-[#80CBC4]',
                        )}
                      >
                        {subject}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <TextAreaField
                  id="lesson-hint"
                  label="수업 개괄"
                  rows={5}
                  maxLength={4000}
                  value={lessonHint}
                  onChange={setLessonHint}
                  placeholder="예) 측우기의 역사적 의미를 배우고, 학생들이 직접 강우 데이터를 모아 학교생활 문제를 개선하는 5~6학년 융합 프로젝트 수업"
                  helper="주제, 학생이 하게 될 일, 기대하는 변화, 꼭 지킬 조건 중 알고 있는 만큼만 적어도 됩니다."
                />
              </div>
            </section>

            {error && (
              <div role="alert" className="rounded-2xl border border-[#F4C7C3] bg-[#FCE8E6] px-4 py-3 text-sm font-medium text-[#B3261E]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isExpanding}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] px-5 py-4 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExpanding ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> 교사 페르소나와 수업을 완성하는 중…</>
              ) : (
                <><Sparkles className="h-5 w-5" /> AI로 설정 자동 완성</>
              )}
            </button>
          </form>
        ) : config ? (
          <div className="space-y-6">
            <section className="rounded-3xl border border-[#B7E1CD] bg-gradient-to-r from-[#E6F4EA] to-white p-6 shadow-sm sm:p-8">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-7 w-7 flex-shrink-0 text-[#137333]" />
                <div>
                  <h2 className="text-lg font-extrabold text-[#137333]">AI가 협력팀과 수업 설정을 완성했습니다</h2>
                  <p className="mt-1 text-sm leading-6 text-[#3C4043]">아래 내용을 직접 고친 뒤 실행하세요. 시작하면 현재 교사는 방장이 되고, 교사 에이전트들은 이 페르소나를 유지하며 활동별로 협의합니다.</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[#DADCE0] bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-5 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-[#1A73E8]" />
                <div>
                  <h2 className="text-lg font-extrabold">수업 프로젝트</h2>
                  <p className="text-xs text-[#9AA0A6]">{config.lesson.schoolLevel} · {config.lesson.gradeGroup} · {config.lesson.subjects.join(' · ')}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField id="review-title" label="프로젝트 제목" value={config.lesson.title} onChange={(value) => updateLesson({ title: value })} />
                <TextField id="review-topic" label="핵심 주제" value={config.lesson.topic} onChange={(value) => updateLesson({ topic: value })} />
                <div className="md:col-span-2">
                  <TextAreaField id="review-overview" label="수업 개괄" rows={4} value={config.lesson.overview} onChange={(value) => updateLesson({ overview: value })} />
                </div>
                <label htmlFor="review-sessions" className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#5F6368]">총 차시</span>
                  <input
                    id="review-sessions"
                    type="number"
                    min={1}
                    max={40}
                    value={config.lesson.totalSessions}
                    onChange={(event) => updateLesson({ totalSessions: Math.max(1, Number(event.target.value) || 1) })}
                    className="w-full rounded-xl border border-[#DADCE0] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15"
                  />
                </label>
                <TextField id="review-learner" label="학습자 맥락" value={config.lesson.learnerContext} onChange={(value) => updateLesson({ learnerContext: value })} />
                <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
                  <TextAreaField id="review-goals" label="수업 목표" value={config.lesson.goals.join('\n')} onChange={(value) => updateLesson({ goals: lineList(value) })} helper="목표마다 줄을 바꾸어 입력하세요." />
                  <TextAreaField id="review-constraints" label="제약·가드레일" value={config.lesson.constraints.join('\n')} onChange={(value) => updateLesson({ constraints: lineList(value) })} helper="항목마다 줄을 바꾸어 입력하세요." />
                </div>
                <div className="md:col-span-2">
                  <TextAreaField id="review-data-plan" label="데이터 활용 계획" rows={3} value={config.lesson.dataPlan} onChange={(value) => updateLesson({ dataPlan: value })} />
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[#E4D7FF] bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-5 flex items-center gap-3">
                <Bot className="h-5 w-5 text-[#7C3AED]" />
                <div>
                  <h2 className="text-lg font-extrabold">교사 AI 에이전트 {config.personas.length}명</h2>
                  <p className="text-xs text-[#9AA0A6]">이름·전문성·협업 관점을 수정하면 실제 대화에 반영됩니다.</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {config.personas.map((persona, index) => (
                  <article key={persona.id} className="rounded-2xl border border-[#E8EAED] bg-[#FBFCFF] p-4 sm:p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <input
                        type="color"
                        value={persona.color}
                        onChange={(event) => updatePersona(index, { color: event.target.value })}
                        aria-label={`${persona.displayName} 대표 색상`}
                        className="h-10 w-10 cursor-pointer rounded-full border-0 bg-transparent p-0"
                      />
                      <input
                        value={persona.emoji}
                        onChange={(event) => updatePersona(index, { emoji: event.target.value })}
                        aria-label={`교사 에이전트 ${index + 1} 이모지`}
                        className="w-12 rounded-lg border border-[#DADCE0] bg-white px-2 py-1.5 text-center text-lg outline-none focus:border-[#7C3AED]"
                      />
                      <span className="text-xs font-extrabold text-[#7C3AED]">교사 에이전트 {index + 1}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField id={`persona-name-${index}`} label="이름" value={persona.displayName} onChange={(value) => updatePersona(index, { displayName: value })} />
                      <TextField id={`persona-subject-${index}`} label="담당 교과·영역" value={persona.subject} onChange={(value) => updatePersona(index, { subject: value })} />
                      <TextField id={`persona-career-${index}`} label="경력" value={persona.career} onChange={(value) => updatePersona(index, { career: value })} />
                      <TextField id={`persona-strengths-${index}`} label="강점" value={persona.strengths.join(', ')} onChange={(value) => updatePersona(index, { strengths: commaList(value) })} />
                      <div className="sm:col-span-2">
                        <TextField id={`persona-style-${index}`} label="협업 스타일" value={persona.collaborationStyle} onChange={(value) => updatePersona(index, { collaborationStyle: value })} />
                      </div>
                      <div className="sm:col-span-2">
                        <TextField id={`persona-priority-${index}`} label="수업 설계에서 우선하는 것" value={persona.priority} onChange={(value) => updatePersona(index, { priority: value })} />
                      </div>
                      <div className="sm:col-span-2">
                        <TextAreaField id={`persona-summary-${index}`} label="페르소나 요약" rows={2} value={persona.summary} onChange={(value) => updatePersona(index, { summary: value })} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {error && (
              <div role="alert" className="rounded-2xl border border-[#F4C7C3] bg-[#FCE8E6] px-4 py-3 text-sm font-medium text-[#B3261E]">
                {error}
              </div>
            )}

            <div className="rounded-2xl border border-[#C6DAFC] bg-[#E8F0FE] px-4 py-3 text-xs leading-5 text-[#174EA6]">
              이 설정은 19개 T-CID 활동에서 약 <strong>{totalDemoTurns(config.personas.length)}개의 실제 에이전트 턴</strong>을 실행합니다.
              완료까지 수 분 이상 걸릴 수 있으며, 중간에 멈춰도 완료된 활동은 보존됩니다.
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr]">
              <button
                type="button"
                onClick={() => { setStep('setup'); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={isCreating}
                className="rounded-2xl border-2 border-[#DADCE0] bg-white px-5 py-3.5 text-sm font-bold text-[#5F6368] transition-colors hover:bg-[#F8F9FA] disabled:opacity-50"
              >
                입력 수정
              </button>
              <button
                type="button"
                onClick={() => void expandConfig()}
                disabled={isCreating || isExpanding}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#D8B4FE] bg-[#FAF5FF] px-5 py-3.5 text-sm font-bold text-[#7C3AED] transition-colors hover:bg-[#F3E8FF] disabled:opacity-50"
              >
                {isExpanding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {isExpanding ? '다시 완성하는 중…' : 'AI 다시 완성'}
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || isExpanding || !userProfile}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#137333] px-6 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-green-100 transition-colors hover:bg-[#0D652D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> 프로젝트를 준비하는 중…</>
                ) : (
                  <><Bot className="h-5 w-5" /> 이 설정으로 실제 협력 설계 시작</>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProjects } from '@/lib/firebase/projects'
import { getOrRestoreProfile } from '@/lib/auth'
import { useProjectStore } from '@/store/project'
import type { Project } from '@/types'
import { cn } from '@/lib/utils'
import { Plus, BookOpen, Users, User, ChevronRight, Loader2, LogOut, UserPlus, Crown } from 'lucide-react'

const STAGE_LABELS = { T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가' }
const STAGE_COLORS = {
  T: 'bg-blue-100 text-blue-700',
  A: 'bg-violet-100 text-violet-700',
  Ds: 'bg-emerald-100 text-emerald-700',
  DI: 'bg-orange-100 text-orange-700',
  E: 'bg-rose-100 text-rose-700',
}

function ProjectCard({ project, onClick, isHost }: { project: Project; onClick: () => void; isHost?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {isHost && <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
          <h3 className="font-semibold text-gray-900 text-sm leading-snug group-hover:text-blue-700 transition-colors truncate">
            {project.title}
          </h3>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 flex-shrink-0 mt-0.5 transition-colors" />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', STAGE_COLORS[project.currentStage])}>
          {project.currentStage} · {STAGE_LABELS[project.currentStage]}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {project.targetGradeGroup}
        </span>
        {project.cycleCount > 1 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            주기 {project.cycleCount}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-400">
        <div className="flex items-center gap-3">
          {project.mode === 'collaborative'
            ? <><Users className="w-3 h-3" /> 팀 협력</>
            : <><User className="w-3 h-3" /> 개인</>
          }
          {project.targetSubjects && project.targetSubjects.length > 0 && (
            <><span>·</span><span>{project.targetSubjects.slice(0, 2).join(', ')}</span></>
          )}
        </div>
        {project.inviteCode && (
          <span className="text-blue-500 font-medium">{project.inviteCode}</span>
        )}
      </div>
    </button>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { userProfile, setUserProfile } = useProjectStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!userProfile) return
    setLoading(true)
    setLoadError(false)
    getUserProjects(userProfile.uid)
      .then(setProjects)
      .catch((err) => { console.error('프로젝트 로딩 실패:', err); setLoadError(true); setProjects([]) })
      .finally(() => setLoading(false))
  }, [userProfile?.uid])

  function handleLogout() {
    localStorage.removeItem('tcid_user_profile')
    setUserProfile(null)
    router.replace('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <span className="font-bold text-gray-900">T-CID 협력 수업설계</span>
          </div>
          <div className="flex items-center gap-3">
            {userProfile && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full text-white text-sm font-bold flex items-center justify-center shadow-sm"
                  style={{ backgroundColor: userProfile.color }}
                >
                  {userProfile.emoji}
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-semibold text-gray-800">{userProfile.displayName}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  title="로그아웃"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
            <button
              onClick={() => router.push('/projects/join')}
              className="flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              방 참여하기
            </button>
            <button
              onClick={() => router.push('/projects/new')}
              className="flex items-center gap-1.5 bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              새 프로젝트
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">내 수업설계 프로젝트</h1>
          <p className="text-sm text-gray-500 mt-1">
            T-CID 모델 기반 협력 수업설계 AI 퍼실리테이터
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-red-500">프로젝트를 불러오는 중 오류가 발생했습니다</p>
            <button
              onClick={() => { setLoading(true); getUserProjects(userProfile!.uid).then(setProjects).catch(() => {}).finally(() => setLoading(false)) }}
              className="text-sm text-blue-500 hover:underline"
            >
              다시 시도
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-4">
            <BookOpen className="w-12 h-12 opacity-30" />
            <p className="text-sm">아직 프로젝트가 없습니다</p>
            <button
              onClick={() => router.push('/projects/new')}
              className="flex items-center gap-1.5 bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              첫 프로젝트 시작하기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                isHost={p.hostUid === userProfile?.uid || p.createdBy === userProfile?.uid}
                onClick={() => router.push(`/projects/${p.id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

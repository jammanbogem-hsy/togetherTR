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
const STAGE_CHIP: Record<string, string> = {
  T: 'bg-[#1A73E8] text-white',
  A: 'bg-[#7B1FA2] text-white',
  Ds: 'bg-[#00897B] text-white',
  DI: 'bg-[#E65100] text-white',
  E: 'bg-[#C62828] text-white',
}

// 12가지 보색 조합 × 4가지 코너 위치 변형 — ID 해시로 결정적 배정
type CardTheme = { border: string; shadow: string; cc: string; accent: string; cx1: string; cy1: string; cx2: string; cy2: string; speed: string }
const ALL_CARD_THEMES: CardTheme[] = [
  { border: '#4285F4', shadow: 'rgba(26,115,232,0.18)',   cc: 'rgba(244,143,177,0.38)', accent: '#1A73E8', cx1:'100%', cy1:'0%',   cx2:'0%',   cy2:'100%', speed:'0.65s' }, // 블루+핑크 / 우상+좌하
  { border: '#AB47BC', shadow: 'rgba(123,31,162,0.18)',   cc: 'rgba(255,213,79,0.44)',  accent: '#7B1FA2', cx1:'0%',   cy1:'0%',   cx2:'100%', cy2:'100%', speed:'0.9s'  }, // 퍼플+골드 / 좌상+우하
  { border: '#26A69A', shadow: 'rgba(0,137,123,0.18)',    cc: 'rgba(255,152,0,0.34)',   accent: '#00897B', cx1:'100%', cy1:'0%',   cx2:'100%', cy2:'100%', speed:'0.5s'  }, // 틸+앰버 / 우상+우하
  { border: '#EF6C00', shadow: 'rgba(230,81,0,0.18)',     cc: 'rgba(3,169,244,0.32)',   accent: '#E65100', cx1:'0%',   cy1:'0%',   cx2:'0%',   cy2:'100%', speed:'0.75s' }, // 오렌지+스카이 / 좌상+좌하
  { border: '#E53935', shadow: 'rgba(198,40,40,0.18)',    cc: 'rgba(67,160,71,0.30)',   accent: '#C62828', cx1:'100%', cy1:'0%',   cx2:'0%',   cy2:'100%', speed:'0.6s'  }, // 레드+초록 / 우상+좌하
  { border: '#5C6BC0', shadow: 'rgba(92,107,192,0.18)',   cc: 'rgba(255,138,101,0.36)', accent: '#3949AB', cx1:'0%',   cy1:'0%',   cx2:'100%', cy2:'100%', speed:'0.8s'  }, // 인디고+코랄 / 좌상+우하
  { border: '#2E7D32', shadow: 'rgba(46,125,50,0.18)',    cc: 'rgba(206,147,216,0.38)', accent: '#388E3C', cx1:'100%', cy1:'0%',   cx2:'100%', cy2:'100%', speed:'0.55s' }, // 그린+라벤더 / 우상+우하
  { border: '#F9A825', shadow: 'rgba(249,168,37,0.20)',   cc: 'rgba(66,133,244,0.32)',  accent: '#F57F17', cx1:'0%',   cy1:'0%',   cx2:'0%',   cy2:'100%', speed:'0.7s'  }, // 앰버+블루 / 좌상+좌하
  { border: '#D81B8A', shadow: 'rgba(216,27,138,0.18)',   cc: 'rgba(128,203,196,0.34)', accent: '#AD1457', cx1:'100%', cy1:'0%',   cx2:'0%',   cy2:'100%', speed:'0.85s' }, // 핑크+틸 / 우상+좌하
  { border: '#00ACC1', shadow: 'rgba(0,172,193,0.18)',    cc: 'rgba(171,71,188,0.32)',  accent: '#0097A7', cx1:'0%',   cy1:'0%',   cx2:'100%', cy2:'100%', speed:'0.6s'  }, // 시안+퍼플 / 좌상+우하
  { border: '#7B1FA2', shadow: 'rgba(123,31,162,0.18)',   cc: 'rgba(255,193,7,0.40)',   accent: '#6A1B9A', cx1:'100%', cy1:'0%',   cx2:'100%', cy2:'100%', speed:'0.75s' }, // 딥퍼플+옐로 / 우상+우하
  { border: '#C62828', shadow: 'rgba(198,40,40,0.18)',    cc: 'rgba(0,172,193,0.32)',   accent: '#B71C1C', cx1:'0%',   cy1:'0%',   cx2:'0%',   cy2:'100%', speed:'0.9s'  }, // 딥레드+시안 / 좌상+좌하
]

function pickCardTheme(id: string): CardTheme {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ALL_CARD_THEMES[Math.abs(h) % ALL_CARD_THEMES.length]
}

function ProjectCard({ project, onClick, isHost }: {
  project: Project; onClick: () => void; isHost?: boolean
}) {
  const s = pickCardTheme(project.id ?? project.title ?? 'default')
  return (
    <button
      onClick={onClick}
      className="project-card w-full text-left rounded-2xl p-5 hover:scale-[1.02] transition-transform duration-200 group"
      style={{
        '--cc': s.cc,
        '--cx1': s.cx1, '--cy1': s.cy1,
        '--cx2': s.cx2, '--cy2': s.cy2,
        '--card-speed': s.speed,
        border: `2.5px solid ${s.border}`,
        boxShadow: `0 2px 12px ${s.shadow}`,
      } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {isHost && <Crown className="w-4 h-4 text-amber-500 flex-shrink-0" />}
          <h3 className="font-extrabold text-base leading-snug truncate text-[#202124] group-hover:text-[#202124]">
            {project.title}
          </h3>
        </div>
        <ChevronRight className="w-5 h-5 flex-shrink-0 mt-0.5 transition-colors text-[#9AA0A6]"
          style={{ color: s.accent }} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <span className={cn('text-[12px] px-3 py-1 rounded-full font-bold shadow-sm', STAGE_CHIP[project.currentStage])}>
          {project.currentStage} · {STAGE_LABELS[project.currentStage]}
        </span>
        <span className="text-[12px] px-3 py-1 rounded-full bg-[#F1F3F4] text-[#5F6368] font-semibold">
          {project.targetGradeGroup}
        </span>
        {project.cycleCount > 1 && (
          <span className="text-[12px] px-3 py-1 rounded-full bg-[#E6F4EA] text-[#137333] font-semibold">
            주기 {project.cycleCount}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-[12px] font-medium text-[#5F6368]">
        <div className="flex items-center gap-3">
          {project.mode === 'collaborative'
            ? <><Users className="w-3.5 h-3.5" /> 팀 협력</>
            : <><User className="w-3.5 h-3.5" /> 개인</>
          }
          {project.targetSubjects && project.targetSubjects.length > 0 && (
            <><span>·</span><span>{project.targetSubjects.slice(0, 2).join(', ')}</span></>
          )}
        </div>
        {project.inviteCode && (
          <span className="px-2.5 py-0.5 rounded-full font-bold text-[12px]"
            style={{ backgroundColor: `${s.cc}`, color: s.accent }}>
            {project.inviteCode}
          </span>
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
    <div className="min-h-screen bg-[#F8F9FA]">
      <header className="bg-white border-b border-[#DADCE0] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* 로고 */}
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 flex items-center justify-center bg-[#1A73E8] text-white flex-shrink-0"
              style={{
                animation: 'morph-shape 7s ease-in-out infinite',
                filter: 'drop-shadow(0 4px 14px rgba(26,115,232,0.45))',
              }}
            >
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <span className="font-extrabold text-[#202124] text-[17px] leading-tight block">T-CID 협력 수업설계</span>
              <span className="text-[11px] text-[#9AA0A6] font-medium">AI 퍼실리테이터</span>
            </div>
          </div>

          {/* 우측 버튼 영역 */}
          <div className="flex items-center gap-3">
            {userProfile && (
              <div className="flex items-center gap-2">
                <div
                  className="w-10 h-10 rounded-full text-white text-[15px] font-extrabold flex items-center justify-center shadow-md flex-shrink-0 select-none"
                  style={{ backgroundColor: userProfile.color }}
                >
                  {userProfile.displayName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="hidden sm:block">
                  <p className="text-[13px] font-bold text-[#202124]">{userProfile.displayName}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-[#9AA0A6] hover:text-[#5F6368] transition-colors ml-1"
                  title="로그아웃"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
            <button
              onClick={() => router.push('/projects/join')}
              className="morph-btn flex items-center gap-1.5 bg-white border-2 border-[#DADCE0] text-[#5F6368] text-[13px] font-bold px-4 py-2.5 hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              방 참여하기
            </button>
            <button
              onClick={() => router.push('/projects/new')}
              className="morph-btn flex items-center gap-1.5 bg-[#1A73E8] text-white text-[13px] font-bold px-4 py-2.5 hover:bg-[#1557B0] transition-colors"
              style={{ filter: 'drop-shadow(0 2px 8px rgba(26,115,232,0.35))' }}
            >
              <Plus className="w-4 h-4" />
              새 프로젝트
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#202124]">내 수업설계 프로젝트</h1>
          <p className="text-[14px] text-[#5F6368] mt-1.5 font-medium">
            T-CID 모델 기반 협력 수업설계 AI 퍼실리테이터
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-[#9AA0A6]" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-red-500">프로젝트를 불러오는 중 오류가 발생했습니다</p>
            <button
              onClick={() => { setLoading(true); getUserProjects(userProfile!.uid).then(setProjects).catch(() => {}).finally(() => setLoading(false)) }}
              className="text-sm text-[#1A73E8] hover:underline"
            >
              다시 시도
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#9AA0A6] gap-5">
            <div
              className="w-20 h-20 flex items-center justify-center bg-[#E8F0FE] text-[#1A73E8]"
              style={{ animation: 'morph-shape 9s ease-in-out infinite' }}
            >
              <BookOpen className="w-9 h-9" />
            </div>
            <p className="text-[15px] font-semibold text-[#5F6368]">아직 프로젝트가 없습니다</p>
            <button
              onClick={() => router.push('/projects/new')}
              className="morph-btn flex items-center gap-2 bg-[#1A73E8] text-white text-[14px] font-bold px-6 py-3 hover:bg-[#1557B0] transition-colors"
              style={{ filter: 'drop-shadow(0 2px 8px rgba(26,115,232,0.35))' }}
            >
              <Plus className="w-4 h-4" />
              첫 프로젝트 시작하기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((p, i) => (
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

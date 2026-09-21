'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProjects, deleteProject, getUserFolders, saveUserFolders, getUserHiddenProjects, hideProjectFromDashboard, type DashboardFolder } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import type { Project } from '@/types'
import { cn } from '@/lib/utils'
import { Plus, BookOpen, User, Loader2, LogOut, UserPlus, Crown, Play, FolderPlus, Folder, ArrowLeft, Pencil, Trash2, Network } from 'lucide-react'
import { signOut } from '@/lib/auth'

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

function ProjectCard({ project, onClick, isHost, onDelete, onHide }: {
  project: Project; onClick: () => void; isHost?: boolean; onDelete?: () => void; onHide?: () => void
}) {
  const s = pickCardTheme(project.id ?? project.title ?? 'default')
  const members = Object.values(project.memberInfo ?? {})

  return (
    <div
      className="project-card w-full text-left rounded-2xl hover:scale-[1.02] transition-transform duration-200 group relative flex flex-col cursor-pointer"
      style={{
        '--cc': s.cc,
        '--cx1': s.cx1, '--cy1': s.cy1,
        '--cx2': s.cx2, '--cy2': s.cy2,
        '--card-speed': s.speed,
        border: `2.5px solid ${s.border}`,
        boxShadow: `0 2px 12px ${s.shadow}`,
        aspectRatio: '1 / 1',
      } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 z-[2] rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1A73E8]/25"
        aria-label={`${project.title} 프로젝트 열기`}
      />

      {/* 호스트: 삭제 / 팀원: 대시보드에서 숨김 (호버 시 노출) */}
      {isHost && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full bg-white/80 hover:bg-red-50 border border-gray-200 hover:border-red-300 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all text-gray-400 hover:text-red-500"
          title="프로젝트 삭제"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
        </button>
      )}
      {!isHost && onHide && (
        <button
          onClick={(e) => { e.stopPropagation(); onHide() }}
          className="absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full bg-white/80 hover:bg-gray-100 border border-gray-200 hover:border-gray-400 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all text-gray-400 hover:text-gray-600"
          title="대시보드에서 숨기기"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      )}

      <div className="relative z-[1] flex flex-col flex-1 p-5 text-left">
        {/* 상단: 제목 + 단계 */}
        <div className="flex items-start gap-3 mb-3 pr-8">
          <div className="flex items-center gap-2 min-w-0">
            {isHost && <Crown className="w-4 h-4 text-amber-500 flex-shrink-0" />}
            <h3 className="font-extrabold text-base leading-snug truncate text-[#202124]">
              {project.title}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className={cn('text-[11px] px-2.5 py-0.5 rounded-full font-bold shadow-sm', STAGE_CHIP[project.currentStage])}>
            {project.currentStage} · {STAGE_LABELS[project.currentStage]}
          </span>
          {project.demoExperience && (
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#F3E8FF] text-[#7C3AED] font-bold">DEMO</span>
          )}
          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#F1F3F4] text-[#5F6368] font-semibold">
            {project.targetGradeGroup}
          </span>
        </div>

        {/* 교과 */}
        {project.targetSubjects && project.targetSubjects.length > 0 && (
          <p className="text-[11px] text-[#5F6368] font-medium mb-2 truncate">
            {project.targetSubjects.join(', ')}
          </p>
        )}

        {/* 스페이서 */}
        <div className="flex-1" />

        {/* 하단: 팀원 아바타 + 초대코드 */}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5">
            {members.length > 0 ? (
              <>
                <div className="flex -space-x-2">
                  {members.slice(0, 4).map((m) => (
                    <div
                      key={m.uid}
                      className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: m.color || '#9AA0A6' }}
                      title={m.displayName}
                    >
                      {m.displayName?.[0] || '?'}
                    </div>
                  ))}
                  {members.length > 4 && (
                    <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500 shadow-sm">
                      +{members.length - 4}
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-[#9AA0A6] ml-1">{members.length}명</span>
              </>
            ) : (
              <span className="text-[11px] text-[#9AA0A6] flex items-center gap-1">
                <User className="w-3 h-3" /> 개인
              </span>
            )}
          </div>
          {project.inviteCode && (
            <span className="px-2 py-0.5 rounded-full font-bold text-[10px]"
              style={{ backgroundColor: `${s.cc}`, color: s.accent }}>
              {project.inviteCode}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const FOLDER_COLORS = ['#1A73E8', '#7B1FA2', '#00897B', '#E65100', '#C62828', '#3949AB', '#2E7D32', '#F57F17']

function FolderCard({ folder, projectCount, onOpen, onDrop, onRename, onDelete }: {
  folder: DashboardFolder
  projectCount: number
  onOpen: () => void
  onDrop: (projectId: string) => void
  onRename: () => void
  onDelete: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <div
      className={cn(
        'w-full rounded-2xl transition-all duration-200 group relative flex flex-col cursor-pointer',
        dragOver ? 'scale-105 ring-4' : 'hover:scale-[1.02]'
      )}
      style={{
        aspectRatio: '1 / 1',
        border: `2.5px ${dragOver ? 'dashed' : 'solid'} ${folder.color}`,
        background: dragOver ? `${folder.color}15` : '#FAFBFC',
        ...(dragOver ? { ringColor: folder.color } : {}),
      }}
      onClick={onOpen}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const pid = e.dataTransfer.getData('text/project-id')
        if (pid) onDrop(pid)
      }}
    >
      {/* 액션 버튼 */}
      <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onRename() }} className="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-blue-50 text-gray-400 hover:text-blue-500" title="이름 변경">
          <Pencil className="w-3 h-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500" title="폴더 삭제">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="flex flex-col items-center justify-center flex-1 p-5 gap-3">
        <Folder className="w-16 h-16" style={{ color: folder.color }} strokeWidth={1.5} />
        <div className="text-center">
          <p className="font-bold text-sm text-[#202124] truncate max-w-[160px]">{folder.name}</p>
          <p className="text-[11px] text-[#9AA0A6] mt-0.5">{projectCount}개 프로젝트</p>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { userProfile, setUserProfile } = useProjectStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [hiddenIds, setHiddenIds] = useState<string[]>([])

  // 폴더
  const [folders, setFolders] = useState<DashboardFolder[]>([])
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [folderModal, setFolderModal] = useState<{ mode: 'create' | 'rename'; folder?: DashboardFolder } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0])
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<DashboardFolder | null>(null)
  const folderSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistFolders = useCallback((next: DashboardFolder[]) => {
    setFolders(next)
    if (folderSaveTimeout.current) clearTimeout(folderSaveTimeout.current)
    folderSaveTimeout.current = setTimeout(() => {
      if (userProfile?.uid) saveUserFolders(userProfile.uid, next).catch(console.error)
    }, 500)
  }, [userProfile])

  useEffect(() => {
    if (!userProfile) return
    Promise.all([
      getUserProjects(userProfile.uid),
      getUserFolders(userProfile.uid),
      getUserHiddenProjects(userProfile.uid),
    ])
      .then(([p, f, h]) => { setLoadError(false); setProjects(p); setFolders(f); setHiddenIds(h) })
      .catch((err) => { console.error('프로젝트 로딩 실패:', err); setLoadError(true); setProjects([]) })
      .finally(() => setLoading(false))
  }, [userProfile])

  async function handleLogout() {
    await signOut()
    setUserProfile(null)
    router.replace('/login')
  }

  function handleFolderSubmit() {
    if (!folderName.trim() || !folderModal) return
    if (folderModal.mode === 'create') {
      const newFolder: DashboardFolder = {
        id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: folderName.trim(),
        color: folderColor,
        projectIds: [],
      }
      persistFolders([...folders, newFolder])
    } else if (folderModal.folder) {
      const next = folders.map(f => f.id === folderModal.folder!.id ? { ...f, name: folderName.trim(), color: folderColor } : f)
      persistFolders(next)
    }
    setFolderModal(null)
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      <header className="bg-white border-b border-[#DADCE0] px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
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
              <span className="font-extrabold text-[#202124] text-[17px] leading-tight block">T-CID2.0 협력적 수업설계</span>
              <span className="text-[11px] text-[#9AA0A6] font-medium">AI 퍼실리테이터</span>
            </div>
          </div>

          {/* 우측 버튼 영역 */}
          <div className="flex items-center gap-3">
            {userProfile && (
              <div className="flex items-center gap-2">
                {userProfile.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={userProfile.photoURL}
                    alt=""
                    className="w-10 h-10 rounded-full shadow-md flex-shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full text-white text-[15px] font-extrabold flex items-center justify-center shadow-md flex-shrink-0 select-none"
                    style={{ backgroundColor: userProfile.color }}
                  >
                    {userProfile.displayName?.[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
                <div className="hidden sm:block">
                  <p className="text-[13px] font-bold text-[#202124]">{userProfile.displayName}</p>
                  {userProfile.schoolName && (
                    <p className="text-[11px] text-[#9AA0A6]">
                      {userProfile.schoolLevel && `${userProfile.schoolLevel} · `}{userProfile.schoolName}{userProfile.grade && ` · ${userProfile.grade}`}
                    </p>
                  )}
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
              onClick={() => router.push('/curriculum-map')}
              className="morph-btn flex items-center gap-1.5 bg-white border-2 border-[#DADCE0] text-[#5F6368] text-[13px] font-bold px-4 py-2.5 hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
            >
              <Network className="w-4 h-4" />
              교육과정 분석맵
            </button>
            <button
              onClick={() => router.push('/projects/join')}
              className="morph-btn flex items-center gap-1.5 bg-white border-2 border-[#DADCE0] text-[#5F6368] text-[13px] font-bold px-4 py-2.5 hover:border-[#1A73E8] hover:text-[#1A73E8] transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              방 참여하기
            </button>
            <button
              onClick={() => router.push('/demo')}
              className="morph-btn flex items-center gap-1.5 bg-[#7C3AED] text-white text-[13px] font-bold px-4 py-2.5 hover:bg-[#6D28D9] transition-colors"
              style={{ filter: 'drop-shadow(0 2px 8px rgba(124,58,237,0.32))' }}
            >
              <Play className="w-4 h-4" />
              데모 체험
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

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 헤더 + 폴더 추가 버튼 */}
        <div className="flex items-end justify-between mb-8">
          <div>
            {openFolderId ? (
              <div className="flex items-center gap-3">
                <button onClick={() => setOpenFolderId(null)} className="text-[#5F6368] hover:text-[#202124] transition-colors">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <p className="text-xs text-[#9AA0A6] font-medium">내 수업설계 프로젝트</p>
                  <h1 className="text-2xl font-extrabold text-[#202124] flex items-center gap-2">
                    <Folder className="w-6 h-6" style={{ color: folders.find(f => f.id === openFolderId)?.color }} />
                    {folders.find(f => f.id === openFolderId)?.name ?? '폴더'}
                  </h1>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-extrabold text-[#202124]">내 수업설계 프로젝트</h1>
                <p className="text-[14px] text-[#5F6368] mt-1.5 font-medium">
                  T-CID 모델 기반 협력 수업설계 AI 퍼실리테이터
                </p>
              </>
            )}
          </div>
          {!openFolderId && (
            <button
              onClick={() => { setFolderModal({ mode: 'create' }); setFolderName(''); setFolderColor(FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]) }}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-[#5F6368] hover:text-[#1A73E8] transition-colors px-3 py-2 rounded-xl hover:bg-[#E8F0FE]"
            >
              <FolderPlus className="w-4 h-4" />
              새 폴더
            </button>
          )}
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
        ) : projects.length === 0 && folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#9AA0A6] gap-5">
            <div className="w-20 h-20 flex items-center justify-center bg-[#E8F0FE] text-[#1A73E8]" style={{ animation: 'morph-shape 9s ease-in-out infinite' }}>
              <BookOpen className="w-9 h-9" />
            </div>
            <p className="text-[15px] font-semibold text-[#5F6368]">아직 프로젝트가 없습니다</p>
            <button onClick={() => router.push('/projects/new')} className="morph-btn flex items-center gap-2 bg-[#1A73E8] text-white text-[14px] font-bold px-6 py-3 hover:bg-[#1557B0] transition-colors" style={{ filter: 'drop-shadow(0 2px 8px rgba(26,115,232,0.35))' }}>
              <Plus className="w-4 h-4" /> 첫 프로젝트 시작하기
            </button>
            <button onClick={() => router.push('/demo')} className="morph-btn flex items-center gap-2 bg-[#7C3AED] text-white text-[14px] font-bold px-6 py-3 hover:bg-[#6D28D9] transition-colors" style={{ filter: 'drop-shadow(0 2px 8px rgba(124,58,237,0.32))' }}>
              <Play className="w-4 h-4" /> 데모 체험하기
            </button>
          </div>
        ) : (() => {
          const folderProjectIds = new Set(folders.flatMap(f => f.projectIds))
          const currentFolder = openFolderId ? folders.find(f => f.id === openFolderId) : null
          const hidden = new Set(hiddenIds)
          const notHidden = projects.filter(p => !hidden.has(p.id))
          const visibleProjects = openFolderId
            ? notHidden.filter(p => currentFolder?.projectIds.includes(p.id))
            : notHidden.filter(p => !folderProjectIds.has(p.id))

          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* 폴더 (루트에서만) */}
              {!openFolderId && folders.map(f => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  projectCount={projects.filter(p => f.projectIds.includes(p.id)).length}
                  onOpen={() => setOpenFolderId(f.id)}
                  onDrop={(pid) => {
                    const next = folders.map(fo =>
                      fo.id === f.id
                        ? { ...fo, projectIds: [...new Set([...fo.projectIds, pid])] }
                        : { ...fo, projectIds: fo.projectIds.filter(id => id !== pid) }
                    )
                    persistFolders(next)
                  }}
                  onRename={() => { setFolderModal({ mode: 'rename', folder: f }); setFolderName(f.name); setFolderColor(f.color) }}
                  onDelete={() => setDeleteFolderTarget(f)}
                />
              ))}
              {/* 프로젝트 카드 (드래그 가능) */}
              {visibleProjects.map((p) => {
                const host = p.demoExperience?.scenarioId
                  ? p.hostUid === userProfile?.uid
                  : p.hostUid === userProfile?.uid || p.createdBy === userProfile?.uid
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/project-id', p.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  >
                    <ProjectCard
                      project={p}
                      isHost={host}
                      onClick={() => router.push(`/projects/${p.id}`)}
                      onDelete={host ? () => setDeleteTarget(p) : undefined}
                      onHide={!host ? () => {
                        setHiddenIds(prev => [...prev, p.id])
                        if (userProfile?.uid) hideProjectFromDashboard(userProfile.uid, p.id).catch(console.error)
                      } : undefined}
                    />
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* 폴더 밖으로 드래그: 폴더 열려있을 때 상단에 "폴더에서 꺼내기" 드롭존 */}
        {openFolderId && (
          <div
            className="mt-6 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 py-4 text-center text-sm text-gray-400 font-medium transition-colors"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-red-400', 'bg-red-50', 'text-red-500'); e.currentTarget.classList.remove('border-gray-300', 'bg-gray-50', 'text-gray-400') }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('border-red-400', 'bg-red-50', 'text-red-500'); e.currentTarget.classList.add('border-gray-300', 'bg-gray-50', 'text-gray-400') }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-red-400', 'bg-red-50', 'text-red-500')
              e.currentTarget.classList.add('border-gray-300', 'bg-gray-50', 'text-gray-400')
              const pid = e.dataTransfer.getData('text/project-id')
              if (pid) {
                const next = folders.map(f => f.id === openFolderId ? { ...f, projectIds: f.projectIds.filter(id => id !== pid) } : f)
                persistFolders(next)
              }
            }}
          >
            여기로 드래그하여 폴더에서 꺼내기
          </div>
        )}
      </main>

      {/* 폴더 생성/이름변경 모달 */}
      {folderModal && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4" onClick={() => setFolderModal(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-[#E8EAED] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[#202124] mb-4">
              {folderModal.mode === 'create' ? '새 폴더' : '폴더 이름 변경'}
            </h3>
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="폴더 이름 (예: 행당초등학교)"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1A73E8] mb-4"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && folderName.trim()) { handleFolderSubmit(); } }}
            />
            <div className="flex gap-2 mb-5">
              {FOLDER_COLORS.map(c => (
                <button key={c} onClick={() => setFolderColor(c)} className={cn('w-7 h-7 rounded-full transition-all', folderColor === c ? 'ring-2 ring-offset-2 scale-110' : 'hover:scale-110')} style={{ backgroundColor: c, '--tw-ring-color': c } as React.CSSProperties} />
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setFolderModal(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#5F6368] hover:bg-gray-50 transition-colors">취소</button>
              <button
                onClick={handleFolderSubmit}
                disabled={!folderName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#1A73E8] text-white text-sm font-bold hover:bg-[#1557B0] transition-colors disabled:opacity-40"
              >
                {folderModal.mode === 'create' ? '만들기' : '변경'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 삭제 확인 모달 */}
      {deleteFolderTarget && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4" onClick={() => setDeleteFolderTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-[#E8EAED] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[#202124] mb-2">폴더 삭제</h3>
            <p className="text-sm text-[#5F6368] mb-1">
              <span className="font-bold text-[#202124]">&ldquo;{deleteFolderTarget.name}&rdquo;</span> 폴더를 삭제하시겠습니까?
            </p>
            <p className="text-xs text-[#9AA0A6] mb-5">폴더만 삭제됩니다. 폴더 안의 프로젝트는 미분류로 이동합니다.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteFolderTarget(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#5F6368] hover:bg-gray-50 transition-colors">취소</button>
              <button
                onClick={() => {
                  const next = folders.filter(f => f.id !== deleteFolderTarget.id)
                  persistFolders(next)
                  setDeleteFolderTarget(null)
                  if (openFolderId === deleteFolderTarget.id) setOpenFolderId(null)
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 프로젝트 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-[#E8EAED] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[#202124] mb-2">프로젝트 삭제</h3>
            <p className="text-sm text-[#5F6368] mb-1 leading-relaxed">
              <span className="font-bold text-[#202124]">&ldquo;{deleteTarget.title}&rdquo;</span> 프로젝트를 삭제하시겠습니까?
            </p>
            <p className="text-xs text-red-500 mb-5">이 작업은 되돌릴 수 없으며 모든 채팅과 산출물이 삭제됩니다.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#5F6368] hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteProject(deleteTarget.id)
                    setProjects(prev => prev.filter(p => p.id !== deleteTarget.id))
                    setDeleteTarget(null)
                  } catch (e) {
                    console.error('프로젝트 삭제 실패:', e)
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

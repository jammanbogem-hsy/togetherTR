'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProjects, deleteProject, getUserFolders, saveUserFolders, getUserHiddenProjects, hideProjectFromDashboard, type DashboardFolder } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import type { Project } from '@/types'
import { FOLDER_COLORS, FolderCard, ProjectCard } from '@/components/dashboard/DashboardCards'
import { cn } from '@/lib/utils'
import { MD3Button } from '@/components/ui/MD3Button'
import { Plus, BookOpen, Loader2, LogOut, UserPlus, Play, FolderPlus, Folder, ArrowLeft, Network, X } from 'lucide-react'
import { signOut } from '@/lib/auth'


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
  const foldersRef = useRef<DashboardFolder[]>([])
  const savedFoldersRef = useRef<DashboardFolder[]>([])
  const folderSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const moveNoticeId = useRef(0)
  const [folderNotice, setFolderNotice] = useState<{ kind: 'saving' | 'success' | 'error'; text: string } | null>(null)

  const persistFolders = useCallback((update: DashboardFolder[] | ((current: DashboardFolder[]) => DashboardFolder[])) => {
    const next = typeof update === 'function' ? update(foldersRef.current) : update
    foldersRef.current = next
    setFolders(next)
    // Keep folder edits in order, including a move immediately after a drag/rename.
    const saving = folderSaveQueue.current.then(() => {
      if (!userProfile?.uid) throw new Error('로그인이 필요합니다.')
      return saveUserFolders(userProfile.uid, next)
    })
    folderSaveQueue.current = saving.then(() => {
      savedFoldersRef.current = next
    }, err => {
      console.error('폴더 저장 실패:', err)
      if (foldersRef.current === next) {
        foldersRef.current = savedFoldersRef.current
        setFolders(savedFoldersRef.current)
        setFolderNotice({ kind: 'error', text: '폴더 변경을 저장하지 못했습니다. 이전 위치로 복원했습니다. 다시 시도해 주세요.' })
      }
    })
    return saving
  }, [userProfile])

  function moveProjectToMain(project: Project) {
    const noticeId = ++moveNoticeId.current
    setFolderNotice({ kind: 'saving', text: `‘${project.title}’을 메인 화면으로 이동 중입니다.` })
    void persistFolders(current => current.map(folder => ({ ...folder, projectIds: folder.projectIds.filter(id => id !== project.id) })))
      .then(() => {
        if (moveNoticeId.current === noticeId) setFolderNotice({ kind: 'success', text: `‘${project.title}’을 메인 화면으로 이동했습니다.` })
      })
      .catch(() => { /* persistFolders restores the last confirmed location and reports the error. */ })
  }

  useEffect(() => {
    if (!userProfile) return
    Promise.all([
      getUserProjects(userProfile.uid),
      getUserFolders(userProfile.uid),
      getUserHiddenProjects(userProfile.uid),
    ])
      .then(([p, f, h]) => { setLoadError(false); setProjects(p); foldersRef.current = f; savedFoldersRef.current = f; setFolders(f); setHiddenIds(h) })
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
        <div className="w-full max-w-[1680px] mx-auto flex items-center justify-between">
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

      <main className="w-full max-w-[1680px] mx-auto px-6 lg:px-10 py-8">
        {/* 헤더 + 폴더 추가 버튼 */}
        <div className="flex items-end justify-between mb-8">
          <div>
            {openFolderId ? (
              <div className="flex items-center gap-3">
                <button aria-label="메인 화면으로 돌아가기" onClick={() => setOpenFolderId(null)} className="text-[#5F6368] hover:text-[#202124] transition-colors">
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
          // 빈 상태(MD3): 큰 도형 아이콘 → headline-small 제목 → 설명 → 큰 filled 버튼 하나(데모 체험은 머리말에서)
          <div data-testid="dashboard-empty" className="flex flex-col items-center justify-center px-4 py-20 gap-6 text-center">
            <div className="w-24 h-24 flex items-center justify-center bg-[#D3E3FD] text-[#0842A0]" style={{ animation: 'morph-shape 9s ease-in-out infinite' }}>
              <BookOpen className="w-11 h-11" aria-hidden="true" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <h2 className="text-[28px] leading-9 font-semibold text-[#1F1F1F]">아직 프로젝트가 없습니다</h2>
              <p className="max-w-md text-[16px] leading-6 text-[#444746]">T-CID 다섯 단계에 따라 팀과 함께 수업을 설계해 보세요.</p>
            </div>
            <MD3Button size="md" variant="filled" onClick={() => router.push('/projects/new')}
              icon={<Plus className="w-6 h-6" aria-hidden="true" />} className="px-8 text-[18px] font-semibold">
              첫 프로젝트 시작하기
            </MD3Button>
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
            <div className="grid gap-6 grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
              {/* 폴더 (루트에서만) */}
              {!openFolderId && folders.map(f => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  projectTitles={projects.filter(p => f.projectIds.includes(p.id) && !hidden.has(p.id)).map(p => p.title)}
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
                    className="h-full"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/project-id', p.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  >
                    <ProjectCard
                      project={p}
                      isHost={host}
                      onMoveToMain={openFolderId ? () => moveProjectToMain(p) : undefined}
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

      {folderNotice && <div className="fixed inset-x-4 bottom-4 z-[210] mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-[#303030] px-4 py-3 text-white shadow-lg">
        <p role={folderNotice.kind === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 text-base leading-6">{folderNotice.text}</p>
        {folderNotice.kind === 'success' && openFolderId && <button type="button" onClick={() => setOpenFolderId(null)} className="shrink-0 rounded-lg px-2 py-3 text-sm font-semibold text-[#A8C7FA] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#A8C7FA]">메인 화면 보기</button>}
        <button type="button" aria-label="알림 닫기" onClick={() => setFolderNotice(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10"><X className="h-5 w-5" /></button>
      </div>}

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

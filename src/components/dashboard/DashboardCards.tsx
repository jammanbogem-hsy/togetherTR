'use client'

// 대시보드 카드 — 프로젝트 카드와 폴더 카드.
// 2026-10-02 사용자 피드백: 프로젝트 이름·메타 정보가 잘 안 보이고 글씨가 작다, 마우스를 올리면
// 강조·확대되게 해 달라 → 제목 두 줄·19px, 진행 단계 5칸 막대, 아이콘 메타 줄(14px),
// 초대코드 이름표, 호버 시 떠오름·확대·테마색 그림자·'열기 →', 폴더는 안의 프로젝트 미리보기.

import { useId, useRef, useState } from 'react'
import { ProjectCardMenu } from './ProjectCardMenu'
import type { Project } from '@/types'
import type { DashboardFolder } from '@/lib/firebase/projects'
import { formatGradeBandList } from '@/lib/curriculum/teamGradeBands'
import { cn } from '@/lib/utils'
import { BookOpen, User, Crown, Folder, FolderOpen, Pencil, Trash2, GraduationCap, Clock, EyeOff, MoreHorizontal } from 'lucide-react'

const STAGE_LABELS = { T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가' }

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

const STAGE_ORDER = ['T', 'A', 'Ds', 'DI', 'E'] as const
const STAGE_COLOR: Record<string, string> = { T: '#1A73E8', A: '#7B1FA2', Ds: '#00897B', DI: '#E65100', E: '#C62828' }

/** Firestore Timestamp·숫자·Date 무엇이 와도 ms 로. 없거나 이상하면 null. */
function toMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  const v = value as { toMillis?: () => number; seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  return null
}

/** '방금 · 5분 전 · 3시간 전 · 2일 전 · 9월 20일' */
function formatRelative(ms: number | null): string {
  if (ms === null) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return '방금'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`
  const d = new Date(ms)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

/** 진행 단계 5칸 막대 — 지난 단계는 채우고, 지금 단계는 진하게 + 이름표 */
function StageProgress({ stage }: { stage: string }) {
  const current = Math.max(0, STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]))
  const color = STAGE_COLOR[stage] ?? '#1A73E8'
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-semibold text-[#5F6368]">진행 단계</span>
        <span className="text-[13px] font-bold" style={{ color }}>
          {stage} · {STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? ''}
        </span>
      </div>
      <div className="flex gap-1" aria-label={`진행 단계 ${current + 1}/5`}>
        {STAGE_ORDER.map((code, i) => (
          <div key={code} className="flex-1">
            <div
              className="h-2 rounded-full transition-colors"
              style={{ backgroundColor: i <= current ? color : '#E8EAED', opacity: i < current ? 0.45 : 1 }}
            />
            <span
              className={cn('block text-center text-[11px] mt-1', i === current ? 'font-bold' : 'text-[#9AA0A6]')}
              style={i === current ? { color } : undefined}
            >
              {code}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetaRow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[14px] text-[#3C4043] min-w-0">
      <Icon className="w-4 h-4 flex-shrink-0 text-[#80868B]" />
      <span className="truncate">{children}</span>
    </div>
  )
}

export function ProjectCard({ project, onClick, isHost, onDelete, onHide, onMoveToMain }: {
  project: Project; onClick: () => void; isHost?: boolean; onDelete?: () => void; onHide?: () => void; onMoveToMain?: () => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuId = useId()
  const openerRef = useRef<HTMLElement | null>(null)
  function closeMenu() {
    setMenu(null)
    if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true })
  }
  function openMenu(target: HTMLElement, x?: number, y?: number) {
    openerRef.current = target
    const rect = target.getBoundingClientRect()
    setMenu({ x: x ?? rect.left, y: y ?? rect.bottom + 4 })
  }
  const s = pickCardTheme(project.id ?? project.title ?? 'default')
  const members = Object.values(project.memberInfo ?? {})
  const grade = formatGradeBandList(project.teamGradeBands) || project.targetGradeGroup
  const updated = formatRelative(toMillis(project.updatedAt))

  return (
    <div
      onContextMenu={onMoveToMain ? e => {
        e.preventDefault(); e.stopPropagation()
        const target = (e.target as HTMLElement).closest('button') ?? e.currentTarget.querySelector('button')!
        openMenu(target, e.clientX || undefined, e.clientY || undefined)
      } : undefined}
      onKeyDown={onMoveToMain ? e => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault(); e.stopPropagation(); openMenu(e.target as HTMLElement)
        }
      } : undefined}
      className="project-card w-full min-h-[320px] sm:min-h-0 sm:aspect-square text-left overflow-hidden rounded-2xl group relative flex flex-col cursor-pointer transition-[transform,box-shadow,border-width] duration-200 ease-out motion-safe:hover:-translate-y-1.5 motion-safe:hover:scale-[1.035] hover:z-10 focus-within:z-10"
      style={{
        '--cc': s.cc,
        '--cx1': s.cx1, '--cy1': s.cy1,
        '--cx2': s.cx2, '--cy2': s.cy2,
        '--card-speed': s.speed,
        '--card-shadow': s.shadow,
        '--card-border': s.border,
        border: `2.5px solid ${s.border}`,
      } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 z-[2] rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1A73E8]/30"
        aria-label={`${project.title} 프로젝트 열기`}
      />

      {onMoveToMain && <>
        <button
          type="button"
          aria-label={`${project.title} 프로젝트 메뉴`}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-controls={menu ? menuId : undefined}
          title="프로젝트 메뉴"
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-[#C4C7C5] bg-[#F0F4F9] text-[#444746] hover:bg-[#D3E3FD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
          onClick={e => { e.stopPropagation(); if (menu) closeMenu(); else openMenu(e.currentTarget) }}
          onDragStart={e => { e.preventDefault(); e.stopPropagation() }}
        ><MoreHorizontal className="h-5 w-5" aria-hidden="true" /></button>
        {menu && <ProjectCardMenu id={menuId} title={project.title} {...menu} onClose={closeMenu} onMoveToMain={onMoveToMain} onDelete={isHost ? onDelete : undefined} onHide={!isHost ? onHide : undefined} />}
      </>}

      {/* 호스트: 삭제 / 팀원: 대시보드에서 숨김 (호버 시 노출) */}
      {!onMoveToMain && isHost && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-red-50 border border-gray-200 hover:border-red-300 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all text-gray-400 hover:text-red-500"
          title="프로젝트 삭제"
          aria-label={`${project.title} 프로젝트 삭제`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      {!onMoveToMain && !isHost && onHide && (
        <button
          onClick={(e) => { e.stopPropagation(); onHide() }}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-gray-100 border border-gray-200 hover:border-gray-400 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all text-gray-400 hover:text-gray-600"
          title="대시보드에서 숨기기"
          aria-label={`${project.title} 대시보드에서 숨기기`}
        >
          <EyeOff className="w-4 h-4" />
        </button>
      )}

      <div className="relative z-[1] flex flex-col flex-1 p-4 gap-2.5 sm:p-5 sm:gap-3 text-left">
        {/* 제목 — 두 줄까지 그대로 보인다 */}
        <div className="pr-9">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            {isHost && (
              <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                <Crown className="w-3.5 h-3.5" /> 기록
              </span>
            )}
            {project.demoExperience && (
              <span className="text-[12px] px-2 py-0.5 rounded-full bg-[#F3E8FF] text-[#7C3AED] font-bold">체험용 데모</span>
            )}
          </div>
          <h3
            className="font-extrabold text-[19px] leading-snug text-[#202124] break-keep line-clamp-2 transition-colors"
            title={project.title}
          >
            {project.title}
          </h3>
        </div>

        <StageProgress stage={project.currentStage} />

        {/* 메타 정보 */}
        <div className="flex flex-col gap-1.5">
          {grade && <MetaRow icon={GraduationCap}>{grade}</MetaRow>}
          <MetaRow icon={BookOpen}>
            {project.targetSubjects && project.targetSubjects.length > 0
              ? project.targetSubjects.join(' · ')
              : <span className="text-[#9AA0A6]">교과 미정</span>}
          </MetaRow>
          {updated && <MetaRow icon={Clock}>최근 수정 {updated}</MetaRow>}
        </div>

        <div className="flex-1" />

        {/* 하단: 팀원 + 초대코드 */}
        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            {members.length > 0 ? (
              <>
                <div className="flex -space-x-2">
                  {members.slice(0, 3).map((m) => (
                    <div
                      key={m.uid}
                      className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-[12px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: m.color || '#9AA0A6' }}
                      title={m.displayName}
                    >
                      {m.displayName?.[0] || '?'}
                    </div>
                  ))}
                  {members.length > 3 && (
                    <div className="w-8 h-8 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-[12px] font-bold text-gray-600 shadow-sm">
                      +{members.length - 3}
                    </div>
                  )}
                </div>
                <span className="text-[13px] font-semibold text-[#5F6368] whitespace-nowrap">팀원 {members.length}명</span>
              </>
            ) : (
              <span className="text-[13px] font-semibold text-[#5F6368] flex items-center gap-1">
                <User className="w-4 h-4" /> 개인
              </span>
            )}
          </div>
          {project.inviteCode && (
            <span className="flex flex-col items-end leading-tight min-w-0 flex-shrink" title={`초대코드 ${project.inviteCode} — 팀원이 '방 참여하기'에 입력하는 코드`}>
              <span className="text-[11px] text-[#80868B] font-medium">초대코드</span>
              <span className="px-2 py-0.5 rounded-md font-bold text-[13px] tracking-wide whitespace-nowrap max-w-full truncate" style={{ backgroundColor: s.cc, color: s.accent }}>
                {project.inviteCode}
              </span>
            </span>
          )}
        </div>

        {/* 호버 시 '열기' 안내 */}
        <span
          className="pointer-events-none absolute bottom-[68px] right-5 text-[13px] font-bold opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
          style={{ color: s.accent }}
          aria-hidden
        >
          열기 →
        </span>
      </div>
    </div>
  )
}

export const FOLDER_COLORS = ['#1A73E8', '#7B1FA2', '#00897B', '#E65100', '#C62828', '#3949AB', '#2E7D32', '#F57F17']

export function FolderCard({ folder, projectTitles, onOpen, onDrop, onRename, onDelete }: {
  folder: DashboardFolder
  /** 폴더 안 프로젝트 제목(미리보기) */
  projectTitles: string[]
  onOpen: () => void
  onDrop: (projectId: string) => void
  onRename: () => void
  onDelete: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const count = projectTitles.length
  return (
    <div
      className={cn(
        'folder-card w-full min-h-[320px] sm:min-h-0 sm:aspect-square rounded-2xl overflow-hidden group relative flex flex-col cursor-pointer transition-[transform,box-shadow,background-color] duration-200 ease-out',
        dragOver ? 'scale-105 z-10' : 'motion-safe:hover:-translate-y-1.5 motion-safe:hover:scale-[1.035] hover:z-10',
      )}
      style={{
        border: `2.5px ${dragOver ? 'dashed' : 'solid'} ${folder.color}`,
        background: dragOver ? `${folder.color}1F` : `linear-gradient(180deg, ${folder.color}0F 0%, #FFFFFF 55%)`,
        '--card-shadow': `${folder.color}40`,
      } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${folder.name} 폴더 열기, 프로젝트 ${count}개`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
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
      <div className="absolute top-3 right-3 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onRename() }} className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-blue-50 text-gray-500 hover:text-blue-600" title="이름 변경" aria-label={`${folder.name} 이름 변경`}>
          <Pencil className="w-4 h-4" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-red-50 text-gray-500 hover:text-red-600" title="폴더 삭제" aria-label={`${folder.name} 폴더 삭제`}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col flex-1 p-5 gap-3">
        <div className="flex items-center gap-3 pr-16">
          <span className="relative w-14 h-14 flex-shrink-0">
            <Folder className="absolute inset-0 w-14 h-14 transition-opacity duration-200 group-hover:opacity-0" style={{ color: folder.color }} strokeWidth={1.6} />
            <FolderOpen className="absolute inset-0 w-14 h-14 opacity-0 transition-opacity duration-200 group-hover:opacity-100" style={{ color: folder.color }} strokeWidth={1.6} />
          </span>
          <div className="min-w-0">
            <p className="font-extrabold text-[19px] leading-snug text-[#202124] break-keep line-clamp-2" title={folder.name}>{folder.name}</p>
            <p className="text-[14px] font-semibold mt-0.5" style={{ color: folder.color }}>프로젝트 {count}개</p>
          </div>
        </div>

        {/* 안에 든 프로젝트 미리보기 */}
        <ul className="flex flex-col gap-1.5 mt-1">
          {projectTitles.slice(0, 4).map((title, i) => (
            <li key={`${title}-${i}`} className="flex items-center gap-2 text-[14px] text-[#3C4043] rounded-lg bg-white/80 border border-gray-100 px-2.5 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: folder.color }} />
              <span className="truncate">{title}</span>
            </li>
          ))}
          {count > 4 && <li className="text-[13px] text-[#80868B] pl-1">외 {count - 4}개</li>}
          {count === 0 && <li className="text-[13px] text-[#9AA0A6]">비어 있음 — 프로젝트 카드를 끌어다 넣으세요</li>}
        </ul>

        <div className="flex-1" />
        <span className="self-end text-[13px] font-bold opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" style={{ color: folder.color }} aria-hidden>
          폴더 열기 →
        </span>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Users, MessageSquare, RefreshCw, ArrowRight, Search } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { adminRead, adminButton, adminDate } from '@/components/admin/adminClient'
import type { AdminMember, AdminProject, AdminPage } from '@/lib/admin/consoleModel'
import { STAGES, displayActivityCode, type ActivityCode } from '@/types'

export default function AdminConsolePage() { return <AdminShell><Console /></AdminShell> }

function Console() {
  const [view, setView] = useState<'projects' | 'members'>('projects')
  return <>
    <nav aria-label="관리자 메뉴" className="mb-6 flex flex-wrap gap-2">
      <button type="button" aria-pressed={view === 'projects'} onClick={() => setView('projects')} className={`${adminButton} ${view === 'projects' ? '' : '!bg-white border border-[#C4C7C5]'}`}><FolderOpen size={18} /> 전체 프로젝트</button>
      <button type="button" aria-pressed={view === 'members'} onClick={() => setView('members')} className={`${adminButton} ${view === 'members' ? '' : '!bg-white border border-[#C4C7C5]'}`}><Users size={18} /> 회원 목록</button>
      <Link href="/feedback" className={`${adminButton} !bg-white border border-[#C4C7C5]`}><MessageSquare size={18} /> 피드백함</Link>
    </nav>
    <Directory key={view} view={view} />
  </>
}

function Directory({ view }: { view: 'projects' | 'members' }) {
  const [items, setItems] = useState<Array<AdminProject | AdminMember>>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const controller = useRef<AbortController | null>(null)
  const lastCursor = useRef('')
  const load = useCallback(async (cursor = '') => {
    lastCursor.current = cursor
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setBusy(true); setError('')
    try {
      const page = await adminRead<AdminPage<AdminProject | AdminMember>>({ view, ...(cursor ? { cursor } : {}) }, request.signal)
      if (request.signal.aborted) return
      setItems(current => {
        const all = cursor ? [...current, ...page.items] : page.items
        return [...new Map(all.map(item => ['id' in item ? item.id : item.uid, item])).values()]
      })
      setNextCursor(page.nextCursor)
      if (page.total !== undefined) setTotal(page.total)
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : '불러오지 못했습니다.') }
    finally { if (!request.signal.aborted) setBusy(false) }
  }, [view])
  useEffect(() => { void load(); return () => controller.current?.abort() }, [load])
  const needle = query.trim().toLocaleLowerCase()
  const shown = items.filter(item => ('id' in item ? [item.title, item.ownerName, item.ownerUid, item.schoolLevel, ...item.gradeBands, ...item.subjects] : [item.name, item.email, item.school, item.grade]).join(' ').toLocaleLowerCase().includes(needle))
  return <section aria-label={view === 'projects' ? '전체 프로젝트 목록' : '전체 회원 목록'}>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h2 className="flex-1 text-xl font-bold">{view === 'projects' ? '전체 프로젝트' : '회원 목록'}</h2>
      <button type="button" disabled={busy} onClick={() => { void load() }} className={adminButton}><RefreshCw size={16} /> 새로고침</button>
    </div>
    <label className="mb-3 flex min-h-12 items-center gap-3 rounded-2xl border border-[#747775] bg-white px-4">
      <Search size={20} className="shrink-0 text-[#444746]" />
      <input aria-label={view === 'projects' ? '프로젝트 검색' : '회원 검색'} value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'projects' ? '프로젝트명 · 개설자 · 학년군 · 교과 검색' : '이름 · 이메일 · 학교 · 학년 검색'} className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none" />
    </label>
    <p role="status" className="mb-4 text-sm text-[#444746]">{busy ? '불러오는 중…' : `${items.length.toLocaleString()}${view === 'projects' ? '개' : '명'} 불러옴${total !== undefined ? ` / 전체 ${total.toLocaleString()}개` : ''}${needle ? ` · 검색 결과 ${shown.length}건` : ''}`}{nextCursor && ' · 검색은 불러온 목록에 적용됩니다.'}</p>
    {error && <p role="alert" className="mb-4 rounded-xl bg-[#F9DEDC] p-4 text-[#8C1D18]">{error} <button type="button" disabled={busy} onClick={() => { void load(lastCursor.current) }} className="min-h-11 px-3 font-bold underline">다시 시도</button></p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {shown.map(item => 'id' in item ? <ProjectCard key={item.id} item={item} /> : <MemberCard key={item.uid} item={item} />)}
    </div>
    {!busy && !error && !shown.length && <p className="rounded-2xl bg-white p-8 text-center text-[#444746]">{needle ? '검색 결과가 없습니다.' : view === 'projects' ? '개설된 프로젝트가 없습니다.' : '등록된 회원이 없습니다.'}</p>}
    {nextCursor && <button type="button" disabled={busy} onClick={() => { void load(nextCursor) }} className={`${adminButton} mx-auto mt-6 flex`}>{view === 'projects' ? '프로젝트 더 보기' : '회원 더 보기'}</button>}
  </section>
}

function ProjectCard({ item }: { item: AdminProject }) {
  const stage = STAGES.find(stage => stage.code === item.stage)?.label || item.stage
  return <Link href={`/admin/projects/${encodeURIComponent(item.id)}`} className="flex min-w-0 flex-col rounded-[24px] border border-[#C4C7C5] bg-white p-5 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-[#0B57D0]">
    <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold text-[#0842A0]"><span className="rounded-full bg-[#D3E3FD] px-3 py-1">{stage || '시작 전'}</span><span className="rounded-full bg-[#F1F4F9] px-3 py-1">{item.training ? '연수용' : '일반'} · {item.cycle}주기</span></div>
    <h3 className="break-words text-lg font-bold">{item.title}</h3>
    <p className="mt-3 text-sm text-[#444746]">개설자 {item.ownerName || '이름 미등록'} · 참여 {item.memberCount}명</p>
    <p className="mt-1 text-sm text-[#444746]">{[item.schoolLevel, item.gradeBands.join(' · '), item.subjects.join(' · ')].filter(Boolean).join(' / ') || '수업 정보 미입력'}</p>
    <p className="mt-1 text-sm text-[#444746]">{item.activity ? `현재 ${displayActivityCode(item.activity as ActivityCode)} · ` : ''}{item.status === 'completed' ? '완료' : item.status === 'archived' ? '보관됨' : '진행 중'}</p>
    <p className="mt-4 text-xs text-[#444746]">최근 수정 {adminDate(item.updatedAt)}</p>
    <span className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#0842A0]">프로젝트 살펴보기 <ArrowRight size={16} /></span>
  </Link>
}

function MemberCard({ item }: { item: AdminMember }) {
  return <article className="min-w-0 rounded-[24px] border border-[#C4C7C5] bg-white p-5">
    <h3 className="break-words text-lg font-bold">{item.name}</h3><p className="mt-1 break-all text-sm text-[#444746]">{item.email || '이메일 없음'}</p>
    <p className="mt-3 text-sm text-[#444746]">{[item.schoolLevel, item.school, item.grade].filter(Boolean).join(' · ') || '교사 프로필 미입력'}</p>
    <dl className="mt-4 space-y-1 text-xs text-[#444746]"><div><dt className="inline">가입 </dt><dd className="inline">{adminDate(item.createdAt)}</dd></div><div><dt className="inline">최근 로그인 </dt><dd className="inline">{adminDate(item.lastSignInAt)}</dd></div></dl>
    <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-[#E3E3E3] px-3 py-1">{item.disabled ? '사용 중지' : '사용 가능'}</span><span className="rounded-full bg-[#E9F0FF] px-3 py-1">{item.verified ? '이메일 인증됨' : '이메일 미인증'}</span>{!item.hasProfile && <span className="rounded-full bg-[#FFF1C2] px-3 py-1">프로필 미완성</span>}</div>
  </article>
}

'use client'

import Link from 'next/link'
import { use, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Eye, RefreshCw } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { adminRead, adminButton, adminDate } from '@/components/admin/adminClient'
import { ArtifactMarkdown } from '@/components/artifacts/ArtifactMarkdown'
import { ReportMarkdown } from '@/components/modals/ReportMarkdown'
import { STAGES, ACTIVITY_META, displayActivityCode, type ActivityCode, type StageCode } from '@/types'
import { mergeAdminMessages, type AdminMessage, type AdminMessagePage, type AdminProjectDetail } from '@/lib/admin/consoleModel'

export default function AdminProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <AdminShell><ProjectDetail key={id} id={id} /></AdminShell>
}

function ProjectDetail({ id }: { id: string }) {
  const [project, setProject] = useState<AdminProjectDetail | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    adminRead<AdminProjectDetail>({ view: 'project', id }, controller.signal).then(value => {
      if (!controller.signal.aborted) { setProject(value); setError('') }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '프로젝트를 불러오지 못했습니다.') })
    return () => controller.abort()
  }, [id, revision])
  return <>
    <div className="flex flex-wrap gap-2">
      <Link href="/admin" className={adminButton}><ArrowLeft size={16} /> 전체 프로젝트</Link>
      {/* Opens the team's real project screen in read-only observer mode. */}
      <Link href={`/projects/${encodeURIComponent(id)}`} className={adminButton}><Eye size={16} /> 실제 화면 보기</Link>
    </div>
    {error && <p role="alert" className="my-5 rounded-2xl bg-[#F9DEDC] p-4 text-[#8C1D18]">{error} <button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-11 px-3 font-bold underline">다시 시도</button></p>}
    {!project && !error && <p role="status" className="mt-5">프로젝트를 불러오는 중…</p>}
    {project && <ProjectContent project={project} />}
  </>
}

function ProjectContent({ project }: { project: AdminProjectDetail }) {
  const [activity, setActivity] = useState<ActivityCode>(Object.hasOwn(ACTIVITY_META, project.activity) ? project.activity as ActivityCode : 'T-1-1')
  const [cycle, setCycle] = useState(project.cycle)
  const artifact = project.artifacts[activity]
  return <>
    <section className="my-5 rounded-[28px] border border-[#C4C7C5] bg-white p-5 sm:p-7">
      <h2 className="break-words text-2xl font-bold">{project.title}</h2>
      <p className="mt-2 text-base text-[#444746]">{[project.schoolLevel, project.gradeBands.join(' · '), project.subjects.join(' · ')].filter(Boolean).join(' / ')}</p>
      <p className="mt-2 text-sm text-[#444746]">{project.training ? '연수용 모드' : '일반 모드'} · {project.cycle}주기 · 최근 수정 {adminDate(project.updatedAt)}</p>
      <h3 className="mt-5 font-bold">참여자 {project.members.length}명</h3>
      <ul className="mt-2 flex flex-wrap gap-2">{project.members.map(member => <li key={member.uid} className="rounded-xl bg-[#F1F4F9] px-3 py-2 text-sm">{member.name} <span className="text-[#444746]">· {member.role}</span></li>)}</ul>
    </section>
    <section aria-label="활동별 내용" className="rounded-[28px] border border-[#C4C7C5] bg-white p-5 sm:p-7">
      <h2 className="text-xl font-bold">활동별 산출물과 대화</h2>
      <label className="mt-4 block text-sm font-semibold">활동 선택<select value={activity} onChange={event => setActivity(event.target.value as ActivityCode)} className="mt-2 block min-h-12 w-full rounded-xl border border-[#747775] bg-white px-3 text-base">
        {STAGES.map(stage => <optgroup key={stage.code} label={stage.label}>{stage.activities.map(code => <option key={code} value={code}>{displayActivityCode(code)} {ACTIVITY_META[code].label}</option>)}</optgroup>)}
      </select></label>
      <h3 className="mt-6 text-lg font-bold">저장된 산출물</h3>
      {artifact ? <div className="mt-3 rounded-2xl bg-[#F8FAFD] p-4"><p className="mb-3 text-sm font-semibold text-[#444746]">{artifact.title || ACTIVITY_META[activity].label} · {artifact.status === 'confirmed' ? '확정' : '작성 중'}</p><ReadValue value={artifact.content} /></div> : <p className="mt-3 text-[#444746]">저장된 산출물이 없습니다.</p>}
      <div className="mt-8 flex flex-wrap items-end gap-3"><h3 className="flex-1 text-lg font-bold">활동 대화</h3>
        <label className="text-sm font-semibold">대화 주기<select value={cycle} onChange={event => setCycle(Number(event.target.value))} className="ml-2 min-h-11 rounded-xl border border-[#747775] bg-white px-3 text-base">{Array.from({ length: project.cycle }, (_, i) => <option key={i} value={i + 1}>{i + 1}주기</option>)}</select></label>
      </div>
      <Messages key={`${activity}:${cycle}`} projectId={project.id} activity={activity} cycle={cycle} />
    </section>
    <section aria-label="저장된 보고서" className="mt-6 min-w-0 rounded-[28px] border border-[#C4C7C5] bg-white p-5 sm:p-7">
      <h2 className="text-xl font-bold">저장된 보고서</h2>
      {!project.reports.length && <p className="mt-3 text-[#444746]">저장된 보고서가 없습니다.</p>}
      {project.reports.map(report => <details key={report.key} className="mt-4 min-w-0 rounded-2xl border border-[#C4C7C5] p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">{report.title}</summary><ReportMarkdown content={report.content} stage={STAGES.some(stage => stage.code === report.key) ? report.key as StageCode : undefined} /></details>)}
    </section>
  </>
}

function ReadValue({ value }: { value: unknown }) {
  if (typeof value === 'string') return <ArtifactMarkdown>{value || '—'}</ArtifactMarkdown>
  if (value === null || value === undefined) return <span>—</span>
  if (Array.isArray(value)) return <ul className="space-y-3">{value.map((item, index) => <li key={index} className="rounded-xl border border-[#DADCE0] bg-white p-3"><ReadValue value={item} /></li>)}</ul>
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length ? <dl className="space-y-4">{entries.map(([key, item]) => <div key={key} className="min-w-0"><dt className="mb-1 break-words font-semibold text-[#0842A0]">{key}</dt><dd className="min-w-0"><ReadValue value={item} /></dd></div>)}</dl> : <p className="text-[#444746]">내용이 없습니다.</p>
  }
  return <span>{String(value)}</span>
}

function Messages({ projectId, activity, cycle }: { projectId: string; activity: ActivityCode; cycle: number }) {
  const [items, setItems] = useState<AdminMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const lastCursor = useRef('')
  const load = async (position = '') => {
    lastCursor.current = position
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setBusy(true); setError('')
    try {
      const page = await adminRead<AdminMessagePage>({ view: 'messages', id: projectId, activity, cycle: String(cycle), ...(position ? { cursor: position } : {}) }, request.signal)
      if (request.signal.aborted) return
      setItems(current => mergeAdminMessages(position ? current : [], page.items)); setCursor(page.nextCursor)
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : '대화를 불러오지 못했습니다.') }
    finally { if (!request.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    void load()
    return () => controller.current?.abort()
    // The parent remounts this component when activity or cycle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="mt-4">
    <button type="button" disabled={busy} onClick={() => { void load() }} className={adminButton}><RefreshCw size={16} /> 대화 새로고침</button>
    <p role="status" className="my-3 text-sm text-[#444746]">{busy ? '대화를 불러오는 중…' : `${items.length}개 메시지`}{cursor && ' · 더 보기를 누르면 다음 대화 기록을 확인할 수 있습니다.'}</p>
    {error && <p role="alert" className="mb-3 text-[#8C1D18]">{error} <button type="button" disabled={busy} onClick={() => { void load(lastCursor.current) }} className="min-h-11 px-3 font-bold underline">다시 시도</button></p>}
    {!busy && !error && !items.length && <p className="text-[#444746]">{cursor ? '이 구간에는 해당 활동의 대화가 없습니다. 다음 기록을 확인해 주세요.' : '이 주기에 저장된 대화가 없습니다.'}</p>}
    <ol aria-label="저장된 대화" className="space-y-4">{items.map(item => <li key={item.id} className={`min-w-0 rounded-2xl p-4 ${item.role === 'user' ? 'bg-[#E9F0FF]' : 'border border-[#DADCE0] bg-[#F8FAFD]'}`}>
      <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-sm"><strong className="break-words">{item.role === 'assistant' ? 'AI 공동설계자' : item.role === 'system' ? '시스템' : item.name || '이름 미등록'}</strong><span className="text-[#444746]">{adminDate(item.createdAt)}</span></p>
      <ArtifactMarkdown>{item.content}</ArtifactMarkdown>
    </li>)}</ol>
    {cursor && <button type="button" disabled={busy} onClick={() => { void load(cursor) }} className={`${adminButton} mt-4`}>대화 더 보기</button>}
  </div>
}

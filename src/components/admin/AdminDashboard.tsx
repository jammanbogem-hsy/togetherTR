'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, Eye, FileText, FolderOpen, GraduationCap, Megaphone, MessagesSquare, RefreshCw, ThumbsUp, Users } from 'lucide-react'
import { adminButton, adminDate, adminFetch, openNoticeComposer } from './adminClient'
import { ALL_ACTIVITIES, isSoloRow, type DashboardData, type DashboardProject } from '@/lib/admin/dashboardModel'
import { SOLO_HIDDEN_ACTIVITIES, STAGES, displayActivityCode, type StageCode } from '@/types'
import { STAGE_COLOR } from '@/lib/ui/stageColors'

const REFRESH_MS = 60_000

export function AdminDashboard() {
  const [data, setData] = useState<(DashboardData & { truncated?: boolean }) | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [auto, setAuto] = useState(true)
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try { setData(await adminFetch<DashboardData>('/api/admin/dashboard')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '현황을 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!auto) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [auto, load])

  return <section aria-label="전체 현황" className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="flex-1 text-xl font-bold">전체 현황</h2>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#444746]">
        <input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} className="size-4 accent-[#0B57D0]" />1분마다 자동 새로고침</label>
      <button type="button" disabled={busy} onClick={() => { void load() }} className={adminButton}><RefreshCw size={16} /> 새로고침</button>
    </div>
    <p role="status" className="text-sm text-[#444746]">{busy ? '불러오는 중…' : data ? `${adminDate(data.generatedAt)} 기준${data.truncated ? ' · 프로젝트가 많아 최근 500개만 집계했습니다' : ''}` : ''}</p>
    {error && <p role="alert" className="rounded-2xl bg-[#F9DEDC] p-4 text-[#8C1D18]">{error}</p>}
    {data && <>
      <StatCards data={data} />
      <StageBar counts={data.stageCounts} total={data.totals.projects} />
      <Attention data={data} />
      <ProgressTable rows={data.projects} now={data.generatedAt} />
    </>}
  </section>
}

function StatCards({ data }: { data: DashboardData }) {
  const t = data.totals
  const cards = [
    { icon: FolderOpen, label: '전체 방', value: t.projects, sub: `협력 ${t.collaborative} · 개인 ${t.solo}` },
    { icon: GraduationCap, label: '연수용 방', value: t.training, sub: '연수용 모드 켠 방' },
    { icon: Activity, label: '지금 활동 중', value: t.activeHour, sub: `오늘 ${t.activeDay} · 이번 주 ${t.activeWeek}` },
    { icon: Users, label: '회원', value: t.members, sub: '가입한 선생님' },
    { icon: MessagesSquare, label: '전체 대화', value: t.messages, sub: '모든 방의 메시지 수' },
    { icon: FileText, label: '산출물 · 보고서', value: t.artifacts, sub: `단계 보고서 ${t.reports}개 · 테스트 보고서 ${t.lessonSheets}개` },
    { icon: ThumbsUp, label: '보고서 형식 선호', value: t.reportVotes.stage + t.reportVotes.sheet, sub: `기본 보고서 ${t.reportVotes.stage} · 테스트 보고서 ${t.reportVotes.sheet}` },
  ]
  return <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">{cards.map(card => <li key={card.label} className="rounded-[24px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
    <card.icon size={20} className="text-[#0842A0]" aria-hidden="true" />
    <p className="mt-2 text-sm font-semibold text-[#444746]">{card.label}</p>
    <p className="text-[28px] font-bold leading-9">{card.value === null ? '—' : card.value.toLocaleString()}</p>
    <p className="text-xs text-[#444746]">{card.sub}</p>
  </li>)}</ul>
}

function StageBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (!total) return null
  const parts = [...STAGES.map(stage => ({ key: stage.code, label: stage.label, color: STAGE_COLOR[stage.code].hex })), { key: 'none', label: '시작 전', color: '#C4C7C5' }]
  return <section aria-label="단계별 방 분포" className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
    <h3 className="font-bold">단계별 방 분포</h3>
    <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-[#E3E3E3]">{parts.map(part => counts[part.key] ? <span key={part.key} title={`${part.label} ${counts[part.key]}`} style={{ width: `${counts[part.key] / total * 100}%`, backgroundColor: part.color }} /> : null)}</div>
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">{parts.map(part => <li key={part.key} className="inline-flex items-center gap-2"><span className="size-3 rounded-full" style={{ backgroundColor: part.color }} />{part.label} {counts[part.key] ?? 0}</li>)}</ul>
  </section>
}

function Attention({ data }: { data: DashboardData }) {
  return <section aria-label="살펴볼 방" className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
    <h3 className="flex items-center gap-2 font-bold"><AlertTriangle size={18} className="text-[#B06000]" /> 살펴볼 방 {data.attention.length ? `${data.attention.length}곳` : ''}</h3>
    {!data.attention.length ? <p className="mt-2 text-sm text-[#444746]">지금 멈추거나 기록 담당이 빠진 방이 없습니다.</p> :
      <ul className="mt-3 divide-y divide-[#E1E3E1]">{data.attention.slice(0, 12).map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 py-3">
        <span className="min-w-0 flex-1 break-words font-semibold">{item.title}</span>
        {item.flags.map(flag => <span key={flag.kind} className={`rounded-full px-3 py-1 text-xs font-semibold ${flag.kind === 'idle' || flag.kind === 'no-recorder' ? 'bg-[#FFDBCB] text-[#7A2E0E]' : 'bg-[#E3E3E3] text-[#444746]'}`}>{flag.label}</span>)}
        <RoomActions id={item.id} title={item.title} />
      </li>)}</ul>}
  </section>
}

function RoomActions({ id, title }: { id: string; title: string }) {
  return <span className="flex shrink-0 gap-1">
    <Link href={`/projects/${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-[#0842A0] hover:bg-[#D3E3FD]"><Eye size={16} /> 실제 화면</Link>
    <button type="button" onClick={() => openNoticeComposer({ scope: 'project', target: id, label: title })} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-[#0842A0] hover:bg-[#D3E3FD]"><Megaphone size={16} /> 알림</button>
  </span>
}

function ProgressTable({ rows, now }: { rows: DashboardProject[]; now: number }) {
  const [onlyActive, setOnlyActive] = useState(false)
  const shown = onlyActive ? rows.filter(row => row.updatedAt !== null && now - row.updatedAt < 86_400_000) : rows
  return <section aria-label="방별 진도표" className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="flex-1 font-bold">방별 진도표 · 산출물과 보고서</h3>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[#444746]"><input type="checkbox" checked={onlyActive} onChange={event => setOnlyActive(event.target.checked)} className="size-4 accent-[#0B57D0]" />오늘 활동한 방만</label>
    </div>
    <p className="mt-1 text-xs text-[#444746]">● 확정 · ◐ 저장 · 빈칸 미작성 · – 개인 설계에서 숨긴 활동. 대화·자료 수는 최근 활동한 30개 방만 셉니다.</p>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead><tr>
          <th scope="col" className="sticky left-0 z-10 bg-white px-3 py-2 text-left">방</th>
          {STAGES.map(stage => <th key={stage.code} scope="colgroup" colSpan={stage.activities.length} className="px-1 py-2 text-center text-xs font-bold" style={{ color: STAGE_COLOR[stage.code].hex }}>{stage.label}</th>)}
          <th scope="col" className="px-2 py-2">보고서</th><th scope="col" className="px-2 py-2">대화</th><th scope="col" className="px-2 py-2">자료</th><th scope="col" className="px-2 py-2 text-left">최근 수정</th><th scope="col" className="px-2 py-2"><span className="sr-only">동작</span></th>
        </tr><tr>
          <th className="sticky left-0 z-10 bg-white" />
          {ALL_ACTIVITIES.map(code => <th key={code} scope="col" className="px-1 pb-2 text-[11px] font-medium text-[#444746]">{displayActivityCode(code)}</th>)}
          <th colSpan={5} />
        </tr></thead>
        <tbody>{shown.map(row => <ProgressRow key={row.id} row={row} />)}</tbody>
      </table>
    </div>
  </section>
}

function ProgressRow({ row }: { row: DashboardProject }) {
  const solo = isSoloRow(row)
  return <tr className="odd:bg-[#F8FAFD]">
    <th scope="row" className="sticky left-0 z-10 min-w-[200px] max-w-[280px] bg-inherit px-3 py-2 text-left font-semibold">
      <Link href={`/admin/projects/${encodeURIComponent(row.id)}`} className="block truncate hover:underline">{row.title}</Link>
      <span className="block truncate text-xs font-normal text-[#444746]">{row.training ? '연수용 · ' : ''}{solo ? '개인' : `협력 ${row.memberCount}명`}{row.activity ? ` · 현재 ${displayActivityCode(row.activity)}` : ''}</span>
    </th>
    {STAGES.map(stage => <Fragment key={stage.code}>{stage.activities.map(code => {
      const hidden = solo && SOLO_HIDDEN_ACTIVITIES.includes(code)
      const mark = row.artifacts[code]
      const current = row.activity === code
      return <td key={code} className={`px-1 py-2 text-center ${current ? 'outline outline-2 -outline-offset-2 outline-[#0B57D0]' : ''}`}
        title={`${displayActivityCode(code)} ${hidden ? '숨김' : mark === 'confirmed' ? '확정' : mark === 'saved' ? '저장' : '미작성'}${current ? ' · 현재 활동' : ''}`}
        style={{ color: STAGE_COLOR[stage.code as StageCode].hex }}>{hidden ? '–' : mark === 'confirmed' ? '●' : mark === 'saved' ? '◐' : ''}</td>
    })}</Fragment>)}
    <td className="px-2 py-2 text-center text-xs">{row.reports.length ? row.reports.map(key => key === 'all' ? '종합' : key).join(' ') : '—'}</td>
    <td className="px-2 py-2 text-right tabular-nums">{row.messageCount ?? '—'}</td>
    <td className="px-2 py-2 text-right tabular-nums">{row.materialCount ?? '—'}</td>
    <td className="whitespace-nowrap px-2 py-2 text-xs text-[#444746]">{adminDate(row.updatedAt)}</td>
    <td className="px-1 py-1"><RoomActions id={row.id} title={row.title} /></td>
  </tr>
}

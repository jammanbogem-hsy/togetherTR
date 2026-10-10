'use client'

import Link from 'next/link'
import { ArrowLeft, Eye, ShieldCheck } from 'lucide-react'
import { useAdminSession } from './adminClient'
import { NoticeComposerDialog } from './NoticeComposer'

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { ready, uid } = useAdminSession()
  return <main className="min-h-dvh bg-[#F8FAFD] p-4 pb-28 text-[#1F1F1F] sm:p-8 sm:pb-28">
    <div className="mx-auto max-w-[1440px]">
      <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#0842A0] hover:bg-[#D3E3FD]"><ArrowLeft size={18} /> 내 프로젝트</Link>
      <header className="my-5 flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D3E3FD] text-[#0842A0]"><ShieldCheck size={28} /></div>
        <div className="min-w-0 flex-1"><h1 className="text-[28px] font-bold">관리자 콘솔</h1><p className="mt-1 text-base text-[#444746]">전체 현황을 보고, 선생님 화면에 알림을 보냅니다.</p></div>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#E3E3E3] px-4 py-2 text-sm font-semibold text-[#444746]"><Eye size={18} /> 방 내용은 읽기 전용</span>
      </header>
      {!ready ? <p role="status">관리자 권한을 확인하고 있습니다…</p> : !uid ? <p role="alert" className="rounded-2xl bg-[#F9DEDC] p-5 text-[#8C1D18]">최고관리자 계정으로 로그인해 주세요.</p> : <div key={uid}>{children}<NoticeComposerDialog /></div>}
    </div>
  </main>
}

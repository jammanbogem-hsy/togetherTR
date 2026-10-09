'use client'

import Link from 'next/link'
import { FolderLock, ArrowRight } from 'lucide-react'
import { useAdminSession } from './adminClient'

export function AdminFolder() {
  const { uid } = useAdminSession()
  if (!uid) return null
  return <Link href="/admin" aria-label="관리자 폴더 열기" className="mb-6 flex w-full max-w-[420px] items-center gap-4 rounded-[28px] border border-[#A8C7FA] bg-[#E9F0FF] p-5 text-[#0842A0] transition-colors hover:bg-[#D3E3FD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]">
    <FolderLock size={40} aria-hidden="true" className="shrink-0" />
    <span className="min-w-0 flex-1"><span className="block text-xl font-bold">관리자</span><span className="mt-1 block text-sm text-[#444746]">전체 프로젝트 · 회원 목록 · 피드백함</span></span>
    <ArrowRight size={20} aria-hidden="true" className="shrink-0" />
  </Link>
}

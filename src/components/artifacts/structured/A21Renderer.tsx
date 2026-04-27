'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { A21Structured } from '@/lib/artifacts/schemas'

export function A21Renderer({ data }: { data: A21Structured }) {
  const table = data?.analysisTable ?? ''
  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">성취기준 분석표</span>
      </div>
      <div className="px-4 py-4 overflow-x-auto">
        {table ? (
          <div className="artifact-md text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              table: ({ children }) => <table className="min-w-full text-sm border-collapse">{children}</table>,
              thead: ({ children }) => <thead className="bg-[#1A73E8]">{children}</thead>,
              th: ({ children }) => <th className="px-3 py-2 text-left text-xs font-bold text-white border-b border-[#1557B0]">{children}</th>,
              td: ({ children }) => <td className="px-3 py-2 text-sm text-[#202124] leading-relaxed border-b border-[#F1F3F4]">{children}</td>,
              strong: ({ children }) => <span className="font-semibold text-[#1A73E8]">{children}</span>,
            }}>{table}</ReactMarkdown>
          </div>
        ) : <p className="text-sm text-[#9AA0A6]">아직 분석표가 작성되지 않았습니다</p>}
      </div>
    </div>
  )
}

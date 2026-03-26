'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileCheck, X } from 'lucide-react'

interface Props {
  title: string
  sections: Record<string, string>
  onAccept: () => void
  onDecline: () => void
}

export function ArtifactSaveProposal({ title, sections, onAccept, onDecline }: Props) {
  return (
    <div className="mx-0 my-3 border-2 border-blue-300 bg-blue-50 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
            <FileCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-blue-900">산출물 초안으로 저장할까요?</p>
            <p className="text-xs text-blue-600 mt-0.5">{title}</p>
          </div>
        </div>
        <button onClick={onDecline} className="text-blue-300 hover:text-blue-500">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 미리보기 */}
      <div className="bg-white rounded-xl border border-blue-200 px-3 py-2 mb-3 space-y-3 max-h-48 overflow-y-auto">
        {Object.entries(sections).map(([key, value]) => (
          <div key={key}>
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wide mb-1">{key}</p>
            <div className="text-xs text-gray-700 leading-relaxed prose prose-xs max-w-none
                            [&_strong]:font-semibold [&_strong]:text-gray-900
                            [&_ul]:mt-1 [&_ul]:space-y-0.5 [&_ul]:list-disc [&_ul]:pl-4
                            [&_ol]:mt-1 [&_ol]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4
                            [&_li]:text-xs [&_li]:text-gray-700
                            [&_p]:my-0.5 [&_p]:leading-relaxed
                            [&_table]:text-xs [&_table]:w-full [&_table]:border-collapse
                            [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-bold [&_th]:text-gray-600 [&_th]:border-b [&_th]:border-gray-200
                            [&_td]:px-2 [&_td]:py-1 [&_td]:text-gray-700 [&_td]:border-b [&_td]:border-gray-100">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {value}
              </ReactMarkdown>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onAccept}
          className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-sm font-bold
                     hover:bg-blue-600 transition-colors"
        >
          우측 패널에 저장
        </button>
        <button
          onClick={onDecline}
          className="px-4 py-2 rounded-xl border border-blue-200 text-blue-600 text-sm
                     hover:bg-blue-100 transition-colors"
        >
          건너뛰기
        </button>
      </div>
    </div>
  )
}

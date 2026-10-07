'use client'

import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { CheckSquare, X } from '@phosphor-icons/react'
import { trainingFormText } from '@/components/training/trainingFormText'
import { type ActivityCode, ACTIVITY_META } from '@/types'
import { isInternalArtifactKey } from '@/lib/artifacts/internalKeys'

interface Props {
  title: string
  sections: Record<string, unknown>
  onAccept: () => void
  onDecline: () => void
}

export function ArtifactSaveProposal({ title, sections, onAccept, onDecline }: Props) {
  const schema = typeof sections._schema === 'string' && Object.hasOwn(ACTIVITY_META, sections._schema) ? sections._schema as ActivityCode : undefined
  const preview = schema
    ? { '공동 편집 초안': trainingFormText(Object.fromEntries(Object.entries(sections).filter(([key]) => !isInternalArtifactKey(key))), schema) }
    : Object.fromEntries(Object.entries(sections).filter(([key]) => !isInternalArtifactKey(key)).map(([key, value]) => [key, typeof value === 'string' ? value : trainingFormText(value, 'T-2-1')]))
  return (
    <div className="mx-0 my-3 border border-[#AECBFA] bg-[#E8F0FE] rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1A73E8] flex items-center justify-center flex-shrink-0">
            <CheckSquare size={14} weight="fill" className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#1A237E]">산출물 초안으로 저장할까요?</p>
            <p className="text-xs text-[#1A73E8] mt-0.5">{title}</p>
          </div>
        </div>
        <button onClick={onDecline} className="text-[#9AA0A6] hover:text-[#5F6368]">
          <X size={16} weight="regular" />
        </button>
      </div>

      {/* 미리보기 */}
      <div className="bg-white rounded-xl border border-[#AECBFA] px-3 py-2 mb-3 space-y-3 max-h-48 overflow-y-auto">
        {Object.entries(preview).map(([key, value]) => (
          <div key={key}>
            <p className="text-[10px] font-bold text-[#1A73E8] uppercase tracking-wide mb-1">{key}</p>
            <div className="text-xs text-[#202124] leading-relaxed prose prose-xs max-w-none
                            [&_strong]:font-semibold [&_strong]:text-[#202124]
                            [&_ul]:mt-1 [&_ul]:space-y-0.5 [&_ul]:list-disc [&_ul]:pl-4
                            [&_ol]:mt-1 [&_ol]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4
                            [&_li]:text-xs [&_li]:text-[#202124]
                            [&_p]:my-0.5 [&_p]:leading-relaxed
                            [&_table]:text-xs [&_table]:w-full [&_table]:border-collapse
                            [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-bold [&_th]:text-[#5F6368] [&_th]:border-b [&_th]:border-[#DADCE0]
                            [&_td]:px-2 [&_td]:py-1 [&_td]:text-[#202124] [&_td]:border-b [&_td]:border-[#F1F3F4]">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                {value}
              </ReactMarkdown>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onAccept}
          className="flex-1 py-2 rounded-full bg-[#1A73E8] text-white text-sm font-bold hover:bg-[#1557b0] transition-colors"
        >
          우측 패널에 저장
        </button>
        <button
          onClick={onDecline}
          className="px-4 py-2 rounded-full border border-[#AECBFA] text-[#1A73E8] text-sm hover:bg-[#C9DAF8] transition-colors"
        >
          건너뛰기
        </button>
      </div>
    </div>
  )
}

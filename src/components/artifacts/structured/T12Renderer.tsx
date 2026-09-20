'use client'

import type { T12Structured } from '@/lib/artifacts/schemas'
import type { JSONContent } from '@tiptap/core'
import type { ReactNode } from 'react'

function RichNode({ node }: { node: JSONContent }) {
  const children = (node.content ?? []).map((child, i) => <RichNode key={i} node={child} />)
  if (node.type === 'text') {
    let text: ReactNode = node.text ?? ''
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = <strong>{text}</strong>
      if (mark.type === 'italic') text = <em>{text}</em>
      if (mark.type === 'underline') text = <u>{text}</u>
      if (mark.type === 'strike') text = <s>{text}</s>
      if (mark.type === 'code') text = <code>{text}</code>
    }
    return <>{text}</>
  }
  switch (node.type) {
    case 'hardBreak': return <br />
    case 'heading': return <h4 className="text-lg font-semibold">{children}</h4>
    case 'bulletList': return <ul className="list-disc pl-6">{children}</ul>
    case 'orderedList': return <ol className="list-decimal pl-6" start={Number(node.attrs?.start) || 1}>{children}</ol>
    case 'listItem': return <li>{children}</li>
    case 'blockquote': return <blockquote className="border-l-2 pl-3">{children}</blockquote>
    case 'table': return <div className="overflow-x-auto"><table className="border-collapse w-full"><tbody>{children}</tbody></table></div>
    case 'tableRow': return <tr>{children}</tr>
    case 'tableHeader': return <th className="border p-2">{children}</th>
    case 'tableCell': return <td className="border p-2">{children}</td>
    case 'codeBlock': return <pre>{children}</pre>
    case 'horizontalRule': return <hr />
    default: return <p className="whitespace-pre-wrap leading-relaxed">{children}</p>
  }
}

interface Props {
  data: T12Structured
}

// AI가 `**프로젝트 기반 학습(PBL)**: ...` 같은 마크다운 굵은체로 산출물을 작성하는 경우가 있어,
// raw 마크다운이 사용자에게 그대로 보이지 않도록 inline bold만 변환한다. (`*italic*`/링크 등은 무시)
function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4
          ? <strong key={i} className="font-extrabold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

export function T12Renderer({ data }: Props) {
  const designPrinciples = data?.designPrinciples ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">수업 설계 원칙</span>
        </div>
        {designPrinciples.length > 0 ? (
          <div className="divide-y divide-[#F1F3F4]">
            {designPrinciples.map((dp, i) => (
              <div key={i} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1A73E8] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#202124] leading-relaxed">
                      <InlineMarkdown text={dp.principle} />
                    </p>
                    {dp.rationale && (
                      <p className="mt-1.5 text-xs text-[#5F6368] leading-relaxed">
                        <InlineMarkdown text={dp.rationale} />
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">
            아직 설계 원칙이 확정되지 않았습니다
          </div>
        )}
      </div>
      {(data.manualWorkspace?.blocks ?? []).some(block => block.content?.trim() || block.table) && (
        <section className="space-y-3 px-4 py-3" aria-label="공동 편집 본문">
          <h3 className="text-sm font-semibold text-[#5F6368]">공동 편집 본문</h3>
          {(data.manualWorkspace?.blocks ?? []).filter(block => block.includeInArtifact !== false).map(block => (
            block.richContent ? <RichNode key={block.id} node={block.richContent} /> : block.type === 'table' && block.table ? (
              <div key={block.id} className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead><tr>{block.table.columns.map(column => <th key={column.id} className="border p-2 text-left">{column.label}</th>)}</tr></thead>
                  <tbody>{block.table.rows.map(row => <tr key={row.id}>{block.table!.columns.map(column => <td key={column.id} className="border p-2 whitespace-pre-wrap">{row.cells[column.id]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : block.type === 'heading' || block.type === 'subheading' ? (
              <h4 key={block.id} className="text-lg font-semibold whitespace-pre-wrap">{block.content}</h4>
            ) : block.type === 'quote' ? (
              <blockquote key={block.id} className="border-l-2 pl-3 whitespace-pre-wrap text-[#5F6368]">{block.content}</blockquote>
            ) : <p key={block.id} className="text-sm whitespace-pre-wrap leading-relaxed">{block.content}</p>
          ))}
        </section>
      )}
    </div>
  )
}

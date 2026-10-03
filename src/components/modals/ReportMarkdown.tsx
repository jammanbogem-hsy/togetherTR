'use client'

import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { childrenToText, pickReportIcon, ReportIcon, stripLeadingEmoji } from '@/components/ui/ReportSectionIcon'

// 강조·링크 안의 학년군도 한 줄로 읽고, 기존 보고서의 셀 내부 줄 구분은 유지한다.
function reportCellContent(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child === 'string') {
      const lines = child.includes('【') && child.includes(' / 【') ? child.split(' / ') : child.split('\u2028')
      return lines.map((line, index) => <span key={index}>
        {index > 0 && <br />}
        {line.split(/((?:초등(?:학교)?\s*|초)?[1-6]\s*[-~–]\s*[1-6]\s*학년(?:군)?)/g).map((part, i) =>
          i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part)}
      </span>)
    }
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return cloneElement(child, {}, reportCellContent(child.props.children))
    }
    return child
  })
}

/** 화면용 MD3 보고서. PDF용 기존 렌더와 분리해 내보내기 모양을 보존한다. */
export function ReportMarkdown({ content }: { content: string }) {
  return <div className="min-w-0 max-w-full break-words text-[14px] leading-7 text-[var(--md-sys-on-surface-variant)]">
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={{
      h1: ({ children }) => <h1 className="mb-6 text-[24px] font-medium leading-8 text-[var(--md-sys-on-surface)]">{children}</h1>,
      h2: ({ children }) => {
        const raw = childrenToText(children)
        const icon = pickReportIcon(raw)
        return <h2 className="mb-4 mt-8 flex items-start gap-2 rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-surface-container)] px-4 py-3 text-[18px] font-medium leading-7 text-[var(--md-sys-on-surface)]">
          {icon && <span className="mt-1 shrink-0 text-[var(--md-sys-primary)]"><ReportIcon name={icon} size={20} /></span>}
          <span className="min-w-0">{stripLeadingEmoji(raw) || children}</span>
        </h2>
      },
      h3: ({ children }) => <h3 className="mb-2 mt-6 text-[16px] font-medium text-[var(--md-sys-on-surface)]">{stripLeadingEmoji(childrenToText(children)) || children}</h3>,
      h4: ({ children }) => <h4 className="mb-2 mt-4 font-medium text-[var(--md-sys-on-surface)]">{stripLeadingEmoji(childrenToText(children)) || children}</h4>,
      p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold text-[var(--md-sys-on-surface)]">{children}</strong>,
      ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-[var(--md-sys-primary)]">{children}</ul>,
      ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:font-medium marker:text-[var(--md-sys-primary)]">{children}</ol>,
      li: ({ children }) => <li className="pl-1">{children}</li>,
      blockquote: ({ children }) => <blockquote className="my-4 rounded-r-[var(--md-sys-radius-md)] border-l-4 border-[var(--md-sys-primary)] bg-[var(--md-sys-surface-container-low)] px-4 py-2">{children}</blockquote>,
      table: ({ children }) => <div role="region" aria-label="보고서 표" tabIndex={0} className="my-5 max-h-[60vh] max-w-full overflow-auto rounded-[var(--md-sys-radius-md)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)] focus-visible:outline-2 focus-visible:outline-[var(--md-sys-primary)]">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-[13px] leading-6">{children}</table>
      </div>,
      thead: ({ children }) => <thead>{children}</thead>,
      th: ({ children }) => <th scope="col" className="sticky top-0 z-10 min-w-[10rem] whitespace-nowrap border-b border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container)] px-4 py-3 font-medium text-[var(--md-sys-on-surface-variant)] first:min-w-[9rem]">{children}</th>,
      tr: ({ children }) => <tr className="hover:bg-[var(--md-sys-surface-container-low)]">{children}</tr>,
      td: ({ children }) => <td className="min-w-[10rem] border-b border-[var(--md-sys-outline-variant)] px-4 py-3 align-top [overflow-wrap:anywhere] first:min-w-[9rem]">{reportCellContent(children)}</td>,
      hr: () => <hr className="my-6 border-[var(--md-sys-outline-variant)]" />,
      em: ({ children }) => <em className="text-[var(--md-sys-on-surface-variant)]">{children}</em>,
      code: ({ children }) => <code className="rounded-[var(--md-sys-radius-xs)] bg-[var(--md-sys-surface-container-high)] px-1.5 py-0.5 text-[0.9em]">{children}</code>,
      pre: ({ children }) => <pre className="my-4 max-w-full overflow-x-auto rounded-[var(--md-sys-radius-md)] bg-[var(--md-sys-surface-container-high)] p-4 text-[13px]">{children}</pre>,
      a: ({ href, children }) => <a href={href} className="text-[var(--md-sys-primary)] underline underline-offset-2">{children}</a>,
    }}>{content}</ReactMarkdown>
  </div>
}
